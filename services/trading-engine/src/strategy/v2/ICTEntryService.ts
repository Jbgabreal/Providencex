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
import { updatePOI, removePOI, PointOfInterest } from './POIStore';
import { FairValueGapService } from './FairValueGapService';

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
  hasFVG: boolean; // Whether the OB has an FVG (higher probability)
  displacementCandleIndex?: number;
  fvg?: { low: number; high: number; index: number };
  orderBlock?: OrderBlockV2;
  zoneLow: number;  // OB zone low
  zoneHigh: number; // OB zone high
  tpTarget?: number; // M15 swing target (the HH for bullish, LL for bearish)
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

    // M15: LuxAlgo swings for structural range + fib calculation
    this.m15SwingService = new SwingService({
      method: 'luxalgo',
      pivotLeft: 5,
    });

    // M15: BOS detection (strict close = ICT style)
    this.m15BosService = new BosService({
      bosLookbackSwings: 10,
      swingIndexLookback: 100,
      strictClose: true,
    });

    // M1: LuxAlgo swings for liquidity sweep detection (shorter len for fast detection)
    this.m1SwingService = new SwingService({
      method: 'luxalgo',
      pivotLeft: 3,
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
    m1Candles: Candle[],
    symbol: string = 'XAUUSD'
  ): ICTEntryResult {
    const ictLog = process.env.ICT_DEBUG === 'true' || process.env.SMC_DEBUG === 'true';

    // Session filter: Asian KZ (00:00-06:00 UTC), London KZ (07:00-11:00 UTC), NY KZ (12:00-16:00 UTC)
    // M15 setup always computed (for POI tracking), only M1 entry blocked outside KZ
    let outsideKillZone = false;
    if (m1Candles.length > 0) {
      const lastCandle = m1Candles[m1Candles.length - 1];
      const hour = lastCandle.startTime.getUTCHours();
      const disableKZ = process.env.DISABLE_KILL_ZONE === 'true';
      const isAsianKZ = hour >= 0 && hour <= 6;
      const isLondonKZ = hour >= 7 && hour <= 11;
      const isNYKZ = hour >= 12 && hour <= 16;
      outsideKillZone = disableKZ ? false : !isAsianKZ && !isLondonKZ && !isNYKZ;
      if (outsideKillZone && ictLog) {
        logger.info(`[ICT] Outside kill zone (hour=${hour} UTC) — will compute setup but block entries`);
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

    // Outside kill zone: still compute M15 setup (for POI tracking) but block M1 entry

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

    // Block M1 entry outside kill zones (M15 setup was still computed for POI tracking)
    if (outsideKillZone) {
      return { bias, setupZone, entry: null, setupsDetected: 1, entriesTaken: 0 };
    }

    // ═══════════════════════════════════════════════════════
    // STEP 3: M1 Entry — Liquidity sweep of M1 swing → enter
    // ═══════════════════════════════════════════════════════
    const entry = this.detectM1Entry(m1Candles, m15Candles, bias, setupZone, symbol);

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
   * Multi-stage H4 bias engine:
   *   Stage 1: Raw pivot detection (price-based, no candle color)
   *   Stage 2: Compress consecutive same-side pivots (keep extreme)
   *   Stage 3: Filter insignificant pivots (ATR-based threshold)
   *   Stage 4: Classify HH/HL/LH/LL → bullish/bearish/neutral
   */
  private determineH4Bias(h4Candles: Candle[]): ICTBias {
    const ictLog = true;

    logger.info(`[H4-BIAS] Entry: ${h4Candles.length} candles, first.high=${h4Candles[0]?.high}, first.startTime=${h4Candles[0]?.startTime}`);

    if (h4Candles.length < 5) {
      logger.info(`[H4-BIAS] Insufficient candles: ${h4Candles.length} (need ≥5)`);
      return { direction: 'sideways' };
    }

    // ── Stage 1: LuxAlgo swing detection (same algorithm as M15) ──
    // Use len=5 for H4 (since we typically have 30-50 candles)
    const h4SwingService = new SwingService({ method: 'luxalgo', pivotLeft: 5 });
    const swings = h4SwingService.detectSwings(h4Candles);

    const highs = swings.filter(s => s.type === 'high');
    const lows = swings.filter(s => s.type === 'low');

    if (ictLog) {
      logger.info(`[H4-BIAS] LuxAlgo swings: ${swings.length} total (${highs.length} highs, ${lows.length} lows)`);
      for (const s of swings) {
        logger.info(`  [SWING] idx=${s.index} ${s.type} ${s.price.toFixed(2)}`);
      }
    }

    // ── Stage 2: Classify structure (HH/HL/LH/LL) ──
    const result = this.classifyExternalStructure(swings, ictLog);
    if (ictLog) {
      logger.info(`[H4-BIAS] Structure bias: ${result.direction}`);
    }

    // ── Stage 3: Displacement fallback if still sideways ──
    if (result.direction === 'sideways') {
      const fallback = this.displacementFallback(h4Candles, ictLog);
      if (fallback.direction !== 'sideways') {
        if (ictLog) {
          logger.info(`[H4-BIAS] Displacement fallback: ${fallback.direction}`);
        }
        return fallback;
      }
    }

    if (ictLog) {
      logger.info(`[H4-BIAS] Final bias: ${result.direction}`);
    }
    return result;
  }

  /**
   * Displacement fallback: when swing structure can't determine direction,
   * use the overall price movement of the last N H4 candles.
   * Compares the midpoint of the range to the last close.
   */
  private displacementFallback(candles: Candle[], log: boolean): ICTBias {
    // Use last 10 candles for range, and last 5 for short-term direction
    const lookback = Math.min(candles.length, 10);
    const recent = candles.slice(-lookback);
    const shortTerm = candles.slice(-Math.min(candles.length, 5));

    let highest = -Infinity, lowest = Infinity;
    for (const c of recent) {
      if (c.high > highest) highest = c.high;
      if (c.low < lowest) lowest = c.low;
    }

    const range = highest - lowest;
    if (range === 0) return { direction: 'sideways' };

    const mid = (highest + lowest) / 2;
    const lastClose = recent[recent.length - 1].close;

    // Short-term trend: are the last 5 candles going up or down?
    const shortOpen = shortTerm[0].open;
    const shortClose = shortTerm[shortTerm.length - 1].close;
    const shortTrendUp = shortClose > shortOpen;

    // Count bullish vs bearish candles in short term
    let bullCandles = 0, bearCandles = 0;
    for (const c of shortTerm) {
      if (c.close > c.open) bullCandles++;
      else bearCandles++;
    }

    if (log) {
      logger.info(`[H4-BIAS] Displacement: close=${lastClose.toFixed(2)}, mid=${mid.toFixed(2)}, shortTrend=${shortTrendUp ? 'UP' : 'DOWN'} (${bullCandles}bull/${bearCandles}bear), range=${range.toFixed(2)}`);
    }

    // Primary: use short-term candle direction (most recent momentum)
    if (bullCandles > bearCandles) {
      return { direction: 'bullish', swingHigh: highest, swingLow: lowest };
    } else if (bearCandles > bullCandles) {
      return { direction: 'bearish', swingHigh: highest, swingLow: lowest };
    }

    // Tiebreaker: use price position relative to midpoint
    if (lastClose > mid) {
      return { direction: 'bullish', swingHigh: highest, swingLow: lowest };
    } else if (lastClose < mid) {
      return { direction: 'bearish', swingHigh: highest, swingLow: lowest };
    }

    return { direction: 'sideways' };
  }

  // ═══════════════════════════════════════════════════
  // Stage 1: Raw pivot detection
  // ═══════════════════════════════════════════════════

  /**
   * Detect candidate pivot highs and lows.
   * Pivot high: candle.high > N candles on each side.
   * Pivot low:  candle.low  < N candles on each side.
   * No candle-color dependency.
   */
  private detectRawPivots(candles: Candle[], lookback: number): SwingPoint[] {
    const pivots: SwingPoint[] = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
      const c = candles[i];

      let isHigh = true;
      let isLow = true;

      for (let j = 1; j <= lookback; j++) {
        // Use strict > / < (not >= / <=) so equal highs/lows don't kill pivots
        // Deriv H4 candles can have equal values at boundaries
        if (candles[i - j].high > c.high || candles[i + j].high > c.high) isHigh = false;
        if (candles[i - j].low < c.low || candles[i + j].low < c.low) isLow = false;
        if (!isHigh && !isLow) break;
      }

      if (isHigh) {
        pivots.push({ index: i, type: 'high', price: c.high, timestamp: c.startTime.getTime() });
      }
      if (isLow) {
        pivots.push({ index: i, type: 'low', price: c.low, timestamp: c.startTime.getTime() });
      }
    }

    return pivots.sort((a, b) => a.index - b.index);
  }

  // ═══════════════════════════════════════════════════
  // Stage 2: Compress consecutive same-side pivots
  // ═══════════════════════════════════════════════════

  /**
   * If multiple consecutive highs appear before a low, keep only the HIGHEST.
   * If multiple consecutive lows appear before a high, keep only the LOWEST.
   * Enforces strictly alternating high-low-high-low structure.
   */
  private compressSameSidePivots(pivots: SwingPoint[]): SwingPoint[] {
    if (pivots.length <= 1) return [...pivots];

    const result: SwingPoint[] = [];
    let group: SwingPoint[] = [pivots[0]];

    for (let i = 1; i < pivots.length; i++) {
      if (pivots[i].type === group[0].type) {
        // Same side — add to group
        group.push(pivots[i]);
      } else {
        // Side changed — flush group, keep extreme
        result.push(this.pickExtreme(group));
        group = [pivots[i]];
      }
    }
    // Flush last group
    result.push(this.pickExtreme(group));

    return result;
  }

  /** From a group of same-side pivots, keep highest high or lowest low. */
  private pickExtreme(group: SwingPoint[]): SwingPoint {
    if (group[0].type === 'high') {
      return group.reduce((best, p) => (p.price > best.price ? p : best), group[0]);
    } else {
      return group.reduce((best, p) => (p.price < best.price ? p : best), group[0]);
    }
  }

  // ═══════════════════════════════════════════════════
  // Stage 3: Filter insignificant swings
  // ═══════════════════════════════════════════════════

  /**
   * Remove swings whose displacement from the previous opposite swing
   * is below the significance threshold.
   * Keeps the first swing unconditionally.
   */
  private filterMeaningfulSwings(pivots: SwingPoint[], threshold: number): SwingPoint[] {
    if (pivots.length <= 2) return [...pivots];

    const result: SwingPoint[] = [pivots[0]];

    for (let i = 1; i < pivots.length; i++) {
      const prev = result[result.length - 1];
      const curr = pivots[i];
      const displacement = Math.abs(curr.price - prev.price);

      if (displacement >= threshold) {
        result.push(curr);
      }
      // If below threshold, skip this pivot (noise)
    }

    return result;
  }

  // ═══════════════════════════════════════════════════
  // Stage 4: Classify external structure
  // ═══════════════════════════════════════════════════

  /**
   * From cleaned alternating swings, determine HH/HL/LH/LL pattern.
   * bullish  = latest high > previous high AND latest low > previous low
   * bearish  = latest high < previous high AND latest low < previous low
   * sideways = mixed or insufficient swings
   */
  private classifyExternalStructure(swings: SwingPoint[], log: boolean): ICTBias {
    const highs = swings.filter(s => s.type === 'high');
    const lows = swings.filter(s => s.type === 'low');

    if (highs.length < 2 || lows.length < 2) {
      if (log) logger.info(`[H4-BIAS] Not enough swings for classification: ${highs.length} highs, ${lows.length} lows`);
      // Fallback: use simple price position if we have any swings
      if (highs.length >= 1 && lows.length >= 1) {
        return this.fallbackBias(swings, highs, lows, log);
      }
      return { direction: 'sideways' };
    }

    const prevHigh = highs[highs.length - 2];
    const lastHigh = highs[highs.length - 1];
    const prevLow = lows[lows.length - 2];
    const lastLow = lows[lows.length - 1];

    const isHH = lastHigh.price > prevHigh.price;
    const isHL = lastLow.price > prevLow.price;
    const isLH = lastHigh.price < prevHigh.price;
    const isLL = lastLow.price < prevLow.price;

    if (log) {
      logger.info(`[H4-BIAS] Structure: prevHigh=${prevHigh.price.toFixed(2)} → lastHigh=${lastHigh.price.toFixed(2)} (${isHH ? 'HH' : 'LH'})`);
      logger.info(`[H4-BIAS] Structure: prevLow=${prevLow.price.toFixed(2)} → lastLow=${lastLow.price.toFixed(2)} (${isHL ? 'HL' : 'LL'})`);
    }

    let direction: 'bullish' | 'bearish' | 'sideways' = 'sideways';

    if (isHH && isHL) {
      direction = 'bullish';
    } else if (isLH && isLL) {
      direction = 'bearish';
    } else {
      // Mixed pattern (LH+HL compression or HH+LL expansion)
      // Count the broader trend across ALL available swing pairs
      let hhCount = 0, lhCount = 0, hlCount = 0, llCount = 0;
      for (let i = 1; i < highs.length; i++) {
        if (highs[i].price > highs[i - 1].price) hhCount++;
        else lhCount++;
      }
      for (let i = 1; i < lows.length; i++) {
        if (lows[i].price > lows[i - 1].price) hlCount++;
        else llCount++;
      }

      if (log) {
        logger.info(`[H4-BIAS] Mixed pattern — broader count: HH=${hhCount} LH=${lhCount} HL=${hlCount} LL=${llCount}`);
      }

      // Determine bias from the dominant trend across all swing pairs
      const bullishScore = hhCount + hlCount;
      const bearishScore = lhCount + llCount;

      if (bearishScore > bullishScore) {
        direction = 'bearish';
        if (log) logger.info(`[H4-BIAS] Broader trend bearish (bearish=${bearishScore} vs bullish=${bullishScore})`);
      } else if (bullishScore > bearishScore) {
        direction = 'bullish';
        if (log) logger.info(`[H4-BIAS] Broader trend bullish (bullish=${bullishScore} vs bearish=${bearishScore})`);
      } else {
        // Truly mixed — use overall price direction
        const firstSwing = swings[0];
        const lastSwing = swings[swings.length - 1];
        if (lastSwing.price < firstSwing.price) direction = 'bearish';
        else if (lastSwing.price > firstSwing.price) direction = 'bullish';
        if (log) logger.info(`[H4-BIAS] Tied scores — using price direction: ${firstSwing.price.toFixed(2)} → ${lastSwing.price.toFixed(2)} = ${direction}`);
      }
    }

    if (log) {
      logger.info(`[H4-BIAS] Final: ${direction} (HH=${isHH}, HL=${isHL}, LH=${isLH}, LL=${isLL})`);
    }

    return {
      direction,
      swingHigh: lastHigh.price,
      swingLow: lastLow.price,
    };
  }

  /**
   * Fallback bias when we have swings but not enough for full HH/HL/LH/LL.
   * Uses the trend implied by the sequence of swings.
   */
  private fallbackBias(
    swings: SwingPoint[], highs: SwingPoint[], lows: SwingPoint[], log: boolean
  ): ICTBias {
    // Look at overall direction: is the last swing higher or lower than the first?
    const first = swings[0];
    const last = swings[swings.length - 1];
    const range = Math.abs(highs[highs.length - 1].price - lows[lows.length - 1].price);

    let direction: 'bullish' | 'bearish' | 'sideways' = 'sideways';
    // Use 10% threshold (was 30% — too strict, caused constant sideways)
    if (last.price > first.price && (last.price - first.price) > range * 0.1) {
      direction = 'bullish';
    } else if (last.price < first.price && (first.price - last.price) > range * 0.1) {
      direction = 'bearish';
    } else if (last.price > first.price) {
      direction = 'bullish'; // Any upward movement counts
    } else if (last.price < first.price) {
      direction = 'bearish'; // Any downward movement counts
    }

    if (log) logger.info(`[H4-BIAS] Fallback: first=${first.price.toFixed(2)} → last=${last.price.toFixed(2)}, direction=${direction}`);

    return {
      direction,
      swingHigh: highs[highs.length - 1].price,
      swingLow: lows[lows.length - 1].price,
    };
  }

  // ═══════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════

  /** Compute Average True Range over last N candles. */
  private computeATR(candles: Candle[], period: number): number {
    if (candles.length < 2) return 0;
    let sum = 0;
    const start = Math.max(1, candles.length - period);
    let count = 0;
    for (let i = start; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      sum += tr;
      count++;
    }
    return count > 0 ? sum / count : 0;
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
      return { isValid: false, direction: bias.direction, hasDisplacement: false, hasFVG: false, zoneLow: 0, zoneHigh: 0, reasons: ['Insufficient M15 candles'] };
    }

    // ═══════════════════════════════════════════════════════
    // ICT M15 Setup: MSB + Order Block approach
    // Inspired by PineScript MSB-OB indicator logic:
    // 1. Find swing highs/lows (zigzag-style)
    // 2. Detect Market Structure Break (MSB/BOS)
    // 3. Find Order Block: last opposing candle before the impulse
    // 4. Check if price has retraced to the OB zone
    // ═══════════════════════════════════════════════════════

    // 1. Detect swings using fractal method
    // Use LuxAlgo swing detection — proven algorithm from the #1 TradingView SMC indicator
    // pivotLeft controls the lookback length (equivalent to PineScript's zigzag_len)
    // Use len=5 for M15 (len=10 was too slow, missing recent structure)
    const fallbackService = new SwingService({ method: 'luxalgo', pivotLeft: 5 });
    const allSwings = fallbackService.detectSwings(m15Candles);
    const swingHighs = allSwings.filter(s => s.type === 'high').sort((a, b) => a.index - b.index);
    const swingLows = allSwings.filter(s => s.type === 'low').sort((a, b) => a.index - b.index);

    if (swingHighs.length < 2 || swingLows.length < 2) {
      reasons.push(`Not enough M15 swings: ${swingHighs.length} highs, ${swingLows.length} lows`);
      return { isValid: false, direction: bias.direction, hasDisplacement: false, hasFVG: false, zoneLow: 0, zoneHigh: 0, reasons };
    }

    // 2. Detect Market Structure Break (MSB) with fib_factor confirmation
    // Matches PineScript: h0 > h1 + abs(h1 - l0) * fib_factor
    // The break must extend beyond the prior swing by a fib factor (33%) to confirm
    const FIB_FACTOR = 0.33;
    const lastSH = swingHighs[swingHighs.length - 1];
    const prevSH = swingHighs[swingHighs.length - 2];
    const lastSL = swingLows[swingLows.length - 1];
    const prevSL = swingLows[swingLows.length - 2];

    // Bullish MSB: new high > prev high + fib_factor * abs(prev_high - current_low)
    const bullishRange = Math.abs(prevSH.price - lastSL.price);
    const bullishMSB = lastSH.price > prevSH.price + bullishRange * FIB_FACTOR;

    // Bearish MSB: new low < prev low - fib_factor * abs(current_high - prev_low)
    const bearishRange = Math.abs(lastSH.price - prevSL.price);
    const bearishMSB = lastSL.price < prevSL.price - bearishRange * FIB_FACTOR;

    // Also accept simple HH/HL or LH/LL without fib confirmation as a weaker signal
    const simpleBullishMSB = lastSH.price > prevSH.price;
    const simpleBearishMSB = lastSL.price < prevSL.price;

    const hasMSB = (bias.direction === 'bullish' && (bullishMSB || simpleBullishMSB)) ||
                   (bias.direction === 'bearish' && (bearishMSB || simpleBearishMSB));

    if (!hasMSB) {
      // No MSB matching H4 bias — but still look for OB at the recent swing extreme
      // If H4=bullish and M15 made LL, the LL area could be the reversal OB (smart money accumulation)
      // If H4=bearish and M15 made HH, the HH area could be the reversal OB (smart money distribution)
      if (ictLog) logger.info(`[ICT] No M15 ${bias.direction} MSB — HH=${simpleBullishMSB}, LL=${simpleBearishMSB}. Trying reversal OB...`);

      // Look for OB at the most recent swing that opposes the H4 bias (potential reversal zone)
      let revObHigh = 0, revObLow = 0, revObIndex = -1, revObFound = false;
      if (bias.direction === 'bullish' && swingLows.length > 0) {
        // Bullish H4 + M15 pullback: OB near the latest swing low
        const sl = swingLows[swingLows.length - 1];
        const scanStart = Math.min(sl.index + 5, m15Candles.length - 1);
        const scanEnd = Math.max(sl.index - 5, 0);
        for (let i = scanStart; i >= scanEnd; i--) {
          const c = m15Candles[i];
          if (c.open > c.close) { revObHigh = c.high; revObLow = c.low; revObIndex = i; revObFound = true; break; }
        }
      } else if (bias.direction === 'bearish' && swingHighs.length > 0) {
        const sh = swingHighs[swingHighs.length - 1];
        const scanStart = Math.min(sh.index + 5, m15Candles.length - 1);
        const scanEnd = Math.max(sh.index - 5, 0);
        for (let i = scanStart; i >= scanEnd; i--) {
          const c = m15Candles[i];
          if (c.close > c.open) { revObHigh = c.high; revObLow = c.low; revObIndex = i; revObFound = true; break; }
        }
      }

      if (revObFound) {
        const currentPrice = m15Candles[m15Candles.length - 1].close;
        const tpTarget = bias.direction === 'bullish' ? lastSH.price : lastSL.price;
        const revObRange = revObHigh - revObLow;
        const revObBuffer = revObRange * 0.5;

        // Check if price is at or near the reversal OB — if so, it's a valid setup
        const priceNearRevOB = bias.direction === 'bullish'
          ? (currentPrice <= revObHigh + revObBuffer && currentPrice >= revObLow - revObBuffer)
          : (currentPrice >= revObLow - revObBuffer && currentPrice <= revObHigh + revObBuffer);

        if (ictLog) logger.info(`[ICT] Reversal OB: ${revObLow.toFixed(5)}-${revObHigh.toFixed(5)} (idx=${revObIndex}), price=${currentPrice.toFixed(5)}, near=${priceNearRevOB}`);

        if (priceNearRevOB) {
          // Price IS at the reversal OB — treat as valid setup (M15 retracement = buy/sell zone)
          reasons.push(`M15 retracement OB (${bias.direction === 'bullish' ? 'BUY' : 'SELL'} zone) at ${revObLow.toFixed(5)}-${revObHigh.toFixed(5)}`);
          return { isValid: true, direction: bias.direction, hasDisplacement: true, hasFVG: false, zoneLow: revObLow, zoneHigh: revObHigh, tpTarget, reasons };
        }

        // Price not at OB yet — show as POI (watching)
        reasons.push(`Reversal OB at ${revObLow.toFixed(5)}-${revObHigh.toFixed(5)} — waiting for price`);
        return { isValid: false, direction: bias.direction, hasDisplacement: true, hasFVG: false, zoneLow: revObLow, zoneHigh: revObHigh, tpTarget, reasons };
      }

      reasons.push(`No M15 MSB in ${bias.direction} direction (HH=${simpleBullishMSB}, LL=${simpleBearishMSB})`);
      return { isValid: false, direction: bias.direction, hasDisplacement: false, hasFVG: false, zoneLow: 0, zoneHigh: 0, reasons };
    }

    // Log the full swing structure for visibility
    if (ictLog) {
      const msbType = (bias.direction === 'bullish' && bullishMSB) || (bias.direction === 'bearish' && bearishMSB) ? 'STRONG' : 'SIMPLE';
      logger.info(`[ICT] ═══ M15 SETUP ANALYSIS ═══`);
      logger.info(`[ICT] Swings: ${swingHighs.length}H ${swingLows.length}L — ${allSwings.map(s => `${s.type === 'high' ? 'H' : 'L'}(${s.price.toFixed(5)}@${s.index})`).join(' → ')}`);
      logger.info(`[ICT] MSB: ${bias.direction} ${msbType} — ${bias.direction === 'bullish'
        ? `prevHigh=${prevSH.price.toFixed(5)} → newHigh=${lastSH.price.toFixed(5)} (HH)`
        : `prevLow=${prevSL.price.toFixed(5)} → newLow=${lastSL.price.toFixed(5)} (LL)`}`);
    }

    // 3. Find Order Block — matching PineScript MSB-OB exactly
    //
    // PineScript logic (EmreKb):
    //   Bullish OB: for i=h1i to l0i → scan from PREVIOUS high to CURRENT low (the pullback)
    //   Bearish OB: for i=l1i to h0i → scan from PREVIOUS low to CURRENT high (the pullback)
    //
    // The OB is the last opposing candle in the RETRACEMENT leg (NOT the impulse).
    // This is where smart money left orders — the "origin" of the reversal.
    let obHigh = 0;
    let obLow = 0;
    let obFound = false;
    let obIndex = -1;

    if (bias.direction === 'bullish') {
      // Bullish OB: scan the PULLBACK area (from prevSH → lastSL)
      // Extended scan: also look 10 candles before prevSH (PineScript uses zigzag_len extension)
      const scanStart = Math.min(prevSH.index, m15Candles.length - 1);
      const scanEnd = Math.max(lastSL.index - 10, 0); // Extended range
      for (let i = scanStart; i >= scanEnd; i--) {
        const c = m15Candles[i];
        if (c.open > c.close) { // Bearish candle = bullish OB
          obHigh = c.high;
          obLow = c.low;
          obIndex = i;
          obFound = true;
          break;
        }
      }
    } else {
      // Bearish OB: scan the PULLBACK area (from prevSL → lastSH)
      const scanStart = Math.min(prevSL.index, m15Candles.length - 1);
      const scanEnd = Math.max(lastSH.index - 10, 0); // Extended range
      for (let i = scanStart; i >= scanEnd; i--) {
        const c = m15Candles[i];
        if (c.close > c.open) { // Bullish candle = bearish OB
          obHigh = c.high;
          obLow = c.low;
          obIndex = i;
          obFound = true;
          break;
        }
      }
    }

    if (!obFound) {
      reasons.push(`No Order Block found before MSB`);
      return { isValid: false, direction: bias.direction, hasDisplacement: false, hasFVG: false, zoneLow: 0, zoneHigh: 0, reasons };
    }

    // 3b. Detect FVG created by the impulse FROM the OB
    // The valid FVG is in the candles AFTER the OB — the displacement that followed
    // Check by PRICE LEVEL proximity (not just candle index)
    const fvgService = new FairValueGapService(50, true);
    const fvgs = fvgService.detectFVGs(m15Candles, 'ITF', bias.direction === 'bullish' ? 'discount' : 'premium');

    // Find FVG that:
    // 1. Is AFTER the OB candle (created by the impulse from the OB)
    // 2. Overlaps or is adjacent to the OB price zone
    // 3. Is not yet filled/mitigated
    let nearbyFVG: { low: number; high: number } | null = null;
    const obMidPrice = (obHigh + obLow) / 2;
    const obPriceRange = obHigh - obLow;
    const maxPriceDist = Math.max(obPriceRange * 3, obMidPrice * 0.005); // 3x OB range or 0.5% of price

    for (const fvg of fvgs) {
      if (fvg.filled) continue;
      if (!fvg.candleIndices) continue;

      const fvgStartIdx = fvg.candleIndices[0];
      // FVG must be AFTER or AT the OB (the impulse that came from the OB)
      if (fvgStartIdx < obIndex - 2) continue;

      // Check price proximity — FVG zone overlaps or is within maxPriceDist of OB zone
      const fvgMid = (fvg.high + fvg.low) / 2;
      const priceOverlap = fvg.low <= obHigh && fvg.high >= obLow; // Zones overlap
      const priceClose = Math.abs(fvgMid - obMidPrice) <= maxPriceDist;

      if (priceOverlap || priceClose) {
        nearbyFVG = { low: fvg.low, high: fvg.high };
        break;
      }
    }

    // If FVG found near OB, expand the zone to cover both OB and FVG
    if (nearbyFVG) {
      const combinedLow = Math.min(obLow, nearbyFVG.low);
      const combinedHigh = Math.max(obHigh, nearbyFVG.high);
      if (ictLog) {
        logger.info(`[ICT] ✅ FVG+OB confluence! FVG=${nearbyFVG.low.toFixed(5)}-${nearbyFVG.high.toFixed(5)}, OB=${obLow.toFixed(5)}-${obHigh.toFixed(5)} → Combined=${combinedLow.toFixed(5)}-${combinedHigh.toFixed(5)}`);
      }
      obLow = combinedLow;
      obHigh = combinedHigh;
    } else if (ictLog) {
      logger.info(`[ICT] No FVG near OB (${fvgs.length} FVGs, none overlap OB at ${obLow.toFixed(5)}-${obHigh.toFixed(5)})`);
    }

    // 4. Check OB invalidation (PineScript: close < bottom invalidates bullish OB)
    const currentPrice = m15Candles[m15Candles.length - 1].close;
    if (bias.direction === 'bullish' && currentPrice < obLow) {
      if (ictLog) logger.info(`[ICT] Bu-OB INVALIDATED — price ${currentPrice.toFixed(5)} closed below OB low ${obLow.toFixed(5)}`);
      reasons.push(`Bu-OB broken: price=${currentPrice.toFixed(5)} < OB=${obLow.toFixed(5)}-${obHigh.toFixed(5)}`);
      return { isValid: false, direction: bias.direction, hasDisplacement: true, hasFVG: !!nearbyFVG, zoneLow: obLow, zoneHigh: obHigh, reasons };
    }
    if (bias.direction === 'bearish' && currentPrice > obHigh) {
      if (ictLog) logger.info(`[ICT] Be-OB INVALIDATED — price ${currentPrice.toFixed(5)} closed above OB high ${obHigh.toFixed(5)}`);
      reasons.push(`Be-OB broken: price=${currentPrice.toFixed(5)} > OB=${obLow.toFixed(5)}-${obHigh.toFixed(5)}`);
      return { isValid: false, direction: bias.direction, hasDisplacement: true, hasFVG: !!nearbyFVG, zoneLow: obLow, zoneHigh: obHigh, reasons };
    }

    // 5. Check Premium/Discount zone + Fibonacci OTE
    // ICT rule: BUY only in discount (below 50%), SELL only in premium (above 50%)
    // OTE (Optimal Trade Entry) = 62-79% retracement of the impulse leg
    const impulseHigh = bias.direction === 'bullish' ? lastSH.price : prevSH.price;
    const impulseLow = bias.direction === 'bullish' ? prevSL.price : lastSL.price;
    const impulseRange = impulseHigh - impulseLow;
    const equilibrium = (impulseHigh + impulseLow) / 2;

    // Fibonacci levels from the impulse leg
    const fib50 = impulseLow + impulseRange * 0.50;  // Equilibrium
    const fib62 = impulseLow + impulseRange * 0.382; // 62% retracement (bullish discount)
    const fib79 = impulseLow + impulseRange * 0.21;  // 79% retracement (deep discount)
    const fib62_premium = impulseLow + impulseRange * 0.618; // 62% from bottom (bearish premium)
    const fib79_premium = impulseLow + impulseRange * 0.79;  // 79% from bottom (deep premium)

    // OB position in fib terms
    const obMidFib = impulseRange > 0 ? (((obHigh + obLow) / 2) - impulseLow) / impulseRange : 0.5;
    const priceFib = impulseRange > 0 ? (currentPrice - impulseLow) / impulseRange : 0.5;

    // Check if price is in the correct zone
    const inDiscount = currentPrice <= fib50;
    const inPremium = currentPrice >= fib50;
    const inOTE_buy = currentPrice <= fib62 && currentPrice >= fib79;  // 62-79% retracement for buy
    const inOTE_sell = currentPrice >= fib62_premium && currentPrice <= fib79_premium; // for sell

    // Check if price is at or near the OB
    const obRange = obHigh - obLow;
    const obBuffer = obRange * 0.5;
    let inOB = false;
    if (bias.direction === 'bullish') {
      inOB = currentPrice <= (obHigh + obBuffer) && currentPrice >= (obLow - obBuffer);
    } else {
      inOB = currentPrice >= (obLow - obBuffer) && currentPrice <= (obHigh + obBuffer);
    }

    if (ictLog) {
      logger.info(`[ICT] ═══ ZONE ANALYSIS ═══`);
      logger.info(`[ICT] Impulse: ${impulseLow.toFixed(5)}-${impulseHigh.toFixed(5)} (range=${impulseRange.toFixed(5)})`);
      logger.info(`[ICT] Fib levels: 79%=${fib79.toFixed(5)}, 62%=${fib62.toFixed(5)}, 50%=${fib50.toFixed(5)}, 38%=${fib62_premium.toFixed(5)}, 21%=${fib79_premium.toFixed(5)}`);
      logger.info(`[ICT] OB: ${obLow.toFixed(5)}-${obHigh.toFixed(5)} (fib pos=${(obMidFib*100).toFixed(1)}%)`);
      logger.info(`[ICT] Price: ${currentPrice.toFixed(5)} (fib=${(priceFib*100).toFixed(1)}%), ${inDiscount ? 'DISCOUNT' : 'PREMIUM'}, inOB=${inOB}, inOTE=${bias.direction === 'bullish' ? inOTE_buy : inOTE_sell}`);
    }

    // Validate: price must be in the correct zone for the bias direction
    const correctZone = (bias.direction === 'bullish' && inDiscount) ||
                        (bias.direction === 'bearish' && inPremium);

    if (!correctZone && !inOB) {
      const zone = currentPrice > fib50 ? 'PREMIUM' : 'DISCOUNT';
      const tpReject = bias.direction === 'bullish' ? lastSH.price : lastSL.price;
      reasons.push(
        `Price in ${zone} (fib=${(priceFib*100).toFixed(1)}%) — ${bias.direction === 'bullish' ? 'need DISCOUNT (<50%)' : 'need PREMIUM (>50%)'} | ` +
        `OB=${obLow.toFixed(5)}-${obHigh.toFixed(5)} eq=${fib50.toFixed(5)}`
      );
      return { isValid: false, direction: bias.direction, hasDisplacement: true, hasFVG: !!nearbyFVG, zoneLow: obLow, zoneHigh: obHigh, tpTarget: tpReject, reasons };
    }

    // TP target = the M15 swing point that made the MSB
    // Bullish: TP at the swing high (the HH that confirmed the MSB)
    // Bearish: TP at the swing low (the LL that confirmed the MSB)
    const tpTarget = bias.direction === 'bullish' ? lastSH.price : lastSL.price;

    const hasFVGConfluence = !!nearbyFVG;
    reasons.push(`M15 MSB confirmed + price in ${inOB ? 'Order Block' : 'equilibrium'} zone${hasFVGConfluence ? ' +FVG' : ''}, TP=${tpTarget.toFixed(5)}`);

    return {
      isValid: true,
      direction: bias.direction,
      hasDisplacement: true,
      hasFVG: hasFVGConfluence,
      displacementCandleIndex: obIndex,
      zoneLow: obLow,
      zoneHigh: obHigh,
      tpTarget,
      reasons,
    };
  }

  /**
   * Step 3: M1 Entry — Price at M15 OB zone + LTF confirmation
   *
   * ICT model:
   * 1. M15 OB zone is the POI (point of interest)
   * 2. When price retraces to the OB zone, look for M1 confirmation:
   *    - Bullish: engulfing/CHoCH candle in the OB zone (close > open, or close > prior swing high)
   *    - Bearish: engulfing/CHoCH candle in the OB zone (close < open, or close < prior swing low)
   * 3. Entry at the M1 confirmation candle close
   * 4. SL = below/above the M15 OB zone
   * 5. TP = the M15 swing point that made the MSB (the HH for bullish, LL for bearish)
   */
  private detectM1Entry(
    m1Candles: Candle[],
    m15Candles: Candle[],
    bias: ICTBias,
    setupZone: ICTSetupZone,
    symbol: string = 'XAUUSD'
  ): ICTEntry {
    const reasons: string[] = [];
    const ictLog = process.env.ICT_DEBUG === 'true' || process.env.SMC_DEBUG === 'true';
    const dir = bias.direction as 'bullish' | 'bearish';

    if (m1Candles.length < 10) {
      return this.invalidEntry(dir, ['Insufficient M1 candles']);
    }

    const obLow = setupZone.zoneLow;
    const obHigh = setupZone.zoneHigh;
    const obBuffer = (obHigh - obLow) * 0.3; // 30% buffer around OB

    // 1. Check if price has reached the M15 OB zone on recent M1 candles
    // Look at last 30 M1 candles for price touching the OB
    const lookback = Math.min(30, m1Candles.length);
    let touchIndex = -1;

    for (let i = m1Candles.length - lookback; i < m1Candles.length; i++) {
      const c = m1Candles[i];
      if (dir === 'bullish') {
        // Price dipped into or below OB zone (retracing down to buy zone)
        if (c.low <= obHigh + obBuffer) {
          touchIndex = i;
          break;
        }
      } else {
        // Price rallied into or above OB zone (retracing up to sell zone)
        if (c.high >= obLow - obBuffer) {
          touchIndex = i;
          break;
        }
      }
    }

    if (touchIndex === -1) {
      reasons.push(`Price hasn't reached M15 OB zone [${obLow.toFixed(5)}-${obHigh.toFixed(5)}] on M1`);
      return this.invalidEntry(dir, reasons);
    }

    if (ictLog) {
      logger.info(`[ICT] M1: Price touched M15 OB zone at M1 idx ${touchIndex}, hasFVG=${setupZone.hasFVG}`);
    }

    // Prefer OB+FVG confluence — if no FVG, the OB is weaker and more likely to fail
    // Still allow entry without FVG but log it as lower quality
    if (!setupZone.hasFVG && ictLog) {
      logger.info(`[ICT] M1: ⚠️ OB has no FVG — lower probability setup`);
    }

    // 2. After price touches OB, look for M1 CHoCH + confirmation candle
    // ICT requires Change of Character (CHoCH) — M1 structure must shift before entry
    // Simply being bullish at the OB isn't enough; price must break a recent M1 swing high (buy) or low (sell)
    let confirmIndex = -1;
    let confirmCandle: Candle | null = null;

    // Find recent M1 swing high/low BEFORE the OB touch for CHoCH detection
    const recentSwingsForChoch = this.m1SwingService.detectSwings(m1Candles.slice(0, Math.min(touchIndex + 15, m1Candles.length)));
    const swingHighsBeforeTouch = recentSwingsForChoch.filter(s => s.type === 'high' && s.index <= touchIndex + 5).sort((a, b) => b.index - a.index);
    const swingLowsBeforeTouch = recentSwingsForChoch.filter(s => s.type === 'low' && s.index <= touchIndex + 5).sort((a, b) => b.index - a.index);

    for (let i = touchIndex; i < m1Candles.length; i++) {
      const c = m1Candles[i];
      const prev = i > 0 ? m1Candles[i - 1] : null;

      if (dir === 'bullish') {
        const isBullish = c.close > c.open;
        const bodySize = Math.abs(c.close - c.open);
        const prevBody = prev ? Math.abs(prev.close - prev.open) : 0;
        const isEngulfing = prev && isBullish && bodySize > prevBody && c.close > (prev?.high || 0);
        const isStrongBullish = isBullish && bodySize > (c.high - c.low) * 0.6; // Tightened: body > 60% of range

        // CHoCH check: candle must close above the most recent M1 swing high (structure shift)
        const recentSwingHigh = swingHighsBeforeTouch[0];
        const hasChoCH = recentSwingHigh ? c.close > recentSwingHigh.price : false;
        const confirmType = hasChoCH ? 'CHoCH' : isEngulfing ? 'engulfing' : isStrongBullish ? 'strong bullish' : null;

        // Accept CHoCH (best), engulfing (good), or strong bullish (acceptable)
        if (hasChoCH || isEngulfing || isStrongBullish) {
          confirmIndex = i;
          confirmCandle = c;
          reasons.push(`M1 bullish confirmation at idx ${i}: ${confirmType || 'strong bullish'} close=${c.close.toFixed(5)}`);
          break;
        }
      } else {
        const isBearish = c.close < c.open;
        const bodySize = Math.abs(c.close - c.open);
        const prevBody = prev ? Math.abs(prev.close - prev.open) : 0;
        const isEngulfing = prev && isBearish && bodySize > prevBody && c.close < (prev?.low || Infinity);
        const isStrongBearish = isBearish && bodySize > (c.high - c.low) * 0.6; // Tightened from 50% to 60%

        const recentSwingLow = swingLowsBeforeTouch[0];
        const hasChoCH = recentSwingLow ? c.close < recentSwingLow.price : false;
        const confirmType = hasChoCH ? 'CHoCH' : isEngulfing ? 'engulfing' : isStrongBearish ? 'strong bearish' : null;

        if (hasChoCH || isEngulfing || isStrongBearish) {
          confirmIndex = i;
          confirmCandle = c;
          reasons.push(`M1 bearish confirmation at idx ${i}: ${confirmType} close=${c.close.toFixed(5)}`);
          break;
        }
      }
    }

    if (!confirmCandle || confirmIndex === -1) {
      reasons.push('No M1 confirmation candle (engulfing/CHoCH) at OB zone');
      return this.invalidEntry(dir, reasons);
    }

    // 3. Entry at the confirmation candle close
    const entryPrice = confirmCandle.close;

    // 4. SL = structural swing invalidation level
    // For SELL: SL at the recent swing HIGH (structure above us)
    // For BUY: SL at the recent swing LOW (structure below us)
    // This is the ICT way — SL at the point that invalidates the setup
    const m1Swings = this.m1SwingService.detectSwings(m1Candles);
    const recentM1Highs = m1Swings.filter(s => s.type === 'high' && s.index <= confirmIndex).sort((a, b) => b.index - a.index);
    const recentM1Lows = m1Swings.filter(s => s.type === 'low' && s.index <= confirmIndex).sort((a, b) => b.index - a.index);

    let stopLoss: number;
    // Minimum SL distance to avoid noise stop-outs
    const isGold = symbol.toUpperCase() === 'XAUUSD' || symbol.toUpperCase() === 'GOLD';
    const minSlDistance = isGold ? 5.0 : 0.0010; // 5 points for gold, 10 pips for forex

    if (dir === 'bullish') {
      // BUY SL: Use the most recent M1 swing low (structural invalidation)
      // Fallback to OB low if no M1 swing found
      const m1SwingLow = recentM1Lows[0];
      const structuralLevel = m1SwingLow ? m1SwingLow.price : obLow;
      const buffer = isGold ? 1.5 : 0.0003; // Fixed buffer: 1.5 pts gold, 3 pips forex
      stopLoss = structuralLevel - buffer;
      if (ictLog) logger.info(`[ICT] SL: M1 swing low=${m1SwingLow?.price?.toFixed(3) || 'none'}, OB low=${obLow.toFixed(3)}, using=${structuralLevel.toFixed(3)}, SL=${stopLoss.toFixed(3)}`);
    } else {
      // SELL SL: Use the most recent M1 swing high (structural invalidation)
      const m1SwingHigh = recentM1Highs[0];
      const structuralLevel = m1SwingHigh ? m1SwingHigh.price : obHigh;
      const buffer = isGold ? 1.5 : 0.0003;
      stopLoss = structuralLevel + buffer;
      if (ictLog) logger.info(`[ICT] SL: M1 swing high=${m1SwingHigh?.price?.toFixed(3) || 'none'}, OB high=${obHigh.toFixed(3)}, using=${structuralLevel.toFixed(3)}, SL=${stopLoss.toFixed(3)}`);
    }

    // Enforce minimum SL distance
    const slDist = Math.abs(entryPrice - stopLoss);
    if (slDist < minSlDistance) {
      if (ictLog) logger.info(`[ICT] ❌ SL too tight: ${slDist.toFixed(3)} < min ${minSlDistance} — widening to minimum`);
      stopLoss = dir === 'bullish' ? entryPrice - minSlDistance : entryPrice + minSlDistance;
    }

    // 5. TP = M15 swing point (the HH for bullish, LL for bearish)
    let takeProfit: number;
    const risk = Math.abs(entryPrice - stopLoss);

    // Minimum R:R filter — don't enter if risk/reward is too poor
    const minRR = 1.5;

    if (setupZone.tpTarget && setupZone.tpTarget > 0) {
      takeProfit = setupZone.tpTarget;
    } else {
      takeProfit = dir === 'bullish' ? entryPrice + risk * this.riskRewardRatio : entryPrice - risk * this.riskRewardRatio;
    }

    // CRITICAL: Validate TP is in the right direction
    // Bullish: TP must be ABOVE entry
    // Bearish: TP must be BELOW entry
    const tpValid = (dir === 'bullish' && takeProfit > entryPrice) ||
                    (dir === 'bearish' && takeProfit < entryPrice);
    if (!tpValid) {
      // TP target is wrong direction — use R:R fallback
      if (ictLog) logger.info(`[ICT] TP ${takeProfit.toFixed(5)} wrong direction for ${dir} entry ${entryPrice.toFixed(5)}, using R:R fallback`);
      takeProfit = dir === 'bullish' ? entryPrice + risk * this.riskRewardRatio : entryPrice - risk * this.riskRewardRatio;
    }

    // Validate SL is in the right direction
    const slValid = (dir === 'bullish' && stopLoss < entryPrice) ||
                    (dir === 'bearish' && stopLoss > entryPrice);
    if (!slValid) {
      if (ictLog) logger.info(`[ICT] SL ${stopLoss.toFixed(5)} wrong direction for ${dir} entry ${entryPrice.toFixed(5)}, using fixed SL`);
      stopLoss = dir === 'bullish' ? entryPrice - risk : entryPrice + risk;
    }

    // Validate entry/SL/TP
    const slRisk = Math.abs(entryPrice - stopLoss);
    const rr = takeProfit !== 0 && slRisk !== 0 ? Math.abs(takeProfit - entryPrice) / slRisk : this.riskRewardRatio;

    // Reject if R:R is too poor — ICT says minimum 2:1 but we use 1.5:1
    if (rr < minRR) {
      if (ictLog) logger.info(`[ICT] ❌ R:R too low: ${rr.toFixed(2)} (need ≥${minRR}) — entry=${entryPrice.toFixed(5)}, SL=${stopLoss.toFixed(5)}, TP=${takeProfit.toFixed(5)}`);
      reasons.push(`R:R ${rr.toFixed(2)} below minimum ${minRR}`);
      return this.invalidEntry(dir, reasons);
    }

    if (ictLog) {
      logger.info(
        `[ICT] ✅ ENTRY: ${dir.toUpperCase()} @ ${entryPrice.toFixed(5)} ` +
        `(M1 confirmation at idx ${confirmIndex}), ` +
        `SL: ${stopLoss.toFixed(5)} (OB edge), TP: ${takeProfit.toFixed(5)} (M15 swing), R:R 1:${rr.toFixed(1)}`
      );
    }

    reasons.push(
      `OB touch → M1 confirmation → entry @ ${entryPrice.toFixed(5)}, ` +
      `SL=${stopLoss.toFixed(5)}, TP=${takeProfit.toFixed(5)} (M15 swing target)`
    );

    return {
      isValid: true,
      direction: dir,
      entryPrice,
      entryType: 'market',
      stopLoss,
      takeProfit,
      riskRewardRatio: rr,
      m1ChoChIndex: confirmIndex,
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
  // detectExternalSwings removed — replaced by multi-stage pipeline:
  // detectRawPivots → compressSameSidePivots → filterMeaningfulSwings → classifyExternalStructure

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
