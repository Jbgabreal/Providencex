/**
 * Regime Detector (Trading Engine v13)
 * 
 * Detects market regimes using candle patterns, volatility, SMC, time, and HTF analysis
 */

import { Logger } from '@providencex/shared-utils';
import { RegimeType, RegimeDetectionContext } from './types';
import { CandleStore } from '../marketData/CandleStore';
import { PriceFeedClient, Tick } from '../marketData';
import { Candle as MarketDataCandle } from '../marketData/types';

const logger = new Logger('RegimeDetector');

/**
 * Regime Detector - Classifies market regimes
 */
export class RegimeDetector {
  private candleStore: CandleStore;
  private priceFeed?: PriceFeedClient;

  constructor(candleStore: CandleStore, priceFeed?: PriceFeedClient) {
    this.candleStore = candleStore;
    this.priceFeed = priceFeed;
  }

  /**
   * Detect current market regime
   */
  async detect(symbol: string): Promise<RegimeType> {
    try {
      // Get historical candles
      const candles = await this.getRecentCandles(symbol, 50);
      if (candles.length < 20) {
        return 'ranging'; // Default if insufficient data
      }

      const currentTick = this.priceFeed?.getLatestTick(symbol);
      const spread = currentTick ? currentTick.ask - currentTick.bid : 0;

      const context: RegimeDetectionContext = {
        symbol,
        candles,
        currentTick,
        volatility: this.calculateVolatility(candles),
        spread,
        timeOfDay: new Date().getUTCHours(),
        dayOfWeek: new Date().getUTCDay(),
        session: this.getCurrentSession(),
      };

      // Combine multiple detection methods
      const regime = await this.combineDetections(context);
      
      logger.debug(`[RegimeDetector] Detected regime for ${symbol}: ${regime}`);
      return regime;
    } catch (error) {
      logger.error(`[RegimeDetector] Failed to detect regime for ${symbol}`, error);
      return 'ranging'; // Default fallback
    }
  }

  /**
   * Combine detections from multiple methods
   */
  private async combineDetections(context: RegimeDetectionContext): Promise<RegimeType> {
    const detections: RegimeType[] = [];

    // Check each detection method
    const candlePatternRegime = this.detectUsingCandlePatterns(context);
    if (candlePatternRegime) detections.push(candlePatternRegime);

    const volatilityRegime = this.detectUsingVolatility(context);
    if (volatilityRegime) detections.push(volatilityRegime);

    const smcRegime = this.detectUsingSMC(context);
    if (smcRegime) detections.push(smcRegime);

    const timeRegime = this.detectUsingTime(context);
    if (timeRegime) detections.push(timeRegime);

    const htfRegime = this.detectUsingHTF(context);
    if (htfRegime) detections.push(htfRegime);

    // Count votes for each regime
    const regimeVotes = new Map<RegimeType, number>();
    for (const regime of detections) {
      regimeVotes.set(regime, (regimeVotes.get(regime) || 0) + 1);
    }

    // Return regime with most votes, or trending_up as default
    if (regimeVotes.size === 0) {
      return 'ranging';
    }

    let maxVotes = 0;
    let selectedRegime: RegimeType = 'ranging';
    for (const [regime, votes] of regimeVotes.entries()) {
      if (votes > maxVotes) {
        maxVotes = votes;
        selectedRegime = regime;
      }
    }

    return selectedRegime;
  }

  /**
   * Detect regime using candle patterns
   */
  private detectUsingCandlePatterns(context: RegimeDetectionContext): RegimeType | null {
    const { candles } = context;
    if (candles.length < 20) return null;

    // Check for trending patterns
    const recent = candles.slice(-10);
    const upwardCandles = recent.filter(c => c.close > c.open).length;
    const downwardCandles = recent.filter(c => c.close < c.open).length;

    // Strong uptrend
    if (upwardCandles >= 7) {
      return 'trending_up';
    }

    // Strong downtrend
    if (downwardCandles >= 7) {
      return 'trending_down';
    }

    // Check for ranging
    const high = Math.max(...recent.map((c: any) => c.high));
    const low = Math.min(...recent.map((c: any) => c.low));
    const range = high - low;
    const avgClose = recent.reduce((sum: number, c: any) => sum + c.close, 0) / Math.max(1, recent.length);
    const rangePercent = avgClose > 0 ? (range / avgClose) * 100 : 0;

    // Tight range suggests ranging market
    if (rangePercent < 0.5) { // Less than 0.5% range
      return 'ranging';
    }

    // Check for reversal zones (doji patterns, long wicks)
    const hasReversalCandles = recent.some((c: any) => {
      const body = Math.abs(c.close - c.open);
      const upperWick = c.high - Math.max(c.open, c.close);
      const lowerWick = Math.min(c.open, c.close) - c.low;
      const totalRange = c.high - c.low;
      
      // Doji-like (small body, large wicks)
      return totalRange > 0 && (body / totalRange < 0.2) && (upperWick / totalRange > 0.4 || lowerWick / totalRange > 0.4);
    });

    if (hasReversalCandles) {
      return 'trend_reversal_zone';
    }

    return null;
  }

  /**
   * Detect regime using volatility
   */
  private detectUsingVolatility(context: RegimeDetectionContext): RegimeType | null {
    const { candles, volatility } = context;
    if (!volatility || candles.length < 20) return null;

    // Calculate ATR and compare recent vs older
    const recentATR = this.calculateATR(candles.slice(-7), 7);
    const olderATR = candles.length >= 21 
      ? this.calculateATR(candles.slice(-21, -7), 14) 
      : recentATR;

    const expansionRatio = olderATR > 0 ? recentATR / olderATR : 1.0;

    // Significant expansion
    if (expansionRatio > 1.5) {
      return 'volatile_expansion';
    }

    // Significant contraction
    if (expansionRatio < 0.6) {
      return 'volatile_contraction';
    }

    return null;
  }

  /**
   * Detect regime using SMC indicators
   */
  private detectUsingSMC(context: RegimeDetectionContext): RegimeType | null {
    // This would use SMC metadata if available
    // For now, return null (would need SMC context)
    return null;
  }

  /**
   * Detect regime using time/session analysis
   */
  private detectUsingTime(context: RegimeDetectionContext): RegimeType | null {
    const { session } = context;
    
    // High-impact news windows might be detected here
    // For now, return null
    return null;
  }

  /**
   * Detect regime using HTF (Higher Timeframe) analysis
   */
  private detectUsingHTF(context: RegimeDetectionContext): RegimeType | null {
    const { candles } = context;
    if (candles.length < 30) return null;

    // Use longer lookback for HTF trend
    const htfCandles = candles.slice(-30);
    const htfSMA = htfCandles.reduce((sum, c) => sum + c.close, 0) / htfCandles.length;
    const currentPrice = candles[candles.length - 1].close;

    const priceVsHTF = currentPrice - htfSMA;
    const percentDeviation = htfSMA > 0 ? (priceVsHTF / htfSMA) * 100 : 0;

    // Strong deviation from HTF average suggests trending
    if (percentDeviation > 0.3) {
      return 'trending_up';
    }
    
    if (percentDeviation < -0.3) {
      return 'trending_down';
    }

    return null;
  }

  /**
   * Get recent candles from CandleStore
   */
  private async getRecentCandles(symbol: string, count: number): Promise<any[]> {
    try {
      // Get candles from CandleStore (use getCandles method)
      const recentCandles = this.candleStore.getCandles(symbol, count);
      
      // Convert to simple array format
      return recentCandles.map((c: any) => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0,
        timestamp: c.startTime.getTime(),
      }));
    } catch (error) {
      logger.error(`[RegimeDetector] Failed to get candles for ${symbol}`, error);
      return [];
    }
  }

  /**
   * Calculate volatility (standard deviation of returns)
   */
  private calculateVolatility(candles: any[]): number {
    if (candles.length < 10) return 0;

    const returns: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1].close;
      const curr = candles[i].close;
      if (prev > 0) {
        returns.push((curr - prev) / prev);
      }
    }

    if (returns.length === 0) return 0;

    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Annualized volatility
    return stdDev * Math.sqrt(252) * 100; // As percentage
  }

  /**
   * Get current trading session
   */
  private getCurrentSession(): string {
    const hour = new Date().getUTCHours();
    
    if (hour >= 0 && hour < 8) {
      return 'asian';
    } else if (hour >= 8 && hour < 16) {
      return 'london';
    } else if (hour >= 13 && hour < 21) {
      return 'newyork';
    } else {
      return 'asian'; // Default
    }
  }

  /**
   * Calculate ATR (Average True Range)
   */
  private calculateATR(candles: any[], period: number): number {
    if (candles.length < 2) return 0;

    const trueRanges: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];
      
      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );
      trueRanges.push(tr);
    }

    if (trueRanges.length === 0) return 0;
    
    const recentTRs = trueRanges.slice(-period);
    return recentTRs.reduce((sum, tr) => sum + tr, 0) / recentTRs.length;
  }
}

