/**
 * V25 H1 Momentum Strategy — Autocorrelation-Gated with M15 Pullback Entry
 *
 * RESEARCH-GRADE STRATEGY. All thresholds are research defaults only.
 *
 * Flow:
 *   1. Aggregate M1 → M15 + H1 internally
 *   2. On each new M15 close: check H1 regime → bias → pullback → trigger
 *   3. If signal found, emit trade with structural SL/TP
 *
 * Implements IStrategy interface for backtest compatibility.
 * Reuses exact regime/bias/pullback/trigger logic from V25H1MomentumDiagnostic.
 *
 * Implementation key: V25_H1_MOMENTUM_V1
 */

import { Logger } from '@providencex/shared-utils';
import { IStrategy, StrategyContext, StrategyResult } from '../types';
import { StrategyProfile } from '../profiles/types';
import { MarketDataService } from '../../services/MarketDataService';
import { TradeSignal, Candle } from '../../types';

const logger = new Logger('V25H1M');

// ── Config ──

interface V25H1MConfig {
  // Regime (H1)
  autocorrWindow: number;
  autocorrLag1Min: number;
  emaFastPeriod: number;
  emaSlowPeriod: number;
  emaSlopeLookback: number;
  emaSlopeMin: number;
  efficiencyWindow: number;
  efficiencyMin: number;
  signPersistenceWindow: number;
  signPersistenceMin: number;
  extensionAtrMax: number;

  // Pullback (M15)
  ltfAtrPeriod: number;
  minImpulseAtrMult: number;
  minRetracePct: number;
  maxRetracePct: number;
  minPullbackBars: number;

  // Trigger
  triggerBodyRatioMin: number;

  // Exits
  slAtrBuffer: number;     // ATR buffer added to structural SL
  takeProfitR: number;     // TP as multiple of SL distance
  timeStopBars: number;    // close after N M15 bars (0 = disabled)

  // Gating
  maxTradesPerDay: number;
  cooldownMinutes: number;
  maxConsecutiveLosses: number;
  lossPauseMinutes: number;

  // Execution friction (backtest)
  slippageTicks: number;   // adverse slippage per trade
}

const DEFAULT_CONFIG: V25H1MConfig = {
  autocorrWindow: 20,
  autocorrLag1Min: 0.10,
  emaFastPeriod: 20,
  emaSlowPeriod: 50,
  emaSlopeLookback: 5,
  emaSlopeMin: 0.1,
  efficiencyWindow: 10,
  efficiencyMin: 0.25,
  signPersistenceWindow: 10,
  signPersistenceMin: 0.60,
  extensionAtrMax: 3.0,
  ltfAtrPeriod: 14,
  minImpulseAtrMult: 1.5,
  minRetracePct: 0.30,
  maxRetracePct: 0.80,
  minPullbackBars: 2,
  triggerBodyRatioMin: 0.35,
  slAtrBuffer: 0.3,
  takeProfitR: 2.0,
  timeStopBars: 20,        // ~5 hours of M15
  maxTradesPerDay: 3,
  cooldownMinutes: 60,
  maxConsecutiveLosses: 3,
  lossPauseMinutes: 120,
  slippageTicks: 2,
};

export class V25H1MomentumStrategy implements IStrategy {
  readonly key = 'V25_H1_MOMENTUM_V1';
  readonly displayName = 'V25 H1 Momentum';

  private profile: StrategyProfile;
  private marketDataService: MarketDataService;
  private cfg: V25H1MConfig;

  // State
  private lastTradeTimestamp = 0;
  private tradeTimestamps24h: number[] = [];
  private consecutiveLosses = 0;
  private hasOpenPosition = false;
  private lastProcessedM15Count = 0;

  // Candle buffers for internal aggregation
  private m15Buffer: Candle[] = [];
  private h1Buffer: Candle[] = [];
  private m1Count = 0;
  private m1WindowForM15: Candle[] = [];
  private m1WindowForH1: Candle[] = [];

  constructor(profile: StrategyProfile) {
    this.profile = profile;
    this.marketDataService = new MarketDataService();

    const c = profile.config || {};
    this.cfg = { ...DEFAULT_CONFIG };
    for (const k of Object.keys(DEFAULT_CONFIG) as (keyof V25H1MConfig)[]) {
      if (c[k] !== undefined && typeof c[k] === typeof DEFAULT_CONFIG[k]) {
        (this.cfg as any)[k] = c[k];
      }
    }

    logger.info(
      `[V25H1M] Init: regime(ac>${this.cfg.autocorrLag1Min}, eff>${this.cfg.efficiencyMin}), ` +
      `pullback(imp>${this.cfg.minImpulseAtrMult}ATR, retrace ${this.cfg.minRetracePct}-${this.cfg.maxRetracePct}), ` +
      `TP=${this.cfg.takeProfitR}R, maxTrades=${this.cfg.maxTradesPerDay}/24h`
    );
  }

  async execute(context: StrategyContext): Promise<StrategyResult> {
    const { symbol } = context;
    const marketData = context.marketDataService || this.marketDataService;
    const now = Date.now();

    // Get M1 candles — need enough for H1 aggregation + indicator warmup
    // 60 H1 bars × 60 M1/H1 = 3600 M1 candles ideal
    let m1Candles: Candle[];
    try {
      m1Candles = await marketData.getRecentCandles(symbol, 'M1', 4000);
    } catch {
      return { orders: [], debug: { reason: 'M1 data unavailable' } };
    }

    if (!m1Candles?.length || m1Candles.length < 1000) {
      return { orders: [], debug: { reason: `Insufficient M1: ${m1Candles?.length || 0}` } };
    }

    // Aggregate M1 → M15 and H1
    const m15 = this.aggregateCandles(m1Candles, 15);
    const h1 = this.aggregateCandles(m1Candles, 60);

    if (m15.length < 25 || h1.length < 55) {
      return { orders: [], debug: { reason: `Warming up: M15=${m15.length}, H1=${h1.length}` } };
    }

    // Only process when a new M15 bar has formed (every 15 M1 candles)
    const currentM15Count = m15.length;
    if (currentM15Count === this.lastProcessedM15Count) {
      return { orders: [], debug: { reason: 'No new M15 bar' } };
    }
    this.lastProcessedM15Count = currentM15Count;

    // Position lockout
    if (this.hasOpenPosition) {
      return { orders: [], debug: { reason: 'Position open' } };
    }

    // ── Gating ──
    this.tradeTimestamps24h = this.tradeTimestamps24h.filter(t => now - t < 86400000);

    if (this.tradeTimestamps24h.length >= this.cfg.maxTradesPerDay) {
      return { orders: [], debug: { reason: `Trade limit: ${this.tradeTimestamps24h.length}/${this.cfg.maxTradesPerDay}` } };
    }

    if (this.lastTradeTimestamp > 0 && now - this.lastTradeTimestamp < this.cfg.cooldownMinutes * 60000) {
      return { orders: [], debug: { reason: 'Cooldown' } };
    }

    if (this.consecutiveLosses >= this.cfg.maxConsecutiveLosses) {
      if (now - this.lastTradeTimestamp < this.cfg.lossPauseMinutes * 60000) {
        return { orders: [], debug: { reason: `Loss pause: ${this.consecutiveLosses} losses` } };
      }
      this.consecutiveLosses = 0;
    }

    // ── Phase 1: H1 Regime Detection ──
    const h1Idx = h1.length - 2; // use last COMPLETED H1 bar
    const regime = this.detectRegime(h1, h1Idx);

    if (!regime || !regime.regimeValid) {
      return { orders: [], debug: { reason: 'Regime invalid', regime: regime || {} } };
    }

    if (regime.bias === 'none') {
      return { orders: [], debug: { reason: 'No bias', regime } };
    }

    // ── Phase 2: M15 Pullback + Trigger ──
    const ltfIdx = m15.length - 1; // current (just closed) M15 bar
    const signal = this.findPullbackTrigger(m15, ltfIdx, regime.bias, regime);

    if (!signal) {
      return { orders: [], debug: { reason: 'No pullback/trigger', bias: regime.bias } };
    }

    // ── Calculate SL/TP ──
    const ltfATR = this.calcATR(m15, this.cfg.ltfAtrPeriod, ltfIdx);
    const entryPrice = signal.entryPrice;

    // Apply slippage (conservative: adverse direction)
    const tickSize = ltfATR / 100; // rough tick estimate
    const slippage = this.cfg.slippageTicks * tickSize;
    const adjustedEntry = regime.bias === 'long'
      ? entryPrice + slippage
      : entryPrice - slippage;

    // SL at structural invalidation + ATR buffer
    const slDistance = Math.abs(adjustedEntry - signal.structuralInvalidation) + this.cfg.slAtrBuffer * ltfATR;
    const tpDistance = slDistance * this.cfg.takeProfitR;

    const stopLoss = regime.bias === 'long'
      ? adjustedEntry - slDistance
      : adjustedEntry + slDistance;
    const takeProfit = regime.bias === 'long'
      ? adjustedEntry + tpDistance
      : adjustedEntry - tpDistance;

    // Validate R:R
    const risk = Math.abs(adjustedEntry - stopLoss);
    const reward = Math.abs(takeProfit - adjustedEntry);
    if (risk <= 0 || reward / risk < 1.2) {
      return { orders: [], debug: { reason: `R:R ${(reward / risk).toFixed(2)} < 1.2` } };
    }

    // ── Update state ──
    this.lastTradeTimestamp = now;
    this.tradeTimestamps24h.push(now);
    this.hasOpenPosition = true;

    const tradeSignal: TradeSignal = {
      symbol,
      direction: regime.bias === 'long' ? 'buy' : 'sell',
      entry: adjustedEntry,
      stopLoss,
      takeProfit,
      orderKind: 'market',
      reason: `V25 H1M: ${regime.bias.toUpperCase()} regime(eff=${regime.efficiencyRatio.toFixed(2)}, sp=${regime.signPersistence.toFixed(2)}), pullback retrace=${(signal.retraceDepth * 100).toFixed(0)}%, trigger body=${(signal.triggerBodyRatio * 100).toFixed(0)}%`,
      meta: {
        strategyKey: this.key,
        profileKey: this.profile.key,
        regime: {
          autocorrLag1: regime.autocorrLag1,
          efficiencyRatio: regime.efficiencyRatio,
          signPersistence: regime.signPersistence,
          ema20: regime.ema20,
          ema50: regime.ema50,
        },
        impulseAtr: signal.impulseSize,
        retraceDepth: signal.retraceDepth,
        pullbackBars: signal.pullbackBars,
        slippage,
        rr: reward / risk,
      },
    };

    logger.info(
      `[V25H1M] ${symbol}: ${regime.bias.toUpperCase()} @ ${adjustedEntry.toFixed(0)} ` +
      `| SL: ${stopLoss.toFixed(0)} | TP: ${takeProfit.toFixed(0)} | R:R=${(reward / risk).toFixed(2)} ` +
      `| regime(eff=${regime.efficiencyRatio.toFixed(2)}) ` +
      `| pullback(retrace=${(signal.retraceDepth * 100).toFixed(0)}%, imp=${signal.impulseSize.toFixed(1)}ATR)`
    );

    return {
      orders: [{ signal: tradeSignal, metadata: { strategyKey: this.key } }],
      debug: { direction: regime.bias, regime, signal },
    };
  }

  // Called by execution engine after trade closes
  onTradeResult(won: boolean): void {
    this.hasOpenPosition = false;
    if (won) this.consecutiveLosses = 0;
    else this.consecutiveLosses++;
  }

  // ── Regime Detection (identical to diagnostic) ──

  private detectRegime(h1: Candle[], idx: number): {
    regimeValid: boolean;
    bias: 'long' | 'short' | 'none';
    autocorrLag1: number;
    efficiencyRatio: number;
    signPersistence: number;
    emaSlopeNorm: number;
    ema20: number;
    ema50: number;
    atr: number;
  } | null {
    if (idx < this.cfg.emaSlowPeriod + this.cfg.autocorrWindow) return null;

    const closes = h1.slice(0, idx + 1).map(c => c.close);
    const ema20Arr = this.calcEMA(closes, this.cfg.emaFastPeriod);
    const ema50Arr = this.calcEMA(closes, this.cfg.emaSlowPeriod);
    if (ema20Arr.length < this.cfg.emaSlopeLookback + 1 || ema50Arr.length < 1) return null;

    const ema20 = ema20Arr[ema20Arr.length - 1];
    const ema50 = ema50Arr[ema50Arr.length - 1];
    const atrVal = this.calcATR(h1, 14, idx);
    if (atrVal === 0) return null;

    // Autocorrelation
    const wStart = Math.max(0, idx - this.cfg.autocorrWindow);
    const returns: number[] = [];
    for (let i = wStart + 1; i <= idx; i++) returns.push(h1[i].close - h1[i - 1].close);
    const ac1 = this.autocorrelation(returns, 1);

    // EMA slope
    const slopeW = Math.min(this.cfg.emaSlopeLookback, ema20Arr.length - 1);
    const emaOld = ema20Arr[ema20Arr.length - 1 - slopeW];
    const emaSlopeNorm = ((ema20 - emaOld) / slopeW) / atrVal;

    // Efficiency ratio
    const effStart = Math.max(0, idx - this.cfg.efficiencyWindow);
    const netMove = Math.abs(h1[idx].close - h1[effStart].close);
    let pathLen = 0;
    for (let i = effStart + 1; i <= idx; i++) pathLen += Math.abs(h1[i].close - h1[i - 1].close);
    const efficiency = pathLen > 0 ? netMove / pathLen : 0;

    // Sign persistence
    const spStart = Math.max(0, idx - this.cfg.signPersistenceWindow);
    const netDir = h1[idx].close > h1[spStart].close ? 1 : -1;
    let sameSign = 0;
    for (let i = spStart + 1; i <= idx; i++) {
      if ((h1[i].close > h1[i - 1].close ? 1 : -1) === netDir) sameSign++;
    }
    const signPersistence = (idx - spStart) > 0 ? sameSign / (idx - spStart) : 0;

    const regimeValid =
      (ac1 >= this.cfg.autocorrLag1Min || (efficiency >= this.cfg.efficiencyMin && signPersistence >= this.cfg.signPersistenceMin)) &&
      efficiency >= this.cfg.efficiencyMin * 0.7 &&
      Math.abs(emaSlopeNorm) >= this.cfg.emaSlopeMin;

    let bias: 'long' | 'short' | 'none' = 'none';
    if (regimeValid) {
      const extension = Math.abs(h1[idx].close - ema20) / atrVal;
      if (extension > this.cfg.extensionAtrMax) bias = 'none';
      else if (ema20 > ema50 && emaSlopeNorm > 0) bias = 'long';
      else if (ema20 < ema50 && emaSlopeNorm < 0) bias = 'short';
    }

    return { regimeValid, bias, autocorrLag1: ac1, efficiencyRatio: efficiency, signPersistence, emaSlopeNorm, ema20, ema50, atr: atrVal };
  }

  // ── Pullback + Trigger Detection (identical to diagnostic) ──

  private findPullbackTrigger(
    ltf: Candle[], ltfIdx: number, bias: 'long' | 'short', regime: any,
  ): {
    entryPrice: number;
    structuralInvalidation: number;
    impulseSize: number;
    retraceDepth: number;
    pullbackBars: number;
    triggerBodyRatio: number;
  } | null {
    if (ltfIdx < 20) return null;

    const ltfATR = this.calcATR(ltf, this.cfg.ltfAtrPeriod, ltfIdx);
    if (ltfATR === 0) return null;

    // Find recent impulse
    let impulseStart = -1, impulseEnd = -1, bestImpulse = 0;

    for (let lookback = 5; lookback <= 20 && lookback <= ltfIdx; lookback++) {
      const start = ltfIdx - lookback;
      let swingLow = Infinity, swingHigh = -Infinity;
      let lowIdx = start, highIdx = start;
      for (let j = start; j <= ltfIdx; j++) {
        if (ltf[j].low < swingLow) { swingLow = ltf[j].low; lowIdx = j; }
        if (ltf[j].high > swingHigh) { swingHigh = ltf[j].high; highIdx = j; }
      }

      const validImpulse = bias === 'long' ? lowIdx < highIdx : highIdx < lowIdx;
      if (validImpulse) {
        const imp = swingHigh - swingLow;
        if (imp > bestImpulse) {
          bestImpulse = imp;
          impulseStart = bias === 'long' ? lowIdx : highIdx;
          impulseEnd = bias === 'long' ? highIdx : lowIdx;
        }
      }
    }

    if (impulseStart < 0 || bestImpulse < this.cfg.minImpulseAtrMult * ltfATR) return null;

    const impulseHigh = bias === 'long' ? ltf[impulseEnd].high : ltf[impulseStart].high;
    const impulseLow = bias === 'long' ? ltf[impulseStart].low : ltf[impulseEnd].low;
    const impulseSize = impulseHigh - impulseLow;

    const pullbackBars = ltfIdx - impulseEnd;
    if (pullbackBars < this.cfg.minPullbackBars) return null;

    // Retrace depth
    let retraceDepth: number;
    if (bias === 'long') {
      const pbLow = Math.min(...ltf.slice(impulseEnd, ltfIdx + 1).map(c => c.low));
      retraceDepth = (impulseHigh - pbLow) / impulseSize;
    } else {
      const pbHigh = Math.max(...ltf.slice(impulseEnd, ltfIdx + 1).map(c => c.high));
      retraceDepth = (pbHigh - impulseLow) / impulseSize;
    }

    if (retraceDepth < this.cfg.minRetracePct || retraceDepth > this.cfg.maxRetracePct) return null;

    // Continuation trigger
    const curr = ltf[ltfIdx];
    const prev = ltf[ltfIdx - 1];
    const bodyRatio = Math.abs(curr.close - curr.open) / (curr.high - curr.low + 0.01);

    let triggerOk = false;
    if (bias === 'long') {
      triggerOk = curr.close > curr.open && curr.close > prev.high && bodyRatio >= this.cfg.triggerBodyRatioMin;
    } else {
      triggerOk = curr.close < curr.open && curr.close < prev.low && bodyRatio >= this.cfg.triggerBodyRatioMin;
    }

    if (!triggerOk) return null;

    // Structural invalidation
    const structInv = bias === 'long'
      ? Math.min(...ltf.slice(Math.max(0, ltfIdx - 3), ltfIdx + 1).map(c => c.low))
      : Math.max(...ltf.slice(Math.max(0, ltfIdx - 3), ltfIdx + 1).map(c => c.high));

    return {
      entryPrice: curr.close,
      structuralInvalidation: structInv,
      impulseSize: impulseSize / ltfATR,
      retraceDepth,
      pullbackBars,
      triggerBodyRatio: bodyRatio,
    };
  }

  // ── Indicator Helpers ──

  private aggregateCandles(m1: Candle[], factor: number): Candle[] {
    const result: Candle[] = [];
    for (let i = 0; i + factor - 1 < m1.length; i += factor) {
      const g = m1.slice(i, i + factor);
      result.push({
        timestamp: g[0].timestamp || (g[0] as any).openTime || '',
        open: g[0].open,
        high: Math.max(...g.map(c => c.high)),
        low: Math.min(...g.map(c => c.low)),
        close: g[g.length - 1].close,
        volume: g.reduce((s, c) => s + (c.volume || 0), 0),
      });
    }
    return result;
  }

  private calcEMA(values: number[], period: number): number[] {
    if (values.length < period) return [];
    const k = 2 / (period + 1);
    const ema: number[] = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    ema.push(sum / period);
    for (let i = period; i < values.length; i++) ema.push(values[i] * k + ema[ema.length - 1] * (1 - k));
    return ema;
  }

  private calcATR(candles: Candle[], period: number, endIdx: number): number {
    if (endIdx < period) return 0;
    let sum = 0;
    for (let i = endIdx - period + 1; i <= endIdx; i++) {
      if (i < 1) continue;
      sum += Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close),
      );
    }
    return sum / period;
  }

  private autocorrelation(returns: number[], lag: number): number {
    if (returns.length < lag + 2) return 0;
    const n = returns.length;
    const mean = returns.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      den += (returns[i] - mean) ** 2;
      if (i >= lag) num += (returns[i] - mean) * (returns[i - lag] - mean);
    }
    return den === 0 ? 0 : num / den;
  }
}
