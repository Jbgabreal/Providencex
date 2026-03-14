/**
 * SwingService - Formal Swing Detection (SMC Core)
 * 
 * Implements both fractal/pivot-based and rolling lookback methods
 * Based on SMC_research.md Section 2.1
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../../marketData/types';
import { SwingPoint, SwingConfig, CandleData, candlesToData } from './Types';

const logger = new Logger('SwingService');

export class SwingService {
  private config: SwingConfig;

  constructor(config: Partial<SwingConfig> = {}) {
    this.config = {
      method: config.method || 'hybrid',
      pivotLeft: config.pivotLeft ?? 3,
      pivotRight: config.pivotRight ?? 3,
      lookbackHigh: config.lookbackHigh ?? 20,
      lookbackLow: config.lookbackLow ?? 20,
    };
  }

  /**
   * Detect swings using configured method
   * Returns SwingPoint[] sorted by index
   */
  detectSwings(candles: Candle[]): SwingPoint[] {
    const candleData = candlesToData(candles);
    
    switch (this.config.method) {
      case 'fractal':
        return this.detectFractalSwings(candleData);
      case 'rolling':
        return this.detectRollingSwings(candleData);
      case 'hybrid':
        return this.detectHybridSwings(candleData);
      default:
        return this.detectFractalSwings(candleData);
    }
  }

  /**
   * Approach 1: Fractal/Pivot-Based Detection
   * 
   * A candle at index i is a swing high if its high is the maximum among
   * [i - pivotLeft, ..., i + pivotRight].
   * 
   * Non-repainting but delayed by pivotRight bars.
   */
  private detectFractalSwings(candles: CandleData[]): SwingPoint[] {
    const swings: SwingPoint[] = [];
    const { pivotLeft = 3, pivotRight = 3 } = this.config;

    // Cannot detect swings until we have enough candles
    if (candles.length < pivotLeft + pivotRight + 1) {
      return swings;
    }

    // Start from pivotLeft, end at length - pivotRight (ensures no lookahead)
    for (let i = pivotLeft; i < candles.length - pivotRight; i++) {
      const currentCandle = candles[i];
      let isSwingHigh = true;
      let isSwingLow = true;

      // Check all candles in the window [i - pivotLeft, ..., i + pivotRight]
      for (let j = i - pivotLeft; j <= i + pivotRight; j++) {
        if (j === i) continue;

        const compareCandle = candles[j];
        
        // Check swing high: current high must be strictly higher than all others
        if (compareCandle.high >= currentCandle.high) {
          isSwingHigh = false;
        }
        
        // Check swing low: current low must be strictly lower than all others
        if (compareCandle.low <= currentCandle.low) {
          isSwingLow = false;
        }

        // Early exit if both are false
        if (!isSwingHigh && !isSwingLow) break;
      }

      // Add swing high if detected
      if (isSwingHigh) {
        swings.push({
          index: i,
          type: 'high',
          price: currentCandle.high,
          timestamp: currentCandle.timestamp,
        });
      }

      // Add swing low if detected
      if (isSwingLow) {
        swings.push({
          index: i,
          type: 'low',
          price: currentCandle.low,
          timestamp: currentCandle.timestamp,
        });
      }
    }

    // Sort by index (already sorted, but ensure)
    return swings.sort((a, b) => a.index - b.index);
  }

  /**
   * Approach 2: Rolling Lookback Detection
   *
   * At each candle i, define:
   * - rolling swing high: max high in [i - lookbackHigh + 1, ..., i]
   * - rolling swing low: min low in [i - lookbackLow + 1, ..., i]
   *
   * When the max/min index changes AND the old max/min is no longer in the window,
   * treat the old one as a confirmed swing and start tracking the new one.
   *
   * This detects ALL swing highs and lows (including lower highs and higher lows),
   * which is essential for HH/HL and LH/LL pattern detection.
   */
  private detectRollingSwings(candles: CandleData[]): SwingPoint[] {
    const swings: SwingPoint[] = [];
    const { lookbackHigh = 20, lookbackLow = 20 } = this.config;

    // Adaptive lookback: reduce if we have fewer candles
    const adaptiveLookbackHigh = Math.min(lookbackHigh, Math.max(5, Math.floor(candles.length * 0.5)));
    const adaptiveLookbackLow = Math.min(lookbackLow, Math.max(5, Math.floor(candles.length * 0.5)));

    let lastSwingHighIdx: number | null = null;
    let lastSwingLowIdx: number | null = null;
    // Track the previously confirmed swing index to avoid duplicates
    const confirmedHighIndices = new Set<number>();
    const confirmedLowIndices = new Set<number>();

    for (let i = 0; i < candles.length; i++) {
      // Detect swing highs
      if (i >= adaptiveLookbackHigh - 1) {
        let maxHigh = -Infinity;
        let maxIdx: number | null = null;
        const windowStart = i - adaptiveLookbackHigh + 1;

        // Find max high in [windowStart, ..., i]
        for (let j = windowStart; j <= i; j++) {
          if (candles[j].high >= maxHigh) {
            maxHigh = candles[j].high;
            maxIdx = j;
          }
        }

        // If the max index changed from our last tracked swing high
        if (maxIdx !== null && maxIdx !== lastSwingHighIdx) {
          // The previous swing high has rolled out of the window or been surpassed.
          // Confirm the PREVIOUS swing high as a valid swing point (if it existed
          // and is no longer in the current window or a new peak appeared).
          if (lastSwingHighIdx !== null && !confirmedHighIndices.has(lastSwingHighIdx)) {
            confirmedHighIndices.add(lastSwingHighIdx);
            swings.push({
              index: lastSwingHighIdx,
              type: 'high',
              price: candles[lastSwingHighIdx].high,
              timestamp: candles[lastSwingHighIdx].timestamp,
            });
          }
          lastSwingHighIdx = maxIdx;
        }
      }

      // Detect swing lows
      if (i >= adaptiveLookbackLow - 1) {
        let minLow = Infinity;
        let minIdx: number | null = null;
        const windowStart = i - adaptiveLookbackLow + 1;

        // Find min low in [windowStart, ..., i]
        for (let j = windowStart; j <= i; j++) {
          if (candles[j].low <= minLow) {
            minLow = candles[j].low;
            minIdx = j;
          }
        }

        // If the min index changed from our last tracked swing low
        if (minIdx !== null && minIdx !== lastSwingLowIdx) {
          // Confirm the PREVIOUS swing low as a valid swing point
          if (lastSwingLowIdx !== null && !confirmedLowIndices.has(lastSwingLowIdx)) {
            confirmedLowIndices.add(lastSwingLowIdx);
            swings.push({
              index: lastSwingLowIdx,
              type: 'low',
              price: candles[lastSwingLowIdx].low,
              timestamp: candles[lastSwingLowIdx].timestamp,
            });
          }
          lastSwingLowIdx = minIdx;
        }
      }
    }

    // Confirm the last tracked swings (still in window at end of data)
    if (lastSwingHighIdx !== null && !confirmedHighIndices.has(lastSwingHighIdx)) {
      swings.push({
        index: lastSwingHighIdx,
        type: 'high',
        price: candles[lastSwingHighIdx].high,
        timestamp: candles[lastSwingHighIdx].timestamp,
      });
    }
    if (lastSwingLowIdx !== null && !confirmedLowIndices.has(lastSwingLowIdx)) {
      swings.push({
        index: lastSwingLowIdx,
        type: 'low',
        price: candles[lastSwingLowIdx].low,
        timestamp: candles[lastSwingLowIdx].timestamp,
      });
    }

    // Sort by index
    return swings.sort((a, b) => a.index - b.index);
  }

  /**
   * Hybrid Method: Use fractal for confirmed swings, rolling for recent detection
   * 
   * Combines both approaches:
   * - Fractal for historical swings (more reliable, delayed)
   * - Rolling for recent swings (faster, less reliable)
   * 
   * For limited candles, prefer rolling method (more responsive)
   */
  private detectHybridSwings(candles: CandleData[]): SwingPoint[] {
    const fractalSwings = this.detectFractalSwings(candles);
    const rollingSwings = this.detectRollingSwings(candles);

    // For very limited candles (< 20), prefer rolling method entirely
    // Fractal needs pivotLeft + pivotRight + 1 candles minimum
    const { pivotLeft = 3, pivotRight = 3 } = this.config;
    const minCandlesForFractal = pivotLeft + pivotRight + 1;
    
    if (candles.length < minCandlesForFractal + 5) {
      // Too few candles for reliable fractal detection, use rolling only
      return rollingSwings;
    }

    // Merge and deduplicate by index
    const swingMap = new Map<number, SwingPoint>();

    // Add fractal swings (preferred for historical)
    for (const swing of fractalSwings) {
      swingMap.set(swing.index, swing);
    }

    // Add rolling swings to fill gaps or add recent swings
    // If we have very few fractal swings, use rolling to supplement
    if (fractalSwings.length < 4) {
      // Use rolling swings to supplement (prefer rolling when fractal is sparse)
      for (const swing of rollingSwings) {
        if (!swingMap.has(swing.index)) {
          swingMap.set(swing.index, swing);
        }
      }
    } else {
      // Add rolling swings only if they're more recent than last fractal swing
      const lastFractalIndex = fractalSwings.length > 0 
        ? Math.max(...fractalSwings.map(s => s.index))
        : -1;

      for (const swing of rollingSwings) {
        // Only add rolling swings that are newer than last fractal swing
        if (swing.index > lastFractalIndex) {
          // Check if we already have a swing at this index (from fractal)
          if (!swingMap.has(swing.index)) {
            swingMap.set(swing.index, swing);
          }
        }
      }
    }

    // Convert map to array and sort
    return Array.from(swingMap.values()).sort((a, b) => a.index - b.index);
  }

  /**
   * Get swing highs only
   */
  getSwingHighs(swings: SwingPoint[]): SwingPoint[] {
    return swings.filter(s => s.type === 'high');
  }

  /**
   * Get swing lows only
   */
  getSwingLows(swings: SwingPoint[]): SwingPoint[] {
    return swings.filter(s => s.type === 'low');
  }

  /**
   * Get most recent swing high
   */
  getLastSwingHigh(swings: SwingPoint[]): SwingPoint | null {
    const highs = this.getSwingHighs(swings);
    return highs.length > 0 ? highs[highs.length - 1] : null;
  }

  /**
   * Get most recent swing low
   */
  getLastSwingLow(swings: SwingPoint[]): SwingPoint | null {
    const lows = this.getSwingLows(swings);
    return lows.length > 0 ? lows[lows.length - 1] : null;
  }
}

