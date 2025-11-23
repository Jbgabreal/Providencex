/**
 * MarketStructureHTF - High Timeframe Structure Analysis (SMC v2)
 * 
 * Analyzes HTF (H1/H4) for:
 * - Trend direction (bullish, bearish, sideways)
 * - Premium/Discount zones
 * - HTF Order Blocks
 * - HTF BOS/CHoCH
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

const logger = new Logger('MarketStructureHTF');

export class MarketStructureHTF {
  private lookbackPeriod: number; // Number of candles to look back for swing points
  private swingService: SwingService;
  private structuralSwingService: StructuralSwingService;
  private bosService: BosService;
  private trendService: TrendService;
  private chochService: ChochService;
  private useStructuralSwings: boolean; // Toggle between structural and fractal swings

  constructor(lookbackPeriod: number = 50, useStructuralSwings: boolean = true) {
    this.lookbackPeriod = lookbackPeriod;
    this.useStructuralSwings = useStructuralSwings;
    
    // Initialize SMC core services with HTF-appropriate config
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
      swingIndexLookback: 100,
      strictClose: true, // ICT-style strict close (closing price breaks)
    });
    
    this.trendService = new TrendService({
      minSwingPairs: 1,
      discountMax: 0.5,
      premiumMin: 0.5,
    });
    
    this.chochService = new ChochService();
  }

  /**
   * Analyze HTF market structure using formal SMC core services
   * v15d: Updated to work with as few as 3 candles (for H4 bias detection)
   */
  analyzeStructure(candles: Candle[]): MarketStructureContext {
    // Minimum requirement: at least 1 candle (but we prefer 3+ for better trend detection)
    if (candles.length < 1) {
      return {
        candles,
        timeframe: 'HTF',
        trend: 'sideways',
      };
    }

    // Use structural swings (3-candle rule) or fractal swings
    let swings: SwingPoint[];
    let structuralSwings: import('./smc-core/Types').StructuralSwing[] | undefined;
    
    if (this.useStructuralSwings) {
      // Use 3-consecutive-candle structural swings
      structuralSwings = this.structuralSwingService.detectStructuralSwings(candles);
      // Convert structural swings to SwingPoint format for compatibility
      swings = structuralSwings.map(s => ({
        index: s.index,
        type: s.type,
        price: s.price,
        timestamp: s.timestamp,
      }));
    } else {
      // Use fractal/pivot-based swings (fallback)
      swings = this.swingService.detectSwings(candles);
    }
    
    // Detect BOS using closing price breaks
    const bosEvents = this.bosService.detectBOS(candles, swings);
    
    // Compute trend bias (for backward compatibility, but CHoCH doesn't need it)
    const trendSnapshots = this.trendService.computeTrendBias(candles, swings, bosEvents);
    
    // Detect CHoCH using state machine (doesn't require trendSnapshots)
    const chochEvents = this.chochService.detectChoCh(candles, swings, bosEvents);
    
    // Detect MSB (Market Structure Break) - stronger CHoCH on major swings
    const msbEvents = structuralSwings 
      ? this.chochService.detectMSB(chochEvents, structuralSwings)
      : [];

    // Get latest trend from snapshots
    const latestSnapshot = trendSnapshots.length > 0 
      ? trendSnapshots[trendSnapshots.length - 1]
      : null;
    let trend = latestSnapshot?.trend || 'sideways';

    // Debug logging
    const smcDebug = process.env.SMC_DEBUG === 'true';
    if (smcDebug) {
      const swingHighs = swings.filter(s => s.type === 'high');
      const swingLows = swings.filter(s => s.type === 'low');
      logger.info(
        `[MarketStructureHTF] HTF analysis - ` +
        `candles=${candles.length}, swings=${swings.length} ` +
        `(highs=${swingHighs.length}, lows=${swingLows.length}), ` +
        `structural=${this.useStructuralSwings}, ` +
        `formal trend=${trend}, BOS=${bosEvents.length}, CHoCH=${chochEvents.length}, MSB=${msbEvents.length}`
      );
      
      // Log CHoCH details
      if (chochEvents.length > 0) {
        chochEvents.forEach(choch => {
          logger.info(
            `[MarketStructureHTF] CHoCH: ${choch.fromTrend}→${choch.toTrend} at index ${choch.index}, ` +
            `broke swing ${choch.brokenSwingType}@${choch.level.toFixed(2)} (index ${choch.brokenSwingIndex})`
          );
        });
      }
    }

    // Fallback: If formal trend detection returns sideways, use ICT PD model
    // This handles cases with limited candles where formal HH/HL pattern can't be confirmed
    if (trend === 'sideways' && candles.length >= 2) {
      const lastCandle = candles[candles.length - 1];
      const lastClose = lastCandle.close;
      
      // Calculate previous swing high/low from recent candles (rolling lookback)
      // Use adaptive lookback based on available candles
      const swingLookback = Math.min(Math.max(10, Math.floor(candles.length * 0.6)), 50);
      const swingCandles = candles.slice(-swingLookback);
      
      if (swingCandles.length >= 2) {
        const previousSwingHigh = Math.max(...swingCandles.slice(0, -1).map(c => c.high));
        const previousSwingLow = Math.min(...swingCandles.slice(0, -1).map(c => c.low));
        
        // ICT PD model: trend = bullish if lastClose > previousSwingHigh
        if (lastClose > previousSwingHigh) {
          trend = 'bullish';
          if (smcDebug) {
            logger.info(
              `[MarketStructureHTF] Fallback ICT PD: bullish ` +
              `(lastClose ${lastClose.toFixed(2)} > swingHigh ${previousSwingHigh.toFixed(2)})`
            );
          }
        } else if (lastClose < previousSwingLow) {
          // ICT PD model: trend = bearish if lastClose < previousSwingLow
          trend = 'bearish';
          if (smcDebug) {
            logger.info(
              `[MarketStructureHTF] Fallback ICT PD: bearish ` +
              `(lastClose ${lastClose.toFixed(2)} < swingLow ${previousSwingLow.toFixed(2)})`
            );
          }
        }
      }
    }

    // Get swing highs and lows
    const swingHighs = this.swingService.getSwingHighs(swings);
    const swingLows = this.swingService.getSwingLows(swings);
    const lastSwingHigh = this.swingService.getLastSwingHigh(swings);
    const lastSwingLow = this.swingService.getLastSwingLow(swings);

    // Convert to backward-compatible format
    const swingHigh = lastSwingHigh?.price;
    const swingLow = lastSwingLow?.price;
    const swingHighsArray = swingHighs.map(s => s.price);
    const swingLowsArray = swingLows.map(s => s.price);

    // Get last BOS (combine BOS, CHoCH, and MSB events)
    const lastBOS = this.getLastBOSForContext(bosEvents, chochEvents, msbEvents, candles);

    // Build BOS events array for backward compatibility
    const bosEventsArray = this.buildBOSEventsArray(bosEvents, chochEvents, msbEvents, candles);

    return {
      candles,
      timeframe: 'HTF',
      swingHigh,
      swingLow,
      swingHighs: swingHighsArray,
      swingLows: swingLowsArray,
      bosEvents: bosEventsArray,
      lastBOS,
      trend,
    };
  }

  /**
   * Get last BOS/CHoCH/MSB for backward compatibility
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

  // Old methods removed - now using SMC core services
  // All swing detection, BOS detection, and trend calculation
  // is now handled by SwingService, BosService, TrendService, and ChochService
}


