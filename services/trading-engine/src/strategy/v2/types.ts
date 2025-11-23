/**
 * SMC v2 Strategy Types (Trading Engine v10)
 * 
 * Defines internal types for SMC v2 strategy components
 */

import { Candle } from '../../marketData/types';
import { EnhancedRawSignalV2 } from '@providencex/shared-types';

export type TimeframeType = 'HTF' | 'ITF' | 'LTF';
export type StructureType = 'BOS' | 'CHoCH' | 'MSB' | 'none';

export interface MarketStructureContext {
  candles: Candle[];
  timeframe: TimeframeType;
  swingHigh?: number;
  swingLow?: number;
  swingHighs?: number[]; // Array of swing high prices
  swingLows?: number[]; // Array of swing low prices
  bosEvents?: Array<{
    type: StructureType;
    index: number;
    price: number;
    timestamp: Date;
  }>; // Array of BOS/CHoCH events
  lastBOS?: {
    type: StructureType;
    index: number;
    price: number;
    timestamp: Date;
  };
  trend: 'bullish' | 'bearish' | 'sideways';
}

export interface OrderBlockV2 {
  type: 'bullish' | 'bearish';
  high: number;
  low: number;
  timestamp: Date;
  timeframe: TimeframeType;
  mitigated: boolean;
  wickToBodyRatio: number;
  volumeImbalance: boolean;
  candleIndex: number;
}

export interface FairValueGap {
  type: 'continuation' | 'reversal';
  grade: 'wide' | 'narrow' | 'nested';
  high: number;
  low: number;
  timestamp: Date;
  timeframe: TimeframeType;
  premiumDiscount: 'premium' | 'discount' | 'neutral';
  filled: boolean;
  candleIndices: [number, number, number]; // [before, gap, after]
}

export interface LiquiditySweepContext {
  candles: Candle[];
  eqhLevels: number[]; // Equal Highs
  eqlLevels: number[]; // Equal Lows
  sweeps: Array<{
    type: 'EQH' | 'EQL';
    level: number;
    timestamp: Date;
    confirmed: boolean;
  }>;
}

export interface SessionContext {
  currentTime: Date;
  timezone: string;
  sessionMap: Record<string, 'london' | 'newyork' | 'asian' | 'all'>;
}

export interface SMCV2Context {
  symbol: string;
  htfCandles: Candle[];
  itfCandles: Candle[];
  ltfCandles: Candle[];
  currentPrice: number;
  htfStructure: MarketStructureContext;
  itfStructure: MarketStructureContext;
  ltfStructure: MarketStructureContext;
}

export interface SMCV2Result {
  signal: EnhancedRawSignalV2 | null;
  reason?: string; // Primary human-readable reason for skip or null
  debugReasons?: string[]; // Optional list of detailed reasons
  reasons?: string[]; // Legacy: kept for backward compatibility
  score?: number; // 0-100 confluence score (optional)
}


