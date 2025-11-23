/**
 * SMC Core Types - Formal SMC/ICT Algorithm Types
 * 
 * Based on SMC_research.md formal specifications
 * All types match the research document exactly
 */

import { Candle } from '../../../marketData/types';

/**
 * Core Candle type (matches research document)
 */
export type CandleData = {
  timestamp: number; // ms since epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/**
 * Swing Type
 */
export type SwingType = 'high' | 'low';

/**
 * Swing Point - Formal swing detection result
 */
export type SwingPoint = {
  index: number;      // index into candles array
  type: SwingType;
  price: number;
  timestamp: number;  // ms since epoch
};

/**
 * BOS Direction
 */
export type BosDirection = 'bullish' | 'bearish';

/**
 * BOS Event - Formal Break of Structure event
 */
export type BosEvent = {
  index: number;          // candle index where BOS confirmed
  direction: BosDirection;
  brokenSwingIndex: number;
  brokenSwingType: SwingType;
  level: number;          // price of broken swing
  timestamp: number;     // ms since epoch
  strictClose: boolean;   // whether strict close was used
};

/**
 * Trend Bias
 */
export type TrendBias = 'bullish' | 'bearish' | 'sideways';

/**
 * Trend Bias Snapshot - Per-candle trend state
 */
export type TrendBiasSnapshot = {
  index: number;
  timestamp: number;      // ms since epoch
  trend: TrendBias;
  lastSwingHigh?: number | null;
  lastSwingLow?: number | null;
  lastBosDirection?: BosDirection | null;
  pdPosition?: number | null;   // 0..1 in PD array (low->high)
  swingHighs: number[];  // Recent swing highs
  swingLows: number[];   // Recent swing lows
};

/**
 * CHoCH Event - Change of Character event
 */
export type ChoChEvent = {
  index: number;               // candle index where CHoCH BOS happened
  timestamp: number;           // ms since epoch
  fromTrend: 'bullish' | 'bearish';
  toTrend: 'bullish' | 'bearish';
  brokenSwingIndex: number;
  brokenSwingType: SwingType;
  level: number;
  bosIndex: number;            // same as index
};

/**
 * MSB Event - Market Structure Break (stronger CHoCH)
 */
export type MsbEvent = {
  index: number;               // candle index where MSB occurred
  timestamp: number;           // ms since epoch
  fromTrend: 'bullish' | 'bearish';
  toTrend: 'bullish' | 'bearish';
  brokenSwingIndex: number;
  brokenSwingType: SwingType;
  level: number;
  bosIndex: number;            // BOS that triggered MSB
  isMajorSwing: boolean;       // whether broken swing was a major swing
};

/**
 * Structural Swing Leg - A run of 3+ consecutive candles in same direction
 */
export type StructuralSwingLeg = {
  startIndex: number;          // first candle index in leg
  endIndex: number;            // last candle index in leg
  direction: 'bullish' | 'bearish';
  swingHigh: number;           // max high in leg
  swingLow: number;            // min low in leg
  highIndex: number;           // candle index where swingHigh occurred
  lowIndex: number;            // candle index where swingLow occurred
  candleCount: number;         // number of candles in leg (must be >= 3)
};

/**
 * Structural Swing - Alternating swing from completed legs
 */
export type StructuralSwing = {
  index: number;               // index of swing point (high or low)
  type: SwingType;             // 'high' for bullish leg, 'low' for bearish leg
  price: number;                // swing high or low price
  timestamp: number;           // ms since epoch
  leg: StructuralSwingLeg;     // the leg that created this swing
  isMajor: boolean;            // whether this is a major swing (longer leg or larger range)
};

/**
 * Swing Detection Configuration
 */
export type SwingConfig = {
  method: 'fractal' | 'rolling' | 'hybrid';
  pivotLeft?: number;          // for fractal method
  pivotRight?: number;          // for fractal method
  lookbackHigh?: number;        // for rolling method
  lookbackLow?: number;         // for rolling method
};

/**
 * BOS Detection Configuration
 */
export type BosConfig = {
  bosLookbackSwings: number;   // how many previous swings to consider
  swingIndexLookback: number;  // how far back in candle indices
  strictClose: boolean;         // true = ICT-style strict close; false = wick allowed
};

/**
 * Trend Configuration
 */
export type TrendConfig = {
  minSwingPairs: number;       // how many recent swing pairs to confirm trend
  discountMax: number;         // e.g., 0.5 (0-0.5 is discount)
  premiumMin: number;          // e.g., 0.5 (0.5-1 is premium)
};

/**
 * Framework Configuration
 */
export type FrameworkConfig = {
  swing: SwingConfig;
  bos: BosConfig;
  trend: TrendConfig;
};

/**
 * Timeframe Analysis - Complete analysis for one timeframe
 */
export type TimeframeAnalysis = {
  candles: Candle[];
  swings: SwingPoint[];
  structuralSwings?: StructuralSwing[];  // structural swings from 3-candle rule
  bosEvents: BosEvent[];
  trendSnapshots: TrendBiasSnapshot[];
  chochEvents: ChoChEvent[];
  msbEvents?: MsbEvent[];                 // Market Structure Break events
};

/**
 * Multi-Timeframe Context
 */
export type MultiTimeframeContext = {
  htf: TimeframeAnalysis;
  itf: TimeframeAnalysis;
  ltf: TimeframeAnalysis;
  entrySignals?: EntrySignal[];
};

/**
 * Entry Signal Direction
 */
export type EntrySignalDirection = 'long' | 'short';

/**
 * Entry Signal
 */
export type EntrySignal = {
  direction: EntrySignalDirection;
  timeframe: 'LTF';
  index: number;
  timestamp: number;  // ms since epoch
  reason: string;
};

/**
 * Helper: Convert MarketData Candle to CandleData
 */
export function candleToData(candle: Candle): CandleData {
  return {
    timestamp: candle.startTime.getTime(),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  };
}

/**
 * Helper: Convert Candle array to CandleData array
 */
export function candlesToData(candles: Candle[]): CandleData[] {
  return candles.map(candleToData);
}

