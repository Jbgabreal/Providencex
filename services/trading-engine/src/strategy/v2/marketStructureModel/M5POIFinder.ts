/**
 * M5POIFinder - Finds 5m Point of Interest (POI) for Market Structure Strategy
 * 
 * Identifies structural OB/FVG zones in the 5m timeframe that serve as
 * entry points and SL anchors for the MSM strategy.
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../../marketData/types';
import { OrderBlockServiceV2 } from '../OrderBlockServiceV2';
import { FairValueGapService } from '../FairValueGapService';
import { LiquiditySweepService, LiquiditySweepResult } from '../LiquiditySweepService';
import { OrderBlockV2, FairValueGap } from '../types';
import { MSMSetupZone } from './types';
import { ExternalRange } from './types';
import { getDiscountOrPremium, isWithinRange } from './RangeUtils';

const logger = new Logger('M5POIFinder');

export class M5POIFinder {
  private obService: OrderBlockServiceV2;
  private fvgService: FairValueGapService;
  private liquiditySweepService: LiquiditySweepService;

  constructor() {
    this.obService = new OrderBlockServiceV2(0.5, 50); // minWickRatio, lookback
    this.fvgService = new FairValueGapService(0.0001, 50); // minGapSize, lookback
    this.liquiditySweepService = new LiquiditySweepService(0.0001, 50); // tolerance, lookback
  }

  /**
   * Find 5m setup zone in discount (bullish) or premium (bearish) of ITF range
   */
  findSetupZone(
    m5Candles: Candle[],
    direction: 'bullish' | 'bearish',
    itfRange: ExternalRange,
    currentPrice: number
  ): MSMSetupZone | null {
    if (m5Candles.length < 10) {
      return null;
    }

    if (!itfRange.swingLow || !itfRange.swingHigh) {
      return null;
    }

    // Determine if we're looking for discount (bullish) or premium (bearish) zone
    const targetZone = direction === 'bullish' ? 'discount' : 'premium';

    // Check if current price is in the target zone
    if (!itfRange.swingLow || !itfRange.swingHigh) {
      return null;
    }
    
    const currentZone = getDiscountOrPremium(currentPrice, {
      swingLow: itfRange.swingLow,
      swingHigh: itfRange.swingHigh,
    });

    if (currentZone !== targetZone && currentZone !== 'mid') {
      return null; // Price is not in the target zone
    }

    // Detect order blocks
    const orderBlocks = this.obService.detectOrderBlocks(
      m5Candles,
      'ITF', // Using ITF as timeframe identifier
      direction
    );

    // Detect FVGs
    const fvgs = this.fvgService.detectFVGs(
      m5Candles,
      'ITF',
      targetZone === 'discount' ? 'discount' : 'premium'
    );

    // Filter OBs and FVGs that are in the target zone and unmitigated
    const relevantOBs = this.filterOrderBlocksInZone(
      orderBlocks,
      itfRange,
      targetZone,
      currentPrice
    );

    const relevantFVGs = this.filterFVGsInZone(
      fvgs,
      itfRange,
      targetZone,
      currentPrice
    );

    // Check for liquidity sweeps
    const sweeps = this.liquiditySweepService.detectSweeps(m5Candles, 'ITF');
    const hasLiquiditySweep = this.checkLiquiditySweepNearZone(
      sweeps,
      relevantOBs,
      relevantFVGs,
      direction
    );

    // Find the best setup zone (prioritize OB over FVG, prefer with liquidity sweep)
    let setupZone: MSMSetupZone | null = null;

    // Try OB first
    if (relevantOBs.length > 0) {
      const bestOB = relevantOBs[0]; // Most recent
      setupZone = this.createSetupZoneFromOB(
        bestOB,
        relevantFVGs,
        hasLiquiditySweep,
        m5Candles
      );
    }

    // Fallback to FVG if no OB
    if (!setupZone && relevantFVGs.length > 0) {
      const bestFVG = relevantFVGs[0]; // Most recent
      setupZone = this.createSetupZoneFromFVG(
        bestFVG,
        hasLiquiditySweep,
        m5Candles
      );
    }

    return setupZone;
  }

  /**
   * Filter order blocks that are in the target zone and unmitigated
   */
  private filterOrderBlocksInZone(
    obs: OrderBlockV2[],
    range: ExternalRange,
    targetZone: 'discount' | 'premium',
    currentPrice: number
  ): OrderBlockV2[] {
    if (!range.swingLow || !range.swingHigh) {
      return [];
    }

    // Early return if range is invalid
    if (!range.swingLow || !range.swingHigh) {
      return [];
    }

    return obs
      .filter(ob => {
        // Check if OB is unmitigated
        if (ob.type === 'bullish' && currentPrice < ob.low) {
          return false; // Mitigated
        }
        if (ob.type === 'bearish' && currentPrice > ob.high) {
          return false; // Mitigated
        }

        // Check if OB is in target zone
        const obMid = (ob.high + ob.low) / 2;
        const zone = getDiscountOrPremium(obMid, {
          swingLow: range.swingLow!,
          swingHigh: range.swingHigh!,
        });

        return zone === targetZone || zone === 'mid';
      })
      .sort((a, b) => b.candleIndex - a.candleIndex); // Most recent first
  }

  /**
   * Filter FVGs that are in the target zone and unfilled
   */
  private filterFVGsInZone(
    fvgs: FairValueGap[],
    range: ExternalRange,
    targetZone: 'discount' | 'premium',
    currentPrice: number
  ): FairValueGap[] {
    if (!range.swingLow || !range.swingHigh) {
      return [];
    }

    return fvgs
      .filter(fvg => {
        // Check if FVG is unfilled
        if (fvg.filled) {
          return false;
        }

        // Check if current price is within or near FVG
        const inFVG = currentPrice >= fvg.low && currentPrice <= fvg.high;

        // Check if FVG is in target zone (range already validated above)
        const fvgMid = (fvg.high + fvg.low) / 2;
        const zone = getDiscountOrPremium(fvgMid, {
          swingLow: range.swingLow!,
          swingHigh: range.swingHigh!,
        });

        return (zone === targetZone || zone === 'mid') && (inFVG || currentPrice < fvg.high);
      })
      .sort((a, b) => {
        // Most recent first (by timestamp)
        return b.timestamp.getTime() - a.timestamp.getTime();
      });
  }

  /**
   * Check if liquidity sweep occurred near the setup zone
   */
  private checkLiquiditySweepNearZone(
    sweeps: LiquiditySweepResult[],
    obs: OrderBlockV2[],
    fvgs: FairValueGap[],
    direction: 'bullish' | 'bearish'
  ): boolean {
    if (sweeps.length === 0) {
      return false;
    }

    // For bearish, look for EQH sweep above the zone
    if (direction === 'bearish') {
      const eqhSweeps = sweeps.filter(s => s.type === 'EQH');
      if (obs.length > 0) {
        const obHigh = obs[0].high;
        return eqhSweeps.some(s => Math.abs(s.level - obHigh) < obHigh * 0.001); // Within 0.1%
      }
      if (fvgs.length > 0) {
        const fvgHigh = fvgs[0].high;
        return eqhSweeps.some(s => Math.abs(s.level - fvgHigh) < fvgHigh * 0.001);
      }
    }

    // For bullish, look for EQL sweep below the zone
    if (direction === 'bullish') {
      const eqlSweeps = sweeps.filter(s => s.type === 'EQL');
      if (obs.length > 0) {
        const obLow = obs[0].low;
        return eqlSweeps.some(s => Math.abs(s.level - obLow) < obLow * 0.001);
      }
      if (fvgs.length > 0) {
        const fvgLow = fvgs[0].low;
        return eqlSweeps.some(s => Math.abs(s.level - fvgLow) < fvgLow * 0.001);
      }
    }

    return false;
  }

  /**
   * Create setup zone from Order Block
   */
  private createSetupZoneFromOB(
    ob: OrderBlockV2,
    fvgs: FairValueGap[],
    hasLiquiditySweep: boolean,
    candles: Candle[]
  ): MSMSetupZone {
    // Check if there's a nearby FVG that we should combine
    const nearbyFVG = fvgs.find(fvg => {
      const obMid = (ob.high + ob.low) / 2;
      const fvgMid = (fvg.high + fvg.low) / 2;
      const distance = Math.abs(obMid - fvgMid);
      return distance < obMid * 0.002; // Within 0.2%
    });

    let priceMin: number;
    let priceMax: number;
    let structuralExtreme: number;

    if (ob.type === 'bearish') {
      // Bearish OB: structural extreme is the high
      structuralExtreme = ob.high;
      priceMin = ob.low;
      priceMax = nearbyFVG ? Math.max(ob.high, nearbyFVG.high) : ob.high;
    } else {
      // Bullish OB: structural extreme is the low
      structuralExtreme = ob.low;
      priceMin = nearbyFVG ? Math.min(ob.low, nearbyFVG.low) : ob.low;
      priceMax = ob.high;
    }

    return {
      direction: ob.type === 'bullish' ? 'bullish' : 'bearish',
      tf: 'M5',
      priceMin,
      priceMax,
      structuralExtreme,
      refType: nearbyFVG ? 'both' : 'orderBlock',
      hasLiquiditySweep,
      obIndex: ob.candleIndex,
      fvgIndex: nearbyFVG ? nearbyFVG.candleIndices[1] : undefined,
    };
  }

  /**
   * Create setup zone from Fair Value Gap
   */
  private createSetupZoneFromFVG(
    fvg: FairValueGap,
    hasLiquiditySweep: boolean,
    candles: Candle[]
  ): MSMSetupZone {
    // Determine direction from FVG type and premium/discount
    const direction: 'bullish' | 'bearish' = 
      (fvg.premiumDiscount === 'discount' || 
       (fvg.type === 'continuation' && fvg.premiumDiscount === 'neutral')) 
      ? 'bullish' 
      : 'bearish';

    // Structural extreme depends on direction
    const structuralExtreme = direction === 'bearish' ? fvg.high : fvg.low;

    return {
      direction,
      tf: 'M5',
      priceMin: fvg.low,
      priceMax: fvg.high,
      structuralExtreme,
      refType: 'fvg',
      hasLiquiditySweep,
      fvgIndex: fvg.candleIndices[1],
    };
  }
}

