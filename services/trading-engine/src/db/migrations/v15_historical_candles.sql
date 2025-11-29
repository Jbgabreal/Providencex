-- Historical Candles Table for Backtesting
-- Stores M1 candles downloaded from MT5 for backtesting purposes

CREATE TABLE IF NOT EXISTS historical_candles (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  timeframe VARCHAR(10) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  open NUMERIC(20, 8) NOT NULL,
  high NUMERIC(20, 8) NOT NULL,
  low NUMERIC(20, 8) NOT NULL,
  close NUMERIC(20, 8) NOT NULL,
  volume BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(symbol, timeframe, timestamp)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_historical_candles_symbol_timeframe_timestamp 
  ON historical_candles(symbol, timeframe, timestamp);

CREATE INDEX IF NOT EXISTS idx_historical_candles_timestamp 
  ON historical_candles(timestamp);

CREATE INDEX IF NOT EXISTS idx_historical_candles_symbol_timeframe 
  ON historical_candles(symbol, timeframe);

-- Comments
COMMENT ON TABLE historical_candles IS 'Historical OHLCV candles downloaded from MT5 for backtesting';
COMMENT ON COLUMN historical_candles.symbol IS 'Trading symbol (e.g., XAUUSD, EURUSD)';
COMMENT ON COLUMN historical_candles.timeframe IS 'Timeframe (M1, M5, M15, H1, H4)';
COMMENT ON COLUMN historical_candles.timestamp IS 'Candle timestamp (start of candle period)';

