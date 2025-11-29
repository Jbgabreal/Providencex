-- Trading Engine v17 - Analytics & Transparency Layer
-- Trade history and daily metrics for multi-tenant SaaS dashboard

-- 1) executed_trades
-- Stores complete trade history per user/account/strategy
CREATE TABLE IF NOT EXISTS executed_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mt5_account_id UUID NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  strategy_profile_id UUID NOT NULL REFERENCES strategy_profiles(id) ON DELETE RESTRICT,
  assignment_id UUID REFERENCES user_strategy_assignments(id) ON DELETE SET NULL,
  
  -- MT5 trade identifiers
  mt5_ticket BIGINT NOT NULL,
  mt5_order_id BIGINT,
  
  -- Trade details
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  lot_size NUMERIC NOT NULL,
  entry_price NUMERIC NOT NULL,
  stop_loss_price NUMERIC,
  take_profit_price NUMERIC,
  
  -- Exit details (null until trade closes)
  exit_price NUMERIC,
  closed_at TIMESTAMPTZ,
  
  -- PnL
  profit NUMERIC, -- Realized PnL (null until closed)
  commission NUMERIC,
  swap NUMERIC,
  
  -- Timestamps
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Metadata
  entry_reason TEXT,
  exit_reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for executed_trades
CREATE INDEX IF NOT EXISTS idx_executed_trades_user_id ON executed_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_executed_trades_mt5_account_id ON executed_trades(mt5_account_id);
CREATE INDEX IF NOT EXISTS idx_executed_trades_strategy_profile_id ON executed_trades(strategy_profile_id);
CREATE INDEX IF NOT EXISTS idx_executed_trades_assignment_id ON executed_trades(assignment_id);
CREATE INDEX IF NOT EXISTS idx_executed_trades_mt5_ticket ON executed_trades(mt5_ticket);
CREATE INDEX IF NOT EXISTS idx_executed_trades_opened_at ON executed_trades(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_executed_trades_closed_at ON executed_trades(closed_at DESC) WHERE closed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_executed_trades_user_account_strategy ON executed_trades(user_id, mt5_account_id, strategy_profile_id);
CREATE INDEX IF NOT EXISTS idx_executed_trades_symbol ON executed_trades(symbol);

-- 2) daily_account_metrics
-- Daily aggregated metrics per account+strategy for fast dashboard queries
CREATE TABLE IF NOT EXISTS daily_account_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mt5_account_id UUID NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  strategy_profile_id UUID NOT NULL REFERENCES strategy_profiles(id) ON DELETE RESTRICT,
  assignment_id UUID REFERENCES user_strategy_assignments(id) ON DELETE SET NULL,
  
  -- Account state
  balance_start NUMERIC NOT NULL,
  balance_end NUMERIC NOT NULL,
  equity_start NUMERIC NOT NULL,
  equity_end NUMERIC NOT NULL,
  
  -- PnL
  realized_pnl NUMERIC NOT NULL DEFAULT 0,
  unrealized_pnl NUMERIC NOT NULL DEFAULT 0,
  total_pnl NUMERIC NOT NULL DEFAULT 0,
  
  -- Trade counts
  trades_opened INTEGER NOT NULL DEFAULT 0,
  trades_closed INTEGER NOT NULL DEFAULT 0,
  trades_won INTEGER NOT NULL DEFAULT 0,
  trades_lost INTEGER NOT NULL DEFAULT 0,
  
  -- Risk metrics
  max_drawdown NUMERIC NOT NULL DEFAULT 0,
  max_drawdown_percent NUMERIC NOT NULL DEFAULT 0,
  
  -- Performance metrics (computed)
  win_rate NUMERIC, -- percentage (0-100)
  profit_factor NUMERIC,
  average_win NUMERIC,
  average_loss NUMERIC,
  largest_win NUMERIC,
  largest_loss NUMERIC,
  average_r NUMERIC, -- average risk-reward ratio
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Ensure one row per day per account+strategy
  UNIQUE(date, mt5_account_id, strategy_profile_id)
);

-- Indexes for daily_account_metrics
CREATE INDEX IF NOT EXISTS idx_daily_account_metrics_user_id ON daily_account_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_account_metrics_mt5_account_id ON daily_account_metrics(mt5_account_id);
CREATE INDEX IF NOT EXISTS idx_daily_account_metrics_strategy_profile_id ON daily_account_metrics(strategy_profile_id);
CREATE INDEX IF NOT EXISTS idx_daily_account_metrics_date ON daily_account_metrics(date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_account_metrics_user_account_strategy ON daily_account_metrics(user_id, mt5_account_id, strategy_profile_id);
CREATE INDEX IF NOT EXISTS idx_daily_account_metrics_date_range ON daily_account_metrics(date, mt5_account_id, strategy_profile_id);

