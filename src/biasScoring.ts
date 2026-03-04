/**
 * Evidence-Based Bias Scoring System
 *
 * Accumulates weighted signals over time to determine overall market bias.
 * Provides dynamic bias adjustment based on cumulative evidence.
 */

export interface BiasSignal {
  name: string;
  weight: number; // Positive = bullish, Negative = bearish
  timestamp: number;
  reason: string;
  confidence: number; // 0-1
  category: 'STRUCTURE' | 'SUPPORT_RESISTANCE' | 'MOMENTUM' | 'VOLUME' | 'PATTERN';
}

export interface BiasScore {
  score: number; // -100 (strong bearish) to +100 (strong bullish)
  bias: 'LONG' | 'SHORT' | 'FLAT';
  confidence: number; // 0-1
  signalCount: number;
  dominantCategory: string;
  recommendation: string;
}

/**
 * Signal weight reference (for documentation)
 */
export const SIGNAL_WEIGHTS = {
  // CRITICAL signals (±35 to ±45)
  SUPPORT_BROKEN_VOLUME: -40,
  RESISTANCE_BROKEN_VOLUME: +40,
  LOWER_LOW_CONFIRMED: -40,
  HIGHER_HIGH_CONFIRMED: +40,

  // HIGH signals (±25 to ±35)
  BEARISH_MA_ALIGNMENT: -30,
  BULLISH_MA_ALIGNMENT: +30,
  DOWNTREND_STRUCTURE: -30,
  UPTREND_STRUCTURE: +30,

  // MEDIUM signals (±15 to ±25)
  SUPPORT_EXHAUSTED: -20,
  RESISTANCE_EXHAUSTED: +20,
  BEARISH_MOMENTUM: -18,
  BULLISH_MOMENTUM: +18,
  LOWER_HIGHS: -15,
  HIGHER_LOWS: +15,

  // LOW signals (±5 to ±15)
  VOLUME_DECLINE: -10,
  VOLUME_INCREASE: +10,
  WEAK_BOUNCE: -8,
  STRONG_BOUNCE: +8
};

/**
 * BiasScorer class - accumulates evidence and calculates dynamic bias
 */
export class BiasScorer {
  private signals: Map<string, BiasSignal> = new Map();
  private maxAge: number; // Maximum age of signals in milliseconds
  private thresholds: { flat: number; moderate: number; strong: number };

  constructor(options?: {
    maxAge?: number;
    thresholds?: { flat: number; moderate: number; strong: number };
  }) {
    this.maxAge = options?.maxAge || 3600000; // Default: 1 hour
    this.thresholds = options?.thresholds || {
      flat: 25,      // Score < ±25 = FLAT
      moderate: 50,  // Score ±25-50 = moderate bias
      strong: 75     // Score > ±75 = strong bias
    };
  }

  /**
   * Add a bullish or bearish signal
   */
  addSignal(signal: Omit<BiasSignal, 'timestamp'>): void {
    this.signals.set(signal.name, {
      ...signal,
      timestamp: Date.now()
    });

    this.pruneOldSignals();
  }

  /**
   * Remove a specific signal by name
   */
  removeSignal(name: string): void {
    this.signals.delete(name);
  }

  /**
   * Clear all signals
   */
  clearAll(): void {
    this.signals.clear();
  }

  /**
   * Remove signals older than maxAge
   */
  private pruneOldSignals(): void {
    const cutoff = Date.now() - this.maxAge;
    for (const [name, signal] of this.signals.entries()) {
      if (signal.timestamp < cutoff) {
        this.signals.delete(name);
      }
    }
  }

  /**
   * Calculate current bias score
   */
  getScore(): BiasScore {
    this.pruneOldSignals();

    if (this.signals.size === 0) {
      return {
        score: 0,
        bias: 'FLAT',
        confidence: 0,
        signalCount: 0,
        dominantCategory: 'NONE',
        recommendation: 'No active signals - wait for clear setup'
      };
    }

    // Calculate weighted score
    let totalScore = 0;
    let totalWeight = 0;
    const categoryScores = new Map<string, number>();

    for (const signal of this.signals.values()) {
      const weightedScore = signal.weight * signal.confidence;
      totalScore += weightedScore;
      totalWeight += Math.abs(signal.weight * signal.confidence);

      // Track category contribution
      const current = categoryScores.get(signal.category) || 0;
      categoryScores.set(signal.category, current + Math.abs(weightedScore));
    }

    // Normalize score to -100 to +100 range
    const normalizedScore = totalWeight > 0
      ? (totalScore / totalWeight) * 100
      : 0;

    // Determine bias
    let bias: BiasScore['bias'];
    if (Math.abs(normalizedScore) < this.thresholds.flat) {
      bias = 'FLAT';
    } else if (normalizedScore > 0) {
      bias = 'LONG';
    } else {
      bias = 'SHORT';
    }

    // Calculate confidence based on signal agreement
    const bullishSignals = Array.from(this.signals.values()).filter(s => s.weight > 0);
    const bearishSignals = Array.from(this.signals.values()).filter(s => s.weight < 0);
    const agreement = Math.abs(bullishSignals.length - bearishSignals.length) / this.signals.size;
    const confidence = Math.min(1.0, agreement * (Math.abs(normalizedScore) / 100));

    // Find dominant category
    let dominantCategory = 'MIXED';
    let maxCategoryScore = 0;
    for (const [category, score] of categoryScores.entries()) {
      if (score > maxCategoryScore) {
        maxCategoryScore = score;
        dominantCategory = category;
      }
    }

    // Generate recommendation
    const recommendation = this.generateRecommendation(normalizedScore, confidence, dominantCategory);

    return {
      score: normalizedScore,
      bias,
      confidence,
      signalCount: this.signals.size,
      dominantCategory,
      recommendation
    };
  }

  /**
   * Get current bias (shorthand)
   */
  getBias(): 'LONG' | 'SHORT' | 'FLAT' {
    return this.getScore().bias;
  }

  /**
   * Get confidence in current bias
   */
  getConfidence(): number {
    return this.getScore().confidence;
  }

  /**
   * Get all active signals
   */
  getActiveSignals(): BiasSignal[] {
    this.pruneOldSignals();
    return Array.from(this.signals.values()).sort((a, b) => {
      return Math.abs(b.weight) - Math.abs(a.weight);
    });
  }

  /**
   * Get signals by category
   */
  getSignalsByCategory(category: BiasSignal['category']): BiasSignal[] {
    return this.getActiveSignals().filter(s => s.category === category);
  }

  /**
   * Check if a specific signal is active
   */
  hasSignal(name: string): boolean {
    this.pruneOldSignals();
    return this.signals.has(name);
  }

  /**
   * Get signal details
   */
  getSignal(name: string): BiasSignal | undefined {
    this.pruneOldSignals();
    return this.signals.get(name);
  }

  /**
   * Generate human-readable recommendation
   */
  private generateRecommendation(score: number, confidence: number, category: string): string {
    const absScore = Math.abs(score);

    if (absScore < this.thresholds.flat) {
      return `Mixed signals (${category.toLowerCase()} focus) - stay FLAT until clarity`;
    }

    const direction = score > 0 ? 'LONG' : 'SHORT';
    const strength = absScore > this.thresholds.strong
      ? 'Strong'
      : absScore > this.thresholds.moderate
      ? 'Moderate'
      : 'Weak';

    const confidenceDesc = confidence > 0.8
      ? 'high confidence'
      : confidence > 0.6
      ? 'moderate confidence'
      : 'low confidence';

    return `${strength} ${direction} bias (${confidenceDesc}) - ${category.toLowerCase()} signals dominant`;
  }

  /**
   * Export current state for logging/debugging
   */
  exportState(): {
    score: BiasScore;
    signals: BiasSignal[];
    timestamp: number;
  } {
    return {
      score: this.getScore(),
      signals: this.getActiveSignals(),
      timestamp: Date.now()
    };
  }

  /**
   * Import state (for testing or restoration)
   */
  importState(state: { signals: BiasSignal[] }): void {
    this.signals.clear();
    for (const signal of state.signals) {
      this.signals.set(signal.name, signal);
    }
  }
}

/**
 * Helper function to create common signals
 */
export const BiasSignals = {
  // Support/Resistance signals
  supportBrokenVolume: (level: number): Omit<BiasSignal, 'timestamp'> => ({
    name: 'support_broken_volume',
    weight: SIGNAL_WEIGHTS.SUPPORT_BROKEN_VOLUME,
    reason: `Support at ${level} broken with high volume`,
    confidence: 0.95,
    category: 'SUPPORT_RESISTANCE'
  }),

  resistanceBrokenVolume: (level: number): Omit<BiasSignal, 'timestamp'> => ({
    name: 'resistance_broken_volume',
    weight: SIGNAL_WEIGHTS.RESISTANCE_BROKEN_VOLUME,
    reason: `Resistance at ${level} broken with high volume`,
    confidence: 0.95,
    category: 'SUPPORT_RESISTANCE'
  }),

  supportExhausted: (testCount: number): Omit<BiasSignal, 'timestamp'> => ({
    name: 'support_exhausted',
    weight: SIGNAL_WEIGHTS.SUPPORT_EXHAUSTED,
    reason: `Support tested ${testCount} times - exhaustion`,
    confidence: 0.75,
    category: 'SUPPORT_RESISTANCE'
  }),

  resistanceExhausted: (testCount: number): Omit<BiasSignal, 'timestamp'> => ({
    name: 'resistance_exhausted',
    weight: SIGNAL_WEIGHTS.RESISTANCE_EXHAUSTED,
    reason: `Resistance tested ${testCount} times - exhaustion`,
    confidence: 0.75,
    category: 'SUPPORT_RESISTANCE'
  }),

  // Structure signals
  lowerLowConfirmed: (low: number): Omit<BiasSignal, 'timestamp'> => ({
    name: 'lower_low_confirmed',
    weight: SIGNAL_WEIGHTS.LOWER_LOW_CONFIRMED,
    reason: `Lower low confirmed at ${low}`,
    confidence: 0.90,
    category: 'STRUCTURE'
  }),

  higherHighConfirmed: (high: number): Omit<BiasSignal, 'timestamp'> => ({
    name: 'higher_high_confirmed',
    weight: SIGNAL_WEIGHTS.HIGHER_HIGH_CONFIRMED,
    reason: `Higher high confirmed at ${high}`,
    confidence: 0.90,
    category: 'STRUCTURE'
  }),

  lowerHighConfirmed: (high: number): Omit<BiasSignal, 'timestamp'> => ({
    name: 'lower_high_confirmed',
    weight: SIGNAL_WEIGHTS.LOWER_HIGHS,
    reason: `Lower high confirmed at ${high}`,
    confidence: 0.75,
    category: 'STRUCTURE'
  }),

  higherLowConfirmed: (low: number): Omit<BiasSignal, 'timestamp'> => ({
    name: 'higher_low_confirmed',
    weight: SIGNAL_WEIGHTS.HIGHER_LOWS,
    reason: `Higher low confirmed at ${low}`,
    confidence: 0.75,
    category: 'STRUCTURE'
  }),

  downtrendStructure: (): Omit<BiasSignal, 'timestamp'> => ({
    name: 'downtrend_structure',
    weight: SIGNAL_WEIGHTS.DOWNTREND_STRUCTURE,
    reason: 'Downtrend structure (lower lows + lower highs)',
    confidence: 0.85,
    category: 'STRUCTURE'
  }),

  uptrendStructure: (): Omit<BiasSignal, 'timestamp'> => ({
    name: 'uptrend_structure',
    weight: SIGNAL_WEIGHTS.UPTREND_STRUCTURE,
    reason: 'Uptrend structure (higher highs + higher lows)',
    confidence: 0.85,
    category: 'STRUCTURE'
  }),

  // MA signals
  bearishMAAlignment: (): Omit<BiasSignal, 'timestamp'> => ({
    name: 'bearish_ma_alignment',
    weight: SIGNAL_WEIGHTS.BEARISH_MA_ALIGNMENT,
    reason: 'Price < 20 EMA < 50 EMA (bearish)',
    confidence: 0.80,
    category: 'PATTERN'
  }),

  bullishMAAlignment: (): Omit<BiasSignal, 'timestamp'> => ({
    name: 'bullish_ma_alignment',
    weight: SIGNAL_WEIGHTS.BULLISH_MA_ALIGNMENT,
    reason: 'Price > 20 EMA > 50 EMA (bullish)',
    confidence: 0.80,
    category: 'PATTERN'
  })
};

/**
 * Example usage for ES 12-25 at 11:00 AM
 */
export function createES1225_11AM_Scorer(): BiasScorer {
  const scorer = new BiasScorer();

  // Add bearish signals from the scenario
  scorer.addSignal(BiasSignals.supportBrokenVolume(6886));
  scorer.addSignal(BiasSignals.lowerLowConfirmed(6884));
  scorer.addSignal(BiasSignals.downtrendStructure());
  scorer.addSignal(BiasSignals.bearishMAAlignment());
  scorer.addSignal(BiasSignals.supportExhausted(3));

  return scorer;
}
