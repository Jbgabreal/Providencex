-- v29: Shadow / Simulation Mode — simulated trades for follower evaluation
-- Phase 8 of ProvidenceX

-- ==================== Extend Subscription Mode ====================
-- Drop the old CHECK constraint and add the new one with 'shadow'
ALTER TABLE follower_subscriptions DROP CONSTRAINT IF EXISTS follower_subscriptions_mode_check;
ALTER TABLE follower_subscriptions ADD CONSTRAINT follower_subscriptions_mode_check
  CHECK (mode IN ('auto_trade', 'view_only', 'shadow'));

-- ==================== Simulated Trades ====================
-- Mirrors copied_trades but for shadow mode. No broker execution.
CREATE TABLE IF NOT EXISTS simulated_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_subscription_id UUID NOT NULL REFERENCES follower_subscriptions(id) ON DELETE CASCADE,
  mentor_signal_id UUID NOT NULL REFERENCES mentor_signals(id) ON DELETE CASCADE,
  tp_level INTEGER NOT NULL CHECK (tp_level BETWEEN 1 AND 4),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Signal data snapshot
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  order_kind TEXT NOT NULL DEFAULT 'market',

  -- Prices
  entry_price NUMERIC NOT NULL,          -- simulated fill at signal entry
  stop_loss NUMERIC NOT NULL,
  take_profit NUMERIC,
  lot_size NUMERIC NOT NULL DEFAULT 0.01,

  -- Status lifecycle
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
  exit_price NUMERIC,
  simulated_pnl NUMERIC,
  close_reason TEXT,
  -- 'tp_hit', 'sl_hit', 'mentor_close_all', 'mentor_partial_close', 'mentor_cancel',
  -- 'mentor_breakeven' (for SL move events), 'manual_close'

  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(follower_subscription_id, mentor_signal_id, tp_level)
);

CREATE INDEX IF NOT EXISTS idx_sim_trades_user ON simulated_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_sim_trades_sub ON simulated_trades(follower_subscription_id);
CREATE INDEX IF NOT EXISTS idx_sim_trades_signal ON simulated_trades(mentor_signal_id);
CREATE INDEX IF NOT EXISTS idx_sim_trades_status ON simulated_trades(user_id, status);

-- ==================== Simulated Trade Events ====================
CREATE TABLE IF NOT EXISTS simulated_trade_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  simulated_trade_id UUID NOT NULL REFERENCES simulated_trades(id) ON DELETE CASCADE,
  follower_subscription_id UUID NOT NULL,
  mentor_signal_id UUID NOT NULL,

  event_type TEXT NOT NULL,
  -- 'trade_opened', 'sl_moved', 'breakeven_applied', 'partial_close',
  -- 'tp_hit', 'sl_hit', 'close_all', 'cancelled', 'manual_close'

  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sim_events_trade ON simulated_trade_events(simulated_trade_id);
CREATE INDEX IF NOT EXISTS idx_sim_events_sub ON simulated_trade_events(follower_subscription_id);
