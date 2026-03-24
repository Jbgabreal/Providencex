-- v30: Admin Operations — audit logs, moderation events
-- Phase 9 of ProvidenceX

-- ==================== Admin Action Log ====================
-- Single audit table for all admin actions across domains.
CREATE TABLE IF NOT EXISTS admin_action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES users(id),

  target_type TEXT NOT NULL,
  -- 'mentor_profile', 'crypto_payment_invoice', 'referral_commission',
  -- 'mentor_review', 'mentor_badge', 'follower_subscription', 'user'

  target_id UUID NOT NULL,               -- ID of the affected entity
  action_type TEXT NOT NULL,
  -- 'approve', 'suspend', 'unsuspend', 'feature', 'unfeature',
  -- 'assign_badge', 'remove_badge', 'review_invoice', 'resolve_invoice',
  -- 'confirm_commission', 'reverse_commission', 'approve_review',
  -- 'reject_review', 'flag_review', 'hide_review'

  old_status TEXT,
  new_status TEXT,
  reason TEXT,
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin ON admin_action_logs(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_target ON admin_action_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_action_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_logs_date ON admin_action_logs(created_at DESC);
