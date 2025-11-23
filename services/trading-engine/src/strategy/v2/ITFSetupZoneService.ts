/**
 * ITFSetupZoneService - Computes M15 setup zones (Order Blocks + FVGs) aligned with H4 bias
 * 
 * This service finds valid setup zones on M15 even when M15 formalTrend is sideways,
 * as long as the structure is aligned with the H4 bias direction.
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { MarketStructureITF } from './MarketStructureITF';
import { OrderBlockServiceV2 } from './OrderBlockServiceV2';
import { FairValueGapService } from './FairValueGapService';
import { OrderBlockV2, FairValueGap } from './types';
import { HTFBiasResult, Bias } from './HTFBiasService';

const logger = new Logger('ITFSetupZoneService');

export interface ITFSetupZone {
  isAlignedWithHTF: boolean;
  direction: 'bullish' | 'bearish';
  zoneType: 'orderBlock' | 'fvg' | 'both';
  priceMin: number;
  priceMax: number;
  sourceTime: Date;
  orderBlock?: OrderBlockV2;
  fvg?: FairValueGap;
}

export class ITFSetupZoneService {
  private itfStructure: MarketStructureITF;
  private obService: OrderBlockServiceV2;
  private fvgService: FairValueGapService;
  private bosLookback: number;

  constructor() {
    this.itfStructure = new MarketStructureITF(30);
    this.obService = new OrderBlockServiceV2(0.5, 50);
    this.fvgService = new FairValueGapService(0.0001, 50);
    this.bosLookback = 10; // Look back last 10 BOS events for alignment check
  }

  /**
   * Compute ITF setup zone aligned with H4 bias
   */
  computeITFSetupZone(
    candles: Candle[],
    htfBias: HTFBiasResult,
    currentPrice: number
  ): ITFSetupZone | null {
    if (htfBias.bias === 'neutral') {
      return null;
    }

    if (candles.length < 20) {
      return null;
    }

    // Analyze ITF structure
    const structure = this.itfStructure.analyzeStructure(candles, htfBias.bias === 'bullish' ? 'bullish' : 'bearish');

    // Check ITF flow alignment with H4 bias
    const isAligned = this.checkITFFlowAlignment(candles, structure, htfBias.bias);
    
    if (!isAligned) {
      return null;
    }

    // Find Order Blocks and FVGs aligned with H4 bias
    const direction = htfBias.bias === 'bullish' ? 'bullish' : 'bearish';
    const obs = this.obService.detectOrderBlocks(candles, 'ITF', direction);
    const fvgs = this.fvgService.detectFVGs(candles, 'ITF', 'neutral');

    // Filter for relevant OBs/FVGs
    const relevantOB = this.findRelevantOrderBlock(obs, htfBias.bias, currentPrice, structure);
    const relevantFVG = this.findRelevantFVG(fvgs, htfBias.bias, currentPrice, structure);

    if (!relevantOB && !relevantFVG) {
      return null;
    }

    // Build zone from OB and/or FVG
    let priceMin = Infinity;
    let priceMax = -Infinity;
    let sourceTime: Date | null = null;
    let zoneType: 'orderBlock' | 'fvg' | 'both' = relevantOB && relevantFVG ? 'both' : (relevantOB ? 'orderBlock' : 'fvg');

    if (relevantOB) {
      priceMin = Math.min(priceMin, relevantOB.low);
      priceMax = Math.max(priceMax, relevantOB.high);
      const obTime = relevantOB.timestamp;
      if (!sourceTime || (obTime instanceof Date && sourceTime instanceof Date && obTime.getTime() > sourceTime.getTime())) {
        sourceTime = obTime;
      }
    }

    if (relevantFVG) {
      priceMin = Math.min(priceMin, relevantFVG.low);
      priceMax = Math.max(priceMax, relevantFVG.high);
      const fvgTime = relevantFVG.timestamp;
      if (!sourceTime || (fvgTime instanceof Date && sourceTime instanceof Date && fvgTime.getTime() > sourceTime.getTime())) {
        sourceTime = fvgTime;
      }
    }

    if (priceMin === Infinity || priceMax === -Infinity || !sourceTime) {
      return null;
    }

    return {
      isAlignedWithHTF: true,
      direction,
      zoneType,
      priceMin,
      priceMax,
      sourceTime,
      orderBlock: relevantOB,
      fvg: relevantFVG,
    };
  }

  /**
   * Check if ITF flow is aligned with H4 bias
   */
  private checkITFFlowAlignment(
    candles: Candle[],
    structure: import('./types').MarketStructureContext,
    htfBias: Bias
  ): boolean {
    if (htfBias === 'neutral') {
      return false;
    }

    // Check swing structure alignment
    if (htfBias === 'bullish') {
      // Bullish alignment: last swing structure should be HL → HH
      const swingHighs = structure.swingHighs || [];
      const swingLows = structure.swingLows || [];
      
      if (swingHighs.length >= 2 && swingLows.length >= 1) {
        const lastHigh = swingHighs[swingHighs.length - 1];
        const prevHigh = swingHighs[swingHighs.length - 2];
        const lastLow = swingLows[swingLows.length - 1];
        
        // HL → HH pattern: last high > previous high, and last low > previous low (if exists)
        if (lastHigh > prevHigh) {
          return true;
        }
      }
    } else {
      // Bearish alignment: last swing structure should be LH → LL
      const swingHighs = structure.swingHighs || [];
      const swingLows = structure.swingLows || [];
      
      if (swingLows.length >= 2 && swingHighs.length >= 1) {
        const lastLow = swingLows[swingLows.length - 1];
        const prevLow = swingLows[swingLows.length - 2];
        const lastHigh = swingHighs[swingHighs.length - 1];
        
        // LH → LL pattern: last low < previous low, and last high < previous high (if exists)
        if (lastLow < prevLow) {
          return true;
        }
      }
    }

    // Check BOS count alignment
    if (structure.bosEvents && structure.bosEvents.length > 0) {
      const recentBOS = structure.bosEvents.slice(-this.bosLookback);
      let bullishBosCount = 0;
      let bearishBosCount = 0;

      for (const event of recentBOS) {
        if (event.type === 'BOS') {
          const eventIndex = event.index;
          if (eventIndex < candles.length) {
            const eventCandle = candles[eventIndex];
            const prevSwingHigh = structure.swingHighs?.slice(-1)[0];
            const prevSwingLow = structure.swingLows?.slice(-1)[0];
            
            if (prevSwingHigh && event.price >= prevSwingHigh) {
              bullishBosCount++;
            } else if (prevSwingLow && event.price <= prevSwingLow) {
              bearishBosCount++;
            } else if (eventIndex > 0) {
              const prevCandle = candles[eventIndex - 1];
              if (eventCandle.close > prevCandle.close) {
                bullishBosCount++;
              } else {
                bearishBosCount++;
              }
            }
          }
        }
      }

      if (htfBias === 'bullish' && bullishBosCount >= bearishBosCount) {
        return true;
      }
      if (htfBias === 'bearish' && bearishBosCount >= bullishBosCount) {
        return true;
      }
    }

    return false;
  }

  /**
   * Find relevant Order Block for the setup
   */
  private findRelevantOrderBlock(
    obs: OrderBlockV2[],
    htfBias: Bias,
    currentPrice: number,
    structure: import('./types').MarketStructureContext
  ): OrderBlockV2 | undefined {
    if (htfBias === 'neutral') {
      return undefined;
    }

    // For bullish setups: find last bearish OB that caused a bullish BOS
    // For bearish setups: find last bullish OB that caused a bearish BOS
    const targetOBType = htfBias === 'bullish' ? 'bearish' : 'bullish';
    
    // Filter OBs by type and find the most recent one
    const relevantOBs = obs
      .filter(ob => ob.type === targetOBType && !ob.mitigated)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (relevantOBs.length === 0) {
      return undefined;
    }

    // Return the most recent relevant OB
    return relevantOBs[0];
  }

  /**
   * Find relevant Fair Value Gap for the setup
   */
  private findRelevantFVG(
    fvgs: FairValueGap[],
    htfBias: Bias,
    currentPrice: number,
    structure: import('./types').MarketStructureContext
  ): FairValueGap | undefined {
    if (htfBias === 'neutral') {
      return undefined;
    }

    // For bullish setups: find bullish FVG below current price but above last swing low
    // For bearish setups: find bearish FVG above current price but below last swing high
    const lastSwingLow = structure.swingLow;
    const lastSwingHigh = structure.swingHigh;

    const relevantFVGs = fvgs
      .filter(fvg => {
        if (htfBias === 'bullish') {
          // Bullish FVG below current price, above last swing low
          return fvg.low < currentPrice && 
                 (!lastSwingLow || fvg.low > lastSwingLow) &&
                 !fvg.filled;
        } else {
          // Bearish FVG above current price, below last swing high
          return fvg.high > currentPrice && 
                 (!lastSwingHigh || fvg.high < lastSwingHigh) &&
                 !fvg.filled;
        }
      })
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (relevantFVGs.length === 0) {
      return undefined;
    }

    // Return the most recent relevant FVG
    return relevantFVGs[0];
  }
}

