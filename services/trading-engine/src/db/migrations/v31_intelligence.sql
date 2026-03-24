-- v31: Intelligence — risk warnings, recommendation log
-- Phase 10 of ProvidenceX
-- v1 is fully query-driven; this table captures generated warnings for audit.

CREATE TABLE IF NOT EXISTS risk_warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  warning_type TEXT NOT NULL,
  -- 'aggressive_risk', 'mentor_drawdown_elevated', 'mentor_performance_declining',
  -- 'repeated_guardrail_blocks', 'suggest_shadow_mode', 'subscription_churn_risk'

  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reason_codes TEXT[] DEFAULT '{}',

  -- Context
  related_entity_type TEXT,              -- 'mentor_profile', 'follower_subscription', etc.
  related_entity_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,

  is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  dismissed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_warnings_user ON risk_warnings(user_id, is_dismissed);
CREATE INDEX IF NOT EXISTS idx_risk_warnings_type ON risk_warnings(warning_type);
