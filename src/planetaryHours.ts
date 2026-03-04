/**
 * Planetary Hours Calculation Module
 *
 * Calculates planetary hours based on the Chaldean sequence,
 * sunrise/sunset times, and Vedic friend-enemy relationships.
 * Pure math — no external dependencies except the Planet type.
 */

// Note: Planet type will be imported from astrology.ts once it exists.
// import type { Planet } from './astrology';
// For now, define it locally so the module is self-contained.
export type Planet = 'Sun' | 'Moon' | 'Mars' | 'Mercury' | 'Jupiter' | 'Venus' | 'Saturn';

export interface PlanetaryHour {
  planet: Planet;
  startTime: Date;
  endTime: Date;
  hourNumber: number;
  isDaytime: boolean;
  isAllyHour: boolean;
  isEnemyHour: boolean;
  isNeutralHour: boolean;
  portalWindow: { start: Date; end: Date };
}

export interface PlanetaryHourMap {
  dayRuler: Planet;
  currentHour: PlanetaryHour;
  nextHours: PlanetaryHour[];
  sunrise: Date;
  sunset: Date;
}

// ---------------------------------------------------------------------------
// Chaldean Sequence
// ---------------------------------------------------------------------------

const CHALDEAN_SEQUENCE: Planet[] = [
  'Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon',
];

/**
 * Returns the Chaldean sequence of planets.
 */
export function getChaldeanSequence(): Planet[] {
  return [...CHALDEAN_SEQUENCE];
}

// ---------------------------------------------------------------------------
// Day Rulers (first planetary hour at sunrise)
// ---------------------------------------------------------------------------

const DAY_RULERS: Record<number, Planet> = {
  0: 'Sun',       // Sunday
  1: 'Moon',      // Monday
  2: 'Mars',      // Tuesday
  3: 'Mercury',   // Wednesday
  4: 'Jupiter',   // Thursday
  5: 'Venus',     // Friday
  6: 'Saturn',    // Saturday
};

// ---------------------------------------------------------------------------
// Vedic Friend-Enemy Matrix
// ---------------------------------------------------------------------------

const FRIENDS: Record<Planet, Planet[]> = {
  Sun:     ['Moon', 'Mars', 'Jupiter'],
  Moon:    ['Sun', 'Mercury'],
  Mars:    ['Sun', 'Moon', 'Jupiter'],
  Mercury: ['Sun', 'Venus'],
  Jupiter: ['Sun', 'Moon', 'Mars'],
  Venus:   ['Mercury', 'Saturn'],
  Saturn:  ['Mercury', 'Venus'],
};

const ENEMIES: Record<Planet, Planet[]> = {
  Sun:     ['Venus', 'Saturn'],
  Moon:    [],
  Mars:    ['Venus', 'Mercury'],
  Mercury: ['Moon'],
  Jupiter: ['Mercury', 'Venus'],
  Venus:   ['Sun', 'Moon'],
  Saturn:  ['Sun', 'Moon', 'Mars'],
};

/**
 * Returns true if planet2 is a friend of planet1 in the Vedic system.
 */
export function isPlanetaryAlly(planet1: Planet, planet2: Planet): boolean {
  return FRIENDS[planet1].includes(planet2);
}

/**
 * Returns true if planet2 is an enemy of planet1 in the Vedic system.
 */
export function isPlanetaryEnemy(planet1: Planet, planet2: Planet): boolean {
  return ENEMIES[planet1].includes(planet2);
}

// ---------------------------------------------------------------------------
// Sunrise / Sunset Calculations
// ---------------------------------------------------------------------------

/** Degrees to radians. */
function deg2rad(deg: number): number {
  return deg * (Math.PI / 180);
}

/** Radians to degrees. */
function rad2deg(rad: number): number {
  return rad * (180 / Math.PI);
}

/** Calculate the day-of-year for a given Date (1-based). */
function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/**
 * Simplified sunrise calculation.
 *
 * Solar declination: δ = -23.44 × cos(360/365 × (dayOfYear + 10))
 * Hour angle: cos(ω) = -tan(lat) × tan(δ)
 * Sunrise (UTC) = 12 - ω/15 - lon/15
 *
 * For arctic/antarctic regions where the sun doesn't rise/set, defaults to 6 AM.
 */
export function calculateSunrise(lat: number, lon: number, date: Date): Date {
  const doy = dayOfYear(date);

  // Solar declination in degrees
  const declination = -23.44 * Math.cos(deg2rad((360 / 365) * (doy + 10)));

  const latRad = deg2rad(lat);
  const declRad = deg2rad(declination);

  const cosOmega = -Math.tan(latRad) * Math.tan(declRad);

  let sunriseHourUTC: number;

  if (cosOmega < -1 || cosOmega > 1) {
    // Sun never rises or never sets — default to 6 AM local approximation
    sunriseHourUTC = 6 - lon / 15;
  } else {
    const omega = rad2deg(Math.acos(cosOmega));
    sunriseHourUTC = 12 - omega / 15 - lon / 15;
  }

  // Normalise to 0-24 range
  sunriseHourUTC = ((sunriseHourUTC % 24) + 24) % 24;

  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCMilliseconds(sunriseHourUTC * 3600000);

  return result;
}

/**
 * Simplified sunset calculation.
 *
 * Same as sunrise but: Sunset (UTC) = 12 + ω/15 - lon/15
 *
 * For arctic/antarctic regions, defaults to 6 PM.
 */
export function calculateSunset(lat: number, lon: number, date: Date): Date {
  const doy = dayOfYear(date);

  const declination = -23.44 * Math.cos(deg2rad((360 / 365) * (doy + 10)));

  const latRad = deg2rad(lat);
  const declRad = deg2rad(declination);

  const cosOmega = -Math.tan(latRad) * Math.tan(declRad);

  let sunsetHourUTC: number;

  if (cosOmega < -1 || cosOmega > 1) {
    // Default to 6 PM local approximation
    sunsetHourUTC = 18 - lon / 15;
  } else {
    const omega = rad2deg(Math.acos(cosOmega));
    sunsetHourUTC = 12 + omega / 15 - lon / 15;
  }

  sunsetHourUTC = ((sunsetHourUTC % 24) + 24) % 24;

  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCMilliseconds(sunsetHourUTC * 3600000);

  return result;
}

// ---------------------------------------------------------------------------
// Planetary Hours Computation
// ---------------------------------------------------------------------------

/**
 * Get the planet ruling the Nth hour after the day ruler,
 * following the Chaldean sequence.
 */
function getHourRuler(dayRuler: Planet, hourOffset: number): Planet {
  const startIndex = CHALDEAN_SEQUENCE.indexOf(dayRuler);
  const index = ((startIndex + hourOffset) % 7 + 7) % 7;
  return CHALDEAN_SEQUENCE[index];
}

/**
 * Build a PlanetaryHour object.
 */
function buildHour(
  planet: Planet,
  startTime: Date,
  endTime: Date,
  hourNumber: number,
  isDaytime: boolean,
  userPlanetaryRuler: Planet,
): PlanetaryHour {
  const isAllyHour = isPlanetaryAlly(userPlanetaryRuler, planet);
  const isEnemyHour = isPlanetaryEnemy(userPlanetaryRuler, planet);
  const isNeutralHour = !isAllyHour && !isEnemyHour;

  // Portal window: startTime + 30 min to startTime + 45 min
  const portalStart = new Date(startTime.getTime() + 30 * 60000);
  const portalEnd = new Date(startTime.getTime() + 45 * 60000);

  return {
    planet,
    startTime,
    endTime,
    hourNumber,
    isDaytime,
    isAllyHour,
    isEnemyHour,
    isNeutralHour,
    portalWindow: { start: portalStart, end: portalEnd },
  };
}

/**
 * Find the planetary hour that contains the given time.
 */
export function getCurrentPlanetaryHour(hours: PlanetaryHour[], now: Date): PlanetaryHour {
  const nowMs = now.getTime();

  for (const hour of hours) {
    if (nowMs >= hour.startTime.getTime() && nowMs < hour.endTime.getTime()) {
      return hour;
    }
  }

  // Fallback: return the last hour if now is exactly at or past all end times
  return hours[hours.length - 1];
}

/**
 * Calculate all 24 planetary hours for a given date and location,
 * and return the current hour plus upcoming hours.
 *
 * Daytime: sunrise → sunset divided into 12 equal planetary "hours".
 * Nighttime: sunset → next sunrise divided into 12 equal planetary "hours".
 * First daytime hour ruler = day ruler (determined by day of week).
 * Subsequent hours follow the Chaldean sequence.
 */
export function getPlanetaryHours(
  lat: number,
  lon: number,
  date: Date,
  userPlanetaryRuler: Planet,
): PlanetaryHourMap {
  const sunrise = calculateSunrise(lat, lon, date);
  const sunset = calculateSunset(lat, lon, date);

  // Next day sunrise for nighttime duration
  const nextDay = new Date(date);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextSunrise = calculateSunrise(lat, lon, nextDay);

  const dayRuler = DAY_RULERS[date.getUTCDay()];

  const daytimeMs = sunset.getTime() - sunrise.getTime();
  const nighttimeMs = nextSunrise.getTime() - sunset.getTime();

  const dayHourMs = daytimeMs / 12;
  const nightHourMs = nighttimeMs / 12;

  const allHours: PlanetaryHour[] = [];

  // 12 daytime hours
  for (let i = 0; i < 12; i++) {
    const planet = getHourRuler(dayRuler, i);
    const startTime = new Date(sunrise.getTime() + i * dayHourMs);
    const endTime = new Date(sunrise.getTime() + (i + 1) * dayHourMs);

    allHours.push(buildHour(planet, startTime, endTime, i + 1, true, userPlanetaryRuler));
  }

  // 12 nighttime hours
  for (let i = 0; i < 12; i++) {
    const planet = getHourRuler(dayRuler, 12 + i);
    const startTime = new Date(sunset.getTime() + i * nightHourMs);
    const endTime = new Date(sunset.getTime() + (i + 1) * nightHourMs);

    allHours.push(buildHour(planet, startTime, endTime, 13 + i, false, userPlanetaryRuler));
  }

  const now = new Date();
  const currentHour = getCurrentPlanetaryHour(allHours, now);
  const currentIndex = allHours.indexOf(currentHour);
  const nextHours = allHours.slice(currentIndex + 1);

  return {
    dayRuler,
    currentHour,
    nextHours,
    sunrise,
    sunset,
  };
}
