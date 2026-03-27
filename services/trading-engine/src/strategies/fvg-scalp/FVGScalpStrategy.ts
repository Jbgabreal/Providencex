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
  { label: 'London', startHourUTC: 7, startMinUTC: 0, endHourUTC: 12, endMinUTC: 0 },
  { label: 'NY AM', startHourUTC: 13, startMinUTC: 0, endHourUTC: 16, endMinUTC: 0 },
  { label: 'NY PM', startHourUTC: 18, startMinUTC: 0, endHourUTC: 20, endMinUTC: 0 },
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
  // Persistent FVG tracking: store all detected FVGs until filled or traded
  private activeFVGs: Map<string, FVG> = new Map(); // key → FVG (persists across ticks)
  private usedFVGs: Set<string> = new Set(); // FVGs we've already traded

  constructor(profile: StrategyProfile) {
    this.profile = profile;
    this.marketDataService = new MarketDataService();

    const cfg = profile.config || {};
    this.riskRewardTarget = cfg.riskRewardTarget || 2.5;
    this.minFVGSizeMultiplier = cfg.minFVGSizeMultiplier || 0.5; // Min FVG size as multiplier of avg candle body
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

    // Simple momentum bias: compare last close vs close from 3-6 candles ago
    const recent = candles.slice(-6);
    const lastClose = recent[recent.length - 1].close;
    const refClose = recent[0].close;
    const diff = lastClose - refClose;
    const avgRange = recent.reduce((sum, c) => sum + (c.high - c.low), 0) / recent.length;

    // If net move > 0.5x average candle range, we have a directional bias
    if (diff > avgRange * 0.3) return 'bullish';
    if (diff < -avgRange * 0.3) return 'bearish';

    // Fallback: count candle directions
    let bullish = 0, bearish = 0;
    for (const c of recent) {
      if (c.close > c.open) bullish++;
      else bearish++;
    }
    if (bullish >= 4) return 'bullish';
    if (bearish >= 4) return 'bearish';

    // Last resort: use last 3 candles direction
    const last3 = recent.slice(-3);
    const l3Bull = last3.filter(c => c.close > c.open).length;
    if (l3Bull >= 2) return 'bullish';
    if (l3Bull <= 1) return 'bearish';

    return 'neutral';
  }

  private detectM5FVGs(candles: Candle[], bias: 'bullish' | 'bearish'): FVG[] {
    if (candles.length < 3) return Array.from(this.activeFVGs.values()).filter(f => f.direction === bias && !f.filled);

    // Calculate average body size for threshold
    let sumBody = 0;
    for (const c of candles) sumBody += Math.abs(c.close - c.open);
    const avgBody = sumBody / candles.length;
    const minGapSize = avgBody * this.minFVGSizeMultiplier;

    // Scan ALL candles for NEW FVGs (add to persistent store)
    for (let i = 1; i < candles.length - 1; i++) {
      const c1 = candles[i - 1];
      const c2 = candles[i];
      const c3 = candles[i + 1];
      const ts = new Date((c2 as any).timestamp || (c2 as any).endTime || Date.now());
      const isGold = true; // FVG key uses 1 decimal for gold

      // Bullish FVG: candle1.high < candle3.low AND candle2 closes above candle1.high
      if (c1.high < c3.low && c2.close > c1.high) {
        const gapSize = c3.low - c1.high;
        if (gapSize >= minGapSize) {
          const fvgKey = `bull:${isGold ? c1.high.toFixed(1) : c1.high.toFixed(4)}:${isGold ? c3.low.toFixed(1) : c3.low.toFixed(4)}`;
          if (!this.activeFVGs.has(fvgKey)) {
            this.activeFVGs.set(fvgKey, {
              direction: 'bullish', high: c3.low, low: c1.high,
              mid: (c3.low + c1.high) / 2, size: gapSize,
              index: i, timestamp: ts, filled: false,
            });
          }
        }
      }

      // Bearish FVG: candle1.low > candle3.high AND candle2 closes below candle1.low
      if (c1.low > c3.high && c2.close < c1.low) {
        const gapSize = c1.low - c3.high;
        if (gapSize >= minGapSize) {
          const fvgKey = `bear:${isGold ? c3.high.toFixed(1) : c3.high.toFixed(4)}:${isGold ? c1.low.toFixed(1) : c1.low.toFixed(4)}`;
          if (!this.activeFVGs.has(fvgKey)) {
            this.activeFVGs.set(fvgKey, {
              direction: 'bearish', high: c1.low, low: c3.high,
              mid: (c1.low + c3.high) / 2, size: gapSize,
              index: i, timestamp: ts, filled: false,
            });
          }
        }
      }
    }

    // Update fill status: check current price against all active FVGs
    const lastCandle = candles[candles.length - 1];
    for (const [key, fvg] of this.activeFVGs) {
      if (fvg.filled) continue;
      // Strict mitigation: filled when price closes beyond the far boundary
      if (fvg.direction === 'bullish' && lastCandle.close < fvg.low) fvg.filled = true;
      if (fvg.direction === 'bearish' && lastCandle.close > fvg.high) fvg.filled = true;
    }

    // Cleanup: remove filled FVGs and very old ones (>500 candles old)
    for (const [key, fvg] of this.activeFVGs) {
      if (fvg.filled || this.usedFVGs.has(key)) this.activeFVGs.delete(key);
    }
    // Cap at 50 active FVGs max
    if (this.activeFVGs.size > 50) {
      const entries = Array.from(this.activeFVGs.entries());
      for (let i = 0; i < entries.length - 50; i++) this.activeFVGs.delete(entries[i][0]);
    }

    // Return unfilled FVGs matching the current bias, max 4 hours old
    const maxAgeMs = 4 * 60 * 60 * 1000; // 4 hours
    const now = new Date((candles[candles.length - 1] as any).timestamp || Date.now()).getTime();
    return Array.from(this.activeFVGs.values()).filter(f =>
      f.direction === bias && !f.filled && (now - f.timestamp.getTime()) < maxAgeMs
    );
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

    // KEY INSIGHT: 60%+ of FVGs remain unfilled. Use them as SUPPORT/RESISTANCE (bounce off),
    // NOT as fill targets. Enter when price touches the FVG zone and bounces away.
    for (const fvg of fvgs.reverse()) { // Most recent first
      // Dedup: skip FVGs we've already traded
      const fvgDir = fvg.direction === 'bullish' ? 'bull' : 'bear';
      const fvgKey = `${fvgDir}:${isGold ? fvg.low.toFixed(1) : fvg.low.toFixed(4)}:${isGold ? fvg.high.toFixed(1) : fvg.high.toFixed(4)}`;
      if (this.usedFVGs.has(fvgKey)) continue;

      if (m1Candles.length < 5) continue;
      const recent = m1Candles.slice(-5);
      const lastM1 = recent[recent.length - 1];

      let confirmed = false;
      if (bias === 'bullish') {
        // Bullish FVG = SUPPORT. Enter BUY when price touches/nears FVG and shows bullish reaction.
        // Proximity check: price must have been near/in the FVG zone recently
        const proximity = isGold ? fvg.size * 3 : fvg.size * 3; // Within 3x FVG size
        const anyRecentNearFVG = recent.some(c => c.low <= fvg.high + proximity && c.low >= fvg.low - proximity);
        if (!anyRecentNearFVG) continue; // Price not near this FVG at all

        // Confirmation: last M1 must be bullish
        const isBullish = lastM1.close > lastM1.open;
        const bodySize = Math.abs(lastM1.close - lastM1.open);
        const candleRange = lastM1.high - lastM1.low;
        const bodyRatio = candleRange > 0 ? bodySize / candleRange : 0;

        // Accept ANY of these confirmations:
        // A) Strong bullish candle (body > 40% of range) closing above FVG mid
        const strongBullish = isBullish && bodyRatio > 0.4 && lastM1.close >= fvg.mid;
        // B) Engulfing: current candle body > previous candle body AND closes higher
        const prev = recent[recent.length - 2];
        const engulfing = prev && isBullish && bodySize > Math.abs(prev.close - prev.open) * 1.1 && lastM1.close > prev.high;
        // C) Rejection wick: dipped below FVG top but closed above it
        const rejection = isBullish && lastM1.low <= fvg.high && lastM1.close > fvg.high;

        confirmed = strongBullish || engulfing || rejection;
      } else {
        // Bearish FVG = RESISTANCE. Enter SELL when price touches/nears FVG and shows bearish reaction.
        const proximity = isGold ? fvg.size * 3 : fvg.size * 3;
        const anyRecentNearFVG = recent.some(c => c.high >= fvg.low - proximity && c.high <= fvg.high + proximity);
        if (!anyRecentNearFVG) continue;

        const isBearish = lastM1.close < lastM1.open;
        const bodySize = Math.abs(lastM1.close - lastM1.open);
        const candleRange = lastM1.high - lastM1.low;
        const bodyRatio = candleRange > 0 ? bodySize / candleRange : 0;

        const strongBearish = isBearish && bodyRatio > 0.4 && lastM1.close <= fvg.mid;
        const prev = recent[recent.length - 2];
        const engulfing = prev && isBearish && bodySize > Math.abs(prev.close - prev.open) * 1.1 && lastM1.close < prev.low;
        const rejection = isBearish && lastM1.high >= fvg.low && lastM1.close < fvg.low;

        confirmed = strongBearish || engulfing || rejection;
      }

      if (!confirmed) continue;

      // Calculate SL and TP — bounce off FVG as S/R
      const direction: 'buy' | 'sell' = bias === 'bullish' ? 'buy' : 'sell';
      const entryPrice = currentPrice;
      let stopLoss: number;
      let slDistance: number;

      if (direction === 'buy') {
        // Bullish bounce: SL below FVG low (if price breaks through the FVG support, setup is invalid)
        const buffer = isGold ? 1.5 : 0.0003;
        stopLoss = fvg.low - buffer;
        slDistance = entryPrice - stopLoss;
      } else {
        // Bearish bounce: SL above FVG high (if price breaks through the FVG resistance, setup is invalid)
        const buffer = isGold ? 1.5 : 0.0003;
        stopLoss = fvg.high + buffer;
        slDistance = stopLoss - entryPrice;
      }

      // Enforce SL limits
      if (slDistance < minSL) slDistance = minSL;
      if (slDistance > maxSL) continue; // FVG too wide, skip

      stopLoss = direction === 'buy' ? entryPrice - slDistance : entryPrice + slDistance;
      const tpDistance = slDistance * this.riskRewardTarget;
      const takeProfit = direction === 'buy' ? entryPrice + tpDistance : entryPrice - tpDistance;

      // Mark this FVG as used so we don't re-enter
      this.usedFVGs.add(fvgKey);

      // Cleanup old entries (keep last 100)
      if (this.usedFVGs.size > 100) {
        const entries = Array.from(this.usedFVGs);
        for (let i = 0; i < entries.length - 100; i++) this.usedFVGs.delete(entries[i]);
      }

      return { direction, entryPrice, stopLoss, takeProfit, fvg };
    }

    return null;
  }
}
