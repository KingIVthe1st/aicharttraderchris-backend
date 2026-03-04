/**
 * Soul Blueprint Computation & Storage Module
 *
 * Orchestrates numerology, astrology, and Chinese zodiac modules to compute
 * a user's full "soul blueprint" from birth data. Provides D1 database CRUD
 * operations for persisting and retrieving blueprints.
 */

import { calculateLifePath, calculateGematria, calculatePersonalYear, calculatePersonalMonth, reduceToSingleDigit } from './numerology';
import type { GematriaResult } from './numerology';
import { getSunSign, getApproximateMoonSign, getApproximateRisingSign, getPlanetaryRulerForSign } from './astrology';
import type { ZodiacSign } from './astrology';
import { getChineseZodiac } from './chineseZodiac';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface SoulBlueprintInput {
  fullName: string;
  birthDate: string;      // YYYY-MM-DD
  birthTime: string;      // HH:MM
  birthCity: string;
  birthCountry: string;
}

export interface SoulBlueprint {
  id: string;
  userId: string;
  fullName: string;
  birthDate: string;
  birthTime: string;
  birthCity: string;
  birthCountry: string;
  birthLat: number;
  birthLon: number;
  lifePath: number;
  sunSign: string;
  moonSign: string;
  risingSign: string;
  chineseAnimal: string;
  chineseElement: string;
  chineseAllies: string;    // JSON stringified array
  chineseEnemies: string;   // JSON stringified array
  planetaryRuler: string;
  alignmentNumbers: string; // JSON stringified array
  nameGematria: string;     // JSON stringified GematriaResult
  nakshatra: string;
  humanDesignType: string;
  createdAt: number;
  updatedAt: number;
}

export interface ComputedBlueprint {
  birthLat: number;
  birthLon: number;
  lifePath: number;
  sunSign: string;
  moonSign: string;
  risingSign: string;
  chineseAnimal: string;
  chineseElement: string;
  chineseAllies: string;
  chineseEnemies: string;
  planetaryRuler: string;
  alignmentNumbers: string;
  nameGematria: string;
  nakshatra: string;
  humanDesignType: string;
}

// ---------------------------------------------------------------------------
// Nakshatra mapping (simplified: one representative nakshatra per moon sign)
// ---------------------------------------------------------------------------

const NAKSHATRA_BY_MOON_SIGN: Record<string, string> = {
  Aries: 'Ashwini',
  Taurus: 'Rohini',
  Gemini: 'Mrigashira',
  Cancer: 'Pushya',
  Leo: 'Magha',
  Virgo: 'Hasta',
  Libra: 'Swati',
  Scorpio: 'Anuradha',
  Sagittarius: 'Mula',
  Capricorn: 'Shravana',
  Aquarius: 'Shatabhisha',
  Pisces: 'Revati',
};

// ---------------------------------------------------------------------------
// Human Design type mapping (simplified: based on birth month)
// ---------------------------------------------------------------------------

const HUMAN_DESIGN_BY_MONTH: Record<number, string> = {
  1: 'Generator',
  2: 'Generator',
  3: 'Manifesting Generator',
  4: 'Projector',
  5: 'Manifesting Generator',
  6: 'Generator',
  7: 'Manifestor',
  8: 'Generator',
  9: 'Projector',
  10: 'Manifesting Generator',
  11: 'Reflector',
  12: 'Projector',
};

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

/**
 * Geocode a city/country pair using the OpenStreetMap Nominatim API.
 * Returns latitude and longitude. Throws if no results are found.
 */
export async function geocodeCity(
  city: string,
  country: string,
): Promise<{ lat: number; lon: number }> {
  const url =
    `https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(city)}` +
    `&country=${encodeURIComponent(country)}&format=json&limit=1`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'CosmicTradingFusion/1.0 (soul-blueprint-geocoder)',
    },
  });

  if (!response.ok) {
    throw new Error(`Geocoding request failed with status ${response.status}`);
  }

  const results = (await response.json()) as Array<{ lat: string; lon: string }>;

  if (!results || results.length === 0) {
    throw new Error(`No geocoding results found for city="${city}", country="${country}"`);
  }

  return {
    lat: parseFloat(results[0].lat),
    lon: parseFloat(results[0].lon),
  };
}

// ---------------------------------------------------------------------------
// Compute Soul Blueprint
// ---------------------------------------------------------------------------

/**
 * Compute a full soul blueprint from birth data.
 * Calls geocoding + all cosmic computation modules.
 */
export async function computeSoulBlueprint(
  input: SoulBlueprintInput,
): Promise<ComputedBlueprint> {
  // Geocode birth location
  const { lat, lon } = await geocodeCity(input.birthCity, input.birthCountry);

  // Parse date components
  const [yearStr, monthStr, dayStr] = input.birthDate.split('-');
  const birthYear = parseInt(yearStr, 10);
  const birthMonth = parseInt(monthStr, 10);
  const birthDay = parseInt(dayStr, 10);
  const birthDate = new Date(Date.UTC(birthYear, birthMonth - 1, birthDay));

  // Numerology
  const lifePath = calculateLifePath(input.birthDate);
  const gematria = calculateGematria(input.fullName);

  // Alignment numbers: life path + prosperity codes (1, 4, 8)
  // Also include matching single digits from personal year/month
  const currentDate = new Date();
  const personalYear = calculatePersonalYear(birthMonth, birthDay, currentDate.getFullYear());
  const personalMonth = calculatePersonalMonth(personalYear, currentDate.getMonth() + 1);
  const prosperityCodes = [1, 4, 8];
  const alignmentSet = new Set<number>([lifePath]);
  for (const code of prosperityCodes) {
    alignmentSet.add(code);
  }
  // Add personal year/month digits if they match prosperity codes
  if (prosperityCodes.includes(reduceToSingleDigit(personalYear))) {
    alignmentSet.add(reduceToSingleDigit(personalYear));
  }
  if (prosperityCodes.includes(reduceToSingleDigit(personalMonth))) {
    alignmentSet.add(reduceToSingleDigit(personalMonth));
  }
  const alignmentNumbers = Array.from(alignmentSet).sort((a, b) => a - b);

  // Astrology
  const sunSign = getSunSign(birthMonth, birthDay);
  const moonSign = getApproximateMoonSign(birthDate);
  const risingSign = getApproximateRisingSign(input.birthDate, input.birthTime, lat);
  const planetaryRuler = getPlanetaryRulerForSign(risingSign);

  // Chinese Zodiac
  const chineseProfile = getChineseZodiac(birthYear);

  // Nakshatra (simplified from moon sign)
  const nakshatra = NAKSHATRA_BY_MOON_SIGN[moonSign] || 'Ashwini';

  // Human Design type (simplified from birth month)
  const humanDesignType = HUMAN_DESIGN_BY_MONTH[birthMonth] || 'Generator';

  return {
    birthLat: lat,
    birthLon: lon,
    lifePath,
    sunSign,
    moonSign,
    risingSign,
    chineseAnimal: chineseProfile.animal,
    chineseElement: chineseProfile.element,
    chineseAllies: JSON.stringify(chineseProfile.allies),
    chineseEnemies: JSON.stringify(chineseProfile.enemies),
    planetaryRuler,
    alignmentNumbers: JSON.stringify(alignmentNumbers),
    nameGematria: JSON.stringify(gematria),
    nakshatra,
    humanDesignType,
  };
}

// ---------------------------------------------------------------------------
// D1 Database Operations
// ---------------------------------------------------------------------------

/**
 * Save a new soul blueprint to the database.
 * Also marks the user as having a soul blueprint.
 */
export async function saveSoulBlueprint(
  db: D1Database,
  userId: string,
  input: SoulBlueprintInput,
  computed: ComputedBlueprint,
): Promise<SoulBlueprint> {
  const id = crypto.randomUUID();
  const now = Date.now();

  const blueprint: SoulBlueprint = {
    id,
    userId,
    fullName: input.fullName,
    birthDate: input.birthDate,
    birthTime: input.birthTime,
    birthCity: input.birthCity,
    birthCountry: input.birthCountry,
    birthLat: computed.birthLat,
    birthLon: computed.birthLon,
    lifePath: computed.lifePath,
    sunSign: computed.sunSign,
    moonSign: computed.moonSign,
    risingSign: computed.risingSign,
    chineseAnimal: computed.chineseAnimal,
    chineseElement: computed.chineseElement,
    chineseAllies: computed.chineseAllies,
    chineseEnemies: computed.chineseEnemies,
    planetaryRuler: computed.planetaryRuler,
    alignmentNumbers: computed.alignmentNumbers,
    nameGematria: computed.nameGematria,
    nakshatra: computed.nakshatra,
    humanDesignType: computed.humanDesignType,
    createdAt: now,
    updatedAt: now,
  };

  await db
    .prepare(
      `INSERT INTO soul_blueprints (
        id, user_id, full_name, birth_date, birth_time, birth_city, birth_country,
        birth_lat, birth_lon, life_path, sun_sign, moon_sign, rising_sign,
        chinese_animal, chinese_element, chinese_allies, chinese_enemies,
        planetary_ruler, alignment_numbers, name_gematria, nakshatra,
        human_design_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      blueprint.id,
      blueprint.userId,
      blueprint.fullName,
      blueprint.birthDate,
      blueprint.birthTime,
      blueprint.birthCity,
      blueprint.birthCountry,
      blueprint.birthLat,
      blueprint.birthLon,
      blueprint.lifePath,
      blueprint.sunSign,
      blueprint.moonSign,
      blueprint.risingSign,
      blueprint.chineseAnimal,
      blueprint.chineseElement,
      blueprint.chineseAllies,
      blueprint.chineseEnemies,
      blueprint.planetaryRuler,
      blueprint.alignmentNumbers,
      blueprint.nameGematria,
      blueprint.nakshatra,
      blueprint.humanDesignType,
      blueprint.createdAt,
      blueprint.updatedAt,
    )
    .run();

  // Mark user as having a soul blueprint
  await db
    .prepare('UPDATE users SET has_soul_blueprint = 1 WHERE id = ?')
    .bind(userId)
    .run();

  return blueprint;
}

/**
 * Retrieve a soul blueprint by user ID.
 * Returns null if no blueprint exists for the user.
 */
export async function getSoulBlueprint(
  db: D1Database,
  userId: string,
): Promise<SoulBlueprint | null> {
  const result = await db
    .prepare('SELECT * FROM soul_blueprints WHERE user_id = ?')
    .bind(userId)
    .first<Record<string, unknown>>();

  if (!result) return null;

  return mapRowToBlueprint(result);
}

/**
 * Update an existing soul blueprint for a user.
 * Returns the updated blueprint.
 */
export async function updateSoulBlueprint(
  db: D1Database,
  userId: string,
  input: SoulBlueprintInput,
  computed: ComputedBlueprint,
): Promise<SoulBlueprint> {
  const now = Date.now();

  await db
    .prepare(
      `UPDATE soul_blueprints SET
        full_name = ?, birth_date = ?, birth_time = ?, birth_city = ?, birth_country = ?,
        birth_lat = ?, birth_lon = ?, life_path = ?, sun_sign = ?, moon_sign = ?,
        rising_sign = ?, chinese_animal = ?, chinese_element = ?, chinese_allies = ?,
        chinese_enemies = ?, planetary_ruler = ?, alignment_numbers = ?, name_gematria = ?,
        nakshatra = ?, human_design_type = ?, updated_at = ?
      WHERE user_id = ?`,
    )
    .bind(
      input.fullName,
      input.birthDate,
      input.birthTime,
      input.birthCity,
      input.birthCountry,
      computed.birthLat,
      computed.birthLon,
      computed.lifePath,
      computed.sunSign,
      computed.moonSign,
      computed.risingSign,
      computed.chineseAnimal,
      computed.chineseElement,
      computed.chineseAllies,
      computed.chineseEnemies,
      computed.planetaryRuler,
      computed.alignmentNumbers,
      computed.nameGematria,
      computed.nakshatra,
      computed.humanDesignType,
      now,
      userId,
    )
    .run();

  // Fetch and return the updated record
  const updated = await getSoulBlueprint(db, userId);
  if (!updated) {
    throw new Error(`Soul blueprint not found for user ${userId} after update`);
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a D1 row (snake_case columns) to a SoulBlueprint object (camelCase).
 */
function mapRowToBlueprint(row: Record<string, unknown>): SoulBlueprint {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    fullName: row.full_name as string,
    birthDate: row.birth_date as string,
    birthTime: row.birth_time as string,
    birthCity: row.birth_city as string,
    birthCountry: row.birth_country as string,
    birthLat: row.birth_lat as number,
    birthLon: row.birth_lon as number,
    lifePath: row.life_path as number,
    sunSign: row.sun_sign as string,
    moonSign: row.moon_sign as string,
    risingSign: row.rising_sign as string,
    chineseAnimal: row.chinese_animal as string,
    chineseElement: row.chinese_element as string,
    chineseAllies: row.chinese_allies as string,
    chineseEnemies: row.chinese_enemies as string,
    planetaryRuler: row.planetary_ruler as string,
    alignmentNumbers: row.alignment_numbers as string,
    nameGematria: row.name_gematria as string,
    nakshatra: row.nakshatra as string,
    humanDesignType: row.human_design_type as string,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}
