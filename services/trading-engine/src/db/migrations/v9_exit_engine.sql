-- Trading Engine v9 - Exit Engine Migrations

-- 1. exit_plans table (stores exit configuration per trade)
CREATE TABLE IF NOT EXISTS exit_plans (
  exit_plan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id INTEGER REFERENCES trade_decisions(id) ON DELETE CASCADE,
  symbol VARCHAR(20) NOT NULL,
  entry_price DOUBLE PRECISION NOT NULL,
  tp1 DOUBLE PRECISION,
  tp2 DOUBLE PRECISION,
  tp3 DOUBLE PRECISION,
  stop_loss_initial DOUBLE PRECISION NOT NULL,
  break_even_trigger DOUBLE PRECISION, -- Profit in pips before moving SL to BE
  partial_close_percent DOUBLE PRECISION, -- Percentage to close at TP1 (e.g., 50)
  trail_mode VARCHAR(32), -- 'atr', 'fixed_pips', 'structure', 'volatility_adaptive'
  trail_value DOUBLE PRECISION, -- ATR multiplier or fixed pips
  time_limit_seconds INTEGER, -- Max time position can stay open
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exit_plans_decision_id ON exit_plans(decision_id);
CREATE INDEX IF NOT EXISTS idx_exit_plans_symbol ON exit_plans(symbol);
CREATE INDEX IF NOT EXISTS idx_exit_plans_created_at ON exit_plans(created_at);

-- 2. Extend live_trades table with exit-related fields
ALTER TABLE live_trades
  ADD COLUMN IF NOT EXISTS exit_action VARCHAR(32), -- 'tp', 'sl', 'break_even', 'partial', 'trail', 'time', 'commission', 'kill_switch'
  ADD COLUMN IF NOT EXISTS exit_reason TEXT,
  ADD COLUMN IF NOT EXISTS exit_plan_id UUID REFERENCES exit_plans(exit_plan_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_live_trades_exit_plan_id ON live_trades(exit_plan_id);

-- 3. Update order_events to support new event types (already handled by application layer, but ensure enum compatibility)
-- Note: We use VARCHAR(32) which allows any event type, so no migration needed


