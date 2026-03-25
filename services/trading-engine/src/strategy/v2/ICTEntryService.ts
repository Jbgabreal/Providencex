/**
 * ICTEntryService - Strict ICT (Inner Circle Trader) Entry Model
 *
 * Correct ICT pipeline:
 * 1. H4 (Bias TF): BOS/CHoCH → determine bullish or bearish bias
 * 2. M15 (Setup TF): BOS in bias direction → price retraces to 60-78% fib (OTE zone)
 * 3. M1 (Entry TF): Liquidity sweep of M1 swing → enter the trade
 *
 * Pipeline: H4 Bias → M15 BOS + OTE Retracement → M1 Liquidity Sweep → Entry
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { SwingPoint, BosConfirmedSwingState, StructuralSwing } from './smc-core/Types';
import { SwingService } from './smc-core/SwingService';
import { BosService } from './smc-core/BosService';
import { StructuralSwingService } from './smc-core/StructuralSwingService';
import { OrderBlockV2 } from './types';

const logger = new Logger('ICTEntryService');

export interface ICTBias {
  direction: 'bullish' | 'bearish' | 'sideways';
  lastChoCh?: {
    index: number;
    fromTrend: 'bullish' | 'bearish';
    toTrend: 'bullish' | 'bearish';
    level: number;
  };
  lastBOS?: {
    index: number;
    direction: 'bullish' | 'bearish';
    level: number;
  };
  swingHigh?: number;
  swingLow?: number;
}

export interface ICTSetupZone {
  isValid: boolean;
  direction: 'bullish' | 'bearish' | 'sideways';
  hasDisplacement: boolean;
  displacementCandleIndex?: number;
  fvg?: { low: number; high: number; index: number };
  orderBlock?: OrderBlockV2;
  zoneLow: number;  // OTE zone low (60% fib)
  zoneHigh: number; // OTE zone high (78% fib)
  reasons: string[];
}

export interface ICTEntry {
  isValid: boolean;
  direction: 'bullish' | 'bearish';
  entryPrice: number;
  entryType: 'limit' | 'market';
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  m1ChoChIndex?: number;
  refinedOB?: OrderBlockV2;
  reasons: string[];
}

export interface ICTEntryResult {
  bias: ICTBias;
  setupZone: ICTSetupZone | null;
  entry: ICTEntry | null;
  setupsDetected: number;
  entriesTaken: number;
}

export class ICTEntryService {
  private h4StructuralService: StructuralSwingService; // 3-impulse rule for H4 external structure
  private m15SwingService: SwingService;   // BOS-confirmed swings for M15 structural range
  private m15BosService: BosService;       // BOS detection on M15
  private m1SwingService: SwingService;    // Fractal swings for M1 liquidity sweep detection
  private riskRewardRatio: number;

  constructor() {
    // H4: Structural swings using 3-consecutive-candle impulse rule for external structure
    // External swing = 3+ consecutive bullish/bearish candles forming a directional leg
    // HH = new swing high breaks previous external swing high
    // LL = new swing low breaks previous external swing low
    this.h4StructuralService = new StructuralSwingService(3);

    // M15: BOS-confirmed swings for structural range + fib calculation
    this.m15SwingService = new SwingService({
      method: 'bos-confirmed',
      pivotLeft: 3,
      pivotRight: 3,
    });

    // M15: BOS detection (strict close = ICT style)
    this.m15BosService = new BosService({
      bosLookbackSwings: 10,
      swingIndexLookback: 100,
      strictClose: true,
    });

    // M1: Fractal swings for liquidity sweep detection (need fast detection, not BOS-confirmed)
    this.m1SwingService = new SwingService({
      method: 'fractal',
      pivotLeft: 3,
      pivotRight: 3,
    });

    // Risk-reward ratio (default 1:3)
    this.riskRewardRatio = parseFloat(process.env.SMC_RISK_REWARD || '3');
  }

  /**
   * Main ICT entry pipeline
   */
  analyzeICTEntry(
    h4Candles: Candle[],
    m15Candles: Candle[],
    m1Candles: Candle[]
  ): ICTEntryResult {
    const ictLog = process.env.ICT_DEBUG === 'true' || process.env.SMC_DEBUG === 'true';

    // Session filter: London KZ (07:00-11:00 UTC) and NY KZ (12:00-16:00 UTC)
    if (m1Candles.length > 0) {
      const lastCandle = m1Candles[m1Candles.length - 1];
      const hour = lastCandle.startTime.getUTCHours();
      const isLondonKZ = hour >= 7 && hour <= 11;
      const isNYKZ = hour >= 12 && hour <= 16;
      if (!isLondonKZ && !isNYKZ) {
        return { bias: { direction: 'sideways' }, setupZone: null, entry: null, setupsDetected: 0, entriesTaken: 0 };
      }
    }

    // ═══════════════════════════════════════════════════════
    // STEP 1: H4 Bias (BOS/CHoCH → bullish or bearish)
    // ═══════════════════════════════════════════════════════
    const bias = this.determineH4Bias(h4Candles);
    if (ictLog) {
      logger.info(`[ICT] H4 Bias: ${bias.direction}`);
    }

    if (bias.direction === 'sideways') {
      return { bias, setupZone: null, entry: null, setupsDetected: 0, entriesTaken: 0 };
    }

    // ═══════════════════════════════════════════════════════
    // STEP 2: M15 Setup — BOS in bias direction + OTE retracement
    // ═══════════════════════════════════════════════════════
    const setupZone = this.detectM15Setup(m15Candles, bias);
    if (ictLog && setupZone.isValid) {
      logger.info(`[ICT] M15 OTE zone: ${setupZone.zoneLow.toFixed(2)}-${setupZone.zoneHigh.toFixed(2)}`);
    }

    if (!setupZone.isValid) {
      return { bias, setupZone, entry: null, setupsDetected: 0, entriesTaken: 0 };
    }

    // ═══════════════════════════════════════════════════════
    // STEP 3: M1 Entry — Liquidity sweep of M1 swing → enter
    // ═══════════════════════════════════════════════════════
    const entry = this.detectM1Entry(m1Candles, m15Candles, bias, setupZone);

    return {
      bias,
      setupZone,
      entry,
      setupsDetected: setupZone.isValid ? 1 : 0,
      entriesTaken: entry?.isValid ? 1 : 0,
    };
  }

  /**
   * Step 1: H4 Bias from External Structure
   *
   * Uses 3-impulse structural swings (external structure only).
   * Internal swings (retracements within the external range) are ignored.
   *
   * Bullish = last 2+ swing highs are HH AND last 2+ swing lows are HL
   * Bearish = last 2+ swing highs are LH AND last 2+ swing lows are LL
   * Otherwise = sideways
   *
   * Only structural swings formed by 3+ consecutive candles count as external.
   */
  private determineH4Bias(h4Candles: Candle[]): ICTBias {
    const ictLog = process.env.ICT_DEBUG === 'true' || process.env.SMC_DEBUG === 'true';

    if (h4Candles.length < 6) {
      return { direction: 'sideways' };
    }

    // Detect external swings: 3+ consecutive bullish/bearish candles form a swing.
    // A bullish swing = 3+ candles where close > open → swing HIGH = max high of the run
    // A bearish swing = 3+ candles where close < open → swing LOW = min low of the run
    // Neutral/doji candles don't break the run.
    const structuralSwings = this.detectExternalSwings(h4Candles);

    const swingHighs = structuralSwings.filter(s => s.type === 'high').sort((a, b) => a.index - b.index);
    const swingLows = structuralSwings.filter(s => s.type === 'low').sort((a, b) => a.index - b.index);

    if (ictLog) {
      logger.info(
        `[ICT] H4 structural swings: ${swingHighs.length} highs, ${swingLows.length} lows ` +
        `(${structuralSwings.length} total from ${h4Candles.length} candles)`
      );
      if (swingHighs.length >= 2) {
        const h1 = swingHighs[swingHighs.length - 2];
        const h2 = swingHighs[swingHighs.length - 1];
        logger.info(`[ICT] H4 last 2 highs: ${h1.price.toFixed(2)} → ${h2.price.toFixed(2)} (${h2.price > h1.price ? 'HH' : 'LH'})`);
      }
      if (swingLows.length >= 2) {
        const l1 = swingLows[swingLows.length - 2];
        const l2 = swingLows[swingLows.length - 1];
        logger.info(`[ICT] H4 last 2 lows: ${l1.price.toFixed(2)} → ${l2.price.toFixed(2)} (${l2.price > l1.price ? 'HL' : 'LL'})`);
      }
    }

    // Need at least 2 highs and 2 lows for pattern detection
    if (swingHighs.length < 2 || swingLows.length < 2) {
      return { direction: 'sideways' };
    }

    // Check last 2 swing highs and last 2 swing lows
    const lastHighs = swingHighs.slice(-2);
    const lastLows = swingLows.slice(-2);

    const isHH = lastHighs[1].price > lastHighs[0].price; // Higher High
    const isHL = lastLows[1].price > lastLows[0].price;    // Higher Low
    const isLH = lastHighs[1].price < lastHighs[0].price;  // Lower High
    const isLL = lastLows[1].price < lastLows[0].price;    // Lower Low

    let direction: 'bullish' | 'bearish' | 'sideways' = 'sideways';

    if (isHH && isHL) {
      direction = 'bullish';
    } else if (isLH && isLL) {
      direction = 'bearish';
    }

    if (ictLog) {
      logger.info(`[ICT] H4 Bias: ${direction} (HH=${isHH}, HL=${isHL}, LH=${isLH}, LL=${isLL})`);
    }

    const lastSwingHigh = swingHighs[swingHighs.length - 1];
    const lastSwingLow = swingLows[swingLows.length - 1];

    return {
      direction,
      swingHigh: lastSwingHigh.price,
      swingLow: lastSwingLow.price,
    };
  }

  /**
   * Step 2: M15 Setup — BOS in bias direction + price in OTE zone (60-78% fib)
   *
   * ICT model:
   * 1. Detect BOS-confirmed swings on M15 (structural range)
   * 2. Detect BOS in the bias direction (structure expanding in trend)
   * 3. Calculate fib retracement from the M15 swing that BOS broke
   * 4. Check if current price has retraced into OTE zone (60-78%)
   *
   * For BULLISH bias:
   *   - Need bullish BOS (price broke above M15 swing high)
   *   - Then price retraces DOWN into 60-78% fib from swing low to swing high
   *   - OTE zone = swingLow + range * 0.22 to swingLow + range * 0.40
   *     (which is 78% to 60% retracement from the high)
   *
   * For BEARISH bias:
   *   - Need bearish BOS (price broke below M15 swing low)
   *   - Then price retraces UP into 60-78% fib from swing low to swing high
   *   - OTE zone = swingLow + range * 0.60 to swingLow + range * 0.78
   *     (which is 60% to 78% retracement from the low)
   */
  private detectM15Setup(m15Candles: Candle[], bias: ICTBias): ICTSetupZone {
    const reasons: string[] = [];
    const ictLog = process.env.ICT_DEBUG === 'true' || process.env.SMC_DEBUG === 'true';

    if (m15Candles.length < 20) {
      return { isValid: false, direction: bias.direction, hasDisplacement: false, zoneLow: 0, zoneHigh: 0, reasons: ['Insufficient M15 candles'] };
    }

    // 1. Get BOS-confirmed swings for structural range
    const confirmedSwings = this.m15SwingService.detectSwings(m15Candles);
    let swingHighs = confirmedSwings.filter(s => s.type === 'high').sort((a, b) => a.index - b.index);
    let swingLows = confirmedSwings.filter(s => s.type === 'low').sort((a, b) => a.index - b.index);

    // Fallback: if BOS-confirmed swings are insufficient, use fractal swings
    if (swingHighs.length === 0 || swingLows.length === 0) {
      const fallbackService = new SwingService({ method: 'fractal', pivotLeft: 3, pivotRight: 3 });
      const fallbackSwings = fallbackService.detectSwings(m15Candles);
      swingHighs = fallbackSwings.filter(s => s.type === 'high').sort((a, b) => a.index - b.index);
      swingLows = fallbackSwings.filter(s => s.type === 'low').sort((a, b) => a.index - b.index);
      if (swingHighs.length === 0 || swingLows.length === 0) {
        reasons.push(`Not enough M15 swings: ${swingHighs.length} highs, ${swingLows.length} lows`);
        return { isValid: false, direction: bias.direction, hasDisplacement: false, zoneLow: 0, zoneHigh: 0, reasons };
      }
    }

    // 2. Detect BOS events on M15
    const allM15Swings = [...swingHighs, ...swingLows].sort((a, b) => a.index - b.index);
    const bosEvents = this.m15BosService.detectBOS(m15Candles, allM15Swings);

    // 3. Find most recent BOS in the bias direction
    const biasAlignedBOS = bosEvents
      .filter(b => b.direction === bias.direction)
      .sort((a, b) => b.index - a.index)[0];

    if (!biasAlignedBOS) {
      reasons.push(`No M15 BOS in ${bias.direction} direction (total BOS: ${bosEvents.length})`);
      if (ictLog) logger.info(`[ICT] No M15 ${bias.direction} BOS — ${bosEvents.length} total BOS events`);
      return { isValid: false, direction: bias.direction, hasDisplacement: false, zoneLow: 0, zoneHigh: 0, reasons };
    }

    if (ictLog) {
      logger.info(`[ICT] M15 ${bias.direction} BOS at idx ${biasAlignedBOS.index}, broke ${biasAlignedBOS.brokenSwingType} @ ${biasAlignedBOS.level.toFixed(2)}`);
    }

    // 4. Build structural range from recent swing high and low
    const lastSwingHigh = swingHighs[swingHighs.length - 1];
    const lastSwingLow = swingLows[swingLows.length - 1];
    const rangeHigh = lastSwingHigh.price;
    const rangeLow = lastSwingLow.price;
    const range = rangeHigh - rangeLow;

    if (range <= 0) {
      reasons.push('Invalid structural range (high <= low)');
      return { isValid: false, direction: bias.direction, hasDisplacement: false, zoneLow: 0, zoneHigh: 0, reasons };
    }

    // 5. Calculate OTE zone (60-78% fib retracement)
    let oteLow: number;
    let oteHigh: number;

    if (bias.direction === 'bullish') {
      // Bullish: price broke above swing high, now retracing DOWN
      // 60% retracement from high = rangeLow + range * 0.40
      // 78% retracement from high = rangeLow + range * 0.22
      // OTE zone is between these two levels (price is LOW in the range = discount)
      oteLow = rangeLow + range * 0.22;   // 78% retracement (deeper)
      oteHigh = rangeLow + range * 0.40;  // 60% retracement (shallower)
    } else {
      // Bearish: price broke below swing low, now retracing UP
      // 60% retracement from low = rangeLow + range * 0.60
      // 78% retracement from low = rangeLow + range * 0.78
      // OTE zone is between these two levels (price is HIGH in the range = premium)
      oteLow = rangeLow + range * 0.60;   // 60% retracement (shallower)
      oteHigh = rangeLow + range * 0.78;  // 78% retracement (deeper)
    }

    // 6. Check if current price is in OTE zone
    const currentPrice = m15Candles[m15Candles.length - 1].close;
    const fibPosition = (currentPrice - rangeLow) / range;

    // Allow a small buffer around OTE zone (5% of range on each side)
    const oteBuffer = range * 0.05;
    const inOTE = currentPrice >= (oteLow - oteBuffer) && currentPrice <= (oteHigh + oteBuffer);

    if (ictLog) {
      logger.info(
        `[ICT] M15 range: ${rangeLow.toFixed(2)}-${rangeHigh.toFixed(2)} ($${range.toFixed(2)}), ` +
        `OTE: ${oteLow.toFixed(2)}-${oteHigh.toFixed(2)}, ` +
        `price: ${currentPrice.toFixed(2)} (fib ${(fibPosition * 100).toFixed(1)}%), inOTE: ${inOTE}`
      );
    }

    if (!inOTE) {
      reasons.push(
        `Price ${currentPrice.toFixed(2)} not in OTE zone [${oteLow.toFixed(2)}, ${oteHigh.toFixed(2)}] ` +
        `(fib ${(fibPosition * 100).toFixed(1)}%, range: ${rangeLow.toFixed(2)}-${rangeHigh.toFixed(2)})`
      );
      return { isValid: false, direction: bias.direction, hasDisplacement: true, zoneLow: oteLow, zoneHigh: oteHigh, reasons };
    }

    reasons.push(`M15 BOS ${bias.direction} confirmed, price in OTE zone (fib ${(fibPosition * 100).toFixed(1)}%)`);

    return {
      isValid: true,
      direction: bias.direction,
      hasDisplacement: true,  // BOS = displacement
      displacementCandleIndex: biasAlignedBOS.index,
      zoneLow: oteLow,
      zoneHigh: oteHigh,
      reasons,
    };
  }

  /**
   * Step 3: M1 Entry — Sweep + Market Structure Shift + Entry at last opposing candle
   *
   * ICT model:
   * 1. Detect M1 liquidity sweep (wick beyond swing, no close)
   * 2. AFTER the sweep, wait for M1 market structure shift (price shifts back in bias direction)
   *    - Bearish: sweep takes M1 high → price shifts bearish (candle closes below prior M1 swing low)
   *    - Bullish: sweep takes M1 low → price shifts bullish (candle closes above prior M1 swing high)
   * 3. Entry = OPEN of the last opposing candle before the shift
   *    - Bearish: open of the last bullish candle before the bearish shift
   *    - Bullish: open of the last bearish candle before the bullish shift
   * 4. SL = high of the swept swing (for SELL) or low of the swept swing (for BUY)
   * 5. TP at R:R ratio
   */
  private detectM1Entry(
    m1Candles: Candle[],
    m15Candles: Candle[],
    bias: ICTBias,
    setupZone: ICTSetupZone
  ): ICTEntry {
    const reasons: string[] = [];
    const ictLog = process.env.ICT_DEBUG === 'true' || process.env.SMC_DEBUG === 'true';

    if (m1Candles.length < 10) {
      return this.invalidEntry(bias.direction as 'bullish' | 'bearish', ['Insufficient M1 candles']);
    }

    // 1. Detect M1 fractal swings
    const m1Swings = this.m1SwingService.detectSwings(m1Candles);

    if (m1Swings.length < 2) {
      return this.invalidEntry(bias.direction as 'bullish' | 'bearish', ['Not enough M1 swings for sweep detection']);
    }

    // 2. Detect liquidity sweeps on M1
    const sweeps = this.m1SwingService.detectLiquiditySweeps(m1Candles, m1Swings);

    // Filter sweeps that align with bias
    const alignedSweeps = sweeps.filter(s => {
      if (bias.direction === 'bearish') return s.sweptSwing.type === 'high';
      if (bias.direction === 'bullish') return s.sweptSwing.type === 'low';
      return false;
    });

    // Look for recent sweep (within last 20 M1 candles — need room for shift to form after sweep)
    const recentSweep = alignedSweeps
      .filter(s => s.index >= m1Candles.length - 20)
      .sort((a, b) => b.index - a.index)[0];

    if (!recentSweep) {
      if (alignedSweeps.length > 0) {
        reasons.push(`M1 sweep at idx ${alignedSweeps[alignedSweeps.length - 1].index} not recent enough`);
      } else {
        reasons.push(`No M1 liquidity sweep of ${bias.direction === 'bearish' ? 'high' : 'low'} (${sweeps.length} total sweeps)`);
      }
      return this.invalidEntry(bias.direction as 'bullish' | 'bearish', reasons);
    }

    if (ictLog) {
      logger.info(
        `[ICT] M1 sweep: ${recentSweep.sweptSwing.type} @ ${recentSweep.sweptSwing.price.toFixed(2)} ` +
        `swept by wick ${recentSweep.sweepPrice.toFixed(2)} at idx ${recentSweep.index}`
      );
    }

    // 3. After sweep, look for market structure shift (MSS)
    //    The M1 was trending AGAINST the bias (bullish M1 during bearish H4 bias).
    //    After the sweep, we need M1 to SHIFT back in the bias direction:
    //    - Bearish bias: candle CLOSES below a recent M1 swing LOW = bearish shift
    //    - Bullish bias: candle CLOSES above a recent M1 swing HIGH = bullish shift
    //
    //    Use ALL swings up to the current candle (not just before sweep),
    //    since new swings form during the retracement.
    let shiftIndex: number | undefined;

    for (let i = recentSweep.index + 1; i < m1Candles.length; i++) {
      const candle = m1Candles[i];
      // Get swings that formed before this candle (including during/after sweep)
      const availableSwings = m1Swings.filter(s => s.index < i);

      if (bias.direction === 'bearish') {
        // Need candle to close BELOW a recent M1 swing low = bearish shift
        const nearestLow = availableSwings
          .filter(s => s.type === 'low')
          .sort((a, b) => b.index - a.index)[0];

        if (nearestLow && candle.close < nearestLow.price) {
          shiftIndex = i;
          reasons.push(`M1 bearish shift at idx ${i}: close ${candle.close.toFixed(2)} < swing low ${nearestLow.price.toFixed(2)}`);
          break;
        }
      } else {
        // Need candle to close ABOVE a recent M1 swing high = bullish shift
        const nearestHigh = availableSwings
          .filter(s => s.type === 'high')
          .sort((a, b) => b.index - a.index)[0];

        if (nearestHigh && candle.close > nearestHigh.price) {
          shiftIndex = i;
          reasons.push(`M1 bullish shift at idx ${i}: close ${candle.close.toFixed(2)} > swing high ${nearestHigh.price.toFixed(2)}`);
          break;
        }
      }
    }

    if (shiftIndex === undefined) {
      reasons.push('No M1 market structure shift after sweep');
      if (ictLog) logger.info(`[ICT] M1: Sweep found but no structure shift after it`);
      return this.invalidEntry(bias.direction as 'bullish' | 'bearish', reasons);
    }

    // 4. Entry = OPEN of the last opposing candle before the shift
    //    Bearish: find the last BULLISH candle before shiftIndex
    //    Bullish: find the last BEARISH candle before shiftIndex
    let entryCandle: Candle | null = null;
    let entryCandleIdx: number | undefined;

    for (let i = shiftIndex - 1; i > recentSweep.index; i--) {
      const c = m1Candles[i];
      if (bias.direction === 'bearish' && c.close > c.open) {
        // Last bullish candle before bearish shift
        entryCandle = c;
        entryCandleIdx = i;
        break;
      }
      if (bias.direction === 'bullish' && c.close < c.open) {
        // Last bearish candle before bullish shift
        entryCandle = c;
        entryCandleIdx = i;
        break;
      }
    }

    if (!entryCandle || entryCandleIdx === undefined) {
      reasons.push('No opposing candle found before M1 shift for entry');
      return this.invalidEntry(bias.direction as 'bullish' | 'bearish', reasons);
    }

    // Entry at the OPEN of the last opposing candle
    const entryPrice = entryCandle.open;

    // 5. SL = the high of the swept swing (SELL) or low of the swept swing (BUY)
    //    This is the actual swing extreme, not the wick of the sweep candle
    let stopLoss: number;

    if (bias.direction === 'bearish') {
      // SELL: SL at the HIGH of the swept M1 swing
      stopLoss = recentSweep.sweptSwing.price;
    } else {
      // BUY: SL at the LOW of the swept M1 swing
      stopLoss = recentSweep.sweptSwing.price;
    }

    // Validate SL direction
    const slValid = stopLoss > 0 &&
      ((bias.direction === 'bullish' && stopLoss < entryPrice) ||
       (bias.direction === 'bearish' && stopLoss > entryPrice));

    if (!slValid) {
      reasons.push(`Invalid SL: ${stopLoss.toFixed(2)} (entry: ${entryPrice.toFixed(2)}, dir: ${bias.direction})`);
      return this.invalidEntry(bias.direction as 'bullish' | 'bearish', reasons);
    }

    // Enforce minimum SL distance for gold
    const symbolType = m1Candles[0]?.symbol || 'XAUUSD';
    const minSlDistance = (symbolType === 'XAUUSD' || symbolType === 'GOLD') ? 3.0 : 0.0003;
    const slDist = Math.abs(entryPrice - stopLoss);
    if (slDist < minSlDistance) {
      stopLoss = bias.direction === 'bullish'
        ? entryPrice - minSlDistance
        : entryPrice + minSlDistance;
    }

    // 6. TP at R:R ratio
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = risk * this.riskRewardRatio;
    const takeProfit = bias.direction === 'bullish'
      ? entryPrice + reward
      : entryPrice - reward;

    if (ictLog) {
      logger.info(
        `[ICT] ✅ ENTRY: ${bias.direction.toUpperCase()} @ ${entryPrice.toFixed(2)} ` +
        `(open of last ${bias.direction === 'bearish' ? 'bullish' : 'bearish'} candle at idx ${entryCandleIdx}), ` +
        `SL: ${stopLoss.toFixed(2)} (swept swing), TP: ${takeProfit.toFixed(2)}, R:R 1:${this.riskRewardRatio}`
      );
    }

    reasons.push(
      `Sweep → shift → entry at open of opposing candle idx ${entryCandleIdx}, ` +
      `SL at swept swing ${recentSweep.sweptSwing.price.toFixed(2)}`
    );

    return {
      isValid: true,
      direction: bias.direction as 'bullish' | 'bearish',
      entryPrice,
      entryType: 'market',
      stopLoss,
      takeProfit,
      riskRewardRatio: this.riskRewardRatio,
      m1ChoChIndex: shiftIndex,
      reasons,
    };
  }

  /**
   * Detect external swings on H4 using consecutive candle direction.
   *
   * Rule: 3+ consecutive bullish (close > open) or bearish (close < open) candles
   * form an external structural leg. Neutral/doji candles (close == open) don't break the run.
   *
   * Bullish run → swing HIGH at the max high of the run
   * Bearish run → swing LOW at the min low of the run
   */
  /**
   * Detect external swing highs and lows using pivot-point method.
   * A swing high: candle high is higher than the N candles before and after it.
   * A swing low: candle low is lower than the N candles before and after it.
   * This works regardless of candle color (bullish/bearish).
   */
  private detectExternalSwings(candles: Candle[]): SwingPoint[] {
    const swings: SwingPoint[] = [];
    const lookback = 2; // Check 2 candles on each side

    for (let i = lookback; i < candles.length - lookback; i++) {
      const c = candles[i];

      // Check swing high: high is greater than surrounding candles
      let isSwingHigh = true;
      for (let j = 1; j <= lookback; j++) {
        if (candles[i - j].high >= c.high || candles[i + j].high >= c.high) {
          isSwingHigh = false;
          break;
        }
      }
      if (isSwingHigh) {
        swings.push({
          index: i,
          type: 'high',
          price: c.high,
          timestamp: c.startTime.getTime(),
        });
      }

      // Check swing low: low is less than surrounding candles
      let isSwingLow = true;
      for (let j = 1; j <= lookback; j++) {
        if (candles[i - j].low <= c.low || candles[i + j].low <= c.low) {
          isSwingLow = false;
          break;
        }
      }
      if (isSwingLow) {
        swings.push({
          index: i,
          type: 'low',
          price: c.low,
          timestamp: c.startTime.getTime(),
        });
      }
    }

    return swings.sort((a, b) => a.index - b.index);
  }

  private invalidEntry(direction: 'bullish' | 'bearish', reasons: string[]): ICTEntry {
    return {
      isValid: false,
      direction,
      entryPrice: 0,
      entryType: 'market',
      stopLoss: 0,
      takeProfit: 0,
      riskRewardRatio: 0,
      reasons,
    };
  }
}
