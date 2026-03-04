/**
 * Astrology Calculation Module
 *
 * Provides astrological calculations including sun signs, moon phases,
 * planetary rulers, rising signs, and void-of-course status.
 * Pure math — no external dependencies.
 */

export type ZodiacSign =
  | 'Aries'
  | 'Taurus'
  | 'Gemini'
  | 'Cancer'
  | 'Leo'
  | 'Virgo'
  | 'Libra'
  | 'Scorpio'
  | 'Sagittarius'
  | 'Capricorn'
  | 'Aquarius'
  | 'Pisces';

export type MoonPhaseName =
  | 'New Moon'
  | 'Waxing Crescent'
  | 'First Quarter'
  | 'Waxing Gibbous'
  | 'Full Moon'
  | 'Waning Gibbous'
  | 'Last Quarter'
  | 'Waning Crescent';

export type Planet = 'Sun' | 'Moon' | 'Mars' | 'Mercury' | 'Jupiter' | 'Venus' | 'Saturn';

export interface MoonPhase {
  phase: MoonPhaseName;
  illumination: number;
  isWaxing: boolean;
  daysInCycle: number;
  isFavorableForEntry: boolean;
}

export interface VOCStatus {
  isVoid: boolean;
  message: string;
}

export interface DayRuler {
  planet: Planet;
  energy: string;
  description: string;
}

/** Ordered list of zodiac signs starting from Aries. */
const ZODIAC_SIGNS: ZodiacSign[] = [
  'Aries',
  'Taurus',
  'Gemini',
  'Cancer',
  'Leo',
  'Virgo',
  'Libra',
  'Scorpio',
  'Sagittarius',
  'Capricorn',
  'Aquarius',
  'Pisces',
];

/** Synodic month length in days. */
const SYNODIC_MONTH = 29.53058770576;

/** Known new moon reference: January 6, 2000 at 18:14 UTC. */
const NEW_MOON_REFERENCE = Date.UTC(2000, 0, 6, 18, 14, 0);

/** Sidereal month length in days (for moon sign calculation). */
const SIDEREAL_MONTH = 27.3;

/** Degrees the moon travels per day. */
const MOON_DEGREES_PER_DAY = 360 / SIDEREAL_MONTH; // ~13.176

/** Degrees per zodiac sign. */
const DEGREES_PER_SIGN = 30;

/**
 * Get the sun sign for a given month and day.
 */
export function getSunSign(month: number, day: number): ZodiacSign {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Invalid date: month=${month}, day=${day}`);
  }

  // Encode as month * 100 + day for easy range comparison
  const md = month * 100 + day;

  if (md >= 321 && md <= 419) return 'Aries';
  if (md >= 420 && md <= 520) return 'Taurus';
  if (md >= 521 && md <= 620) return 'Gemini';
  if (md >= 621 && md <= 722) return 'Cancer';
  if (md >= 723 && md <= 822) return 'Leo';
  if (md >= 823 && md <= 922) return 'Virgo';
  if (md >= 923 && md <= 1022) return 'Libra';
  if (md >= 1023 && md <= 1121) return 'Scorpio';
  if (md >= 1122 && md <= 1221) return 'Sagittarius';
  if (md >= 1222 || md <= 119) return 'Capricorn';
  if (md >= 120 && md <= 218) return 'Aquarius';
  // Feb 19 - Mar 20
  return 'Pisces';
}

/**
 * Calculate the current moon phase for a given date.
 * Uses the synodic month algorithm with a known new moon reference point.
 */
export function getMoonPhase(date: Date): MoonPhase {
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysSinceReference = (date.getTime() - NEW_MOON_REFERENCE) / msPerDay;

  // Position in the current lunation cycle
  let daysInCycle = daysSinceReference % SYNODIC_MONTH;
  if (daysInCycle < 0) daysInCycle += SYNODIC_MONTH;

  // Determine phase name
  let phase: MoonPhaseName;
  if (daysInCycle < 1.85) {
    phase = 'New Moon';
  } else if (daysInCycle < 7.38) {
    phase = 'Waxing Crescent';
  } else if (daysInCycle < 9.23) {
    phase = 'First Quarter';
  } else if (daysInCycle < 14.77) {
    phase = 'Waxing Gibbous';
  } else if (daysInCycle < 16.61) {
    phase = 'Full Moon';
  } else if (daysInCycle < 22.15) {
    phase = 'Waning Gibbous';
  } else if (daysInCycle < 24.0) {
    phase = 'Last Quarter';
  } else {
    phase = 'Waning Crescent';
  }

  const isWaxing = daysInCycle < 14.765;

  // Approximate illumination using a sin function
  // 0 at new moon (cycle start), 1 at full moon (half cycle)
  const illumination = Math.round(
    (1 - Math.cos((2 * Math.PI * daysInCycle) / SYNODIC_MONTH)) / 2 * 100
  ) / 100;

  return {
    phase,
    illumination,
    isWaxing,
    daysInCycle: Math.round(daysInCycle * 100) / 100,
    isFavorableForEntry: isWaxing,
  };
}

/**
 * Get the planetary ruler and energy description for a given day.
 */
export function getDayRuler(date: Date): DayRuler {
  const dayOfWeek = date.getDay(); // 0=Sunday .. 6=Saturday

  const rulers: DayRuler[] = [
    { planet: 'Sun', energy: 'Illumination', description: 'Illumination, clarity, confidence' },
    { planet: 'Moon', energy: 'Emotional liquidity', description: 'Emotional liquidity, reversals, introspection' },
    { planet: 'Mars', energy: 'Aggression', description: 'Aggression, breakout energy, volatility' },
    { planet: 'Mercury', energy: 'Range', description: 'Range, balance, scalping opportunities' },
    { planet: 'Jupiter', energy: 'Expansion', description: 'Expansion, trending moves, optimism' },
    { planet: 'Venus', energy: 'Pullbacks', description: 'Pullbacks, harmony, profit-taking energy' },
    { planet: 'Saturn', energy: 'Slow grind', description: 'Slow grind, discipline, structure, compression' },
  ];

  return rulers[dayOfWeek];
}

/**
 * Get the traditional planetary ruler for a zodiac sign.
 */
export function getPlanetaryRulerForSign(sign: ZodiacSign): Planet {
  const rulerMap: Record<ZodiacSign, Planet> = {
    Aries: 'Mars',
    Taurus: 'Venus',
    Gemini: 'Mercury',
    Cancer: 'Moon',
    Leo: 'Sun',
    Virgo: 'Mercury',
    Libra: 'Venus',
    Scorpio: 'Mars',
    Sagittarius: 'Jupiter',
    Capricorn: 'Saturn',
    Aquarius: 'Saturn',
    Pisces: 'Jupiter',
  };

  return rulerMap[sign];
}

/**
 * Get an approximate moon sign for a given date.
 * Uses a known reference point (Jan 1, 2025 = Cancer) and advances
 * through signs at ~13.176 degrees/day.
 */
export function getApproximateMoonSign(date: Date): ZodiacSign {
  // Reference: January 1, 2025 00:00 UTC, Moon in Cancer (index 3)
  const referenceDate = Date.UTC(2025, 0, 1, 0, 0, 0);
  const referenceSignIndex = 3; // Cancer

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysSinceReference = (date.getTime() - referenceDate) / msPerDay;

  // Total degrees traveled since reference
  const totalDegrees = daysSinceReference * MOON_DEGREES_PER_DAY;

  // Number of signs advanced (each sign = 30 degrees)
  const signsAdvanced = Math.floor(totalDegrees / DEGREES_PER_SIGN);

  // Calculate current sign index, wrapping around the 12-sign zodiac
  let signIndex = (referenceSignIndex + signsAdvanced) % 12;
  if (signIndex < 0) signIndex += 12;

  return ZODIAC_SIGNS[signIndex];
}

/**
 * Get an approximate rising sign (ascendant) based on birth date, time, and latitude.
 * Simplified calculation: rising sign = sun sign at sunrise, advancing ~1 sign
 * per 2 hours of birth time offset from sunrise (~6 AM local).
 */
export function getApproximateRisingSign(
  birthDate: string,
  birthTime: string,
  birthLat: number
): ZodiacSign {
  // Parse birth date
  const [year, month, day] = birthDate.split('-').map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid birthDate format: ${birthDate}. Expected YYYY-MM-DD.`);
  }

  // Parse birth time
  const [hours, minutes] = birthTime.split(':').map(Number);
  if (hours === undefined || minutes === undefined || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid birthTime format: ${birthTime}. Expected HH:MM.`);
  }

  // Get the sun sign for the birth date
  const sunSign = getSunSign(month, day);
  const sunSignIndex = ZODIAC_SIGNS.indexOf(sunSign);

  // Calculate hours since approximate sunrise (6 AM)
  const birthHourDecimal = hours + minutes / 60;
  const hoursSinceSunrise = birthHourDecimal - 6;

  // Advance 1 sign per 2 hours
  const signsAdvanced = Math.floor(hoursSinceSunrise / 2);

  // Apply latitude adjustment: further from equator shifts slightly
  // This is a very rough approximation
  const latAdjustment = Math.abs(birthLat) > 45 ? 1 : 0;

  let risingIndex = (sunSignIndex + signsAdvanced + latAdjustment) % 12;
  if (risingIndex < 0) risingIndex += 12;

  return ZODIAC_SIGNS[risingIndex];
}

/**
 * Get the Void-of-Course Moon status for a given date.
 * Simplified for MVP — returns a placeholder. Can be enhanced later
 * with actual VOC data stored in KV.
 */
export function getVOCStatus(date: Date): VOCStatus {
  return {
    isVoid: false,
    message: 'VOC data requires monthly schedule update',
  };
}
