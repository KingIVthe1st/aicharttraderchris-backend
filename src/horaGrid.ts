/**
 * Cross-Civilization Hora Grid Module
 *
 * Assembles 4 ancient timing layers (Vedic, Babylonian, Egyptian, Chinese)
 * and classifies each hour into a node type for trading guidance.
 */

import type { PlanetaryHour } from './planetaryHours';
import { getPlanetaryHours, isPlanetaryAlly, isPlanetaryEnemy } from './planetaryHours';
import type { Planet } from './astrology';
import type { ChineseAnimal } from './chineseZodiac';
import { getShiChenAnimal, getAnimalCompatibility } from './chineseZodiac';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NodeType =
  | 'ULTRA_ALIGNED'
  | 'HIGH_PRESSURE'
  | 'SOUL_WINDOW'
  | 'MIXED'
  | 'CONFLICT'
  | 'DISRUPTION'
  | 'U_NODE';

export interface HoraGridHour {
  startTime: string;
  endTime: string;
  vedic: { planet: string; isAlly: boolean; isEnemy: boolean };
  babylonian: { sequencePosition: number; planet: string };
  egyptian: { decanNumber: number; energy: 'structure' | 'disruption' | 'flow' };
  chinese: { animal: string; compatibility: 'ally' | 'enemy' | 'clash' | 'neutral' };
  nodeType: NodeType;
  nodeScore: number;
  portalWindow: { start: string; end: string };
  tradingGuidance: string;
}

export interface HoraGrid {
  date: string;
  timezone: string;
  hours: HoraGridHour[];
  currentHourIndex: number;
  bestWindows: HoraGridHour[];
  worstWindows: HoraGridHour[];
}

// ---------------------------------------------------------------------------
// Node Score Map
// ---------------------------------------------------------------------------

const NODE_SCORES: Record<NodeType, number> = {
  ULTRA_ALIGNED: 95,
  HIGH_PRESSURE: 80,
  SOUL_WINDOW: 75,
  MIXED: 50,
  U_NODE: 30,
  CONFLICT: 15,
  DISRUPTION: 10,
};

// ---------------------------------------------------------------------------
// Classification Functions
// ---------------------------------------------------------------------------

/**
 * Classify a single hour into a NodeType based on multi-civilization alignment.
 */
export function classifyNode(
  vedicAlly: boolean,
  vedicEnemy: boolean,
  egyptianEnergy: 'structure' | 'disruption' | 'flow',
  chineseCompat: 'ally' | 'enemy' | 'clash' | 'neutral',
): NodeType {
  const isEgyptianPositive = egyptianEnergy === 'structure';
  const isChinesePositive = chineseCompat === 'ally';
  const isChineseNegative = chineseCompat === 'clash' || chineseCompat === 'enemy';
  const isEgyptianNegative = egyptianEnergy === 'disruption';

  // ULTRA_ALIGNED: all three positive layers align
  if (vedicAlly && isEgyptianPositive && isChinesePositive) {
    return 'ULTRA_ALIGNED';
  }

  // CONFLICT: vedic enemy + chinese clash/enemy
  if (vedicEnemy && isChineseNegative) {
    return 'CONFLICT';
  }

  // DISRUPTION: egyptian disruption + any enemy signal
  if (isEgyptianNegative && (vedicEnemy || isChineseNegative)) {
    return 'DISRUPTION';
  }

  // U_NODE: all 3 layers show tension
  if (vedicEnemy && isEgyptianNegative && isChineseNegative) {
    return 'U_NODE';
  }

  // SOUL_WINDOW: vedic ally + chinese ally (regardless of egyptian)
  if (vedicAlly && isChinesePositive) {
    return 'SOUL_WINDOW';
  }

  // HIGH_PRESSURE: 2 of 3 positive
  const positiveCount = [vedicAlly, isEgyptianPositive, isChinesePositive].filter(Boolean).length;
  if (positiveCount >= 2) {
    return 'HIGH_PRESSURE';
  }

  // MIXED: at least 1 positive and 1 negative
  const hasPositive = vedicAlly || isEgyptianPositive || isChinesePositive;
  const hasNegative = vedicEnemy || isEgyptianNegative || isChineseNegative;
  if (hasPositive && hasNegative) {
    return 'MIXED';
  }

  // Default fallback
  return 'MIXED';
}

// ---------------------------------------------------------------------------
// Egyptian Decan Energy
// ---------------------------------------------------------------------------

/**
 * Simplified Egyptian decan energy.
 * Hours 1-4: structure, 5-8: flow, 9-12: disruption,
 * 13-16: structure, 17-20: flow, 21-24: disruption.
 */
export function getEgyptianDecanEnergy(hourNumber: number): {
  decanNumber: number;
  energy: 'structure' | 'disruption' | 'flow';
} {
  // Normalise hourNumber to 1-24
  const h = ((hourNumber - 1) % 24) + 1;

  // Which group of 4 (0-indexed)
  const group = Math.floor((h - 1) / 4);
  const cycle: Array<'structure' | 'flow' | 'disruption'> = [
    'structure',
    'flow',
    'disruption',
  ];
  const energy = cycle[group % 3];

  // Decan number cycles 1-36 (simplified: use hour-based mapping)
  const decanNumber = ((h - 1) % 36) + 1;

  return { decanNumber, energy };
}

// ---------------------------------------------------------------------------
// Trading Guidance
// ---------------------------------------------------------------------------

/**
 * Generate brief trading guidance text for a classified hour.
 */
export function generateTradingGuidance(
  nodeType: NodeType,
  planet: string,
  chineseCompat: string,
): string {
  switch (nodeType) {
    case 'ULTRA_ALIGNED':
      return `Prime entry window — highest confidence (${planet} hour)`;
    case 'HIGH_PRESSURE':
      return `Strong action window — proceed with confidence (${planet} hour)`;
    case 'SOUL_WINDOW':
      return `Personal alignment window — trust your instincts (${planet} hour)`;
    case 'MIXED':
      return `Mixed signals — reduce position size (${planet} hour, ${chineseCompat} energy)`;
    case 'CONFLICT':
      return `Avoid trading — inversion risk high (${planet} hour)`;
    case 'DISRUPTION':
      return `Expect the unexpected — sit out or hedge (${planet} hour)`;
    case 'U_NODE':
      return `Major shift point — observe before acting (${planet} hour)`;
    default:
      return `Evaluate carefully (${planet} hour)`;
  }
}

// ---------------------------------------------------------------------------
// Hora Grid Builder
// ---------------------------------------------------------------------------

/**
 * Build the complete Cross-Civilization Hora Grid for a given date and location.
 */
export function buildHoraGrid(
  date: Date,
  timezone: string,
  lat: number,
  lon: number,
  userPlanetaryRuler: Planet,
  userChineseAnimal: ChineseAnimal,
): HoraGrid {
  // Get all 24 planetary hours from the Vedic/Chaldean system
  const planetaryHourMap = getPlanetaryHours(lat, lon, date, userPlanetaryRuler);

  // Reconstruct the full 24-hour list from currentHour + nextHours
  // getPlanetaryHours returns currentHour and nextHours sliced from the full array.
  // We need to rebuild the full array by going back before currentHour.
  // The currentHour.hourNumber tells us its 1-based position.
  const currentHour = planetaryHourMap.currentHour;
  const nextHours = planetaryHourMap.nextHours;

  // Build the available hours list: current + remaining
  const availablePlanetaryHours: PlanetaryHour[] = [currentHour, ...nextHours];

  // We need all 24 hours. Since getPlanetaryHours only gives us current + next,
  // we need to call it fresh with a date set to the start of the day.
  // Re-invoke with a reference time that covers the whole day.
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const fullDayMap = getPlanetaryHours(lat, lon, dayStart, userPlanetaryRuler);

  // Reconstruct all hours: the function internally builds 24 hours then slices.
  // We'll use the currentHour (which at midnight would be early) + nextHours.
  const allPlanetaryHours: PlanetaryHour[] = [
    fullDayMap.currentHour,
    ...fullDayMap.nextHours,
  ];

  const now = new Date();
  let currentHourIndex = 0;

  const horaGridHours: HoraGridHour[] = allPlanetaryHours.map((ph, index) => {
    // Determine if this is the current hour
    if (now.getTime() >= ph.startTime.getTime() && now.getTime() < ph.endTime.getTime()) {
      currentHourIndex = index;
    }

    // Vedic layer
    const vedicAlly = isPlanetaryAlly(userPlanetaryRuler, ph.planet);
    const vedicEnemy = isPlanetaryEnemy(userPlanetaryRuler, ph.planet);

    // Babylonian layer: sequence position is the hour number
    const babylonianPosition = ph.hourNumber;

    // Egyptian layer
    const egyptian = getEgyptianDecanEnergy(ph.hourNumber);

    // Chinese layer: get the Shi Chen animal for the midpoint of this hour
    const midpointMs = (ph.startTime.getTime() + ph.endTime.getTime()) / 2;
    const midpoint = new Date(midpointMs);
    const midpointHourUTC = midpoint.getUTCHours();
    const shiChen = getShiChenAnimal(midpointHourUTC);
    const chineseCompat = getAnimalCompatibility(userChineseAnimal, shiChen.animal);

    // Classify the node
    const nodeType = classifyNode(vedicAlly, vedicEnemy, egyptian.energy, chineseCompat);
    const nodeScore = NODE_SCORES[nodeType];

    // Trading guidance
    const tradingGuidance = generateTradingGuidance(nodeType, ph.planet, chineseCompat);

    return {
      startTime: ph.startTime.toISOString(),
      endTime: ph.endTime.toISOString(),
      vedic: { planet: ph.planet, isAlly: vedicAlly, isEnemy: vedicEnemy },
      babylonian: { sequencePosition: babylonianPosition, planet: ph.planet },
      egyptian: { decanNumber: egyptian.decanNumber, energy: egyptian.energy },
      chinese: { animal: shiChen.animal, compatibility: chineseCompat },
      nodeType,
      nodeScore,
      portalWindow: {
        start: ph.portalWindow.start.toISOString(),
        end: ph.portalWindow.end.toISOString(),
      },
      tradingGuidance,
    };
  });

  // Best windows: top 3 by nodeScore (descending), then by index for stability
  const sortedByScoreDesc = [...horaGridHours]
    .map((h, i) => ({ hour: h, originalIndex: i }))
    .sort((a, b) => b.hour.nodeScore - a.hour.nodeScore || a.originalIndex - b.originalIndex);
  const bestWindows = sortedByScoreDesc.slice(0, 3).map((e) => e.hour);

  // Worst windows: bottom 3 by nodeScore (ascending)
  const sortedByScoreAsc = [...horaGridHours]
    .map((h, i) => ({ hour: h, originalIndex: i }))
    .sort((a, b) => a.hour.nodeScore - b.hour.nodeScore || a.originalIndex - b.originalIndex);
  const worstWindows = sortedByScoreAsc.slice(0, 3).map((e) => e.hour);

  return {
    date: date.toISOString(),
    timezone,
    hours: horaGridHours,
    currentHourIndex,
    bestWindows,
    worstWindows,
  };
}
