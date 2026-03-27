/**
 * Momentum Scalp Strategy - IStrategy Implementation
 *
 * Trades WITH momentum after displacement moves, not against it.
 * When 3+ consecutive M1 candles push hard creating FVGs, enters on
 * the first pullback into those FVGs in the CONTINUATION direction.
 *
 * Works in volatile/impulsive markets where FVG bounce fails.
 *
 * Logic:
 *   1. H4 bias (trend filter — only trade with the higher timeframe)
 *   2. Detect M1 displacement: 3+ consecutive same-direction candles
 *      with body >= 45% and combined move >= 2x ATR
 *   3. Mark FVGs created during displacement
 *   4. Enter when price pulls back into FVG zone (continuation entry)
 *   5. SL beyond FVG far edge, TP at 2:1 R:R
 *
 * Sessions: London (07-12 UTC), NY (13-17 UTC)
 *
 * Implementation key: MOMENTUM_SCALP_V1
 */

import { Logger } from '@providencex/shared-utils';
import { IStrategy, StrategyContext, StrategyResult } from '../types';
import { StrategyProfile } from '../profiles/types';
import { MarketDataService } from '../../services/MarketDataService';
import { TradeSignal, Candle } from '../../types';

const logger = new Logger('MomentumScalp');

interface DisplacementFVG {
  direction: 'bullish' | 'bearish';
  high: number;
  low: number;
  mid: number;
  size: number;
  displacementStrength: number; // How many consecutive candles created it
  timestamp: Date;
  used: boolean;
}

interface SessionWindow {
  label: string;
  startHourUTC: number;
  endHourUTC: number;
}

const SESSIONS: SessionWindow[] = [
  { label: 'London', startHourUTC: 7, endHourUTC: 12 },
  { label: 'NY', startHourUTC: 13, endHourUTC: 17 },
  { label: 'NY PM', startHourUTC: 18, endHourUTC: 20 },
];

export class MomentumScalpStrategy implements IStrategy {
  readonly key = 'MOMENTUM_SCALP_V1';
  readonly displayName = 'Momentum Scalp';

  private profile: StrategyProfile;
  private marketDataService: MarketDataService;
  private rrTarget: number;
  private minDisplacementCandles: number;
  private minBodyRatio: number;
  private maxSLPoints: number;
  private minSLPoints: number;

  // Track active displacement FVGs and used ones
  private activeFVGs: Map<string, DisplacementFVG> = new Map();
  private usedFVGKeys: Set<string> = new Set();

  constructor(profile: StrategyProfile) {
    this.profile = profile;
    this.marketDataService = new MarketDataService();

    const cfg = profile.config || {};
    this.rrTarget = cfg.riskRewardTarget || 2.0;
    this.minDisplacementCandles = cfg.minDisplacementCandles || 3;
    this.minBodyRatio = cfg.minBodyRatio || 0.45;
    this.maxSLPoints = cfg.maxSLPoints || 8.0;
    this.minSLPoints = cfg.minSLPoints || 2.0;

    logger.info(`[MomentumScalp] Init: R:R=${this.rrTarget}, minDisp=${this.minDisplacementCandles}, bodyRatio=${this.minBodyRatio}`);
  }

  async execute(context: StrategyContext): Promise<StrategyResult> {
    const { symbol } = context;
    const marketData = context.marketDataService || this.marketDataService;

    let m1Candles: Candle[], m5Candles: Candle[], h4Candles: Candle[];
    try {
      m1Candles = await marketData.getRecentCandles(symbol, 'M1', 100);
      m5Candles = await marketData.getRecentCandles(symbol, 'M5', 60);
      h4Candles = await marketData.getRecentCandles(symbol, 'H4', 20);
    } catch {
      return { orders: [], debug: { reason: 'Candle data unavailable' } };
    }

    if (!m1Candles?.length || m1Candles.length < 30) {
      return { orders: [], debug: { reason: `Insufficient M1 candles: ${m1Candles?.length || 0}` } };
    }

    // Step 1: Session check
    const lastCandle = m1Candles[m1Candles.length - 1];
    const candleTime = (lastCandle as any).startTime instanceof Date
      ? (lastCandle as any).startTime
      : new Date((lastCandle as any).timestamp || Date.now());
    const h = candleTime.getUTCHours();
    const session = SESSIONS.find(s => h >= s.startHourUTC && h < s.endHourUTC);
    if (!session) {
      return { orders: [], debug: { reason: 'Outside session' } };
    }

    // Step 2: H4 bias
    const bias = this.getH4Bias(h4Candles || m5Candles);
    if (bias === 'neutral') {
      return { orders: [], debug: { reason: 'H4 bias neutral' } };
    }

    // Step 3: Detect displacement on M1 and create FVGs
    this.detectDisplacements(m1Candles, bias, symbol);

    // Step 4: Check if price is pulling back into any displacement FVG
    const currentPrice = m1Candles[m1Candles.length - 1].close;
    const entry = this.findContinuationEntry(m1Candles, currentPrice, bias, symbol);

    if (!entry) {
      const activeCount = Array.from(this.activeFVGs.values()).filter(f => !f.used).length;
      return { orders: [], debug: { reason: `No pullback to displacement FVGs (${activeCount} tracked)` } };
    }

    const signal: TradeSignal = {
      symbol,
      direction: entry.direction,
      entry: entry.entryPrice,
      stopLoss: entry.stopLoss,
      takeProfit: entry.takeProfit,
      orderKind: 'market',
      reason: `Momentum Scalp: ${session.label}, ${bias} displacement continuation, ${entry.fvg.displacementStrength}-candle push`,
      meta: {
        strategyKey: this.key,
        profileKey: this.profile.key,
        session: session.label,
        bias,
        displacementStrength: entry.fvg.displacementStrength,
        fvgHigh: entry.fvg.high,
        fvgLow: entry.fvg.low,
        riskRewardRatio: this.rrTarget,
      },
    };

    logger.info(
      `[MomentumScalp] ${symbol} ${session.label}: ${entry.direction.toUpperCase()} @ ${entry.entryPrice.toFixed(2)} ` +
      `| SL: ${entry.stopLoss.toFixed(2)} | TP: ${entry.takeProfit.toFixed(2)} ` +
      `| ${entry.fvg.displacementStrength}-candle displacement`
    );

    return {
      orders: [{ signal, metadata: { strategyKey: this.key } }],
      debug: { session: session.label, bias, displacement: entry.fvg.displacementStrength },
    };
  }

  // ==================== Private Methods ====================

  private getH4Bias(candles: Candle[]): 'bullish' | 'bearish' | 'neutral' {
    if (candles.length < 5) return 'neutral';
    const recent = candles.slice(-10);
    const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
    const secondHalf = recent.slice(-Math.floor(recent.length / 2));

    const fH = Math.max(...firstHalf.map(c => c.high));
    const fL = Math.min(...firstHalf.map(c => c.low));
    const sH = Math.max(...secondHalf.map(c => c.high));
    const sL = Math.min(...secondHalf.map(c => c.low));

    if (sH > fH && sL > fL) return 'bullish';
    if (sH < fH && sL < fL) return 'bearish';

    const net = recent[recent.length - 1].close - recent[0].open;
    const avg = recent.reduce((s, c) => s + (c.high - c.low), 0) / recent.length;
    if (net > avg * 0.5) return 'bullish';
    if (net < -avg * 0.5) return 'bearish';
    return 'neutral';
  }

  private detectDisplacements(m1Candles: Candle[], bias: 'bullish' | 'bearish', symbol: string): void {
    if (m1Candles.length < 10) return;

    // Calculate ATR
    let atrSum = 0;
    const atrPeriod = Math.min(20, m1Candles.length);
    for (let i = m1Candles.length - atrPeriod; i < m1Candles.length; i++) {
      atrSum += m1Candles[i].high - m1Candles[i].low;
    }
    const atr = atrSum / atrPeriod;

    // Scan last 30 candles for displacement sequences
    const lookback = Math.min(30, m1Candles.length - 3);
    for (let i = m1Candles.length - lookback; i < m1Candles.length - 2; i++) {
      // Count consecutive same-direction candles
      let count = 0;
      let combinedMove = 0;
      const startIdx = i;

      if (bias === 'bullish') {
        for (let j = i; j < m1Candles.length && j < i + 8; j++) {
          const c = m1Candles[j];
          const body = c.close - c.open;
          const range = c.high - c.low;
          if (body > 0 && (range > 0 ? body / range : 0) >= this.minBodyRatio) {
            count++;
            combinedMove += body;
          } else break;
        }
      } else {
        for (let j = i; j < m1Candles.length && j < i + 8; j++) {
          const c = m1Candles[j];
          const body = c.open - c.close;
          const range = c.high - c.low;
          if (body > 0 && (range > 0 ? body / range : 0) >= this.minBodyRatio) {
            count++;
            combinedMove += body;
          } else break;
        }
      }

      // Need minimum consecutive candles and ATR threshold
      if (count >= this.minDisplacementCandles && combinedMove >= atr * 2) {
        // Find FVGs within the displacement
        for (let j = startIdx + 1; j < startIdx + count - 1 && j + 1 < m1Candles.length; j++) {
          const c1 = m1Candles[j - 1];
          const c2 = m1Candles[j];
          const c3 = m1Candles[j + 1];

          let fvgHigh: number, fvgLow: number;
          const isGold = symbol.toUpperCase() === 'XAUUSD';

          if (bias === 'bullish' && c1.high < c3.low) {
            fvgHigh = c3.low;
            fvgLow = c1.high;
          } else if (bias === 'bearish' && c1.low > c3.high) {
            fvgHigh = c1.low;
            fvgLow = c3.high;
          } else continue;

          const size = fvgHigh - fvgLow;
          if (size <= 0) continue;

          const key = `${bias}:${isGold ? fvgLow.toFixed(1) : fvgLow.toFixed(4)}:${isGold ? fvgHigh.toFixed(1) : fvgHigh.toFixed(4)}`;
          if (!this.activeFVGs.has(key) && !this.usedFVGKeys.has(key)) {
            this.activeFVGs.set(key, {
              direction: bias,
              high: fvgHigh,
              low: fvgLow,
              mid: (fvgHigh + fvgLow) / 2,
              size,
              displacementStrength: count,
              timestamp: new Date((c2 as any).timestamp || Date.now()),
              used: false,
            });
          }
        }
      }
    }

    // Update fill status and cleanup
    const lastClose = m1Candles[m1Candles.length - 1].close;
    for (const [key, fvg] of this.activeFVGs) {
      // FVG invalidated if price closes beyond the far edge (against displacement direction)
      if (fvg.direction === 'bullish' && lastClose < fvg.low) fvg.used = true;
      if (fvg.direction === 'bearish' && lastClose > fvg.high) fvg.used = true;
    }

    // Remove used FVGs, keep max 30
    for (const [key, fvg] of this.activeFVGs) {
      if (fvg.used) { this.activeFVGs.delete(key); this.usedFVGKeys.add(key); }
    }
    if (this.activeFVGs.size > 30) {
      const entries = Array.from(this.activeFVGs.entries());
      for (let i = 0; i < entries.length - 30; i++) this.activeFVGs.delete(entries[i][0]);
    }
    if (this.usedFVGKeys.size > 200) {
      const arr = Array.from(this.usedFVGKeys);
      for (let i = 0; i < arr.length - 200; i++) this.usedFVGKeys.delete(arr[i]);
    }
  }

  private findContinuationEntry(
    m1Candles: Candle[],
    currentPrice: number,
    bias: 'bullish' | 'bearish',
    symbol: string
  ): { direction: 'buy' | 'sell'; entryPrice: number; stopLoss: number; takeProfit: number; fvg: DisplacementFVG } | null {

    const isGold = symbol.toUpperCase() === 'XAUUSD';
    const minSL = isGold ? this.minSLPoints : 0.0005;
    const maxSL = isGold ? this.maxSLPoints : 0.0030;

    // Find FVGs where price has pulled back into the zone
    const fvgs = Array.from(this.activeFVGs.values())
      .filter(f => f.direction === bias && !f.used)
      .sort((a, b) => b.displacementStrength - a.displacementStrength); // Strongest first

    for (const fvg of fvgs) {
      // Price must be IN or NEAR the FVG zone (pullback)
      const inZone = currentPrice >= fvg.low && currentPrice <= fvg.high;
      const nearZone = bias === 'bullish'
        ? (currentPrice >= fvg.low - fvg.size && currentPrice <= fvg.high)
        : (currentPrice >= fvg.low && currentPrice <= fvg.high + fvg.size);

      if (!inZone && !nearZone) continue;

      // M1 confirmation: current candle must be in displacement direction
      const lastM1 = m1Candles[m1Candles.length - 1];
      const prev = m1Candles.length > 1 ? m1Candles[m1Candles.length - 2] : null;

      let confirmed = false;
      if (bias === 'bullish') {
        // Pullback happened (price dipped), now M1 is bullish again (continuation)
        const isBullish = lastM1.close > lastM1.open;
        const bodyRatio = (lastM1.high - lastM1.low) > 0
          ? Math.abs(lastM1.close - lastM1.open) / (lastM1.high - lastM1.low) : 0;
        // Must have a pullback first: previous candle was bearish or lower
        const hadPullback = prev != null && (prev.close < prev.open || prev.close < lastM1.open);
        confirmed = isBullish && bodyRatio > 0.4 && hadPullback;
      } else {
        const isBearish = lastM1.close < lastM1.open;
        const bodyRatio = (lastM1.high - lastM1.low) > 0
          ? Math.abs(lastM1.close - lastM1.open) / (lastM1.high - lastM1.low) : 0;
        const hadPullback = prev != null && (prev.close > prev.open || prev.close > lastM1.open);
        confirmed = isBearish && bodyRatio > 0.4 && hadPullback;
      }

      if (!confirmed) continue;

      // Calculate SL and TP
      const direction: 'buy' | 'sell' = bias === 'bullish' ? 'buy' : 'sell';
      const entryPrice = currentPrice;
      let slDistance: number;

      if (direction === 'buy') {
        // SL below FVG low (if price breaks back through the displacement origin, setup is invalid)
        const buffer = isGold ? 1.5 : 0.0003;
        slDistance = entryPrice - (fvg.low - buffer);
      } else {
        const buffer = isGold ? 1.5 : 0.0003;
        slDistance = (fvg.high + buffer) - entryPrice;
      }

      if (slDistance < minSL) slDistance = minSL;
      if (slDistance > maxSL) continue;

      const stopLoss = direction === 'buy' ? entryPrice - slDistance : entryPrice + slDistance;
      const tpDistance = slDistance * this.rrTarget;
      const takeProfit = direction === 'buy' ? entryPrice + tpDistance : entryPrice - tpDistance;

      // Mark as used
      const fvgKey = Array.from(this.activeFVGs.entries()).find(([_, v]) => v === fvg)?.[0];
      if (fvgKey) {
        fvg.used = true;
        this.usedFVGKeys.add(fvgKey);
      }

      return { direction, entryPrice, stopLoss, takeProfit, fvg };
    }

    return null;
  }
}
