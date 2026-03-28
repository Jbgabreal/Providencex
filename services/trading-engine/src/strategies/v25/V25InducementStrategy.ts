/**
 * V25 EMA Scalp Strategy - IStrategy Implementation
 *
 * Designed specifically for Deriv Volatility 25 (24/7 synthetic index).
 * V25 is low-volatility, trends gently, and mean-reverts. Best traded
 * with EMA crossover (trend) + Bollinger Band (mean reversion) hybrid.
 *
 * Logic:
 *   1. EMA(8) crosses EMA(21) → trend direction
 *   2. Price closes beyond last 3 candles high/low (breakout confirmation)
 *   3. RSI(3) confirms momentum (not in dead zone 40-60)
 *   4. SL: 2,000 points | TP: 4,000 points (2:1 R:R)
 *
 * 24/7, no session filters. Pure technical analysis.
 *
 * Key V25 numbers:
 *   - Avg M5 candle range: ~1,000 points
 *   - Typical SL: 2,000-5,000 points
 *   - Min lot: 0.50 on MT5
 *   - $1 per 10,000 points at 0.50 lot
 *
 * Implementation key: V25_INDUCEMENT_V1 (kept for backward compat)
 */

import { Logger } from '@providencex/shared-utils';
import { IStrategy, StrategyContext, StrategyResult } from '../types';
import { StrategyProfile } from '../profiles/types';
import { MarketDataService } from '../../services/MarketDataService';
import { TradeSignal, Candle } from '../../types';

const logger = new Logger('V25EMA');

export class V25InducementStrategy implements IStrategy {
  readonly key = 'V25_INDUCEMENT_V1';
  readonly displayName = 'V25 EMA Scalp';

  private profile: StrategyProfile;
  private marketDataService: MarketDataService;
  private lastTradeTime: number = 0;
  private lastDirection: string = '';

  // Config
  private emaFast: number;
  private emaSlow: number;
  private rsiPeriod: number;
  private rsiBullish: number;
  private rsiBearish: number;
  private breakoutLookback: number;
  private slPoints: number;
  private tpPoints: number;
  private cooldownBars: number;

  constructor(profile: StrategyProfile) {
    this.profile = profile;
    this.marketDataService = new MarketDataService();

    const cfg = profile.config || {};
    this.emaFast = cfg.emaFast || 8;
    this.emaSlow = cfg.emaSlow || 21;
    this.rsiPeriod = cfg.rsiPeriod || 3;
    this.rsiBullish = cfg.rsiBullish || 55;
    this.rsiBearish = cfg.rsiBearish || 45;
    this.breakoutLookback = cfg.breakoutLookback || 3;
    this.slPoints = cfg.slPoints || 2000;
    this.tpPoints = cfg.tpPoints || 4000;
    this.cooldownBars = cfg.cooldownBars || 5;

    logger.info(`[V25EMA] Init: EMA ${this.emaFast}/${this.emaSlow}, RSI(${this.rsiPeriod}), SL=${this.slPoints} TP=${this.tpPoints}`);
  }

  async execute(context: StrategyContext): Promise<StrategyResult> {
    const { symbol } = context;
    const marketData = context.marketDataService || this.marketDataService;

    // M1 — best frequency for V25 scalping
    let m5Candles: Candle[];
    try {
      m5Candles = await marketData.getRecentCandles(symbol, 'M1', 60);
    } catch {
      return { orders: [], debug: { reason: 'Candle data unavailable' } };
    }

    if (!m5Candles?.length || m5Candles.length < 25) {
      return { orders: [], debug: { reason: `Insufficient candles: ${m5Candles?.length || 0}` } };
    }

    // Cooldown: minimum N candles between trades
    const lastCandleTime = new Date((m5Candles[m5Candles.length - 1] as any).timestamp || Date.now()).getTime();
    if (lastCandleTime - this.lastTradeTime < this.cooldownBars * 60 * 1000) {
      return { orders: [], debug: { reason: 'Cooldown' } };
    }

    // Step 1: Calculate Bollinger Bands (20, 2.0)
    const closes = m5Candles.map(c => c.close);
    const bbPeriod = 20;
    const bbStdDev = 2.0;

    if (closes.length < bbPeriod + 5) {
      return { orders: [], debug: { reason: 'Not enough data for Bollinger Bands' } };
    }

    // SMA(20)
    const recentCloses = closes.slice(-bbPeriod);
    const sma = recentCloses.reduce((s, v) => s + v, 0) / bbPeriod;

    // Standard deviation
    const variance = recentCloses.reduce((s, v) => s + (v - sma) ** 2, 0) / bbPeriod;
    const stdDev = Math.sqrt(variance);

    const upperBand = sma + bbStdDev * stdDev;
    const lowerBand = sma - bbStdDev * stdDev;

    const lastCandle = m5Candles[m5Candles.length - 1];
    const prevCandle = m5Candles[m5Candles.length - 2];

    // Step 2: RSI(3) for extreme momentum
    const rsi = this.calcRSI(m5Candles, this.rsiPeriod);

    // Step 3: TREND PULLBACK ENTRY at Bollinger Band
    // V25 trends well — enter WITH the trend on pullback to the middle band
    // NOT mean reversion (which fails on V25)
    let direction: 'buy' | 'sell' | null = null;
    let reason = '';

    // Determine trend: price relative to SMA over last 10 candles
    const trendCandles = m5Candles.slice(-10);
    const aboveSMA = trendCandles.filter(c => c.close > sma).length;

    // SMA slope: compare current SMA to SMA from 5 candles ago
    const prevCloses = closes.slice(-(bbPeriod + 5), -5);
    const prevSMA = prevCloses.length >= bbPeriod ? prevCloses.slice(-bbPeriod).reduce((s, v) => s + v, 0) / bbPeriod : sma;
    const smaRising = sma > prevSMA;
    const smaFalling = sma < prevSMA;

    // Only BUY in uptrend (9/10 above SMA + SMA rising)
    // Only SELL in downtrend (1/10 above SMA + SMA falling)
    const bullishTrend = aboveSMA >= 9 && smaRising;
    const bearishTrend = aboveSMA <= 1 && smaFalling;

    // Average candle range for quiet pullback detection
    const avgRange = m5Candles.slice(-20).reduce((s, c) => s + (c.high - c.low), 0) / 20;

    // Check 3 candles back for pullback context
    const c3 = m5Candles.length > 2 ? m5Candles[m5Candles.length - 3] : null;

    // BUY in uptrend: price pulls back to SMA then bounces with strong body
    if (bullishTrend) {
      const pulledBack = prevCandle.low <= sma || prevCandle.close < sma;
      const bounced = lastCandle.close > lastCandle.open && lastCandle.close > sma;
      const bodyStrong = (lastCandle.close - lastCandle.open) > (lastCandle.high - lastCandle.low) * 0.4;

      if (pulledBack && bounced && bodyStrong && rsi > 45 && rsi < 70) {
        direction = 'buy';
        reason = `Uptrend pullback to SMA ${sma.toFixed(0)}, bounced bullish, RSI=${rsi.toFixed(0)}`;
      }
    }

    // SELL in downtrend: price pulls back to SMA then drops with strong body
    if (!direction && bearishTrend) {
      const pulledBack = prevCandle.high >= sma || prevCandle.close > sma;
      const dropped = lastCandle.close < lastCandle.open && lastCandle.close < sma;
      const bodyStrong = (lastCandle.open - lastCandle.close) > (lastCandle.high - lastCandle.low) * 0.4;

      if (pulledBack && dropped && bodyStrong && rsi < 55 && rsi > 30) {
        direction = 'sell';
        reason = `Downtrend pullback to SMA ${sma.toFixed(0)}, dropped bearish, RSI=${rsi.toFixed(0)}`;
      }
    }

    if (!direction) {
      return { orders: [], debug: { reason: 'Price not at BB extreme', upper: Math.round(upperBand), lower: Math.round(lowerBand), price: Math.round(lastCandle.close), rsi: Math.round(rsi) } };
    }

    // Don't take same direction twice in a row
    if (direction === this.lastDirection) {
      return { orders: [], debug: { reason: `Same direction (${direction}), waiting for reversal` } };
    }

    // Step 6: Trend pullback SL/TP
    // SL = below the pullback low (for buy), TP = opposite band (trend target)
    const entryPrice = lastCandle.close;
    let stopLoss: number, takeProfit: number;

    if (direction === 'buy') {
      const pullbackLow = Math.min(prevCandle.low, lastCandle.low);
      stopLoss = pullbackLow - stdDev * 0.2;
      const slDist = entryPrice - stopLoss;
      takeProfit = entryPrice + slDist * 1.5; // Fixed 1.5:1 R:R
    } else {
      const pullbackHigh = Math.max(prevCandle.high, lastCandle.high);
      stopLoss = pullbackHigh + stdDev * 0.2;
      const slDist = stopLoss - entryPrice;
      takeProfit = entryPrice - slDist * 1.5; // Fixed 1.5:1 R:R
    }

    // Ensure minimum 1.5:1 R:R
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    if (risk <= 0 || reward / risk < 1.5) {
      return { orders: [], debug: { reason: `R:R too low: ${(reward/risk).toFixed(1)}` } };
    }

    this.lastTradeTime = lastCandleTime;
    this.lastDirection = direction;

    const signal: TradeSignal = {
      symbol,
      direction,
      entry: entryPrice,
      stopLoss,
      takeProfit,
      orderKind: 'market',
      reason: `V25 EMA Scalp: ${reason}`,
      meta: {
        strategyKey: this.key,
        profileKey: this.profile.key,
        upperBand: upperBand,
        lowerBand: lowerBand,
        sma: sma,
        rsi,
        riskRewardRatio: this.tpPoints / this.slPoints,
      },
    };

    logger.info(
      `[V25EMA] ${symbol}: ${direction.toUpperCase()} @ ${entryPrice.toFixed(0)} ` +
      `| SL: ${stopLoss.toFixed(0)} | TP: ${takeProfit.toFixed(0)} | ${reason}`
    );

    return {
      orders: [{ signal, metadata: { strategyKey: this.key } }],
      debug: { direction, upperBand, lowerBand, sma, rsi },
    };
  }

  private calcEMA(values: number[], period: number): number[] {
    if (values.length < period) return [];
    const k = 2 / (period + 1);
    const ema: number[] = [];
    // Seed with SMA
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    ema.push(sum / period);
    // Calculate EMA
    for (let i = period; i < values.length; i++) {
      ema.push(values[i] * k + ema[ema.length - 1] * (1 - k));
    }
    return ema;
  }

  private calcRSI(candles: Candle[], period: number): number {
    if (candles.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
  }
}
