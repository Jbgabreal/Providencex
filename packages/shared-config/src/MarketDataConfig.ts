/**
 * Market Data Configuration
 * 
 * Configuration for real-time market data feed and candle building
 */

export interface MarketDataConfig {
  /**
   * List of symbols to track (e.g. ["XAUUSD", "EURUSD", "GBPUSD", "US30"])
   */
  symbols: string[];

  /**
   * Polling interval in seconds for fetching price ticks from MT5 Connector
   * Default: 1 second
   */
  feedIntervalSec: number;

  /**
   * Maximum number of candles to keep per symbol in memory
   * Default: 10000 (supports ~167 H1 candles, enough for SMC v2 which needs 20+)
   */
  maxCandlesPerSymbol: number;
}

/**
 * Default market data configuration
 * Loads from environment variables or uses sensible defaults
 */
export function getMarketDataConfig(): MarketDataConfig {
  const symbols = process.env.MARKET_SYMBOLS
    ? process.env.MARKET_SYMBOLS.split(',').map(s => s.trim())
    : (process.env.TRADING_SYMBOLS
        ? process.env.TRADING_SYMBOLS.split(',').map(s => s.trim())
        : ['XAUUSD', 'EURUSD', 'GBPUSD', 'US30']);

  return {
    symbols,
    feedIntervalSec: parseInt(process.env.MARKET_FEED_INTERVAL_SEC || '1', 10),
    maxCandlesPerSymbol: parseInt(process.env.MARKET_MAX_CANDLES_PER_SYMBOL || '10000', 10),
  };
}


