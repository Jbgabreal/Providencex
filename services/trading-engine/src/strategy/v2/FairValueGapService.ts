/**
 * FairValueGapService - Detects Fair Value Gaps (FVG) across timeframes (SMC v2)
 * 
 * Detects FVGs on HTF, ITF, and LTF
 * Classifies FVG type (continuation, reversal) and grade (wide, narrow, nested)
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { FairValueGap } from './types';

const logger = new Logger('FairValueGapService');

export class FairValueGapService {
  private minGapSize: number; // Minimum gap size in price units
  private lookbackPeriod: number;

  constructor(minGapSize: number = 0.0001, lookbackPeriod: number = 50) {
    this.minGapSize = minGapSize;
    this.lookbackPeriod = lookbackPeriod;
  }

  /**
   * Detect FVGs on a timeframe
   */
  detectFVGs(
    candles: Candle[],
    timeframe: 'HTF' | 'ITF' | 'LTF',
    premiumDiscount: 'premium' | 'discount' | 'neutral'
  ): FairValueGap[] {
    if (candles.length < 3) return [];

    const fvgs: FairValueGap[] = [];
    const recent = candles.slice(-this.lookbackPeriod);

    // Scan for FVGs: gap between candle 1 high and candle 3 low (bullish FVG)
    // or gap between candle 1 low and candle 3 high (bearish FVG)
    for (let i = 1; i < recent.length - 2; i++) {
      const candle1 = recent[i - 1];
      const candle2 = recent[i];
      const candle3 = recent[i + 1];

      // Bullish FVG: Candle 1 high < Candle 3 low
      if (candle1.high < candle3.low) {
        const gapSize = candle3.low - candle1.high;
        if (gapSize >= this.minGapSize) {
          const fvg = this.classifyFVG(
            candle1.high,
            candle3.low,
            candle2.endTime,
            timeframe,
            'continuation', // Default to continuation
            premiumDiscount,
            candles.length - recent.length + i - 1
          );
          if (fvg) {
            fvgs.push(fvg);
          }
        }
      }

      // Bearish FVG: Candle 1 low > Candle 3 high
      if (candle1.low > candle3.high) {
        const gapSize = candle1.low - candle3.high;
        if (gapSize >= this.minGapSize) {
          const fvg = this.classifyFVG(
            candle3.high,
            candle1.low,
            candle2.endTime,
            timeframe,
            'continuation', // Default to continuation
            premiumDiscount,
            candles.length - recent.length + i - 1
          );
          if (fvg) {
            fvgs.push(fvg);
          }
        }
      }
    }

    return fvgs;
  }

  /**
   * Classify FVG type and grade
   */
  private classifyFVG(
    low: number,
    high: number,
    timestamp: Date,
    timeframe: 'HTF' | 'ITF' | 'LTF',
    type: 'continuation' | 'reversal',
    premiumDiscount: 'premium' | 'discount' | 'neutral',
    startIndex: number
  ): FairValueGap | null {
    const gapSize = high - low;

    // Determine grade based on gap size
    let grade: 'wide' | 'narrow' | 'nested' = 'narrow';
    if (gapSize > this.minGapSize * 3) {
      grade = 'wide';
    } else if (gapSize > this.minGapSize * 1.5) {
      grade = 'narrow';
    } else {
      grade = 'nested';
    }

    return {
      type,
      grade,
      high,
      low,
      timestamp,
      timeframe,
      premiumDiscount,
      filled: false,
      candleIndices: [startIndex, startIndex + 1, startIndex + 2],
    };
  }

  /**
   * Check if FVG is filled by price
   */
  isFVGAnswered(fvg: FairValueGap, currentPrice: number): boolean {
    return currentPrice >= fvg.low && currentPrice <= fvg.high;
  }

  /**
   * Get most recent unfilled FVG
   */
  getMostRecentUnfilledFVG(
    fvgs: FairValueGap[],
    currentPrice: number,
    direction: 'buy' | 'sell'
  ): FairValueGap | undefined {
    // Sort by timestamp (most recent first)
    const sorted = [...fvgs].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Find first unfilled FVG in direction of trade
    for (const fvg of sorted) {
      if (!fvg.filled) {
        if (direction === 'buy' && currentPrice <= fvg.low) {
          return fvg; // Price hasn't reached FVG yet (buy opportunity)
        }
        if (direction === 'sell' && currentPrice >= fvg.high) {
          return fvg; // Price hasn't reached FVG yet (sell opportunity)
        }
      }
    }

    return undefined;
  }
}


