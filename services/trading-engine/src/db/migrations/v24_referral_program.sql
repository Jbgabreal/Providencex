-- v24: Referral Program — referral profiles, attributions, conversions, commissions
-- Phase 3 of ProvidenceX monetization

-- ==================== Referral Profiles ====================
CREATE TABLE IF NOT EXISTS referral_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  referral_code TEXT NOT NULL UNIQUE,              -- e.g. 'PX-abc123'
  is_mentor_affiliate BOOLEAN DEFAULT FALSE,       -- mentors get affiliate-level commissions
  is_active BOOLEAN DEFAULT TRUE,
  total_referrals INTEGER DEFAULT 0,
  total_conversions INTEGER DEFAULT 0,
  total_earned_fiat NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_profiles_code ON referral_profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_referral_profiles_user ON referral_profiles(user_id);

-- ==================== Referral Attributions ====================
-- Links a referred user to their referrer. One row per referred user (single-level).
CREATE TABLE IF NOT EXISTS referral_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES users(id),
  referred_user_id UUID NOT NULL UNIQUE REFERENCES users(id),  -- UNIQUE = one referrer per user
  referral_code TEXT NOT NULL,
  attribution_source TEXT NOT NULL DEFAULT 'signup',  -- 'signup', 'manual', 'link'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attributions_referrer ON referral_attributions(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_attributions_referred ON referral_attributions(referred_user_id);

-- ==================== Referral Conversions ====================
-- Tracks revenue-generating events by referred users.
CREATE TABLE IF NOT EXISTS referral_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES users(id),
  referred_user_id UUID NOT NULL REFERENCES users(id),
  attribution_id UUID NOT NULL REFERENCES referral_attributions(id),

  -- What generated the conversion
  conversion_type TEXT NOT NULL CHECK (conversion_type IN ('platform_plan', 'mentor_plan')),
  revenue_source_id UUID NOT NULL,                 -- invoice_id
  idempotency_key TEXT NOT NULL UNIQUE,            -- e.g. 'conv_{invoice_id}' — prevents double-creation

  -- Money
  gross_amount_fiat NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversions_referrer ON referral_conversions(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_conversions_referred ON referral_conversions(referred_user_id);

-- ==================== Referral Commissions ====================
-- Auditable commission ledger. One commission per conversion.
CREATE TABLE IF NOT EXISTS referral_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES users(id),
  conversion_id UUID NOT NULL UNIQUE REFERENCES referral_conversions(id),  -- UNIQUE = one commission per conversion

  -- Amounts
  gross_amount_fiat NUMERIC(12,2) NOT NULL,        -- conversion gross
  commission_rate_pct NUMERIC(5,2) NOT NULL,        -- commission % at time of creation
  commission_amount_fiat NUMERIC(12,2) NOT NULL,    -- actual commission earned
  currency TEXT NOT NULL DEFAULT 'USD',

  -- Status lifecycle
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',      -- waiting for confirmation period
    'earned',       -- confirmed, available for payout
    'cancelled',    -- reversed (refund, fraud, etc.)
    'payout_ready', -- approved for disbursement
    'paid_out'      -- disbursed
  )),

  -- Payout tracking (future use)
  payout_id UUID,                                   -- link to future payout batch
  paid_out_at TIMESTAMPTZ,

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commissions_referrer ON referral_commissions(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_commissions_status ON referral_commissions(status);

-- ==================== Referral Payouts (foundation) ====================
-- Tracks payout batches for future disbursement automation.
CREATE TABLE IF NOT EXISTS referral_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES users(id),
  total_amount_fiat NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_rail TEXT,                                -- how payout was sent
  tx_hash TEXT,
  destination_address TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
