/**
 * TrendlineLiquidityService - Detects trendline liquidity (SMC v2)
 * 
 * Detects 2-touch and 3-touch trendlines
 * Identifies liquidity sitting above/below trendline
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { TrendlineLiquidity } from '@providencex/shared-types';

const logger = new Logger('TrendlineLiquidityService');

export class TrendlineLiquidityService {
  private minTouches: number; // Minimum touches for confirmation (2 or 3)
  private tolerance: number; // Price tolerance for trendline touch

  constructor(minTouches: number = 2, tolerance: number = 0.0001) {
    this.minTouches = minTouches;
    this.tolerance = tolerance;
  }

  /**
   * Detect trendline liquidity
   */
  detectTrendlineLiquidity(
    candles: Candle[],
    direction: 'bullish' | 'bearish'
  ): TrendlineLiquidity | undefined {
    if (candles.length < 10) return undefined;

    // Detect trendline (simplified: connect swing highs/lows)
    if (direction === 'bullish') {
      return this.detectBullishTrendline(candles);
    } else {
      return this.detectBearishTrendline(candles);
    }
  }

  /**
   * Detect bullish trendline (connecting lows)
   */
  private detectBullishTrendline(candles: Candle[]): TrendlineLiquidity | undefined {
    // Find swing lows
    const swingLows: Array<{ index: number; price: number }> = [];
    
    for (let i = 2; i < candles.length - 2; i++) {
      if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low) {
        swingLows.push({ index: i, price: candles[i].low });
      }
    }

    if (swingLows.length < this.minTouches) return undefined;

    // Check if recent swing lows form an upward trendline
    const recentLows = swingLows.slice(-this.minTouches);
    
    // Calculate trendline slope
    const first = recentLows[0];
    const last = recentLows[recentLows.length - 1];
    const slope = (last.price - first.price) / (last.index - first.index);

    // Check if all points are on/above trendline
    let touches = 0;
    for (const point of recentLows) {
      const expectedPrice = first.price + slope * (point.index - first.index);
      if (Math.abs(point.price - expectedPrice) <= this.tolerance) {
        touches++;
      }
    }

    if (touches >= this.minTouches) {
      // Calculate trendline level at current position
      const currentIndex = candles.length - 1;
      const level = first.price + slope * (currentIndex - first.index);

      return {
        level,
        touches,
        confirmed: touches >= 3, // 3-touch = confirmed
        direction: 'bullish',
        liquidityAbove: this.checkLiquidityAbove(candles, level),
        liquidityBelow: this.checkLiquidityBelow(candles, level),
      };
    }

    return undefined;
  }

  /**
   * Detect bearish trendline (connecting highs)
   */
  private detectBearishTrendline(candles: Candle[]): TrendlineLiquidity | undefined {
    // Find swing highs
    const swingHighs: Array<{ index: number; price: number }> = [];
    
    for (let i = 2; i < candles.length - 2; i++) {
      if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high) {
        swingHighs.push({ index: i, price: candles[i].high });
      }
    }

    if (swingHighs.length < this.minTouches) return undefined;

    // Check if recent swing highs form a downward trendline
    const recentHighs = swingHighs.slice(-this.minTouches);
    
    // Calculate trendline slope
    const first = recentHighs[0];
    const last = recentHighs[recentHighs.length - 1];
    const slope = (last.price - first.price) / (last.index - first.index);

    // Check if all points are on/below trendline
    let touches = 0;
    for (const point of recentHighs) {
      const expectedPrice = first.price + slope * (point.index - first.index);
      if (Math.abs(point.price - expectedPrice) <= this.tolerance) {
        touches++;
      }
    }

    if (touches >= this.minTouches) {
      // Calculate trendline level at current position
      const currentIndex = candles.length - 1;
      const level = first.price + slope * (currentIndex - first.index);

      return {
        level,
        touches,
        confirmed: touches >= 3, // 3-touch = confirmed
        direction: 'bearish',
        liquidityAbove: this.checkLiquidityAbove(candles, level),
        liquidityBelow: this.checkLiquidityBelow(candles, level),
      };
    }

    return undefined;
  }

  /**
   * Check if there's liquidity above trendline
   */
  private checkLiquidityAbove(candles: Candle[], level: number): boolean {
    const recent = candles.slice(-10);
    
    // Check for equal highs above trendline
    const highs = recent.map(c => c.high).filter(h => h > level);
    if (highs.length < 2) return false;

    // Check if there are equal highs
    for (let i = 0; i < highs.length; i++) {
      for (let j = i + 1; j < highs.length; j++) {
        if (Math.abs(highs[i] - highs[j]) <= this.tolerance) {
          return true; // Found equal highs (liquidity)
        }
      }
    }

    return false;
  }

  /**
   * Check if there's liquidity below trendline
   */
  private checkLiquidityBelow(candles: Candle[], level: number): boolean {
    const recent = candles.slice(-10);
    
    // Check for equal lows below trendline
    const lows = recent.map(c => c.low).filter(l => l < level);
    if (lows.length < 2) return false;

    // Check if there are equal lows
    for (let i = 0; i < lows.length; i++) {
      for (let j = i + 1; j < lows.length; j++) {
        if (Math.abs(lows[i] - lows[j]) <= this.tolerance) {
          return true; // Found equal lows (liquidity)
        }
      }
    }

    return false;
  }
}


