/**
 * PremiumDiscountService - Calculates Premium/Discount zones (SMC v2)
 * 
 * Computes FIB 0.5 from HTF swing high/low
 * Only buy in discount, only sell in premium
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';

const logger = new Logger('PremiumDiscountService');

export class PremiumDiscountService {
  private lookbackPeriod: number; // Candles to look back for swing high/low
  private useItfBased: boolean; // Use ITF-based PD for volatile symbols (XAUUSD, US30)
  private itfLookbackPeriod: number; // ITF lookback period (20-30 candles)

  constructor(lookbackPeriod: number = 100, useItfBased: boolean = false, itfLookbackPeriod: number = 25) {
    this.lookbackPeriod = lookbackPeriod;
    this.useItfBased = useItfBased;
    this.itfLookbackPeriod = itfLookbackPeriod;
  }

  /**
   * Determine if current price is in premium or discount zone
   * For ITF-based mode: uses shorter window (20-30 ITF candles) for more responsive PD calculation
   * For HTF-based mode: uses longer window (100 HTF candles) for broader context
   */
  determineZone(
    candles: Candle[],
    currentPrice: number,
    symbol?: string // Symbol for symbol-aware logic
  ): 'premium' | 'discount' | 'neutral' {
    if (candles.length < 20) return 'neutral';

    // For XAUUSD and US30: use ITF-based PD (shorter window, 20-30 candles)
    // This provides more responsive entries and avoids late entries in volatile markets
    const shouldUseItfBased = this.useItfBased || symbol === 'XAUUSD' || symbol === 'US30';
    const lookback = shouldUseItfBased ? this.itfLookbackPeriod : this.lookbackPeriod;

    const swingHigh = this.findSwingHigh(candles, lookback);
    const swingLow = this.findSwingLow(candles, lookback);

    if (!swingHigh || !swingLow) {
      return 'neutral';
    }

    // Calculate FIB 0.5 (midpoint)
    const fib50 = (swingHigh + swingLow) / 2;

    if (currentPrice > fib50) {
      return 'premium';
    } else if (currentPrice < fib50) {
      return 'discount';
    } else {
      return 'neutral';
    }
  }

  /**
   * Get premium/discount boundaries
   */
  getBoundaries(candles: Candle[]): { premium: number; discount: number; fib50: number } | null {
    if (candles.length < 20) return null;

    const swingHigh = this.findSwingHigh(candles);
    const swingLow = this.findSwingLow(candles);

    if (!swingHigh || !swingLow) {
      return null;
    }

    const fib50 = (swingHigh + swingLow) / 2;

    return {
      premium: swingHigh,
      discount: swingLow,
      fib50,
    };
  }

  /**
   * Find swing high (highest point in lookback period)
   */
  private findSwingHigh(candles: Candle[], customLookback?: number): number | undefined {
    if (candles.length < 10) return undefined;

    const lookback = customLookback || this.lookbackPeriod;
    const lookbackActual = Math.min(lookback, candles.length);
    const recent = candles.slice(-lookbackActual);

    return Math.max(...recent.map(c => c.high));
  }

  /**
   * Find swing low (lowest point in lookback period)
   */
  private findSwingLow(candles: Candle[], customLookback?: number): number | undefined {
    if (candles.length < 10) return undefined;

    const lookback = customLookback || this.lookbackPeriod;
    const lookbackActual = Math.min(lookback, candles.length);
    const recent = candles.slice(-lookbackActual);

    return Math.min(...recent.map(c => c.low));
  }

  /**
   * Check if price is in correct zone for trade direction
   */
  isValidZone(
    zone: 'premium' | 'discount' | 'neutral',
    direction: 'buy' | 'sell'
  ): boolean {
    if (zone === 'neutral') return false;

    // Buy in discount, sell in premium
    if (direction === 'buy' && zone === 'discount') return true;
    if (direction === 'sell' && zone === 'premium') return true;

    return false;
  }
}


