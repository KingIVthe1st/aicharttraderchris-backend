/**
 * NEO 17-Point Scoring Engine
 *
 * Evaluates 17 cosmic alignment factors to produce a single NEO score
 * that classifies the current trading window as ULTRA_GREEN, GREEN,
 * YELLOW, or RED. Each factor scores 0 (fail) or 1 (pass).
 */

import type { NumerologyProfile } from './numerology';
import type { MoonPhase, VOCStatus } from './astrology';
import type { PlanetaryHour } from './planetaryHours';
import type { ChineseZodiacProfile, ShiChenHour } from './chineseZodiac';
import type { EnvironmentalEnergy } from './environmentalEnergy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NEOClassification = 'ULTRA_GREEN' | 'GREEN' | 'YELLOW' | 'RED';

export interface NEOFactor {
  id: number;
  name: string;
  score: number; // 0 or 1
  automated: boolean;
  reasoning: string;
}

export interface NEOScore {
  total: number;
  classification: NEOClassification;
  factors: NEOFactor[];
  tradingRecommendation: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

function classify(total: number): NEOClassification {
  if (total >= 14) return 'ULTRA_GREEN';
  if (total >= 12) return 'GREEN';
  if (total >= 9) return 'YELLOW';
  return 'RED';
}

const TRADING_RECOMMENDATIONS: Record<NEOClassification, string> = {
  ULTRA_GREEN:
    'Strongest alignment \u2014 trade with full confidence. All systems go.',
  GREEN:
    'Favorable alignment \u2014 good conditions for trading. Proceed with standard size.',
  YELLOW:
    'Neutral alignment \u2014 exercise caution. Reduce position size or wait for better window.',
  RED:
    'Poor alignment \u2014 avoid trading today. Rest and prepare for next opportunity.',
};

// ---------------------------------------------------------------------------
// Factor evaluators
// ---------------------------------------------------------------------------

function factor1_NumerologyAlignment(numerology: NumerologyProfile): NEOFactor {
  const pass = [1, 4, 8].includes(numerology.universalDay);
  return {
    id: 1,
    name: 'Numerology Alignment',
    score: pass ? 1 : 0,
    automated: true,
    reasoning: pass
      ? `Universal day ${numerology.universalDay} is a prosperity number (1, 4, or 8).`
      : `Universal day ${numerology.universalDay} is not in the prosperity set [1, 4, 8].`,
  };
}

function factor2_Letterology(): NEOFactor {
  return {
    id: 2,
    name: 'Letterology / Ticker',
    score: 1,
    automated: false,
    reasoning: 'Default pass for MVP. Pre-coded ticker analysis can be added later.',
  };
}

function factor3_WesternAstrology(moonPhase: MoonPhase): NEOFactor {
  const pass = moonPhase.isFavorableForEntry;
  return {
    id: 3,
    name: 'Western Astrology',
    score: pass ? 1 : 0,
    automated: true,
    reasoning: pass
      ? `Moon is waxing (${moonPhase.phase}) \u2014 favorable for entry.`
      : `Moon is waning (${moonPhase.phase}) \u2014 not favorable for entry.`,
  };
}

function factor4_ChineseZodiacHarmony(
  chineseProfile: ChineseZodiacProfile,
  currentShiChen: ShiChenHour,
): NEOFactor {
  const hourAnimal = currentShiChen.animal;
  const isClash = chineseProfile.clashAnimal === hourAnimal;
  const isEnemy = chineseProfile.enemies.includes(hourAnimal);
  const pass = !isClash && !isEnemy;
  return {
    id: 4,
    name: 'Chinese Zodiac Harmony',
    score: pass ? 1 : 0,
    automated: true,
    reasoning: pass
      ? `Current Shi Chen animal (${hourAnimal}) is compatible with user animal (${chineseProfile.animal}).`
      : `Current Shi Chen animal (${hourAnimal}) clashes with or is an enemy of user animal (${chineseProfile.animal}).`,
  };
}

function factor5_Gematria(): NEOFactor {
  return {
    id: 5,
    name: 'Gematria',
    score: 1,
    automated: false,
    reasoning: 'Default pass for MVP. Gematria ticker analysis can be added later.',
  };
}

function factor6_MoonPhaseVOC(moonPhase: MoonPhase, vocStatus: VOCStatus): NEOFactor {
  const isFullMoon = moonPhase.phase === 'Full Moon';
  const pass = !vocStatus.isVoid && (moonPhase.isWaxing || isFullMoon);
  return {
    id: 6,
    name: 'Moon Phase & VOC',
    score: pass ? 1 : 0,
    automated: true,
    reasoning: pass
      ? `Moon is ${moonPhase.phase}, not void-of-course \u2014 favorable.`
      : vocStatus.isVoid
        ? 'Moon is void-of-course \u2014 avoid new entries.'
        : `Moon is ${moonPhase.phase} (waning) \u2014 not ideal for new positions.`,
  };
}

function factor7_EnvironmentalEnergy(environmental: EnvironmentalEnergy): NEOFactor {
  const pass = environmental.overallStatus === 'green' || environmental.kIndex < 5;
  return {
    id: 7,
    name: 'Environmental Energy',
    score: pass ? 1 : 0,
    automated: true,
    reasoning: pass
      ? `Space weather is ${environmental.overallStatus} (K-index: ${environmental.kIndex}) \u2014 conditions are calm.`
      : `Space weather is ${environmental.overallStatus} (K-index: ${environmental.kIndex}) \u2014 elevated geomagnetic activity.`,
  };
}

function factor8_SoulCodeSync(numerology: NumerologyProfile): NEOFactor {
  const pass = numerology.alignmentNumbers.includes(numerology.personalDay);
  return {
    id: 8,
    name: 'Soul Code Sync',
    score: pass ? 1 : 0,
    automated: true,
    reasoning: pass
      ? `Personal day ${numerology.personalDay} is in alignment numbers [${numerology.alignmentNumbers.join(', ')}].`
      : `Personal day ${numerology.personalDay} is not in alignment numbers [${numerology.alignmentNumbers.join(', ')}].`,
  };
}

function factor9_TimingOverlay(planetaryHour: PlanetaryHour): NEOFactor {
  const pass = planetaryHour.isAllyHour || planetaryHour.isNeutralHour;
  return {
    id: 9,
    name: 'Timing Overlay',
    score: pass ? 1 : 0,
    automated: true,
    reasoning: pass
      ? `Current planetary hour (${planetaryHour.planet}) is ${planetaryHour.isAllyHour ? 'an ally' : 'neutral'} \u2014 favorable timing.`
      : `Current planetary hour (${planetaryHour.planet}) is an enemy hour \u2014 unfavorable timing.`,
  };
}

function factor10_SeasonalPsychology(): NEOFactor {
  return {
    id: 10,
    name: 'Seasonal Psychology',
    score: 1,
    automated: true,
    reasoning: 'Default pass. Month-based seasonal psychology logic can be added later.',
  };
}

function factor11_NewsSentiment(): NEOFactor {
  return {
    id: 11,
    name: 'News Sentiment',
    score: 1,
    automated: false,
    reasoning: 'Default pass for MVP. Economic calendar API integration can be added later.',
  };
}

function factor12_LunarHourMicroVOC(vocStatus: VOCStatus): NEOFactor {
  const pass = !vocStatus.isVoid;
  return {
    id: 12,
    name: 'Lunar Hour Micro VOC',
    score: pass ? 1 : 0,
    automated: true,
    reasoning: pass
      ? 'Moon is not void-of-course at the micro level \u2014 clear to trade.'
      : 'Moon is void-of-course \u2014 micro-level caution advised.',
  };
}

function factor13_MandelaDrift(): NEOFactor {
  return {
    id: 13,
    name: 'Mandela Drift',
    score: 1,
    automated: false,
    reasoning: 'Default pass. Cannot be automated \u2014 requires human observation.',
  };
}

function factor14_EmotionalEnergy(): NEOFactor {
  return {
    id: 14,
    name: 'Emotional Energy',
    score: 1,
    automated: false,
    reasoning: 'Default pass. Self-reported metric \u2014 future enhancement.',
  };
}

function factor15_AnomalyIndex(): NEOFactor {
  return {
    id: 15,
    name: 'Anomaly Index',
    score: 1,
    automated: false,
    reasoning: 'Default pass. Cross-instrument anomaly check can be added later.',
  };
}

function factor16_AvatarOperatingCode(): NEOFactor {
  return {
    id: 16,
    name: 'Avatar Operating Code',
    score: 1,
    automated: false,
    reasoning: 'Default pass. Human Design type matching can be added later.',
  };
}

function factor17_KarmicOverlay(): NEOFactor {
  return {
    id: 17,
    name: 'Karmic Overlay',
    score: 1,
    automated: false,
    reasoning: 'Default pass. Cannot be automated \u2014 requires intuitive assessment.',
  };
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

/**
 * Evaluate all 17 NEO factors and return the composite score with
 * classification, per-factor breakdown, and trading recommendation.
 */
export function calculateNEOScore(
  numerology: NumerologyProfile,
  moonPhase: MoonPhase,
  vocStatus: VOCStatus,
  planetaryHour: PlanetaryHour,
  chineseProfile: ChineseZodiacProfile,
  currentShiChen: ShiChenHour,
  environmental: EnvironmentalEnergy,
  currentDate: Date,
): NEOScore {
  const factors: NEOFactor[] = [
    factor1_NumerologyAlignment(numerology),
    factor2_Letterology(),
    factor3_WesternAstrology(moonPhase),
    factor4_ChineseZodiacHarmony(chineseProfile, currentShiChen),
    factor5_Gematria(),
    factor6_MoonPhaseVOC(moonPhase, vocStatus),
    factor7_EnvironmentalEnergy(environmental),
    factor8_SoulCodeSync(numerology),
    factor9_TimingOverlay(planetaryHour),
    factor10_SeasonalPsychology(),
    factor11_NewsSentiment(),
    factor12_LunarHourMicroVOC(vocStatus),
    factor13_MandelaDrift(),
    factor14_EmotionalEnergy(),
    factor15_AnomalyIndex(),
    factor16_AvatarOperatingCode(),
    factor17_KarmicOverlay(),
  ];

  const total = factors.reduce((sum, f) => sum + f.score, 0);
  const classification = classify(total);

  return {
    total,
    classification,
    factors,
    tradingRecommendation: TRADING_RECOMMENDATIONS[classification],
    timestamp: currentDate.toISOString(),
  };
}
