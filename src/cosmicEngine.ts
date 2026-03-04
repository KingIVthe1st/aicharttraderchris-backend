/**
 * Cosmic Engine — Orchestrator Module
 *
 * Assembles a complete cosmic intelligence payload by calling all
 * sub-modules (numerology, astrology, planetary hours, hora grid,
 * Chinese zodiac, environmental energy, NEO scoring).
 */

import { getNumerologyProfile } from './numerology';
import type { NumerologyProfile } from './numerology';
import { getMoonPhase, getVOCStatus } from './astrology';
import type { MoonPhase, VOCStatus } from './astrology';
import { getPlanetaryHours, getCurrentPlanetaryHour } from './planetaryHours';
import type { PlanetaryHourMap, PlanetaryHour } from './planetaryHours';
import { buildHoraGrid } from './horaGrid';
import type { HoraGrid } from './horaGrid';
import { getCurrentShiChen, getAnimalCompatibility, getChineseZodiac } from './chineseZodiac';
import type { ShiChenHour, ChineseAnimal } from './chineseZodiac';
import { fetchEnvironmentalEnergy } from './environmentalEnergy';
import type { EnvironmentalEnergy } from './environmentalEnergy';
import { calculateNEOScore } from './neoScoring';
import type { NEOScore } from './neoScoring';
import type { SoulBlueprint } from './soulBlueprint';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface CosmicIntelligence {
  date: string;
  timezone: string;
  neoScore: NEOScore;
  moonPhase: MoonPhase;
  vocStatus: VOCStatus;
  planetaryHours: PlanetaryHourMap;
  horaGrid: HoraGrid;
  chineseHour: ShiChenHour;
  chineseCompatibility: string;   // 'ally' | 'enemy' | 'clash' | 'neutral'
  environmentalEnergy: EnvironmentalEnergy;
  numerology: NumerologyProfile;
  bestTradingWindows: Array<{ time: string; reason: string; nodeType: string }>;
  enemyHourAlert: { active: boolean; message: string } | null;
}

// ---------------------------------------------------------------------------
// Timezone Offset Helper
// ---------------------------------------------------------------------------

const TIMEZONE_OFFSETS: Record<string, number> = {
  'America/New_York': -300,
  'America/Chicago': -360,
  'America/Denver': -420,
  'America/Los_Angeles': -480,
  'America/Anchorage': -540,
  'America/Phoenix': -420,
  'America/Detroit': -300,
  'America/Indiana/Indianapolis': -300,
  'America/Toronto': -300,
  'America/Winnipeg': -360,
  'America/Edmonton': -420,
  'America/Vancouver': -480,
  'America/Sao_Paulo': -180,
  'America/Mexico_City': -360,
  'Europe/London': 0,
  'Europe/Berlin': 60,
  'Europe/Paris': 60,
  'Europe/Madrid': 60,
  'Europe/Rome': 60,
  'Europe/Amsterdam': 60,
  'Europe/Zurich': 60,
  'Europe/Stockholm': 60,
  'Europe/Moscow': 180,
  'Europe/Istanbul': 180,
  'Asia/Dubai': 240,
  'Asia/Kolkata': 330,
  'Asia/Shanghai': 480,
  'Asia/Hong_Kong': 480,
  'Asia/Singapore': 480,
  'Asia/Tokyo': 540,
  'Asia/Seoul': 540,
  'Australia/Sydney': 660,
  'Pacific/Auckland': 780,
  'UTC': 0,
};

/**
 * Returns the UTC offset in minutes for a given timezone string.
 * Uses a static lookup table — does not handle DST transitions precisely.
 */
export function getTimezoneOffsetMinutes(timezone: string): number {
  return TIMEZONE_OFFSETS[timezone] ?? 0;
}

// ---------------------------------------------------------------------------
// Main Cosmic Intelligence Function
// ---------------------------------------------------------------------------

/**
 * Assemble a full cosmic intelligence payload for the given user blueprint.
 */
export async function getCosmicIntelligence(
  blueprint: SoulBlueprint,
  timezone: string,
  kvStore: KVNamespace,
): Promise<CosmicIntelligence> {
  const now = new Date();
  const timezoneOffsetMinutes = getTimezoneOffsetMinutes(timezone);

  // 1. Numerology profile
  const numerology = getNumerologyProfile(blueprint.birthDate, now);

  // 2. Moon phase
  const moonPhase = getMoonPhase(now);

  // 3. Void-of-course status
  const vocStatus = getVOCStatus(now);

  // 4. Planetary hours
  const planetaryHourMap = getPlanetaryHours(
    blueprint.birthLat,
    blueprint.birthLon,
    now,
    blueprint.planetaryRuler as any,
  );

  // 5. Current planetary hour
  const currentPlanetaryHour = planetaryHourMap.currentHour;

  // 6. Hora grid
  const horaGrid = buildHoraGrid(
    now,
    timezone,
    blueprint.birthLat,
    blueprint.birthLon,
    blueprint.planetaryRuler as any,
    blueprint.chineseAnimal as any,
  );

  // 7. Current Shi Chen (Chinese hour)
  const shiChenHour = getCurrentShiChen(now, timezoneOffsetMinutes);

  // 8. Chinese animal compatibility
  const chineseCompatibility = getAnimalCompatibility(
    blueprint.chineseAnimal as ChineseAnimal,
    shiChenHour.animal,
  );

  // 9. Environmental energy (space weather)
  const environmental = await fetchEnvironmentalEnergy(kvStore);

  // 10. Chinese zodiac profile for NEO scoring
  const chineseProfile = getChineseZodiac(
    parseInt(blueprint.birthDate.split('-')[0]),
  );

  // 11. NEO score
  const neoScore = calculateNEOScore(
    numerology,
    moonPhase,
    vocStatus,
    currentPlanetaryHour,
    chineseProfile,
    shiChenHour,
    environmental,
    now,
  );

  // 12. Best trading windows from hora grid
  const bestTradingWindows = horaGrid.hours
    .filter(
      (h) => h.nodeType === 'ULTRA_ALIGNED' || h.nodeType === 'HIGH_PRESSURE',
    )
    .slice(0, 5)
    .map((h) => ({
      time: h.startTime,
      reason: h.tradingGuidance,
      nodeType: h.nodeType,
    }));

  // 13. Enemy hour alert
  let enemyHourAlert: { active: boolean; message: string } | null = null;
  if (currentPlanetaryHour.isEnemyHour) {
    enemyHourAlert = {
      active: true,
      message: `Current hour is ruled by ${currentPlanetaryHour.planet} — enemy of your planetary ruler (${blueprint.planetaryRuler}). Consider inversions or sit this hour out. Enemy hours can produce reversals — use caution or trade counter-trend.`,
    };
  }

  return {
    date: now.toISOString().split('T')[0],
    timezone,
    neoScore,
    moonPhase,
    vocStatus,
    planetaryHours: planetaryHourMap,
    horaGrid,
    chineseHour: shiChenHour,
    chineseCompatibility,
    environmentalEnergy: environmental,
    numerology,
    bestTradingWindows,
    enemyHourAlert,
  };
}

// ---------------------------------------------------------------------------
// Cosmic Overlay Context (for GPT-4o prompt injection)
// ---------------------------------------------------------------------------

/**
 * Generate a formatted text block summarizing the cosmic state
 * for injection into the analyze endpoint's GPT-4o system prompt.
 */
export function generateCosmicOverlayContext(cosmic: CosmicIntelligence): string {
  const { neoScore, moonPhase, vocStatus, numerology, environmentalEnergy } = cosmic;

  const currentHour = cosmic.planetaryHours.currentHour;
  const hourRelationship = currentHour.isAllyHour
    ? 'Ally Hour - favorable'
    : currentHour.isEnemyHour
      ? 'Enemy Hour - unfavorable'
      : 'Neutral Hour';

  const compatLabel =
    cosmic.chineseCompatibility === 'ally'
      ? 'Ally - reinforced confidence'
      : cosmic.chineseCompatibility === 'clash'
        ? 'Clash - exercise caution'
        : cosmic.chineseCompatibility === 'enemy'
          ? 'Enemy - heightened risk'
          : 'Neutral';

  const vocLabel = vocStatus.isVoid ? `VOID — ${vocStatus.message}` : 'Clear';

  const envLabel = `${environmentalEnergy.overallStatus.charAt(0).toUpperCase() + environmentalEnergy.overallStatus.slice(1)} (K-index: ${environmentalEnergy.kIndex}${environmentalEnergy.solarFlareActive ? ', Solar flare active' : ', No solar flares'})`;

  const alignmentLabel = numerology.isAlignmentDay
    ? `Personal Day ${numerology.personalDay} (Alignment Day!)`
    : `Personal Day ${numerology.personalDay}`;

  const enemyAlert = cosmic.enemyHourAlert
    ? cosmic.enemyHourAlert.message
    : 'None';

  // Find the current hora grid hour
  const currentHoraNode =
    cosmic.horaGrid.hours[cosmic.horaGrid.currentHourIndex]?.nodeType ?? 'UNKNOWN';

  // Best windows (top 3)
  const windowLines = cosmic.bestTradingWindows.slice(0, 3).map(
    (w) => `  - ${w.time}: ${w.reason} [${w.nodeType}]`,
  );
  const windowsText =
    windowLines.length > 0 ? windowLines.join('\n') : '  - No ultra-aligned or high-pressure windows found';

  return `
=== COSMIC TRADING CONTEXT ===
NEO Score: ${neoScore.total}/17 (${neoScore.classification})
Current Planetary Hour: ${currentHour.planet} (${hourRelationship})
Moon Phase: ${moonPhase.phase} (${moonPhase.isWaxing ? 'building energy' : 'releasing energy'})
VOC Status: ${vocLabel}
Chinese Hour: ${cosmic.chineseHour.animal} (${compatLabel})
Hora Grid Node: ${currentHoraNode}
Environmental: ${envLabel}
Numerology: ${alignmentLabel}
Enemy Hour Alert: ${enemyAlert}
Best Windows:
${windowsText}
=== END COSMIC CONTEXT ===`.trim();
}
