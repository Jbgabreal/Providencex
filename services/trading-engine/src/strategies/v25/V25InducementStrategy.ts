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
    this.cooldownBars = cfg.cooldownBars || 3;

    logger.info(`[V25EMA] Init: EMA ${this.emaFast}/${this.emaSlow}, RSI(${this.rsiPeriod}), SL=${this.slPoints} TP=${this.tpPoints}`);
  }

  async execute(context: StrategyContext): Promise<StrategyResult> {
    const { symbol } = context;
    const marketData = context.marketDataService || this.marketDataService;

    let m5Candles: Candle[];
    try {
      m5Candles = await marketData.getRecentCandles(symbol, 'M5', 60);
    } catch {
      return { orders: [], debug: { reason: 'Candle data unavailable' } };
    }

    if (!m5Candles?.length || m5Candles.length < this.emaSlow + 5) {
      return { orders: [], debug: { reason: `Insufficient candles: ${m5Candles?.length || 0}` } };
    }

    // Cooldown: minimum N candles between trades
    const lastCandleTime = new Date((m5Candles[m5Candles.length - 1] as any).timestamp || Date.now()).getTime();
    if (lastCandleTime - this.lastTradeTime < this.cooldownBars * 5 * 60 * 1000) {
      return { orders: [], debug: { reason: 'Cooldown' } };
    }

    // Step 1: Calculate EMAs
    const emaFastValues = this.calcEMA(m5Candles.map(c => c.close), this.emaFast);
    const emaSlowValues = this.calcEMA(m5Candles.map(c => c.close), this.emaSlow);

    if (emaFastValues.length < 3 || emaSlowValues.length < 3) {
      return { orders: [], debug: { reason: 'Not enough EMA data' } };
    }

    const emaFastCurrent = emaFastValues[emaFastValues.length - 1];
    const emaSlowCurrent = emaSlowValues[emaSlowValues.length - 1];
    const emaFastPrev = emaFastValues[emaFastValues.length - 2];
    const emaSlowPrev = emaSlowValues[emaSlowValues.length - 2];

    // Step 2: Detect EMA crossover
    const bullishCross = emaFastPrev <= emaSlowPrev && emaFastCurrent > emaSlowCurrent;
    const bearishCross = emaFastPrev >= emaSlowPrev && emaFastCurrent < emaSlowCurrent;
    const bullishTrend = emaFastCurrent > emaSlowCurrent;
    const bearishTrend = emaFastCurrent < emaSlowCurrent;

    // Step 3: Breakout confirmation — price closes beyond last N candles
    const recentCandles = m5Candles.slice(-(this.breakoutLookback + 1), -1);
    const lastCandle = m5Candles[m5Candles.length - 1];
    const highestHigh = Math.max(...recentCandles.map(c => c.high));
    const lowestLow = Math.min(...recentCandles.map(c => c.low));
    const breakoutUp = lastCandle.close > highestHigh;
    const breakoutDown = lastCandle.close < lowestLow;

    // Step 4: RSI momentum filter
    const rsi = this.calcRSI(m5Candles, this.rsiPeriod);

    // Step 5: Entry decision
    let direction: 'buy' | 'sell' | null = null;
    let reason = '';

    // BUY: bullish trend + breakout up + RSI confirms
    if (bullishTrend && breakoutUp && rsi > this.rsiBullish) {
      direction = 'buy';
      reason = `EMA ${this.emaFast}>${this.emaSlow}, breakout above ${highestHigh.toFixed(0)}, RSI=${rsi.toFixed(0)}`;
    }

    // SELL: bearish trend + breakout down + RSI confirms
    if (!direction && bearishTrend && breakoutDown && rsi < this.rsiBearish) {
      direction = 'sell';
      reason = `EMA ${this.emaFast}<${this.emaSlow}, breakout below ${lowestLow.toFixed(0)}, RSI=${rsi.toFixed(0)}`;
    }

    // Bonus: fresh crossover is stronger signal (don't require breakout)
    if (!direction && bullishCross && rsi > 50) {
      direction = 'buy';
      reason = `EMA crossover bullish, RSI=${rsi.toFixed(0)}`;
    }
    if (!direction && bearishCross && rsi < 50) {
      direction = 'sell';
      reason = `EMA crossover bearish, RSI=${rsi.toFixed(0)}`;
    }

    if (!direction) {
      return { orders: [], debug: { reason: 'No signal', emaFast: emaFastCurrent.toFixed(0), emaSlow: emaSlowCurrent.toFixed(0), rsi: rsi.toFixed(0) } };
    }

    // Don't take same direction twice in a row (wait for opposite signal)
    if (direction === this.lastDirection) {
      return { orders: [], debug: { reason: `Same direction as last trade (${direction}), waiting for reversal` } };
    }

    // Step 6: Calculate entry, SL, TP
    const entryPrice = lastCandle.close;
    const stopLoss = direction === 'buy' ? entryPrice - this.slPoints : entryPrice + this.slPoints;
    const takeProfit = direction === 'buy' ? entryPrice + this.tpPoints : entryPrice - this.tpPoints;

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
        emaFast: emaFastCurrent,
        emaSlow: emaSlowCurrent,
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
      debug: { direction, emaFast: emaFastCurrent, emaSlow: emaSlowCurrent, rsi },
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
