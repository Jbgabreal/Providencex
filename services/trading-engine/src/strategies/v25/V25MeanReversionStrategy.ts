/**
 * V25 Mean Reversion Strategy
 *
 * Hypothesis: When V25 price deviates >1.5 sigma from SMA(20) on M5,
 * it has a higher-than-baseline probability of reverting toward the mean.
 * Enter when a reversal candle confirms the snap-back.
 *
 * All thresholds are BASELINE DEFAULTS — not validated production constants.
 * They must pass the validation protocol before deployment.
 *
 * Implementation key: V25_MEAN_REVERSION_V1
 */

import { Logger } from '@providencex/shared-utils';
import { IStrategy, StrategyContext, StrategyResult } from '../types';
import { StrategyProfile } from '../profiles/types';
import { MarketDataService } from '../../services/MarketDataService';
import { TradeSignal, Candle } from '../../types';

const logger = new Logger('V25MR');

export class V25MeanReversionStrategy implements IStrategy {
  readonly key = 'V25_MEAN_REVERSION_V1';
  readonly displayName = 'V25 Mean Reversion';

  private profile: StrategyProfile;
  private marketDataService: MarketDataService;

  // State
  private lastTradeTimestamp = 0;
  private tradeTimestamps24h: number[] = [];
  private consecutiveLosses = 0;
  private dailyPnLPct = 0;
  private lastDailyResetUTC = '';
  private hasOpenPosition = false;
  private lastSignalHash = '';
  private lastProcessedCandleTimestamp = 0;

  // Config (baseline defaults)
  private smaPeriod: number;
  private atrPeriod: number;
  private setupSigma: number;
  private triggerSigma: number;
  private slMultiplier: number;
  private tpMultiplier: number;
  private minBodyRatio: number;
  private maxTradesPerDay: number;
  private cooldownMinutes: number;
  private lossStreakPauseCount: number;
  private lossStreakPauseMinutes: number;
  private dailyLossLimitPct: number;
  private maxAtrRatio: number;

  constructor(profile: StrategyProfile) {
    this.profile = profile;
    this.marketDataService = new MarketDataService();

    const cfg = profile.config || {};
    this.smaPeriod = cfg.smaPeriod || 20;
    this.atrPeriod = cfg.atrPeriod || 14;
    this.setupSigma = cfg.setupSigma || 1.5;
    this.triggerSigma = cfg.triggerSigma || 1.0;
    this.slMultiplier = cfg.slMultiplier || 2.0;
    this.tpMultiplier = cfg.tpMultiplier || 2.5;
    this.minBodyRatio = cfg.minBodyRatio || 0.35;
    this.maxTradesPerDay = cfg.maxTradesPerDay || 3;
    this.cooldownMinutes = cfg.cooldownMinutes || 30;
    this.lossStreakPauseCount = cfg.lossStreakPauseCount || 3;
    this.lossStreakPauseMinutes = cfg.lossStreakPauseMinutes || 120;
    this.dailyLossLimitPct = cfg.dailyLossLimitPct || 5;
    this.maxAtrRatio = cfg.maxAtrRatio || 1.8;

    logger.info(
      `[V25MR] Init: SMA(${this.smaPeriod}), setup=${this.setupSigma}σ, ` +
      `trigger=${this.triggerSigma}σ, SL=${this.slMultiplier}ATR, TP=${this.tpMultiplier}ATR, ` +
      `maxTrades=${this.maxTradesPerDay}/24h, cooldown=${this.cooldownMinutes}min`
    );
  }

  async execute(context: StrategyContext): Promise<StrategyResult> {
    const { symbol } = context;
    const marketData = context.marketDataService || this.marketDataService;
    const now = Date.now();

    // Get M1 candles and aggregate to M5 internally
    // The backtester feeds M1; live also has M1 available.
    // We aggregate to M5 for cleaner signals.
    let m1Candles: Candle[];
    try {
      m1Candles = await marketData.getRecentCandles(symbol, 'M1', 400);
    } catch {
      return { orders: [], debug: { reason: 'Candle data unavailable' } };
    }

    if (!m1Candles?.length || m1Candles.length < 275) {
      return { orders: [], debug: { reason: `Insufficient M1 candles: ${m1Candles?.length || 0} (need 275 for M5 aggregation)` } };
    }

    // Aggregate M1 → M5 (group every 5 candles)
    const candles: Candle[] = [];
    for (let i = 0; i + 4 < m1Candles.length; i += 5) {
      const group = m1Candles.slice(i, i + 5);
      candles.push({
        timestamp: (group[0] as any).timestamp,
        open: group[0].open,
        high: Math.max(...group.map(c => c.high)),
        low: Math.min(...group.map(c => c.low)),
        close: group[4].close,
        volume: group.reduce((s, c) => s + (c.volume || 0), 0),
      });
    }

    if (candles.length < 55) {
      return { orders: [], debug: { reason: `Insufficient M5 candles after aggregation: ${candles.length}` } };
    }

    // Dedup: skip if already processed this candle
    const latestTimestamp = new Date((candles[candles.length - 1] as any).timestamp || 0).getTime();
    if (latestTimestamp > 0 && latestTimestamp === this.lastProcessedCandleTimestamp) {
      return { orders: [], debug: { reason: 'Already processed' } };
    }
    this.lastProcessedCandleTimestamp = latestTimestamp;

    // Position lockout
    if (this.hasOpenPosition) {
      return { orders: [], debug: { reason: 'Position open' } };
    }

    // Daily reset (UTC midnight)
    const todayUTC = new Date().toISOString().slice(0, 10);
    if (this.lastDailyResetUTC !== todayUTC) {
      this.dailyPnLPct = 0;
      this.lastDailyResetUTC = todayUTC;
    }

    // ── Gating ──

    // Rolling 24h trade limit
    this.tradeTimestamps24h = this.tradeTimestamps24h.filter(t => now - t < 24 * 60 * 60 * 1000);
    if (this.tradeTimestamps24h.length >= this.maxTradesPerDay) {
      return { orders: [], debug: { reason: `Trade limit: ${this.tradeTimestamps24h.length}/${this.maxTradesPerDay}` } };
    }

    // Cooldown
    if (this.lastTradeTimestamp > 0 && now - this.lastTradeTimestamp < this.cooldownMinutes * 60 * 1000) {
      return { orders: [], debug: { reason: 'Cooldown' } };
    }

    // Loss streak pause
    if (this.consecutiveLosses >= this.lossStreakPauseCount) {
      if (now - this.lastTradeTimestamp < this.lossStreakPauseMinutes * 60 * 1000) {
        return { orders: [], debug: { reason: `Loss streak pause: ${this.consecutiveLosses} losses` } };
      }
      this.consecutiveLosses = 0;
    }

    // Daily loss limit
    if (this.dailyPnLPct <= -this.dailyLossLimitPct) {
      return { orders: [], debug: { reason: `Daily loss limit: ${this.dailyPnLPct.toFixed(1)}%` } };
    }

    // ── Indicators ──
    const closes = candles.map(c => c.close);

    // SMA
    const smaSlice = closes.slice(-this.smaPeriod);
    const mean = smaSlice.reduce((s, v) => s + v, 0) / smaSlice.length;

    // Std Dev
    const variance = smaSlice.reduce((s, v) => s + (v - mean) ** 2, 0) / smaSlice.length;
    const sd = Math.sqrt(variance);

    // ATR (fast)
    const currentATR = this.calcATR(candles, this.atrPeriod);

    // ATR (slow — for regime filter)
    const slowATR = this.calcATR(candles, 50);

    if (sd === 0 || currentATR === 0 || slowATR === 0) {
      return { orders: [], debug: { reason: 'Zero volatility' } };
    }

    // ── Regime filter ──
    const atrRatio = currentATR / slowATR;
    if (atrRatio > this.maxAtrRatio) {
      return { orders: [], debug: { reason: `Extreme vol: ATR ratio ${atrRatio.toFixed(2)}` } };
    }

    // ── Setup + Trigger ──
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];

    const upperSetup = mean + this.setupSigma * sd;
    const lowerSetup = mean - this.setupSigma * sd;
    const upperTrigger = mean + this.triggerSigma * sd;
    const lowerTrigger = mean - this.triggerSigma * sd;

    let direction: 'buy' | 'sell' | null = null;
    let reason = '';

    // BUY: prev candle overextended below, current candle bounces back
    if (prevCandle.close < lowerSetup) {
      const bullish = lastCandle.close > lastCandle.open;
      const bodyRatio = Math.abs(lastCandle.close - lastCandle.open) / (lastCandle.high - lastCandle.low + 0.01);
      const returnedAbove = lastCandle.close > lowerTrigger;

      if (bullish && returnedAbove && bodyRatio >= this.minBodyRatio) {
        direction = 'buy';
        reason = `MR BUY: prev ${Math.round(prevCandle.close)} < ${Math.round(lowerSetup)} (${this.setupSigma}σ), bounce body=${(bodyRatio * 100).toFixed(0)}%`;
      }
    }

    // SELL: prev candle overextended above, current candle rejects back
    if (!direction && prevCandle.close > upperSetup) {
      const bearish = lastCandle.close < lastCandle.open;
      const bodyRatio = Math.abs(lastCandle.close - lastCandle.open) / (lastCandle.high - lastCandle.low + 0.01);
      const returnedBelow = lastCandle.close < upperTrigger;

      if (bearish && returnedBelow && bodyRatio >= this.minBodyRatio) {
        direction = 'sell';
        reason = `MR SELL: prev ${Math.round(prevCandle.close)} > ${Math.round(upperSetup)} (${this.setupSigma}σ), rejection body=${(bodyRatio * 100).toFixed(0)}%`;
      }
    }

    if (!direction) {
      return { orders: [], debug: {
        reason: 'No setup',
        price: Math.round(lastCandle.close),
        mean: Math.round(mean),
        upper: Math.round(upperSetup),
        lower: Math.round(lowerSetup),
        atrRatio: +atrRatio.toFixed(2),
      }};
    }

    // Duplicate signal check
    const signalHash = `${direction}_${latestTimestamp}`;
    if (signalHash === this.lastSignalHash) {
      return { orders: [], debug: { reason: 'Duplicate signal' } };
    }
    this.lastSignalHash = signalHash;

    // ── SL / TP ──
    const entryPrice = lastCandle.close;
    const slDistance = this.slMultiplier * currentATR;
    const tpDistance = this.tpMultiplier * currentATR;

    const stopLoss = direction === 'buy' ? entryPrice - slDistance : entryPrice + slDistance;
    const takeProfit = direction === 'buy' ? entryPrice + tpDistance : entryPrice - tpDistance;

    // Validate R:R
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    if (risk <= 0 || reward / risk < 1.2) {
      return { orders: [], debug: { reason: `R:R ${(reward / risk).toFixed(2)} < 1.2` } };
    }

    // ── Update state ──
    this.lastTradeTimestamp = now;
    this.tradeTimestamps24h.push(now);
    this.hasOpenPosition = true;

    const signal: TradeSignal = {
      symbol,
      direction,
      entry: entryPrice,
      stopLoss,
      takeProfit,
      orderKind: 'market',
      reason: `V25 MR: ${reason}`,
      meta: {
        strategyKey: this.key,
        profileKey: this.profile.key,
        mean, sd, atr: currentATR, atrRatio,
        setupSigma: this.setupSigma,
        riskRewardRatio: reward / risk,
      },
    };

    logger.info(
      `[V25MR] ${symbol}: ${direction.toUpperCase()} @ ${entryPrice.toFixed(0)} ` +
      `| SL: ${stopLoss.toFixed(0)} (${this.slMultiplier}ATR) ` +
      `| TP: ${takeProfit.toFixed(0)} (${this.tpMultiplier}ATR) ` +
      `| R:R=${(reward / risk).toFixed(2)} | ${reason}`
    );

    return {
      orders: [{ signal, metadata: { strategyKey: this.key } }],
      debug: { direction, mean, sd, atr: currentATR, atrRatio },
    };
  }

  private calcATR(candles: Candle[], period: number): number {
    if (candles.length < period + 1) return 0;
    let sum = 0;
    const start = Math.max(1, candles.length - period);
    for (let i = start; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      sum += tr;
    }
    return sum / period;
  }

  // Called by execution engine after trade closes
  onTradeResult(won: boolean, pnlPct: number): void {
    this.hasOpenPosition = false;
    if (won) {
      this.consecutiveLosses = 0;
    } else {
      this.consecutiveLosses++;
    }
    this.dailyPnLPct += pnlPct;
  }
}
