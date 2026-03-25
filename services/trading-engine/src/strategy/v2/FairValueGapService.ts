/**
 * FairValueGapService — ICT Fair Value Gap (FVG) detection
 *
 * Ported from proven implementations:
 * - joshyattridge/smart-money-concepts (Python) — detection logic
 * - LuxAlgo Smart Money Concepts (PineScript) — threshold filtering
 *
 * FVG = 3-candle pattern where an imbalance (gap) exists:
 *   Bullish FVG: candle1.high < candle3.low AND candle2 is bullish (close > open)
 *   Bearish FVG: candle1.low > candle3.high AND candle2 is bearish (close < open)
 *
 * The middle candle (candle2) is the impulse/displacement candle.
 * The gap zone is between candle1 and candle3 — price will retrace to fill it.
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { FairValueGap } from './types';

const logger = new Logger('FairValueGapService');

export class FairValueGapService {
  private lookbackPeriod: number;
  private useAutoThreshold: boolean;

  constructor(minGapSizeOrLookback: number = 50, lookbackOrAuto: number | boolean = true) {
    // Backward compatible: old signature was (minGapSize, lookbackPeriod)
    if (typeof lookbackOrAuto === 'number') {
      this.lookbackPeriod = lookbackOrAuto;
      this.useAutoThreshold = true;
    } else {
      this.lookbackPeriod = typeof minGapSizeOrLookback === 'number' ? minGapSizeOrLookback : 50;
      this.useAutoThreshold = lookbackOrAuto;
    }
  }

  /**
   * Detect FVGs on candle data
   * Returns array of FVGs sorted by recency (newest first)
   */
  detectFVGs(
    candles: Candle[],
    timeframe: 'HTF' | 'ITF' | 'LTF',
    premiumDiscount: 'premium' | 'discount' | 'neutral'
  ): FairValueGap[] {
    if (candles.length < 3) return [];

    const fvgs: FairValueGap[] = [];
    const recent = candles.slice(-this.lookbackPeriod);

    // Auto threshold: average absolute candle body size * 0.5
    // Only keep FVGs larger than this (filters noise)
    let threshold = 0;
    if (this.useAutoThreshold && recent.length > 10) {
      let sumBody = 0;
      for (const c of recent) {
        sumBody += Math.abs(c.close - c.open);
      }
      threshold = (sumBody / recent.length) * 0.5;
    }

    for (let i = 1; i < recent.length - 1; i++) {
      const candle1 = recent[i - 1]; // Previous candle
      const candle2 = recent[i];     // Middle candle (impulse/displacement)
      const candle3 = recent[i + 1]; // Next candle

      // ── Bullish FVG ──
      // candle1.high < candle3.low = gap between them
      // candle2 must be bullish (close > open) = displacement candle
      if (candle1.high < candle3.low && candle2.close > candle2.open) {
        const gapSize = candle3.low - candle1.high;
        if (gapSize > threshold) {
          const globalIdx = candles.length - recent.length + i;
          fvgs.push({
            type: 'continuation',
            grade: this.gradeGap(gapSize, threshold),
            high: candle3.low,    // Top of gap
            low: candle1.high,     // Bottom of gap
            timestamp: candle2.endTime,
            timeframe,
            premiumDiscount,
            filled: false,
            candleIndices: [globalIdx - 1, globalIdx, globalIdx + 1],
          });
        }
      }

      // ── Bearish FVG ──
      // candle1.low > candle3.high = gap between them
      // candle2 must be bearish (close < open) = displacement candle
      if (candle1.low > candle3.high && candle2.close < candle2.open) {
        const gapSize = candle1.low - candle3.high;
        if (gapSize > threshold) {
          const globalIdx = candles.length - recent.length + i;
          fvgs.push({
            type: 'continuation',
            grade: this.gradeGap(gapSize, threshold),
            high: candle1.low,     // Top of gap
            low: candle3.high,     // Bottom of gap
            timestamp: candle2.endTime,
            timeframe,
            premiumDiscount,
            filled: false,
            candleIndices: [globalIdx - 1, globalIdx, globalIdx + 1],
          });
        }
      }
    }

    // Mark FVGs as filled if price has subsequently traded through them
    this.markMitigated(fvgs, candles);

    return fvgs;
  }

  /**
   * Grade the FVG by gap size relative to threshold
   */
  private gradeGap(gapSize: number, threshold: number): 'wide' | 'narrow' | 'nested' {
    if (threshold === 0) return 'narrow';
    if (gapSize > threshold * 4) return 'wide';
    if (gapSize > threshold * 1.5) return 'narrow';
    return 'nested';
  }

  /**
   * Mark FVGs as filled/mitigated when price trades through them
   * An FVG is mitigated when a subsequent candle's body enters the gap zone
   */
  private markMitigated(fvgs: FairValueGap[], candles: Candle[]): void {
    for (const fvg of fvgs) {
      if (fvg.filled || !fvg.candleIndices) continue;

      const startIdx = fvg.candleIndices[2] + 1; // After the FVG pattern
      for (let i = startIdx; i < candles.length; i++) {
        const c = candles[i];
        // Bullish FVG mitigated: price dips into the gap (low enters the zone)
        // Bearish FVG mitigated: price rallies into the gap (high enters the zone)
        if (c.low <= fvg.high && c.high >= fvg.low) {
          fvg.filled = true;
          break;
        }
      }
    }
  }

  /**
   * Get unfilled FVGs near a specific price zone (e.g., near an OB)
   */
  getUnfilledFVGsNearPrice(
    fvgs: FairValueGap[],
    targetLow: number,
    targetHigh: number,
    maxDistance: number
  ): FairValueGap[] {
    return fvgs.filter(fvg => {
      if (fvg.filled) return false;
      // Check if FVG overlaps with or is near the target zone
      const fvgMid = (fvg.high + fvg.low) / 2;
      const targetMid = (targetHigh + targetLow) / 2;
      return Math.abs(fvgMid - targetMid) <= maxDistance;
    });
  }

  /**
   * Check if an FVG exists near a given candle index (for OB+FVG confluence)
   */
  findFVGNearIndex(fvgs: FairValueGap[], targetIndex: number, maxDist: number = 10): FairValueGap | null {
    for (const fvg of fvgs) {
      if (!fvg.candleIndices || fvg.filled) continue;
      const fvgMidIdx = fvg.candleIndices[1];
      if (Math.abs(fvgMidIdx - targetIndex) <= maxDist) {
        return fvg;
      }
    }
    return null;
  }

  /**
   * Check if FVG is filled by price (backward compat)
   */
  isFVGAnswered(fvg: FairValueGap, currentPrice: number): boolean {
    return currentPrice >= fvg.low && currentPrice <= fvg.high;
  }

  /**
   * Get most recent unfilled FVG (backward compat)
   */
  getMostRecentUnfilledFVG(
    fvgs: FairValueGap[],
    currentPrice: number,
    direction: 'buy' | 'sell'
  ): FairValueGap | undefined {
    const sorted = [...fvgs].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    for (const fvg of sorted) {
      if (!fvg.filled) {
        if (direction === 'buy' && currentPrice <= fvg.high) return fvg;
        if (direction === 'sell' && currentPrice >= fvg.low) return fvg;
      }
    }
    return undefined;
  }
}
