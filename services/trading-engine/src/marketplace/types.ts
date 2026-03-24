/**
 * Marketplace Domain Types — Phase 6
 */

export type BadgeType =
  | 'verified'
  | 'top_performer'
  | 'low_drawdown'
  | 'fast_growing'
  | 'consistent'
  | 'new_mentor'
  | 'featured'
  | 'high_win_rate';

export type BadgeSource = 'computed' | 'admin';

export interface MentorBadge {
  id: string;
  mentor_profile_id: string;
  badge_type: BadgeType;
  badge_source: BadgeSource;
  label: string;
  description: string | null;
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MentorReview {
  id: string;
  mentor_profile_id: string;
  reviewer_user_id: string;
  follower_subscription_id: string | null;
  rating: number;
  review_text: string | null;
  moderation_status: 'pending' | 'approved' | 'rejected' | 'flagged';
  created_at: string;
  updated_at: string;
}

export type LeaderboardSort =
  | 'performance'     // 30d PnL
  | 'win_rate'
  | 'followers'
  | 'low_drawdown'
  | 'newest'
  | 'rating';

export interface LeaderboardEntry {
  mentor: any;
  analytics: any;
  badges: MentorBadge[];
  rank: number;
}

/** Minimum signals required to appear on ranked leaderboards */
export const MIN_SIGNALS_FOR_RANKING = 10;

/** Badge computation rules — analytics thresholds */
export const BADGE_RULES = {
  top_performer: { min_signals: 20, min_win_rate: 60, min_profit_factor: 1.5 },
  high_win_rate: { min_signals: 15, min_win_rate: 65 },
  low_drawdown: { min_signals: 15, max_drawdown: 100 },
  consistent: { min_signals: 30, min_months_active: 3, min_win_rate: 50 },
  fast_growing: { min_followers_gain_30d: 5 },
  new_mentor: { max_age_days: 30 },
} as const;

export const BADGE_LABELS: Record<BadgeType, { label: string; description: string }> = {
  verified: { label: 'Verified', description: 'Platform-verified mentor identity' },
  top_performer: { label: 'Top Performer', description: '60%+ win rate with 1.5+ profit factor over 20+ signals' },
  low_drawdown: { label: 'Low Drawdown', description: 'Maximum drawdown under $100 over 15+ signals' },
  fast_growing: { label: 'Fast Growing', description: 'Gained 5+ followers in the last 30 days' },
  consistent: { label: 'Consistent', description: '50%+ win rate maintained over 3+ months and 30+ signals' },
  new_mentor: { label: 'New Mentor', description: 'Joined the platform within the last 30 days' },
  featured: { label: 'Featured', description: 'Hand-picked by the ProvidenceX team' },
  high_win_rate: { label: 'High Win Rate', description: '65%+ win rate over 15+ signals' },
};

export const MARKETPLACE_CATEGORIES = [
  { slug: 'top-performers', label: 'Top Performers', sort: 'performance' as LeaderboardSort, description: 'Mentors with the best recent performance' },
  { slug: 'most-followed', label: 'Most Followed', sort: 'followers' as LeaderboardSort, description: 'Most popular mentors by follower count' },
  { slug: 'low-risk', label: 'Low Risk', sort: 'low_drawdown' as LeaderboardSort, description: 'Conservative mentors with low drawdown' },
  { slug: 'highest-win-rate', label: 'Highest Win Rate', sort: 'win_rate' as LeaderboardSort, description: 'Mentors with the best hit rates' },
  { slug: 'newest', label: 'New Mentors', sort: 'newest' as LeaderboardSort, description: 'Recently joined signal providers' },
  { slug: 'top-rated', label: 'Top Rated', sort: 'rating' as LeaderboardSort, description: 'Highest rated by followers' },
];
