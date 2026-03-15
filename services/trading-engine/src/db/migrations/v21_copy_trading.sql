-- v21: Copy Trading — Mentor/Follower signal copy system
-- Parallel domain alongside strategy assignments. Does NOT modify existing tables.

-- 1) Mentor profiles (capability model, not a role)
CREATE TABLE IF NOT EXISTS mentor_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  bio TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_approved BOOLEAN NOT NULL DEFAULT FALSE,
  total_followers INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentor_profiles_user_id ON mentor_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_mentor_profiles_active ON mentor_profiles(is_active, is_approved);

-- 2) Mentor signals
CREATE TABLE IF NOT EXISTS mentor_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_profile_id UUID NOT NULL REFERENCES mentor_profiles(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  order_kind TEXT NOT NULL DEFAULT 'market' CHECK (order_kind IN ('market', 'limit', 'stop')),
  entry_price NUMERIC NOT NULL,
  stop_loss NUMERIC NOT NULL,
  tp1 NUMERIC,
  tp2 NUMERIC,
  tp3 NUMERIC,
  tp4 NUMERIC,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'partially_closed', 'closed', 'cancelled')),
  notes TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentor_signals_mentor ON mentor_signals(mentor_profile_id);
CREATE INDEX IF NOT EXISTS idx_mentor_signals_status ON mentor_signals(status);
CREATE INDEX IF NOT EXISTS idx_mentor_signals_published ON mentor_signals(published_at DESC);

-- 3) Mentor signal updates
CREATE TABLE IF NOT EXISTS mentor_signal_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_signal_id UUID NOT NULL REFERENCES mentor_signals(id) ON DELETE CASCADE,
  update_type TEXT NOT NULL CHECK (update_type IN (
    'move_sl', 'breakeven', 'partial_close', 'close_all', 'cancel', 'modify_tp'
  )),
  new_sl NUMERIC,
  close_tp_level INTEGER CHECK (close_tp_level BETWEEN 1 AND 4),
  new_tp_value NUMERIC,
  notes TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  propagation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (propagation_status IN ('pending', 'propagating', 'completed', 'failed')),
  propagated_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_updates_signal ON mentor_signal_updates(mentor_signal_id);
CREATE INDEX IF NOT EXISTS idx_signal_updates_propagation ON mentor_signal_updates(propagation_status);

-- 4) Follower subscriptions (account-specific)
CREATE TABLE IF NOT EXISTS follower_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mentor_profile_id UUID NOT NULL REFERENCES mentor_profiles(id) ON DELETE CASCADE,
  mt5_account_id UUID NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'auto_trade' CHECK (mode IN ('auto_trade', 'view_only')),
  risk_mode TEXT NOT NULL DEFAULT 'percentage' CHECK (risk_mode IN ('percentage', 'usd', 'fixed_lot')),
  risk_amount NUMERIC NOT NULL DEFAULT 1.0,
  selected_tp_levels INTEGER[] NOT NULL DEFAULT '{1}',
  selected_symbols TEXT[] NOT NULL DEFAULT '{}',  -- empty = copy all pairs
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'stopped')),
  UNIQUE(user_id, mentor_profile_id, mt5_account_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_follower_subs_user ON follower_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_follower_subs_mentor ON follower_subscriptions(mentor_profile_id);
CREATE INDEX IF NOT EXISTS idx_follower_subs_active ON follower_subscriptions(mentor_profile_id, status) WHERE status = 'active';

-- 5) Copied trades (one row per TP level per follower per signal)
CREATE TABLE IF NOT EXISTS copied_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_subscription_id UUID NOT NULL REFERENCES follower_subscriptions(id) ON DELETE CASCADE,
  mentor_signal_id UUID NOT NULL REFERENCES mentor_signals(id) ON DELETE CASCADE,
  tp_level INTEGER NOT NULL CHECK (tp_level BETWEEN 1 AND 4),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mt5_account_id UUID NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  mt5_ticket BIGINT,
  broker_type TEXT NOT NULL DEFAULT 'mt5',
  lot_size NUMERIC,
  entry_price NUMERIC,
  stop_loss NUMERIC NOT NULL,
  take_profit NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'executing', 'open', 'closed', 'failed', 'cancelled')),
  exit_price NUMERIC,
  profit NUMERIC,
  closed_at TIMESTAMPTZ,
  close_reason TEXT,
  error_message TEXT,
  executed_trade_id UUID REFERENCES executed_trades(id) ON DELETE SET NULL,
  UNIQUE(follower_subscription_id, mentor_signal_id, tp_level),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copied_trades_subscription ON copied_trades(follower_subscription_id);
CREATE INDEX IF NOT EXISTS idx_copied_trades_signal ON copied_trades(mentor_signal_id);
CREATE INDEX IF NOT EXISTS idx_copied_trades_user ON copied_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_copied_trades_status ON copied_trades(status);
CREATE INDEX IF NOT EXISTS idx_copied_trades_open ON copied_trades(mentor_signal_id, status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_copied_trades_ticket ON copied_trades(mt5_ticket) WHERE mt5_ticket IS NOT NULL;
