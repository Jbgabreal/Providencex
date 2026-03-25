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
    // Still compute H4 bias even outside sessions (for Engine Monitor visibility)
    // but block actual entries outside kill zones
    let outsideKillZone = false;
    if (m1Candles.length > 0) {
      const lastCandle = m1Candles[m1Candles.length - 1];
      const hour = lastCandle.startTime.getUTCHours();
      const isLondonKZ = hour >= 7 && hour <= 11;
      const isNYKZ = hour >= 12 && hour <= 16;
      outsideKillZone = !isLondonKZ && !isNYKZ;
      if (outsideKillZone && ictLog) {
        logger.info(`[ICT] Outside kill zone (hour=${hour} UTC) — will compute bias but block entries`);
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

    // Block entries outside kill zones (but bias was still computed above)
    if (outsideKillZone) {
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
   * Multi-stage H4 bias engine:
   *   Stage 1: Raw pivot detection (price-based, no candle color)
   *   Stage 2: Compress consecutive same-side pivots (keep extreme)
   *   Stage 3: Filter insignificant pivots (ATR-based threshold)
   *   Stage 4: Classify HH/HL/LH/LL → bullish/bearish/neutral
   */
  private determineH4Bias(h4Candles: Candle[]): ICTBias {
    const ictLog = true; // Always log for debugging

    // Log candle data verification
    logger.info(`[H4-BIAS] Entry: ${h4Candles.length} candles, first.high=${h4Candles[0]?.high}, first.startTime=${h4Candles[0]?.startTime}, type=${typeof h4Candles[0]?.high}`);

    if (h4Candles.length < 5) {
      logger.info(`[H4-BIAS] Insufficient candles: ${h4Candles.length} (need ≥5)`);
      return { direction: 'sideways' };
    }

    // ── Stage 1: Raw pivot detection ──
    const rawPivots = this.detectRawPivots(h4Candles, 2);
    if (ictLog) {
      logger.info(`[H4-BIAS] Stage 1 — Raw pivots: ${rawPivots.length} (from ${h4Candles.length} candles)`);
      for (const p of rawPivots) {
        logger.info(`  [RAW] idx=${p.index} ${p.type} ${p.price.toFixed(2)}`);
      }
    }

    // ── Stage 2: Compress same-side pivots ──
    const compressed = this.compressSameSidePivots(rawPivots);
    if (ictLog) {
      logger.info(`[H4-BIAS] Stage 2 — Compressed: ${compressed.length} (was ${rawPivots.length})`);
      for (const p of compressed) {
        logger.info(`  [COMPRESSED] idx=${p.index} ${p.type} ${p.price.toFixed(2)}`);
      }
    }

    // ── Stage 3: Skip ATR filter for now — use all compressed pivots ──
    // (ATR filter was removing valid swings; will revisit after bias is working)
    const meaningful = compressed;
    if (ictLog) {
      logger.info(`[H4-BIAS] Stage 3 — SKIPPED ATR filter, using all ${meaningful.length} compressed swings`);
    }

    // ── Stage 4: Classify external structure ──
    const result = this.classifyExternalStructure(meaningful, ictLog);
    if (ictLog) {
      logger.info(`[H4-BIAS] Stage 4 — Swing-structure bias: ${result.direction}`);
    }

    // ── Stage 5: Displacement fallback if still sideways ──
    // Use simple close-vs-open analysis across last N candles
    if (result.direction === 'sideways') {
      const fallback = this.displacementFallback(h4Candles, ictLog);
      if (fallback.direction !== 'sideways') {
        if (ictLog) {
          logger.info(`[H4-BIAS] Stage 5 — Displacement fallback: ${fallback.direction}`);
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
    const lookback = Math.min(candles.length, 20);
    const recent = candles.slice(-lookback);

    let highest = -Infinity, lowest = Infinity;
    for (const c of recent) {
      if (c.high > highest) highest = c.high;
      if (c.low < lowest) lowest = c.low;
    }

    const range = highest - lowest;
    if (range === 0) return { direction: 'sideways' };

    const mid = (highest + lowest) / 2;
    const lastClose = recent[recent.length - 1].close;
    const firstOpen = recent[0].open;

    // Price is in upper 40% of range AND trending up → bullish
    // Price is in lower 40% of range AND trending down → bearish
    const positionInRange = (lastClose - lowest) / range;
    const trendUp = lastClose > firstOpen;

    if (log) {
      logger.info(`[H4-BIAS] Displacement: pos=${(positionInRange * 100).toFixed(1)}%, close=${lastClose.toFixed(2)}, mid=${mid.toFixed(2)}, range=${range.toFixed(2)}, trendUp=${trendUp}`);
    }

    if (positionInRange > 0.6 && trendUp) {
      return { direction: 'bullish', swingHigh: highest, swingLow: lowest };
    } else if (positionInRange < 0.4 && !trendUp) {
      return { direction: 'bearish', swingHigh: highest, swingLow: lowest };
    }

    // Even more lenient: just use which side of midpoint we're on
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
      return { isValid: false, direction: bias.direction, hasDisplacement: false, zoneLow: 0, zoneHigh: 0, reasons: ['Insufficient M15 candles'] };
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
    const fallbackService = new SwingService({ method: 'luxalgo', pivotLeft: 10 });
    const allSwings = fallbackService.detectSwings(m15Candles);
    const swingHighs = allSwings.filter(s => s.type === 'high').sort((a, b) => a.index - b.index);
    const swingLows = allSwings.filter(s => s.type === 'low').sort((a, b) => a.index - b.index);

    if (swingHighs.length < 2 || swingLows.length < 2) {
      reasons.push(`Not enough M15 swings: ${swingHighs.length} highs, ${swingLows.length} lows`);
      return { isValid: false, direction: bias.direction, hasDisplacement: false, zoneLow: 0, zoneHigh: 0, reasons };
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
      reasons.push(`No M15 MSB in ${bias.direction} direction (bullishHH=${bullishMSB}, bearishLL=${bearishMSB})`);
      if (ictLog) logger.info(`[ICT] No M15 ${bias.direction} MSB — HH=${bullishMSB}, LL=${bearishMSB}`);
      return { isValid: false, direction: bias.direction, hasDisplacement: false, zoneLow: 0, zoneHigh: 0, reasons };
    }

    if (ictLog) {
      logger.info(`[ICT] M15 ${bias.direction} MSB confirmed — ${bias.direction === 'bullish' ? `HH: ${prevSH.price.toFixed(5)} → ${lastSH.price.toFixed(5)}` : `LL: ${prevSL.price.toFixed(5)} → ${lastSL.price.toFixed(5)}`}`);
    }

    // 3. Find Order Block: last opposing candle before the MSB impulse
    // Bullish OB: scan backward from the swing high to find the last BEARISH candle (open > close)
    // Bearish OB: scan backward from the swing low to find the last BULLISH candle (open < close)
    let obHigh = 0;
    let obLow = 0;
    let obFound = false;
    let obIndex = -1;

    if (bias.direction === 'bullish') {
      // Scan from the MSB swing high backward to find the last bearish candle
      const scanStart = Math.min(lastSH.index, m15Candles.length - 1);
      const scanEnd = Math.max(prevSL.index, 0); // Back to the prior swing low
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
      // Scan from the MSB swing low backward to find the last bullish candle
      const scanStart = Math.min(lastSL.index, m15Candles.length - 1);
      const scanEnd = Math.max(prevSH.index, 0); // Back to the prior swing high
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
      return { isValid: false, direction: bias.direction, hasDisplacement: false, zoneLow: 0, zoneHigh: 0, reasons };
    }

    // 4. Check OB invalidation (PineScript: close < bottom invalidates bullish OB)
    const currentPrice = m15Candles[m15Candles.length - 1].close;
    if (bias.direction === 'bullish' && currentPrice < obLow) {
      // Bullish OB broken — price closed below it
      reasons.push(`Bullish OB invalidated: price ${currentPrice.toFixed(5)} < OB low ${obLow.toFixed(5)}`);
      return { isValid: false, direction: bias.direction, hasDisplacement: true, zoneLow: obLow, zoneHigh: obHigh, reasons };
    }
    if (bias.direction === 'bearish' && currentPrice > obHigh) {
      // Bearish OB broken — price closed above it
      reasons.push(`Bearish OB invalidated: price ${currentPrice.toFixed(5)} > OB high ${obHigh.toFixed(5)}`);
      return { isValid: false, direction: bias.direction, hasDisplacement: true, zoneLow: obLow, zoneHigh: obHigh, reasons };
    }

    // 5. Check if price is at or near the Order Block zone
    const obRange = obHigh - obLow;
    const obBuffer = obRange * 0.5; // 50% buffer around OB

    // For bullish: price should be in or near the OB (retracing down to it)
    // For bearish: price should be in or near the OB (retracing up to it)
    let inOB = false;
    if (bias.direction === 'bullish') {
      inOB = currentPrice <= (obHigh + obBuffer) && currentPrice >= (obLow - obBuffer);
    } else {
      inOB = currentPrice >= (obLow - obBuffer) && currentPrice <= (obHigh + obBuffer);
    }

    if (ictLog) {
      logger.info(
        `[ICT] M15 OB: ${obLow.toFixed(5)}-${obHigh.toFixed(5)} (idx=${obIndex}), ` +
        `price: ${currentPrice.toFixed(5)}, inOB: ${inOB}, ` +
        `swingHighs: ${swingHighs.length}, swingLows: ${swingLows.length}`
      );
    }

    if (!inOB) {
      // Even if not in OB, check if price is in the discount/premium half of the recent range
      // This is the "equilibrium" approach — above/below 50% of the impulse leg
      const impulseHigh = bias.direction === 'bullish' ? lastSH.price : prevSH.price;
      const impulseLow = bias.direction === 'bullish' ? prevSL.price : lastSL.price;
      const equilibrium = (impulseHigh + impulseLow) / 2;

      const inDiscount = bias.direction === 'bullish' && currentPrice <= equilibrium;
      const inPremium = bias.direction === 'bearish' && currentPrice >= equilibrium;

      if (inDiscount || inPremium) {
        if (ictLog) logger.info(`[ICT] M15 price not in OB but in ${inDiscount ? 'discount' : 'premium'} zone (eq=${equilibrium.toFixed(5)})`);
        // Accept — price is at least in the right zone
      } else {
        reasons.push(
          `Price ${currentPrice.toFixed(5)} not in OB [${obLow.toFixed(5)}, ${obHigh.toFixed(5)}] ` +
          `or ${bias.direction === 'bullish' ? 'discount' : 'premium'} zone (eq=${equilibrium.toFixed(5)})`
        );
        return { isValid: false, direction: bias.direction, hasDisplacement: true, zoneLow: obLow, zoneHigh: obHigh, reasons };
      }
    }

    reasons.push(`M15 MSB confirmed + price in ${inOB ? 'Order Block' : 'equilibrium'} zone`);

    return {
      isValid: true,
      direction: bias.direction,
      hasDisplacement: true,
      displacementCandleIndex: obIndex,
      zoneLow: obLow,
      zoneHigh: obHigh,
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
