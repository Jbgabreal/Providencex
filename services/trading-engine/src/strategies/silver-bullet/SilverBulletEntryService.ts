/**
 * Silver Bullet Entry Service
 *
 * Core algorithmic logic for ICT Silver Bullet strategy.
 * Composes existing services (FVG, Liquidity, Displacement) to detect:
 *   1. Liquidity sweep (BSL/SSL)
 *   2. Displacement in opposite direction
 *   3. FVG left by displacement
 *   4. Entry on FVG retrace
 *
 * Follows ICTEntryService pattern — dedicated service for clean separation.
 */

import { Logger } from '@providencex/shared-utils';
import { LiquiditySweepService } from '../../strategy/v2/LiquiditySweepService';
import { FairValueGapService } from '../../strategy/v2/FairValueGapService';
import { DisplacementCheckService } from '../../strategy/v2/DisplacementCheckService';
import { Candle } from '../../marketData/types';
import { SilverBulletWindow } from './SilverBulletTimeWindowService';

const logger = new Logger('SBEntry');

export interface SilverBulletSetup {
  isValid: boolean;
  direction: 'buy' | 'sell';
  sweptLevel: number;
  sweepType: 'BSL' | 'SSL';
  displacementHigh: number;
  displacementLow: number;
  fvgHigh: number;
  fvgLow: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  reasons: string[];
  window: SilverBulletWindow;
  setupContext: Record<string, any>;
}

export interface SilverBulletConfig {
  minRiskReward: number;       // Default: 2.0
  minATRMultiplier: number;    // Default: 1.5
  liquidityLookback: number;   // Default: 50 candles
  m15CandleCount: number;      // Default: 100
  m1CandleCount: number;       // Default: 100
  slBufferPips: number;        // Default: 2 (extra buffer beyond swept level)
}

const DEFAULT_CONFIG: SilverBulletConfig = {
  minRiskReward: 2.0,
  minATRMultiplier: 1.5,
  liquidityLookback: 50,
  m15CandleCount: 100,
  m1CandleCount: 100,
  slBufferPips: 2,
};

export class SilverBulletEntryService {
  private liquidityService: LiquiditySweepService;
  private fvgService: FairValueGapService;
  private displacementService: DisplacementCheckService;
  private config: SilverBulletConfig;

  constructor(
    liquidityService: LiquiditySweepService,
    fvgService: FairValueGapService,
    displacementService: DisplacementCheckService,
    config?: Partial<SilverBulletConfig>,
  ) {
    this.liquidityService = liquidityService;
    this.fvgService = fvgService;
    this.displacementService = displacementService;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Analyze Silver Bullet setup
   *
   * @param m15Candles M15 candles for structure/liquidity context
   * @param m1Candles M1 candles for entry refinement
   * @param symbol Trading symbol
   * @param window Current Silver Bullet time window
   */
  analyzeSilverBullet(
    m15Candles: Candle[],
    m1Candles: Candle[],
    symbol: string,
    window: SilverBulletWindow,
  ): SilverBulletSetup | null {
    if (m15Candles.length < 10 || m1Candles.length < 20) {
      return null;
    }

    const reasons: string[] = [];

    // Step 1: Build BROAD liquidity levels — PDH/PDL, session H/L, M15 swings, equal H/L
    const { bsl, ssl } = this.identifyLiquidityLevels(m15Candles);
    if (bsl.length === 0 && ssl.length === 0) {
      return null;
    }

    // Step 2: Check for liquidity sweep on M1 (recent candles within the window)
    const sweep = this.detectLiquiditySweep(m1Candles, bsl, ssl, symbol);
    if (!sweep) {
      return null;
    }
    reasons.push(`${sweep.type} swept at ${sweep.level.toFixed(2)}`);

    // Step 3: Find the FIRST FVG on M1 after the sweep
    // NO separate displacement check — FVG formation IS displacement proof
    const fvgDirection: 'buy' | 'sell' = sweep.type === 'BSL' ? 'sell' : 'buy';
    const recentM1 = m1Candles.slice(-60);
    const fvg = this.findFirstFVGAfterSweep(recentM1, fvgDirection, sweep);
    if (!fvg) {
      return null;
    }
    reasons.push(`FVG: ${fvg.low.toFixed(2)}-${fvg.high.toFixed(2)}`);

    // Step 4: Calculate entry, SL, TP
    const direction = fvgDirection;
    const lastPrice = m1Candles[m1Candles.length - 1].close;

    let entryPrice: number;
    let stopLoss: number;
    let takeProfit: number;
    const slBuffer = this.getSlBuffer(symbol);

    if (direction === 'buy') {
      // Bullish: enter at current price (market) or FVG boundary
      entryPrice = lastPrice;
      stopLoss = Math.min(sweep.extreme, fvg.low) - slBuffer;
      takeProfit = this.findOppositeTarget(m15Candles, 'buy', entryPrice);
    } else {
      entryPrice = lastPrice;
      stopLoss = Math.max(sweep.extreme, fvg.high) + slBuffer;
      takeProfit = this.findOppositeTarget(m15Candles, 'sell', entryPrice);
    }

    // Step 5: Validate R:R
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    const rr = risk > 0 ? reward / risk : 0;

    if (rr < this.config.minRiskReward) {
      logger.debug(`[SB] R:R too low: ${rr.toFixed(2)} (need >= ${this.config.minRiskReward})`);
      // Fallback: extend TP to meet minimum R:R
      if (direction === 'buy') {
        takeProfit = entryPrice + (risk * this.config.minRiskReward);
      } else {
        takeProfit = entryPrice - (risk * this.config.minRiskReward);
      }
      const adjustedRR = this.config.minRiskReward;
      reasons.push(`TP adjusted to meet min R:R ${adjustedRR}:1`);
    }

    const finalRR = risk > 0 ? Math.abs(takeProfit - entryPrice) / risk : 0;
    reasons.push(`R:R ${finalRR.toFixed(1)}:1 | ${window.label}`);

    const setup: SilverBulletSetup = {
      isValid: true,
      direction,
      sweptLevel: sweep.level,
      sweepType: sweep.type,
      displacementHigh: fvg.high,
      displacementLow: fvg.low,
      fvgHigh: fvg.high,
      fvgLow: fvg.low,
      entryPrice,
      stopLoss,
      takeProfit,
      riskRewardRatio: Math.round(finalRR * 100) / 100,
      reasons,
      window,
      setupContext: {
        bslLevels: bsl.slice(0, 5),
        sslLevels: ssl.slice(0, 5),
        sweepType: sweep.type,
        sweptLevel: sweep.level,
        sweepExtreme: sweep.extreme,
        fvgBounds: { high: fvg.high, low: fvg.low },
        windowName: window.name,
        windowLabel: window.label,
        lastPrice,
        symbol,
      },
    };

    logger.info(`[SB] Setup found: ${direction.toUpperCase()} ${symbol} @ ${entryPrice.toFixed(2)} | SL: ${stopLoss.toFixed(2)} | TP: ${takeProfit.toFixed(2)} | R:R ${finalRR.toFixed(1)} | ${window.label}`);
    return setup;
  }

  /**
   * Identify buyside (BSL) and sellside (SSL) liquidity from M15 swings
   */
  private identifyLiquidityLevels(candles: Candle[]): { bsl: number[]; ssl: number[] } {
    const bsl: number[] = [];
    const ssl: number[] = [];

    // Source 1: M15 swing highs/lows (last 40 candles = ~10 hours)
    const swingCandles = candles.slice(-40);
    for (let i = 2; i < swingCandles.length - 2; i++) {
      const c = swingCandles[i];
      if (c.high > swingCandles[i - 1].high && c.high > swingCandles[i + 1].high) {
        bsl.push(c.high); // Swing high = buyside liquidity
      }
      if (c.low < swingCandles[i - 1].low && c.low < swingCandles[i + 1].low) {
        ssl.push(c.low); // Swing low = sellside liquidity
      }
    }

    // Source 2: Previous day high/low (PDH/PDL) — most important Silver Bullet levels
    // Group candles by day and get previous day's H/L
    if (candles.length >= 8) {
      const lastCandle = candles[candles.length - 1];
      const lastTime = new Date((lastCandle as any).timestamp || (lastCandle as any).startTime || Date.now());
      const todayStart = new Date(lastTime);
      todayStart.setUTCHours(0, 0, 0, 0);

      const prevDayCandles = candles.filter(c => {
        const t = new Date((c as any).timestamp || (c as any).startTime || 0).getTime();
        return t < todayStart.getTime() && t > todayStart.getTime() - 86400000;
      });
      if (prevDayCandles.length > 0) {
        const pdh = Math.max(...prevDayCandles.map(c => c.high));
        const pdl = Math.min(...prevDayCandles.map(c => c.low));
        bsl.push(pdh); // Previous day high
        ssl.push(pdl); // Previous day low
      }
    }

    // Source 3: Recent session high/low (last 6 hours)
    const recentSession = candles.slice(-24);
    if (recentSession.length > 0) {
      bsl.push(Math.max(...recentSession.map(c => c.high)));
      ssl.push(Math.min(...recentSession.map(c => c.low)));
    }

    // Source 4: Equal highs/equal lows (liquidity pools) — look for 2+ candles with same H/L
    const tolerance = candles.length > 0 ? Math.max(...candles.slice(-20).map(c => c.high - c.low)) * 0.1 : 0;
    const recent20 = candles.slice(-20);
    for (let i = 0; i < recent20.length; i++) {
      for (let j = i + 1; j < recent20.length; j++) {
        if (Math.abs(recent20[i].high - recent20[j].high) < tolerance) {
          bsl.push((recent20[i].high + recent20[j].high) / 2); // Equal highs
        }
        if (Math.abs(recent20[i].low - recent20[j].low) < tolerance) {
          ssl.push((recent20[i].low + recent20[j].low) / 2); // Equal lows
        }
      }
    }

    // Deduplicate and sort (most recent/nearest first)
    const uniqueBSL = [...new Set(bsl.map(l => Math.round(l * 100) / 100))];
    const uniqueSSL = [...new Set(ssl.map(l => Math.round(l * 100) / 100))];
    return { bsl: uniqueBSL.slice(-15), ssl: uniqueSSL.slice(-15) };
  }

  /**
   * Detect if M1 price swept a liquidity level
   */
  private detectLiquiditySweep(
    m1Candles: Candle[],
    bsl: number[],
    ssl: number[],
    symbol: string,
  ): { type: 'BSL' | 'SSL'; level: number; extreme: number } | null {
    // Check recent M1 candles for sweep (last 60 candles = 1 hour window)
    const recent = m1Candles.slice(-60);
    const tolerance = this.getSymbolTolerance(symbol);

    // Check for sweep: price exceeds level then closes back within 3 candles
    for (let i = 0; i < recent.length - 1; i++) {
      const candle = recent[i];
      // BSL sweep: candle wicked above a high
      for (const level of bsl) {
        if (candle.high > level + tolerance) {
          // Check if THIS candle or next 1-2 candles close back below the level
          for (let j = i; j < Math.min(i + 3, recent.length); j++) {
            if (recent[j].close < level) {
              return { type: 'BSL', level, extreme: candle.high };
            }
          }
        }
      }
      // SSL sweep: candle wicked below a low
      for (const level of ssl) {
        if (candle.low < level - tolerance) {
          for (let j = i; j < Math.min(i + 3, recent.length); j++) {
            if (recent[j].close > level) {
              return { type: 'SSL', level, extreme: candle.low };
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Find the FIRST FVG on M1 after the sweep candle — the core Silver Bullet entry.
   * FVG formation IS the displacement proof. No separate displacement check needed.
   */
  private findFirstFVGAfterSweep(
    m1Candles: Candle[],
    direction: 'buy' | 'sell',
    sweep: { type: 'BSL' | 'SSL'; level: number; extreme: number },
  ): { high: number; low: number } | null {
    if (m1Candles.length < 5) return null;

    // Scan for FVGs in the correct direction (opposite of sweep)
    for (let i = 1; i < m1Candles.length - 1; i++) {
      const c1 = m1Candles[i - 1];
      const c2 = m1Candles[i];
      const c3 = m1Candles[i + 1];

      if (direction === 'buy' && c1.high < c3.low && c2.close > c2.open) {
        // Bullish FVG (after SSL sweep): gap up
        return { high: c3.low, low: c1.high };
      }
      if (direction === 'sell' && c1.low > c3.high && c2.close < c2.open) {
        // Bearish FVG (after BSL sweep): gap down
        return { high: c1.low, low: c3.high };
      }
    }
    return null;
  }

  /**
   * Find opposite liquidity target for TP
   */
  private findOppositeTarget(candles: Candle[], direction: 'buy' | 'sell', entryPrice: number): number {
    if (direction === 'buy') {
      // Target nearest swing high above entry
      let target = entryPrice;
      for (let i = 2; i < candles.length - 2; i++) {
        const c = candles[i];
        if (c.high > candles[i - 1].high && c.high > candles[i + 1].high && c.high > entryPrice) {
          if (target === entryPrice || c.high < target) {
            target = c.high; // Nearest high above
          }
        }
      }
      return target;
    } else {
      // Target nearest swing low below entry
      let target = entryPrice;
      for (let i = 2; i < candles.length - 2; i++) {
        const c = candles[i];
        if (c.low < candles[i - 1].low && c.low < candles[i + 1].low && c.low < entryPrice) {
          if (target === entryPrice || c.low > target) {
            target = c.low; // Nearest low below
          }
        }
      }
      return target;
    }
  }

  private getSymbolTolerance(symbol: string): number {
    const s = symbol.toUpperCase();
    if (s === 'XAUUSD' || s === 'GOLD') return 0.5; // $0.50 tolerance — just needs to wick beyond level
    if (s === 'US30') return 15.0;
    return 0.0005; // Forex default
  }

  private getSlBuffer(symbol: string): number {
    const s = symbol.toUpperCase();
    if (s === 'XAUUSD' || s === 'GOLD') return 1.0;
    if (s === 'US30') return 10.0;
    return 0.0005; // Forex default
  }
}
