/**
 * LeaderboardService — Computes mentor rankings with minimum-data rules.
 */

import { Logger } from '@providencex/shared-utils';
import { CopyTradingRepository } from '../copytrading/CopyTradingRepository';
import { MentorAnalyticsService } from '../copytrading/MentorAnalyticsService';
import { MarketplaceRepository } from './MarketplaceRepository';
import { MIN_SIGNALS_FOR_RANKING, type LeaderboardSort, type LeaderboardEntry } from './types';

const logger = new Logger('LeaderboardService');

export class LeaderboardService {
  constructor(
    private copyRepo: CopyTradingRepository,
    private analyticsService: MentorAnalyticsService,
    private marketplaceRepo: MarketplaceRepository
  ) {}

  /**
   * Get ranked mentor leaderboard.
   * Enforces minimum signal count to prevent tiny-sample dominance.
   */
  async getLeaderboard(sort: LeaderboardSort = 'performance', limit = 20): Promise<LeaderboardEntry[]> {
    // Fetch all eligible mentors
    const mentors = await this.copyRepo.getPublicMentors(100, 0);

    // Compute analytics + badges in parallel
    const entries: LeaderboardEntry[] = [];
    await Promise.all(
      mentors.map(async (mentor) => {
        try {
          const analytics = await this.analyticsService.getFullAnalytics(mentor.id);
          const badges = await this.marketplaceRepo.getBadgesForMentor(mentor.id);

          // Enforce minimum data rule for ranked leaderboards
          if (sort !== 'newest' && sort !== 'followers' && sort !== 'rating') {
            if (analytics.total_signals < MIN_SIGNALS_FOR_RANKING) return;
          }

          entries.push({ mentor, analytics, badges, rank: 0 });
        } catch {
          // Skip mentors with analytics errors
        }
      })
    );

    // Sort by requested metric
    this.sortEntries(entries, sort);

    // Assign ranks and limit
    return entries.slice(0, limit).map((e, i) => ({ ...e, rank: i + 1 }));
  }

  private sortEntries(entries: LeaderboardEntry[], sort: LeaderboardSort): void {
    switch (sort) {
      case 'performance':
        // Best 30-day PnL
        entries.sort((a, b) => (b.analytics.last_30d?.total_pnl || 0) - (a.analytics.last_30d?.total_pnl || 0));
        break;
      case 'win_rate':
        entries.sort((a, b) => (b.analytics.win_rate || 0) - (a.analytics.win_rate || 0));
        break;
      case 'followers':
        entries.sort((a, b) => (b.mentor.total_followers || 0) - (a.mentor.total_followers || 0));
        break;
      case 'low_drawdown':
        // Lower drawdown = better (ascending sort)
        entries.sort((a, b) => (a.analytics.max_drawdown_pct || 9999) - (b.analytics.max_drawdown_pct || 9999));
        break;
      case 'newest':
        entries.sort((a, b) => new Date(b.mentor.created_at).getTime() - new Date(a.mentor.created_at).getTime());
        break;
      case 'rating':
        entries.sort((a, b) => (Number(b.mentor.avg_rating) || 0) - (Number(a.mentor.avg_rating) || 0));
        break;
    }
  }
}
