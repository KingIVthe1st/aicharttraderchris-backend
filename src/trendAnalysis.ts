/**
 * Trend Analysis Tools
 *
 * Programmatic functions to detect market structure, assess support/resistance quality,
 * and identify trend invalidation triggers.
 */

export interface SwingPoint {
  price: number;
  timestamp: number;
  type: 'high' | 'low';
}

export interface TrendMetrics {
  swingHighs: number[];
  swingLows: number[];
  ma20: number;
  ma50: number;
  currentPrice: number;
  momentum?: number;
  volume?: number;
  avgVolume?: number;
}

export interface MarketStructureResult {
  pattern: 'LOWER_LOWS' | 'HIGHER_HIGHS' | 'LOWER_HIGHS' | 'HIGHER_LOWS' | 'RANGE' | 'DOWNTREND' | 'UPTREND';
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  tradeBias: 'LONG' | 'SHORT' | 'FLAT';
  swingHigh: number;
  swingLow: number;
  maAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  structureIntact: boolean;
  confidence: number; // 0-1
}

export interface SupportResistanceQuality {
  level: number;
  quality: 'FRESH' | 'TESTED' | 'EXHAUSTED' | 'BROKEN';
  holdProbability: number; // 0-100
  testCount: number;
  weakeningSigns: string[];
  recommendation: string;
}

export interface BiasConflictResult {
  dailyTrend: 'UP' | 'DOWN' | 'RANGE';
  intradayTrend: 'UP' | 'DOWN' | 'RANGE';
  trendsAligned: boolean;
  action: 'FULL_SIZE_LONG' | 'FULL_SIZE_SHORT' | 'REDUCED_SIZE' | 'GO_FLAT' | 'FLIP_SHORT' | 'FLIP_LONG';
  reasoning: string[];
  currentBias: 'LONG' | 'SHORT' | 'FLAT';
  trendStrength: number; // -100 to +100
}

/**
 * Detects market structure by analyzing swing points and moving averages
 */
export function detectMarketStructure(metrics: TrendMetrics): MarketStructureResult {
  const { swingHighs, swingLows, ma20, ma50, currentPrice } = metrics;

  // Validate inputs
  if (!swingHighs || swingHighs.length < 2) {
    return createRangeStructure(currentPrice, ma20, ma50);
  }

  if (!swingLows || swingLows.length < 2) {
    return createRangeStructure(currentPrice, ma20, ma50);
  }

  // Analyze swing progression
  const lowerLows = isLowerLowsPattern(swingLows);
  const lowerHighs = isLowerHighsPattern(swingHighs);
  const higherHighs = isHigherHighsPattern(swingHighs);
  const higherLows = isHigherLowsPattern(swingLows);

  // Analyze MA alignment
  const maAlignment = getMAAlignment(currentPrice, ma20, ma50);

  // Determine pattern
  let pattern: MarketStructureResult['pattern'];
  let strength: MarketStructureResult['strength'];
  let tradeBias: MarketStructureResult['tradeBias'];
  let structureIntact: boolean;
  let confidence: number;

  if (lowerLows && lowerHighs) {
    // Clear downtrend
    pattern = 'DOWNTREND';
    strength = maAlignment === 'BEARISH' ? 'STRONG' : 'MODERATE';
    tradeBias = 'SHORT';
    structureIntact = true;
    confidence = maAlignment === 'BEARISH' ? 0.9 : 0.7;
  } else if (higherHighs && higherLows) {
    // Clear uptrend
    pattern = 'UPTREND';
    strength = maAlignment === 'BULLISH' ? 'STRONG' : 'MODERATE';
    tradeBias = 'LONG';
    structureIntact = true;
    confidence = maAlignment === 'BULLISH' ? 0.9 : 0.7;
  } else if (lowerLows && !lowerHighs) {
    pattern = 'LOWER_LOWS';
    strength = 'MODERATE';
    tradeBias = 'SHORT';
    structureIntact = false;
    confidence = 0.6;
  } else if (lowerHighs && !lowerLows) {
    pattern = 'LOWER_HIGHS';
    strength = 'WEAK';
    tradeBias = maAlignment === 'BEARISH' ? 'SHORT' : 'FLAT';
    structureIntact = false;
    confidence = 0.5;
  } else if (higherHighs && !higherLows) {
    pattern = 'HIGHER_HIGHS';
    strength = 'MODERATE';
    tradeBias = 'LONG';
    structureIntact = false;
    confidence = 0.6;
  } else if (higherLows && !higherHighs) {
    pattern = 'HIGHER_LOWS';
    strength = 'WEAK';
    tradeBias = maAlignment === 'BULLISH' ? 'LONG' : 'FLAT';
    structureIntact = false;
    confidence = 0.5;
  } else {
    // Range / choppy
    pattern = 'RANGE';
    strength = 'WEAK';
    tradeBias = 'FLAT';
    structureIntact = false;
    confidence = 0.3;
  }

  return {
    pattern,
    strength,
    tradeBias,
    swingHigh: Math.max(...swingHighs),
    swingLow: Math.min(...swingLows),
    maAlignment,
    structureIntact,
    confidence
  };
}

/**
 * Calculates support/resistance quality based on test count and response
 */
export function calculateSupportQuality(
  level: number,
  testCount: number,
  lastResponse?: 'STRONG_BOUNCE' | 'WEAK_BOUNCE' | 'NO_BOUNCE' | 'BREAK',
  volumeProfile?: 'INCREASING' | 'DECREASING' | 'NEUTRAL',
  bodyCloseThrough?: boolean
): SupportResistanceQuality {
  const weakeningSigns: string[] = [];

  // Base quality and probability from test count
  let quality: SupportResistanceQuality['quality'];
  let baseHoldProbability: number;
  let recommendation: string;

  if (testCount === 0) {
    quality = 'FRESH';
    baseHoldProbability = 85;
    recommendation = 'High conviction trade - first test of level';
  } else if (testCount === 1) {
    quality = 'FRESH';
    baseHoldProbability = 80;
    recommendation = 'Strong setup - level holding well';
  } else if (testCount === 2) {
    quality = 'TESTED';
    baseHoldProbability = 70;
    recommendation = 'Moderate conviction - normal position size';
  } else if (testCount === 3) {
    quality = 'EXHAUSTED';
    baseHoldProbability = 50;
    recommendation = 'Caution - 3rd test often breaks. Reduce size or wait.';
    weakeningSigns.push('Third test of support in 24h');
  } else if (testCount >= 4) {
    quality = 'EXHAUSTED';
    baseHoldProbability = 30;
    recommendation = 'Very high break probability. Trade the BREAK, not the hold.';
    weakeningSigns.push(`${testCount} tests - severe exhaustion`);
  } else {
    quality = 'BROKEN';
    baseHoldProbability = 15;
    recommendation = 'Level broken - do not trade bounces. Look for shorts on retest.';
  }

  // Adjust probability based on response quality
  let probabilityAdjustment = 0;

  if (lastResponse === 'WEAK_BOUNCE') {
    probabilityAdjustment -= 15;
    weakeningSigns.push('Weak bounce on last test');
  } else if (lastResponse === 'STRONG_BOUNCE') {
    probabilityAdjustment += 10;
  } else if (lastResponse === 'NO_BOUNCE') {
    probabilityAdjustment -= 25;
    weakeningSigns.push('No bounce on last test');
    quality = 'BROKEN';
  } else if (lastResponse === 'BREAK') {
    quality = 'BROKEN';
    baseHoldProbability = 10;
    weakeningSigns.push('Level already broken');
  }

  // Adjust for volume profile
  if (volumeProfile === 'INCREASING') {
    probabilityAdjustment -= 10;
    weakeningSigns.push('Volume increasing on tests (selling pressure)');
  } else if (volumeProfile === 'DECREASING') {
    probabilityAdjustment += 5;
  }

  // Adjust for body closes
  if (bodyCloseThrough) {
    probabilityAdjustment -= 20;
    weakeningSigns.push('Candle bodies closing through level');
    if (quality !== 'BROKEN') {
      quality = 'EXHAUSTED';
    }
  }

  const holdProbability = Math.max(5, Math.min(95, baseHoldProbability + probabilityAdjustment));

  return {
    level,
    quality,
    holdProbability,
    testCount,
    weakeningSigns,
    recommendation
  };
}

/**
 * Checks for conflicts between daily and intraday trends and recommends action
 */
export function checkBiasConflict(
  dailyTrend: 'UP' | 'DOWN' | 'RANGE',
  intradayStructure: MarketStructureResult,
  supportBroken: boolean = false,
  volumeConfirmation: boolean = false
): BiasConflictResult {
  const intradayTrend = patternToTrend(intradayStructure.pattern);
  const trendsAligned = dailyTrend === intradayTrend;
  const reasoning: string[] = [];

  let action: BiasConflictResult['action'];
  let currentBias: BiasConflictResult['currentBias'];
  let trendStrength: number;

  // Case 1: Trends aligned
  if (trendsAligned && dailyTrend === 'UP') {
    action = 'FULL_SIZE_LONG';
    currentBias = 'LONG';
    trendStrength = intradayStructure.confidence * 100;
    reasoning.push('Daily and intraday trends aligned UP');
    reasoning.push(`Market structure: ${intradayStructure.pattern}`);
  } else if (trendsAligned && dailyTrend === 'DOWN') {
    action = 'FULL_SIZE_SHORT';
    currentBias = 'SHORT';
    trendStrength = -intradayStructure.confidence * 100;
    reasoning.push('Daily and intraday trends aligned DOWN');
    reasoning.push(`Market structure: ${intradayStructure.pattern}`);
  }
  // Case 2: Daily UP but intraday DOWN (critical conflict)
  else if (dailyTrend === 'UP' && intradayTrend === 'DOWN') {
    if (supportBroken && volumeConfirmation) {
      action = 'FLIP_SHORT';
      currentBias = 'SHORT';
      trendStrength = -intradayStructure.confidence * 80;
      reasoning.push('⚠️ CRITICAL: Support broken with volume');
      reasoning.push('⚠️ Intraday downtrend confirmed');
      reasoning.push('Action: FLIP SHORT - intraday structure wins');
    } else if (intradayStructure.pattern === 'DOWNTREND' || intradayStructure.pattern === 'LOWER_LOWS') {
      action = 'GO_FLAT';
      currentBias = 'FLAT';
      trendStrength = 0;
      reasoning.push('⚠️ Daily UP but intraday forming lower lows');
      reasoning.push('Trend conflict - GO FLAT until realignment');
    } else {
      action = 'REDUCED_SIZE';
      currentBias = 'LONG';
      trendStrength = 20;
      reasoning.push('Daily UP but intraday showing weakness');
      reasoning.push('Reduce position size or wait for clarity');
    }
  }
  // Case 3: Daily DOWN but intraday UP
  else if (dailyTrend === 'DOWN' && intradayTrend === 'UP') {
    if (intradayStructure.pattern === 'UPTREND' || intradayStructure.pattern === 'HIGHER_HIGHS') {
      action = 'GO_FLAT';
      currentBias = 'FLAT';
      trendStrength = 0;
      reasoning.push('Daily DOWN but intraday forming higher highs');
      reasoning.push('Trend conflict - GO FLAT until realignment');
    } else {
      action = 'FULL_SIZE_SHORT';
      currentBias = 'SHORT';
      trendStrength = -60;
      reasoning.push('Daily DOWN, intraday bounce is counter-trend');
      reasoning.push('Look for short entries on rallies');
    }
  }
  // Case 4: Range scenarios
  else if (dailyTrend === 'RANGE' || intradayTrend === 'RANGE') {
    action = 'REDUCED_SIZE';
    currentBias = 'FLAT';
    trendStrength = 0;
    reasoning.push('Range-bound market');
    reasoning.push('Trade range boundaries or reduce activity');
  }
  // Default fallback
  else {
    action = 'GO_FLAT';
    currentBias = 'FLAT';
    trendStrength = 0;
    reasoning.push('Unclear market structure');
    reasoning.push('Better to wait for clear signal');
  }

  return {
    dailyTrend,
    intradayTrend,
    trendsAligned,
    action,
    reasoning,
    currentBias,
    trendStrength
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function isLowerLowsPattern(lows: number[]): boolean {
  if (lows.length < 2) return false;

  // Check if each low is lower than the previous
  for (let i = 1; i < lows.length; i++) {
    if (lows[i] >= lows[i - 1]) {
      return false;
    }
  }
  return true;
}

function isLowerHighsPattern(highs: number[]): boolean {
  if (highs.length < 2) return false;

  for (let i = 1; i < highs.length; i++) {
    if (highs[i] >= highs[i - 1]) {
      return false;
    }
  }
  return true;
}

function isHigherHighsPattern(highs: number[]): boolean {
  if (highs.length < 2) return false;

  for (let i = 1; i < highs.length; i++) {
    if (highs[i] <= highs[i - 1]) {
      return false;
    }
  }
  return true;
}

function isHigherLowsPattern(lows: number[]): boolean {
  if (lows.length < 2) return false;

  for (let i = 1; i < lows.length; i++) {
    if (lows[i] <= lows[i - 1]) {
      return false;
    }
  }
  return true;
}

function getMAAlignment(currentPrice: number, ma20: number, ma50: number): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  const bullishAlignment = currentPrice > ma20 && ma20 > ma50;
  const bearishAlignment = currentPrice < ma20 && ma20 < ma50;

  if (bullishAlignment) return 'BULLISH';
  if (bearishAlignment) return 'BEARISH';
  return 'NEUTRAL';
}

function patternToTrend(pattern: MarketStructureResult['pattern']): 'UP' | 'DOWN' | 'RANGE' {
  if (pattern === 'UPTREND' || pattern === 'HIGHER_HIGHS' || pattern === 'HIGHER_LOWS') {
    return 'UP';
  }
  if (pattern === 'DOWNTREND' || pattern === 'LOWER_LOWS' || pattern === 'LOWER_HIGHS') {
    return 'DOWN';
  }
  return 'RANGE';
}

function createRangeStructure(currentPrice: number, ma20: number, ma50: number): MarketStructureResult {
  return {
    pattern: 'RANGE',
    strength: 'WEAK',
    tradeBias: 'FLAT',
    swingHigh: currentPrice,
    swingLow: currentPrice,
    maAlignment: getMAAlignment(currentPrice, ma20, ma50),
    structureIntact: false,
    confidence: 0.3
  };
}

/**
 * Identifies invalidation triggers based on current conditions
 */
export function identifyInvalidationTriggers(
  currentBias: 'LONG' | 'SHORT',
  structure: MarketStructureResult,
  supportQuality: SupportResistanceQuality,
  volumeMultiple?: number
): string[] {
  const triggers: string[] = [];

  if (currentBias === 'LONG') {
    // Check for long invalidation
    if (supportQuality.quality === 'BROKEN') {
      triggers.push('support_broken');
    }

    if (structure.pattern === 'LOWER_LOWS' || structure.pattern === 'DOWNTREND') {
      triggers.push('lower_low_confirmed');
    }

    if (structure.maAlignment === 'BEARISH') {
      triggers.push('ma_breakdown');
    }

    if (supportQuality.testCount >= 3) {
      triggers.push('exhausted_support');
    }

    if (volumeMultiple && volumeMultiple > 1.3 && supportQuality.quality === 'BROKEN') {
      triggers.push('high_volume_breakdown');
    }
  }

  if (currentBias === 'SHORT') {
    // Check for short invalidation
    if (structure.pattern === 'HIGHER_HIGHS' || structure.pattern === 'UPTREND') {
      triggers.push('higher_high_confirmed');
    }

    if (structure.maAlignment === 'BULLISH') {
      triggers.push('ma_breakout');
    }

    if (volumeMultiple && volumeMultiple > 1.3) {
      triggers.push('high_volume_breakout');
    }
  }

  return triggers;
}
