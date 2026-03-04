/**
 * Numerology Calculation Module
 *
 * Provides numerological calculations including life path numbers,
 * personal cycles, universal day numbers, and gematria analysis.
 * Pure math — no external dependencies.
 */

export interface NumerologyProfile {
  lifePath: number;
  personalYear: number;
  personalMonth: number;
  personalDay: number;
  universalDay: number;
  isAlignmentDay: boolean;
  alignmentNumbers: number[];
}

export interface GematriaResult {
  ordinal: number;
  reduction: number;
  reverseOrdinal: number;
  reverseReduction: number;
}

/**
 * Reduce a number to a single digit (1-9) by summing its digits repeatedly.
 * If preserveMaster is true, stops at 11, 22, or 33.
 */
export function reduceToSingleDigit(num: number, preserveMaster = false): number {
  num = Math.abs(num);
  while (num > 9) {
    if (preserveMaster && (num === 11 || num === 22 || num === 33)) {
      return num;
    }
    let sum = 0;
    while (num > 0) {
      sum += num % 10;
      num = Math.floor(num / 10);
    }
    num = sum;
  }
  return num;
}

/**
 * Calculate the Life Path number from a birth date string "YYYY-MM-DD".
 * Reduces month, day, and year separately, then sums and reduces.
 * Preserves master numbers (11, 22, 33).
 */
export function calculateLifePath(birthDate: string): number {
  const [yearStr, monthStr, dayStr] = birthDate.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  const reducedMonth = reduceToSingleDigit(month, true);
  const reducedDay = reduceToSingleDigit(day, true);
  const reducedYear = reduceToSingleDigit(year, true);

  const total = reducedMonth + reducedDay + reducedYear;
  return reduceToSingleDigit(total, true);
}

/**
 * Calculate the Personal Year number.
 * Sum: birthMonth + birthDay + currentYear, reduced to single digit.
 */
export function calculatePersonalYear(
  birthMonth: number,
  birthDay: number,
  currentYear: number
): number {
  const sum = birthMonth + birthDay + currentYear;
  return reduceToSingleDigit(sum);
}

/**
 * Calculate the Personal Month number.
 * Sum: personalYear + currentMonth, reduced to single digit.
 */
export function calculatePersonalMonth(personalYear: number, currentMonth: number): number {
  const sum = personalYear + currentMonth;
  return reduceToSingleDigit(sum);
}

/**
 * Calculate the Personal Day number.
 * Sum: personalMonth + currentDay, reduced to single digit.
 */
export function calculatePersonalDay(personalMonth: number, currentDay: number): number {
  const sum = personalMonth + currentDay;
  return reduceToSingleDigit(sum);
}

/**
 * Calculate the Universal Day number by summing all digits of YYYYMMDD.
 */
export function calculateUniversalDay(date: Date): number {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const dateStr = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
  let sum = 0;
  for (const ch of dateStr) {
    sum += parseInt(ch, 10);
  }
  return reduceToSingleDigit(sum);
}

/**
 * Calculate gematria values for a name/string.
 * - Ordinal: A=1..Z=26, sum all letters
 * - Reduction: reduce each letter value to 1-9 before summing, then reduce total
 * - Reverse Ordinal: A=26..Z=1, sum all letters
 * - Reverse Reduction: reduce each reverse value to 1-9, sum, reduce total
 */
export function calculateGematria(name: string): GematriaResult {
  const upper = name.toUpperCase();
  let ordinal = 0;
  let reduction = 0;
  let reverseOrdinal = 0;
  let reverseReduction = 0;

  for (const ch of upper) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) continue; // skip non-alpha

    const letterVal = code - 64; // A=1, B=2...Z=26
    const reverseVal = 27 - letterVal; // A=26, B=25...Z=1

    ordinal += letterVal;
    reduction += reduceToSingleDigit(letterVal);
    reverseOrdinal += reverseVal;
    reverseReduction += reduceToSingleDigit(reverseVal);
  }

  return {
    ordinal,
    reduction: reduceToSingleDigit(reduction),
    reverseOrdinal,
    reverseReduction: reduceToSingleDigit(reverseReduction),
  };
}

/**
 * Returns true if the number is a prosperity alignment code (1, 4, or 8).
 */
export function isAlignmentNumber(num: number): boolean {
  return num === 1 || num === 4 || num === 8;
}

/**
 * Assemble a full numerology profile from a birth date and the current date.
 */
export function getNumerologyProfile(birthDate: string, currentDate: Date): NumerologyProfile {
  const [, monthStr, dayStr] = birthDate.split('-');
  const birthMonth = parseInt(monthStr, 10);
  const birthDay = parseInt(dayStr, 10);

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;
  const currentDay = currentDate.getDate();

  const lifePath = calculateLifePath(birthDate);
  const personalYear = calculatePersonalYear(birthMonth, birthDay, currentYear);
  const personalMonth = calculatePersonalMonth(personalYear, currentMonth);
  const personalDay = calculatePersonalDay(personalMonth, currentDay);
  const universalDay = calculateUniversalDay(currentDate);

  // Alignment numbers: life path + prosperity codes [1, 4, 8], deduplicated
  const alignmentSet = new Set([lifePath, 1, 4, 8]);
  const alignmentNumbers = Array.from(alignmentSet).sort((a, b) => a - b);

  const isAlignmentDay =
    alignmentNumbers.includes(universalDay) || alignmentNumbers.includes(personalDay);

  return {
    lifePath,
    personalYear,
    personalMonth,
    personalDay,
    universalDay,
    isAlignmentDay,
    alignmentNumbers,
  };
}
