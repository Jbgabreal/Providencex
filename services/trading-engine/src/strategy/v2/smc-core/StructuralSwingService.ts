/**
 * StructuralSwingService - 3-Impulse Rule Structural Swing Detection
 * 
 * Implements structural swing legs based on 3+ impulse candles in the same direction,
 * with pullback candles allowed between impulses.
 * 
 * Impulse Candle Rules:
 * - Bearish impulse: low < previous bearish impulse low (must break extreme)
 * - Bullish impulse: high > previous bullish impulse high (must break extreme)
 * 
 * Pullback Rules:
 * - Pullback candles (opposite direction or weak same-direction) are allowed
 * - For bearish leg: pullback must not close above last bearish impulse high
 * - For bullish leg: pullback must not close below last bullish impulse low
 * - If pullback violates, leg is finished and new leg starts
 * 
 * Leg Requirements:
 * - Must have at least 3 impulse candles to be valid
 * - Swing high/low calculated from all candles between first and last impulse
 * 
 * This produces cleaner swings that match TradingView SMC indicators.
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../../marketData/types';
import { StructuralSwingLeg, StructuralSwing, CandleData, candlesToData } from './Types';

const logger = new Logger('StructuralSwingService');

/**
 * Internal representation of a leg being built
 */
type LegBuilder = {
  direction: 'bullish' | 'bearish';
  startIndex: number; // Index of first impulse candle
  impulseCandles: Array<{ index: number; candle: CandleData }>; // Only impulse candles
  allCandles: Array<{ index: number; candle: CandleData }>; // All candles in leg (impulses + pullbacks)
  lastImpulseHigh: number; // Last impulse candle's high (for bullish) or low (for bearish)
  lastImpulseLow: number;
  lastImpulseClose: number;
};

export class StructuralSwingService {
  private minImpulsesPerLeg: number;

  constructor(minImpulsesPerLeg: number = 3) {
    this.minImpulsesPerLeg = minImpulsesPerLeg;
  }

  /**
   * Detect structural swing legs using 3-impulse rule with pullbacks
   * Returns StructuralSwingLeg[] sorted by startIndex
   */
  detectStructuralLegs(candles: Candle[]): StructuralSwingLeg[] {
    const candleData = candlesToData(candles);
    const legs: StructuralSwingLeg[] = [];

    if (candleData.length < this.minImpulsesPerLeg) {
      return legs;
    }

    let currentLeg: LegBuilder | null = null;

    for (let i = 0; i < candleData.length; i++) {
      const candle = candleData[i];
      const direction = this.getCandleDirection(candle);

      // Skip neutral candles (they don't contribute to structure)
      if (direction === 'neutral') {
        continue;
      }

      // Check if this candle belongs to the current leg
      if (currentLeg) {
        // Check if this candle violates the leg (regardless of direction)
        const violates = this.doesCandleViolateLeg(
          candle,
          currentLeg.direction,
          currentLeg.lastImpulseHigh,
          currentLeg.lastImpulseLow
        );

        if (violates) {
          // Leg is finished, close it
          const legToClose = currentLeg;
          if (legToClose.impulseCandles.length >= this.minImpulsesPerLeg) {
            const leg = this.createLegFromBuilder(legToClose);
            if (leg) {
              legs.push(leg);
            }
          }
          currentLeg = null;
          // Try to start a new leg with this candle
          i--; // Re-process this candle
          continue;
        }

        // Candle doesn't violate, check if it's an impulse
        if (currentLeg.direction === direction) {
          const isImpulse = this.isImpulseCandle(
            candle,
            direction,
            currentLeg.lastImpulseHigh,
            currentLeg.lastImpulseLow,
            currentLeg.lastImpulseClose
          );

          if (isImpulse) {
            // Add as impulse candle
            currentLeg.impulseCandles.push({ index: i, candle });
            currentLeg.allCandles.push({ index: i, candle });
            currentLeg.lastImpulseHigh = candle.high;
            currentLeg.lastImpulseLow = candle.low;
            currentLeg.lastImpulseClose = candle.close;
          } else {
            // Not an impulse, but valid pullback (doesn't violate)
            currentLeg.allCandles.push({ index: i, candle });
          }
        } else {
          // Opposite direction candle - valid pullback (doesn't violate)
          currentLeg.allCandles.push({ index: i, candle });
        }
      } else {
        // No current leg - start new leg with this candle as first impulse
        currentLeg = {
          direction: direction as 'bullish' | 'bearish',
          startIndex: i,
          impulseCandles: [{ index: i, candle }],
          allCandles: [{ index: i, candle }],
          lastImpulseHigh: candle.high,
          lastImpulseLow: candle.low,
          lastImpulseClose: candle.close,
        };
      }
    }

    // Close final leg if it has enough impulses
    if (currentLeg && currentLeg.impulseCandles.length >= this.minImpulsesPerLeg) {
      const leg = this.createLegFromBuilder(currentLeg);
      if (leg) {
        legs.push(leg);
      }
    }

    return legs;
  }

  /**
   * Convert structural legs to alternating structural swings
   * Returns StructuralSwing[] sorted by index
   */
  legsToSwings(legs: StructuralSwingLeg[]): StructuralSwing[] {
    const swings: StructuralSwing[] = [];

    if (legs.length === 0) {
      return swings;
    }

    // Calculate average leg length for major swing detection
    const avgLegLength = legs.reduce((sum, leg) => sum + leg.candleCount, 0) / legs.length;
    const majorThreshold = avgLegLength * 1.5; // Legs 50% longer than average are major

    // Calculate average price range for major swing detection
    const avgRange = legs.reduce((sum, leg) => sum + (leg.swingHigh - leg.swingLow), 0) / legs.length;
    const majorRangeThreshold = avgRange * 1.5;

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const isMajor = leg.candleCount >= majorThreshold || 
                      (leg.swingHigh - leg.swingLow) >= majorRangeThreshold;

      if (leg.direction === 'bullish') {
        // Bullish leg creates a swing high
        swings.push({
          index: leg.highIndex,
          type: 'high',
          price: leg.swingHigh,
          timestamp: leg.startIndex, // Use start index for timestamp (will be corrected)
          leg,
          isMajor,
        });
      } else {
        // Bearish leg creates a swing low
        swings.push({
          index: leg.lowIndex,
          type: 'low',
          price: leg.swingLow,
          timestamp: leg.startIndex, // Use start index for timestamp (will be corrected)
          leg,
          isMajor,
        });
      }
    }

    // Sort by index
    return swings.sort((a, b) => a.index - b.index);
  }

  /**
   * Detect structural swings directly from candles
   * Combines detectStructuralLegs and legsToSwings
   */
  detectStructuralSwings(candles: Candle[]): StructuralSwing[] {
    const legs = this.detectStructuralLegs(candles);
    const swings = this.legsToSwings(legs);

    // Fix timestamps from candle data
    for (const swing of swings) {
      if (swing.index < candles.length) {
        swing.timestamp = candles[swing.index].startTime.getTime();
      }
    }

    return swings;
  }

  /**
   * Get candle direction: bullish, bearish, or neutral
   */
  private getCandleDirection(candle: CandleData): 'bullish' | 'bearish' | 'neutral' {
    if (candle.close > candle.open) {
      return 'bullish';
    } else if (candle.close < candle.open) {
      return 'bearish';
    } else {
      return 'neutral';
    }
  }

  /**
   * Check if a candle is an impulse candle
   * 
   * Bearish impulse: low < previous bearish impulse low, and ideally high <= previous high, close < previous close
   * Bullish impulse: high > previous bullish impulse high, and ideally low >= previous low, close > previous close
   */
  private isImpulseCandle(
    candle: CandleData,
    direction: 'bullish' | 'bearish',
    lastImpulseHigh: number,
    lastImpulseLow: number,
    lastImpulseClose: number
  ): boolean {
    if (direction === 'bearish') {
      // Bearish impulse: low must be strictly lower than previous bearish impulse low
      if (candle.low >= lastImpulseLow) {
        return false;
      }
      // Additional filters (ideally): high not higher, close below previous close
      // These are soft requirements - we can be lenient
      return true;
    } else {
      // Bullish impulse: high must be strictly higher than previous bullish impulse high
      if (candle.high <= lastImpulseHigh) {
        return false;
      }
      // Additional filters (ideally): low not lower, close above previous close
      return true;
    }
  }

  /**
   * Check if a candle violates the leg
   * 
   * For bearish leg: any candle closes above last bearish impulse high -> violation
   * For bullish leg: any candle closes below last bullish impulse low -> violation
   */
  private doesCandleViolateLeg(
    candle: CandleData,
    legDirection: 'bullish' | 'bearish',
    lastImpulseHigh: number,
    lastImpulseLow: number
  ): boolean {
    if (legDirection === 'bearish') {
      // Bearish leg: violation if candle closes above last bearish impulse high
      return candle.close > lastImpulseHigh;
    } else {
      // Bullish leg: violation if candle closes below last bullish impulse low
      return candle.close < lastImpulseLow;
    }
  }

  /**
   * Create a structural leg from a leg builder
   */
  private createLegFromBuilder(builder: LegBuilder): StructuralSwingLeg | null {
    if (builder.impulseCandles.length < this.minImpulsesPerLeg) {
      return null;
    }

    // Calculate swing high and low from ALL candles in the leg (first to last impulse)
    const firstImpulseIndex = builder.impulseCandles[0].index;
    const lastImpulseIndex = builder.impulseCandles[builder.impulseCandles.length - 1].index;

    let swingHigh = -Infinity;
    let swingLow = Infinity;
    let highIndex = firstImpulseIndex;
    let lowIndex = firstImpulseIndex;

    // Find swing high and low within all candles from first to last impulse
    for (const { index, candle } of builder.allCandles) {
      if (index < firstImpulseIndex || index > lastImpulseIndex) {
        continue; // Only consider candles between first and last impulse
      }

      if (candle.high > swingHigh) {
        swingHigh = candle.high;
        highIndex = index;
      }

      if (candle.low < swingLow) {
        swingLow = candle.low;
        lowIndex = index;
      }
    }

    return {
      startIndex: firstImpulseIndex,
      endIndex: lastImpulseIndex,
      direction: builder.direction,
      swingHigh,
      swingLow,
      highIndex,
      lowIndex,
      candleCount: builder.allCandles.filter(
        c => c.index >= firstImpulseIndex && c.index <= lastImpulseIndex
      ).length,
    };
  }

  /**
   * Get structural swings by type
   */
  getStructuralSwingHighs(swings: StructuralSwing[]): StructuralSwing[] {
    return swings.filter(s => s.type === 'high');
  }

  getStructuralSwingLows(swings: StructuralSwing[]): StructuralSwing[] {
    return swings.filter(s => s.type === 'low');
  }

  /**
   * Get major structural swings
   */
  getMajorSwings(swings: StructuralSwing[]): StructuralSwing[] {
    return swings.filter(s => s.isMajor);
  }
}

