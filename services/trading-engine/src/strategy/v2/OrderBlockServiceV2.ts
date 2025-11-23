/**
 * OrderBlockServiceV2 - Multi-timeframe Order Block Detection (SMC v2)
 * 
 * Detects Order Blocks on HTF, ITF, and LTF
 * Requires multi-timeframe confirmation
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { OrderBlockV2 } from './types';

const logger = new Logger('OrderBlockServiceV2');

export class OrderBlockServiceV2 {
  private minWickToBodyRatio: number; // Minimum wick-to-body ratio for OB
  private lookbackPeriod: number;

  constructor(minWickToBodyRatio: number = 0.5, lookbackPeriod: number = 50) {
    this.minWickToBodyRatio = minWickToBodyRatio;
    this.lookbackPeriod = lookbackPeriod;
  }

  /**
   * Detect Order Blocks on a timeframe
   */
  detectOrderBlocks(
    candles: Candle[],
    timeframe: 'HTF' | 'ITF' | 'LTF',
    trend: 'bullish' | 'bearish' | 'sideways'
  ): OrderBlockV2[] {
    if (candles.length < 5 || trend === 'sideways') return [];

    const orderBlocks: OrderBlockV2[] = [];
    const recent = candles.slice(-this.lookbackPeriod);

    // Look for last strong bullish/bearish candle with large wick
    for (let i = recent.length - 1; i >= 1; i--) {
      const candle = recent[i];
      const prevCandle = recent[i - 1];

      // Bullish Order Block: strong bullish candle with large lower wick
      if (trend === 'bullish' && candle.close > candle.open) {
        const body = Math.abs(candle.close - candle.open);
        const lowerWick = candle.open - candle.low;
        const wickToBodyRatio = body > 0 ? lowerWick / body : 0;

        if (wickToBodyRatio >= this.minWickToBodyRatio && candle.close > prevCandle.high) {
          orderBlocks.push({
            type: 'bullish',
            high: candle.high,
            low: candle.low,
            timestamp: candle.endTime,
            timeframe,
            mitigated: false,
            wickToBodyRatio,
            volumeImbalance: this.checkVolumeImbalance(candle, recent.slice(0, i)),
            candleIndex: candles.length - recent.length + i,
          });
        }
      }

      // Bearish Order Block: strong bearish candle with large upper wick
      if (trend === 'bearish' && candle.close < candle.open) {
        const body = Math.abs(candle.close - candle.open);
        const upperWick = candle.high - candle.open;
        const wickToBodyRatio = body > 0 ? upperWick / body : 0;

        if (wickToBodyRatio >= this.minWickToBodyRatio && candle.close < prevCandle.low) {
          orderBlocks.push({
            type: 'bearish',
            high: candle.high,
            low: candle.low,
            timestamp: candle.endTime,
            timeframe,
            mitigated: false,
            wickToBodyRatio,
            volumeImbalance: this.checkVolumeImbalance(candle, recent.slice(0, i)),
            candleIndex: candles.length - recent.length + i,
          });
        }
      }
    }

    return orderBlocks;
  }

  /**
   * Check if Order Block is mitigated (price has broken through opposite side)
   */
  isMitigated(
    orderBlock: OrderBlockV2,
    candles: Candle[],
    currentPrice: number
  ): boolean {
    // Check if price has broken through opposite side
    if (orderBlock.type === 'bullish') {
      return currentPrice < orderBlock.low;
    } else {
      return currentPrice > orderBlock.high;
    }
  }

  /**
   * Get most recent unmitigated Order Block
   */
  getMostRecentUnmitigatedOB(
    orderBlocks: OrderBlockV2[],
    currentPrice: number
  ): OrderBlockV2 | undefined {
    // Filter unmitigated OBs
    const unmitigated = orderBlocks.filter(ob => !ob.mitigated && !this.isMitigated(ob, [], currentPrice));

    if (unmitigated.length === 0) return undefined;

    // Sort by timestamp (most recent first)
    unmitigated.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return unmitigated[0];
  }

  /**
   * Check volume imbalance for Order Block candle
   */
  private checkVolumeImbalance(candle: Candle, previousCandles: Candle[]): boolean {
    if (previousCandles.length < 5) return false;

    // Calculate average volume
    const avgVolume = previousCandles.reduce((sum, c) => sum + c.volume, 0) / previousCandles.length;

    // Check if OB candle has significantly higher volume
    return candle.volume > avgVolume * 1.5; // 50% above average
  }

  /**
   * Check if multiple timeframes have aligned Order Blocks
   */
  areOBsAligned(
    htfOB: OrderBlockV2 | undefined,
    itfOB: OrderBlockV2 | undefined,
    ltfOB: OrderBlockV2 | undefined,
    direction: 'buy' | 'sell'
  ): boolean {
    // ITF OB is required
    if (!itfOB) return false;

    // If HTF OB exists, check alignment between HTF and ITF
    if (htfOB) {
      // Check if HTF and ITF OBs are aligned (overlapping or nearby)
      const htfRange = { high: htfOB.high, low: htfOB.low };
      const itfRange = { high: itfOB.high, low: itfOB.low };

      // Check overlap
      const overlap = !(htfRange.high < itfRange.low || htfRange.low > itfRange.high);
      
      if (!overlap) {
        // Check proximity (within 0.1% of average price)
        const avgPrice = (htfRange.high + htfRange.low + itfRange.high + itfRange.low) / 4;
        const tolerance = avgPrice * 0.001; // 0.1%
        const proximity = Math.abs((htfRange.high + htfRange.low) / 2 - (itfRange.high + itfRange.low) / 2) < tolerance;
        
        if (!proximity) return false;
      }
    }

    // For LTF, check if it confirms entry
    if (ltfOB) {
      // LTF OB should be in same direction
      if (direction === 'buy' && ltfOB.type !== 'bullish') return false;
      if (direction === 'sell' && ltfOB.type !== 'bearish') return false;
    }

    // ITF OB type must match direction
    if (direction === 'buy' && itfOB.type !== 'bullish') return false;
    if (direction === 'sell' && itfOB.type !== 'bearish') return false;

    return true;
  }
}


