/**
 * ExternalRangeTracker - Tracks true external swings via BOS/CHOCH events
 * 
 * This fixes the issue where internal swings are incorrectly treated as structural.
 * Only BOS/CHOCH events that break true external extremes update the range.
 */

import { BosEvent, ChoChEvent, SwingPoint } from '../smc-core/Types';
import { ExternalRange, ExternalRangeUpdateInput, MSMDirection } from './types';
import { Logger } from '@providencex/shared-utils';

const logger = new Logger('ExternalRangeTracker');

export class ExternalRangeTracker {
  private currentRange: ExternalRange | null = null;

  /**
   * Update external range based on BOS/CHOCH events
   * 
   * Rules:
   * - Last strong BOS determines direction
   * - Bullish range: swingLow fixed until broken by CHOCH down
   * - Bearish range: swingHigh fixed until broken by CHOCH up
   * - Only update extremes on new BOS in same direction
   */
  updateRange(input: ExternalRangeUpdateInput): ExternalRange {
    const { swings, bosEvents, chochEvents, currentClose, currentIndex } = input;

    // If no BOS events exist, return empty range
    if (bosEvents.length === 0) {
      if (!this.currentRange) {
        return {
          direction: 'sideways',
          swingHigh: null,
          swingLow: null,
          lastUpdateIndex: currentIndex,
        };
      }
      return this.currentRange;
    }

    // Get the most recent BOS event to determine current direction
    const lastBos = bosEvents[bosEvents.length - 1];
    const lastChoch = chochEvents.length > 0 ? chochEvents[chochEvents.length - 1] : null;

    // Determine direction from last BOS
    const currentDirection: MSMDirection = 
      lastBos.direction === 'bullish' ? 'bullish' : 'bearish';

    // Check for CHOCH reversal
    if (lastChoch && lastChoch.index >= lastBos.index) {
      // CHOCH happened after last BOS - direction has reversed
      const newDirection: MSMDirection = 
        lastChoch.toTrend === 'bullish' ? 'bullish' : 'bearish';

      if (newDirection !== currentDirection) {
        // Trend reversal - start new range
        return this.initializeRange(swings, bosEvents, newDirection, currentIndex);
      }
    }

    // If we have an existing range and direction matches, update it
    if (this.currentRange && this.currentRange.direction === currentDirection) {
      return this.updateExistingRange(
        swings,
        bosEvents,
        currentDirection,
        currentIndex
      );
    }

    // Initialize new range
    return this.initializeRange(swings, bosEvents, currentDirection, currentIndex);
  }

  /**
   * Initialize a new external range from BOS events
   */
  private initializeRange(
    swings: SwingPoint[],
    bosEvents: BosEvent[],
    direction: MSMDirection,
    currentIndex: number
  ): ExternalRange {
    const lastBos = bosEvents[bosEvents.length - 1];
    
    // Find the swing that was broken by the last BOS
    const brokenSwing = swings.find(s => 
      s.index === lastBos.brokenSwingIndex
    );

    if (!brokenSwing) {
      logger.warn('Could not find broken swing for BOS initialization');
      return {
        direction,
        swingHigh: null,
        swingLow: null,
        lastUpdateIndex: currentIndex,
        lastBosIndex: lastBos.index,
      };
    }

    let swingHigh: number | null = null;
    let swingLow: number | null = null;

    if (direction === 'bullish') {
      // Bullish range: swingLow is the swing low before the BOS, swingHigh is what was broken
      swingHigh = brokenSwing.price; // This was the high that got broken
      
      // Find the most recent swing low before this high
      const lowsBeforeHigh = swings
        .filter(s => s.type === 'low' && s.index < brokenSwing.index)
        .sort((a, b) => b.index - a.index);
      
      swingLow = lowsBeforeHigh.length > 0 ? lowsBeforeHigh[0].price : null;
    } else {
      // Bearish range: swingHigh is the swing high before the BOS, swingLow is what was broken
      swingLow = brokenSwing.price; // This was the low that got broken
      
      // Find the most recent swing high before this low
      const highsBeforeLow = swings
        .filter(s => s.type === 'high' && s.index < brokenSwing.index)
        .sort((a, b) => b.index - a.index);
      
      swingHigh = highsBeforeLow.length > 0 ? highsBeforeLow[0].price : null;
    }

    this.currentRange = {
      direction,
      swingHigh,
      swingLow,
      lastUpdateIndex: currentIndex,
      lastBosIndex: lastBos.index,
    };

    return this.currentRange;
  }

  /**
   * Update existing range when new BOS occurs in same direction
   */
  private updateExistingRange(
    swings: SwingPoint[],
    bosEvents: BosEvent[],
    direction: MSMDirection,
    currentIndex: number
  ): ExternalRange {
    if (!this.currentRange) {
      return this.initializeRange(swings, bosEvents, direction, currentIndex);
    }

    const lastBos = bosEvents[bosEvents.length - 1];
    const brokenSwing = swings.find(s => 
      s.index === lastBos.brokenSwingIndex
    );

    if (!brokenSwing) {
      return this.currentRange;
    }

    // Only update if this BOS breaks a new extreme
    if (direction === 'bullish') {
      // Update swingHigh only if broken swing high is higher
      if (brokenSwing.type === 'high' && 
          brokenSwing.price > (this.currentRange.swingHigh || 0)) {
        this.currentRange.swingHigh = brokenSwing.price;
        this.currentRange.lastUpdateIndex = currentIndex;
        this.currentRange.lastBosIndex = lastBos.index;
      }
      // swingLow never changes in bullish range until CHOCH down
    } else {
      // Update swingLow only if broken swing low is lower
      if (brokenSwing.type === 'low' && 
          brokenSwing.price < (this.currentRange.swingLow || Infinity)) {
        this.currentRange.swingLow = brokenSwing.price;
        this.currentRange.lastUpdateIndex = currentIndex;
        this.currentRange.lastBosIndex = lastBos.index;
      }
      // swingHigh never changes in bearish range until CHOCH up
    }

    return this.currentRange;
  }

  /**
   * Check if price has broken the range (CHOCH signal)
   */
  checkRangeBreak(currentPrice: number, direction: MSMDirection): boolean {
    if (!this.currentRange) return false;

    if (this.currentRange.direction === 'bullish' && direction === 'bearish') {
      // Check if price closed below bullish swing low
      return this.currentRange.swingLow !== null && 
             currentPrice < this.currentRange.swingLow;
    }

    if (this.currentRange.direction === 'bearish' && direction === 'bullish') {
      // Check if price closed above bearish swing high
      return this.currentRange.swingHigh !== null && 
             currentPrice > this.currentRange.swingHigh;
    }

    return false;
  }

  /**
   * Get current range (for external access)
   */
  getCurrentRange(): ExternalRange | null {
    return this.currentRange;
  }

  /**
   * Reset tracker (for testing or new analysis)
   */
  reset(): void {
    this.currentRange = null;
  }
}

