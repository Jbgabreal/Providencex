/**
 * M1ExecutionService - Executes trades on M1 when price is in M15 setup zone and micro CHoCH/MSB occurs
 * 
 * This service handles the final execution logic on M1 timeframe.
 */

import { Logger, getNowInPXTimezone } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { MarketStructureLTF } from './MarketStructureLTF';
import { HTFBiasResult } from './HTFBiasService';
import { ITFSetupZone } from './ITFSetupZoneService';
import { EnhancedRawSignalV2 } from '@providencex/shared-types';

const logger = new Logger('M1ExecutionService');

export interface M1ExecutionResult {
  shouldEnter: boolean;
  direction?: 'buy' | 'sell';
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  reason?: string;
  microChoch?: {
    type: 'CHoCH' | 'MSB' | 'BOS';
    index: number;
    price: number;
  };
}

/**
 * POI (Point of Interest) for stop loss placement
 */
interface POI {
  price: number;
  type: 'swing' | 'ob_origin' | 'pd_boundary' | 'displacement_wick' | 'structural_level';
  reason: string;
  strength: number; // 1-10, higher is stronger POI
}

export class M1ExecutionService {
  private ltfStructure: MarketStructureLTF;
  private riskRewardRatio: number;
  private slBuffer: number; // Buffer beyond POI for stop loss

  constructor(riskRewardRatio: number = 0.0010) {
    this.ltfStructure = new MarketStructureLTF(20);
    this.riskRewardRatio = riskRewardRatio;
    // SL buffer: small distance beyond POI (configurable via env)
    this.slBuffer = parseFloat(process.env.SL_POI_BUFFER || '0.0010');
    logger.info(`[M1ExecutionService] ✅ Initialized with R:R = 1:${riskRewardRatio} (targeting ${riskRewardRatio}R profit per trade)`);
    logger.info(`[M1ExecutionService] POI-anchored SL buffer: ${this.slBuffer}`);
  }

  /**
   * Validate entry quality against ICT/SMC criteria
   * Returns null if valid, or rejection reason if invalid
   */
  private validateEntryQuality(
    candles: Candle[],
    htfBias: HTFBiasResult,
    itfZone: ITFSetupZone,
    currentPrice: number,
    structure: import('./types').MarketStructureContext
  ): string | null {
    // 0.0010 Verify HTF → ITF alignment (already checked, but double-check)
    if (!itfZone.isAlignedWithHTF) {
      return 'ITF zone not aligned with HTF bias';
    }

    // 2. Check retracement depth (DEEP discount/premium only - reject mid-range)
    // EXPERT: Tighter ranges for better entry quality
    const zoneRange = itfZone.priceMax - itfZone.priceMin;
    const priceIntoZone = currentPrice - itfZone.priceMin;
    const retracementPct = (priceIntoZone / zoneRange) * 100;

    // For bullish: must be in lower 50-80% of zone (balanced discount zone)
    // For bearish: must be in upper 20-50% of zone (balanced premium zone)
    // EXPERT: Balanced ranges - not too tight, not too loose
    if (htfBias.bias === 'bullish') {
      const minRetracePct = 40 // Must be at least 50% into zone (deep discount)
      const maxRetracePct = 80; // Can go up to 80% (avoid top edge)
      if (retracementPct < minRetracePct || retracementPct > maxRetracePct) {
        return `Bullish entry not in optimal discount zone: ${retracementPct.toFixed(40)}% into zone (need ${minRetracePct}-${maxRetracePct}%)`;
      }
    } else {
      const minRetracePct = 40 // Must be at least 20% into zone (not at bottom edge)
      const maxRetracePct = 50; // Must be in upper 50% (deep premium, avoid top)
      if (retracementPct < minRetracePct || retracementPct > maxRetracePct) {
        return `Bearish entry not in optimal premium zone: ${retracementPct.toFixed(40)}% into zone (need ${minRetracePct}-${maxRetracePct}%)`;
      }
    }

    // IMPROVED: Require pullback confirmation - price must have retested zone after sweep
    // This ensures we're entering on a proper pullback, not immediately after sweep
    if (htfBias.bias !== 'neutral') {
      const pullbackConfirmed = this.checkPullbackConfirmation(candles, structure, htfBias.bias, itfZone, currentPrice);
      if (!pullbackConfirmed) {
        return 'Pullback confirmation failed: Price did not properly retest zone after sweep (waiting for pullback)';
      }

      // EXPERT: Add momentum confirmation - recent candles should favor direction (lenient: 40%+)
      const momentumConfirmed = this.checkMomentumConfirmation(candles, htfBias.bias);
      if (!momentumConfirmed) {
        return 'Momentum confirmation failed: Recent price action not moving in bias direction';
      }
    }

    // 3. Check for valid OB or FVG (must have at least one)
    if (!itfZone.orderBlock && !itfZone.fvg) {
      return 'No valid OB or FVG in setup zone';
    }

    // 4. Verify displacement candle quality (if OB exists)
    if (itfZone.orderBlock) {
      const ob = itfZone.orderBlock;
      // Check wick-to-body ratio (should be significant)
      if (ob.wickToBodyRatio < 0.5) {
        return `Weak OB: wick-to-body ratio ${ob.wickToBodyRatio.toFixed(2)} < 0.5`;
      }
    }

    // 5. Check for M1 confirmation candle (recent BOS/CHoCH/MSB)
    const recentBOS = structure.lastBOS;
    if (!recentBOS || recentBOS.index < candles.length - 10) {
      return 'No recent M1 BOS/CHoCH (must be within last 10 candles)';
    }

    // 6. Avoid entries in middle of structure (check if we're near support/resistance)
    // This is validated by POI detection in calculateEntry

    return null; // All validations passed
  }

  /**
   * Check if we should enter a trade based on M1 micro CHoCH/MSB inside M15 zone
   */
  checkExecution(
    candles: Candle[],
    htfBias: HTFBiasResult,
    itfZone: ITFSetupZone | null,
    currentPrice: number
  ): M1ExecutionResult {
    // Prerequisites
    if (htfBias.bias === 'neutral') {
      return { shouldEnter: false, reason: 'HTF bias is neutral' };
    }

    if (!itfZone || !itfZone.isAlignedWithHTF) {
      return { shouldEnter: false, reason: 'No valid ITF setup zone' };
    }

    // Check if price is inside the M15 zone
    if (currentPrice < itfZone.priceMin || currentPrice > itfZone.priceMax) {
      return { shouldEnter: false, reason: `Price ${currentPrice} outside zone [${itfZone.priceMin}, ${itfZone.priceMax}]` };
    }

    if (candles.length < 10) {
      return { shouldEnter: false, reason: 'Insufficient M1 candles' };
    }

    // Analyze M1 structure
    const structure = this.ltfStructure.analyzeStructure(
      candles,
      htfBias.bias === 'bullish' ? 'bullish' : 'bearish'
    );

    // Validate entry quality (ICT/SMC criteria)
    const qualityCheck = this.validateEntryQuality(candles, htfBias, itfZone, currentPrice, structure);
    if (qualityCheck) {
      return { shouldEnter: false, reason: `Entry quality check failed: ${qualityCheck}` };
    }

    // EXPERT-LEVEL ENTRY REQUIREMENTS: Balanced strictness with quality
    // 1. Liquidity Sweep (grab above/below local high/low) - REQUIRED
    const hasLiquiditySweep = this.checkLiquiditySweep(candles, structure, htfBias.bias, itfZone);
    if (!hasLiquiditySweep) {
      return { shouldEnter: false, reason: 'Missing requirement 1/4: No liquidity sweep detected' };
    }

    // 2. Structure Break (CHoCH preferred, but allow strong BOS if other conditions excellent)
    const microChoch = this.detectMicroChoch(candles, structure, htfBias.bias, itfZone);
    if (!microChoch) {
      return { shouldEnter: false, reason: 'Missing requirement 2/4: No M1 structure break detected' };
    }

    // EXPERT: Allow strong BOS if other conditions are excellent (confluence scoring)
    const isChoch = microChoch.type === 'CHoCH';
    const isStrongBOS = microChoch.type === 'BOS' && this.isStrongBOS(candles, microChoch.index, structure, htfBias.bias);
    
    // Prefer CHoCH/MSB, but allow strong BOS if other conditions are excellent
    // CHoCH/MSB are preferred but BOS can work if confluence is high
    if (!isChoch && microChoch.type !== 'MSB' && !isStrongBOS) {
      return { shouldEnter: false, reason: 'Missing requirement 2/4: No M1 CHoCH, MSB, or strong BOS detected' };
    }

    // 3. Strong Displacement Candle - REQUIRED (with quality check)
    const displacementQuality = this.checkDisplacementCandleQuality(candles, microChoch.index, htfBias.bias);
    if (displacementQuality < 6) { // INCREASED: Minimum quality score of 6/10 (was 5) - require stronger displacement
      return { shouldEnter: false, reason: `Missing requirement 3/4: Weak displacement candle (quality: ${displacementQuality}/10, minimum 6)` };
    }

    // 4. Quality OB/FVG refinement on M1 - REQUIRED
    const hasRefinedOBFVG = this.checkRefinedOBFVG(candles, itfZone, microChoch.index);
    if (!hasRefinedOBFVG) {
      return { shouldEnter: false, reason: 'Missing requirement 4/4: No refined M1 OB/FVG detected' };
    }

    // EXPERT: Confluence scoring - only take high-quality setups (INCREASED threshold)
    const confluenceScore = this.calculateConfluenceScore(
      candles,
      structure,
      microChoch,
      itfZone,
      displacementQuality,
      isChoch,
      htfBias.bias
    );
    
    // INCREASED: Minimum confluence score: 8/10 (was 7) - be very selective for better win rate
    // Only take the highest quality setups to improve win rate from 23% to 35%+
    if (confluenceScore < 8) {
      return { shouldEnter: false, reason: `Confluence score too low: ${confluenceScore}/10 (minimum 8 required)` };
    }

    // Calculate entry, stop, and TP
    if (htfBias.bias === 'bullish') {
      return this.calculateBullishEntry(candles, structure, microChoch, itfZone, currentPrice);
    } else {
      return this.calculateBearishEntry(candles, structure, microChoch, itfZone, currentPrice);
    }
  }

  /**
   * Detect micro CHoCH/MSB/BOS on M1
   * Accepts any BOS event (BOS, CHoCH, or MSB) as valid entry signal
   */
  private detectMicroChoch(
    candles: Candle[],
    structure: import('./types').MarketStructureContext,
    htfBias: 'bullish' | 'bearish',
    itfZone: ITFSetupZone
  ): { type: 'CHoCH' | 'MSB' | 'BOS'; index: number; price: number } | null {
    if (!structure.bosEvents || structure.bosEvents.length === 0) {
      return null;
    }

    // Get the most recent BOS/CHoCH/MSB event (accept any BOS event)
    // Prefer CHoCH/MSB over BOS, but accept BOS if no CHoCH/MSB available
    const recentEvents = structure.bosEvents
      .sort((a, b) => b.index - a.index);

    if (recentEvents.length === 0) {
      return null;
    }

    const lastEvent = recentEvents[0];
    const eventIndex = lastEvent.index;

    if (eventIndex >= candles.length) {
      return null;
    }

    const eventCandle = candles[eventIndex];

    // Check if the event is in the direction of H4 bias
    // For bullish: accept if price moved up or broke a swing high
    // For bearish: accept if price moved down or broke a swing low
    if (htfBias === 'bullish') {
      // Bullish signal: check for upward price movement
      if (eventIndex > 0) {
        const prevCandle = candles[eventIndex - 1];
        const priceMovedUp = eventCandle.close > prevCandle.close;
        
        // Also check if it broke a swing high inside the zone
        const swingHighs = structure.swingHighs || [];
        let brokeSwingHigh = false;
        if (swingHighs.length > 0) {
          const lastSwingHigh = swingHighs[swingHighs.length - 1];
          if (lastSwingHigh >= itfZone.priceMin && lastSwingHigh <= itfZone.priceMax) {
            brokeSwingHigh = eventCandle.close > lastSwingHigh || eventCandle.high > lastSwingHigh;
          }
        }
        
        // Accept if price moved up OR broke a swing high (more lenient)
        if (priceMovedUp || brokeSwingHigh) {
          return {
            type: lastEvent.type === 'MSB' ? 'MSB' : (lastEvent.type === 'CHoCH' ? 'CHoCH' : 'BOS'),
            index: eventIndex,
            price: lastEvent.price,
          };
        }
      } else {
        // No previous candle - accept if it's a recent event (within last 5 candles)
        const recentThreshold = Math.max(0, candles.length - 5);
        if (eventIndex >= recentThreshold) {
          return {
            type: lastEvent.type === 'MSB' ? 'MSB' : (lastEvent.type === 'CHoCH' ? 'CHoCH' : 'BOS'),
            index: eventIndex,
            price: lastEvent.price,
          };
        }
      }
    } else {
      // Bearish signal: check for downward price movement
      if (eventIndex > 0) {
        const prevCandle = candles[eventIndex - 1];
        const priceMovedDown = eventCandle.close < prevCandle.close;
        
        // Also check if it broke a swing low inside the zone
        const swingLows = structure.swingLows || [];
        let brokeSwingLow = false;
        if (swingLows.length > 0) {
          const lastSwingLow = swingLows[swingLows.length - 1];
          if (lastSwingLow >= itfZone.priceMin && lastSwingLow <= itfZone.priceMax) {
            brokeSwingLow = eventCandle.close < lastSwingLow || eventCandle.low < lastSwingLow;
          }
        }
        
        // Accept if price moved down OR broke a swing low (more lenient)
        if (priceMovedDown || brokeSwingLow) {
          return {
            type: lastEvent.type === 'MSB' ? 'MSB' : (lastEvent.type === 'CHoCH' ? 'CHoCH' : 'BOS'),
            index: eventIndex,
            price: lastEvent.price,
          };
        }
      } else {
        // No previous candle - accept if it's a recent event (within last 5 candles)
        const recentThreshold = Math.max(0, candles.length - 5);
        if (eventIndex >= recentThreshold) {
          return {
            type: lastEvent.type === 'MSB' ? 'MSB' : (lastEvent.type === 'CHoCH' ? 'CHoCH' : 'BOS'),
            index: eventIndex,
            price: lastEvent.price,
          };
        }
      }
    }

    return null;
  }

  /**
   * Detect all valid POIs for stop loss placement (LONG trades)
   * Returns POIs sorted by strength (strongest first)
   */
  private detectBullishPOIs(
    candles: Candle[],
    structure: import('./types').MarketStructureContext,
    itfZone: ITFSetupZone,
    entryPrice: number
  ): POI[] {
    const pois: POI[] = [];

    // 1. Swing lows (from structure analysis)
    if (structure.swingLows && structure.swingLows.length > 0) {
      const relevantLows = structure.swingLows.filter(low => low < entryPrice);
      relevantLows.forEach(low => {
        pois.push({
          price: low,
          type: 'swing',
          reason: 'M1 swing low',
          strength: 7, // Strong POI
        });
      });
    }

    // 2. Order Block origin (15m OB origin - HIGHEST PRIORITY per screenshot workflow)
    if (itfZone.orderBlock) {
      const obOrigin = itfZone.orderBlock.low; // For bullish OB, origin is the low
      if (obOrigin < entryPrice) {
        // Prioritize 15m OB origin (HTF is now M15)
        const obTimeframe = (itfZone.orderBlock.timeframe as string) || '';
        const isHTFOB = obTimeframe === 'M15' || obTimeframe === '15m' || obTimeframe.includes('15');
        pois.push({
          price: obOrigin,
          type: 'ob_origin',
          reason: `${itfZone.orderBlock.timeframe} OB origin${isHTFOB ? ' (15m HTF - highest priority)' : ''}`,
          strength: isHTFOB ? 10 : 9, // 15m OB origin is strongest (10), other OBs are 9
        });
      }
    }

    // 3. Premium/Discount zone boundary
    const pdBoundary = itfZone.priceMin; // Lower boundary for long
    if (pdBoundary < entryPrice) {
      pois.push({
        price: pdBoundary,
        type: 'pd_boundary',
        reason: 'ITF setup zone boundary',
        strength: 6, // Moderate POI
      });
    }

    // 4. Displacement wick (find candles with large wicks)
    const recentCandles = candles.slice(-10);
    for (let i = 0; i < recentCandles.length; i++) {
      const candle = recentCandles[i];
      const body = Math.abs(candle.close - candle.open);
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;

      // Significant wick = wick > 2x body
      if (lowerWick > body * 2 && candle.low < entryPrice) {
        pois.push({
          price: candle.low,
          type: 'displacement_wick',
          reason: 'M1 displacement wick low',
          strength: 8, // Strong POI
        });
      }
    }

    // 5. Structural levels (HTF/ITF swing lows behind the zone)
    // Use zone minimum as fallback structural level
    if (itfZone.priceMin < entryPrice) {
      pois.push({
        price: itfZone.priceMin,
        type: 'structural_level',
        reason: 'ITF structural support',
        strength: 5, // Weaker POI (fallback)
      });
    }

    // Sort by strength (strongest first), then by price (lower is better for longs)
    pois.sort((a, b) => {
      if (b.strength !== a.strength) {
        return b.strength - a.strength; // Higher strength first
      }
      return a.price - b.price; // Lower price first (deeper SL)
    });

    return pois;
  }

  /**
   * Detect all valid POIs for stop loss placement (SHORT trades)
   * Returns POIs sorted by strength (strongest first)
   */
  private detectBearishPOIs(
    candles: Candle[],
    structure: import('./types').MarketStructureContext,
    itfZone: ITFSetupZone,
    entryPrice: number
  ): POI[] {
    const pois: POI[] = [];

    // 1. Swing highs (from structure analysis)
    if (structure.swingHighs && structure.swingHighs.length > 0) {
      const relevantHighs = structure.swingHighs.filter(high => high > entryPrice);
      relevantHighs.forEach(high => {
        pois.push({
          price: high,
          type: 'swing',
          reason: 'M1 swing high',
          strength: 7, // Strong POI
        });
      });
    }

    // 2. Order Block origin (15m OB origin - HIGHEST PRIORITY per screenshot workflow)
    if (itfZone.orderBlock) {
      const obOrigin = itfZone.orderBlock.high; // For bearish OB, origin is the high
      if (obOrigin > entryPrice) {
        // Prioritize 15m OB origin (HTF is now M15)
        const obTimeframe = (itfZone.orderBlock.timeframe as string) || '';
        const isHTFOB = obTimeframe === 'M15' || obTimeframe === '15m' || obTimeframe.includes('15');
        pois.push({
          price: obOrigin,
          type: 'ob_origin',
          reason: `${itfZone.orderBlock.timeframe} OB origin${isHTFOB ? ' (15m HTF - highest priority)' : ''}`,
          strength: isHTFOB ? 10 : 9, // 15m OB origin is strongest (10), other OBs are 9
        });
      }
    }

    // 3. Premium/Discount zone boundary
    const pdBoundary = itfZone.priceMax; // Upper boundary for short
    if (pdBoundary > entryPrice) {
      pois.push({
        price: pdBoundary,
        type: 'pd_boundary',
        reason: 'ITF setup zone boundary',
        strength: 6, // Moderate POI
      });
    }

    // 4. Displacement wick (find candles with large wicks)
    const recentCandles = candles.slice(-10);
    for (let i = 0; i < recentCandles.length; i++) {
      const candle = recentCandles[i];
      const body = Math.abs(candle.close - candle.open);
      const upperWick = candle.high - Math.max(candle.open, candle.close);

      // Significant wick = wick > 2x body
      if (upperWick > body * 2 && candle.high > entryPrice) {
        pois.push({
          price: candle.high,
          type: 'displacement_wick',
          reason: 'M1 displacement wick high',
          strength: 8, // Strong POI
        });
      }
    }

    // 5. Structural levels (HTF/ITF swing highs behind the zone)
    // Use zone maximum as fallback structural level
    if (itfZone.priceMax > entryPrice) {
      pois.push({
        price: itfZone.priceMax,
        type: 'structural_level',
        reason: 'ITF structural resistance',
        strength: 5, // Weaker POI (fallback)
      });
    }

    // Sort by strength (strongest first), then by price (higher is better for shorts)
    pois.sort((a, b) => {
      if (b.strength !== a.strength) {
        return b.strength - a.strength; // Higher strength first
      }
      return b.price - a.price; // Higher price first (deeper SL)
    });

    return pois;
  }

  /**
   * Calculate bullish entry parameters
   */
  private calculateBullishEntry(
    candles: Candle[],
    structure: import('./types').MarketStructureContext,
    microChoch: { type: 'CHoCH' | 'MSB' | 'BOS'; index: number; price: number },
    itfZone: ITFSetupZone,
    currentPrice: number
  ): M1ExecutionResult {
    const eventCandle = candles[microChoch.index];
    if (!eventCandle) {
      return { shouldEnter: false, reason: 'Invalid micro CHoCH candle index' };
    }

    // Entry: buy stop at/beyond the high of the M1 candle that caused the bullish BOS/MSB
    const entryPrice = eventCandle.high;

    // POI-Anchored Stop Loss: Detect all valid POIs and choose the best one
    const pois = this.detectBullishPOIs(candles, structure, itfZone, entryPrice);

    if (pois.length === 0) {
      return { shouldEnter: false, reason: 'No valid POI found for stop loss placement' };
    }

    // IMPROVED: Find the last significant swing low BEFORE the entry
    // This ensures SL is beyond structure, not just below POI
    const swingLows = structure.swingLows || [];
    let lastSignificantLow = pois[0].price;
    
    // Find the most recent swing low that's below entry and not too far
    for (const low of swingLows) {
      if (low < entryPrice && low < lastSignificantLow) {
        // Check if this low is recent (within last 20 candles)
        const lowIndex = candles.findIndex(c => Math.abs(c.low - low) < 0.5);
        if (lowIndex >= 0 && lowIndex >= candles.length - 20) {
          lastSignificantLow = low;
        }
      }
    }

    // EXPERT: Select POI with best risk/reward, prioritizing structural levels
    let selectedPOI = pois[0];
    let bestRiskReward = 0;
    
    for (const poi of pois.slice(0, 3)) { // Check top 3 POIs
      // Use the lower of: POI or last significant swing low
      const structuralLevel = Math.min(poi.price, lastSignificantLow);
      const testSL = structuralLevel - this.slBuffer - Math.max(entryPrice * 0.0010, 0.8); // Increased buffer
      if (testSL >= entryPrice) continue;
      
      const risk = entryPrice - testSL;
      const reward = risk * this.riskRewardRatio;
      const testTP = entryPrice + reward;
      
      // Prefer POI that gives us better distance from entry (more room for price action)
      const slDistance = entryPrice - testSL;
      const rrRatio = reward / risk;
      
      // Score: prioritize POIs that are not too tight (min 1.0 units) and give good R:R
      if (slDistance >= 1.0 && rrRatio >= 2.5) {
        const score = slDistance * rrRatio; // Higher score = better
        if (score > bestRiskReward) {
          bestRiskReward = score;
          selectedPOI = poi;
        }
      }
    }
    
    // IMPROVED: Place SL below the last significant swing low, not just POI
    // This ensures SL is beyond structure and avoids liquidity zones
    const structuralLevel = Math.min(selectedPOI.price, lastSignificantLow);
    const extraBuffer = Math.max(entryPrice * 0.0015, 0.8); // Increased buffer for safety
    const stopLoss = structuralLevel - this.slBuffer - extraBuffer;

    // Validate: SL must not be inside clean liquidity (CRITICAL - avoid becoming liquidity)
    if (stopLoss >= entryPrice) {
      return { shouldEnter: false, reason: 'Invalid SL: POI above entry (would be invalid stop)' };
    }

    // Check if SL is in clean liquidity (equal lows/highs, recent swing that was swept)
    const slInLiquidity = this.checkSLInLiquidity(candles, structure, stopLoss, 'buy');
    if (slInLiquidity) {
      return { shouldEnter: false, reason: `SL rejected: Stop loss at ${stopLoss.toFixed(0.0010)} is in clean liquidity (would become liquidity)` };
    }

    // TP: calculated using configured R:R ratio
    const risk = entryPrice - stopLoss;
    
    // INCREASED: Minimum risk distance check to avoid tight SLs
    // For XAUUSD, minimum 1.0 (10 dollars) gives better room for price action and reduces false SL hits
    const minRiskDistance = 1.0; // INCREASED: Minimum distance in price units (was 0.7)
    if (risk < minRiskDistance) {
      return {
        shouldEnter: false,
        reason: `Risk too tight: ${risk.toFixed(2)} (minimum ${minRiskDistance} required) - POI too close to entry`
      };
    }
    
    // IMPROVED: Use structural target for TP when available (better than fixed 3R)
    // Look for next significant swing high that's reasonable distance
    const swingHighs = structure.swingHighs || [];
    let structuralTP = entryPrice + (risk * this.riskRewardRatio); // Default to 3R
    
    // Find next swing high that's above entry and gives us at least 2R
    for (const high of swingHighs) {
      if (high > entryPrice) {
        const structuralRisk = high - entryPrice;
        const structuralRR = structuralRisk / risk;
        // IMPROVED: Use structural target if it gives us 2-3R (more achievable than 3-4R)
        // Prefer targets closer to entry to improve hit rate
        if (structuralRR >= 2.0 && structuralRR <= 3.0 && structuralRR >= (this.riskRewardRatio * 0.6)) {
          structuralTP = high - (entryPrice * 0.0005); // Slightly below swing high
          break;
        }
      }
    }
    
    const takeProfit = structuralTP;

    // EXPERT: Validate TP is not in heavy liquidity (equal highs/lows)
    const tpInLiquidity = this.checkTPInLiquidity(candles, structure, takeProfit, 'buy');
    if (tpInLiquidity) {
      return {
        shouldEnter: false,
        reason: `TP rejected: Take profit at ${takeProfit.toFixed(2)} is in heavy liquidity (equal highs)`
      };
    }
    
    // IMPROVED: Validate path to TP is clear (no major resistance between entry and TP)
    const pathClear = this.validateTPPath(candles, structure, entryPrice, takeProfit, 'buy');
    if (!pathClear) {
      return {
        shouldEnter: false,
        reason: `TP path blocked: Major resistance between entry and TP at ${takeProfit.toFixed(2)}`
      };
    }

    // Validate: Risk must be reasonable (not too wide)
    const maxRiskPct = 0.02; // 2% max risk relative to price
    if (risk / entryPrice > maxRiskPct) {
      return {
        shouldEnter: false,
        reason: `Risk too wide: ${(risk / entryPrice * 100).toFixed(2)}% (max ${maxRiskPct * 100}%)`
      };
    }

    logger.info(
      `[SL] LONG - Entry=${entryPrice.toFixed(2)} | POI=${selectedPOI.price.toFixed(2)} | ` +
      `SL=${stopLoss.toFixed(2)} | Reason=${selectedPOI.reason} (strength=${selectedPOI.strength})`
    );
    logger.info(
      `[Execution] LONG setup - Entry=${entryPrice.toFixed(2)}, SL=${stopLoss.toFixed(2)}, ` +
      `TP=${takeProfit.toFixed(2)}, Risk=${risk.toFixed(2)}, R:R=1:${this.riskRewardRatio}`
    );

    return {
      shouldEnter: true,
      direction: 'buy',
      entryPrice,
      stopLoss,
      takeProfit,
      reason: `Bullish micro ${microChoch.type} confirmed in M15 zone`,
      microChoch,
    };
  }

  /**
   * Calculate bearish entry parameters
   */
  private calculateBearishEntry(
    candles: Candle[],
    structure: import('./types').MarketStructureContext,
    microChoch: { type: 'CHoCH' | 'MSB' | 'BOS'; index: number; price: number },
    itfZone: ITFSetupZone,
    currentPrice: number
  ): M1ExecutionResult {
    const eventCandle = candles[microChoch.index];
    if (!eventCandle) {
      return { shouldEnter: false, reason: 'Invalid micro CHoCH candle index' };
    }

    // Entry: sell stop at/beyond the low of the M1 candle that caused the bearish BOS/MSB
    const entryPrice = eventCandle.low;

    // POI-Anchored Stop Loss: Detect all valid POIs and choose the best one
    const pois = this.detectBearishPOIs(candles, structure, itfZone, entryPrice);

    if (pois.length === 0) {
      return { shouldEnter: false, reason: 'No valid POI found for stop loss placement' };
    }

    // IMPROVED: Find the last significant swing high BEFORE the entry
    // This ensures SL is beyond structure, not just above POI
    const swingHighs = structure.swingHighs || [];
    let lastSignificantHigh = pois[0].price;
    
    // Find the most recent swing high that's above entry and not too far
    for (const high of swingHighs) {
      if (high > entryPrice && high > lastSignificantHigh) {
        // Check if this high is recent (within last 20 candles)
        const highIndex = candles.findIndex(c => Math.abs(c.high - high) < 0.5);
        if (highIndex >= 0 && highIndex >= candles.length - 20) {
          lastSignificantHigh = high;
        }
      }
    }

    // EXPERT: Select POI with best risk/reward, prioritizing structural levels
    let selectedPOI = pois[0];
    let bestRiskReward = 0;
    
    for (const poi of pois.slice(0, 3)) { // Check top 3 POIs
      // Use the higher of: POI or last significant swing high
      const structuralLevel = Math.max(poi.price, lastSignificantHigh);
      const testSL = structuralLevel + this.slBuffer + Math.max(entryPrice * 0.0010, 0.8); // Increased buffer
      if (testSL <= entryPrice) continue;
      
      const risk = testSL - entryPrice;
      const reward = risk * this.riskRewardRatio;
      const testTP = entryPrice - reward;
      
      // Prefer POI that gives us better distance from entry (more room for price action)
      const slDistance = testSL - entryPrice;
      const rrRatio = reward / risk;
      
      // Score: prioritize POIs that are not too tight (min 1.0 units) and give good R:R
      if (slDistance >= 1.0 && rrRatio >= 2.5) {
        const score = slDistance * rrRatio; // Higher score = better
        if (score > bestRiskReward) {
          bestRiskReward = score;
          selectedPOI = poi;
        }
      }
    }
    
    // IMPROVED: Place SL above the last significant swing high, not just POI
    // This ensures SL is beyond structure and avoids liquidity zones
    const structuralLevel = Math.max(selectedPOI.price, lastSignificantHigh);
    const extraBuffer = Math.max(entryPrice * 0.0015, 0.8); // Increased buffer for safety
    const stopLoss = structuralLevel + this.slBuffer + extraBuffer;

    // Validate: SL must not be inside clean liquidity (CRITICAL - avoid becoming liquidity)
    if (stopLoss <= entryPrice) {
      return { shouldEnter: false, reason: 'Invalid SL: POI below entry (would be invalid stop)' };
    }

    // Check if SL is in clean liquidity (equal lows/highs, recent swing that was swept)
    const slInLiquidity = this.checkSLInLiquidity(candles, structure, stopLoss, 'sell');
    if (slInLiquidity) {
      return { shouldEnter: false, reason: `SL rejected: Stop loss at ${stopLoss.toFixed(0.0010)} is in clean liquidity (would become liquidity)` };
    }

    // TP: calculated using configured R:R ratio
    const risk = stopLoss - entryPrice;
    
    // EXPERT: Minimum risk distance to avoid tight SLs that get hit by noise
    // For XAUUSD, minimum 0.7 (7 dollars) gives reasonable room for price action
    const minRiskDistance = 0.7; // Balanced - not too tight, not too wide
    if (risk < minRiskDistance) {
      return {
        shouldEnter: false,
        reason: `Risk too tight: ${risk.toFixed(2)} (minimum ${minRiskDistance} required) - POI too close to entry`
      };
    }
    
    // IMPROVED: Use structural target for TP when available (better than fixed 3R)
    // Look for next significant swing low that's reasonable distance
    const swingLows = structure.swingLows || [];
    let structuralTP = entryPrice - (risk * this.riskRewardRatio); // Default to 3R
    
    // IMPROVED: Find next swing low that's below entry and gives us 2-3R (more achievable)
    // Use closer targets to improve R:R realization (was 2-4R, now 2-3R)
    for (const low of swingLows) {
      if (low < entryPrice) {
        const structuralRisk = entryPrice - low;
        const structuralRR = structuralRisk / risk;
        // Use structural target if it gives us 2-3R (more achievable than 3-4R)
        // Prefer targets closer to entry to improve hit rate
        if (structuralRR >= 2.0 && structuralRR <= 3.0 && structuralRR >= (this.riskRewardRatio * 0.6)) {
          structuralTP = low + (entryPrice * 0.0005); // Slightly above swing low
          break;
        }
      }
    }
    
    const takeProfit = structuralTP;

    // EXPERT: Validate TP is not in heavy liquidity (equal highs/lows)
    const tpInLiquidity = this.checkTPInLiquidity(candles, structure, takeProfit, 'sell');
    if (tpInLiquidity) {
      return {
        shouldEnter: false,
        reason: `TP rejected: Take profit at ${takeProfit.toFixed(2)} is in heavy liquidity (equal lows)`
      };
    }
    
    // IMPROVED: Validate path to TP is clear (no major support between entry and TP)
    const pathClear = this.validateTPPath(candles, structure, entryPrice, takeProfit, 'sell');
    if (!pathClear) {
      return {
        shouldEnter: false,
        reason: `TP path blocked: Major support between entry and TP at ${takeProfit.toFixed(2)}`
      };
    }

    // Validate: Risk must be reasonable (not too wide)
    const maxRiskPct = 0.02; // 2% max risk relative to price
    if (risk / entryPrice > maxRiskPct) {
      return {
        shouldEnter: false,
        reason: `Risk too wide: ${(risk / entryPrice * 100).toFixed(2)}% (max ${maxRiskPct * 100}%)`
      };
    }

    logger.info(
      `[SL] SHORT - Entry=${entryPrice.toFixed(2)} | POI=${selectedPOI.price.toFixed(2)} | ` +
      `SL=${stopLoss.toFixed(2)} | Reason=${selectedPOI.reason} (strength=${selectedPOI.strength})`
    );
    logger.info(
      `[Execution] SHORT setup - Entry=${entryPrice.toFixed(2)}, SL=${stopLoss.toFixed(2)}, ` +
      `TP=${takeProfit.toFixed(2)}, Risk=${risk.toFixed(2)}, R:R=1:${this.riskRewardRatio}`
    );

    return {
      shouldEnter: true,
      direction: 'sell',
      entryPrice,
      stopLoss,
      takeProfit,
      reason: `Bearish micro ${microChoch.type} confirmed in M15 zone`,
      microChoch,
    };
  }

  /**
   * Check requirement 1/4: Liquidity Sweep (grab above/below local high/low)
   * EXPERT: Improved detection - must sweep AND reverse (not just touch)
   */
  private checkLiquiditySweep(
    candles: Candle[],
    structure: import('./types').MarketStructureContext,
    bias: 'bullish' | 'bearish',
    itfZone: ITFSetupZone
  ): boolean {
    if (candles.length < 10) return false;

    const recentCandles = candles.slice(-30); // Check last 30 M1 candles for better context
    const latestCandle = recentCandles[recentCandles.length - 1];

    if (bias === 'bullish') {
      // For bullish: must have swept a recent swing low AND reversed
      const swingLows = structure.swingLows || [];
      if (swingLows.length === 0) return false;

      // Find swing lows that were swept
      for (const low of swingLows) {
        // Find the sweep candle (price went below the swing low)
        let sweepIndex = -1;
        for (let i = 0; i < recentCandles.length - 1; i++) {
          if (recentCandles[i].low < low * 0.9995) { // Swept by 0.05%+
            sweepIndex = i;
            break;
          }
        }

        if (sweepIndex >= 0) {
          // EXPERT: Check if price reversed after sweep (bullish confirmation)
          // Price should be above the swept low now (more lenient - 0.05%+)
          const currentPrice = latestCandle.close;
          if (currentPrice > low * 1.0005) { // Reversed by 0.05%+ (more lenient)
            return true; // Valid sweep + reversal
          }
        }
      }

      return false;
    } else {
      // For bearish: must have swept a recent swing high AND reversed
      const swingHighs = structure.swingHighs || [];
      if (swingHighs.length === 0) return false;

      // Find swing highs that were swept
      for (const high of swingHighs) {
        // Find the sweep candle (price went above the swing high)
        let sweepIndex = -1;
        for (let i = 0; i < recentCandles.length - 1; i++) {
          if (recentCandles[i].high > high * 1.0005) { // Swept by 0.05%+
            sweepIndex = i;
            break;
          }
        }

        if (sweepIndex >= 0) {
          // EXPERT: Check if price reversed after sweep (bearish confirmation)
          // Price should be below the swept high now (more lenient - 0.05%+)
          const currentPrice = latestCandle.close;
          if (currentPrice < high * 0.9995) { // Reversed by 0.05%+ (more lenient)
            return true; // Valid sweep + reversal
          }
        }
      }

      return false;
    }
  }

  /**
   * Check requirement 3/4: Strong Displacement Candle Quality
   * Returns quality score (0-10) based on momentum strength
   */
  private checkDisplacementCandleQuality(
    candles: Candle[],
    eventIndex: number,
    bias: 'bullish' | 'bearish'
  ): number {
    if (eventIndex < 0 || eventIndex >= candles.length) return 0;

    const eventCandle = candles[eventIndex];
    const body = Math.abs(eventCandle.close - eventCandle.open);
    const upperWick = eventCandle.high - Math.max(eventCandle.open, eventCandle.close);
    const lowerWick = Math.min(eventCandle.open, eventCandle.close) - eventCandle.low;
    const totalRange = eventCandle.high - eventCandle.low;

    if (totalRange === 0) return 0;

    // Direction must match bias
    if (bias === 'bullish' && eventCandle.close <= eventCandle.open) return 0;
    if (bias === 'bearish' && eventCandle.close >= eventCandle.open) return 0;

    // Body ratio (0-5 points)
    const bodyRatio = body / totalRange;
    let score = 0;
    if (bodyRatio >= 0.8) score += 5; // Excellent (80%+ body)
    else if (bodyRatio >= 0.7) score += 3; // Good (70-80% body)
    else if (bodyRatio >= 0.6) score += 1; // Acceptable (60-70% body)
    else return 0; // Too weak

    // Momentum strength - compare to recent candles (0-3 points)
    if (eventIndex > 0) {
      const recentCandles = candles.slice(Math.max(0, eventIndex - 5), eventIndex);
      if (recentCandles.length > 0) {
        const avgBody = recentCandles.reduce((sum, c) => sum + Math.abs(c.close - c.open), 0) / recentCandles.length;
        const momentumRatio = body / (avgBody || 1);
        if (momentumRatio >= 2.0) score += 3; // Strong momentum (2x+ average)
        else if (momentumRatio >= 1.5) score += 2; // Good momentum (1.5x average)
        else if (momentumRatio >= 1.2) score += 1; // Acceptable momentum
      }
    }

    // Volume confirmation (if available) - check if candle closed strongly (0-2 points)
    const closeStrength = bias === 'bullish' 
      ? (eventCandle.close - eventCandle.low) / totalRange
      : (eventCandle.high - eventCandle.close) / totalRange;
    if (closeStrength >= 0.9) score += 2; // Closed near extreme (strong)
    else if (closeStrength >= 0.7) score += 1; // Closed well

    return Math.min(10, score); // Cap at 10
  }

  /**
   * Check if BOS is strong enough to accept (expert: allow strong BOS if other conditions excellent)
   */
  private isStrongBOS(
    candles: Candle[],
    eventIndex: number,
    structure: import('./types').MarketStructureContext,
    bias: 'bullish' | 'bearish'
  ): boolean {
    if (eventIndex < 0 || eventIndex >= candles.length) return false;

    const eventCandle = candles[eventIndex];
    
    // Strong BOS = broke significant swing AND has strong displacement
    if (bias === 'bullish') {
      const swingHighs = structure.swingHighs || [];
      if (swingHighs.length > 0) {
        const lastSwingHigh = swingHighs[swingHighs.length - 1];
        const brokeSignificantHigh = eventCandle.close > lastSwingHigh * 1.001; // Broke by 0.1%+
        const strongBody = eventCandle.close > eventCandle.open && 
                          (eventCandle.close - eventCandle.open) > (eventCandle.high - eventCandle.low) * 0.6;
        return brokeSignificantHigh && strongBody;
      }
    } else {
      const swingLows = structure.swingLows || [];
      if (swingLows.length > 0) {
        const lastSwingLow = swingLows[swingLows.length - 1];
        const brokeSignificantLow = eventCandle.close < lastSwingLow * 0.999; // Broke by 0.1%+
        const strongBody = eventCandle.close < eventCandle.open && 
                          (eventCandle.open - eventCandle.close) > (eventCandle.high - eventCandle.low) * 0.6;
        return brokeSignificantLow && strongBody;
      }
    }

    return false;
  }

  /**
   * Calculate confluence score (0-10) for entry quality
   * Higher score = better setup
   */
  private calculateConfluenceScore(
    candles: Candle[],
    structure: import('./types').MarketStructureContext,
    microChoch: { type: 'CHoCH' | 'MSB' | 'BOS'; index: number; price: number },
    itfZone: ITFSetupZone,
    displacementQuality: number,
    isChoch: boolean,
    bias: 'bullish' | 'bearish'
  ): number {
    let score = 0;

    // 1. Structure break type (0-3 points)
    if (isChoch) score += 3; // CHoCH is best
    else if (microChoch.type === 'MSB') score += 2; // MSB is good
    else score += 1; // BOS is acceptable

    // 2. Displacement quality (0-3 points, normalized from 0-10 to 0-3)
    score += Math.min(3, (displacementQuality / 10) * 3);

    // 3. Zone quality (0-2 points)
    if (itfZone.orderBlock && itfZone.orderBlock.wickToBodyRatio >= 0.7) score += 2; // Excellent OB
    else if (itfZone.orderBlock || itfZone.fvg) score += 1; // Good zone

    // 4. Recent momentum (0-2 points)
    if (microChoch.index < candles.length - 3) {
      const recentCandles = candles.slice(microChoch.index, microChoch.index + 3);
      const allInDirection = recentCandles.every(c => 
        bias === 'bullish' ? c.close > c.open : c.close < c.open
      );
      if (allInDirection) score += 2; // All recent candles in direction
    }
    
    // 5. IMPROVED: Zone position quality (0-1 point)
    // Prefer entries in the middle of the zone (not at extremes)
    const zoneRange = itfZone.priceMax - itfZone.priceMin;
    if (zoneRange > 0 && candles.length > 0) {
      const currentPrice = candles[candles.length - 1].close;
      const priceIntoZone = (currentPrice - itfZone.priceMin) / zoneRange;
      // Best position: 30-70% into zone (middle area)
      if (priceIntoZone >= 0.3 && priceIntoZone <= 0.7) {
        score += 1; // Good zone position
      }
    }

    return Math.min(10, score);
  }

  /**
   * Check requirement 4/4: Quality OB/FVG refinement on M1
   * Must have a valid OB or FVG on M1 that refines the 15m zone
   */
  private checkRefinedOBFVG(
    candles: Candle[],
    itfZone: ITFSetupZone,
    eventIndex: number
  ): boolean {
    // Check if zone has OB or FVG
    if (itfZone.orderBlock) {
      // OB must have good wick-to-body ratio
      const ob = itfZone.orderBlock;
      if (ob.wickToBodyRatio >= 0.5) return true; // Good quality OB
    }

    if (itfZone.fvg) {
      // FVG must be significant size
      const fvgSize = itfZone.fvg.high - itfZone.fvg.low;
      if (candles.length < 10) return false;
      const avgCandleSize = candles.slice(-10).reduce((sum, c) => sum + (c.high - c.low), 0) / 10;
      if (avgCandleSize === 0) return false;
      if (fvgSize >= avgCandleSize * 1.5) return true; // FVG is 1.5x average candle size
    }

    return false;
  }

  /**
   * Check if stop loss is in clean liquidity (must reject to avoid becoming liquidity)
   * Reject if SL is:
   * - Exactly under a clean low or equal lows
   * - Inside the wick of a sweep candle
   * - At a recent swing that was just swept
   */
  private checkSLInLiquidity(
    candles: Candle[],
    structure: import('./types').MarketStructureContext,
    slPrice: number,
    direction: 'buy' | 'sell'
  ): boolean {
    const tolerance = 0.1; // 0.1 price units tolerance for "exact" match

    if (direction === 'buy') {
      // For longs: check if SL is at/under a swing low
      const swingLows = structure.swingLows || [];
      for (const low of swingLows) {
        // If SL is within tolerance of a swing low, it's in liquidity
        if (Math.abs(slPrice - low) <= tolerance || slPrice < low) {
          // Check if this low was recently swept (makes it even more dangerous)
          const recentCandles = candles.slice(-10);
          const wasSwept = recentCandles.some(c => c.low < low * 0.999);
          if (wasSwept) {
            return true; // SL is in swept liquidity - REJECT
          }
        }
      }

      // Check if SL is inside the wick of a recent sweep candle
      const recentCandles = candles.slice(-5);
      for (const candle of recentCandles) {
        if (slPrice >= candle.low && slPrice <= Math.min(candle.open, candle.close)) {
          // SL is in the lower wick - potential liquidity
          return true;
        }
      }
    } else {
      // For shorts: check if SL is at/above a swing high
      const swingHighs = structure.swingHighs || [];
      for (const high of swingHighs) {
        // If SL is within tolerance of a swing high, it's in liquidity
        if (Math.abs(slPrice - high) <= tolerance || slPrice > high) {
          // Check if this high was recently swept (makes it even more dangerous)
          const recentCandles = candles.slice(-10);
          const wasSwept = recentCandles.some(c => c.high > high * 1.001);
          if (wasSwept) {
            return true; // SL is in swept liquidity - REJECT
          }
        }
      }

      // Check if SL is inside the wick of a recent sweep candle
      const recentCandles = candles.slice(-5);
      for (const candle of recentCandles) {
        if (slPrice <= candle.high && slPrice >= Math.max(candle.open, candle.close)) {
          // SL is in the upper wick - potential liquidity
          return true;
        }
      }
    }

    return false; // SL is not in clean liquidity
  }

  /**
   * Check if take profit is in heavy liquidity (equal highs/lows)
   * EXPERT: Reject if TP is at a level with multiple equal highs/lows
   */
  private checkTPInLiquidity(
    candles: Candle[],
    structure: import('./types').MarketStructureContext,
    tpPrice: number,
    direction: 'buy' | 'sell'
  ): boolean {
    const tolerance = 0.2; // 0.2 price units tolerance for "equal" levels

    if (direction === 'buy') {
      // For longs: check if TP is at/above equal highs
      const swingHighs = structure.swingHighs || [];
      let equalHighsCount = 0;
      
      for (const high of swingHighs) {
        if (Math.abs(tpPrice - high) <= tolerance || tpPrice >= high) {
          equalHighsCount++;
        }
      }

      // If TP is at 2+ equal highs, it's heavy liquidity
      if (equalHighsCount >= 2) {
        return true;
      }

      // Check recent candles for equal highs near TP
      const recentCandles = candles.slice(-20);
      let recentEqualHighs = 0;
      for (const candle of recentCandles) {
        if (Math.abs(candle.high - tpPrice) <= tolerance) {
          recentEqualHighs++;
        }
      }
      if (recentEqualHighs >= 2) {
        return true; // Multiple equal highs near TP
      }
    } else {
      // For shorts: check if TP is at/below equal lows
      const swingLows = structure.swingLows || [];
      let equalLowsCount = 0;
      
      for (const low of swingLows) {
        if (Math.abs(tpPrice - low) <= tolerance || tpPrice <= low) {
          equalLowsCount++;
        }
      }

      // If TP is at 2+ equal lows, it's heavy liquidity
      if (equalLowsCount >= 2) {
        return true;
      }

      // Check recent candles for equal lows near TP
      const recentCandles = candles.slice(-20);
      let recentEqualLows = 0;
      for (const candle of recentCandles) {
        if (Math.abs(candle.low - tpPrice) <= tolerance) {
          recentEqualLows++;
        }
      }
      if (recentEqualLows >= 2) {
        return true; // Multiple equal lows near TP
      }
    }

    return false; // TP is not in heavy liquidity
  }

  /**
   * IMPROVED: Validate path to TP is clear (no major resistance/support blocking the way)
   * This ensures TP is actually achievable
   */
  private validateTPPath(
    candles: Candle[],
    structure: import('./types').MarketStructureContext,
    entryPrice: number,
    tpPrice: number,
    direction: 'buy' | 'sell'
  ): boolean {
    if (direction === 'buy') {
      // For longs: check if there are swing highs between entry and TP
      const swingHighs = structure.swingHighs || [];
      for (const high of swingHighs) {
        if (high > entryPrice && high < tpPrice) {
          // Check if this high is significant (within 0.5% of TP path)
          const pathDistance = tpPrice - entryPrice;
          const highDistance = high - entryPrice;
          // If resistance is in the way (within 80% of path), it's blocked
          if (highDistance / pathDistance < 0.8) {
            return false; // Path blocked by resistance
          }
        }
      }
    } else {
      // For shorts: check if there are swing lows between entry and TP
      const swingLows = structure.swingLows || [];
      for (const low of swingLows) {
        if (low < entryPrice && low > tpPrice) {
          // Check if this low is significant (within 0.5% of TP path)
          const pathDistance = entryPrice - tpPrice;
          const lowDistance = entryPrice - low;
          // If support is in the way (within 80% of path), it's blocked
          if (lowDistance / pathDistance < 0.8) {
            return false; // Path blocked by support
          }
        }
      }
    }
    
    return true; // Path is clear
  }

  /**
   * EXPERT: Check pullback confirmation - price must have retested zone after sweep
   * This ensures we're entering on a proper pullback, not immediately after sweep
   */
  private checkPullbackConfirmation(
    candles: Candle[],
    structure: import('./types').MarketStructureContext,
    bias: 'bullish' | 'bearish',
    itfZone: ITFSetupZone,
    currentPrice: number
  ): boolean {
    if (candles.length < 10) return false;

    const recentCandles = candles.slice(-15); // Check last 15 candles

    if (bias === 'bullish') {
      // For bullish: price should have swept low, then pulled back into zone
      // Check if there's a recent low below zone, then price came back up
      let sweepFound = false;
      let pullbackFound = false;

      for (let i = 0; i < recentCandles.length - 3; i++) {
        const candle = recentCandles[i];
        // Check for sweep (price went below zone minimum)
        if (candle.low < itfZone.priceMin * 0.999) {
          sweepFound = true;
          // Check if price pulled back into zone after sweep
          for (let j = i + 1; j < recentCandles.length; j++) {
            if (recentCandles[j].close >= itfZone.priceMin && recentCandles[j].close <= itfZone.priceMax) {
              pullbackFound = true;
              break;
            }
          }
          break;
        }
      }

      return sweepFound && pullbackFound;
    } else {
      // For bearish: price should have swept high, then pulled back into zone
      let sweepFound = false;
      let pullbackFound = false;

      for (let i = 0; i < recentCandles.length - 3; i++) {
        const candle = recentCandles[i];
        // Check for sweep (price went above zone maximum)
        if (candle.high > itfZone.priceMax * 1.001) {
          sweepFound = true;
          // Check if price pulled back into zone after sweep
          for (let j = i + 1; j < recentCandles.length; j++) {
            if (recentCandles[j].close >= itfZone.priceMin && recentCandles[j].close <= itfZone.priceMax) {
              pullbackFound = true;
              break;
            }
          }
          break;
        }
      }

      return sweepFound && pullbackFound;
    }
  }

  /**
   * EXPERT: Check momentum confirmation - recent candles must be moving in bias direction
   * This ensures we're not entering against momentum
   */
  private checkMomentumConfirmation(
    candles: Candle[],
    bias: 'bullish' | 'bearish'
  ): boolean {
    if (candles.length < 5) return false;

    const recentCandles = candles.slice(-5); // Check last 5 candles
    let inDirectionCount = 0;

    for (let i = 1; i < recentCandles.length; i++) {
      const prevCandle = recentCandles[i - 1];
      const currentCandle = recentCandles[i];

      if (bias === 'bullish') {
        // Bullish: price should be moving up
        if (currentCandle.close > prevCandle.close) {
          inDirectionCount++;
        }
      } else {
        // Bearish: price should be moving down
        if (currentCandle.close < prevCandle.close) {
          inDirectionCount++;
        }
      }
    }

    // At least 2 out of 4 recent candles should be in direction (50% momentum - more lenient)
    return inDirectionCount >= 2;
  }
}

