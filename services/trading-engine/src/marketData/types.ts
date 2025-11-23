/**
 * Market Data Types
 * Defines interfaces for Tick and Candle data structures
 * 
 * Internal representation uses Date objects for easier manipulation.
 * External serialization can convert to epoch millis and ISO strings as needed.
 */

/**
 * Tick - Internal representation
 * Uses Date objects internally for type safety and convenience
 */
export interface Tick {
  symbol: string;        // Canonical symbol (e.g., "XAUUSD")
  bid: number;          // Bid price
  ask: number;          // Ask price
  mid: number;          // Mid price ((bid + ask) / 2)
  time: Date;           // Timestamp (internal: Date object)
  
  // Computed properties for external serialization (PRD alignment)
  /** Epoch milliseconds (for external APIs/logging) */
  timeMillis?: number;
  /** ISO 8601 string (for external APIs/logging) */
  timeIso?: string;
}

/**
 * Candle - Internal representation
 * Uses Date objects internally for type safety and convenience
 */
export interface Candle {
  symbol: string;       // Canonical symbol (e.g., "XAUUSD")
  timeframe: 'M1';      // Timeframe identifier (M1 = 1 minute)
  open: number;         // Opening price (first tick of the minute)
  high: number;         // Highest price (max of mid prices in the minute)
  low: number;          // Lowest price (min of mid prices in the minute)
  close: number;        // Closing price (last tick of the minute)
  volume: number;       // Tick count for now
  startTime: Date;      // Start of candle window (internal: Date object)
  endTime: Date;        // End of candle window (internal: Date object)
  
  // Computed properties for external serialization (PRD alignment)
  /** ISO 8601 string for candle start (for external APIs/logging) */
  openTime?: string;
  /** ISO 8601 string for candle end (for external APIs/logging) */
  closeTime?: string;
}

/**
 * Helper to convert Tick to PRD-aligned external format
 * Returns a new object with time as number instead of Date
 */
export function tickToExternal(tick: Tick): Omit<Tick, 'time'> & { time: number; timeIso: string; timeMillis: number } {
  return {
    symbol: tick.symbol,
    bid: tick.bid,
    ask: tick.ask,
    mid: tick.mid,
    time: tick.time.getTime(),
    timeMillis: tick.time.getTime(),
    timeIso: tick.time.toISOString(),
  };
}

/**
 * Helper to convert Candle to PRD-aligned external format
 */
export function candleToExternal(candle: Candle): Omit<Candle, 'startTime' | 'endTime'> & {
  openTime: string;
  closeTime: string;
} {
  return {
    ...candle,
    openTime: candle.startTime.toISOString(),
    closeTime: candle.endTime.toISOString(),
  };
}

