-- v23: Crypto Billing — Platform plans, mentor plans, invoices, payments, revenue ledger
-- Phase 2 of ProvidenceX monetization

-- ==================== Platform Plans ====================
CREATE TABLE IF NOT EXISTS platform_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,                    -- e.g. 'free', 'pro', 'premium'
  name TEXT NOT NULL,
  description TEXT,
  price_usd NUMERIC(12,2) NOT NULL DEFAULT 0,  -- monthly price in USD
  features JSONB DEFAULT '[]'::jsonb,           -- feature list for display
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default platform plans
INSERT INTO platform_plans (slug, name, description, price_usd, features, sort_order)
VALUES
  ('free', 'Free', 'Browse mentors and view public signals', 0, '["Browse mentor marketplace", "View public mentor analytics", "View mentor signals (delayed)"]'::jsonb, 0),
  ('pro', 'Pro', 'Full copy trading with real-time signals', 29.99, '["Everything in Free", "Real-time signal notifications", "Auto-copy trading", "Up to 3 mentor subscriptions", "Basic portfolio analytics"]'::jsonb, 1),
  ('premium', 'Premium', 'Unlimited access with advanced automation', 79.99, '["Everything in Pro", "Unlimited mentor subscriptions", "Advanced risk management", "Priority signal execution", "Custom TP/SL automation", "API access"]'::jsonb, 2)
ON CONFLICT (slug) DO NOTHING;

-- ==================== User Platform Subscriptions ====================
CREATE TABLE IF NOT EXISTS platform_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  platform_plan_id UUID NOT NULL REFERENCES platform_plans(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,                        -- NULL = no expiry (free plan)
  invoice_id UUID,                               -- link to the payment invoice
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_subs_user ON platform_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_platform_subs_status ON platform_subscriptions(user_id, status);

-- ==================== Mentor Plans ====================
CREATE TABLE IF NOT EXISTS mentor_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_profile_id UUID NOT NULL REFERENCES mentor_profiles(id),
  name TEXT NOT NULL,
  description TEXT,
  price_usd NUMERIC(12,2) NOT NULL DEFAULT 0,   -- monthly price in USD (0 = free)
  is_active BOOLEAN DEFAULT TRUE,
  is_public BOOLEAN DEFAULT TRUE,                -- visible on marketplace
  sort_order INTEGER DEFAULT 0,
  features JSONB DEFAULT '[]'::jsonb,            -- plan feature list
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentor_plans_mentor ON mentor_plans(mentor_profile_id);

-- ==================== Mentor Plan Subscriptions (billing relationship) ====================
CREATE TABLE IF NOT EXISTS mentor_plan_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  mentor_plan_id UUID NOT NULL REFERENCES mentor_plans(id),
  mentor_profile_id UUID NOT NULL REFERENCES mentor_profiles(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  invoice_id UUID,                               -- link to the payment invoice
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentor_plan_subs_user ON mentor_plan_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_mentor_plan_subs_mentor ON mentor_plan_subscriptions(mentor_profile_id);

-- ==================== Exchange Rate Snapshots ====================
CREATE TABLE IF NOT EXISTS exchange_rate_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fiat_currency TEXT NOT NULL DEFAULT 'USD',
  crypto_token TEXT NOT NULL,                    -- e.g. 'USDT', 'USDC'
  rate NUMERIC(20,8) NOT NULL,                   -- 1 USD = X crypto (for stablecoins ~1.0)
  source TEXT NOT NULL DEFAULT 'manual',         -- 'coingecko', 'binance', 'manual'
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==================== Crypto Payment Addresses (invoice-specific) ====================
CREATE TABLE IF NOT EXISTS crypto_payment_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain TEXT NOT NULL,                           -- 'TRON', 'BSC'
  token TEXT NOT NULL,                           -- 'USDT', 'USDC'
  payment_rail TEXT NOT NULL,                    -- 'USDT_TRON_TRC20', 'USDC_BSC_BEP20'
  address TEXT NOT NULL,
  private_key_enc TEXT,                          -- encrypted private key for sweeping
  is_assigned BOOLEAN DEFAULT FALSE,
  assigned_to_invoice_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crypto_addrs_unassigned ON crypto_payment_addresses(payment_rail, is_assigned) WHERE is_assigned = FALSE;
CREATE INDEX IF NOT EXISTS idx_crypto_addrs_invoice ON crypto_payment_addresses(assigned_to_invoice_id);

-- ==================== Crypto Payment Invoices ====================
CREATE TABLE IF NOT EXISTS crypto_payment_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),

  -- What this invoice is for
  invoice_type TEXT NOT NULL CHECK (invoice_type IN ('platform_plan', 'mentor_plan')),
  platform_plan_id UUID REFERENCES platform_plans(id),
  mentor_plan_id UUID REFERENCES mentor_plans(id),
  mentor_profile_id UUID REFERENCES mentor_profiles(id),

  -- Fiat reference
  fiat_currency TEXT NOT NULL DEFAULT 'USD',
  amount_fiat NUMERIC(12,2) NOT NULL,

  -- Crypto payment details
  payment_rail TEXT NOT NULL,                    -- 'USDT_TRON_TRC20' or 'USDC_BSC_BEP20'
  chain TEXT NOT NULL,                           -- 'TRON' or 'BSC'
  token TEXT NOT NULL,                           -- 'USDT' or 'USDC'
  amount_crypto_expected NUMERIC(20,8) NOT NULL,
  amount_crypto_received NUMERIC(20,8) DEFAULT 0,
  deposit_address TEXT NOT NULL,

  -- Exchange rate at creation
  exchange_rate_snapshot_id UUID REFERENCES exchange_rate_snapshots(id),
  exchange_rate_used NUMERIC(20,8) NOT NULL,

  -- Payment status
  status TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN (
    'pending', 'awaiting_payment', 'detected', 'confirming', 'paid',
    'underpaid', 'overpaid', 'expired', 'failed', 'manual_review'
  )),

  -- On-chain details
  tx_hash TEXT,
  from_address TEXT,
  confirmation_count INTEGER DEFAULT 0,
  confirmations_required INTEGER NOT NULL DEFAULT 20,

  -- Timing
  expires_at TIMESTAMPTZ NOT NULL,
  paid_at TIMESTAMPTZ,
  detected_at TIMESTAMPTZ,

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_user ON crypto_payment_invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON crypto_payment_invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_deposit ON crypto_payment_invoices(deposit_address);
CREATE INDEX IF NOT EXISTS idx_invoices_awaiting ON crypto_payment_invoices(status, expires_at)
  WHERE status IN ('awaiting_payment', 'detected', 'confirming');

-- ==================== Crypto Payment Events (audit log) ====================
CREATE TABLE IF NOT EXISTS crypto_payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES crypto_payment_invoices(id),
  event_type TEXT NOT NULL,                      -- 'created', 'detected', 'confirming', 'confirmed', 'underpaid', 'overpaid', 'expired', 'manual_review'
  old_status TEXT,
  new_status TEXT,
  tx_hash TEXT,
  amount_received NUMERIC(20,8),
  confirmation_count INTEGER,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_invoice ON crypto_payment_events(invoice_id);

-- ==================== Revenue Ledger ====================
CREATE TABLE IF NOT EXISTS revenue_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES crypto_payment_invoices(id),
  mentor_profile_id UUID REFERENCES mentor_profiles(id),  -- NULL for platform plan invoices

  -- Amounts in fiat
  gross_amount_fiat NUMERIC(12,2) NOT NULL,
  platform_fee_fiat NUMERIC(12,2) NOT NULL DEFAULT 0,
  mentor_net_fiat NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Amounts in crypto (as received)
  gross_amount_crypto NUMERIC(20,8) NOT NULL,
  payment_rail TEXT NOT NULL,

  -- Platform fee percentage at time of transaction
  platform_fee_pct NUMERIC(5,2) NOT NULL DEFAULT 20.00,   -- 20% default

  -- Ledger type
  ledger_type TEXT NOT NULL CHECK (ledger_type IN ('platform_revenue', 'mentor_revenue')),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revenue_mentor ON revenue_ledger(mentor_profile_id);
CREATE INDEX IF NOT EXISTS idx_revenue_invoice ON revenue_ledger(invoice_id);

-- ==================== Crypto Payment Sweeps (treasury foundation) ====================
CREATE TABLE IF NOT EXISTS crypto_payment_sweeps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_address TEXT NOT NULL,
  destination_address TEXT NOT NULL,             -- treasury wallet
  chain TEXT NOT NULL,
  token TEXT NOT NULL,
  payment_rail TEXT NOT NULL,
  amount NUMERIC(20,8) NOT NULL,
  tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed')),
  invoice_id UUID REFERENCES crypto_payment_invoices(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
