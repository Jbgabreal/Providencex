/**
 * ChochService - Formal Change of Character Detection (SMC Core)
 * 
 * Implements state machine-based CHoCH detection with anchor swings
 * Based on SMC_research.md Section 2.3 and user requirements
 * 
 * State Machine Approach:
 * - Track current structural bias (bullish/bearish/sideways)
 * - Track anchor swing (last HL for bullish, last LH for bearish)
 * - CHoCH occurs when opposite-direction BOS breaks anchor swing
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../../marketData/types';
import {
  SwingPoint,
  BosEvent,
  TrendBiasSnapshot,
  ChoChEvent,
  CandleData,
  candlesToData,
  StructuralSwing,
} from './Types';

const logger = new Logger('ChochService');

/**
 * State machine state for CHoCH detection
 */
type StructuralBiasState = {
  currentBias: 'bullish' | 'bearish' | 'sideways' | 'unknown';
  anchorSwing: SwingPoint | null;  // Last HL for bullish, last LH for bearish
  lastConfirmedSwingHigh: SwingPoint | null;
  lastConfirmedSwingLow: SwingPoint | null;
};

export class ChochService {
  /**
   * Detect CHoCH events using state machine approach
   * 
   * State Machine Logic:
   * 1. Initialize state with 'unknown' bias
   * 2. Process BOS events in chronological order
   * 3. For each BOS:
   *    - If same direction as current bias: continuation BOS, update anchor swing
   *    - If opposite direction and breaks anchor swing: CHoCH event, flip bias
   * 4. Track anchor swings: last HL for bullish, last LH for bearish
   * 
   * Returns ChoChEvent[] sorted by index
   */
  detectChoCh(
    candles: Candle[],
    swings: SwingPoint[],
    bosEvents: BosEvent[],
    trendSnapshots?: TrendBiasSnapshot[]
  ): ChoChEvent[] {
    const candleData = candlesToData(candles);
    const chochEvents: ChoChEvent[] = [];

    // Sort swings and BOS by index
    const swingsSorted = swings.slice().sort((a, b) => a.index - b.index);
    const bosEventsSorted = bosEvents.slice().sort((a, b) => a.index - b.index);

    // Initialize state machine
    let state: StructuralBiasState = {
      currentBias: 'unknown',
      anchorSwing: null,
      lastConfirmedSwingHigh: null,
      lastConfirmedSwingLow: null,
    };

    // Process BOS events in chronological order
    for (const bos of bosEventsSorted) {
      const idx = bos.index;
      const candle = candleData[idx];
      if (!candle) continue;

      // Update last confirmed swings before this BOS
      const swingsBefore = swingsSorted.filter(s => s.index < idx);
      if (swingsBefore.length > 0) {
        const lastHigh = swingsBefore.filter(s => s.type === 'high').pop() || null;
        const lastLow = swingsBefore.filter(s => s.type === 'low').pop() || null;
        
        if (lastHigh && (!state.lastConfirmedSwingHigh || lastHigh.index > state.lastConfirmedSwingHigh.index)) {
          state.lastConfirmedSwingHigh = lastHigh;
        }
        if (lastLow && (!state.lastConfirmedSwingLow || lastLow.index > state.lastConfirmedSwingLow.index)) {
          state.lastConfirmedSwingLow = lastLow;
        }
      }

      // Determine if this BOS breaks the anchor swing
      let breaksAnchor = false;
      let brokenAnchor: SwingPoint | null = null;

      if (state.currentBias === 'bullish' && state.anchorSwing) {
        // Bullish bias: anchor is last HL (swing low)
        // Bearish BOS breaks anchor if it closes below anchor price
        if (bos.direction === 'bearish' && state.anchorSwing.type === 'low') {
          breaksAnchor = candle.close < state.anchorSwing.price;
          brokenAnchor = state.anchorSwing;
        }
      } else if (state.currentBias === 'bearish' && state.anchorSwing) {
        // Bearish bias: anchor is last LH (swing high)
        // Bullish BOS breaks anchor if it closes above anchor price
        if (bos.direction === 'bullish' && state.anchorSwing.type === 'high') {
          breaksAnchor = candle.close > state.anchorSwing.price;
          brokenAnchor = state.anchorSwing;
        }
      }

      // Check for CHoCH
      if (breaksAnchor && brokenAnchor) {
        // CHoCH detected: opposite-direction BOS broke anchor swing
        const fromTrend = state.currentBias as 'bullish' | 'bearish';
        const toTrend = bos.direction === 'bullish' ? 'bullish' : 'bearish';

        chochEvents.push({
          index: bos.index,
          timestamp: bos.timestamp,
          fromTrend,
          toTrend,
          brokenSwingIndex: brokenAnchor.index,
          brokenSwingType: brokenAnchor.type,
          level: brokenAnchor.price,
          bosIndex: bos.index,
        });

        // Update state: flip bias and set new anchor
        state.currentBias = toTrend;
        if (toTrend === 'bullish') {
          // New bullish bias: anchor is the last swing low (HL)
          state.anchorSwing = state.lastConfirmedSwingLow;
        } else {
          // New bearish bias: anchor is the last swing high (LH)
          state.anchorSwing = state.lastConfirmedSwingHigh;
        }
      } else if (bos.direction === state.currentBias || state.currentBias === 'unknown') {
        // Continuation BOS or initial BOS: update anchor swing
        if (bos.direction === 'bullish') {
          // Bullish BOS: update last swing high, anchor remains last swing low
          const brokenSwing = swingsSorted.find(s => s.index === bos.brokenSwingIndex);
          if (brokenSwing && brokenSwing.type === 'high') {
            if (!state.lastConfirmedSwingHigh || brokenSwing.index > state.lastConfirmedSwingHigh.index) {
              state.lastConfirmedSwingHigh = brokenSwing;
            }
          }
          
          // Set initial bias or maintain bullish
          if (state.currentBias === 'unknown') {
            state.currentBias = 'bullish';
            state.anchorSwing = state.lastConfirmedSwingLow;
          }
        } else {
          // Bearish BOS: update last swing low, anchor remains last swing high
          const brokenSwing = swingsSorted.find(s => s.index === bos.brokenSwingIndex);
          if (brokenSwing && brokenSwing.type === 'low') {
            if (!state.lastConfirmedSwingLow || brokenSwing.index > state.lastConfirmedSwingLow.index) {
              state.lastConfirmedSwingLow = brokenSwing;
            }
          }
          
          // Set initial bias or maintain bearish
          if (state.currentBias === 'unknown') {
            state.currentBias = 'bearish';
            state.anchorSwing = state.lastConfirmedSwingHigh;
          }
        }
      }
    }

    // Sort by index
    const sorted = chochEvents.sort((a, b) => a.index - b.index);
    
    // Summary logging
    const smcDebug = process.env.SMC_DEBUG === 'true';
    if (smcDebug && bosEvents.length > 0) {
      logger.info(
        `[ChochService] CHoCH detection summary: ` +
        `${sorted.length} CHoCH events from ${bosEvents.length} BOS events. ` +
        `Final bias: ${state.currentBias}, anchor: ${state.anchorSwing ? state.anchorSwing.type + '@' + state.anchorSwing.price : 'none'}`
      );
    }
    
    return sorted;
  }

  /**
   * Get protected swing before a given index
   * 
   * In bullish trend: last swing low (HL) before index
   * In bearish trend: last swing high (LH) before index
   * 
   * The "protected swing" is the last swing that confirms the current trend:
   * - In bullish: last swing low (the most recent HL)
   * - In bearish: last swing high (the most recent LH)
   */
  private getProtectedSwingBeforeIndex(
    swings: SwingPoint[],
    beforeIndex: number,
    trend: 'bullish' | 'bearish'
  ): SwingPoint | null {
    // Get swings before the index, sorted by index
    const swingsBefore = swings
      .filter(s => s.index < beforeIndex)
      .sort((a, b) => a.index - b.index);

    if (swingsBefore.length === 0) return null;

    if (trend === 'bullish') {
      // In bullish trend, protected swing is the last swing low (HL) before the BOS
      // This is the most recent swing low that confirms the bullish structure
      const lows = swingsBefore.filter(s => s.type === 'low');
      if (lows.length === 0) return null;
      // Return the most recent (last) swing low
      return lows[lows.length - 1];
    } else {
      // In bearish trend, protected swing is the last swing high (LH) before the BOS
      // This is the most recent swing high that confirms the bearish structure
      const highs = swingsBefore.filter(s => s.type === 'high');
      if (highs.length === 0) return null;
      // Return the most recent (last) swing high
      return highs[highs.length - 1];
    }
  }

  /**
   * Get most recent CHoCH event
   */
  getLastChoCh(chochEvents: ChoChEvent[]): ChoChEvent | null {
    if (chochEvents.length === 0) return null;
    return chochEvents[chochEvents.length - 1];
  }

  /**
   * Get CHoCH events by direction change
   */
  getChoChByDirection(
    chochEvents: ChoChEvent[],
    fromTrend: 'bullish' | 'bearish',
    toTrend: 'bullish' | 'bearish'
  ): ChoChEvent[] {
    return chochEvents.filter(
      c => c.fromTrend === fromTrend && c.toTrend === toTrend
    );
  }

  /**
   * Check if a CHoCH occurred at a specific candle index
   */
  hasChoChAt(chochEvents: ChoChEvent[], index: number): boolean {
    return chochEvents.some(c => c.index === index);
  }

  /**
   * Get CHoCH events within a candle index range
   */
  getChoChInRange(
    chochEvents: ChoChEvent[],
    startIndex: number,
    endIndex: number
  ): ChoChEvent[] {
    return chochEvents.filter(
      c => c.index >= startIndex && c.index <= endIndex
    );
  }

  /**
   * Detect MSB (Market Structure Break) events
   * MSB is a stronger CHoCH that breaks a major swing
   * 
   * Returns MsbEvent[] sorted by index
   */
  detectMSB(
    chochEvents: ChoChEvent[],
    structuralSwings?: StructuralSwing[]
  ): import('./Types').MsbEvent[] {
    const msbEvents: import('./Types').MsbEvent[] = [];

    // If no structural swings provided, treat all CHoCH as potential MSB
    // (we can refine this later with major swing detection)
    if (!structuralSwings || structuralSwings.length === 0) {
      // Without structural swings, we can't determine major swings
      // Return empty for now (can be enhanced later)
      return msbEvents;
    }

    // Get major swings
    const majorSwings = structuralSwings.filter(s => s.isMajor);

    // Check each CHoCH to see if it broke a major swing
    for (const choch of chochEvents) {
      const brokenSwing = structuralSwings.find(
        s => s.index === choch.brokenSwingIndex
      );

      if (brokenSwing && brokenSwing.isMajor) {
        msbEvents.push({
          index: choch.index,
          timestamp: choch.timestamp,
          fromTrend: choch.fromTrend,
          toTrend: choch.toTrend,
          brokenSwingIndex: choch.brokenSwingIndex,
          brokenSwingType: choch.brokenSwingType,
          level: choch.level,
          bosIndex: choch.bosIndex,
          isMajorSwing: true,
        });
      }
    }

    return msbEvents.sort((a, b) => a.index - b.index);
  }
}

