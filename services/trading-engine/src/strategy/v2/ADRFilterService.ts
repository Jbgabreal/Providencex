/**
 * ADR Filter Service - Average Daily Range (ADR) & Volatility Filters
 * 
 * Filters trades based on ADR to avoid:
 * - Low volatility chop (market too dead)
 * - Excessive volatility (likely stop hunts or news-driven spikes)
 * 
 * For symbols like XAUUSD and US30, ADR-based filters help improve entry quality
 * by avoiding poor market conditions.
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';

const logger = new Logger('ADRFilterService');

export interface ADRFilterConfig {
  symbol: string;
  adrLookbackDays: number; // Days to calculate ADR (default: 5)
  minAdrPips: number; // Minimum ADR in pips (below this: too choppy, reject)
  maxAdrMultiplier: number; // Max ADR multiplier (current day > ADR * multiplier: too volatile, reject)
  // v15b: Soft ADR thresholds for trend-following trades
  adrHardLimitMultiple?: number; // Hard limit (above this: reject) - default: maxAdrMultiplier
  adrSoftMultiple?: number; // Below this is ideal - default: 1.2
  adrPenaltyMultiple?: number; // Between soft and this: apply penalties - default: 2.0
}

export interface ADRFilterResult {
  passed: boolean; // v15b: Only false if hard limit exceeded
  reason?: string;
  currentDayRange?: number; // Current day's high-low in pips/points
  adr?: number; // Average daily range in pips/points
  adrPercentage?: number; // ADR as percentage of current day's range
  adrScore?: number; // v15b: ADR score contribution (-15 to +10) for confluence
  adrMultiple?: number; // v15b: currentDayRange / adr ratio
}

export class ADRFilterService {
  private configs: Map<string, ADRFilterConfig>;

  constructor(configs: ADRFilterConfig[] = []) {
    this.configs = new Map();
    configs.forEach(config => {
      this.configs.set(config.symbol.toUpperCase(), config);
    });
  }

  /**
   * Check if trade passes ADR filter
   * 
   * @param symbol - Trading symbol
   * @param dailyCandles - M1 candles for current day (used to calculate daily range)
   * @param historicalCandles - Daily candles for ADR calculation (H1 or D1 candles)
   * @returns Filter result with pass/fail and details
   */
  checkADR(
    symbol: string,
    dailyCandles: Candle[],
    historicalCandles: Candle[]
  ): ADRFilterResult {
    const config = this.configs.get(symbol.toUpperCase());
    
    // If no config for this symbol, pass through (backward compatible)
    if (!config) {
      return { passed: true };
    }

    // Calculate current day's range
    if (dailyCandles.length < 2) {
      return {
        passed: false,
        reason: `Insufficient candles for ADR calculation (need at least 2, got ${dailyCandles.length})`,
      };
    }

    const currentDayHigh = Math.max(...dailyCandles.map(c => c.high));
    const currentDayLow = Math.min(...dailyCandles.map(c => c.low));
    const currentDayRange = currentDayHigh - currentDayLow;

    // Convert to pips/points (simplified - assumes 1 pip = 0.01 for FX, 1 point = 1.0 for XAUUSD/US30)
    // This is a simplified conversion; in production, use proper pip/point conversion based on symbol
    const currentDayRangePips = this.convertToPips(symbol, currentDayRange);

    // Calculate ADR from historical candles
    if (historicalCandles.length < config.adrLookbackDays) {
      // If we don't have enough historical data, pass through with a warning
      logger.warn(
        `[ADRFilter] ${symbol}: Insufficient historical data for ADR (need ${config.adrLookbackDays} days, got ${historicalCandles.length}). Passing through.`
      );
      return { passed: true };
    }

    // Calculate daily ranges from historical candles
    const dailyRanges: number[] = [];
    
    // Group candles by day (simplified - assumes candles are in chronological order)
    // For H1 candles: 24 candles per day, for D1 candles: 1 candle per day
    const candlesPerDay = historicalCandles.length >= 24 * config.adrLookbackDays ? 24 : 1;
    
    for (let i = 0; i < config.adrLookbackDays; i++) {
      const dayStart = Math.max(0, historicalCandles.length - (i + 1) * candlesPerDay);
      const dayEnd = historicalCandles.length - i * candlesPerDay;
      const dayCandles = historicalCandles.slice(dayStart, dayEnd);
      
      if (dayCandles.length > 0) {
        const dayHigh = Math.max(...dayCandles.map(c => c.high));
        const dayLow = Math.min(...dayCandles.map(c => c.low));
        const dayRange = dayHigh - dayLow;
        dailyRanges.push(this.convertToPips(symbol, dayRange));
      }
    }

    if (dailyRanges.length === 0) {
      return { passed: true }; // Pass through if we can't calculate ADR
    }

    // Calculate ADR (average of daily ranges)
    const adr = dailyRanges.reduce((sum, range) => sum + range, 0) / dailyRanges.length;

    // Check minimum ADR threshold (reject if market is too choppy/dead)
    if (adr < config.minAdrPips) {
      return {
        passed: false,
        reason: `ADR too low: ${adr.toFixed(2)} < ${config.minAdrPips} pips (market too choppy/dead)`,
        currentDayRange: currentDayRangePips,
        adr,
        adrPercentage: adr > 0 ? (currentDayRangePips / adr) * 100 : undefined,
      };
    }

    // v15b: Convert ADR from hard block to soft+hard hybrid
    const adrMultiple = adr > 0 ? currentDayRangePips / adr : 0;
    const adrHardLimit = config.adrHardLimitMultiple ?? config.maxAdrMultiplier;
    const adrSoft = config.adrSoftMultiple ?? 1.2;
    const adrPenaltyMultiple = config.adrPenaltyMultiple ?? 2.0;
    
    let adrScore = 0;
    
    // Hard limit: reject if current day exceeds hard limit
    if (adrMultiple > adrHardLimit) {
      return {
        passed: false,
        reason: `Current day range too high: ${currentDayRangePips.toFixed(2)} > ${(adr * adrHardLimit).toFixed(2)} pips (${adrHardLimit.toFixed(1)}x ADR) - likely stop hunt or news spike`,
        currentDayRange: currentDayRangePips,
        adr,
        adrPercentage: adr > 0 ? (currentDayRangePips / adr) * 100 : undefined,
        adrMultiple,
        adrScore: -20, // Hard rejection
      };
    }
    
    // Soft thresholds: apply score penalties/bonuses
    if (adrMultiple <= adrSoft) {
      adrScore = 10; // Ideal volatility
    } else if (adrMultiple <= adrPenaltyMultiple) {
      adrScore = -5; // Elevated but tradable
    } else if (adrMultiple <= adrHardLimit) {
      adrScore = -15; // High volatility, heavy penalty but still tradable if confluence strong
    }

    // All checks passed (with score)
    return {
      passed: true,
      currentDayRange: currentDayRangePips,
      adr,
      adrPercentage: adr > 0 ? (currentDayRangePips / adr) * 100 : undefined,
      adrScore,
      adrMultiple,
    };
  }

  /**
   * Convert price distance to pips/points
   * Simplified conversion - assumes:
   * - FX pairs (EURUSD, GBPUSD): 1 pip = 0.0001
   * - XAUUSD: 1 pip = 0.01 (cents)
   * - US30: 1 point = 1.0
   */
  private convertToPips(symbol: string, priceDistance: number): number {
    const upperSymbol = symbol.toUpperCase();
    
    if (upperSymbol === 'XAUUSD' || upperSymbol === 'GOLD') {
      return priceDistance * 100; // Convert dollars to cents (pips)
    } else if (upperSymbol === 'US30' || upperSymbol === 'DJI') {
      return priceDistance; // Points = pips for indices
    } else {
      // FX pairs: assume 4 decimal places (1 pip = 0.0001)
      return priceDistance * 10000; // Convert to pips
    }
  }

  /**
   * Get ADR filter config for a symbol
   */
  getConfig(symbol: string): ADRFilterConfig | undefined {
    return this.configs.get(symbol.toUpperCase());
  }

  /**
   * Check if symbol has ADR filter configured
   */
  hasConfig(symbol: string): boolean {
    return this.configs.has(symbol.toUpperCase());
  }
}

