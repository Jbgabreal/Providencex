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
    console.log(`[SB-DEBUG] analyzeSilverBullet: M15=${m15Candles.length}, M1=${m1Candles.length}, symbol=${symbol}, window=${window.name}`);

    if (m15Candles.length < 20 || m1Candles.length < 20) {
      logger.info(`[SB] FAIL: Not enough candles: M15=${m15Candles.length}, M1=${m1Candles.length}`);
      return null;
    }

    const reasons: string[] = [];

    // Step 1: Identify liquidity levels from M15 swings
    const { bsl, ssl } = this.identifyLiquidityLevels(m15Candles);
    if (bsl.length === 0 && ssl.length === 0) {
      console.log('[SB-DEBUG] FAIL: No liquidity levels');
      return null;
    }
    console.log(`[SB-DEBUG] Levels: BSL=[${bsl.slice(0,3).map((l: number) => l.toFixed(2)).join(', ')}] SSL=[${ssl.slice(0,3).map((l: number) => l.toFixed(2)).join(', ')}]`);

    // Step 2: Check for liquidity sweep on M1 (recent candles within the window)
    const sweep = this.detectLiquiditySweep(m1Candles, bsl, ssl, symbol);
    if (!sweep) {
      console.log('[SB-DEBUG] FAIL: No liquidity sweep detected');
      return null;
    }
    reasons.push(`${sweep.type} swept at ${sweep.level.toFixed(2)}`);

    // Step 3: Confirm displacement in opposite direction
    const displacementDir = sweep.type === 'BSL' ? 'sell' : 'buy';
    const displacement = this.displacementService.checkDisplacement(symbol, m1Candles, displacementDir);
    if (!displacement.isValid) {
      console.log(`[SB-DEBUG] FAIL: No displacement after sweep (dir=${displacementDir})`);
      return null;
    }
    reasons.push(`Displacement confirmed: ${displacement.metrics.trMultiple.toFixed(1)}x ATR`);

    // Step 4: Find FVG from displacement move
    const fvgDirection = sweep.type === 'BSL' ? 'sell' : 'buy';
    const recentM1 = m1Candles.slice(-30); // Look at recent candles for FVG
    const fvgs = this.fvgService.detectFVGs(recentM1, 'LTF', 'neutral');
    const validFvg = this.findDisplacementFVG(fvgs, fvgDirection, sweep);
    if (!validFvg) {
      console.log('[SB-DEBUG] FAIL: No FVG from displacement');
      return null;
    }
    reasons.push(`FVG: ${validFvg.low.toFixed(2)} - ${validFvg.high.toFixed(2)}`);

    // Step 5: Calculate entry, SL, TP
    const direction = fvgDirection;
    const lastPrice = m1Candles[m1Candles.length - 1].close;

    let entryPrice: number;
    let stopLoss: number;
    let takeProfit: number;

    if (direction === 'buy') {
      // Bullish: enter at top of FVG (retrace into it), SL below sweep low
      entryPrice = validFvg.high;
      const sweepExtreme = sweep.extreme;
      const slBuffer = this.getSlBuffer(symbol);
      stopLoss = Math.min(sweepExtreme, validFvg.low) - slBuffer;
      // TP: target BSL (nearest high above)
      takeProfit = this.findOppositeTarget(m15Candles, 'buy', entryPrice);
    } else {
      // Bearish: enter at bottom of FVG (retrace into it), SL above sweep high
      entryPrice = validFvg.low;
      const sweepExtreme = sweep.extreme;
      const slBuffer = this.getSlBuffer(symbol);
      stopLoss = Math.max(sweepExtreme, validFvg.high) + slBuffer;
      // TP: target SSL (nearest low below)
      takeProfit = this.findOppositeTarget(m15Candles, 'sell', entryPrice);
    }

    // Step 6: Validate R:R
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

    // Check if price is near the FVG for entry
    const priceNearFVG = direction === 'buy'
      ? lastPrice <= validFvg.high && lastPrice >= validFvg.low - (validFvg.high - validFvg.low)
      : lastPrice >= validFvg.low && lastPrice <= validFvg.high + (validFvg.high - validFvg.low);

    if (!priceNearFVG) {
      logger.debug(`[SB] Price ${lastPrice.toFixed(2)} not near FVG ${validFvg.low.toFixed(2)}-${validFvg.high.toFixed(2)}`);
      return null;
    }

    const setup: SilverBulletSetup = {
      isValid: true,
      direction,
      sweptLevel: sweep.level,
      sweepType: sweep.type,
      displacementHigh: displacement.metrics.candleTrueRange,
      displacementLow: displacement.metrics.atr,
      fvgHigh: validFvg.high,
      fvgLow: validFvg.low,
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
        displacementATRMultiple: displacement.metrics.trMultiple,
        displacementBodyPct: displacement.metrics.bodyPct,
        fvgBounds: { high: validFvg.high, low: validFvg.low },
        fvgType: validFvg.type,
        fvgGrade: validFvg.grade,
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

    // Use only RECENT M15 candles (last 24 = ~6 hours) for relevant liquidity levels
    const recent = candles.slice(-24);

    // Simple swing detection: a high is a swing high if it's higher than +-2 candles
    for (let i = 2; i < recent.length - 2; i++) {
      const c = recent[i];
      if (c.high > recent[i - 1].high && c.high > recent[i - 2].high &&
          c.high > recent[i + 1].high && c.high > recent[i + 2].high) {
        bsl.push(c.high);
      }
      if (c.low < recent[i - 1].low && c.low < recent[i - 2].low &&
          c.low < recent[i + 1].low && c.low < recent[i + 2].low) {
        ssl.push(c.low);
      }
    }

    // Also add the session high/low as key liquidity
    if (recent.length > 0) {
      const sessionHigh = Math.max(...recent.map(c => c.high));
      const sessionLow = Math.min(...recent.map(c => c.low));
      if (!bsl.includes(sessionHigh)) bsl.push(sessionHigh);
      if (!ssl.includes(sessionLow)) ssl.push(sessionLow);
    }

    return { bsl: bsl.slice(-10), ssl: ssl.slice(-10) };
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
   * Find the FVG created by the displacement move
   */
  private findDisplacementFVG(
    fvgs: any[],
    direction: 'buy' | 'sell',
    sweep: { type: 'BSL' | 'SSL'; level: number },
  ): any | null {
    // For a buy (after SSL sweep), look for bullish FVG below sweep level
    // For a sell (after BSL sweep), look for bearish FVG above sweep level
    const candidates = fvgs.filter(fvg => {
      if (direction === 'buy') {
        return fvg.type === 'continuation' && fvg.low < sweep.level;
      } else {
        return fvg.type === 'continuation' && fvg.high > sweep.level;
      }
    });

    // Return the most recent (last) FVG
    return candidates.length > 0 ? candidates[candidates.length - 1] : null;
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
    if (s === 'XAUUSD' || s === 'GOLD') return 2.0; // $2 tolerance for gold sweep detection
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
