/**
 * HTFBiasService - Computes H4 directional bias using BOS count, CHoCH/MSB, and displacement
 * 
 * This service determines HTF bias independently of formalTrend, allowing trades
 * even when formalTrend is "sideways".
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { MarketStructureHTF } from './MarketStructureHTF';

const logger = new Logger('HTFBiasService');

export type Bias = 'bullish' | 'bearish' | 'neutral';

export interface HTFBiasResult {
  bias: Bias;
  anchorSwing: 'high' | 'low' | null;
  anchorPrice: number | null;
  method: 'bosCount' | 'choch' | 'displacement' | 'none';
  bullishBosCount: number;
  bearishBosCount: number;
}

export class HTFBiasService {
  private htfStructure: MarketStructureHTF;
  private lookbackCandles: number;

  constructor(lookbackCandles: number = 12) {
    this.htfStructure = new MarketStructureHTF(50);
    this.lookbackCandles = lookbackCandles;
  }

  /**
   * Compute HTF bias using BOS count, CHoCH/MSB, or displacement fallback
   */
  computeHTFBias(candles: Candle[]): HTFBiasResult {
    if (candles.length < 3) {
      return {
        bias: 'neutral',
        anchorSwing: null,
        anchorPrice: null,
        method: 'none',
        bullishBosCount: 0,
        bearishBosCount: 0,
      };
    }

    // Use last N candles for analysis
    const lookbackCandles = candles.slice(-this.lookbackCandles);
    const structure = this.htfStructure.analyzeStructure(lookbackCandles);

    // Count BOS events by direction
    let bullishBosCount = 0;
    let bearishBosCount = 0;

    if (structure.bosEvents) {
      for (const event of structure.bosEvents) {
        if (event.type === 'BOS') {
          // Infer direction from price movement
          const eventIndex = event.index;
          if (eventIndex < lookbackCandles.length) {
            const eventCandle = lookbackCandles[eventIndex];
            const prevSwingHigh = structure.swingHighs?.slice(-1)[0];
            const prevSwingLow = structure.swingLows?.slice(-1)[0];
            
            if (prevSwingHigh && event.price >= prevSwingHigh) {
              bullishBosCount++;
            } else if (prevSwingLow && event.price <= prevSwingLow) {
              bearishBosCount++;
            } else if (eventIndex > 0) {
              const prevCandle = lookbackCandles[eventIndex - 1];
              if (eventCandle.close > prevCandle.close) {
                bullishBosCount++;
              } else {
                bearishBosCount++;
              }
            }
          }
        } else if (event.type === 'CHoCH' || event.type === 'MSB') {
          // CHoCH/MSB indicate trend reversal
          // Bullish CHoCH/MSB = bearish to bullish
          // Bearish CHoCH/MSB = bullish to bearish
          const eventIndex = event.index;
          if (eventIndex < lookbackCandles.length && eventIndex > 0) {
            const prevCandle = lookbackCandles[eventIndex - 1];
            const eventCandle = lookbackCandles[eventIndex];
            if (eventCandle.close > prevCandle.close * 1.001) {
              bullishBosCount++; // Bullish CHoCH
            } else if (eventCandle.close < prevCandle.close * 0.999) {
              bearishBosCount++; // Bearish CHoCH
            }
          }
        }
      }
    }

    // Primary rule: BOS count
    if (bullishBosCount >= bearishBosCount + 2) {
      const anchorSwing = structure.swingLow ? 'low' : null;
      const anchorPrice = structure.swingLow || null;
      return {
        bias: 'bullish',
        anchorSwing,
        anchorPrice,
        method: 'bosCount',
        bullishBosCount,
        bearishBosCount,
      };
    }

    if (bearishBosCount >= bullishBosCount + 2) {
      const anchorSwing = structure.swingHigh ? 'high' : null;
      const anchorPrice = structure.swingHigh || null;
      return {
        bias: 'bearish',
        anchorSwing,
        anchorPrice,
        method: 'bosCount',
        bullishBosCount,
        bearishBosCount,
      };
    }

    // Secondary rule: Most recent CHoCH/MSB
    if (structure.bosEvents && structure.bosEvents.length > 0) {
      const lastEvent = structure.bosEvents[structure.bosEvents.length - 1];
      if (lastEvent.type === 'CHoCH' || lastEvent.type === 'MSB') {
        const eventIndex = lastEvent.index;
        if (eventIndex < lookbackCandles.length && eventIndex > 0) {
          const prevCandle = lookbackCandles[eventIndex - 1];
          const eventCandle = lookbackCandles[eventIndex];
          if (eventCandle.close > prevCandle.close * 1.001) {
            return {
              bias: 'bullish',
              anchorSwing: structure.swingLow ? 'low' : null,
              anchorPrice: structure.swingLow || null,
              method: 'choch',
              bullishBosCount,
              bearishBosCount,
            };
          } else if (eventCandle.close < prevCandle.close * 0.999) {
            return {
              bias: 'bearish',
              anchorSwing: structure.swingHigh ? 'high' : null,
              anchorPrice: structure.swingHigh || null,
              method: 'choch',
              bullishBosCount,
              bearishBosCount,
            };
          }
        }
      }
    }

    // Tertiary rule: Displacement (similar to ICT PD fallback)
    if (structure.swingHigh && structure.swingLow) {
      const mid = (structure.swingHigh + structure.swingLow) / 2;
      const lastClose = lookbackCandles[lookbackCandles.length - 1].close;
      
      if (lastClose > mid) {
        return {
          bias: 'bullish',
          anchorSwing: 'low',
          anchorPrice: structure.swingLow,
          method: 'displacement',
          bullishBosCount,
          bearishBosCount,
        };
      } else if (lastClose < mid) {
        return {
          bias: 'bearish',
          anchorSwing: 'high',
          anchorPrice: structure.swingHigh,
          method: 'displacement',
          bullishBosCount,
          bearishBosCount,
        };
      }
    }

    // Fallback: neutral (truly dead market)
    return {
      bias: 'neutral',
      anchorSwing: null,
      anchorPrice: null,
      method: 'none',
      bullishBosCount,
      bearishBosCount,
    };
  }
}

