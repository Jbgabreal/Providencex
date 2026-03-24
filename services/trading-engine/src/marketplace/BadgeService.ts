/**
 * BadgeService — Computes and assigns badges based on mentor analytics.
 * Called periodically or on-demand to refresh badge state.
 */

import { Logger } from '@providencex/shared-utils';
import { MarketplaceRepository } from './MarketplaceRepository';
import { MentorAnalyticsService } from '../copytrading/MentorAnalyticsService';
import { BADGE_RULES, BADGE_LABELS, type BadgeType } from './types';

const logger = new Logger('BadgeService');

export class BadgeService {
  constructor(
    private repo: MarketplaceRepository,
    private analyticsService: MentorAnalyticsService
  ) {}

  /**
   * Compute and update badges for a single mentor based on their analytics.
   */
  async computeBadges(mentorProfileId: string): Promise<BadgeType[]> {
    const analytics = await this.analyticsService.getFullAnalytics(mentorProfileId);
    const earned: BadgeType[] = [];

    // Verified — from mentor_profiles.is_verified (admin-set)
    // Not computed here; handled separately.

    // Top Performer
    const tp = BADGE_RULES.top_performer;
    if (analytics.total_signals >= tp.min_signals &&
        analytics.win_rate >= tp.min_win_rate &&
        analytics.profit_factor >= tp.min_profit_factor) {
      earned.push('top_performer');
    }

    // High Win Rate
    const hwr = BADGE_RULES.high_win_rate;
    if (analytics.total_signals >= hwr.min_signals && analytics.win_rate >= hwr.min_win_rate) {
      earned.push('high_win_rate');
    }

    // Low Drawdown
    const ld = BADGE_RULES.low_drawdown;
    if (analytics.total_signals >= ld.min_signals && analytics.max_drawdown_pct <= ld.max_drawdown) {
      earned.push('low_drawdown');
    }

    // Consistent
    const cs = BADGE_RULES.consistent;
    if (analytics.total_signals >= cs.min_signals &&
        analytics.win_rate >= cs.min_win_rate &&
        (analytics.monthly_performance?.length || 0) >= cs.min_months_active) {
      earned.push('consistent');
    }

    // Apply earned badges
    for (const badgeType of earned) {
      const { label, description } = BADGE_LABELS[badgeType];
      await this.repo.upsertBadge({
        mentorProfileId,
        badgeType,
        badgeSource: 'computed',
        label,
        description,
      });
    }

    // Deactivate badges no longer earned (computed only)
    const allComputed: BadgeType[] = ['top_performer', 'high_win_rate', 'low_drawdown', 'consistent'];
    for (const bt of allComputed) {
      if (!earned.includes(bt)) {
        await this.repo.removeBadge(mentorProfileId, bt);
      }
    }

    return earned;
  }

  /**
   * Assign a badge manually (admin action).
   */
  async assignBadge(mentorProfileId: string, badgeType: BadgeType, expiresAt?: string): Promise<void> {
    const { label, description } = BADGE_LABELS[badgeType];
    await this.repo.upsertBadge({
      mentorProfileId,
      badgeType,
      badgeSource: 'admin',
      label,
      description,
      expiresAt,
    });
    logger.info(`[Badge] Admin assigned ${badgeType} to mentor ${mentorProfileId}`);
  }

  /**
   * Remove a badge (admin action).
   */
  async removeBadge(mentorProfileId: string, badgeType: BadgeType): Promise<void> {
    await this.repo.removeBadge(mentorProfileId, badgeType);
    logger.info(`[Badge] Removed ${badgeType} from mentor ${mentorProfileId}`);
  }
}
