/**
 * LiquiditySweepService - Detects liquidity sweeps (EQH/EQL) (SMC v2)
 * 
 * Detects Equal Highs (EQH), Equal Lows (EQL), and stop hunts
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { LiquiditySweepContext } from './types';

const logger = new Logger('LiquiditySweepService');

export interface LiquiditySweepResult {
  type: 'EQH' | 'EQL' | 'sweep';
  level: number;
  timestamp: Date;
  confirmed: boolean;
  timeframe: 'HTF' | 'ITF' | 'LTF';
}

export class LiquiditySweepService {
  private tolerance: number; // Price tolerance for EQH/EQL (in price units)
  private lookbackPeriod: number;

  constructor(tolerance: number = 0.0001, lookbackPeriod: number = 50) {
    this.tolerance = tolerance;
    this.lookbackPeriod = lookbackPeriod;
  }

  /**
   * Detect liquidity sweeps on a timeframe
   */
  detectSweeps(
    candles: Candle[],
    timeframe: 'HTF' | 'ITF' | 'LTF'
  ): LiquiditySweepResult[] {
    if (candles.length < 10) return [];

    const sweeps: LiquiditySweepResult[] = [];
    const recent = candles.slice(-this.lookbackPeriod);

    // Detect Equal Highs (EQH)
    const eqhLevels = this.detectEqualHighs(recent);
    for (const level of eqhLevels) {
      // Check if price swept above EQH level
      const swept = this.checkSweep(recent, level, 'above');
      if (swept) {
        sweeps.push({
          type: 'EQH',
          level,
          timestamp: this.getSweepTimestamp(recent, level, 'above') || recent[recent.length - 1].endTime,
          confirmed: true,
          timeframe,
        });
      }
    }

    // Detect Equal Lows (EQL)
    const eqlLevels = this.detectEqualLows(recent);
    for (const level of eqlLevels) {
      // Check if price swept below EQL level
      const swept = this.checkSweep(recent, level, 'below');
      if (swept) {
        sweeps.push({
          type: 'EQL',
          level,
          timestamp: this.getSweepTimestamp(recent, level, 'below') || recent[recent.length - 1].endTime,
          confirmed: true,
          timeframe,
        });
      }
    }

    return sweeps;
  }

  /**
   * Detect Equal Highs (EQH)
   */
  private detectEqualHighs(candles: Candle[]): number[] {
    const highs: number[] = [];
    const eqhLevels: number[] = [];

    // Collect all highs
    for (const candle of candles) {
      highs.push(candle.high);
    }

    // Find equal highs (within tolerance)
    for (let i = 0; i < highs.length; i++) {
      for (let j = i + 1; j < highs.length; j++) {
        if (Math.abs(highs[i] - highs[j]) <= this.tolerance) {
          const avgLevel = (highs[i] + highs[j]) / 2;
          if (!eqhLevels.some(level => Math.abs(level - avgLevel) <= this.tolerance)) {
            eqhLevels.push(avgLevel);
          }
        }
      }
    }

    return eqhLevels;
  }

  /**
   * Detect Equal Lows (EQL)
   */
  private detectEqualLows(candles: Candle[]): number[] {
    const lows: number[] = [];
    const eqlLevels: number[] = [];

    // Collect all lows
    for (const candle of candles) {
      lows.push(candle.low);
    }

    // Find equal lows (within tolerance)
    for (let i = 0; i < lows.length; i++) {
      for (let j = i + 1; j < lows.length; j++) {
        if (Math.abs(lows[i] - lows[j]) <= this.tolerance) {
          const avgLevel = (lows[i] + lows[j]) / 2;
          if (!eqlLevels.some(level => Math.abs(level - avgLevel) <= this.tolerance)) {
            eqlLevels.push(avgLevel);
          }
        }
      }
    }

    return eqlLevels;
  }

  /**
   * Check if price swept a level
   */
  private checkSweep(
    candles: Candle[],
    level: number,
    direction: 'above' | 'below'
  ): boolean {
    // Check last 10 candles for sweep
    const recent = candles.slice(-10);

    if (direction === 'above') {
      // Check if price went above level then came back
      let above = false;
      for (const candle of recent) {
        if (candle.high > level) {
          above = true;
        }
        if (above && candle.close < level) {
          return true; // Swept above then came back
        }
      }
    } else {
      // Check if price went below level then came back
      let below = false;
      for (const candle of recent) {
        if (candle.low < level) {
          below = true;
        }
        if (below && candle.close > level) {
          return true; // Swept below then came back
        }
      }
    }

    return false;
  }

  /**
   * Get timestamp when sweep occurred
   */
  private getSweepTimestamp(
    candles: Candle[],
    level: number,
    direction: 'above' | 'below'
  ): Date | undefined {
    const recent = candles.slice(-10);

    if (direction === 'above') {
      for (const candle of recent) {
        if (candle.high > level) {
          return candle.endTime;
        }
      }
    } else {
      for (const candle of recent) {
        if (candle.low < level) {
          return candle.endTime;
        }
      }
    }

    return undefined;
  }

  /**
   * Get most recent confirmed sweep
   */
  getMostRecentSweep(sweeps: LiquiditySweepResult[]): LiquiditySweepResult | undefined {
    const confirmed = sweeps.filter(s => s.confirmed);
    if (confirmed.length === 0) return undefined;

    // Sort by timestamp (most recent first)
    confirmed.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return confirmed[0];
  }
}


