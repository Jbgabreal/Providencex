-- v27: Marketplace Maturity — badges, reviews, leaderboard support
-- Phase 6 of ProvidenceX

-- ==================== Mentor Badges ====================
CREATE TABLE IF NOT EXISTS mentor_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_profile_id UUID NOT NULL REFERENCES mentor_profiles(id) ON DELETE CASCADE,

  badge_type TEXT NOT NULL,
  -- Types: 'verified', 'top_performer', 'low_drawdown', 'fast_growing',
  --        'consistent', 'new_mentor', 'featured', 'high_win_rate'

  badge_source TEXT NOT NULL DEFAULT 'computed',
  -- 'computed' (auto by platform), 'admin' (manually assigned)

  label TEXT NOT NULL,                   -- display label e.g. "Top Performer"
  description TEXT,                      -- tooltip/explanation
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,               -- optional expiry for time-bound badges

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(mentor_profile_id, badge_type)  -- one badge of each type per mentor
);

CREATE INDEX IF NOT EXISTS idx_badges_mentor ON mentor_badges(mentor_profile_id);
CREATE INDEX IF NOT EXISTS idx_badges_type ON mentor_badges(badge_type);

-- ==================== Mentor Reviews ====================
CREATE TABLE IF NOT EXISTS mentor_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_profile_id UUID NOT NULL REFERENCES mentor_profiles(id) ON DELETE CASCADE,
  reviewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  follower_subscription_id UUID REFERENCES follower_subscriptions(id) ON DELETE SET NULL,

  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT,                      -- optional short review (max enforced in app)
  moderation_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'flagged')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(mentor_profile_id, reviewer_user_id)  -- one review per user per mentor
);

CREATE INDEX IF NOT EXISTS idx_reviews_mentor ON mentor_reviews(mentor_profile_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON mentor_reviews(reviewer_user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status ON mentor_reviews(moderation_status);

-- ==================== Extend Mentor Profiles ====================
ALTER TABLE mentor_profiles
  ADD COLUMN IF NOT EXISTS featured_order INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;
