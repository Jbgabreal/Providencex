/**
 * Feature Builder (Trading Engine v13)
 * 
 * Builds engineered features from candles, ticks, SMC metadata, volatility, etc.
 */

import { Logger } from '@providencex/shared-utils';
import { FeatureVector, FeatureBuildingContext } from './types';
import { CandleStore } from '../marketData/CandleStore';
import { PriceFeedClient, Tick } from '../marketData';
import { Candle as MarketDataCandle } from '../marketData/types';

const logger = new Logger('FeatureBuilder');

/**
 * Feature Builder - Builds engineered features for ML models
 */
export class FeatureBuilder {
  private candleStore: CandleStore;
  private priceFeed?: PriceFeedClient;

  constructor(candleStore: CandleStore, priceFeed?: PriceFeedClient) {
    this.candleStore = candleStore;
    this.priceFeed = priceFeed;
  }

  /**
   * Build feature vector from context
   */
  async buildFeatures(context: FeatureBuildingContext): Promise<FeatureVector> {
    const { symbol, candles, currentTick, smcMetadata, regime } = context;
    
    const features: FeatureVector = {};

    try {
      // Basic price features
      await this.addPriceFeatures(features, candles, currentTick);
      
      // Volatility features
      await this.addVolatilityFeatures(features, candles);
      
      // Trend features
      await this.addTrendFeatures(features, candles, smcMetadata);
      
      // Volume features
      await this.addVolumeFeatures(features, candles);
      
      // Time/session features
      await this.addTimeFeatures(features);
      
      // SMC-specific features
      await this.addSMCFeatures(features, smcMetadata, candles);
      
      // Liquidity features
      await this.addLiquidityFeatures(features, candles, currentTick);
      
      // Spread features
      await this.addSpreadFeatures(features, currentTick);
      
      // Regime features (one-hot encoded)
      this.addRegimeFeatures(features, regime);

      logger.debug(`[FeatureBuilder] Built ${Object.keys(features).length} features for ${symbol}`);
    } catch (error) {
      logger.error(`[FeatureBuilder] Failed to build features for ${symbol}`, error);
    }

    return features;
  }

  /**
   * Add basic price features
   */
  private async addPriceFeatures(
    features: FeatureVector,
    candles: any[],
    currentTick?: Tick
  ): Promise<void> {
    if (candles.length === 0) return;

    const latest = candles[candles.length - 1];
    const prev = candles.length > 1 ? candles[candles.length - 2] : latest;

    // Current price
    features.price_close = latest.close;
    features.price_open = latest.open;
    features.price_high = latest.high;
    features.price_low = latest.low;

    // Price change
    features.price_change = latest.close - prev.close;
    features.price_change_pct = prev.close > 0 ? ((latest.close - prev.close) / prev.close) * 100 : 0;

    // Candle body and wick sizes
    const bodySize = Math.abs(latest.close - latest.open);
    const upperWick = latest.high - Math.max(latest.open, latest.close);
    const lowerWick = Math.min(latest.open, latest.close) - latest.low;
    const totalRange = latest.high - latest.low;

    features.candle_body_size = totalRange > 0 ? bodySize / totalRange : 0;
    features.candle_upper_wick_pct = totalRange > 0 ? upperWick / totalRange : 0;
    features.candle_lower_wick_pct = totalRange > 0 ? lowerWick / totalRange : 0;
    features.candle_wick_asymmetry = totalRange > 0 
      ? (upperWick - lowerWick) / totalRange 
      : 0; // Positive = upper wick longer

    // Current bid/ask if available
    if (currentTick) {
      features.bid_price = currentTick.bid;
      features.ask_price = currentTick.ask;
      features.mid_price = currentTick.mid;
    } else {
      features.bid_price = latest.close;
      features.ask_price = latest.close;
      features.mid_price = latest.close;
    }
  }

  /**
   * Add volatility features (ATR, compression, expansion)
   */
  private async addVolatilityFeatures(
    features: FeatureVector,
    candles: any[]
  ): Promise<void> {
    if (candles.length < 14) return;

    // Calculate ATR (Average True Range) over 14 periods
    const atr = this.calculateATR(candles, 14);
    features.atr_14 = atr;
    features.atr_pct = candles[candles.length - 1].close > 0 
      ? (atr / candles[candles.length - 1].close) * 100 
      : 0;

    // Volatility compression/expansion
    const recentATR = this.calculateATR(candles.slice(-7), 7);
    const olderATR = candles.length >= 21 
      ? this.calculateATR(candles.slice(-21, -7), 14) 
      : atr;

    features.volatility_compression = olderATR > 0 ? recentATR / olderATR : 1.0;
    features.volatility_expansion = olderATR > 0 ? recentATR / olderATR : 1.0;

    // Range height (for ranging markets)
    const recentHigh = Math.max(...candles.slice(-20).map(c => c.high));
    const recentLow = Math.min(...candles.slice(-20).map(c => c.low));
    const rangeHeight = recentHigh - recentLow;
    const avgPrice = candles.slice(-20).reduce((sum, c) => sum + c.close, 0) / Math.min(20, candles.length);

    features.range_height = avgPrice > 0 ? (rangeHeight / avgPrice) * 100 : 0;
    features.range_compression = avgPrice > 0 && atr > 0 ? rangeHeight / atr : 1.0;
  }

  /**
   * Add trend features
   */
  private async addTrendFeatures(
    features: FeatureVector,
    candles: any[],
    smcMetadata?: any
  ): Promise<void> {
    if (candles.length < 20) return;

    // Simple moving averages
    const sma20 = this.calculateSMA(candles.slice(-20), 20);
    const sma50 = candles.length >= 50 ? this.calculateSMA(candles.slice(-50), 50) : sma20;

    features.sma_20 = sma20;
    features.sma_50 = sma50;
    features.price_vs_sma20 = candles[candles.length - 1].close - sma20;
    features.price_vs_sma20_pct = sma20 > 0 
      ? ((candles[candles.length - 1].close - sma20) / sma20) * 100 
      : 0;

    // Trend direction from SMAs
    features.trend_sma_bullish = sma20 > sma50 ? 1 : 0;
    features.trend_sma_bearish = sma20 < sma50 ? 1 : 0;

    // RSI (Relative Strength Index)
    const rsi = this.calculateRSI(candles, 14);
    features.rsi_14 = rsi;
    features.rsi_overbought = rsi > 70 ? 1 : 0;
    features.rsi_oversold = rsi < 30 ? 1 : 0;

    // HTF/LTF trend from SMC metadata
    if (smcMetadata?.timeframeContext) {
      const htfTrend = smcMetadata.timeframeContext.htfTrend;
      features.htf_trend_bullish = htfTrend === 'bullish' ? 1 : 0;
      features.htf_trend_bearish = htfTrend === 'bearish' ? 1 : 0;
      features.htf_trend_range = htfTrend === 'range' ? 1 : 0;
    }

    // BOS/CHOCH confirmation
    if (smcMetadata?.timeframeContext) {
      const lastBos = smcMetadata.timeframeContext.lastBosDirection;
      const lastChoch = smcMetadata.timeframeContext.lastChochDirection;
      
      features.bos_bullish = lastBos === 'bullish' ? 1 : 0;
      features.bos_bearish = lastBos === 'bearish' ? 1 : 0;
      features.choch_bullish = lastChoch === 'bullish' ? 1 : 0;
      features.choch_bearish = lastChoch === 'bearish' ? 1 : 0;
    }
  }

  /**
   * Add volume features
   */
  private async addVolumeFeatures(
    features: FeatureVector,
    candles: any[]
  ): Promise<void> {
    if (candles.length < 20) return;

    const latest = candles[candles.length - 1];
    const avgVolume = candles.slice(-20).reduce((sum, c) => sum + (c.volume || 0), 0) / 20;

    features.volume = latest.volume || 0;
    features.volume_vs_avg = avgVolume > 0 ? (latest.volume || 0) / avgVolume : 0;
    features.volume_increase = avgVolume > 0 
      ? ((latest.volume || 0) - avgVolume) / avgVolume 
      : 0;

    // Volume imbalance from SMC metadata
    if (candles.length > 0) {
      // Placeholder for volume imbalance - would need actual calculation
      features.volume_imbalance = 0;
    }
  }

  /**
   * Add time/session features
   */
  private async addTimeFeatures(features: FeatureVector): Promise<void> {
    const now = new Date();
    
    // Hour of day (0-23)
    features.hour_of_day = now.getUTCHours();
    
    // Day of week (0-6, Sunday = 0)
    features.day_of_week = now.getUTCDay();
    
    // Minute of hour (0-59)
    features.minute_of_hour = now.getUTCMinutes();
    
    // Session encoding (London, NY, Asian)
    const hour = now.getUTCHours();
    features.session_london = (hour >= 8 && hour < 16) ? 1 : 0;
    features.session_newyork = (hour >= 13 && hour < 21) ? 1 : 0;
    features.session_asian = (hour >= 0 && hour < 8) ? 1 : 0;
    
    // Cyclical encoding (sin/cos for hour)
    features.hour_sin = Math.sin((hour / 24) * 2 * Math.PI);
    features.hour_cos = Math.cos((hour / 24) * 2 * Math.PI);
  }

  /**
   * Add SMC-specific features
   */
  private async addSMCFeatures(
    features: FeatureVector,
    smcMetadata: any,
    candles: any[]
  ): Promise<void> {
    if (!smcMetadata) return;

    // Order Block distance
    if (smcMetadata.orderBlockZone) {
      const latest = candles[candles.length - 1];
      const obZone = smcMetadata.orderBlockZone;
      const distanceToOB = latest.close > obZone.upper 
        ? latest.close - obZone.upper 
        : (latest.close < obZone.lower ? obZone.lower - latest.close : 0);
      
      features.ob_distance = distanceToOB;
      features.ob_distance_pct = latest.close > 0 ? (distanceToOB / latest.close) * 100 : 0;
      features.ob_type_demand = obZone.type === 'demand' ? 1 : 0;
      features.ob_type_supply = obZone.type === 'supply' ? 1 : 0;
    }

    // Liquidity sweep
    features.liquidity_swept = smcMetadata.liquiditySwept ? 1 : 0;
    
    // Displacement candle
    features.displacement_candle = smcMetadata.displacementCandle ? 1 : 0;
    
    // Premium/Discount
    if (smcMetadata.premiumDiscount) {
      features.premium_zone = smcMetadata.premiumDiscount === 'premium' ? 1 : 0;
      features.discount_zone = smcMetadata.premiumDiscount === 'discount' ? 1 : 0;
    }
    
    // Confluence score
    features.confluence_score = smcMetadata.confluenceScore || 0;
    
    // FVG levels (if available)
    if (smcMetadata.fvgLevels) {
      features.fvg_htf_present = smcMetadata.fvgLevels.htf ? 1 : 0;
      features.fvg_itf_present = smcMetadata.fvgLevels.itf ? 1 : 0;
      features.fvg_ltf_present = smcMetadata.fvgLevels.ltf ? 1 : 0;
    }
  }

  /**
   * Add liquidity features
   */
  private async addLiquidityFeatures(
    features: FeatureVector,
    candles: any[],
    currentTick?: Tick
  ): Promise<void> {
    if (candles.length < 20) return;

    const latest = candles[candles.length - 1];
    
    // Distance to recent high/low
    const recentHigh = Math.max(...candles.slice(-20).map(c => c.high));
    const recentLow = Math.min(...candles.slice(-20).map(c => c.low));
    
    const distanceToHigh = recentHigh - latest.close;
    const distanceToLow = latest.close - recentLow;
    
    features.distance_to_liquidity_high = distanceToHigh;
    features.distance_to_liquidity_low = distanceToLow;
    features.distance_to_liquidity_high_pct = recentHigh > 0 
      ? (distanceToHigh / recentHigh) * 100 
      : 0;
    features.distance_to_liquidity_low_pct = recentLow > 0 
      ? (distanceToLow / recentLow) * 100 
      : 0;

    // Equal highs/lows broken
    features.equal_highs_broken = 0; // Would need actual calculation
    features.equal_lows_broken = 0; // Would need actual calculation
  }

  /**
   * Add spread features
   */
  private async addSpreadFeatures(
    features: FeatureVector,
    currentTick?: Tick
  ): Promise<void> {
    if (currentTick) {
      const spread = currentTick.ask - currentTick.bid;
      const midPrice = currentTick.mid;
      
      features.spread = spread;
      features.spread_pct = midPrice > 0 ? (spread / midPrice) * 100 : 0;
    } else {
      features.spread = 0;
      features.spread_pct = 0;
    }
  }

  /**
   * Add regime features (one-hot encoded)
   */
  private addRegimeFeatures(
    features: FeatureVector,
    regime?: string
  ): void {
    // One-hot encode regime
    features.regime_trending_up = regime === 'trending_up' ? 1 : 0;
    features.regime_trending_down = regime === 'trending_down' ? 1 : 0;
    features.regime_ranging = regime === 'ranging' ? 1 : 0;
    features.regime_volatile_expansion = regime === 'volatile_expansion' ? 1 : 0;
    features.regime_volatile_contraction = regime === 'volatile_contraction' ? 1 : 0;
    features.regime_news_regime = regime === 'news_regime' ? 1 : 0;
    features.regime_liquidity_grab = regime === 'liquidity_grab' ? 1 : 0;
    features.regime_trend_reversal_zone = regime === 'trend_reversal_zone' ? 1 : 0;
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
    
    // Use last N true ranges
    const recentTRs = trueRanges.slice(-period);
    return recentTRs.reduce((sum, tr) => sum + tr, 0) / recentTRs.length;
  }

  /**
   * Calculate SMA (Simple Moving Average)
   */
  private calculateSMA(candles: any[], period: number): number {
    if (candles.length === 0) return 0;
    const closes = candles.slice(-period).map(c => c.close);
    return closes.reduce((sum, c) => sum + c, 0) / closes.length;
  }

  /**
   * Calculate RSI (Relative Strength Index)
   */
  private calculateRSI(candles: any[], period: number): number {
    if (candles.length < period + 1) return 50; // Neutral RSI

    const gains: number[] = [];
    const losses: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change > 0) {
        gains.push(change);
        losses.push(0);
      } else {
        gains.push(0);
        losses.push(Math.abs(change));
      }
    }

    // Use last N periods
    const recentGains = gains.slice(-period);
    const recentLosses = losses.slice(-period);

    const avgGain = recentGains.reduce((sum, g) => sum + g, 0) / period;
    const avgLoss = recentLosses.reduce((sum, l) => sum + l, 0) / period;

    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
}

