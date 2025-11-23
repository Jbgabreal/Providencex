-- Trading Engine v12 - Multi-Account Tables Migration
-- Creates tables for multi-account distributed execution

-- Table: account_trade_decisions
-- Stores trade decisions per account
CREATE TABLE IF NOT EXISTS account_trade_decisions (
  id BIGSERIAL PRIMARY KEY,
  account_id VARCHAR(64) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  strategy VARCHAR(32) NOT NULL,
  decision VARCHAR(16) NOT NULL CHECK (decision IN ('TRADE', 'SKIP')),
  risk_reason TEXT,
  filter_reason TEXT,
  kill_switch_reason TEXT,
  execution_result JSONB, -- {success: boolean, ticket?: number, error?: string}
  pnl NUMERIC, -- Realized PnL (null until trade closes)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for account_trade_decisions
CREATE INDEX IF NOT EXISTS idx_account_trade_decisions_account_id ON account_trade_decisions(account_id);
CREATE INDEX IF NOT EXISTS idx_account_trade_decisions_timestamp ON account_trade_decisions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_account_trade_decisions_symbol ON account_trade_decisions(symbol);
CREATE INDEX IF NOT EXISTS idx_account_trade_decisions_strategy ON account_trade_decisions(strategy);
CREATE INDEX IF NOT EXISTS idx_account_trade_decisions_decision ON account_trade_decisions(decision);
CREATE INDEX IF NOT EXISTS idx_account_trade_decisions_account_timestamp ON account_trade_decisions(account_id, timestamp DESC);

-- Table: account_live_equity
-- Stores equity snapshots per account
CREATE TABLE IF NOT EXISTS account_live_equity (
  id BIGSERIAL PRIMARY KEY,
  account_id VARCHAR(64) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  equity NUMERIC NOT NULL,
  balance NUMERIC NOT NULL,
  floating_pnl NUMERIC,
  drawdown NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for account_live_equity
CREATE INDEX IF NOT EXISTS idx_account_live_equity_account_id ON account_live_equity(account_id);
CREATE INDEX IF NOT EXISTS idx_account_live_equity_timestamp ON account_live_equity(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_account_live_equity_account_timestamp ON account_live_equity(account_id, timestamp DESC);

-- Table: account_kill_switch_events
-- Stores kill switch activation/deactivation events per account
CREATE TABLE IF NOT EXISTS account_kill_switch_events (
  id BIGSERIAL PRIMARY KEY,
  account_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('activated', 'deactivated')),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for account_kill_switch_events
CREATE INDEX IF NOT EXISTS idx_account_kill_switch_events_account_id ON account_kill_switch_events(account_id);
CREATE INDEX IF NOT EXISTS idx_account_kill_switch_events_created_at ON account_kill_switch_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_kill_switch_events_account_created ON account_kill_switch_events(account_id, created_at DESC);

