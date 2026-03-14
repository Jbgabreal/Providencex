/**
 * ICTEntryService - Strict ICT (Inner Circle Trader) Entry Model
 * 
 * Implements the exact ICT model:
 * - H4 (Bias TF): 3-candle pivot swings, BOS, CHoCH for bias determination
 * - M15 (Setup TF): Displacement + FVG + OB setup zone
 * - M1 (Entry TF): Return to zone + CHoCH + refined OB + limit order entry
 * 
 * Pipeline: H4 Bias → M15 Setup → M1 Entry → SL/TP
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { MarketStructureHTF } from './MarketStructureHTF';
import { MarketStructureITF } from './MarketStructureITF';
import { FairValueGapService } from './FairValueGapService';
import { OrderBlockServiceV2 } from './OrderBlockServiceV2';
import { MarketStructureLTF } from './MarketStructureLTF';
import { ICTH4BiasService, ICTH4Bias } from './ICTH4BiasService';
import { SwingPoint, ChoChEvent, BosEvent } from './smc-core/Types';
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
  zoneLow: number;
  zoneHigh: number;
  reasons: string[];
}

export interface ICTEntry {
  isValid: boolean;
  direction: 'bullish' | 'bearish';
  entryPrice: number;
  entryType: 'limit' | 'market'; // ICT uses limit orders at OB open or 50% FVG
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
  private h4BiasService: ICTH4BiasService;
  private m15Structure: MarketStructureITF; // For M15 CHoCH detection
  private m15FvgService: FairValueGapService;
  private m15ObService: OrderBlockServiceV2;
  private m1Structure: MarketStructureLTF;
  private m1ObService: OrderBlockServiceV2;
  private riskRewardRatio: number; // Default 1:3, configurable via SMC_RISK_REWARD

  constructor() {
    // H4 bias service (uses 3-candle pivot)
    this.h4BiasService = new ICTH4BiasService();
    
    // M15 structure service for CHoCH detection + swing points for SL
    // Use fractal/hybrid swings (not strict 3-impulse) to detect more swing points for SL placement
    this.m15Structure = new MarketStructureITF(50, false);
    
    // M15 services for setup zone
    this.m15FvgService = new FairValueGapService(0.0001, 100);
    this.m15ObService = new OrderBlockServiceV2(0.5, 100);
    
    // M1 services for entry refinement
    this.m1Structure = new MarketStructureLTF(20, true);
    this.m1ObService = new OrderBlockServiceV2(0.5, 50);
    
    // Risk-reward ratio (default 1:3)
    this.riskRewardRatio = parseFloat(process.env.SMC_RISK_REWARD || '3');
  }

  /**
   * Main ICT entry pipeline
   * Returns complete ICT analysis: bias, setup zone, and entry
   */
  analyzeICTEntry(
    h4Candles: Candle[],
    m15Candles: Candle[],
    m1Candles: Candle[]
  ): ICTEntryResult {
    const ictLog = process.env.ICT_DEBUG === 'true' || process.env.SMC_DEBUG === 'true';

    // Session filter: only trade during London (08:00-12:00 UTC) and NY (13:00-17:00 UTC) killzones
    // These are the times when institutional order flow is highest and ICT setups are most reliable
    if (m1Candles.length > 0) {
      const lastCandle = m1Candles[m1Candles.length - 1];
      const candleHourUTC = lastCandle.startTime.getUTCHours();
      const isLondonKZ = candleHourUTC >= 7 && candleHourUTC <= 11;  // London killzone 07:00-11:00 UTC
      const isNYKZ = candleHourUTC >= 12 && candleHourUTC <= 16;     // NY killzone 12:00-16:00 UTC
      if (!isLondonKZ && !isNYKZ) {
        return {
          bias: { direction: 'sideways' },
          setupZone: null,
          entry: null,
          setupsDetected: 0,
          entriesTaken: 0,
        };
      }
    }

    // Step 1: Determine H4 Bias
    const bias = this.determineH4Bias(h4Candles);
    if (ictLog) {
      logger.info(`[ICT] H4 Bias: ${bias.direction}${bias.lastChoCh ? ` (CHoCH: ${bias.lastChoCh.fromTrend}→${bias.lastChoCh.toTrend})` : ''}`);
    }
    
    if (bias.direction === 'sideways') {
      if (ictLog) {
        logger.debug('[ICT] No H4 bias - skipping entry analysis');
      }
      return {
        bias,
        setupZone: null,
        entry: null,
        setupsDetected: 0,
        entriesTaken: 0,
      };
    }
    
    // Step 2: Detect M15 Setup Zone
    const setupZone = this.detectM15SetupZone(m15Candles, bias);
    if (ictLog && setupZone.isValid) {
      logger.info(
        `[ICT] M15 Displacement: ${setupZone.hasDisplacement}${setupZone.displacementCandleIndex !== undefined ? ` at index ${setupZone.displacementCandleIndex}` : ''}`
      );
      if (setupZone.fvg) {
        logger.info(`[ICT] M15 FVG detected at ${setupZone.fvg.low.toFixed(2)}-${setupZone.fvg.high.toFixed(2)}`);
      }
      if (setupZone.orderBlock) {
        logger.info(`[ICT] M15 OB validated at ${setupZone.orderBlock.low.toFixed(2)}-${setupZone.orderBlock.high.toFixed(2)}`);
      }
    }
    
    if (!setupZone.isValid) {
      return {
        bias,
        setupZone,
        entry: null,
        setupsDetected: 0,
        entriesTaken: 0,
      };
    }
    
    // Step 3: M1 Entry Refinement
    const entry = this.refineM1Entry(m1Candles, m15Candles, bias, setupZone);
    if (ictLog && entry.isValid) {
      if (entry.m1ChoChIndex !== undefined) {
        logger.info(`[ICT] M1 CHoCH at index ${entry.m1ChoChIndex}`);
      }
      if (entry.refinedOB) {
        logger.info(`[ICT] M1 OB refined entry: price ${entry.entryPrice.toFixed(2)}`);
      }
    }
    
    return {
      bias,
      setupZone,
      entry,
      setupsDetected: setupZone.isValid ? 1 : 0,
      entriesTaken: entry.isValid ? 1 : 0,
    };
  }

  /**
   * Step 1: Determine H4 Bias using 3-candle pivot swings
   * 
   * ICT Rules:
   * - Use 3-candle pivot for swing highs/lows
   * - Bullish bias: price breaks prior swing high (BOS up)
   * - Bearish bias: price breaks prior swing low (BOS down)
   * - CHoCH: reversal of structure (bearish CHoCH breaks swing low in bullish bias)
   */
  private determineH4Bias(h4Candles: Candle[]): ICTBias {
    if (h4Candles.length < 10) {
      return { direction: 'sideways' };
    }

    // Use MarketStructureHTF for consistent H4 bias determination
    // This uses fractal/hybrid swings + BOS + CHoCH + TrendService — the same
    // analysis that produces correct results in the backtest stats.
    const htfAnalysis = new MarketStructureHTF(50);
    const structure = htfAnalysis.analyzeStructure(h4Candles);

    return {
      direction: structure.trend,
      lastChoCh: structure.bosEvents?.filter(e => e.type === 'CHoCH').pop()
        ? {
            index: structure.bosEvents!.filter(e => e.type === 'CHoCH').pop()!.index,
            fromTrend: 'sideways' as any,
            toTrend: structure.trend as any,
            level: structure.bosEvents!.filter(e => e.type === 'CHoCH').pop()!.price,
          }
        : undefined,
      lastBOS: structure.lastBOS
        ? {
            index: structure.lastBOS.index,
            direction: structure.lastBOS.type === 'BOS'
              ? (structure.trend === 'bullish' ? 'bullish' : 'bearish')
              : (structure.trend === 'bullish' ? 'bullish' : 'bearish'),
            level: structure.lastBOS.price,
          }
        : undefined,
      swingHigh: structure.swingHigh,
      swingLow: structure.swingLow,
    };
  }

  /**
   * Step 2: Detect M15 Setup Zone
   * 
   * ICT Rules for Bullish Setup:
   * - Bearish CHoCH forms a displacement leg (structure breaks down)
   * - Displacement candle after CHoCH (body > previous × 1.5)
   * - Clean bearish FVG created during displacement
   * - Valid demand OB before CHoCH (the zone we're returning to)
   * - Return into M15 FVG or M15 OB
   */
  private detectM15SetupZone(m15Candles: Candle[], bias: ICTBias): ICTSetupZone {
    const reasons: string[] = [];
    const ictLog = process.env.ICT_DEBUG === 'true' || process.env.SMC_DEBUG === 'true';
    
    if (m15Candles.length < 20) {
      return {
        isValid: false,
        direction: bias.direction,
        hasDisplacement: false,
        zoneLow: 0,
        zoneHigh: 0,
        reasons: ['Insufficient M15 candles'],
      };
    }
    
    // Step 1: Detect M15 structure event for setup zone
    // Priority: CHoCH (strongest) > MSB > BOS in bias direction (displacement-based)
    const m15Structure = this.m15Structure.analyzeStructure(m15Candles, bias.direction);

    let chochIndex: number | undefined;
    let setupSource: string = 'none';

    if (m15Structure.bosEvents && m15Structure.bosEvents.length > 0) {
      // Priority 1: CHoCH or MSB — strongest signal (structural reversal confirmed)
      const chochOrMsb = m15Structure.bosEvents
        .filter(e => e.type === 'CHoCH' || e.type === 'MSB')
        .sort((a, b) => b.index - a.index)[0];

      if (chochOrMsb) {
        chochIndex = chochOrMsb.index;
        setupSource = chochOrMsb.type;
        if (ictLog) {
          logger.info(`[ICT] M15 ${setupSource} detected at index ${chochIndex} for ${bias.direction} setup`);
        }
      }

      // Priority 2: BOS in the SAME direction as H4 bias
      // This represents a displacement leg — price moved strongly in the bias direction,
      // leaving FVG/OB behind. The setup zone is the FVG/OB that price will return to.
      if (chochIndex === undefined) {
        const biasAlignedBos = m15Structure.bosEvents
          .filter(e => {
            if (e.type !== 'BOS') return false;
            // For bullish H4 bias: we want bullish BOS (price broke above swing high = displacement up)
            // For bearish H4 bias: we want bearish BOS (price broke below swing low = displacement down)
            if (bias.direction === 'bullish') return true; // Any BOS can set up a zone
            if (bias.direction === 'bearish') return true;
            return false;
          })
          .sort((a, b) => b.index - a.index)[0];

        if (biasAlignedBos) {
          chochIndex = biasAlignedBos.index;
          setupSource = 'BOS-displacement';
          if (ictLog) {
            logger.info(`[ICT] M15 BOS-displacement setup at index ${chochIndex} (${biasAlignedBos.type} ${bias.direction})`);
          }
        }
      }
    }

    if (chochIndex === undefined) {
      const reason = m15Structure.bosEvents && m15Structure.bosEvents.length > 0
        ? `No M15 structural event for setup zone (${m15Structure.bosEvents.length} BOS events, but none usable)`
        : 'No M15 BOS events found at all';
      reasons.push(reason);
      if (ictLog) {
        logger.info(`[ICT] ${reason} - BOS events: ${m15Structure.bosEvents?.length || 0}`);
      }
      return {
        isValid: false,
        direction: bias.direction,
        hasDisplacement: false,
        zoneLow: 0,
        zoneHigh: 0,
        reasons,
      };
    }
    
    // Step 2: Find displacement candle AFTER CHoCH (body > previous × 1.5)
    // Only proceed if bias is not sideways
    if (bias.direction === 'sideways') {
      return {
        isValid: false,
        direction: 'sideways',
        hasDisplacement: false,
        zoneLow: 0,
        zoneHigh: 0,
        reasons: ['H4 bias is sideways - cannot determine setup direction'],
      };
    }
    
    // ICT liquidity sweep model:
    // 1. M15 shows a liquidity sweep AGAINST the bias (bullish sweep in bearish market = CHoCH/BOS up)
    // 2. After the sweep, displacement candle fires IN THE BIAS DIRECTION (bearish displacement)
    // 3. This displacement leaves FVG/OB behind = the entry zone
    //
    // So displacement is ALWAYS in the bias direction (confirming smart money took liquidity
    // and is now pushing price back in the trend direction).
    //
    // The findDisplacementCandleAfterCHoCH function uses setupDirection to determine which
    // candle direction to look for:
    //   setupDirection='bullish' → looks for bearish displacement
    //   setupDirection='bearish' → looks for bullish displacement
    // So we FLIP the bias to get the right displacement direction from the function.
    const displacementDirection = (bias.direction === 'bullish' ? 'bearish' : 'bullish') as 'bullish' | 'bearish';

    const displacementCandleIndex = this.findDisplacementCandleAfterCHoCH(
      m15Candles,
      chochIndex,
      displacementDirection
    );
    const hasDisplacement = displacementCandleIndex !== -1;

    if (!hasDisplacement) {
      reasons.push(`No displacement candle found after ${setupSource} (body must be > previous × 1.2)`);
      if (ictLog) {
        logger.info(`[ICT] No displacement detected after ${setupSource} — rejecting M15 setup`);
      }
      return {
        isValid: false,
        direction: bias.direction,
        hasDisplacement: false,
        zoneLow: 0,
        zoneHigh: 0,
        reasons,
      };
    }
    
    if (ictLog) {
      logger.info(`[ICT] M15 Displacement: true at index ${displacementCandleIndex}`);
    }
    
    // Step 4: Detect FVG created DURING displacement leg (between CHoCH and displacement end)
    // Displacement is in the bias direction (bearish displacement for bearish bias).
    // The FVG from this displacement is the entry zone:
    //   Bearish bias → bearish displacement → premium FVG (supply zone to sell into)
    //   Bullish bias → bullish displacement → discount FVG (demand zone to buy into)
    const fvgs = this.m15FvgService.detectFVGs(
      m15Candles.slice(chochIndex, displacementCandleIndex + 5), // Look during displacement leg
      'ITF',
      bias.direction === 'bullish' ? 'discount' : 'premium' // FVG matches bias direction
    );
    
    // Filter FVG by symbol-aware size
    const validFvg = this.filterFVGSymbolAware(fvgs, m15Candles[0]?.symbol || 'XAUUSD');
    
    if (ictLog && validFvg) {
      logger.info(`[ICT] M15 FVG detected at ${validFvg.low.toFixed(2)}-${validFvg.high.toFixed(2)}`);
    }
    
    if (!validFvg) {
      reasons.push('No valid FVG detected during displacement (size-filtered)');
    }
    
    // Step 3: Detect OB BEFORE CHoCH (the demand/supply zone we're returning to)
    // For bullish setup: demand OB (bullish OB) before bearish CHoCH
    // For bearish setup: supply OB (bearish OB) before bullish CHoCH
    const obDirection = bias.direction === 'bullish' ? 'bullish' : 'bearish'; // OB same direction as setup
    const orderBlocks = this.m15ObService.detectOrderBlocks(
      m15Candles.slice(0, chochIndex + 1), // Only look before CHoCH
      'ITF',
      obDirection
    );
    
    // Find valid OB (unmitigated, before CHoCH)
    const validOB = orderBlocks
      .filter(ob => !ob.mitigated && ob.candleIndex < chochIndex)
      .sort((a, b) => b.candleIndex - a.candleIndex)[0]; // Most recent OB before CHoCH
    
    if (!validOB) {
      reasons.push('No valid OB found before displacement');
    }
    
    if (ictLog && validOB) {
      logger.info(`[ICT] M15 OB validated at ${validOB.low.toFixed(2)}-${validOB.high.toFixed(2)}`);
    }
    
    // Determine setup zone - RELAXED: Require at least FVG OR OB (not both)
    let zoneLow = 0;
    let zoneHigh = 0;
    
    // Relaxed requirement: At least one of FVG or OB must exist
    if (!validFvg && !validOB) {
      reasons.push('No valid FVG or OB found - both required for setup zone');
      return {
        isValid: false,
        direction: bias.direction,
        hasDisplacement,
        displacementCandleIndex: hasDisplacement ? displacementCandleIndex : undefined,
        zoneLow: 0,
        zoneHigh: 0,
        reasons,
      };
    }
    
    // ICT: Use FVG or OB (prefer FVG if both exist, otherwise use whichever exists)
    // If both exist and overlap, use the intersection
    // If both exist but don't overlap, use the FVG (ICT prefers FVG)
    if (validFvg && validOB) {
      // Check if they overlap
      const overlapLow = Math.max(validFvg.low, validOB.low);
      const overlapHigh = Math.min(validFvg.high, validOB.high);
      
      if (overlapLow < overlapHigh) {
        // They overlap - use intersection
        zoneLow = overlapLow;
        zoneHigh = overlapHigh;
      } else {
        // They don't overlap - prefer FVG (ICT rule)
        zoneLow = validFvg.low;
        zoneHigh = validFvg.high;
        reasons.push('FVG and OB do not overlap, using FVG zone');
      }
    } else if (validFvg) {
      zoneLow = validFvg.low;
      zoneHigh = validFvg.high;
    } else if (validOB) {
      zoneLow = validOB.low;
      zoneHigh = validOB.high;
    } else {
      reasons.push('Neither FVG nor OB found');
      return {
        isValid: false,
        direction: bias.direction,
        hasDisplacement: true,
        displacementCandleIndex,
        zoneLow: 0,
        zoneHigh: 0,
        reasons,
      };
    }
    
    // Note price distance from zone (for logging only - price-in-zone is checked in M1 entry)
    const currentPrice = m15Candles[m15Candles.length - 1].close;
    if (ictLog) {
      const distanceFromZone = currentPrice < zoneLow
        ? (zoneLow - currentPrice).toFixed(2) + ' below zone'
        : currentPrice > zoneHigh
          ? (currentPrice - zoneHigh).toFixed(2) + ' above zone'
          : 'inside zone';
      logger.info(`[ICT] M15 zone [${zoneLow.toFixed(2)}, ${zoneHigh.toFixed(2)}], current price ${currentPrice.toFixed(2)} (${distanceFromZone})`);
    }

    // Setup is valid when: displacement confirmed + (FVG or OB present).
    // Price-in-zone is checked at M1 entry time (not here) — this allows the zone to be
    // "live" and checked every M1 tick until price returns to the zone or invalidates it.
    const isValid = !!(validFvg || validOB);
    
    return {
      isValid,
      direction: bias.direction,
      hasDisplacement,
      displacementCandleIndex,
      fvg: validFvg || undefined,
      orderBlock: validOB || undefined,
      zoneLow,
      zoneHigh,
      reasons,
    };
  }

  /**
   * Find displacement candle AFTER CHoCH: body > previous body × 1.5
   * 
   * ICT: Displacement occurs after CHoCH, creating the displacement leg
   */
  private findDisplacementCandleAfterCHoCH(
    candles: Candle[],
    chochIndex: number,
    setupDirection: 'bullish' | 'bearish'
  ): number {
    // Look for displacement AFTER CHoCH (within next 10 candles)
    const searchStart = chochIndex + 1;
    const searchEnd = Math.min(chochIndex + 10, candles.length - 1);
    
    for (let i = searchStart; i <= searchEnd; i++) {
      if (i < 1) continue;
      
      const candle = candles[i];
      const prevCandle = candles[i - 1];
      
      const candleBody = Math.abs(candle.close - candle.open);
      const prevBody = Math.abs(prevCandle.close - prevCandle.open);
      
      // Displacement: body must be > previous × 1.2 (relaxed from 1.5)
      if (prevBody > 0 && candleBody > prevBody * 1.2) {
        // Check direction
        const isBullishDisplacement = candle.close > candle.open;
        const isBearishDisplacement = candle.close < candle.open;
        
        // For bullish setup: need bearish displacement (moves down, creates demand zone)
        // For bearish setup: need bullish displacement (moves up, creates supply zone)
        if (setupDirection === 'bullish' && isBearishDisplacement) {
          return i;
        }
        if (setupDirection === 'bearish' && isBullishDisplacement) {
          return i;
        }
      }
    }
    
    return -1;
  }

  /**
   * Filter FVG by symbol-aware size
   * XAUUSD: ~$0.50 minimum, EURUSD: ~10 pips minimum
   */
  private filterFVGSymbolAware(fvgs: any[], symbol: string): { low: number; high: number; index: number } | null {
    if (fvgs.length === 0) return null;
    
    let minSize = 0.0001; // Default
    
    if (symbol === 'XAUUSD' || symbol === 'GOLD') {
      minSize = 0.5; // $0.50 for gold
    } else if (symbol === 'EURUSD' || symbol.includes('USD')) {
      minSize = 0.001; // 10 pips = 0.0010
    }
    
    // Get most recent valid FVG
    const validFvgs = fvgs.filter(fvg => (fvg.high - fvg.low) >= minSize);
    if (validFvgs.length === 0) return null;
    
    // Return most recent
    const mostRecent = validFvgs[validFvgs.length - 1];
    return {
      low: mostRecent.low,
      high: mostRecent.high,
      index: mostRecent.startIndex || 0,
    };
  }

  /**
   * Step 3: M1 Entry Refinement
   * 
   * ICT Rules for Entry:
   * 1. Price trades inside M15 OB/FVG zone
   * 2. Local CHoCH forms on M1
   * 3. M1 forms refined OB in direction of H4 bias
   * 4. Entry at OB open or 50% FVG level (limit order)
   */
  private refineM1Entry(
    m1Candles: Candle[],
    m15Candles: Candle[],
    bias: ICTBias,
    setupZone: ICTSetupZone
  ): ICTEntry {
    const reasons: string[] = [];
    
    if (m1Candles.length < 20) {
      return {
        isValid: false,
        direction: 'bullish', // Default since bias is sideways (early return should handle this)
        entryPrice: 0,
        entryType: 'market',
        stopLoss: 0,
        takeProfit: 0,
        riskRewardRatio: 0,
        reasons: ['Insufficient M1 candles'],
      };
    }
    
    // Early return if bias is sideways
    // Note: This check is redundant since we already check in detectM15SetupZone,
    // but keeping for safety
    if (bias.direction === 'sideways') {
      return {
        isValid: false,
        direction: 'bullish', // Default, but this shouldn't happen
        entryPrice: 0,
        entryType: 'market',
        stopLoss: 0,
        takeProfit: 0,
        riskRewardRatio: 0,
        reasons: ['H4 bias is sideways - cannot determine entry direction'],
      };
    }

    const currentPrice = m1Candles[m1Candles.length - 1].close;

    // ── Premium/Discount zone filter using M15 structural range (fib retracement) ──
    // ICT rule: only BUY in discount (below 50% of M15 range), only SELL in premium (above 50%)
    // The M15 structural range is defined by the recent swing high and swing low on M15
    const recentM15ForPD = m15Candles.slice(-30);
    const m15RangeHigh = Math.max(...recentM15ForPD.map(c => c.high));
    const m15RangeLow = Math.min(...recentM15ForPD.map(c => c.low));
    const m15Equilibrium = (m15RangeHigh + m15RangeLow) / 2; // 50% fib level
    const m15FibOTE = m15RangeLow + (m15RangeHigh - m15RangeLow) * 0.705; // 70.5% OTE level

    const isInDiscount = currentPrice < m15Equilibrium;
    const isInPremium = currentPrice > m15Equilibrium;

    if (bias.direction === 'bullish' && !isInDiscount) {
      const pdMsg = `BUY rejected: price ${currentPrice.toFixed(2)} is NOT in discount zone (equilibrium: ${m15Equilibrium.toFixed(2)}, range: ${m15RangeLow.toFixed(2)}-${m15RangeHigh.toFixed(2)})`;
      reasons.push(pdMsg);
      if (process.env.ICT_DEBUG === 'true') {
        logger.info(`[ICT] ${pdMsg}`);
      }
      return {
        isValid: false,
        direction: bias.direction as 'bullish' | 'bearish',
        entryPrice: 0, entryType: 'market', stopLoss: 0, takeProfit: 0, riskRewardRatio: 0, reasons,
      };
    }
    if (bias.direction === 'bearish' && !isInPremium) {
      const pdMsg = `SELL rejected: price ${currentPrice.toFixed(2)} is NOT in premium zone (equilibrium: ${m15Equilibrium.toFixed(2)}, range: ${m15RangeLow.toFixed(2)}-${m15RangeHigh.toFixed(2)})`;
      reasons.push(pdMsg);
      if (process.env.ICT_DEBUG === 'true') {
        logger.info(`[ICT] ${pdMsg}`);
      }
      return {
        isValid: false,
        direction: bias.direction as 'bullish' | 'bearish',
        entryPrice: 0, entryType: 'market', stopLoss: 0, takeProfit: 0, riskRewardRatio: 0, reasons,
      };
    }

    if (process.env.ICT_DEBUG === 'true') {
      logger.info(`[ICT] PD check passed: ${bias.direction} @ ${currentPrice.toFixed(2)}, EQ=${m15Equilibrium.toFixed(2)}, OTE=${m15FibOTE.toFixed(2)}, range=${m15RangeLow.toFixed(2)}-${m15RangeHigh.toFixed(2)}`);
    }

    // ── Zone proximity check ──
    const zoneSize = setupZone.zoneHigh - setupZone.zoneLow;
    const priceScale = currentPrice * 0.005; // 0.5% of price (~$25 for gold at $5000)
    const zoneBuffer = Math.max(zoneSize * 2.0, priceScale);
    const priceInZone = currentPrice >= (setupZone.zoneLow - zoneBuffer) && currentPrice <= (setupZone.zoneHigh + zoneBuffer);
    if (!priceInZone) {
      reasons.push(`Price ${currentPrice.toFixed(2)} not near M15 zone [${setupZone.zoneLow.toFixed(2)}, ${setupZone.zoneHigh.toFixed(2)}] (buffer: ±${zoneBuffer.toFixed(2)})`);
    }

    // 2. Detect M1 CHoCH or BOS in the bias direction (structure confirmation)
    const m1Structure = this.m1Structure.analyzeStructure(m1Candles, bias.direction);
    let m1ChoChIndex: number | undefined;
    let m1BosIndex: number | undefined;

    if (m1Structure.bosEvents) {
      // First try CHoCH (stronger confirmation)
      const chochEvent = m1Structure.bosEvents
        .filter(e => e.type === 'CHoCH')
        .sort((a, b) => b.index - a.index)[0]; // Most recent CHoCH

      if (chochEvent) {
        m1ChoChIndex = chochEvent.index;
      }

      // Fallback: accept BOS in the bias direction
      if (!m1ChoChIndex) {
        const bosEvent = m1Structure.bosEvents
          .filter(e => e.type === 'BOS')
          .sort((a, b) => b.index - a.index)[0]; // Most recent BOS
        if (bosEvent) {
          m1BosIndex = bosEvent.index;
          reasons.push('Using M1 BOS as confirmation (no CHoCH detected)');
        }
      }
    }

    const hasStructureChange = m1ChoChIndex !== undefined || m1BosIndex !== undefined;

    if (!hasStructureChange) {
      reasons.push('No M1 CHoCH or BOS detected — entry rejected (structure confirmation required)');
    }

    // 3. Detect refined M1 OB in direction of H4 bias
    const m1OrderBlocks = this.m1ObService.detectOrderBlocks(
      m1Candles,
      'LTF',
      bias.direction
    );

    // Find most recent valid OB (unmitigated)
    const refinedOB = m1OrderBlocks
      .filter(ob => !ob.mitigated)
      .sort((a, b) => b.candleIndex - a.candleIndex)[0];

    if (!refinedOB) {
      reasons.push('No refined M1 OB found in bias direction');
    }

    // M1 entry requires:
    // 1. Price in/near the M15 zone (confirmed POI reaction)
    // 2. M1 CHoCH or BOS — confirmation that the zone is holding
    // 3. Refined M1 OB — preferred for entry precision (if not present, enter at zone midpoint)
    const hasRefinedOB = refinedOB !== undefined;

    const isValid = priceInZone && hasStructureChange;
    
    const ictLog = process.env.ICT_DEBUG === 'true' || process.env.SMC_DEBUG === 'true';
    if (ictLog && !isValid) {
      logger.info(`[ICT] M1 Entry validation failed: priceInZone=${priceInZone}, hasStructureChange=${hasStructureChange}, hasRefinedOB=${hasRefinedOB}`);
    }
    
    if (!isValid) {
      // Note: bias.direction cannot be 'sideways' here due to early return check above
      return {
        isValid: false,
        direction: bias.direction, // Already validated as 'bullish' or 'bearish'
        entryPrice: 0,
        entryType: 'market',
        stopLoss: 0,
        takeProfit: 0,
        riskRewardRatio: 0,
        m1ChoChIndex,
        refinedOB,
        reasons,
      };
    }
    
    // Calculate entry price (limit order at OB open or 50% FVG)
    // FALLBACK: Use setup zone if refinedOB is missing
    let entryPrice = 0;
    let entryType: 'limit' | 'market' = 'limit';
    
    if (refinedOB) {
      // PRIMARY: Use refined M1 OB for entry
      if (setupZone.fvg && setupZone.orderBlock) {
        // Use OB open (ICT prefers OB over FVG for entry)
        entryPrice = bias.direction === 'bullish' 
          ? refinedOB.low // Bullish: enter at OB low
          : refinedOB.high; // Bearish: enter at OB high
      } else if (setupZone.orderBlock) {
        entryPrice = bias.direction === 'bullish' 
          ? refinedOB.low 
          : refinedOB.high;
      } else if (setupZone.fvg) {
        // Use 50% of FVG
        const fvgMid = (setupZone.fvg.high + setupZone.fvg.low) / 2;
        entryPrice = fvgMid;
      }
    } else {
      // FALLBACK: Use setup zone midpoint or edge
      if (setupZone.fvg) {
        // Use 50% of FVG
        const fvgMid = (setupZone.fvg.high + setupZone.fvg.low) / 2;
        entryPrice = fvgMid;
        reasons.push('Entry price fallback: Using FVG midpoint');
      } else if (setupZone.orderBlock) {
        // Use OB edge based on direction
        entryPrice = bias.direction === 'bullish'
          ? setupZone.orderBlock.low
          : setupZone.orderBlock.high;
        reasons.push('Entry price fallback: Using setup zone OB edge');
      } else {
        // Last resort: Use zone midpoint
        entryPrice = (setupZone.zoneLow + setupZone.zoneHigh) / 2;
        reasons.push('Entry price fallback: Using setup zone midpoint');
      }
    }
    
    // Validate entry price is valid
    if (entryPrice <= 0) {
      reasons.push(`Invalid entry price calculated: ${entryPrice}`);
      return {
        isValid: false,
        direction: bias.direction as 'bullish' | 'bearish',
        entryPrice: 0,
        entryType: 'market',
        stopLoss: 0,
        takeProfit: 0,
        riskRewardRatio: 0,
        m1ChoChIndex,
        refinedOB,
        reasons,
      };
    }
    
    // Determine entry type based on strategy logic:
    // - Buy Limit: Price needs to come DOWN to entry area (entry < current price)
    // - Sell Limit: Price needs to go UP to entry area (entry > current price)
    // - Market: Entry is very close to current price (within 0.05% for immediate execution)
    const priceDiff = Math.abs(entryPrice - currentPrice);
    const priceDiffPercent = (priceDiff / currentPrice) * 100;
    
    if (priceDiffPercent < 0.05) {
      // Entry is very close to current price - use market order
      entryType = 'market';
      reasons.push(`Entry price (${entryPrice.toFixed(2)}) is very close to current price (${currentPrice.toFixed(2)}), using market order`);
    } else if (bias.direction === 'bullish') {
      // Bullish setup: Use Buy Limit if entry is below current price (price needs to come down)
      // Use Buy Stop if entry is above current price (price needs to break up)
      if (entryPrice < currentPrice) {
        entryType = 'limit'; // Buy Limit: waiting for price to come down to entry
        reasons.push(`Buy Limit: Entry (${entryPrice.toFixed(2)}) < Current (${currentPrice.toFixed(2)}), price should come down to entry`);
      } else {
        entryType = 'limit'; // Still use limit, but it's a Buy Stop (entry above current)
        // Note: MT5 will handle this as Buy Stop based on entry > current ask
        reasons.push(`Buy Stop: Entry (${entryPrice.toFixed(2)}) > Current (${currentPrice.toFixed(2)}), price should break up to entry`);
      }
    } else {
      // Bearish setup: Use Sell Limit if entry is above current price (price needs to go up)
      // Use Sell Stop if entry is below current price (price needs to break down)
      if (entryPrice > currentPrice) {
        entryType = 'limit'; // Sell Limit: waiting for price to go up to entry
        reasons.push(`Sell Limit: Entry (${entryPrice.toFixed(2)}) > Current (${currentPrice.toFixed(2)}), price should go up to entry`);
      } else {
        entryType = 'limit'; // Still use limit, but it's a Sell Stop (entry below current)
        // Note: MT5 will handle this as Sell Stop based on entry < current bid
        reasons.push(`Sell Stop: Entry (${entryPrice.toFixed(2)}) < Current (${currentPrice.toFixed(2)}), price should break down to entry`);
      }
    }
    
    // Calculate SL: Use M15 structural swing low/high as the SL level
    // ICT model: SL goes beyond the most recent M15 swing point that invalidates the setup
    //   BUY: SL below the nearest M15 swing LOW below entry (if price breaks this, setup is invalid)
    //   SELL: SL above the nearest M15 swing HIGH above entry (if price breaks this, setup is invalid)
    let stopLoss = 0;
    const symbolType = m1Candles[0]?.symbol || 'XAUUSD';

    // Buffer beyond the swing point (gives room for wicks without invalidating)
    let slBuffer: number;
    let minSlDistance: number; // Minimum SL distance to avoid instant SL hits
    let maxSlDistance: number; // Maximum SL distance to avoid oversized risk
    if (symbolType === 'XAUUSD' || symbolType === 'GOLD') {
      slBuffer = 2.0;       // $2 buffer beyond M15 swing for gold
      minSlDistance = 15.0;  // Minimum $15 SL distance — gold needs room for wicks
      maxSlDistance = 50.0;  // Maximum $50 SL distance
    } else if (symbolType.includes('USD') || symbolType === 'EURUSD' || symbolType === 'GBPUSD') {
      slBuffer = 0.0003;    // 3 pips buffer for forex
      minSlDistance = 0.001; // 10 pips minimum
      maxSlDistance = 0.005; // 50 pips maximum
    } else {
      slBuffer = 1.0;
      minSlDistance = 5.0;
      maxSlDistance = 30.0;
    }

    // Use M15 structural swing highs/lows for SL placement
    // These are the proper swing points from the MarketStructureITF analysis
    const m15StructureForSL = this.m15Structure.analyzeStructure(m15Candles, bias.direction);
    const m15SwingHighs = m15StructureForSL.swingHighs || [];
    const m15SwingLows = m15StructureForSL.swingLows || [];

    if (bias.direction === 'bullish') {
      // BUY: SL below the nearest M15 structural swing low below entry
      const supportLevels = m15SwingLows
        .filter(l => l < entryPrice)
        .sort((a, b) => b - a); // Nearest first (highest swing low below entry)

      if (supportLevels.length > 0) {
        stopLoss = supportLevels[0] - slBuffer;
        reasons.push(`SL from M15 swing low: ${supportLevels[0].toFixed(2)} - buffer ${slBuffer}`);
      } else {
        // Fallback: use the absolute low of recent M15 candles
        const absLow = Math.min(...m15Candles.slice(-30).map(c => c.low));
        stopLoss = absLow - slBuffer;
        reasons.push(`SL fallback: M15 absolute low ${absLow.toFixed(2)} - buffer ${slBuffer}`);
      }

      // Enforce min/max SL distance
      const slDist = entryPrice - stopLoss;
      if (slDist < minSlDistance) {
        stopLoss = entryPrice - minSlDistance;
        reasons.push(`SL adjusted to minimum: $${minSlDistance}`);
      } else if (slDist > maxSlDistance) {
        stopLoss = entryPrice - maxSlDistance;
        reasons.push(`SL capped at maximum: $${maxSlDistance}`);
      }
    } else {
      // SELL: SL above the nearest M15 structural swing high above entry
      const resistanceLevels = m15SwingHighs
        .filter(h => h > entryPrice)
        .sort((a, b) => a - b); // Nearest first (lowest swing high above entry)

      if (resistanceLevels.length > 0) {
        stopLoss = resistanceLevels[0] + slBuffer;
        reasons.push(`SL from M15 swing high: ${resistanceLevels[0].toFixed(2)} + buffer ${slBuffer}`);
      } else {
        // Fallback: use the absolute high of recent M15 candles
        const absHigh = Math.max(...m15Candles.slice(-30).map(c => c.high));
        stopLoss = absHigh + slBuffer;
        reasons.push(`SL fallback: M15 absolute high ${absHigh.toFixed(2)} + buffer ${slBuffer}`);
      }

      // Enforce min/max SL distance
      const slDist = stopLoss - entryPrice;
      if (slDist < minSlDistance) {
        stopLoss = entryPrice + minSlDistance;
        reasons.push(`SL adjusted to minimum: $${minSlDistance}`);
      } else if (slDist > maxSlDistance) {
        stopLoss = entryPrice + maxSlDistance;
        reasons.push(`SL capped at maximum: $${maxSlDistance}`);
      }
    }

    if (process.env.ICT_DEBUG === 'true') {
      logger.info(`[ICT] ${symbolType}: SL=${stopLoss.toFixed(2)}, Entry=${entryPrice.toFixed(2)}, Distance=${Math.abs(entryPrice - stopLoss).toFixed(2)}, Direction=${bias.direction}`);
    }
    
    // Validate stop loss is valid (not zero, not same as entry, and in correct direction)
    const slDistance = Math.abs(entryPrice - stopLoss);
    const isSlValid = stopLoss > 0 &&
                     slDistance >= slBuffer &&
                     ((bias.direction === 'bullish' && stopLoss < entryPrice) ||
                      (bias.direction === 'bearish' && stopLoss > entryPrice));
    
    if (!isSlValid) {
      const errorMsg = `Invalid stop loss calculated: ${stopLoss.toFixed(2)} (entry: ${entryPrice.toFixed(2)}, direction: ${bias.direction})`;
      reasons.push(errorMsg);
      logger.error(`[ICT] ${symbolType}: ${errorMsg}`);
      return {
        isValid: false,
        direction: bias.direction as 'bullish' | 'bearish',
        entryPrice,
        entryType,
        stopLoss: 0,
        takeProfit: 0,
        riskRewardRatio: 0,
        m1ChoChIndex,
        refinedOB,
        reasons,
      };
    }
    
    // Calculate TP: SL × risk-reward ratio (default 1:3)
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = risk * this.riskRewardRatio;
    const takeProfit = bias.direction === 'bullish'
      ? entryPrice + reward
      : entryPrice - reward;
    
    const riskRewardRatio = risk > 0 ? reward / risk : 0;
    
    reasons.push('All ICT entry requirements met');
    
    return {
      isValid: true,
      direction: bias.direction as 'bullish' | 'bearish', // Already checked for sideways above
      entryPrice,
      entryType,
      stopLoss,
      takeProfit,
      riskRewardRatio,
      m1ChoChIndex,
      refinedOB,
      reasons,
    };
  }
}

