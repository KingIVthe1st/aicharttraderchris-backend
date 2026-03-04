/**
 * Environmental Energy Module
 *
 * Fetches and interprets space weather data from NOAA public APIs.
 * Provides K-index (geomagnetic activity) and solar flare status
 * to inform cosmic trading risk assessments.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnvironmentalEnergy {
  kIndex: number;
  kIndexLevel: 'calm' | 'moderate' | 'high';
  solarFlareActive: boolean;
  solarFlareClass: string | null;
  schumannResonance: 'normal' | 'elevated' | 'spike';
  overallStatus: 'green' | 'amber' | 'red';
  tradingImpact: string;
  lastUpdated: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KV_KEY = 'environmental_energy';
const CACHE_TTL_SECONDS = 3 * 60 * 60; // 3 hours

const NOAA_K_INDEX_URL =
  'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const NOAA_SOLAR_FLARES_URL =
  'https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json';

const TRADING_IMPACT: Record<EnvironmentalEnergy['overallStatus'], string> = {
  green: 'Calm conditions — proceed normally',
  amber: 'Moderate disruption — consider reducing position size',
  red: 'High volatility risk — sit out or hedge only',
};

// ---------------------------------------------------------------------------
// Safe defaults (used when NOAA APIs fail)
// ---------------------------------------------------------------------------

function safeDefaults(): EnvironmentalEnergy {
  return {
    kIndex: 2,
    kIndexLevel: 'calm',
    solarFlareActive: false,
    solarFlareClass: null,
    schumannResonance: 'normal',
    overallStatus: 'green',
    tradingImpact: TRADING_IMPACT.green,
    lastUpdated: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// K-Index helpers
// ---------------------------------------------------------------------------

function classifyKIndex(kp: number): EnvironmentalEnergy['kIndexLevel'] {
  if (kp >= 5) return 'high';
  if (kp >= 3) return 'moderate';
  return 'calm';
}

async function fetchKIndex(): Promise<{ kIndex: number; kIndexLevel: EnvironmentalEnergy['kIndexLevel'] }> {
  const res = await fetch(NOAA_K_INDEX_URL);
  if (!res.ok) throw new Error(`K-index API returned ${res.status}`);

  const data: string[][] = await res.json();
  // First row is headers, last row is the most recent reading.
  if (data.length < 2) throw new Error('K-index data too short');

  const latest = data[data.length - 1];
  // Entry format: [timestamp, kp_value, ...]
  const kIndex = parseFloat(latest[1]);
  if (isNaN(kIndex)) throw new Error('Could not parse kp_value');

  return { kIndex, kIndexLevel: classifyKIndex(kIndex) };
}

// ---------------------------------------------------------------------------
// Solar Flare helpers
// ---------------------------------------------------------------------------

interface NoaaFlareEntry {
  currentClass?: string;
  beginTime?: string;
  [key: string]: unknown;
}

async function fetchSolarFlares(): Promise<{
  solarFlareActive: boolean;
  solarFlareClass: string | null;
}> {
  const res = await fetch(NOAA_SOLAR_FLARES_URL);
  if (!res.ok) throw new Error(`Solar flares API returned ${res.status}`);

  const flares: NoaaFlareEntry[] = await res.json();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  for (const flare of flares) {
    const flareTime = flare.beginTime ? new Date(flare.beginTime).getTime() : 0;
    if (flareTime < cutoff) continue;

    const cls = flare.currentClass ?? '';
    if (cls.startsWith('X') || cls.startsWith('M')) {
      return { solarFlareActive: true, solarFlareClass: cls.charAt(0) };
    }
  }

  return { solarFlareActive: false, solarFlareClass: null };
}

// ---------------------------------------------------------------------------
// Overall status derivation
// ---------------------------------------------------------------------------

function deriveOverallStatus(
  kIndex: number,
  solarFlareClass: string | null,
): EnvironmentalEnergy['overallStatus'] {
  if (kIndex >= 5 || solarFlareClass === 'X') return 'red';
  if (kIndex >= 3 || solarFlareClass === 'M') return 'amber';
  return 'green';
}

// ---------------------------------------------------------------------------
// Core fetch logic (assembles data from all sources)
// ---------------------------------------------------------------------------

async function fetchFreshData(): Promise<EnvironmentalEnergy> {
  let kIndex = 2;
  let kIndexLevel: EnvironmentalEnergy['kIndexLevel'] = 'calm';
  let solarFlareActive = false;
  let solarFlareClass: string | null = null;

  // Fetch K-index
  try {
    const kData = await fetchKIndex();
    kIndex = kData.kIndex;
    kIndexLevel = kData.kIndexLevel;
  } catch (err) {
    console.error('[environmentalEnergy] Failed to fetch K-index:', err);
  }

  // Fetch solar flares
  try {
    const flareData = await fetchSolarFlares();
    solarFlareActive = flareData.solarFlareActive;
    solarFlareClass = flareData.solarFlareClass;
  } catch (err) {
    console.error('[environmentalEnergy] Failed to fetch solar flares:', err);
  }

  const overallStatus = deriveOverallStatus(kIndex, solarFlareClass);

  return {
    kIndex,
    kIndexLevel,
    solarFlareActive,
    solarFlareClass,
    schumannResonance: 'normal', // No reliable free API — default for MVP
    overallStatus,
    tradingImpact: TRADING_IMPACT[overallStatus],
    lastUpdated: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns cached environmental energy data if available and fresh,
 * otherwise fetches from NOAA, caches the result, and returns it.
 */
export async function fetchEnvironmentalEnergy(
  kvStore: KVNamespace,
): Promise<EnvironmentalEnergy> {
  // Try cache first
  try {
    const cached = await kvStore.get(KV_KEY);
    if (cached) {
      const parsed: EnvironmentalEnergy = JSON.parse(cached);
      const age = Date.now() - new Date(parsed.lastUpdated).getTime();
      if (age < CACHE_TTL_SECONDS * 1000) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('[environmentalEnergy] Cache read error:', err);
  }

  // Fetch fresh data
  const data = await fetchFreshData();

  // Cache it (don't await — fire and forget to keep response fast)
  try {
    await kvStore.put(KV_KEY, JSON.stringify(data), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[environmentalEnergy] Cache write error:', err);
  }

  return data;
}

/**
 * Called by cron trigger to proactively refresh cached data.
 */
export async function refreshEnvironmentalData(
  kvStore: KVNamespace,
): Promise<void> {
  const data = await fetchFreshData();

  try {
    await kvStore.put(KV_KEY, JSON.stringify(data), {
      expirationTtl: CACHE_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[environmentalEnergy] Cron cache write error:', err);
  }
}
