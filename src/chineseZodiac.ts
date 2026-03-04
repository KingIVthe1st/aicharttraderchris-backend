// Chinese Zodiac calculation module

export type ChineseAnimal =
  | 'Rat' | 'Ox' | 'Tiger' | 'Rabbit' | 'Dragon' | 'Snake'
  | 'Horse' | 'Goat' | 'Monkey' | 'Rooster' | 'Dog' | 'Pig';

export type ChineseElement = 'Wood' | 'Fire' | 'Earth' | 'Metal' | 'Water';

export interface ChineseZodiacProfile {
  animal: ChineseAnimal;
  element: ChineseElement;
  allies: ChineseAnimal[];
  enemies: ChineseAnimal[];
  clashAnimal: ChineseAnimal;
}

export interface ShiChenHour {
  animal: ChineseAnimal;
  startHour: number;
  endHour: number;
  direction: string;
}

// --- Data tables ---

const ANIMALS: ChineseAnimal[] = [
  'Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake',
  'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig',
];

const ELEMENT_BY_LAST_DIGIT: Record<number, ChineseElement> = {
  0: 'Metal',
  1: 'Metal',
  2: 'Water',
  3: 'Water',
  4: 'Wood',
  5: 'Wood',
  6: 'Fire',
  7: 'Fire',
  8: 'Earth',
  9: 'Earth',
};

const ALLY_TRIANGLES: ChineseAnimal[][] = [
  ['Rat', 'Dragon', 'Monkey'],
  ['Ox', 'Snake', 'Rooster'],
  ['Tiger', 'Horse', 'Dog'],
  ['Rabbit', 'Goat', 'Pig'],
];

const CLASH_PAIRS: [ChineseAnimal, ChineseAnimal][] = [
  ['Rat', 'Horse'],
  ['Ox', 'Goat'],
  ['Tiger', 'Monkey'],
  ['Rabbit', 'Rooster'],
  ['Dragon', 'Dog'],
  ['Snake', 'Pig'],
];

const SHI_CHEN: ShiChenHour[] = [
  { animal: 'Rat',     startHour: 23, endHour: 1,  direction: 'North' },
  { animal: 'Ox',      startHour: 1,  endHour: 3,  direction: 'NNE' },
  { animal: 'Tiger',   startHour: 3,  endHour: 5,  direction: 'ENE' },
  { animal: 'Rabbit',  startHour: 5,  endHour: 7,  direction: 'East' },
  { animal: 'Dragon',  startHour: 7,  endHour: 9,  direction: 'ESE' },
  { animal: 'Snake',   startHour: 9,  endHour: 11, direction: 'SSE' },
  { animal: 'Horse',   startHour: 11, endHour: 13, direction: 'South' },
  { animal: 'Goat',    startHour: 13, endHour: 15, direction: 'SSW' },
  { animal: 'Monkey',  startHour: 15, endHour: 17, direction: 'WSW' },
  { animal: 'Rooster', startHour: 17, endHour: 19, direction: 'West' },
  { animal: 'Dog',     startHour: 19, endHour: 21, direction: 'WNW' },
  { animal: 'Pig',     startHour: 21, endHour: 23, direction: 'NNW' },
];

// --- Functions ---

export function getAnimalForYear(year: number): ChineseAnimal {
  const index = ((year - 1900) % 12 + 12) % 12;
  return ANIMALS[index];
}

export function getElementForYear(year: number): ChineseElement {
  const lastDigit = ((year % 10) + 10) % 10;
  return ELEMENT_BY_LAST_DIGIT[lastDigit];
}

function getAlliesForAnimal(animal: ChineseAnimal): ChineseAnimal[] {
  for (const triangle of ALLY_TRIANGLES) {
    if (triangle.includes(animal)) {
      return triangle.filter((a) => a !== animal);
    }
  }
  return [];
}

function getClashAnimal(animal: ChineseAnimal): ChineseAnimal {
  for (const [a, b] of CLASH_PAIRS) {
    if (a === animal) return b;
    if (b === animal) return a;
  }
  return animal; // fallback, should not happen with valid input
}

export function getChineseZodiac(birthYear: number): ChineseZodiacProfile {
  const animal = getAnimalForYear(birthYear);
  const element = getElementForYear(birthYear);
  const allies = getAlliesForAnimal(animal);
  const clashAnimal = getClashAnimal(animal);

  return {
    animal,
    element,
    allies,
    enemies: [clashAnimal],
    clashAnimal,
  };
}

export function getShiChenAnimal(hour: number): ShiChenHour {
  // Rat hour wraps: 23-01
  if (hour >= 23 || hour < 1) {
    return SHI_CHEN[0]; // Rat
  }
  for (let i = 1; i < SHI_CHEN.length; i++) {
    const sc = SHI_CHEN[i];
    if (hour >= sc.startHour && hour < sc.endHour) {
      return sc;
    }
  }
  return SHI_CHEN[0]; // fallback
}

export function getCurrentShiChen(date: Date, timezoneOffsetMinutes: number): ShiChenHour {
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const localMinutes = ((utcMinutes + timezoneOffsetMinutes) % 1440 + 1440) % 1440;
  const localHour = Math.floor(localMinutes / 60);
  return getShiChenAnimal(localHour);
}

function areAllies(a: ChineseAnimal, b: ChineseAnimal): boolean {
  for (const triangle of ALLY_TRIANGLES) {
    if (triangle.includes(a) && triangle.includes(b)) {
      return true;
    }
  }
  return false;
}

function areClash(a: ChineseAnimal, b: ChineseAnimal): boolean {
  for (const [x, y] of CLASH_PAIRS) {
    if ((x === a && y === b) || (x === b && y === a)) {
      return true;
    }
  }
  return false;
}

export function getAnimalCompatibility(
  userAnimal: ChineseAnimal,
  hourAnimal: ChineseAnimal,
): 'ally' | 'enemy' | 'clash' | 'neutral' {
  if (areClash(userAnimal, hourAnimal)) {
    return 'clash';
  }
  if (areAllies(userAnimal, hourAnimal)) {
    return 'ally';
  }
  return 'neutral';
}
