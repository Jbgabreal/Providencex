/**
 * RiskAssistantService — Generates explainable risk warnings for followers.
 * Rule-based with clear reason codes. Runs on-demand, not real-time.
 */

import { Logger } from '@providencex/shared-utils';
import { IntelligenceRepository } from './IntelligenceRepository';
import { MentorAnalyticsService } from '../copytrading/MentorAnalyticsService';
import { CopyTradingRepository } from '../copytrading/CopyTradingRepository';
import type { RiskWarning, WarningSeverity } from './types';

const logger = new Logger('RiskAssistantService');

interface Warning {
  warningType: string;
  severity: WarningSeverity;
  title: string;
  description: string;
  reasonCodes: string[];
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export class RiskAssistantService {
  constructor(
    private repo: IntelligenceRepository,
    private analyticsService: MentorAnalyticsService,
    private copyRepo: CopyTradingRepository
  ) {}

  /**
   * Evaluate risk for a user and return active warnings.
   * Persists new warnings and returns combined list.
   */
  async evaluateRisk(userId: string): Promise<RiskWarning[]> {
    const warnings: Warning[] = [];

    // Get user's subscriptions
    const subs = await this.copyRepo.getSubscriptionsForUser(userId);
    const activeSubs = subs.filter((s: any) => s.status === 'active');

    // 1. Check for repeated guardrail blocks
    const blockedCount = await this.repo.getUserBlockedCount24h(userId);
    if (blockedCount >= 5) {
      warnings.push({
        warningType: 'repeated_guardrail_blocks',
        severity: 'warning',
        title: 'Frequent Trade Blocks',
        description: `${blockedCount} trades were blocked in the last 24 hours. Review your safety settings or mentor selection.`,
        reasonCodes: ['high_block_rate', `${blockedCount}_blocks_24h`],
      });
    }

    // 2. Check for auto-disabled subscriptions
    const autoDisabledCount = await this.repo.getUserAutoDisabledSubs(userId);
    if (autoDisabledCount > 0) {
      warnings.push({
        warningType: 'subscriptions_auto_disabled',
        severity: 'critical',
        title: 'Subscriptions Auto-Disabled',
        description: `${autoDisabledCount} subscription(s) have been auto-disabled due to safety limits being breached.`,
        reasonCodes: ['auto_disabled', `${autoDisabledCount}_subs`],
      });
    }

    // 3. Check each mentor's recent performance
    for (const sub of activeSubs) {
      try {
        const analytics = await this.analyticsService.getFullAnalytics(sub.mentor_profile_id);

        // Elevated drawdown
        if (analytics.max_drawdown_pct > 300) {
          warnings.push({
            warningType: 'mentor_drawdown_elevated',
            severity: 'warning',
            title: 'High Mentor Drawdown',
            description: `Mentor's maximum drawdown is $${analytics.max_drawdown_pct.toFixed(0)}, which is elevated.`,
            reasonCodes: ['high_drawdown', `max_dd_${analytics.max_drawdown_pct.toFixed(0)}`],
            relatedEntityType: 'mentor_profile',
            relatedEntityId: sub.mentor_profile_id,
          });
        }

        // Declining performance (30d vs 90d)
        if (analytics.last_30d && analytics.last_90d) {
          const recent = analytics.last_30d.win_rate;
          const longer = analytics.last_90d.win_rate;
          if (longer > 0 && recent < longer * 0.7 && recent < 40) {
            warnings.push({
              warningType: 'mentor_performance_declining',
              severity: 'warning',
              title: 'Mentor Performance Declining',
              description: `30-day win rate (${recent.toFixed(0)}%) is significantly below 90-day average (${longer.toFixed(0)}%).`,
              reasonCodes: ['declining_win_rate', `30d_${recent.toFixed(0)}pct`, `90d_${longer.toFixed(0)}pct`],
              relatedEntityType: 'mentor_profile',
              relatedEntityId: sub.mentor_profile_id,
            });
          }
        }

        // High risk mentor
        if (analytics.risk_label === 'high' && sub.mode === 'auto_trade') {
          warnings.push({
            warningType: 'suggest_shadow_mode',
            severity: 'info',
            title: 'Consider Shadow Mode',
            description: 'This mentor has a high risk profile. Consider using shadow mode to evaluate before live trading.',
            reasonCodes: ['high_risk_mentor', 'auto_trade_active'],
            relatedEntityType: 'follower_subscription',
            relatedEntityId: sub.id,
          });
        }
      } catch {
        // Skip mentors with analytics errors
      }
    }

    // Persist new warnings and get combined list
    for (const w of warnings) {
      await this.repo.createWarning({
        userId,
        warningType: w.warningType,
        severity: w.severity,
        title: w.title,
        description: w.description,
        reasonCodes: w.reasonCodes,
        relatedEntityType: w.relatedEntityType,
        relatedEntityId: w.relatedEntityId,
      });
    }

    return this.repo.getWarningsForUser(userId);
  }

  /**
   * Dismiss a warning.
   */
  async dismiss(warningId: string, userId: string): Promise<boolean> {
    return this.repo.dismissWarning(warningId, userId);
  }
}
