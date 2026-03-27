/**
 * FVG Scalp Strategy - IStrategy Implementation
 *
 * High-frequency scalping strategy based on Fair Value Gap (FVG) fills.
 * Targets 4:1 R:R ($20 win / $5 risk) with 5-15 trades per day.
 *
 * Logic:
 *   1. Detect H1 bias (BOS direction from recent swings)
 *   2. Find M5 FVGs created by displacement moves in bias direction
 *   3. Enter when M1 price retraces to fill the FVG (consequent encroachment = 50%)
 *   4. SL = beyond FVG edge + buffer
 *   5. TP = 4x risk (targeting $20 per trade with $5 risk)
 *
 * Session windows (all EST):
 *   - London:  03:00-06:00 (07:00-10:00 UTC)
 *   - NY AM:   09:30-11:30 (13:30-15:30 UTC)
 *   - NY PM:   14:00-15:30 (18:00-19:30 UTC)
 *
 * Implementation key: FVG_SCALP_V1
 */

import { Logger } from '@providencex/shared-utils';
import { IStrategy, StrategyContext, StrategyResult } from '../types';
import { StrategyProfile } from '../profiles/types';
import { MarketDataService } from '../../services/MarketDataService';
import { TradeSignal, Candle } from '../../types';

const logger = new Logger('FVGScalp');

interface FVG {
  direction: 'bullish' | 'bearish';
  high: number;       // Top of gap
  low: number;        // Bottom of gap
  mid: number;        // 50% CE level (entry target)
  size: number;       // Gap size in price
  index: number;      // Candle index where FVG formed
  timestamp: Date;
  filled: boolean;    // Has price already returned to fill it?
}

interface SessionWindow {
  label: string;
  startHourUTC: number;
  startMinUTC: number;
  endHourUTC: number;
  endMinUTC: number;
}

const SESSIONS: SessionWindow[] = [
  { label: 'London', startHourUTC: 7, startMinUTC: 0, endHourUTC: 10, endMinUTC: 0 },
  { label: 'NY AM', startHourUTC: 13, startMinUTC: 30, endHourUTC: 15, endMinUTC: 30 },
  { label: 'NY PM', startHourUTC: 18, startMinUTC: 0, endHourUTC: 19, endMinUTC: 30 },
];

export class FVGScalpStrategy implements IStrategy {
  readonly key = 'FVG_SCALP_V1';
  readonly displayName = 'FVG Scalp';

  private profile: StrategyProfile;
  private marketDataService: MarketDataService;
  private riskRewardTarget: number;
  private minFVGSizeMultiplier: number;
  private maxSLPoints: number;
  private minSLPoints: number;

  constructor(profile: StrategyProfile) {
    this.profile = profile;
    this.marketDataService = new MarketDataService();

    const cfg = profile.config || {};
    this.riskRewardTarget = cfg.riskRewardTarget || 4.0;
    this.minFVGSizeMultiplier = cfg.minFVGSizeMultiplier || 1.0; // Min FVG size as multiplier of avg candle body
    this.maxSLPoints = cfg.maxSLPoints || 8.0;   // Max SL distance for XAUUSD (points)
    this.minSLPoints = cfg.minSLPoints || 2.0;   // Min SL distance for XAUUSD (points)

    logger.info(`[FVGScalp] Initialized: R:R=${this.riskRewardTarget}, minFVG=${this.minFVGSizeMultiplier}x, SL=${this.minSLPoints}-${this.maxSLPoints}pts`);
  }

  async execute(context: StrategyContext): Promise<StrategyResult> {
    const { symbol } = context;
    const marketData = context.marketDataService || this.marketDataService;

    // Get candle data
    let m5Candles: Candle[], m1Candles: Candle[], h1Candles: Candle[];
    try {
      h1Candles = await marketData.getRecentCandles(symbol, 'H1', 24);
      m5Candles = await marketData.getRecentCandles(symbol, 'M5', 60);
      m1Candles = await marketData.getRecentCandles(symbol, 'M1', 100);
    } catch (err) {
      return { orders: [], debug: { reason: 'Candle data unavailable' } };
    }

    if (!m5Candles?.length || m5Candles.length < 20 || !m1Candles?.length || m1Candles.length < 20) {
      return { orders: [], debug: { reason: `Insufficient candles: M5=${m5Candles?.length || 0}, M1=${m1Candles?.length || 0}` } };
    }

    // Step 1: Check session window
    const lastCandle = m1Candles[m1Candles.length - 1];
    const candleTime = (lastCandle as any).startTime instanceof Date
      ? (lastCandle as any).startTime
      : new Date((lastCandle as any).timestamp || Date.now());
    const session = this.getActiveSession(candleTime);
    if (!session) {
      return { orders: [], debug: { reason: 'Outside FVG Scalp session windows' } };
    }

    // Step 2: Determine H1 bias (simple: last 3 H1 candles net direction)
    const bias = this.getH1Bias(h1Candles || m5Candles);
    if (bias === 'neutral') {
      return { orders: [], debug: { reason: 'H1 bias is neutral (ranging)' } };
    }

    // Step 3: Detect M5 FVGs in bias direction
    const fvgs = this.detectM5FVGs(m5Candles, bias);
    if (fvgs.length === 0) {
      return { orders: [], debug: { reason: `No valid M5 ${bias} FVGs found` } };
    }

    // Step 4: Check if M1 price is touching/filling any FVG
    const currentPrice = m1Candles[m1Candles.length - 1].close;
    const entry = this.findFVGEntry(fvgs, m1Candles, currentPrice, bias, symbol);
    if (!entry) {
      return { orders: [], debug: { reason: `M1 price not at any FVG zone (${fvgs.length} FVGs tracked)`, bias, fvgCount: fvgs.length } };
    }

    // Step 5: Build signal
    const signal: TradeSignal = {
      symbol,
      direction: entry.direction,
      entry: entry.entryPrice,
      stopLoss: entry.stopLoss,
      takeProfit: entry.takeProfit,
      orderKind: 'market',
      reason: `FVG Scalp: ${session.label} session, ${bias} bias, FVG fill @ CE ${entry.fvg.mid.toFixed(2)} (${entry.fvg.low.toFixed(2)}-${entry.fvg.high.toFixed(2)})`,
      meta: {
        strategyKey: this.key,
        profileKey: this.profile.key,
        session: session.label,
        bias,
        fvgHigh: entry.fvg.high,
        fvgLow: entry.fvg.low,
        fvgMid: entry.fvg.mid,
        riskRewardRatio: this.riskRewardTarget,
        slDistance: Math.abs(entry.entryPrice - entry.stopLoss),
        tpDistance: Math.abs(entry.takeProfit - entry.entryPrice),
      },
    };

    logger.info(
      `[FVGScalp] ${symbol} ${session.label}: ${entry.direction.toUpperCase()} @ ${entry.entryPrice.toFixed(2)} ` +
      `| SL: ${entry.stopLoss.toFixed(2)} | TP: ${entry.takeProfit.toFixed(2)} ` +
      `| FVG: ${entry.fvg.low.toFixed(2)}-${entry.fvg.high.toFixed(2)} | R:R 1:${this.riskRewardTarget}`
    );

    return {
      orders: [{ signal, metadata: { strategyKey: this.key } }],
      debug: { session: session.label, bias, fvg: entry.fvg },
    };
  }

  // ==================== Private Methods ====================

  private getActiveSession(time: Date): SessionWindow | null {
    const h = time.getUTCHours();
    const m = time.getUTCMinutes();
    const timeMinutes = h * 60 + m;

    for (const s of SESSIONS) {
      const start = s.startHourUTC * 60 + s.startMinUTC;
      const end = s.endHourUTC * 60 + s.endMinUTC;
      if (timeMinutes >= start && timeMinutes < end) return s;
    }
    return null;
  }

  private getH1Bias(candles: Candle[]): 'bullish' | 'bearish' | 'neutral' {
    if (candles.length < 3) return 'neutral';

    // Use last 6 candles: count bullish vs bearish, check structure
    const recent = candles.slice(-6);
    let bullish = 0, bearish = 0;
    for (const c of recent) {
      if (c.close > c.open) bullish++;
      else if (c.close < c.open) bearish++;
    }

    // Also check: is the last candle's close above or below the 6-candle midpoint?
    const highestHigh = Math.max(...recent.map(c => c.high));
    const lowestLow = Math.min(...recent.map(c => c.low));
    const mid = (highestHigh + lowestLow) / 2;
    const lastClose = recent[recent.length - 1].close;

    if (bullish >= 4 && lastClose > mid) return 'bullish';
    if (bearish >= 4 && lastClose < mid) return 'bearish';
    if (lastClose > mid && bullish > bearish) return 'bullish';
    if (lastClose < mid && bearish > bullish) return 'bearish';
    return 'neutral';
  }

  private detectM5FVGs(candles: Candle[], bias: 'bullish' | 'bearish'): FVG[] {
    const fvgs: FVG[] = [];
    if (candles.length < 3) return fvgs;

    // Calculate average body size for threshold
    let sumBody = 0;
    for (const c of candles) sumBody += Math.abs(c.close - c.open);
    const avgBody = sumBody / candles.length;
    const minGapSize = avgBody * this.minFVGSizeMultiplier;

    // Scan last 40 candles for FVGs
    const lookback = Math.min(40, candles.length);
    const startIdx = candles.length - lookback;

    for (let i = startIdx + 1; i < candles.length - 1; i++) {
      const c1 = candles[i - 1];
      const c2 = candles[i];     // Displacement candle
      const c3 = candles[i + 1];

      // Bullish FVG: candle1.high < candle3.low (gap up)
      if (bias === 'bullish' && c1.high < c3.low && c2.close > c2.open) {
        const gapSize = c3.low - c1.high;
        if (gapSize >= minGapSize) {
          const fvg: FVG = {
            direction: 'bullish',
            high: c3.low,
            low: c1.high,
            mid: (c3.low + c1.high) / 2,
            size: gapSize,
            index: i,
            timestamp: new Date((c2 as any).timestamp || (c2 as any).endTime || Date.now()),
            filled: false,
          };
          // Check if already filled by subsequent candles
          for (let j = i + 2; j < candles.length; j++) {
            if (candles[j].low <= fvg.mid) { fvg.filled = true; break; }
          }
          if (!fvg.filled) fvgs.push(fvg);
        }
      }

      // Bearish FVG: candle1.low > candle3.high (gap down)
      if (bias === 'bearish' && c1.low > c3.high && c2.close < c2.open) {
        const gapSize = c1.low - c3.high;
        if (gapSize >= minGapSize) {
          const fvg: FVG = {
            direction: 'bearish',
            high: c1.low,
            low: c3.high,
            mid: (c1.low + c3.high) / 2,
            size: gapSize,
            index: i,
            timestamp: new Date((c2 as any).timestamp || (c2 as any).endTime || Date.now()),
            filled: false,
          };
          for (let j = i + 2; j < candles.length; j++) {
            if (candles[j].high >= fvg.mid) { fvg.filled = true; break; }
          }
          if (!fvg.filled) fvgs.push(fvg);
        }
      }
    }

    // Return most recent unfilled FVGs (max 5)
    return fvgs.slice(-5);
  }

  private findFVGEntry(
    fvgs: FVG[],
    m1Candles: Candle[],
    currentPrice: number,
    bias: 'bullish' | 'bearish',
    symbol: string
  ): { direction: 'buy' | 'sell'; entryPrice: number; stopLoss: number; takeProfit: number; fvg: FVG } | null {

    const isGold = symbol.toUpperCase() === 'XAUUSD' || symbol.toUpperCase() === 'GOLD';
    const minSL = isGold ? this.minSLPoints : 0.0005;
    const maxSL = isGold ? this.maxSLPoints : 0.0030;

    // Check each FVG — is price currently in the zone?
    for (const fvg of fvgs.reverse()) { // Check most recent first
      const inZone = currentPrice >= fvg.low && currentPrice <= fvg.high;
      if (!inZone) continue;

      // M1 confirmation: need a rejection candle (wick into FVG, close moving away)
      const lastM1 = m1Candles[m1Candles.length - 1];
      const prevM1 = m1Candles.length > 1 ? m1Candles[m1Candles.length - 2] : null;

      let confirmed = false;
      if (bias === 'bullish') {
        // Bullish: price dipped into FVG and M1 closes bullish with wick below
        const isBullishCandle = lastM1.close > lastM1.open;
        const hasLowerWick = (Math.min(lastM1.open, lastM1.close) - lastM1.low) > Math.abs(lastM1.close - lastM1.open) * 0.3;
        confirmed = isBullishCandle && (hasLowerWick || (prevM1 != null && lastM1.close > prevM1.high));
      } else {
        // Bearish: price spiked into FVG and M1 closes bearish with wick above
        const isBearishCandle = lastM1.close < lastM1.open;
        const hasUpperWick = (lastM1.high - Math.max(lastM1.open, lastM1.close)) > Math.abs(lastM1.close - lastM1.open) * 0.3;
        confirmed = isBearishCandle && (hasUpperWick || (prevM1 != null && lastM1.close < prevM1.low));
      }

      if (!confirmed) continue;

      // Calculate SL and TP
      const direction: 'buy' | 'sell' = bias === 'bullish' ? 'buy' : 'sell';
      const entryPrice = currentPrice;
      let stopLoss: number;
      let slDistance: number;

      if (direction === 'buy') {
        // SL below FVG low + buffer
        const buffer = isGold ? 1.0 : 0.0002;
        stopLoss = fvg.low - buffer;
        slDistance = entryPrice - stopLoss;
      } else {
        const buffer = isGold ? 1.0 : 0.0002;
        stopLoss = fvg.high + buffer;
        slDistance = stopLoss - entryPrice;
      }

      // Enforce SL limits
      if (slDistance < minSL) slDistance = minSL;
      if (slDistance > maxSL) continue; // FVG too wide, skip

      stopLoss = direction === 'buy' ? entryPrice - slDistance : entryPrice + slDistance;
      const tpDistance = slDistance * this.riskRewardTarget;
      const takeProfit = direction === 'buy' ? entryPrice + tpDistance : entryPrice - tpDistance;

      return { direction, entryPrice, stopLoss, takeProfit, fvg };
    }

    return null;
  }
}
