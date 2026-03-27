/**
 * V25 Inducement Fade Strategy - IStrategy Implementation
 *
 * Designed specifically for Deriv Volatility 25 (synthetic index, 24/7).
 * Fades fake breakouts (inducement) that sweep beyond a consolidation range.
 *
 * V25's algorithm frequently produces inducement moves — price breaks beyond
 * a range to trigger stops, then reverses sharply. This strategy waits for
 * the overextension and fades it.
 *
 * Logic:
 *   1. Detect consolidation range (last 20 M5 candles high/low)
 *   2. Wait for breakout beyond range by >= 1.0x ATR (inducement sweep)
 *   3. Confirm rejection: candle closes back inside range (failed breakout)
 *   4. RSI confirms reversal (oversold/overbought extreme)
 *   5. Enter fade direction, SL beyond inducement wick, TP at opposite range edge
 *
 * No session filter (24/7). No institutional flow logic. Pure price action.
 *
 * Implementation key: V25_INDUCEMENT_V1
 */

import { Logger } from '@providencex/shared-utils';
import { IStrategy, StrategyContext, StrategyResult } from '../types';
import { StrategyProfile } from '../profiles/types';
import { MarketDataService } from '../../services/MarketDataService';
import { TradeSignal, Candle } from '../../types';

const logger = new Logger('V25Induce');

export class V25InducementStrategy implements IStrategy {
  readonly key = 'V25_INDUCEMENT_V1';
  readonly displayName = 'V25 Inducement Fade';

  private profile: StrategyProfile;
  private marketDataService: MarketDataService;
  private lastTradeTime: number = 0;
  private usedRanges: Set<string> = new Set(); // Dedup: don't trade same range twice

  // Config
  private rangeLookback: number;
  private atrPeriod: number;
  private minInducementATR: number;
  private maxRangeATR: number;
  private minRangeCandles: number;
  private rsiPeriod: number;
  private rsiOversold: number;
  private rsiOverbought: number;
  private adxTrendMax: number;
  private slBuffer: number;
  private cooldownMinutes: number;

  constructor(profile: StrategyProfile) {
    this.profile = profile;
    this.marketDataService = new MarketDataService();

    const cfg = profile.config || {};
    this.rangeLookback = cfg.rangeLookback || 20;
    this.atrPeriod = cfg.atrPeriod || 14;
    this.minInducementATR = cfg.minInducementATR || 1.0;
    this.maxRangeATR = cfg.maxRangeATR || 5.0;
    this.minRangeCandles = cfg.minRangeCandles || 10;
    this.rsiPeriod = cfg.rsiPeriod || 14;
    this.rsiOversold = cfg.rsiOversold || 30;
    this.rsiOverbought = cfg.rsiOverbought || 70;
    this.adxTrendMax = cfg.adxTrendMax || 35;
    this.slBuffer = cfg.slBuffer || 500;
    this.cooldownMinutes = cfg.cooldownMinutes || 5;

    logger.info(`[V25Induce] Init: range=${this.rangeLookback}, ATR=${this.atrPeriod}, RSI=${this.rsiOversold}/${this.rsiOverbought}`);
  }

  async execute(context: StrategyContext): Promise<StrategyResult> {
    const { symbol } = context;
    const marketData = context.marketDataService || this.marketDataService;

    let m5Candles: Candle[], m1Candles: Candle[];
    try {
      m5Candles = await marketData.getRecentCandles(symbol, 'M5', 60);
      m1Candles = await marketData.getRecentCandles(symbol, 'M1', 30);
    } catch {
      return { orders: [], debug: { reason: 'Candle data unavailable' } };
    }

    if (!m5Candles?.length || m5Candles.length < this.rangeLookback + 5 || !m1Candles?.length) {
      return { orders: [], debug: { reason: `Insufficient candles: M5=${m5Candles?.length || 0}` } };
    }

    // Cooldown check
    const lastCandleTime = new Date((m1Candles[m1Candles.length - 1] as any).timestamp || Date.now()).getTime();
    if (lastCandleTime - this.lastTradeTime < this.cooldownMinutes * 60 * 1000) {
      return { orders: [], debug: { reason: 'Cooldown active' } };
    }

    // Step 1: Calculate ATR on M5
    const atr = this.calcATR(m5Candles, this.atrPeriod);
    if (atr <= 0) return { orders: [], debug: { reason: 'ATR is zero' } };

    // Step 2: Detect consolidation range (EXCLUDE last 2 candles — they're the potential inducement)
    const rangeCandles = m5Candles.slice(-(this.rangeLookback + 2), -2);
    const rangeHigh = Math.max(...rangeCandles.map(c => c.high));
    const rangeLow = Math.min(...rangeCandles.map(c => c.low));
    const rangeWidth = rangeHigh - rangeLow;

    // Range must be reasonable (not too wide = already trending)
    if (rangeWidth > atr * this.maxRangeATR) {
      return { orders: [], debug: { reason: `Range too wide: ${rangeWidth.toFixed(0)} > ${(atr * this.maxRangeATR).toFixed(0)}` } };
    }

    // Step 3: Check for inducement (fake breakout beyond range)
    const lastM5 = m5Candles[m5Candles.length - 1];
    const prevM5 = m5Candles[m5Candles.length - 2];
    const currentPrice = lastM5.close;

    // Calculate RSI
    const rsi = this.calcRSI(m5Candles, this.rsiPeriod);

    // Dedup key for this range
    const rangeKey = `${Math.round(rangeLow)}:${Math.round(rangeHigh)}`;

    if (m5Candles.length > 25) {
      const prevLow = prevM5.low, lastLow2 = lastM5.low, needed2 = rangeLow - atr * this.minInducementATR;
      const prevHigh = prevM5.high, lastHigh2 = lastM5.high, needed3 = rangeHigh + atr * this.minInducementATR;
      console.error(`[V25-DBG] rangeLow=${Math.round(rangeLow)} rangeHigh=${Math.round(rangeHigh)} ATR=${Math.round(atr)} prevLow=${Math.round(prevLow)} lastLow=${Math.round(lastLow2)} needBelow=${Math.round(needed2)} prevHigh=${Math.round(prevHigh)} lastHigh=${Math.round(lastHigh2)} needAbove=${Math.round(needed3)} RSI=${Math.round(rsi)} m5=${m5Candles.length}`);
    }
    let direction: 'buy' | 'sell' | null = null;
    let sweepExtreme = 0;
    let reason = '';

    // Bearish inducement → BUY (price swept below range, now closing back inside)
    if (prevM5.low < rangeLow - atr * this.minInducementATR || lastM5.low < rangeLow - atr * this.minInducementATR) {
      // Price swept below range
      sweepExtreme = Math.min(prevM5.low, lastM5.low);
      // Rejection: current candle closes back inside the range
      if (currentPrice > rangeLow && currentPrice < rangeHigh) {
        // RSI confirms reversal
        if (rsi < this.rsiOversold || rsi < 40) {
          direction = 'buy';
          reason = `Bearish inducement swept to ${sweepExtreme.toFixed(0)}, rejected back into range, RSI=${rsi.toFixed(0)}`;
        }
      }
    }

    // Bullish inducement → SELL (price swept above range, now closing back inside)
    if (!direction && (prevM5.high > rangeHigh + atr * this.minInducementATR || lastM5.high > rangeHigh + atr * this.minInducementATR)) {
      sweepExtreme = Math.max(prevM5.high, lastM5.high);
      if (currentPrice < rangeHigh && currentPrice > rangeLow) {
        if (rsi > this.rsiOverbought || rsi > 60) {
          direction = 'sell';
          reason = `Bullish inducement swept to ${sweepExtreme.toFixed(0)}, rejected back into range, RSI=${rsi.toFixed(0)}`;
        }
      }
    }

    if (!direction) {
      // Debug: show how close we are to inducement
      const distBelow = rangeLow - Math.min(prevM5.low, lastM5.low);
      const distAbove = Math.max(prevM5.high, lastM5.high) - rangeHigh;
      const needed = atr * this.minInducementATR;
      return { orders: [], debug: {
        reason: 'No inducement detected',
        rangeHigh: Math.round(rangeHigh), rangeLow: Math.round(rangeLow),
        lastLow: Math.round(lastM5.low), lastHigh: Math.round(lastM5.high),
        distBelow: Math.round(distBelow), distAbove: Math.round(distAbove),
        needed: Math.round(needed), atr: Math.round(atr), rsi: Math.round(rsi),
        m5Count: m5Candles.length,
      } };
    }

    // Dedup: don't trade same range twice
    if (this.usedRanges.has(rangeKey)) {
      return { orders: [], debug: { reason: 'Range already traded' } };
    }

    // Step 4: Calculate SL and TP
    const entryPrice = currentPrice;
    let stopLoss: number, takeProfit: number;

    if (direction === 'buy') {
      stopLoss = sweepExtreme - this.slBuffer;
      takeProfit = rangeHigh; // Target opposite side of range
    } else {
      stopLoss = sweepExtreme + this.slBuffer;
      takeProfit = rangeLow;
    }

    // Validate R:R
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    if (risk <= 0 || reward / risk < 1.0) {
      return { orders: [], debug: { reason: `R:R too low: ${(reward / risk).toFixed(1)}` } };
    }

    // Mark range as used and record trade time
    this.usedRanges.add(rangeKey);
    this.lastTradeTime = lastCandleTime;

    // Cleanup old range keys
    if (this.usedRanges.size > 50) {
      const arr = Array.from(this.usedRanges);
      for (let i = 0; i < arr.length - 50; i++) this.usedRanges.delete(arr[i]);
    }

    const signal: TradeSignal = {
      symbol,
      direction,
      entry: entryPrice,
      stopLoss,
      takeProfit,
      orderKind: 'market',
      reason: `V25 Inducement: ${reason}`,
      meta: {
        strategyKey: this.key,
        profileKey: this.profile.key,
        rangeHigh,
        rangeLow,
        rangeWidth,
        sweepExtreme,
        rsi,
        atr,
        riskRewardRatio: reward / risk,
      },
    };

    logger.info(
      `[V25Induce] ${symbol}: ${direction.toUpperCase()} @ ${entryPrice.toFixed(0)} ` +
      `| SL: ${stopLoss.toFixed(0)} | TP: ${takeProfit.toFixed(0)} ` +
      `| Range: ${rangeLow.toFixed(0)}-${rangeHigh.toFixed(0)} | R:R ${(reward / risk).toFixed(1)}`
    );

    return {
      orders: [{ signal, metadata: { strategyKey: this.key } }],
      debug: { direction, rsi, rangeWidth, atr },
    };
  }

  private calcATR(candles: Candle[], period: number): number {
    if (candles.length < period + 1) return 0;
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      sum += candles[i].high - candles[i].low;
    }
    return sum / period;
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
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
}
