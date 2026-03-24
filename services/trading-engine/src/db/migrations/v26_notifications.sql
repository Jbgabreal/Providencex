-- v26: Notifications — in-app notifications, preferences, delivery foundation
-- Phase 5 of ProvidenceX

-- ==================== Notifications ====================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Classification
  category TEXT NOT NULL CHECK (category IN ('trading', 'safety', 'billing', 'referrals', 'system')),
  event_type TEXT NOT NULL,              -- e.g. 'trade_filled', 'daily_loss_breached', 'invoice_paid'

  -- Content
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,     -- structured data for rich rendering

  -- State
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,

  -- Delivery tracking (future-ready)
  delivery_channel TEXT NOT NULL DEFAULT 'in_app',  -- 'in_app', 'email', 'telegram', 'push'
  delivered_at TIMESTAMPTZ DEFAULT NOW(),

  -- Idempotency
  idempotency_key TEXT UNIQUE,           -- prevents duplicate notifications for same event

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notifications_category ON notifications(user_id, category);

-- ==================== Notification Preferences ====================
CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- Per-category toggles (true = enabled, false = muted)
  trading_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  safety_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  billing_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  referrals_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  system_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  -- Granular mutes (event types to suppress)
  muted_event_types TEXT[] DEFAULT '{}',

  -- Future delivery channel preferences
  email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  push_enabled BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_prefs_user ON notification_preferences(user_id);
