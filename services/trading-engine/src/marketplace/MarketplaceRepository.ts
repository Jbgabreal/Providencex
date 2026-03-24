/**
 * MarketplaceRepository — Data access for badges, reviews, leaderboard queries.
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';
import type { MentorBadge, MentorReview, BadgeType, BadgeSource } from './types';

const logger = new Logger('MarketplaceRepository');

export class MarketplaceRepository {
  private pool: Pool | null = null;

  constructor(databaseUrl?: string) {
    const config = getConfig();
    const url = databaseUrl || config.databaseUrl;
    if (!url) {
      logger.warn('[MarketplaceRepository] No databaseUrl, repository disabled');
      return;
    }
    this.pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    });
  }

  private ensurePool(): Pool {
    if (!this.pool) throw new Error('[MarketplaceRepository] Pool not initialized');
    return this.pool;
  }

  // ==================== Badges ====================

  async getBadgesForMentor(mentorProfileId: string): Promise<MentorBadge[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT * FROM mentor_badges
       WHERE mentor_profile_id = $1 AND is_active = TRUE
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at ASC`,
      [mentorProfileId]
    );
    return result.rows;
  }

  async upsertBadge(params: {
    mentorProfileId: string;
    badgeType: BadgeType;
    badgeSource: BadgeSource;
    label: string;
    description?: string;
    expiresAt?: string;
  }): Promise<MentorBadge> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO mentor_badges (mentor_profile_id, badge_type, badge_source, label, description, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (mentor_profile_id, badge_type)
       DO UPDATE SET is_active = TRUE, label = $4, description = $5, expires_at = $6, updated_at = NOW()
       RETURNING *`,
      [params.mentorProfileId, params.badgeType, params.badgeSource,
       params.label, params.description || null, params.expiresAt || null]
    );
    return result.rows[0];
  }

  async removeBadge(mentorProfileId: string, badgeType: BadgeType): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `UPDATE mentor_badges SET is_active = FALSE, updated_at = NOW()
       WHERE mentor_profile_id = $1 AND badge_type = $2`,
      [mentorProfileId, badgeType]
    );
  }

  async getBadgesForMultipleMentors(mentorIds: string[]): Promise<Record<string, MentorBadge[]>> {
    if (mentorIds.length === 0) return {};
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT * FROM mentor_badges
       WHERE mentor_profile_id = ANY($1) AND is_active = TRUE
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at ASC`,
      [mentorIds]
    );
    const map: Record<string, MentorBadge[]> = {};
    for (const row of result.rows) {
      if (!map[row.mentor_profile_id]) map[row.mentor_profile_id] = [];
      map[row.mentor_profile_id].push(row);
    }
    return map;
  }

  // ==================== Reviews ====================

  async getReviewsForMentor(mentorProfileId: string, limit = 20): Promise<MentorReview[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT * FROM mentor_reviews
       WHERE mentor_profile_id = $1 AND moderation_status = 'approved'
       ORDER BY created_at DESC LIMIT $2`,
      [mentorProfileId, limit]
    );
    return result.rows;
  }

  async getReviewByUser(mentorProfileId: string, userId: string): Promise<MentorReview | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM mentor_reviews WHERE mentor_profile_id = $1 AND reviewer_user_id = $2',
      [mentorProfileId, userId]
    );
    return result.rows[0] || null;
  }

  async createReview(params: {
    mentorProfileId: string;
    reviewerUserId: string;
    followerSubscriptionId?: string;
    rating: number;
    reviewText?: string;
  }): Promise<MentorReview> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO mentor_reviews (mentor_profile_id, reviewer_user_id, follower_subscription_id, rating, review_text)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [params.mentorProfileId, params.reviewerUserId,
       params.followerSubscriptionId || null, params.rating, params.reviewText || null]
    );

    // Update avg_rating and review_count on mentor_profiles
    await this.refreshMentorRating(params.mentorProfileId);

    return result.rows[0];
  }

  async refreshMentorRating(mentorProfileId: string): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `UPDATE mentor_profiles SET
         avg_rating = COALESCE((
           SELECT AVG(rating) FROM mentor_reviews
           WHERE mentor_profile_id = $1 AND moderation_status = 'approved'
         ), 0),
         review_count = COALESCE((
           SELECT COUNT(*) FROM mentor_reviews
           WHERE mentor_profile_id = $1 AND moderation_status = 'approved'
         ), 0),
         updated_at = NOW()
       WHERE id = $1`,
      [mentorProfileId]
    );
  }

  async getRatingSummary(mentorProfileId: string): Promise<{
    avgRating: number; reviewCount: number; distribution: Record<number, number>;
  }> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT
         COALESCE(AVG(rating), 0) as avg_rating,
         COUNT(*) as review_count,
         COUNT(*) FILTER (WHERE rating = 5) as r5,
         COUNT(*) FILTER (WHERE rating = 4) as r4,
         COUNT(*) FILTER (WHERE rating = 3) as r3,
         COUNT(*) FILTER (WHERE rating = 2) as r2,
         COUNT(*) FILTER (WHERE rating = 1) as r1
       FROM mentor_reviews
       WHERE mentor_profile_id = $1 AND moderation_status = 'approved'`,
      [mentorProfileId]
    );
    const r = result.rows[0];
    return {
      avgRating: Number(r.avg_rating),
      reviewCount: parseInt(r.review_count),
      distribution: { 5: parseInt(r.r5), 4: parseInt(r.r4), 3: parseInt(r.r3), 2: parseInt(r.r2), 1: parseInt(r.r1) },
    };
  }

  // ==================== Eligibility Check ====================

  async hasSubscriptionToMentor(userId: string, mentorProfileId: string): Promise<{ eligible: boolean; subscriptionId?: string }> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT id FROM follower_subscriptions
       WHERE user_id = $1 AND mentor_profile_id = $2 AND status != 'stopped'
       LIMIT 1`,
      [userId, mentorProfileId]
    );
    if (result.rows[0]) {
      return { eligible: true, subscriptionId: result.rows[0].id };
    }
    return { eligible: false };
  }

  // ==================== Featured Mentors ====================

  async getFeaturedMentors(limit = 10): Promise<any[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT * FROM mentor_profiles
       WHERE is_active = TRUE AND is_approved = TRUE AND is_featured = TRUE
       ORDER BY featured_order ASC, total_followers DESC LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  async setFeatured(mentorProfileId: string, featured: boolean, order?: number): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `UPDATE mentor_profiles SET is_featured = $2, featured_order = $3, updated_at = NOW()
       WHERE id = $1`,
      [mentorProfileId, featured, order || 0]
    );
  }

  // ==================== Similar Mentors ====================

  async getSimilarMentors(mentorProfileId: string, limit = 4): Promise<any[]> {
    const pool = this.ensurePool();
    // Find mentors with overlapping trading_style or markets_traded
    const result = await pool.query(
      `SELECT m2.* FROM mentor_profiles m2
       JOIN mentor_profiles m1 ON m1.id = $1
       WHERE m2.id != $1
         AND m2.is_active = TRUE AND m2.is_approved = TRUE
         AND (m2.trading_style && m1.trading_style OR m2.markets_traded && m1.markets_traded)
       ORDER BY m2.total_followers DESC
       LIMIT $2`,
      [mentorProfileId, limit]
    );
    return result.rows;
  }
}
