/**
 * BosService - Formal Break of Structure Detection (SMC Core)
 * 
 * Implements strict ICT-style BOS detection
 * Based on SMC_research.md Section 2.2
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../../marketData/types';
import { SwingPoint, BosEvent, BosConfig, CandleData, candlesToData } from './Types';

const logger = new Logger('BosService');

export class BosService {
  private config: BosConfig;

  constructor(config: Partial<BosConfig> = {}) {
    this.config = {
      bosLookbackSwings: config.bosLookbackSwings ?? 10,
      swingIndexLookback: config.swingIndexLookback ?? 100,
      strictClose: config.strictClose ?? true, // Default to ICT-style strict
    };
  }

  /**
   * Detect BOS events based on swings
   * 
   * For each candle i:
   * - Find candidate swings where s.index < i and within swingIndexLookback
   * - Bullish BOS: candle closes above (or high breaks) a swing high
   * - Bearish BOS: candle closes below (or low breaks) a swing low
   * 
   * Returns BosEvent[] sorted by index
   */
  detectBOS(candles: Candle[], swings: SwingPoint[]): BosEvent[] {
    const candleData = candlesToData(candles);
    const bosEvents: BosEvent[] = [];

    // Sort swings by index
    const swingsSorted = swings.slice().sort((a, b) => a.index - b.index);

    // For each candle, check if it breaks any prior swing
    for (let i = 0; i < candleData.length; i++) {
      const candle = candleData[i];

      // Find candidate swings within lookback
      const candidateSwings = swingsSorted.filter(
        s => s.index < i && s.index >= i - this.config.swingIndexLookback
      );

      // Check each candidate swing
      for (const swing of candidateSwings) {
        if (swing.type === 'high') {
          // Bullish BOS: break above a swing high
          const broken = this.config.strictClose
            ? candle.close > swing.price
            : candle.high > swing.price;

          if (broken) {
            // Check if we already have a BOS for this candle (deduplicate)
            const existingBos = bosEvents.find(b => b.index === i);
            if (!existingBos) {
              bosEvents.push({
                index: i,
                direction: 'bullish',
                brokenSwingIndex: swing.index,
                brokenSwingType: 'high',
                level: swing.price,
                timestamp: candle.timestamp,
                strictClose: this.config.strictClose,
              });
            } else {
              // If existing BOS, prefer the most recent swing (closest to current candle)
              if (swing.index > existingBos.brokenSwingIndex) {
                existingBos.brokenSwingIndex = swing.index;
                existingBos.brokenSwingType = 'high';
                existingBos.level = swing.price;
              }
            }
          }
        } else if (swing.type === 'low') {
          // Bearish BOS: break below a swing low
          const broken = this.config.strictClose
            ? candle.close < swing.price
            : candle.low < swing.price;

          if (broken) {
            // Check if we already have a BOS for this candle (deduplicate)
            const existingBos = bosEvents.find(b => b.index === i);
            if (!existingBos) {
              bosEvents.push({
                index: i,
                direction: 'bearish',
                brokenSwingIndex: swing.index,
                brokenSwingType: 'low',
                level: swing.price,
                timestamp: candle.timestamp,
                strictClose: this.config.strictClose,
              });
            } else {
              // If existing BOS, prefer the most recent swing (closest to current candle)
              if (swing.index > existingBos.brokenSwingIndex) {
                existingBos.brokenSwingIndex = swing.index;
                existingBos.brokenSwingType = 'low';
                existingBos.level = swing.price;
              }
            }
          }
        }
      }
    }

    // Sort by index
    return bosEvents.sort((a, b) => a.index - b.index);
  }

  /**
   * Get most recent BOS event
   */
  getLastBOS(bosEvents: BosEvent[]): BosEvent | null {
    if (bosEvents.length === 0) return null;
    return bosEvents[bosEvents.length - 1];
  }

  /**
   * Get BOS events by direction
   */
  getBOSByDirection(bosEvents: BosEvent[], direction: 'bullish' | 'bearish'): BosEvent[] {
    return bosEvents.filter(b => b.direction === direction);
  }

  /**
   * Get BOS events within a candle index range
   */
  getBOSInRange(bosEvents: BosEvent[], startIndex: number, endIndex: number): BosEvent[] {
    return bosEvents.filter(b => b.index >= startIndex && b.index <= endIndex);
  }

  /**
   * Check if a BOS occurred at a specific candle index
   */
  hasBOSAt(bosEvents: BosEvent[], index: number): boolean {
    return bosEvents.some(b => b.index === index);
  }

  /**
   * Get BOS events that broke a specific swing
   */
  getBOSForSwing(bosEvents: BosEvent[], swingIndex: number): BosEvent[] {
    return bosEvents.filter(b => b.brokenSwingIndex === swingIndex);
  }
}

