/**
 * TradingView Integration Types
 *
 * Types for communicating with TradingView Desktop via CDP
 * and translating Pine indicator data into trading signals.
 */

// --- CDP Transport Types ---

export interface CDPTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export interface CDPEvalResult {
  result: {
    type: string;
    value?: any;
    description?: string;
  };
  exceptionDetails?: {
    text: string;
    exception?: { description: string };
  };
}

// --- Pine Indicator Data Types ---

export interface PineBox {
  high: number;
  low: number;
  x1?: number; // left bar index
  x2?: number; // right bar index
  borderColor?: string;
  bgColor?: string;
}

export interface PineLabel {
  text: string;
  price: number | null;
  x?: number; // bar index
}

export interface PineLine {
  y1: number;
  y2: number;
  x1?: number;
  x2?: number;
  horizontal: boolean;
}

export interface PineStudyData {
  name: string;
  boxes: PineBox[];
  labels: PineLabel[];
  lines: PineLine[];
}

export interface TVQuote {
  symbol: string;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  bid?: number;
  ask?: number;
}

export interface TVBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TVChartState {
  symbol: string;
  resolution: string;
  studies: { id: string; name: string }[];
}

// --- Signal Interpretation Types ---

/** Detected order block zone from Pine box drawings */
export interface TVOrderBlock {
  high: number;
  low: number;
  midpoint: number;
  type: 'bullish' | 'bearish';
}

/** Detected bias from Pine label text */
export interface TVBias {
  direction: 'bullish' | 'bearish' | 'sideways';
  source: string; // which indicator produced it
}

/** Detected key level from Pine line drawings */
export interface TVKeyLevel {
  price: number;
  type: 'swing_high' | 'swing_low' | 'fvg_top' | 'fvg_bottom' | 'support' | 'resistance' | 'unknown';
}

/** Entry signal parsed from Pine labels */
export interface TVEntrySignal {
  direction: 'buy' | 'sell';
  price: number;
  source: string;
}

/** Full snapshot of TradingView chart analysis for one symbol */
export interface TVChartSnapshot {
  symbol: string;
  resolution: string;
  timestamp: number;
  quote: TVQuote;
  orderBlocks: TVOrderBlock[];
  bias: TVBias | null;
  keyLevels: TVKeyLevel[];
  entrySignals: TVEntrySignal[];
  rawStudies: PineStudyData[];
}

// --- Bridge Config ---

export interface TradingViewBridgeConfig {
  cdpHost: string;
  cdpPort: number;
  reconnectIntervalMs: number;
  maxReconnectAttempts: number;
}

export const DEFAULT_TV_BRIDGE_CONFIG: TradingViewBridgeConfig = {
  cdpHost: 'localhost',
  cdpPort: 9222,
  reconnectIntervalMs: 2000,
  maxReconnectAttempts: 5,
};
