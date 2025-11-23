/**
 * M1ExecutionService - Executes trades on M1 when price is in M15 setup zone and micro CHoCH/MSB occurs
 * 
 * This service handles the final execution logic on M1 timeframe.
 */

import { Logger } from '@providencex/shared-utils';
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
    type: 'CHoCH' | 'MSB';
    index: number;
    price: number;
  };
}

export class M1ExecutionService {
  private ltfStructure: MarketStructureLTF;
  private riskRewardRatio: number;

  constructor(riskRewardRatio: number = 2.0) {
    this.ltfStructure = new MarketStructureLTF(20);
    this.riskRewardRatio = riskRewardRatio;
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

    // Check for micro CHoCH/MSB in the direction of H4 bias
    const microChoch = this.detectMicroChoch(candles, structure, htfBias.bias, itfZone);

    if (!microChoch) {
      return { shouldEnter: false, reason: 'No micro CHoCH/MSB detected' };
    }

    // Calculate entry, stop, and TP
    if (htfBias.bias === 'bullish') {
      return this.calculateBullishEntry(candles, structure, microChoch, itfZone, currentPrice);
    } else {
      return this.calculateBearishEntry(candles, structure, microChoch, itfZone, currentPrice);
    }
  }

  /**
   * Detect micro CHoCH/MSB on M1
   */
  private detectMicroChoch(
    candles: Candle[],
    structure: import('./types').MarketStructureContext,
    htfBias: 'bullish' | 'bearish',
    itfZone: ITFSetupZone
  ): { type: 'CHoCH' | 'MSB'; index: number; price: number } | null {
    if (!structure.bosEvents || structure.bosEvents.length === 0) {
      return null;
    }

    // Get the most recent CHoCH or MSB event
    const recentEvents = structure.bosEvents
      .filter(e => e.type === 'CHoCH' || e.type === 'MSB')
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
    if (htfBias === 'bullish') {
      // Bullish micro CHoCH: price should have moved up
      if (eventIndex > 0) {
        const prevCandle = candles[eventIndex - 1];
        if (eventCandle.close > prevCandle.close) {
          // Check if this broke a local swing high inside the zone
          const swingHighs = structure.swingHighs || [];
          if (swingHighs.length > 0) {
            const lastSwingHigh = swingHighs[swingHighs.length - 1];
            if (lastSwingHigh >= itfZone.priceMin && lastSwingHigh <= itfZone.priceMax) {
              if (eventCandle.close > lastSwingHigh) {
                return {
                  type: lastEvent.type === 'MSB' ? 'MSB' : 'CHoCH',
                  index: eventIndex,
                  price: lastEvent.price,
                };
              }
            }
          }
        }
      }
    } else {
      // Bearish micro CHoCH: price should have moved down
      if (eventIndex > 0) {
        const prevCandle = candles[eventIndex - 1];
        if (eventCandle.close < prevCandle.close) {
          // Check if this broke a local swing low inside the zone
          const swingLows = structure.swingLows || [];
          if (swingLows.length > 0) {
            const lastSwingLow = swingLows[swingLows.length - 1];
            if (lastSwingLow >= itfZone.priceMin && lastSwingLow <= itfZone.priceMax) {
              if (eventCandle.close < lastSwingLow) {
                return {
                  type: lastEvent.type === 'MSB' ? 'MSB' : 'CHoCH',
                  index: eventIndex,
                  price: lastEvent.price,
                };
              }
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Calculate bullish entry parameters
   */
  private calculateBullishEntry(
    candles: Candle[],
    structure: import('./types').MarketStructureContext,
    microChoch: { type: 'CHoCH' | 'MSB'; index: number; price: number },
    itfZone: ITFSetupZone,
    currentPrice: number
  ): M1ExecutionResult {
    const eventCandle = candles[microChoch.index];
    if (!eventCandle) {
      return { shouldEnter: false, reason: 'Invalid micro CHoCH candle index' };
    }

    // Entry: buy stop at/beyond the high of the M1 candle that caused the bullish BOS/MSB
    const entryPrice = eventCandle.high;

    // Stop: below the most recent M1 swing low inside the zone
    const swingLows = structure.swingLows || [];
    const relevantLows = swingLows.filter(low => low >= itfZone.priceMin && low <= itfZone.priceMax);
    const stopLoss = relevantLows.length > 0 
      ? relevantLows[relevantLows.length - 1] - 0.0001 // Small buffer below swing low
      : itfZone.priceMin - 0.0001; // Fallback to zone minimum

    // TP: 2R or logical liquidity level (e.g., previous H4 high)
    const risk = entryPrice - stopLoss;
    const takeProfit = entryPrice + (risk * this.riskRewardRatio);

    return {
      shouldEnter: true,
      direction: 'buy',
      entryPrice,
      stopLoss,
      takeProfit,
      reason: `Bullish micro ${microChoch.type} in M15 zone`,
      microChoch,
    };
  }

  /**
   * Calculate bearish entry parameters
   */
  private calculateBearishEntry(
    candles: Candle[],
    structure: import('./types').MarketStructureContext,
    microChoch: { type: 'CHoCH' | 'MSB'; index: number; price: number },
    itfZone: ITFSetupZone,
    currentPrice: number
  ): M1ExecutionResult {
    const eventCandle = candles[microChoch.index];
    if (!eventCandle) {
      return { shouldEnter: false, reason: 'Invalid micro CHoCH candle index' };
    }

    // Entry: sell stop at/beyond the low of the M1 candle that caused the bearish BOS/MSB
    const entryPrice = eventCandle.low;

    // Stop: above the most recent M1 swing high inside the zone
    const swingHighs = structure.swingHighs || [];
    const relevantHighs = swingHighs.filter(high => high >= itfZone.priceMin && high <= itfZone.priceMax);
    const stopLoss = relevantHighs.length > 0 
      ? relevantHighs[relevantHighs.length - 1] + 0.0001 // Small buffer above swing high
      : itfZone.priceMax + 0.0001; // Fallback to zone maximum

    // TP: 2R or logical liquidity level
    const risk = stopLoss - entryPrice;
    const takeProfit = entryPrice - (risk * this.riskRewardRatio);

    return {
      shouldEnter: true,
      direction: 'sell',
      entryPrice,
      stopLoss,
      takeProfit,
      reason: `Bearish micro ${microChoch.type} in M15 zone`,
      microChoch,
    };
  }
}

