/**
 * Displacement Check Service - Symbol-Aware Displacement Candle Detection
 * 
 * Checks if a displacement candle meets symbol-specific ATR-based requirements.
 * For XAUUSD and US30, displacement candles must be >= 2x ATR to confirm a strong move.
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';

const logger = new Logger('DisplacementCheckService');

export interface DisplacementCheckConfig {
  symbol: string;
  minATRMultiplier: number; // Displacement candle must be >= Nx ATR for isValid=true (default: 2.0)
  atrLookbackPeriod: number; // Candles for ATR calculation (default: 20)
  // v15c: Soft displacement scoring (similar to ADR)
  useAsHardFilter?: boolean; // If true, failing displacement can SKIP; if false, only confluence scoring (default: true for backward compat)
  strongBodyMinPct?: number; // Body% threshold for strong bonus (default: 45)
  neutralBodyMinPct?: number; // Body% threshold for neutral (default: 30)
  strongAtrMinMultiple?: number; // ATR multiple threshold for strong bonus (default: 1.3)
  neutralAtrMinMultiple?: number; // ATR multiple threshold for neutral (default: 0.8)
  directionPenalty?: number; // Penalty for direction mismatch (default: -10)
  weakPenalty?: number; // Penalty for weak body/ATR (default: -5)
  strongBonus?: number; // Bonus for strong body/ATR (default: +10)
}

export interface DisplacementCheckMetrics {
  atr: number;
  candleTrueRange: number;
  trMultiple: number; // candleTrueRange / ATR
  bodyPct: number; // (body / range) * 100
}

export interface DisplacementCheckResult {
  isValid: boolean; // Basic boolean validity using legacy strict rules (body >= 60%, TR >= minATRMultiplier, direction match)
  score: number; // Confluence contribution, can be negative or positive
  reasons: string[]; // Human-readable reasons, e.g. ["body too weak", "ATR too small"]
  metrics: DisplacementCheckMetrics;
}

export class DisplacementCheckService {
  private configs: Map<string, DisplacementCheckConfig>;

  constructor(configs: DisplacementCheckConfig[] = []) {
    this.configs = new Map();
    configs.forEach(config => {
      this.configs.set(config.symbol.toUpperCase(), config);
    });
  }

  /**
   * Check if displacement candle meets ATR-based requirements
   * v15c: Returns score-based result instead of boolean for soft confluence integration
   * 
   * @param symbol - Trading symbol
   * @param candles - Timeframe candles (should be ITF or LTF for displacement detection)
   * @param direction - Trade direction ('buy' or 'sell')
   * @returns Displacement check result with score, reasons, and metrics
   */
  checkDisplacement(
    symbol: string,
    candles: Candle[],
    direction: 'buy' | 'sell'
  ): DisplacementCheckResult {
    const config = this.configs.get(symbol.toUpperCase());
    
    // If no config for this symbol, return neutral pass-through (backward compatible)
    if (!config) {
      return {
        isValid: true,
        score: 0,
        reasons: [],
        metrics: {
          atr: 0,
          candleTrueRange: 0,
          trMultiple: 0,
          bodyPct: 0,
        },
      };
    }

    // Default scoring thresholds
    const strongBodyMinPct = config.strongBodyMinPct ?? 45;
    const neutralBodyMinPct = config.neutralBodyMinPct ?? 30;
    const strongAtrMinMultiple = config.strongAtrMinMultiple ?? 1.3;
    const neutralAtrMinMultiple = config.neutralAtrMinMultiple ?? 0.8;
    const directionPenalty = config.directionPenalty ?? -10;
    const weakPenalty = config.weakPenalty ?? -5;
    const strongBonus = config.strongBonus ?? 10;

    if (candles.length < config.atrLookbackPeriod + 2) {
      return {
        isValid: false,
        score: -20, // Heavy penalty for insufficient data
        reasons: [`Insufficient candles for displacement check (need ${config.atrLookbackPeriod + 2}, got ${candles.length})`],
        metrics: {
          atr: 0,
          candleTrueRange: 0,
          trMultiple: 0,
          bodyPct: 0,
        },
      };
    }

    // Calculate ATR (Average True Range) from historical candles
    const atrLookback = Math.min(config.atrLookbackPeriod, candles.length - 2);
    const atrCandles = candles.slice(-atrLookback - 1, -1); // Last N+1 candles (exclude current)
    
    const trueRanges: number[] = [];
    for (let i = 1; i < atrCandles.length; i++) {
      const current = atrCandles[i];
      const previous = atrCandles[i - 1];
      
      // True Range = max(high - low, abs(high - previous.close), abs(low - previous.close))
      const tr1 = current.high - current.low;
      const tr2 = Math.abs(current.high - previous.close);
      const tr3 = Math.abs(current.low - previous.close);
      const trueRange = Math.max(tr1, tr2, tr3);
      trueRanges.push(trueRange);
    }

    if (trueRanges.length === 0) {
      // Pass through if we can't calculate ATR
      return {
        isValid: true,
        score: 0,
        reasons: [],
        metrics: {
          atr: 0,
          candleTrueRange: 0,
          trMultiple: 0,
          bodyPct: 0,
        },
      };
    }

    // Calculate ATR as the average of true ranges
    const atr = trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;

    // Check the most recent candle (candidate displacement candle)
    const lastCandle = candles[candles.length - 1];
    const previousCandle = candles[candles.length - 2];
    
    // True Range of the last candle
    const lastTrueRange = Math.max(
      lastCandle.high - lastCandle.low,
      Math.abs(lastCandle.high - previousCandle.close),
      Math.abs(lastCandle.low - previousCandle.close)
    );

    // Calculate body percentage
    const candleBody = Math.abs(lastCandle.close - lastCandle.open);
    const candleRange = lastCandle.high - lastCandle.low;
    const bodyPct = candleRange > 0 ? (candleBody / candleRange) * 100 : 0;
    
    // Check direction alignment
    const isBuyDirection = direction === 'buy';
    const isBullishCandle = lastCandle.close > lastCandle.open;
    const isBearishCandle = lastCandle.close < lastCandle.open;
    const directionAligned = (isBuyDirection && isBullishCandle) || (!isBuyDirection && isBearishCandle);

    // Calculate ATR multiple
    const trMultiple = atr > 0 ? lastTrueRange / atr : 0;

    // Build metrics
    const metrics: DisplacementCheckMetrics = {
      atr,
      candleTrueRange: lastTrueRange,
      trMultiple,
      bodyPct,
    };

    // Calculate score based on new scoring scheme
    let score = 0;
    const reasons: string[] = [];

    // 1. Body percentage scoring
    if (bodyPct >= strongBodyMinPct) {
      score += strongBonus;
    } else if (bodyPct >= neutralBodyMinPct) {
      // Neutral: no bonus/penalty
      score += 0;
    } else {
      score += weakPenalty;
      reasons.push(`body too weak: ${bodyPct.toFixed(1)}% < ${neutralBodyMinPct}%`);
    }

    // 2. True range vs ATR scoring
    if (trMultiple >= strongAtrMinMultiple) {
      score += strongBonus;
    } else if (trMultiple >= neutralAtrMinMultiple) {
      // Neutral: no bonus/penalty
      score += 0;
    } else {
      score += weakPenalty;
      reasons.push(`true range too small: ${trMultiple.toFixed(2)}x < ${neutralAtrMinMultiple}x`);
    }

    // 3. Direction alignment scoring
    if (!directionAligned) {
      score += directionPenalty;
      reasons.push(`displacement direction doesn't align with trade direction`);
    }

    // Calculate isValid using legacy strict rules (for backward compatibility)
    // Legacy: body >= 60%, TR >= minATRMultiplier, direction match
    const hasStrongBody = bodyPct >= 60;
    const meetsATRRequirement = trMultiple >= config.minATRMultiplier;
    const isValid = hasStrongBody && directionAligned && meetsATRRequirement;

    return {
      isValid,
      score,
      reasons,
      metrics,
    };
  }

  /**
   * Get displacement check config for a symbol
   */
  getConfig(symbol: string): DisplacementCheckConfig | undefined {
    return this.configs.get(symbol.toUpperCase());
  }

  /**
   * Check if symbol has displacement check configured
   */
  hasConfig(symbol: string): boolean {
    return this.configs.has(symbol.toUpperCase());
  }
}

