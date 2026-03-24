-- v25: Follower Safety Controls — extended safety settings, lifecycle events, blocked attempts
-- Phase 4 of ProvidenceX

-- ==================== Extend Follower Subscriptions ====================
-- Add safety settings as JSONB (flexible, avoids ALTER for each new field)
-- Add auto-disable tracking columns

ALTER TABLE follower_subscriptions
  ADD COLUMN IF NOT EXISTS safety_settings JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_disabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_disabled_reason TEXT,
  ADD COLUMN IF NOT EXISTS blocked_symbols TEXT[] DEFAULT '{}';

-- safety_settings JSONB shape:
-- {
--   "max_daily_loss_usd": 100,          -- max loss per day from this mentor
--   "max_concurrent_trades": 5,          -- max open copied trades at once
--   "slippage_tolerance_pct": 2.0,       -- max % price drift from signal entry
--   "late_entry_seconds": 300,            -- max seconds after signal publish to still copy
--   "copy_market_orders": true,           -- allow market order signals
--   "copy_pending_orders": true,          -- allow limit/stop order signals
--   "sync_breakeven": true,               -- sync breakeven updates
--   "sync_close_all": true,               -- sync close-all updates
--   "auto_disable_on_daily_loss": true,   -- auto-disable when daily loss breached
--   "max_lot_size": 5.0,                  -- optional max lot guard
--   "allowed_sessions": ["london", "new_york"]  -- optional session filter
-- }

COMMENT ON COLUMN follower_subscriptions.safety_settings IS 'JSONB safety config: max_daily_loss_usd, max_concurrent_trades, slippage_tolerance_pct, late_entry_seconds, copy_market_orders, copy_pending_orders, sync_breakeven, sync_close_all, auto_disable_on_daily_loss, max_lot_size, allowed_sessions';

-- ==================== Copied Trade Events (Lifecycle Timeline) ====================
CREATE TABLE IF NOT EXISTS copied_trade_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  copied_trade_id UUID NOT NULL REFERENCES copied_trades(id) ON DELETE CASCADE,
  follower_subscription_id UUID NOT NULL REFERENCES follower_subscriptions(id) ON DELETE CASCADE,
  mentor_signal_id UUID NOT NULL,

  event_type TEXT NOT NULL,
  -- Event types:
  -- 'signal_published', 'trade_created', 'order_placed', 'order_filled',
  -- 'sl_moved', 'breakeven_applied', 'partial_close', 'tp_hit', 'sl_hit',
  -- 'close_all_propagated', 'manually_closed', 'blocked_by_guardrail',
  -- 'auto_disabled', 'trade_failed', 'trade_cancelled'

  details JSONB DEFAULT '{}'::jsonb,
  -- e.g. { "old_sl": 1.05, "new_sl": 1.08 } or { "reason": "daily_loss_breached" }

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cte_trade ON copied_trade_events(copied_trade_id);
CREATE INDEX IF NOT EXISTS idx_cte_subscription ON copied_trade_events(follower_subscription_id);
CREATE INDEX IF NOT EXISTS idx_cte_signal ON copied_trade_events(mentor_signal_id);

-- ==================== Blocked Copy Attempts ====================
-- Persists every trade that was NOT copied due to a guardrail.
CREATE TABLE IF NOT EXISTS blocked_copy_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_subscription_id UUID NOT NULL REFERENCES follower_subscriptions(id) ON DELETE CASCADE,
  mentor_signal_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),

  block_reason TEXT NOT NULL,
  -- Reasons:
  -- 'daily_loss_breached', 'max_concurrent_trades', 'symbol_blocked',
  -- 'symbol_not_allowed', 'late_entry', 'slippage_exceeded',
  -- 'order_type_disabled', 'auto_disabled', 'max_lot_exceeded',
  -- 'session_not_allowed', 'subscription_paused', 'entitlement_missing'

  guardrail_type TEXT NOT NULL,
  -- 'daily_loss', 'concurrent_trades', 'symbol_filter', 'timing',
  -- 'order_type', 'auto_disable', 'lot_limit', 'session', 'status', 'entitlement'

  threshold_value TEXT,          -- configured limit (e.g. "100" for max_daily_loss)
  actual_value TEXT,             -- actual value at time of block (e.g. "105.50" current daily loss)
  signal_symbol TEXT,
  signal_direction TEXT,
  signal_entry_price NUMERIC,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blocked_sub ON blocked_copy_attempts(follower_subscription_id);
CREATE INDEX IF NOT EXISTS idx_blocked_user ON blocked_copy_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_blocked_signal ON blocked_copy_attempts(mentor_signal_id);

-- ==================== Subscription Guardrail Events ====================
-- Tracks auto-disable/re-enable events for audit.
CREATE TABLE IF NOT EXISTS subscription_guardrail_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_subscription_id UUID NOT NULL REFERENCES follower_subscriptions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),

  event_type TEXT NOT NULL CHECK (event_type IN ('auto_disabled', 're_enabled', 'guardrail_warning')),
  reason TEXT NOT NULL,
  threshold_value TEXT,
  actual_value TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guardrail_events_sub ON subscription_guardrail_events(follower_subscription_id);
