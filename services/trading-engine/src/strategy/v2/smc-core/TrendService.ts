/**
 * TrendService - Formal Trend Bias Calculation (SMC Core)
 * 
 * Implements HH/HL & LH/LL pattern detection + PD array calculation
 * Based on SMC_research.md Section 2.4
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../../marketData/types';
import {
  SwingPoint,
  BosEvent,
  TrendBiasSnapshot,
  TrendConfig,
  TrendBias,
  CandleData,
  candlesToData,
} from './Types';

const logger = new Logger('TrendService');

export class TrendService {
  private config: TrendConfig;

  constructor(config: Partial<TrendConfig> = {}) {
    this.config = {
      minSwingPairs: config.minSwingPairs ?? 1, // Reduced from 2 to 1 for better detection with limited candles
      discountMax: config.discountMax ?? 0.5,
      premiumMin: config.premiumMin ?? 0.5,
    };
  }

  /**
   * Compute trend bias and PD array position for each candle
   * 
   * Returns TrendBiasSnapshot[] (same length as candles)
   */
  computeTrendBias(
    candles: Candle[],
    swings: SwingPoint[],
    bosEvents: BosEvent[]
  ): TrendBiasSnapshot[] {
    const candleData = candlesToData(candles);
    const results: TrendBiasSnapshot[] = [];

    // Sort swings and BOS by index
    const swingsSorted = swings.slice().sort((a, b) => a.index - b.index);
    const bosByIndex = new Map<number, BosEvent[]>();
    for (const bos of bosEvents) {
      if (!bosByIndex.has(bos.index)) {
        bosByIndex.set(bos.index, []);
      }
      bosByIndex.get(bos.index)!.push(bos);
    }

    // Track state as we process candles
    let currentTrend: TrendBias = 'sideways';
    let lastSwingHigh: number | null = null;
    let lastSwingLow: number | null = null;
    let lastBosDirection: 'bullish' | 'bearish' | null = null;

    // Track recent swing highs and lows for pattern detection
    const recentHighs: number[] = [];
    const recentLows: number[] = [];

    for (let i = 0; i < candleData.length; i++) {
      const candle = candleData[i];

      // Update swings up to this index
      const activeSwings = swingsSorted.filter(s => s.index <= i);
      const highs = activeSwings.filter(s => s.type === 'high');
      const lows = activeSwings.filter(s => s.type === 'low');

      // Update last swing high/low
      if (highs.length > 0) {
        const latestHigh = highs[highs.length - 1];
        if (latestHigh.price !== lastSwingHigh) {
          lastSwingHigh = latestHigh.price;
          recentHighs.push(latestHigh.price);
          // Keep only last N highs
          if (recentHighs.length > this.config.minSwingPairs + 2) {
            recentHighs.shift();
          }
        }
      }

      if (lows.length > 0) {
        const latestLow = lows[lows.length - 1];
        if (latestLow.price !== lastSwingLow) {
          lastSwingLow = latestLow.price;
          recentLows.push(latestLow.price);
          // Keep only last N lows
          if (recentLows.length > this.config.minSwingPairs + 2) {
            recentLows.shift();
          }
        }
      }

      // Update last BOS direction if one occurs at this index
      if (bosByIndex.has(i)) {
        const bosAtIndex = bosByIndex.get(i)!;
        // Get the last BOS (most recent)
        const lastBos = bosAtIndex[bosAtIndex.length - 1];
        lastBosDirection = lastBos.direction;
      }

      // Determine structural trend from recent swings
      currentTrend = this.inferTrendFromSwings(
        recentHighs,
        recentLows,
        lastBosDirection
      );

      // Compute PD position
      const pdPosition = this.computePdPosition(
        candle.close,
        lastSwingLow,
        lastSwingHigh
      );

      // Create snapshot
      results.push({
        index: i,
        timestamp: candle.timestamp,
        trend: currentTrend,
        lastSwingHigh,
        lastSwingLow,
        lastBosDirection,
        pdPosition,
        swingHighs: [...recentHighs],
        swingLows: [...recentLows],
      });
    }

    return results;
  }

  /**
   * Infer trend from recent swing pattern
   * 
   * If there are at least minSwingPairs highs and lows:
   * - If each new high > previous high and new low > previous low and lastBosDirection === 'bullish' → bullish
   * - If each new high < previous high and new low < previous low and lastBosDirection === 'bearish' → bearish
   * - Else → sideways
   * 
   * Fallback: If insufficient swings, use relaxed criteria (at least 1 swing of each type)
   */
  private inferTrendFromSwings(
    recentHighs: number[],
    recentLows: number[],
    lastBosDirection: 'bullish' | 'bearish' | null
  ): TrendBias {
    // STRICT: Require at least 2 swing highs AND 2 swing lows to confirm trend
    // Bullish = HH + HL (higher highs and higher lows)
    // Bearish = LH + LL (lower highs and lower lows)
    // Anything less = sideways (no guessing from a single BOS)
    if (recentHighs.length < 2 || recentLows.length < 2) {
      return 'sideways';
    }

    // Check for bullish pattern: each successive high > previous, each successive low > previous
    let isBullish = true;
    for (let i = 1; i < recentHighs.length; i++) {
      if (recentHighs[i] <= recentHighs[i - 1]) {
        isBullish = false;
        break;
      }
    }
    if (isBullish) {
      for (let i = 1; i < recentLows.length; i++) {
        if (recentLows[i] <= recentLows[i - 1]) {
          isBullish = false;
          break;
        }
      }
    }
    if (isBullish) {
      return 'bullish';
    }

    // Check for bearish pattern: each successive high < previous, each successive low < previous
    let isBearish = true;
    for (let i = 1; i < recentHighs.length; i++) {
      if (recentHighs[i] >= recentHighs[i - 1]) {
        isBearish = false;
        break;
      }
    }
    if (isBearish) {
      for (let i = 1; i < recentLows.length; i++) {
        if (recentLows[i] >= recentLows[i - 1]) {
          isBearish = false;
          break;
        }
      }
    }
    if (isBearish) {
      return 'bearish';
    }

    return 'sideways';
  }

  /**
   * Compute PD array position
   * 
   * Returns 0..1 where 0 = at lastSwingLow, 1 = at lastSwingHigh
   * Returns null if invalid (no swings or equal high/low)
   */
  private computePdPosition(
    price: number,
    low: number | null,
    high: number | null
  ): number | null {
    if (low == null || high == null || high === low) {
      return null;
    }
    return (price - low) / (high - low);
  }

  /**
   * Determine if price is in discount zone
   */
  isInDiscount(pdPosition: number | null): boolean {
    if (pdPosition == null) return false;
    return pdPosition <= this.config.discountMax;
  }

  /**
   * Determine if price is in premium zone
   */
  isInPremium(pdPosition: number | null): boolean {
    if (pdPosition == null) return false;
    return pdPosition >= this.config.premiumMin;
  }

  /**
   * Get trend at a specific candle index
   */
  getTrendAt(snapshots: TrendBiasSnapshot[], index: number): TrendBias {
    if (index < 0 || index >= snapshots.length) {
      return 'sideways';
    }
    return snapshots[index].trend;
  }

  /**
   * Get PD position at a specific candle index
   */
  getPdPositionAt(snapshots: TrendBiasSnapshot[], index: number): number | null {
    if (index < 0 || index >= snapshots.length) {
      return null;
    }
    return snapshots[index].pdPosition ?? null;
  }
}

