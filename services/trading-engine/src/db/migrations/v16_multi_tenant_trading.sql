-- Trading Engine v16 - Multi-Tenant Trading Model
-- Users, MT5 accounts, strategy profiles, and user strategy assignments

-- 1) users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  external_auth_id TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) mt5_accounts
CREATE TABLE IF NOT EXISTS mt5_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT,
  account_number TEXT NOT NULL,
  server TEXT NOT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'paused', 'disconnected')),
  connection_meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mt5_accounts_user_id ON mt5_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_mt5_accounts_status ON mt5_accounts(status);

-- 3) strategy_profiles
CREATE TABLE IF NOT EXISTS strategy_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  risk_tier TEXT NOT NULL CHECK (risk_tier IN ('low', 'medium', 'high')),
  implementation_key TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4) user_strategy_assignments
CREATE TABLE IF NOT EXISTS user_strategy_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mt5_account_id UUID NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  strategy_profile_id UUID NOT NULL REFERENCES strategy_profiles(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'stopped')),
  started_at TIMESTAMPTZ,
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_strategy_assignments_user ON user_strategy_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_strategy_assignments_account ON user_strategy_assignments(mt5_account_id);
CREATE INDEX IF NOT EXISTS idx_user_strategy_assignments_status ON user_strategy_assignments(status);

-- Seed initial GOD strategy profile if not exists
INSERT INTO strategy_profiles (
  key,
  name,
  description,
  risk_tier,
  implementation_key,
  config,
  is_public,
  is_frozen
)
SELECT
  'first_successful_strategy_from_god' AS key,
  'First Successful Strategy From GOD' AS name,
  'Frozen snapshot of the first profitable SMC/ICT configuration. Uses H4 bias, M15 setup, and M1 entry with structural M15 swing points for SL and fixed risk-reward TP. Risk is fully managed by the system and cannot be modified by users.' AS description,
  'low' AS risk_tier,
  'GOD_SMC_V1' AS implementation_key,
  jsonb_build_object(
    'risk_per_trade_percent', 0.5,
    'max_daily_drawdown_percent', 3,
    'max_weekly_drawdown_percent', 10,
    'max_open_risk_percent', 3,
    'max_trades_per_day', 2
  ) AS config,
  TRUE AS is_public,
  TRUE AS is_frozen
WHERE NOT EXISTS (
  SELECT 1 FROM strategy_profiles WHERE key = 'first_successful_strategy_from_god'
);


