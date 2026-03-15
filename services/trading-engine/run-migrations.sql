-- ============================================================================
-- ProvidenceX Multi-Tenant Database Migrations
-- ============================================================================
-- Run this script in your Supabase SQL Editor to create the required tables
-- for the multi-tenant client portal system.
--
-- This combines:
--   - v16_multi_tenant_trading.sql (users, accounts, strategies)
--   - v17_analytics_tables.sql (trade history, analytics)
-- ============================================================================

-- ============================================================================
-- v16: Multi-Tenant Trading Tables
-- ============================================================================

-- Users table (linked to Privy authentication)
-- Note: Uses external_auth_id (Privy user ID) as the unique identifier
-- Email is required for all users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  external_auth_id TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add unique constraint on external_auth_id if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'users' 
    AND constraint_name = 'users_external_auth_id_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_external_auth_id_key UNIQUE (external_auth_id);
  END IF;
END $$;

-- Ensure email is NOT NULL (for existing tables that might have been altered)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' 
    AND column_name = 'email' 
    AND is_nullable = 'YES'
  ) THEN
    -- Make email NOT NULL
    ALTER TABLE users ALTER COLUMN email SET NOT NULL;
  END IF;
  
  -- Ensure unique constraint on email exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'users' 
    AND constraint_name = 'users_email_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_external_auth_id ON users(external_auth_id) WHERE external_auth_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- MT5 Accounts table
CREATE TABLE IF NOT EXISTS mt5_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT,
  account_number TEXT NOT NULL,
  server TEXT NOT NULL,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'paused', 'disconnected')),
  connection_meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disconnected_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mt5_accounts_user_id ON mt5_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_mt5_accounts_status ON mt5_accounts(status);

-- Strategy Profiles table (catalog of available strategies)
CREATE TABLE IF NOT EXISTS strategy_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  risk_tier TEXT NOT NULL CHECK (risk_tier IN ('low', 'medium', 'high')),
  implementation_key TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT true,
  is_frozen BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_profiles_key ON strategy_profiles(key);
CREATE INDEX IF NOT EXISTS idx_strategy_profiles_risk_tier ON strategy_profiles(risk_tier);
CREATE INDEX IF NOT EXISTS idx_strategy_profiles_is_public ON strategy_profiles(is_public);

-- User Strategy Assignments (links users + accounts to strategies)
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

-- ============================================================================
-- v17: Analytics Tables
-- ============================================================================

-- Executed Trades table (trade history)
CREATE TABLE IF NOT EXISTS executed_trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mt5_account_id UUID NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  strategy_profile_id UUID NOT NULL REFERENCES strategy_profiles(id) ON DELETE RESTRICT,
  assignment_id UUID REFERENCES user_strategy_assignments(id) ON DELETE SET NULL,
  mt5_ticket BIGINT NOT NULL,
  mt5_order_id BIGINT,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  lot_size NUMERIC NOT NULL,
  entry_price NUMERIC NOT NULL,
  stop_loss_price NUMERIC,
  take_profit_price NUMERIC,
  exit_price NUMERIC,
  closed_at TIMESTAMPTZ,
  profit NUMERIC,
  commission NUMERIC,
  swap NUMERIC,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  entry_reason TEXT,
  exit_reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_executed_trades_user_id ON executed_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_executed_trades_mt5_account_id ON executed_trades(mt5_account_id);
CREATE INDEX IF NOT EXISTS idx_executed_trades_strategy_profile_id ON executed_trades(strategy_profile_id);
CREATE INDEX IF NOT EXISTS idx_executed_trades_assignment_id ON executed_trades(assignment_id);
CREATE INDEX IF NOT EXISTS idx_executed_trades_mt5_ticket ON executed_trades(mt5_ticket);
CREATE INDEX IF NOT EXISTS idx_executed_trades_opened_at ON executed_trades(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_executed_trades_closed_at ON executed_trades(closed_at DESC) WHERE closed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_executed_trades_user_account_strategy ON executed_trades(user_id, mt5_account_id, strategy_profile_id);
CREATE INDEX IF NOT EXISTS idx_executed_trades_symbol ON executed_trades(symbol);
CREATE INDEX IF NOT EXISTS idx_executed_trades_strategy_date ON executed_trades(strategy_profile_id, opened_at DESC);

-- Daily Account Metrics table (for analytics and equity curves)
CREATE TABLE IF NOT EXISTS daily_account_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mt5_account_id UUID NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE,
  strategy_profile_id UUID NOT NULL REFERENCES strategy_profiles(id) ON DELETE RESTRICT,
  assignment_id UUID REFERENCES user_strategy_assignments(id) ON DELETE SET NULL,
  balance_start NUMERIC(20, 2) NOT NULL,
  balance_end NUMERIC(20, 2) NOT NULL,
  equity_start NUMERIC(20, 2) NOT NULL,
  equity_end NUMERIC(20, 2) NOT NULL,
  realized_pnl NUMERIC(20, 2) NOT NULL DEFAULT 0,
  unrealized_pnl NUMERIC(20, 2) NOT NULL DEFAULT 0,
  total_pnl NUMERIC(20, 2) NOT NULL DEFAULT 0,
  trades_opened INTEGER NOT NULL DEFAULT 0,
  trades_closed INTEGER NOT NULL DEFAULT 0,
  trades_won INTEGER NOT NULL DEFAULT 0,
  trades_lost INTEGER NOT NULL DEFAULT 0,
  max_drawdown NUMERIC(20, 2) NOT NULL DEFAULT 0,
  max_drawdown_percent NUMERIC(10, 4) NOT NULL DEFAULT 0,
  win_rate NUMERIC(10, 4),
  profit_factor NUMERIC(10, 4),
  average_win NUMERIC(20, 2),
  average_loss NUMERIC(20, 2),
  largest_win NUMERIC(20, 2),
  largest_loss NUMERIC(20, 2),
  average_r NUMERIC(10, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(date, mt5_account_id, strategy_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_account_metrics_user_id ON daily_account_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_account_metrics_mt5_account_id ON daily_account_metrics(mt5_account_id);
CREATE INDEX IF NOT EXISTS idx_daily_account_metrics_strategy_profile_id ON daily_account_metrics(strategy_profile_id);
CREATE INDEX IF NOT EXISTS idx_daily_account_metrics_date ON daily_account_metrics(date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_account_metrics_user_account_strategy ON daily_account_metrics(user_id, mt5_account_id, strategy_profile_id);
CREATE INDEX IF NOT EXISTS idx_daily_account_metrics_date_range ON daily_account_metrics(date, mt5_account_id, strategy_profile_id);
CREATE INDEX IF NOT EXISTS idx_daily_account_metrics_strategy_date ON daily_account_metrics(strategy_profile_id, date ASC);

-- ============================================================================
-- Insert Default Strategy Profiles
-- ============================================================================

-- Insert GOD Strategy (if it doesn't exist) - matches v16 migration
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

-- Insert Market Structure Strategy (if it doesn't exist)
INSERT INTO strategy_profiles (key, name, description, risk_tier, implementation_key, config, is_public, is_frozen)
SELECT
  'market_structure_v1' AS key,
  'Market Structure Strategy' AS name,
  'Multi-timeframe market structure analysis with H4 bias, M15 setup, M5 POI, and M1 confirmation' AS description,
  'medium' AS risk_tier,
  'MARKET_STRUCTURE_V1' AS implementation_key,
  '{}'::jsonb AS config,
  TRUE AS is_public,
  FALSE AS is_frozen
WHERE NOT EXISTS (
  SELECT 1 FROM strategy_profiles WHERE key = 'market_structure_v1'
);

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Verify tables were created
DO $$
-- System Settings table (for admin-configurable settings)
CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(key);

-- Insert default MT5 Connector settings (if not exists)
INSERT INTO system_settings (key, value, description)
VALUES 
  ('admin_mt5_connector_url', '"http://localhost:3030"', 'Admin MT5 Connector URL - Used for price feeds, market analysis, and strategy detection'),
  ('mt5_connector_url', '"http://localhost:3030"', 'Default MT5 Connector URL for user accounts - Used as fallback when user does not provide baseUrl')
ON CONFLICT (key) DO NOTHING;

BEGIN
  RAISE NOTICE 'Migration complete! Created tables:';
  RAISE NOTICE '  - users';
  RAISE NOTICE '  - mt5_accounts';
  RAISE NOTICE '  - strategy_profiles';
  RAISE NOTICE '  - user_strategy_assignments';
  RAISE NOTICE '  - executed_trades';
  RAISE NOTICE '  - daily_account_metrics';
  RAISE NOTICE '  - system_settings';
END $$;

