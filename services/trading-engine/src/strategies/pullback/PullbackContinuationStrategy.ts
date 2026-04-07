/**
 * PB v3 — Pullback Continuation Strategy (IStrategy Implementation)
 *
 * Higher-frequency pullback continuation strategy.
 * Mirrors the TradingView PB v3 Pine Script logic exactly.
 *
 * Logic:
 *   1. EMA 9/21 crossover for LTF trend bias
 *   2. HTF (15m) EMA 20 for higher timeframe bias
 *   3. Pullback: price touches EMA within lookback window + RSI dips
 *   4. Reclaim: bullish bar closes above fast EMA
 *   5. SL = min(low, EMA slow) - ATR * mult
 *   6. TP = entry + risk * R:R
 *
 * Implementation key: PULLBACK_CONT_V1
 */

import { Logger } from '@providencex/shared-utils';
import { IStrategy, StrategyContext, StrategyResult } from '../types';
import { StrategyProfile } from '../profiles/types';
import { TradeSignal, Candle } from '../../types';

const logger = new Logger('PullbackCont');

// ── Technical indicator helpers ──

function ema(candles: Candle[], period: number): number[] {
  const result: number[] = new Array(candles.length).fill(0);
  if (candles.length === 0 || period <= 0) return result;
  const k = 2 / (period + 1);
  result[0] = candles[0].close;
  for (let i = 1; i < candles.length; i++) {
    result[i] = candles[i].close * k + result[i - 1] * (1 - k);
  }
  return result;
}

function rsi(candles: Candle[], period: number): number[] {
  const result: number[] = new Array(candles.length).fill(50);
  if (candles.length < period + 1) return result;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function atr(candles: Candle[], period: number): number[] {
  const result: number[] = new Array(candles.length).fill(0);
  if (candles.length < 2) return result;
  // True range
  const tr: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    tr.push(Math.max(hl, hc, lc));
  }
  // RMA (Wilder's smoothing)
  let sum = 0;
  for (let i = 0; i < Math.min(period, tr.length); i++) sum += tr[i];
  if (tr.length >= period) {
    result[period - 1] = sum / period;
    for (let i = period; i < tr.length; i++) {
      result[i] = (result[i - 1] * (period - 1) + tr[i]) / period;
    }
  }
  return result;
}

/**
 * Aggregate M1 candles into a higher timeframe (e.g., M3, M15).
 */
function aggregateCandles(m1Candles: Candle[], periodMinutes: number): Candle[] {
  if (m1Candles.length === 0) return [];
  const result: Candle[] = [];
  let bucket: Candle | null = null;
  let bucketStartMs = 0;
  for (const c of m1Candles) {
    const time = new Date(c.timestamp).getTime();
    const newBucketStart = Math.floor(time / (periodMinutes * 60000)) * (periodMinutes * 60000);
    if (!bucket || bucketStartMs !== newBucketStart) {
      if (bucket) result.push(bucket);
      bucketStartMs = newBucketStart;
      bucket = {
        timestamp: new Date(newBucketStart).toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      };
    } else {
      bucket.high = Math.max(bucket.high, c.high);
      bucket.low = Math.min(bucket.low, c.low);
      bucket.close = c.close;
      bucket.volume += c.volume;
    }
  }
  if (bucket) result.push(bucket);
  return result;
}

export class PullbackContinuationStrategy implements IStrategy {
  readonly key = 'PULLBACK_CONT_V1';
  readonly displayName = 'PB v3 Pullback Continuation';

  private profile: StrategyProfile;

  // Config with defaults (overridable via profile.config)
  private emaFastLen: number;
  private emaSlowLen: number;
  private htfEmaLen: number;
  private rsiLen: number;
  private rsiPullbackLong: number;
  private rsiPullbackShort: number;
  private atrLen: number;
  private atrStopMult: number;
  private riskReward: number;
  private pullbackLookback: number;
  private useHTFBias: boolean;
  private htfMinutes: number;
  private cooldownBars: number;
  private _logged = false;
  private _logged2 = false;
  private _evalCount = 0;

  constructor(profile: StrategyProfile) {
    this.profile = profile;
    const c = profile.config || {};
    this.emaFastLen = c.emaFastLen ?? 9;
    this.emaSlowLen = c.emaSlowLen ?? 21;
    this.htfEmaLen = c.htfEmaLen ?? 20;
    this.rsiLen = c.rsiLen ?? 14;
    this.rsiPullbackLong = c.rsiPullbackLong ?? 50;
    this.rsiPullbackShort = c.rsiPullbackShort ?? 50;
    this.atrLen = c.atrLen ?? 14;
    this.atrStopMult = c.atrStopMult ?? 1.0;
    this.riskReward = c.riskReward ?? 2.0;
    this.pullbackLookback = c.pullbackLookback ?? 2;
    this.useHTFBias = c.useHTFBias !== false;
    this.htfMinutes = c.htfMinutes ?? 15;
    this.cooldownBars = c.cooldownBars ?? 3;
  }

  async execute(context: StrategyContext): Promise<StrategyResult> {
   try {
    const { symbol } = context;
    const mds = context.marketDataService;
    const minCandles = Math.max(this.emaSlowLen, this.rsiLen, this.atrLen) + 10;
    this._evalCount++;
    if (this._evalCount <= 3 || this._evalCount % 1000 === 0) {
      logger.info(`[PB v3] execute() called #${this._evalCount} for ${symbol}`);
    }

    // Fetch M1 candles from MarketDataService (same pattern as GodSmcStrategy)
    let m1Candles: any[] = [];
    try {
      if (mds && typeof mds.getRecentCandles === 'function') {
        m1Candles = await mds.getRecentCandles(symbol, 'M1', 2000) || [];
      } else if (context.candles && context.candles.length > 0) {
        m1Candles = context.candles;
      }
    } catch (e) {
      if (this._evalCount <= 3) logger.error(`[PB v3] getRecentCandles error: ${e}`);
      return { orders: [], debug: { reason: `getRecentCandles error: ${e}` } };
    }

    if (this._evalCount <= 3 && m1Candles.length > 0) {
      const s = m1Candles[0];
      logger.info(`[PB v3] M1 sample: keys=${Object.keys(s).join(',')}, timestamp=${s.timestamp}, startTime=${s.startTime}, open=${s.open}`);
    }
    if (m1Candles.length < minCandles * 3) {
      if (!this._logged) logger.warn(`[PB v3] ${symbol}: Insufficient M1: ${m1Candles.length} < ${minCandles * 3}`);
      return { orders: [], debug: { reason: `Insufficient M1 candles: ${m1Candles.length}` } };
    }

    // Convert MarketData Candle format (startTime: Date) to our Candle format (timestamp: string)
    let normalizedCandles: Candle[];
    try {
    normalizedCandles = m1Candles.map((c: any) => ({
      timestamp: typeof c.timestamp === 'string' ? c.timestamp
        : c.startTime instanceof Date ? c.startTime.toISOString()
        : typeof c.startTime === 'string' ? c.startTime
        : new Date().toISOString(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 0,
    }));

    } catch(e2) {
      logger.error(`[PB v3] normalization/aggregation error: ${e2}`);
      return { orders: [], debug: { reason: `norm error: ${e2}` } };
    }

    if (!this._logged) {
      this._logged = true;
      logger.info(`[PB v3] ${symbol}: Got ${normalizedCandles.length} M1 candles, first=${normalizedCandles[0]?.timestamp}, last=${normalizedCandles[normalizedCandles.length-1]?.timestamp}`);
    }

    // Use M3 candles (aggregate M1 → M3) for the entry timeframe
    const m3Candles = aggregateCandles(normalizedCandles, 3);
    if (m3Candles.length < minCandles) {
      return { orders: [], debug: { reason: `Insufficient M3 candles: ${m3Candles.length}` } };
    }

    if (this._evalCount <= 3) {
      logger.info(`[PB v3] M3=${m3Candles.length}, last close=${m3Candles[m3Candles.length-1].close}`);
    }

    // ── Calculate indicators on M3 ──
    const emaFastArr = ema(m3Candles, this.emaFastLen);
    const emaSlowArr = ema(m3Candles, this.emaSlowLen);
    const rsiArr = rsi(m3Candles, this.rsiLen);
    const atrArr = atr(m3Candles, this.atrLen);

    // ── HTF bias (M15) ──
    let htfBull = true;
    let htfBear = true;
    if (this.useHTFBias) {
      const htfCandles = aggregateCandles(normalizedCandles, this.htfMinutes);
      if (htfCandles.length >= this.htfEmaLen + 2) {
        const htfEmaArr = ema(htfCandles, this.htfEmaLen);
        const lastHTF = htfCandles.length - 2; // Use confirmed bar (not current)
        htfBull = htfCandles[lastHTF].close > htfEmaArr[lastHTF];
        htfBear = htfCandles[lastHTF].close < htfEmaArr[lastHTF];
      }
    }

    // ── Check latest M3 bar for signal ──
    const i = m3Candles.length - 1;
    const emaFast = emaFastArr[i];
    const emaSlow = emaSlowArr[i];
    const rsiVal = rsiArr[i];
    const atrVal = atrArr[i];

    if (atrVal <= 0) {
      if (this._evalCount <= 3) logger.warn(`[PB v3] ${symbol}: ATR=0 at M3 idx=${i}, M3 count=${m3Candles.length}`);
      return { orders: [], debug: { reason: 'ATR is zero' } };
    }

    // LTF bias
    const ltfBull = emaFast > emaSlow;
    const ltfBear = emaFast < emaSlow;
    const bullBias = ltfBull && (!this.useHTFBias || htfBull);
    const bearBias = ltfBear && (!this.useHTFBias || htfBear);

    // Pullback detection with lookback
    let pullbackTouchedLong = false;
    let pullbackTouchedShort = false;
    for (let j = 0; j < this.pullbackLookback && (i - j) >= 0; j++) {
      const idx = i - j;
      if (m3Candles[idx].low <= emaFastArr[idx] || m3Candles[idx].low <= emaSlowArr[idx]) {
        pullbackTouchedLong = true;
      }
      if (m3Candles[idx].high >= emaFastArr[idx] || m3Candles[idx].high >= emaSlowArr[idx]) {
        pullbackTouchedShort = true;
      }
    }

    const pullbackLong = pullbackTouchedLong && rsiVal <= this.rsiPullbackLong;
    const pullbackShort = pullbackTouchedShort && rsiVal >= this.rsiPullbackShort;

    const bar = m3Candles[i];
    const bullishBar = bar.close > bar.open;
    const bearishBar = bar.close < bar.open;

    // Signal conditions
    const longSignal = bullBias && pullbackLong && bar.close > emaFast && bullishBar;
    const shortSignal = bearBias && pullbackShort && bar.close < emaFast && bearishBar;

    if (this._evalCount % 500 === 1) {
      logger.info(`[PB v3] eval#${this._evalCount} ${symbol}: M3=${m3Candles.length} close=${bar.close.toFixed(2)} emaF=${emaFast.toFixed(2)} emaS=${emaSlow.toFixed(2)} RSI=${rsiVal.toFixed(1)} bull=${bullBias} bear=${bearBias} pbL=${pullbackLong} pbS=${pullbackShort} bullBar=${bullishBar}`);
    }

    if (!longSignal && !shortSignal) {
      return {
        orders: [],
        debug: {
          reason: `No signal: bull=${bullBias} bear=${bearBias} pbL=${pullbackLong} pbS=${pullbackShort} reclaim=${bar.close > emaFast} bullBar=${bullishBar} RSI=${rsiVal.toFixed(1)} M3=${m3Candles.length}`,
          emaFast: +emaFast.toFixed(2),
          emaSlow: +emaSlow.toFixed(2),
          rsi: +rsiVal.toFixed(1),
          atr: +atrVal.toFixed(2),
          bullBias,
          bearBias,
          pullbackLong,
          pullbackShort,
          htfBull,
          htfBear,
        },
      };
    }

    // ── Build signal ──
    const direction = longSignal ? 'buy' : 'sell';
    const entry = bar.close;

    let stopLoss: number;
    let takeProfit: number;

    if (direction === 'buy') {
      stopLoss = Math.min(bar.low, emaSlow) - atrVal * this.atrStopMult;
      const risk = entry - stopLoss;
      if (risk <= 0) return { orders: [], debug: { reason: 'Invalid risk (buy)' } };
      takeProfit = entry + risk * this.riskReward;
    } else {
      stopLoss = Math.max(bar.high, emaSlow) + atrVal * this.atrStopMult;
      const risk = stopLoss - entry;
      if (risk <= 0) return { orders: [], debug: { reason: 'Invalid risk (sell)' } };
      takeProfit = entry - risk * this.riskReward;
    }

    const risk = Math.abs(entry - stopLoss);
    const rr = risk > 0 ? Math.abs(takeProfit - entry) / risk : 0;

    const signal: TradeSignal = {
      symbol,
      direction,
      entry,
      stopLoss,
      takeProfit,
      reason: `PB v3: ${direction} EMA ${this.emaFastLen}/${this.emaSlowLen} reclaim, RSI=${rsiVal.toFixed(1)}, R:R=${rr.toFixed(1)}`,
      orderKind: 'market',
      meta: {
        source: 'pullback_continuation_v1',
        strategy: 'PB_v3',
        strategyKey: 'PULLBACK_CONT_V1',
        profileKey: 'pullback_continuation_v1',
        emaFast: +emaFast.toFixed(2),
        emaSlow: +emaSlow.toFixed(2),
        rsi: +rsiVal.toFixed(1),
        atr: +atrVal.toFixed(2),
        riskReward: +rr.toFixed(2),
        htfBias: htfBull ? 'bull' : htfBear ? 'bear' : 'flat',
      },
    };

    logger.info(
      `[PB v3] ${symbol}: ${direction.toUpperCase()} @ ${entry.toFixed(2)}, ` +
      `SL=${stopLoss.toFixed(2)}, TP=${takeProfit.toFixed(2)}, R:R=${rr.toFixed(1)}, ` +
      `RSI=${rsiVal.toFixed(1)}, EMA=${emaFast.toFixed(2)}/${emaSlow.toFixed(2)}`
    );

    return {
      orders: [{ signal, metadata: { ...signal.meta } }],
      debug: signal.meta,
    };
   } catch (topError) {
    if (this._evalCount <= 5) {
      logger.error(`[PB v3] UNCAUGHT ERROR in execute(): ${topError}`);
      if (topError instanceof Error) logger.error(`[PB v3] Stack: ${topError.stack}`);
    }
    return { orders: [], debug: { reason: `Error: ${topError}` } };
   }
  }
}
