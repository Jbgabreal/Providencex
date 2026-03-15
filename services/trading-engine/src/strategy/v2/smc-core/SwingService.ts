/**
 * SwingService - Formal Swing Detection (SMC Core)
 * 
 * Implements both fractal/pivot-based and rolling lookback methods
 * Based on SMC_research.md Section 2.1
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../../marketData/types';
import { SwingPoint, SwingConfig, CandleData, BosConfirmedSwingState, candlesToData } from './Types';

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
      case 'bos-confirmed':
        return this.detectBosConfirmedSwings(candleData);
      default:
        return this.detectFractalSwings(candleData);
    }
  }

  /**
   * Get BOS-confirmed swing state (structural range, equilibrium)
   * Only meaningful when using 'bos-confirmed' method
   */
  getBosConfirmedState(candles: Candle[]): BosConfirmedSwingState {
    const candleData = candlesToData(candles);
    const swings = this.detectBosConfirmedSwings(candleData);

    const highs = swings.filter(s => s.type === 'high');
    const lows = swings.filter(s => s.type === 'low');

    const lastHigh = highs.length > 0 ? highs[highs.length - 1] : null;
    const lastLow = lows.length > 0 ? lows[lows.length - 1] : null;

    let structuralRange: { high: number; low: number } | null = null;
    let equilibrium: number | null = null;

    if (lastHigh && lastLow) {
      structuralRange = { high: lastHigh.price, low: lastLow.price };
      equilibrium = lastLow.price + (lastHigh.price - lastLow.price) * 0.5;
    }

    return {
      lastConfirmedSwingHigh: lastHigh,
      lastConfirmedSwingLow: lastLow,
      structuralRange,
      equilibrium,
    };
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
   * Approach 4: BOS-Confirmed Swing Detection (ICT State Machine)
   *
   * ICT rule for confirmed swings:
   * 1. Detect fractal candidates (local high/low using pivotLeft/pivotRight)
   * 2. A swing HIGH candidate is CONFIRMED only when a subsequent candle CLOSES ABOVE it
   * 3. A swing LOW candidate is CONFIRMED only when a subsequent candle CLOSES BELOW it
   * 4. Wick-only break (high > candidate but close <= candidate) = liquidity sweep, NOT confirmation
   * 5. Maintain lastConfirmedSwingHigh and lastConfirmedSwingLow state
   * 6. Update on each confirmation event
   *
   * This produces fewer, higher-quality swings that represent true structural levels.
   */
  private detectBosConfirmedSwings(candles: CandleData[]): SwingPoint[] {
    const { pivotLeft = 3, pivotRight = 3 } = this.config;
    const smcDebug = process.env.SMC_DEBUG === 'true';

    if (candles.length < pivotLeft + pivotRight + 1) {
      return [];
    }

    // Step 1: Find all fractal candidates
    const candidates: SwingPoint[] = [];
    for (let i = pivotLeft; i < candles.length - pivotRight; i++) {
      const current = candles[i];
      let isHighCandidate = true;
      let isLowCandidate = true;

      for (let j = i - pivotLeft; j <= i + pivotRight; j++) {
        if (j === i) continue;
        if (candles[j].high >= current.high) isHighCandidate = false;
        if (candles[j].low <= current.low) isLowCandidate = false;
        if (!isHighCandidate && !isLowCandidate) break;
      }

      if (isHighCandidate) {
        candidates.push({ index: i, type: 'high', price: current.high, timestamp: current.timestamp });
      }
      if (isLowCandidate) {
        candidates.push({ index: i, type: 'low', price: current.low, timestamp: current.timestamp });
      }
    }

    // Step 2: State machine — confirm candidates via BOS (candle CLOSE beyond)
    const confirmed: SwingPoint[] = [];
    const confirmedSet = new Set<number>(); // track confirmed candidate indices

    // Process candles after each candidate to check for BOS confirmation
    for (const candidate of candidates) {
      if (confirmedSet.has(candidate.index)) continue;

      // Look at all subsequent candles for BOS confirmation
      for (let i = candidate.index + 1; i < candles.length; i++) {
        const candle = candles[i];

        if (candidate.type === 'high') {
          // Swing HIGH confirmed when candle CLOSES above it
          if (candle.close > candidate.price) {
            confirmed.push(candidate);
            confirmedSet.add(candidate.index);
            if (smcDebug) {
              logger.info(
                `[SwingService] BOS-confirmed swing HIGH: ${candidate.price.toFixed(2)} at idx ${candidate.index}, ` +
                `confirmed by close ${candle.close.toFixed(2)} at idx ${i}`
              );
            }
            break;
          }
          // If a LOWER high candidate appears before confirmation, this one may be superseded
          // but we still wait for BOS confirmation of the original
        } else {
          // Swing LOW confirmed when candle CLOSES below it
          if (candle.close < candidate.price) {
            confirmed.push(candidate);
            confirmedSet.add(candidate.index);
            if (smcDebug) {
              logger.info(
                `[SwingService] BOS-confirmed swing LOW: ${candidate.price.toFixed(2)} at idx ${candidate.index}, ` +
                `confirmed by close ${candle.close.toFixed(2)} at idx ${i}`
              );
            }
            break;
          }
        }
      }
    }

    return confirmed.sort((a, b) => a.index - b.index);
  }

  /**
   * Detect liquidity sweeps — wick beyond swing but no close beyond
   * Returns sweep events (useful for ICT entry model: sweep = entry trigger)
   */
  detectLiquiditySweeps(candles: Candle[], confirmedSwings: SwingPoint[]): Array<{
    index: number;        // candle that swept
    sweptSwing: SwingPoint;
    sweepPrice: number;   // the wick extreme
    timestamp: number;
  }> {
    const candleData = candlesToData(candles);
    const sweeps: Array<{ index: number; sweptSwing: SwingPoint; sweepPrice: number; timestamp: number }> = [];
    const sweptSet = new Set<number>();

    for (let i = 0; i < candleData.length; i++) {
      const candle = candleData[i];

      for (const swing of confirmedSwings) {
        if (swing.index >= i) continue;
        if (sweptSet.has(swing.index)) continue;

        if (swing.type === 'high') {
          // Liquidity sweep: wick above swing high but close <= swing high
          if (candle.high > swing.price && candle.close <= swing.price) {
            sweeps.push({
              index: i,
              sweptSwing: swing,
              sweepPrice: candle.high,
              timestamp: candle.timestamp,
            });
            sweptSet.add(swing.index);
          }
        } else {
          // Liquidity sweep: wick below swing low but close >= swing low
          if (candle.low < swing.price && candle.close >= swing.price) {
            sweeps.push({
              index: i,
              sweptSwing: swing,
              sweepPrice: candle.low,
              timestamp: candle.timestamp,
            });
            sweptSet.add(swing.index);
          }
        }
      }
    }

    return sweeps.sort((a, b) => a.index - b.index);
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

