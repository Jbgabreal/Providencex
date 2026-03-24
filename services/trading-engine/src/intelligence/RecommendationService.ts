/**
 * RecommendationService — Generates explainable mentor recommendations.
 * Rule-based scoring with reason codes. No ML required for v1.
 */

import { Logger } from '@providencex/shared-utils';
import { IntelligenceRepository } from './IntelligenceRepository';
import { MentorAnalyticsService } from '../copytrading/MentorAnalyticsService';
import { CopyTradingRepository } from '../copytrading/CopyTradingRepository';
import type { MentorRecommendation } from './types';

const logger = new Logger('RecommendationService');

export class RecommendationService {
  constructor(
    private repo: IntelligenceRepository,
    private analyticsService: MentorAnalyticsService,
    private copyRepo: CopyTradingRepository
  ) {}

  /**
   * Get personalized mentor recommendations for a user.
   * Scoring: base metrics + preference matching + social proof.
   */
  async getRecommendations(userId: string, limit = 10): Promise<MentorRecommendation[]> {
    // Get user context
    const subscribedMentorIds = await this.repo.getUserSubscribedMentors(userId);
    const prefs = await this.repo.getUserPreferredStyles(userId);

    // Get all eligible mentors
    const allMentors = await this.copyRepo.getPublicMentors(100, 0);

    // Score each mentor
    const scored: MentorRecommendation[] = [];

    for (const mentor of allMentors) {
      // Skip already subscribed
      if (subscribedMentorIds.includes(mentor.id)) continue;

      try {
        const analytics = await this.analyticsService.getFullAnalytics(mentor.id);
        if (analytics.total_signals < 5) continue; // Minimum data

        const { score, reasons, matchType } = this.scoreMentor(mentor, analytics, prefs);

        scored.push({
          mentorId: mentor.id,
          mentorName: mentor.display_name,
          score,
          reasons,
          matchType,
          analytics: {
            winRate: analytics.win_rate,
            totalPnl: analytics.total_pnl,
            profitFactor: analytics.profit_factor,
            riskLabel: analytics.risk_label,
            totalSignals: analytics.total_signals,
            totalFollowers: mentor.total_followers,
            avgRating: Number(mentor.avg_rating) || 0,
          },
        });
      } catch {
        // Skip mentors with analytics errors
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  private scoreMentor(
    mentor: any,
    analytics: any,
    prefs: { styles: string[]; symbols: string[] }
  ): { score: number; reasons: string[]; matchType: string } {
    let score = 0;
    const reasons: string[] = [];
    let matchType = 'general';

    // Performance scoring (0-40 points)
    if (analytics.win_rate >= 60) { score += 15; reasons.push(`High ${analytics.win_rate.toFixed(0)}% win rate`); }
    else if (analytics.win_rate >= 50) { score += 8; }

    if (analytics.profit_factor >= 2.0) { score += 10; reasons.push(`Strong ${analytics.profit_factor.toFixed(1)} profit factor`); }
    else if (analytics.profit_factor >= 1.5) { score += 5; }

    if (analytics.total_pnl > 0) { score += 5; }
    if (analytics.last_30d?.total_pnl > 0) { score += 10; reasons.push(`Positive recent performance`); }

    // Risk scoring (0-15 points)
    if (analytics.risk_label === 'low') { score += 15; reasons.push('Low risk profile'); }
    else if (analytics.risk_label === 'moderate') { score += 8; }

    if (analytics.max_drawdown_pct < 100) { score += 5; reasons.push('Low drawdown history'); }

    // Social proof (0-15 points)
    if (mentor.total_followers >= 10) { score += 5; reasons.push(`${mentor.total_followers} followers`); }
    if (Number(mentor.avg_rating) >= 4.0) { score += 10; reasons.push(`${Number(mentor.avg_rating).toFixed(1)} star rating`); }
    else if (Number(mentor.avg_rating) >= 3.5) { score += 5; }

    // Preference matching (0-20 points)
    const mentorStyles = (mentor.trading_style || []).map((s: string) => s.toLowerCase());
    const mentorSymbols = (mentor.markets_traded || []).map((s: string) => s.toUpperCase());

    const styleMatch = prefs.styles.some(s => mentorStyles.includes(s.toLowerCase()));
    const symbolMatch = prefs.symbols.some(s => mentorSymbols.includes(s.toUpperCase()));

    if (styleMatch) { score += 10; reasons.push(`Matches your preferred trading style`); matchType = 'style_match'; }
    if (symbolMatch) { score += 10; reasons.push(`Trades symbols you follow`); matchType = symbolMatch && styleMatch ? 'full_match' : 'symbol_match'; }

    // Activity bonus (0-10 points)
    if (analytics.total_signals >= 20) { score += 5; reasons.push('Active signal provider'); }
    if (mentor.is_featured) { score += 5; reasons.push('Featured by ProvidenceX'); }

    return { score, reasons, matchType };
  }
}
