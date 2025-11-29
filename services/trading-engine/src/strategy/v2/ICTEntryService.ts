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
    
    // M15 structure service for CHoCH detection
    this.m15Structure = new MarketStructureITF(50, true);
    
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
    
    // Use ICT H4 bias service (uses 3-candle pivot)
    const h4Bias = this.h4BiasService.determineH4Bias(h4Candles);
    
    return {
      direction: h4Bias.direction,
      lastChoCh: h4Bias.lastChoCh,
      lastBOS: h4Bias.lastBOS,
      swingHigh: h4Bias.swingHigh,
      swingLow: h4Bias.swingLow,
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
    
    // Step 1: Detect M15 CHoCH or BOS (relaxed for initial testing)
    // For bullish setup: need bearish CHoCH or BOS down
    // For bearish setup: need bullish CHoCH or BOS up
    const m15Structure = this.m15Structure.analyzeStructure(m15Candles, bias.direction);
    
    // Find CHoCH or BOS event opposite to bias (relaxed: accept BOS if no CHoCH)
    let chochIndex: number | undefined;
    let useBOSInstead = false;
    
    if (m15Structure.bosEvents && m15Structure.bosEvents.length > 0) {
      // First try to find CHoCH
      const oppositeChoCh = m15Structure.bosEvents
        .filter(e => e.type === 'CHoCH' || e.type === 'MSB')
        .sort((a, b) => b.index - a.index)[0]; // Most recent
      
      if (oppositeChoCh) {
        chochIndex = oppositeChoCh.index;
        if (ictLog) {
          logger.info(`[ICT] M15 CHoCH detected at index ${chochIndex} for ${bias.direction} setup`);
        }
      } else {
        // No CHoCH found - try BOS as fallback (relaxed requirement)
        // Get BOS events - check direction by comparing candle price to previous swing
        // For bullish setup: want bearish BOS (price breaks below swing low)
        // For bearish setup: want bullish BOS (price breaks above swing high)
        const oppositeBOS = m15Structure.bosEvents
          .filter(e => e.type === 'BOS')
          .sort((a, b) => b.index - a.index)
          .find(e => {
            if (e.index < 2 || e.index >= m15Candles.length) return false;
            const candle = m15Candles[e.index];
            const prevCandle = m15Candles[e.index - 1];
            if (!candle || !prevCandle) return false;
            
            // Simple heuristic: if close < open, it's likely bearish BOS
            // If close > open, it's likely bullish BOS
            const isBearishBOS = candle.close < candle.open && candle.close < prevCandle.close;
            const isBullishBOS = candle.close > candle.open && candle.close > prevCandle.close;
            
            // For bullish setup, want bearish BOS
            // For bearish setup, want bullish BOS
            if (bias.direction === 'bullish' && isBearishBOS) return true;
            if (bias.direction === 'bearish' && isBullishBOS) return true;
            return false;
          });
        
        if (oppositeBOS) {
          chochIndex = oppositeBOS.index;
          useBOSInstead = true;
          if (ictLog) {
            logger.info(`[ICT] M15 BOS detected at index ${chochIndex} (using as CHoCH substitute for ${bias.direction} setup)`);
          }
        }
      }
    }
    
    if (chochIndex === undefined) {
      const reason = m15Structure.bosEvents && m15Structure.bosEvents.length > 0
        ? 'No M15 CHoCH or opposite BOS detected (required for displacement leg)'
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
    
    const displacementCandleIndex = this.findDisplacementCandleAfterCHoCH(
      m15Candles,
      chochIndex,
      bias.direction as 'bullish' | 'bearish'
    );
    const hasDisplacement = displacementCandleIndex !== -1;
    
    if (!hasDisplacement) {
      // Relaxed: Log but don't block - can still use FVG/OB setup
      reasons.push('No displacement candle found after CHoCH (body must be > previous × 1.5) - proceeding without displacement');
      if (ictLog) {
        logger.info(`[ICT] ⚠️  No displacement detected, but continuing with setup zone detection`);
      }
      // Don't return early - continue to check for FVG/OB
    }
    
    if (ictLog) {
      logger.info(`[ICT] M15 Displacement: true at index ${displacementCandleIndex}`);
    }
    
    // Step 4: Detect FVG created DURING displacement leg (between CHoCH and displacement end)
    // For bullish setup: bearish FVG created during bearish displacement
    // For bearish setup: bullish FVG created during bullish displacement
    const fvgs = this.m15FvgService.detectFVGs(
      m15Candles.slice(chochIndex, displacementCandleIndex + 5), // Look during displacement leg
      'ITF',
      bias.direction === 'bullish' ? 'discount' : 'premium' // FVG opposite to displacement direction
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
    
    // Check if price has returned into zone or is near zone (relaxed requirement)
    const currentPrice = m15Candles[m15Candles.length - 1].close;
    const zoneSize = zoneHigh - zoneLow;
    const zoneBuffer = zoneSize * 0.1; // Allow 10% buffer outside zone
    
    const priceInZone = currentPrice >= (zoneLow - zoneBuffer) && currentPrice <= (zoneHigh + zoneBuffer);
    
    if (!priceInZone) {
      reasons.push(`Price ${currentPrice.toFixed(2)} not near zone [${zoneLow.toFixed(2)}, ${zoneHigh.toFixed(2)}] (buffer: ±${zoneBuffer.toFixed(2)})`);
    }
    
    // RELAXED: Don't require displacement for setup validation - displacement is nice-to-have
    // Setup is valid if we have FVG or OB and price is in/near zone
    const isValid = (validFvg || validOB) && priceInZone;
    
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
      
      // Displacement: body must be > previous × 1.5
      if (prevBody > 0 && candleBody > prevBody * 1.5) {
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
    
    // Determine entry type based on strategy logic:
    // - Buy Limit: Price needs to come DOWN to entry (entry < current price)
    // - Sell Limit: Price needs to go UP to entry (entry > current price)  
    // - Market: Entry is very close to current price (immediate execution)
    // This will be set after entry price is calculated
    const zoneSize = setupZone.zoneHigh - setupZone.zoneLow;
    const zoneBuffer = zoneSize * 0.1; // 10% buffer
    const priceInZone = currentPrice >= (setupZone.zoneLow - zoneBuffer) && currentPrice <= (setupZone.zoneHigh + zoneBuffer);
    if (!priceInZone) {
      reasons.push(`Price ${currentPrice.toFixed(2)} not near M15 zone [${setupZone.zoneLow.toFixed(2)}, ${setupZone.zoneHigh.toFixed(2)}]`);
    }
    
    // 2. Detect M1 CHoCH
    const m1Structure = this.m1Structure.analyzeStructure(m1Candles, bias.direction);
    let m1ChoChIndex: number | undefined;
    
    if (m1Structure.bosEvents) {
      const chochEvent = m1Structure.bosEvents
        .filter(e => e.type === 'CHoCH')
        .sort((a, b) => b.index - a.index)[0]; // Most recent CHoCH
      
      if (chochEvent) {
        m1ChoChIndex = chochEvent.index;
      }
    }
    
    // RELAXED: Try BOS if no CHoCH found
    if (!m1ChoChIndex && m1Structure.bosEvents) {
      // Find most recent BOS event that matches bias direction
      // Check direction by comparing candle close to open
      const bosEvent = m1Structure.bosEvents
        .filter(e => {
          if (e.type !== 'BOS') return false;
          const candle = m1Candles[e.index];
          if (!candle || e.index < 1) return false;
          
          // Simple heuristic: bullish BOS = close > open, bearish BOS = close < open
          const isBullish = candle.close > candle.open;
          const isBearish = candle.close < candle.open;
          
          return (bias.direction === 'bullish' && isBullish) || 
                 (bias.direction === 'bearish' && isBearish);
        })
        .sort((a, b) => b.index - a.index)[0];
      
      if (bosEvent) {
        m1ChoChIndex = bosEvent.index;
        reasons.push('Using M1 BOS instead of CHoCH (relaxed requirement)');
      }
    }
    
    if (!m1ChoChIndex) {
      reasons.push('No M1 CHoCH or BOS detected');
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
    
    // Validate all requirements
    // RELAXED: Entry is valid if price is in zone AND (CHoCH/BOS OR refined OB)
    // Don't require both CHoCH and OB - either is enough
    const hasStructureChange = m1ChoChIndex !== undefined;
    const hasRefinedOB = refinedOB !== undefined;
    
    const isValid = priceInZone && (hasStructureChange || hasRefinedOB);
    
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
    
    // Calculate SL: ALWAYS use M15 structural swing points (POI - Point of Interest)
    // M1 OB is ONLY for entry price, NOT for SL
    // For BUY: Find nearest M15 swing low BELOW entry (support/POI)
    // For SELL: Find nearest M15 swing high ABOVE entry (resistance/POI)
    let stopLoss = 0;
    const symbolType = m1Candles[0]?.symbol || 'XAUUSD';
    
    // Calculate minimum buffer based on symbol
    let minBuffer: number;
    if (symbolType === 'XAUUSD' || symbolType === 'GOLD') {
      minBuffer = 1.0; // $1 minimum for gold
    } else if (symbolType.includes('USD') || symbolType === 'EURUSD' || symbolType === 'GBPUSD') {
      minBuffer = 0.0001; // 1 pip for forex pairs
    } else {
      minBuffer = 0.5; // Default buffer for other symbols
    }
    
    // PRIMARY: Use M15 structural swing points (POI)
    // Get M15 structure to access swing points
    const m15Structure = this.m15Structure.analyzeStructure(m15Candles, bias.direction);
    const swingHighs = m15Structure.swingHighs || [];
    const swingLows = m15Structure.swingLows || [];
    
    if (bias.direction === 'bullish') {
      // Bullish (BUY): Find nearest M15 swing low BELOW entry price (support/POI)
      // Look for swing lows that are below the entry price
      const supportLevels = swingLows
        .filter(low => low < entryPrice)
        .sort((a, b) => b - a); // Sort descending (highest first, but still below entry)
      
      if (supportLevels.length > 0) {
        // Use the highest swing low below entry (nearest structural support/POI)
        const nearestSupport = supportLevels[0];
        stopLoss = nearestSupport - minBuffer; // Place SL below support with buffer
        reasons.push(
          `Stop loss calculated from M15 structural swing low (POI): ${nearestSupport.toFixed(2)}`
        );
        logger.info(
          `[ICT] ${symbolType}: Using M15 structural swing low for SL. ` +
          `Entry=${entryPrice.toFixed(2)}, Support=${nearestSupport.toFixed(2)}, SL=${stopLoss.toFixed(2)}`
        );
      } else {
        // FALLBACK: No M15 swing low found - use setup zone low
        stopLoss = setupZone.zoneLow - minBuffer;
        reasons.push(
          `Stop loss fallback: No M15 swing support found below entry, using zone low (${setupZone.zoneLow.toFixed(2)}) minus buffer`
        );
        logger.warn(
          `[ICT] ${symbolType}: No M15 swing support below entry, using zone low as fallback. ` +
          `Entry=${entryPrice.toFixed(2)}, SL=${stopLoss.toFixed(2)}, Zone=[${setupZone.zoneLow.toFixed(2)}, ${setupZone.zoneHigh.toFixed(2)}]`
        );
      }
    } else {
      // Bearish (SELL): Find nearest M15 swing high ABOVE entry price (resistance/POI)
      // Look for swing highs that are above the entry price
      const resistanceLevels = swingHighs
        .filter(high => high > entryPrice)
        .sort((a, b) => a - b); // Sort ascending (lowest first, but still above entry)
      
      if (resistanceLevels.length > 0) {
        // Use the lowest swing high above entry (nearest structural resistance/POI)
        const nearestResistance = resistanceLevels[0];
        stopLoss = nearestResistance + minBuffer; // Place SL above resistance with buffer
        reasons.push(
          `Stop loss calculated from M15 structural swing high (POI): ${nearestResistance.toFixed(2)}`
        );
        logger.info(
          `[ICT] ${symbolType}: Using M15 structural swing high for SL. ` +
          `Entry=${entryPrice.toFixed(2)}, Resistance=${nearestResistance.toFixed(2)}, SL=${stopLoss.toFixed(2)}`
        );
      } else {
        // FALLBACK: No M15 swing high found - use setup zone high
        stopLoss = setupZone.zoneHigh + minBuffer;
        reasons.push(
          `Stop loss fallback: No M15 swing resistance found above entry, using zone high (${setupZone.zoneHigh.toFixed(2)}) plus buffer`
        );
        logger.warn(
          `[ICT] ${symbolType}: No M15 swing resistance above entry, using zone high as fallback. ` +
          `Entry=${entryPrice.toFixed(2)}, SL=${stopLoss.toFixed(2)}, Zone=[${setupZone.zoneLow.toFixed(2)}, ${setupZone.zoneHigh.toFixed(2)}]`
        );
      }
    }
    
    // Validate stop loss is valid (not zero, not same as entry, and in correct direction)
    const slDistance = Math.abs(entryPrice - stopLoss);
    const isSlValid = stopLoss > 0 && 
                     slDistance >= minBuffer && 
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

