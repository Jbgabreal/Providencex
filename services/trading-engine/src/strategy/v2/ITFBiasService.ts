/**
 * ITFBiasService - Derives ITF (M15) bias from ChoCHService instead of MarketStructureITF.trend
 * 
 * This service uses ChoCHService's state machine to determine the final structural bias
 * per timeframe, which is more reliable than TrendService when the market is choppy.
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { SwingService } from './smc-core/SwingService';
import { StructuralSwingService } from './smc-core/StructuralSwingService';
import { BosService } from './smc-core/BosService';
import { ChochService } from './smc-core/ChochService';

const logger = new Logger('ITFBiasService');

export type ITFBias = 'bullish' | 'bearish' | 'sideways' | 'neutral';

export interface ITFBiasResult {
  bias: ITFBias;
  method: 'choch' | 'bos' | 'none';
  lastChoCh?: {
    fromTrend: 'bullish' | 'bearish';
    toTrend: 'bullish' | 'bearish';
    index: number;
    timestamp: number;
  } | null;
  bosCount: {
    bullish: number;
    bearish: number;
  };
}

export class ITFBiasService {
  private swingService: SwingService;
  private structuralSwingService: StructuralSwingService;
  private bosService: BosService;
  private chochService: ChochService;
  private useStructuralSwings: boolean;

  constructor(useStructuralSwings: boolean = true) {
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
      strictClose: true, // ICT-style strict close
    });
    
    this.chochService = new ChochService();
  }

  /**
   * Derive ITF bias from ChoCHService's final state
   * 
   * This method processes BOS/CHoCH events and determines the final structural bias
   * by replicating the ChoCHService state machine logic to track the final bias state.
   */
  deriveITFBias(candles: Candle[]): ITFBiasResult {
    if (candles.length < 20) {
      return {
        bias: 'neutral',
        method: 'none',
        lastChoCh: null,
        bosCount: { bullish: 0, bearish: 0 },
      };
    }

    // Detect swings
    let swings: import('./smc-core/Types').SwingPoint[];
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
    
    // Detect BOS events
    const bosEvents = this.bosService.detectBOS(candles, swings);
    
    // Count BOS events by direction
    let bullishBosCount = 0;
    let bearishBosCount = 0;
    
    for (const bos of bosEvents) {
      if (bos.direction === 'bullish') {
        bullishBosCount++;
      } else {
        bearishBosCount++;
      }
    }

    // Replicate ChoCHService state machine to track final bias
    // This is the same logic as ChoCHService.detectChoCh but we track the final state
    const candleData = this.candlesToData(candles);
    const swingsSorted = swings.slice().sort((a, b) => a.index - b.index);
    const bosEventsSorted = bosEvents.slice().sort((a, b) => a.index - b.index);
    
    // Initialize state machine (same as ChoCHService)
    type StructuralBiasState = {
      currentBias: 'bullish' | 'bearish' | 'sideways' | 'unknown';
      anchorSwing: import('./smc-core/Types').SwingPoint | null;
      lastConfirmedSwingHigh: import('./smc-core/Types').SwingPoint | null;
      lastConfirmedSwingLow: import('./smc-core/Types').SwingPoint | null;
    };
    
    let state: StructuralBiasState = {
      currentBias: 'unknown',
      anchorSwing: null,
      lastConfirmedSwingHigh: null,
      lastConfirmedSwingLow: null,
    };
    
    const chochEvents: import('./smc-core/Types').ChoChEvent[] = [];
    
    // Process BOS events in chronological order (same logic as ChoCHService)
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
      let brokenAnchor: import('./smc-core/Types').SwingPoint | null = null;

      if (state.currentBias === 'bullish' && state.anchorSwing) {
        if (bos.direction === 'bearish' && state.anchorSwing.type === 'low') {
          breaksAnchor = candle.close < state.anchorSwing.price;
          brokenAnchor = state.anchorSwing;
        }
      } else if (state.currentBias === 'bearish' && state.anchorSwing) {
        if (bos.direction === 'bullish' && state.anchorSwing.type === 'high') {
          breaksAnchor = candle.close > state.anchorSwing.price;
          brokenAnchor = state.anchorSwing;
        }
      }

      // Check for CHoCH
      if (breaksAnchor && brokenAnchor) {
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

        // Update state: flip bias
        state.currentBias = toTrend;
        if (toTrend === 'bullish') {
          state.anchorSwing = state.lastConfirmedSwingLow;
        } else {
          state.anchorSwing = state.lastConfirmedSwingHigh;
        }
      } else if (bos.direction === state.currentBias || state.currentBias === 'unknown') {
        // Continuation BOS or initial BOS
        if (bos.direction === 'bullish') {
          const brokenSwing = swingsSorted.find(s => s.index === bos.brokenSwingIndex);
          if (brokenSwing && brokenSwing.type === 'high') {
            if (!state.lastConfirmedSwingHigh || brokenSwing.index > state.lastConfirmedSwingHigh.index) {
              state.lastConfirmedSwingHigh = brokenSwing;
            }
          }
          if (state.currentBias === 'unknown') {
            state.currentBias = 'bullish';
            state.anchorSwing = state.lastConfirmedSwingLow;
          }
        } else {
          const brokenSwing = swingsSorted.find(s => s.index === bos.brokenSwingIndex);
          if (brokenSwing && brokenSwing.type === 'low') {
            if (!state.lastConfirmedSwingLow || brokenSwing.index > state.lastConfirmedSwingLow.index) {
              state.lastConfirmedSwingLow = brokenSwing;
            }
          }
          if (state.currentBias === 'unknown') {
            state.currentBias = 'bearish';
            state.anchorSwing = state.lastConfirmedSwingHigh;
          }
        }
      }
    }

    // Get the last CHoCH event
    const lastChoCh = chochEvents.length > 0 ? chochEvents[chochEvents.length - 1] : null;
    
    // Determine final bias from state machine
    let finalBias: ITFBias = 'neutral';
    let method: 'choch' | 'bos' | 'none' = 'none';
    
    if (state.currentBias === 'bullish' || state.currentBias === 'bearish') {
      // State machine has a clear bias
      finalBias = state.currentBias === 'bullish' ? 'bullish' : 'bearish';
      method = lastChoCh ? 'choch' : 'bos';
    } else if (state.currentBias === 'unknown' && bosEvents.length > 0) {
      // No clear bias from state machine, but we have BOS events - use BOS count
      if (bullishBosCount > bearishBosCount + 1) {
        finalBias = 'bullish';
        method = 'bos';
      } else if (bearishBosCount > bullishBosCount + 1) {
        finalBias = 'bearish';
        method = 'bos';
      } else {
        finalBias = 'sideways';
        method = 'bos';
      }
    } else {
      // Truly neutral - no BOS events or state is unknown
      finalBias = 'neutral';
      method = 'none';
    }

    return {
      bias: finalBias,
      method,
      lastChoCh: lastChoCh ? {
        fromTrend: lastChoCh.fromTrend,
        toTrend: lastChoCh.toTrend,
        index: lastChoCh.index,
        timestamp: lastChoCh.timestamp,
      } : null,
      bosCount: {
        bullish: bullishBosCount,
        bearish: bearishBosCount,
      },
    };
  }

  /**
   * Convert candles to CandleData format (helper for state machine)
   */
  private candlesToData(candles: Candle[]): import('./smc-core/Types').CandleData[] {
    return candles.map(c => ({
      timestamp: c.startTime.getTime(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 0,
    }));
  }
}

