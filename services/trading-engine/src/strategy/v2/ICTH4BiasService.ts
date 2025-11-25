/**
 * ICTH4BiasService - H4 Bias Detection using 3-Candle Pivot (ICT Model)
 * 
 * Implements exact ICT rules for H4 bias:
 * - 3-candle pivot for swing highs/lows
 * - BOS (Break of Structure) for bias determination
 * - CHoCH (Change of Character) for structure reversals
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { SwingPoint } from './smc-core/Types';
import { ChochService } from './smc-core/ChochService';
import { BosService } from './smc-core/BosService';
import { candlesToData } from './smc-core/Types';

const logger = new Logger('ICTH4BiasService');

export interface H4PivotSwing {
  index: number;
  type: 'high' | 'low';
  price: number;
  timestamp: number;
}

export interface ICTH4Bias {
  direction: 'bullish' | 'bearish' | 'sideways';
  lastChoCh?: {
    index: number;
    fromTrend: 'bullish' | 'bearish';
    toTrend: 'bullish' | 'bearish';
    level: number;
  };
  lastBOS?: {
    index: number;
    direction: 'bullish' | 'bearish';
    level: number;
  };
  swingHigh?: number;
  swingLow?: number;
}

export class ICTH4BiasService {
  private chochService: ChochService;
  private bosService: BosService;

  constructor() {
    this.chochService = new ChochService();
    this.bosService = new BosService({
      bosLookbackSwings: 10,
      swingIndexLookback: 50,
      strictClose: true, // ICT uses closing price breaks
    });
  }

  /**
   * Detect 3-candle pivot swings
   * 
   * High pivot: H[i].high > H[i-1].high && H[i].high > H[i+1].high
   * Low pivot: H[i].low < H[i-1].low && H[i].low < H[i+1].low
   */
  detect3CandlePivots(candles: Candle[]): H4PivotSwing[] {
    if (candles.length < 3) return [];
    
    const swings: H4PivotSwing[] = [];
    const candleData = candlesToData(candles);
    
    // Start from index 1, end at length - 2 (need candle before and after)
    for (let i = 1; i < candleData.length - 1; i++) {
      const current = candleData[i];
      const prev = candleData[i - 1];
      const next = candleData[i + 1];
      
      // Check for swing high: current high is highest among the three
      if (current.high > prev.high && current.high > next.high) {
        swings.push({
          index: i,
          type: 'high',
          price: current.high,
          timestamp: current.timestamp,
        });
      }
      
      // Check for swing low: current low is lowest among the three
      if (current.low < prev.low && current.low < next.low) {
        swings.push({
          index: i,
          type: 'low',
          price: current.low,
          timestamp: current.timestamp,
        });
      }
    }
    
    return swings;
  }

  /**
   * Determine H4 bias using ICT rules
   * 
   * Bullish bias: price breaks prior swing high (BOS up)
   * Bearish bias: price breaks prior swing low (BOS down)
   */
  determineH4Bias(h4Candles: Candle[]): ICTH4Bias {
    if (h4Candles.length < 10) {
      return { direction: 'sideways' };
    }
    
    // Detect 3-candle pivot swings
    const pivots = this.detect3CandlePivots(h4Candles);
    
    if (pivots.length < 2) {
      return { direction: 'sideways' };
    }
    
    // Convert pivots to SwingPoint format for BOS/CHoCH services
    const swings: SwingPoint[] = pivots.map(p => ({
      index: p.index,
      type: p.type,
      price: p.price,
      timestamp: p.timestamp,
    }));
    
    // Detect BOS events
    const bosEvents = this.bosService.detectBOS(h4Candles, swings);
    
    // Detect CHoCH events
    const chochEvents = this.chochService.detectChoCh(h4Candles, swings, bosEvents);
    
    // Determine bias from last BOS/CHoCH
    let direction: 'bullish' | 'bearish' | 'sideways' = 'sideways';
    let lastBOS: { index: number; direction: 'bullish' | 'bearish'; level: number } | undefined;
    let lastChoCh: { index: number; fromTrend: 'bullish' | 'bearish'; toTrend: 'bullish' | 'bearish'; level: number } | undefined;
    
    // If we have CHoCH, use the new trend direction from last CHoCH
    if (chochEvents.length > 0) {
      const lastChoch = chochEvents[chochEvents.length - 1];
      direction = lastChoch.toTrend;
      lastChoCh = {
        index: lastChoch.index,
        fromTrend: lastChoch.fromTrend,
        toTrend: lastChoch.toTrend,
        level: lastChoch.level,
      };
    } else if (bosEvents.length > 0) {
      // No CHoCH yet, use last BOS direction
      const lastBos = bosEvents[bosEvents.length - 1];
      direction = lastBos.direction;
      lastBOS = {
        index: lastBos.index,
        direction: lastBos.direction,
        level: lastBos.level,
      };
    }
    
    // Get latest swing high/low
    const swingHighs = pivots.filter(p => p.type === 'high').sort((a, b) => b.index - a.index);
    const swingLows = pivots.filter(p => p.type === 'low').sort((a, b) => b.index - a.index);
    
    return {
      direction,
      lastChoCh,
      lastBOS,
      swingHigh: swingHighs.length > 0 ? swingHighs[0].price : undefined,
      swingLow: swingLows.length > 0 ? swingLows[0].price : undefined,
    };
  }
}

