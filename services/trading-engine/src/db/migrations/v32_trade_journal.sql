-- v32: Trade Journal Foundation
-- Multi-strategy trade journaling with full setup context

CREATE TABLE IF NOT EXISTS trade_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References (nullable — signal-only entries won't have these)
  trade_decision_id INTEGER,
  executed_trade_id UUID,

  -- Strategy identification
  strategy_key VARCHAR(50) NOT NULL,
  strategy_version VARCHAR(20),
  strategy_profile_key VARCHAR(100),

  -- Trade data
  symbol VARCHAR(20) NOT NULL,
  direction VARCHAR(4) NOT NULL,
  entry_price NUMERIC(20,5),
  stop_loss NUMERIC(20,5),
  take_profit NUMERIC(20,5),
  lot_size NUMERIC(10,4),
  risk_percent NUMERIC(6,3),
  rr_target NUMERIC(6,2),

  -- Lifecycle: signal → open → closed → cancelled
  status VARCHAR(20) NOT NULL DEFAULT 'signal',
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,

  -- Result (populated on close)
  exit_price NUMERIC(20,5),
  profit NUMERIC(20,5),
  r_multiple NUMERIC(10,4),
  result VARCHAR(10),            -- 'win', 'loss', 'breakeven'
  close_reason VARCHAR(50),      -- 'tp_hit', 'sl_hit', 'manual', 'timeout', 'trailing_sl'

  -- Strategy-specific context (JSONB for flexibility)
  setup_context JSONB DEFAULT '{}',   -- Market analysis: bias, sweep levels, FVG, session window
  entry_context JSONB DEFAULT '{}',   -- Entry: OB level, FVG boundary, confirmation candle
  exit_context JSONB DEFAULT '{}',    -- Exit: reason details, trailing SL, partial close

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_trade_journal_strategy ON trade_journal(strategy_key);
CREATE INDEX IF NOT EXISTS idx_trade_journal_symbol ON trade_journal(symbol);
CREATE INDEX IF NOT EXISTS idx_trade_journal_status ON trade_journal(status);
CREATE INDEX IF NOT EXISTS idx_trade_journal_result ON trade_journal(result);
CREATE INDEX IF NOT EXISTS idx_trade_journal_opened_at ON trade_journal(opened_at);
CREATE INDEX IF NOT EXISTS idx_trade_journal_created_at ON trade_journal(created_at);
CREATE INDEX IF NOT EXISTS idx_trade_journal_strategy_symbol ON trade_journal(strategy_key, symbol);
