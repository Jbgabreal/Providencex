/**
 * MarketStructureITF - Intermediate Timeframe Structure Analysis (SMC v2)
 * 
 * Analyzes ITF (M15/M5) for:
 * - BOS/CHoCH aligned with HTF
 * - Intermediate Order Blocks
 * - Sweep detection
 * 
 * Now uses formal SMC core services for swing detection, BOS, CHoCH, and trend bias
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { MarketStructureContext } from './types';
import { SwingService } from './smc-core/SwingService';
import { StructuralSwingService } from './smc-core/StructuralSwingService';
import { BosService } from './smc-core/BosService';
import { TrendService } from './smc-core/TrendService';
import { ChochService } from './smc-core/ChochService';
import { SwingPoint } from './smc-core/Types';

const logger = new Logger('MarketStructureITF');

export class MarketStructureITF {
  private lookbackPeriod: number;
  private swingService: SwingService;
  private structuralSwingService: StructuralSwingService;
  private bosService: BosService;
  private trendService: TrendService;
  private chochService: ChochService;
  private useStructuralSwings: boolean;

  constructor(lookbackPeriod: number = 30, useStructuralSwings: boolean = true) {
    this.lookbackPeriod = lookbackPeriod;
    this.useStructuralSwings = useStructuralSwings;
    
    // Initialize SMC core services with ITF-appropriate config
    this.swingService = new SwingService({
      method: 'hybrid',
      pivotLeft: 3,
      pivotRight: 3,
      lookbackHigh: 20,
      lookbackLow: 20,
    });
    
    // Structural swing service with 3-candle rule
    this.structuralSwingService = new StructuralSwingService(3);
    
    this.bosService = new BosService({
      bosLookbackSwings: 10,
      swingIndexLookback: 50,
      strictClose: true, // ICT-style strict close (closing price breaks)
    });
    
    this.trendService = new TrendService({
      minSwingPairs: 2,
      discountMax: 0.5,
      premiumMin: 0.5,
    });
    
    this.chochService = new ChochService();
  }

  /**
   * Analyze ITF market structure using formal SMC core services
   */
  analyzeStructure(candles: Candle[], htfTrend: 'bullish' | 'bearish' | 'sideways'): MarketStructureContext {
    if (candles.length < 20) {
      return {
        candles,
        timeframe: 'ITF',
        trend: 'sideways',
      };
    }

    // Use structural swings (3-candle rule) or fractal swings
    let swings: SwingPoint[];
    let structuralSwings: import('./smc-core/Types').StructuralSwing[] | undefined;
    
    if (this.useStructuralSwings) {
      structuralSwings = this.structuralSwingService.detectStructuralSwings(candles);
      swings = structuralSwings.map(s => ({
        index: s.index,
        type: s.type,
        price: s.price,
        timestamp: s.timestamp,
      }));
    } else {
      swings = this.swingService.detectSwings(candles);
    }
    
    // Detect BOS using closing price breaks
    const bosEvents = this.bosService.detectBOS(candles, swings);
    
    // Compute trend bias (for backward compatibility)
    const trendSnapshots = this.trendService.computeTrendBias(candles, swings, bosEvents);
    
    // Detect CHoCH using state machine
    const chochEvents = this.chochService.detectChoCh(candles, swings, bosEvents);
    
    // Detect MSB (Market Structure Break)
    const msbEvents = structuralSwings 
      ? this.chochService.detectMSB(chochEvents, structuralSwings)
      : [];

    // Get latest trend from snapshots
    const latestSnapshot = trendSnapshots.length > 0 
      ? trendSnapshots[trendSnapshots.length - 1]
      : null;
    const itfTrend = latestSnapshot?.trend || 'sideways';

    // Check if ITF flow aligns with HTF trend
    const itfFlow = this.determineFlow(itfTrend, htfTrend);

    // Get swing highs and lows
    const swingHighs = swings.filter(s => s.type === 'high');
    const swingLows = swings.filter(s => s.type === 'low');
    const lastSwingHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1] : null;
    const lastSwingLow = swingLows.length > 0 ? swingLows[swingLows.length - 1] : null;

    // Convert to backward-compatible format
    const swingHigh = lastSwingHigh?.price;
    const swingLow = lastSwingLow?.price;
    const swingHighsArray = swingHighs.map(s => s.price);
    const swingLowsArray = swingLows.map(s => s.price);

    // Get last BOS (combine BOS, CHoCH, and MSB events)
    const lastBOS = this.getLastBOSForContext(bosEvents, chochEvents, msbEvents, candles);

    // Build BOS events array for backward compatibility
    const bosEventsArray = this.buildBOSEventsArray(bosEvents, chochEvents, msbEvents, candles);

    // Optional debug logging
    const smcDebug = process.env.SMC_DEBUG === 'true';
    if (smcDebug && candles.length > 0) {
      const symbol = (candles[0] as any).symbol || 'UNKNOWN';
      logger.debug(
        `[MarketStructureITF] ${symbol}: ITF analysis - ` +
        `HTF trend=${htfTrend}, ITF trend=${itfTrend}, flow=${itfFlow}, ` +
        `structural=${this.useStructuralSwings}, ` +
        `BOS count=${bosEvents.length}, CHoCH count=${chochEvents.length}, MSB count=${msbEvents.length}`
      );
    }

    return {
      candles,
      timeframe: 'ITF',
      swingHigh,
      swingLow,
      swingHighs: swingHighsArray,
      swingLows: swingLowsArray,
      bosEvents: bosEventsArray,
      lastBOS,
      trend: itfFlow === 'aligned' || itfFlow === 'neutral' ? htfTrend : 'sideways',
    };
  }

  /**
   * Determine if ITF flow aligns with HTF trend
   */
  private determineFlow(
    itfTrend: 'bullish' | 'bearish' | 'sideways',
    htfTrend: 'bullish' | 'bearish' | 'sideways'
  ): 'aligned' | 'counter' | 'neutral' {
    if (htfTrend === 'sideways') return 'neutral';
    if (itfTrend === 'sideways') return 'neutral';
    
    if (itfTrend === htfTrend) {
      return 'aligned';
    }
    
    return 'counter';
  }

  /**
   * Get last BOS/CHoCH for backward compatibility
   */
  private getLastBOSForContext(
    bosEvents: import('./smc-core/Types').BosEvent[],
    chochEvents: import('./smc-core/Types').ChoChEvent[],
    msbEvents: import('./smc-core/Types').MsbEvent[],
    candles: Candle[]
  ): { type: 'BOS' | 'CHoCH' | 'MSB'; index: number; price: number; timestamp: Date } | undefined {
    // Combine BOS, CHoCH, and MSB, prefer MSB > CHoCH > BOS if multiple exist at same index
    const allEvents: Array<{ index: number; price: number; timestamp: number; priority: number; type: 'BOS' | 'CHoCH' | 'MSB' }> = [];
    
    for (const bos of bosEvents) {
      allEvents.push({
        index: bos.index,
        price: bos.level,
        timestamp: bos.timestamp,
        priority: 1,
        type: 'BOS',
      });
    }
    
    for (const choch of chochEvents) {
      allEvents.push({
        index: choch.index,
        price: choch.level,
        timestamp: choch.timestamp,
        priority: 2,
        type: 'CHoCH',
      });
    }
    
    for (const msb of msbEvents) {
      allEvents.push({
        index: msb.index,
        price: msb.level,
        timestamp: msb.timestamp,
        priority: 3, // MSB has highest priority
        type: 'MSB',
      });
    }

    if (allEvents.length === 0) return undefined;

    // Sort by index (most recent last), then by priority
    allEvents.sort((a, b) => {
      if (a.index !== b.index) return a.index - b.index;
      return b.priority - a.priority; // Higher priority first
    });

    // Get most recent event (highest priority if multiple at same index)
    const lastEvent = allEvents[allEvents.length - 1];
    const candle = candles[lastEvent.index];
    
    if (!candle) return undefined;

    return {
      type: lastEvent.type,
      index: lastEvent.index,
      price: lastEvent.price,
      timestamp: new Date(lastEvent.timestamp),
    };
  }

  /**
   * Build BOS events array for backward compatibility
   * Includes BOS, CHoCH, and MSB events
   */
  private buildBOSEventsArray(
    bosEvents: import('./smc-core/Types').BosEvent[],
    chochEvents: import('./smc-core/Types').ChoChEvent[],
    msbEvents: import('./smc-core/Types').MsbEvent[],
    candles: Candle[]
  ): Array<{ type: 'BOS' | 'CHoCH' | 'MSB'; index: number; price: number; timestamp: Date }> {
    const events: Array<{ type: 'BOS' | 'CHoCH' | 'MSB'; index: number; price: number; timestamp: Date }> = [];

    // Add BOS events
    for (const bos of bosEvents) {
      const candle = candles[bos.index];
      if (candle) {
        events.push({
          type: 'BOS',
          index: bos.index,
          price: bos.level,
          timestamp: new Date(bos.timestamp),
        });
      }
    }

    // Add CHoCH events (may overwrite BOS at same index)
    for (const choch of chochEvents) {
      const candle = candles[choch.index];
      if (candle) {
        const existingIndex = events.findIndex(e => e.index === choch.index);
        if (existingIndex >= 0) {
          // Replace BOS with CHoCH at same index
          events[existingIndex] = {
            type: 'CHoCH',
            index: choch.index,
            price: choch.level,
            timestamp: new Date(choch.timestamp),
          };
        } else {
          events.push({
            type: 'CHoCH',
            index: choch.index,
            price: choch.level,
            timestamp: new Date(choch.timestamp),
          });
        }
      }
    }

    // Add MSB events (may overwrite CHoCH/BOS at same index)
    for (const msb of msbEvents) {
      const candle = candles[msb.index];
      if (candle) {
        const existingIndex = events.findIndex(e => e.index === msb.index);
        if (existingIndex >= 0) {
          // Replace with MSB at same index (MSB has highest priority)
          events[existingIndex] = {
            type: 'MSB',
            index: msb.index,
            price: msb.level,
            timestamp: new Date(msb.timestamp),
          };
        } else {
          events.push({
            type: 'MSB',
            index: msb.index,
            price: msb.level,
            timestamp: new Date(msb.timestamp),
          });
        }
      }
    }

    // Sort by index
    return events.sort((a, b) => a.index - b.index);
  }
}
