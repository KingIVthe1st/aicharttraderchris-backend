/**
 * Real-Time Invalidation System
 *
 * Continuously monitors market conditions to detect when trade thesis is invalidated.
 * Provides automatic bias flip recommendations with clear reasoning.
 */

import type { MarketStructureResult, SupportResistanceQuality } from './trendAnalysis';

export interface InvalidationContext {
  currentBias: 'LONG' | 'SHORT' | 'FLAT';
  currentPrice: number;

  // Support/Resistance levels
  supportLevel?: number;
  resistanceLevel?: number;

  // Market structure
  marketStructure: MarketStructureResult;

  // Support/Resistance quality
  supportQuality?: SupportResistanceQuality;
  resistanceQuality?: SupportResistanceQuality;

  // Moving averages
  ma20?: number;
  ma50?: number;

  // Volume
  currentVolume?: number;
  avgVolume?: number;

  // Time tracking
  biasStartTime?: number; // When current bias was established
  lastAnalysisTime?: number;
}

export interface InvalidationResult {
  isInvalidated: boolean;
  invalidationReasons: string[];
  recommendedAction: 'MAINTAIN' | 'GO_FLAT' | 'FLIP_LONG' | 'FLIP_SHORT';
  newBias: 'LONG' | 'SHORT' | 'FLAT';
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  confidence: number; // 0-1
  actionSteps: string[];
}

export interface InvalidationRule {
  name: string;
  check: (context: InvalidationContext) => boolean;
  weight: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  actionRequired: 'GO_FLAT' | 'FLIP_BIAS' | 'REDUCE_SIZE';
}

/**
 * Comprehensive invalidation checker for LONG bias
 */
export const LONG_INVALIDATION_RULES: InvalidationRule[] = [
  {
    name: 'support_broken_with_volume',
    check: (ctx) => {
      if (!ctx.supportLevel || !ctx.supportQuality) return false;
      const volumeConfirmed = ctx.currentVolume && ctx.avgVolume
        ? ctx.currentVolume > ctx.avgVolume * 1.3
        : false;
      return (
        ctx.currentPrice < ctx.supportLevel &&
        ctx.supportQuality.quality === 'BROKEN' &&
        volumeConfirmed
      );
    },
    weight: 'CRITICAL',
    message: 'Support broken with high volume - immediate invalidation',
    actionRequired: 'FLIP_BIAS'
  },
  {
    name: 'lower_low_confirmed',
    check: (ctx) => {
      return (
        ctx.marketStructure.pattern === 'LOWER_LOWS' ||
        ctx.marketStructure.pattern === 'DOWNTREND'
      ) && ctx.currentPrice < ctx.marketStructure.swingLow;
    },
    weight: 'CRITICAL',
    message: 'Lower low confirmed - downtrend structure established',
    actionRequired: 'FLIP_BIAS'
  },
  {
    name: 'bearish_ma_breakdown',
    check: (ctx) => {
      if (!ctx.ma20 || !ctx.ma50) return false;
      return (
        ctx.currentPrice < ctx.ma20 &&
        ctx.currentPrice < ctx.ma50 &&
        ctx.ma20 < ctx.ma50 &&
        ctx.marketStructure.maAlignment === 'BEARISH'
      );
    },
    weight: 'HIGH',
    message: 'Price below both MAs with bearish alignment',
    actionRequired: 'GO_FLAT'
  },
  {
    name: 'exhausted_support',
    check: (ctx) => {
      if (!ctx.supportQuality) return false;
      return ctx.supportQuality.testCount >= 3 &&
             ctx.supportQuality.quality === 'EXHAUSTED';
    },
    weight: 'HIGH',
    message: 'Support tested 3+ times - high break probability',
    actionRequired: 'REDUCE_SIZE'
  },
  {
    name: 'momentum_divergence',
    check: (ctx) => {
      // If we have momentum indicator and it's strongly negative
      // This is a placeholder - would need actual momentum calculation
      return false; // Implement when momentum data available
    },
    weight: 'MEDIUM',
    message: 'Bearish momentum divergence',
    actionRequired: 'REDUCE_SIZE'
  },
  {
    name: 'time_stop',
    check: (ctx) => {
      if (!ctx.biasStartTime) return false;
      const timeInBias = Date.now() - ctx.biasStartTime;
      const twoHours = 2 * 60 * 60 * 1000;

      // If in LONG bias for 2+ hours without progress past resistance
      return (
        timeInBias > twoHours &&
        ctx.resistanceLevel !== undefined &&
        ctx.currentPrice < ctx.resistanceLevel
      );
    },
    weight: 'LOW',
    message: 'Trade thesis not playing out after 2 hours',
    actionRequired: 'GO_FLAT'
  },
  {
    name: 'failed_breakout_attempt',
    check: (ctx) => {
      if (!ctx.resistanceLevel) return false;
      // Price tried to break resistance but failed and came back under
      // This would need historical price data to detect properly
      return false; // Implement when historical data available
    },
    weight: 'MEDIUM',
    message: 'Failed breakout attempt - sellers in control',
    actionRequired: 'GO_FLAT'
  }
];

/**
 * Comprehensive invalidation checker for SHORT bias
 */
export const SHORT_INVALIDATION_RULES: InvalidationRule[] = [
  {
    name: 'resistance_broken_with_volume',
    check: (ctx) => {
      if (!ctx.resistanceLevel || !ctx.resistanceQuality) return false;
      const volumeConfirmed = ctx.currentVolume && ctx.avgVolume
        ? ctx.currentVolume > ctx.avgVolume * 1.3
        : false;
      return (
        ctx.currentPrice > ctx.resistanceLevel &&
        ctx.resistanceQuality.quality === 'BROKEN' &&
        volumeConfirmed
      );
    },
    weight: 'CRITICAL',
    message: 'Resistance broken with high volume - immediate invalidation',
    actionRequired: 'FLIP_BIAS'
  },
  {
    name: 'higher_high_confirmed',
    check: (ctx) => {
      return (
        ctx.marketStructure.pattern === 'HIGHER_HIGHS' ||
        ctx.marketStructure.pattern === 'UPTREND'
      ) && ctx.currentPrice > ctx.marketStructure.swingHigh;
    },
    weight: 'CRITICAL',
    message: 'Higher high confirmed - uptrend structure established',
    actionRequired: 'FLIP_BIAS'
  },
  {
    name: 'bullish_ma_breakout',
    check: (ctx) => {
      if (!ctx.ma20 || !ctx.ma50) return false;
      return (
        ctx.currentPrice > ctx.ma20 &&
        ctx.currentPrice > ctx.ma50 &&
        ctx.ma20 > ctx.ma50 &&
        ctx.marketStructure.maAlignment === 'BULLISH'
      );
    },
    weight: 'HIGH',
    message: 'Price above both MAs with bullish alignment',
    actionRequired: 'GO_FLAT'
  },
  {
    name: 'exhausted_resistance',
    check: (ctx) => {
      if (!ctx.resistanceQuality) return false;
      return ctx.resistanceQuality.testCount >= 3 &&
             ctx.resistanceQuality.quality === 'EXHAUSTED';
    },
    weight: 'HIGH',
    message: 'Resistance tested 3+ times - high break probability',
    actionRequired: 'REDUCE_SIZE'
  },
  {
    name: 'bullish_momentum_divergence',
    check: (ctx) => {
      // If we have momentum indicator and it's strongly positive
      // This is a placeholder - would need actual momentum calculation
      return false; // Implement when momentum data available
    },
    weight: 'MEDIUM',
    message: 'Bullish momentum divergence',
    actionRequired: 'REDUCE_SIZE'
  },
  {
    name: 'time_stop',
    check: (ctx) => {
      if (!ctx.biasStartTime) return false;
      const timeInBias = Date.now() - ctx.biasStartTime;
      const twoHours = 2 * 60 * 60 * 1000;

      // If in SHORT bias for 2+ hours without progress below support
      return (
        timeInBias > twoHours &&
        ctx.supportLevel !== undefined &&
        ctx.currentPrice > ctx.supportLevel
      );
    },
    weight: 'LOW',
    message: 'Trade thesis not playing out after 2 hours',
    actionRequired: 'GO_FLAT'
  },
  {
    name: 'failed_breakdown_attempt',
    check: (ctx) => {
      if (!ctx.supportLevel) return false;
      // Price tried to break support but failed and came back above
      // This would need historical price data to detect properly
      return false; // Implement when historical data available
    },
    weight: 'MEDIUM',
    message: 'Failed breakdown attempt - buyers in control',
    actionRequired: 'GO_FLAT'
  }
];

/**
 * Main invalidation checker function
 *
 * Evaluates current market conditions against invalidation rules
 * and provides clear recommendation with reasoning
 */
export function checkTradeInvalidation(context: InvalidationContext): InvalidationResult {
  const { currentBias } = context;

  // Select appropriate rule set
  const rules = currentBias === 'LONG'
    ? LONG_INVALIDATION_RULES
    : currentBias === 'SHORT'
    ? SHORT_INVALIDATION_RULES
    : [];

  // If already FLAT, no invalidation needed
  if (currentBias === 'FLAT') {
    return {
      isInvalidated: false,
      invalidationReasons: [],
      recommendedAction: 'MAINTAIN',
      newBias: 'FLAT',
      urgency: 'LOW',
      confidence: 1.0,
      actionSteps: ['Continue monitoring for clear setup']
    };
  }

  // Check all rules
  const triggeredRules: InvalidationRule[] = [];

  for (const rule of rules) {
    if (rule.check(context)) {
      triggeredRules.push(rule);
    }
  }

  // No triggers - bias is still valid
  if (triggeredRules.length === 0) {
    return {
      isInvalidated: false,
      invalidationReasons: [],
      recommendedAction: 'MAINTAIN',
      newBias: currentBias,
      urgency: 'LOW',
      confidence: 1.0,
      actionSteps: ['Current bias remains valid', 'Continue trading plan']
    };
  }

  // Evaluate severity
  const criticalTriggers = triggeredRules.filter(r => r.weight === 'CRITICAL');
  const highTriggers = triggeredRules.filter(r => r.weight === 'HIGH');
  const mediumTriggers = triggeredRules.filter(r => r.weight === 'MEDIUM');
  const lowTriggers = triggeredRules.filter(r => r.weight === 'LOW');

  // Determine invalidation severity
  let isInvalidated = false;
  let recommendedAction: InvalidationResult['recommendedAction'] = 'MAINTAIN';
  let newBias: InvalidationResult['newBias'] = currentBias;
  let urgency: InvalidationResult['urgency'] = 'LOW';
  let confidence = 0.0;

  // CRITICAL trigger = immediate invalidation
  if (criticalTriggers.length > 0) {
    isInvalidated = true;

    // Check if we should flip or go flat
    const flipActions = criticalTriggers.filter(r => r.actionRequired === 'FLIP_BIAS');

    if (flipActions.length > 0) {
      recommendedAction = currentBias === 'LONG' ? 'FLIP_SHORT' : 'FLIP_LONG';
      newBias = currentBias === 'LONG' ? 'SHORT' : 'LONG';
    } else {
      recommendedAction = 'GO_FLAT';
      newBias = 'FLAT';
    }

    urgency = 'CRITICAL';
    confidence = 0.95;
  }
  // Multiple HIGH triggers = invalidation
  else if (highTriggers.length >= 2) {
    isInvalidated = true;
    recommendedAction = 'GO_FLAT';
    newBias = 'FLAT';
    urgency = 'HIGH';
    confidence = 0.85;
  }
  // Single HIGH trigger = strong warning
  else if (highTriggers.length === 1) {
    isInvalidated = true;
    recommendedAction = 'GO_FLAT';
    newBias = 'FLAT';
    urgency = 'MEDIUM';
    confidence = 0.70;
  }
  // Multiple MEDIUM + LOW triggers = warning
  else if (mediumTriggers.length + lowTriggers.length >= 3) {
    isInvalidated = true;
    recommendedAction = 'GO_FLAT';
    newBias = 'FLAT';
    urgency = 'MEDIUM';
    confidence = 0.60;
  }

  // Build action steps
  const actionSteps: string[] = [];

  if (isInvalidated) {
    if (recommendedAction === 'FLIP_SHORT') {
      actionSteps.push('🔴 FLIP TO SHORT BIAS');
      actionSteps.push(`Look for short entries on retest of ${context.supportLevel || 'broken support'}`);
      actionSteps.push('Stop loss above recent swing high');
      actionSteps.push('Target previous support levels below');
    } else if (recommendedAction === 'FLIP_LONG') {
      actionSteps.push('🟢 FLIP TO LONG BIAS');
      actionSteps.push(`Look for long entries on retest of ${context.resistanceLevel || 'broken resistance'}`);
      actionSteps.push('Stop loss below recent swing low');
      actionSteps.push('Target previous resistance levels above');
    } else {
      actionSteps.push('⚠️ GO FLAT - Exit all positions');
      actionSteps.push('Wait for clear market structure');
      actionSteps.push('Look for fresh setup with high probability');
    }
  }

  const invalidationReasons = triggeredRules.map(r => r.message);

  return {
    isInvalidated,
    invalidationReasons,
    recommendedAction,
    newBias,
    urgency,
    confidence,
    actionSteps
  };
}

/**
 * Quick check - returns true if bias should be reconsidered
 * Use this for fast checks before detailed analysis
 */
export function shouldReassessBias(context: InvalidationContext): boolean {
  const result = checkTradeInvalidation(context);
  return result.isInvalidated && result.urgency !== 'LOW';
}

/**
 * Get human-readable invalidation summary
 */
export function getInvalidationSummary(result: InvalidationResult): string {
  if (!result.isInvalidated) {
    return '✅ Current bias remains valid';
  }

  const urgencyEmoji = {
    'LOW': '⚠️',
    'MEDIUM': '🟠',
    'HIGH': '🔴',
    'CRITICAL': '🚨'
  };

  return `${urgencyEmoji[result.urgency]} ${result.urgency} - ${result.invalidationReasons.join('; ')}`;
}
