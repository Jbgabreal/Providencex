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

    // Step 1: Calculate Bollinger Bands (20, 2.0) — sniper entry at extremes
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

    // Step 3: Entry at Bollinger Band extremes ONLY (sniper entry at top/bottom)
    let direction: 'buy' | 'sell' | null = null;
    let reason = '';

    // BUY: price touches/dips below lower band AND RSI oversold AND bullish candle close
    const touchedLower = lastCandle.low <= lowerBand || prevCandle.low <= lowerBand;
    const bullishClose = lastCandle.close > lastCandle.open;
    if (touchedLower && bullishClose && rsi < this.rsiBearish) {
      direction = 'buy';
      reason = `Lower BB touch at ${lowerBand.toFixed(0)}, RSI=${rsi.toFixed(0)}, bullish close`;
    }

    // SELL: price touches/exceeds upper band AND RSI overbought AND bearish candle close
    const touchedUpper = lastCandle.high >= upperBand || prevCandle.high >= upperBand;
    const bearishClose = lastCandle.close < lastCandle.open;
    if (!direction && touchedUpper && bearishClose && rsi > this.rsiBullish) {
      direction = 'sell';
      reason = `Upper BB touch at ${upperBand.toFixed(0)}, RSI=${rsi.toFixed(0)}, bearish close`;
    }

    if (!direction) {
      return { orders: [], debug: { reason: 'Price not at BB extreme', upper: Math.round(upperBand), lower: Math.round(lowerBand), price: Math.round(lastCandle.close), rsi: Math.round(rsi) } };
    }

    // Don't take same direction twice in a row
    if (direction === this.lastDirection) {
      return { orders: [], debug: { reason: `Same direction (${direction}), waiting for reversal` } };
    }

    // Step 6: SL beyond the opposite band, TP at middle band (SMA)
    // This gives the trade room to breathe while targeting the mean
    const entryPrice = lastCandle.close;
    const bandWidth = upperBand - lowerBand;
    let stopLoss: number, takeProfit: number;

    if (direction === 'buy') {
      stopLoss = lowerBand - bandWidth * 0.1; // Just beyond lower band
      takeProfit = sma; // Target middle
    } else {
      stopLoss = upperBand + bandWidth * 0.1; // Just beyond upper band
      takeProfit = sma; // Target middle
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
