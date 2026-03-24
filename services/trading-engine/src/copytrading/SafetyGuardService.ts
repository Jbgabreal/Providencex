/**
 * SafetyGuardService — Evaluates all safety rules before executing a copied trade.
 * Returns allow/block with reason. Also handles auto-disable logic.
 */

import { Logger } from '@providencex/shared-utils';
import { SafetyRepository } from './SafetyRepository';
import { NotificationService } from '../notifications/NotificationService';
import type { MentorSignal, FollowerSubscription } from './types';
import type { SafetySettings, GuardrailCheckResult } from './SafetyTypes';

const logger = new Logger('SafetyGuardService');

export class SafetyGuardService {
  constructor(private readonly safetyRepo: SafetyRepository) {}

  /**
   * Run all guardrail checks for a subscription before executing a trade.
   * Returns the first failing check, or { allowed: true } if all pass.
   */
  async evaluateAll(
    sub: FollowerSubscription & { safety_settings?: SafetySettings; blocked_symbols?: string[]; auto_disabled_at?: string | null },
    signal: MentorSignal
  ): Promise<GuardrailCheckResult> {
    const settings: SafetySettings = sub.safety_settings || {};

    // 1. Check subscription not auto-disabled
    if (sub.auto_disabled_at) {
      return {
        allowed: false,
        blockReason: 'auto_disabled',
        guardrailType: 'auto_disable',
        actualValue: sub.auto_disabled_at,
      };
    }

    // 2. Check subscription status
    if (sub.status !== 'active') {
      return {
        allowed: false,
        blockReason: 'subscription_paused',
        guardrailType: 'status',
        actualValue: sub.status,
      };
    }

    // 3. Check blocked symbols
    const blockedSymbols = (sub.blocked_symbols || []).map(s => s.toUpperCase());
    if (blockedSymbols.includes(signal.symbol.toUpperCase())) {
      return {
        allowed: false,
        blockReason: 'symbol_blocked',
        guardrailType: 'symbol_filter',
        actualValue: signal.symbol,
      };
    }

    // 4. Check order type
    if (signal.order_kind === 'market' && settings.copy_market_orders === false) {
      return {
        allowed: false,
        blockReason: 'order_type_disabled',
        guardrailType: 'order_type',
        actualValue: 'market',
      };
    }
    if ((signal.order_kind === 'limit' || signal.order_kind === 'stop') && settings.copy_pending_orders === false) {
      return {
        allowed: false,
        blockReason: 'order_type_disabled',
        guardrailType: 'order_type',
        actualValue: signal.order_kind,
      };
    }

    // 5. Check late entry
    if (settings.late_entry_seconds && settings.late_entry_seconds > 0) {
      const signalAge = (Date.now() - new Date(signal.published_at).getTime()) / 1000;
      if (signalAge > settings.late_entry_seconds) {
        return {
          allowed: false,
          blockReason: 'late_entry',
          guardrailType: 'timing',
          thresholdValue: `${settings.late_entry_seconds}s`,
          actualValue: `${Math.round(signalAge)}s`,
        };
      }
    }

    // 6. Check concurrent trade limit
    if (settings.max_concurrent_trades && settings.max_concurrent_trades > 0) {
      const openCount = await this.safetyRepo.getOpenTradeCount(sub.id);
      if (openCount >= settings.max_concurrent_trades) {
        return {
          allowed: false,
          blockReason: 'max_concurrent_trades',
          guardrailType: 'concurrent_trades',
          thresholdValue: String(settings.max_concurrent_trades),
          actualValue: String(openCount),
        };
      }
    }

    // 7. Check daily loss limit
    if (settings.max_daily_loss_usd && settings.max_daily_loss_usd > 0) {
      const dailyLoss = await this.safetyRepo.getDailyLossForSubscription(sub.id);
      if (dailyLoss >= settings.max_daily_loss_usd) {
        // Auto-disable if configured
        if (settings.auto_disable_on_daily_loss) {
          await this.triggerAutoDisable(sub, 'daily_loss_breached',
            String(settings.max_daily_loss_usd), String(dailyLoss.toFixed(2)));
        }
        return {
          allowed: false,
          blockReason: 'daily_loss_breached',
          guardrailType: 'daily_loss',
          thresholdValue: `$${settings.max_daily_loss_usd}`,
          actualValue: `$${dailyLoss.toFixed(2)}`,
        };
      }
    }

    // 8. Check allowed sessions (basic implementation)
    if (settings.allowed_sessions && settings.allowed_sessions.length > 0) {
      const currentSession = this.getCurrentSession();
      if (currentSession && !settings.allowed_sessions.includes(currentSession)) {
        return {
          allowed: false,
          blockReason: 'session_not_allowed',
          guardrailType: 'session',
          thresholdValue: settings.allowed_sessions.join(','),
          actualValue: currentSession,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check max lot size guard (called after lot calculation).
   */
  checkMaxLot(settings: SafetySettings, calculatedLot: number): GuardrailCheckResult {
    if (settings.max_lot_size && settings.max_lot_size > 0 && calculatedLot > settings.max_lot_size) {
      return {
        allowed: false,
        blockReason: 'max_lot_exceeded',
        guardrailType: 'lot_limit',
        thresholdValue: String(settings.max_lot_size),
        actualValue: String(calculatedLot),
      };
    }
    return { allowed: true };
  }

  /**
   * Trigger auto-disable on a subscription.
   */
  async triggerAutoDisable(
    sub: FollowerSubscription,
    reason: string,
    threshold?: string,
    actual?: string
  ): Promise<void> {
    await this.safetyRepo.autoDisableSubscription(sub.id, reason);
    await this.safetyRepo.createGuardrailEvent({
      followerSubscriptionId: sub.id,
      userId: sub.user_id,
      eventType: 'auto_disabled',
      reason,
      thresholdValue: threshold,
      actualValue: actual,
    });
    logger.info(`[Safety] Auto-disabled subscription ${sub.id}: ${reason} (threshold=${threshold}, actual=${actual})`);
    // Phase 5: Notify user
    NotificationService.getInstance().subscriptionAutoDisabled(sub.user_id, sub.id, reason);
  }

  /**
   * Re-enable a subscription after user acknowledges the auto-disable.
   */
  async reEnable(subscriptionId: string, userId: string): Promise<boolean> {
    const success = await this.safetyRepo.reEnableSubscription(subscriptionId, userId);
    if (success) {
      await this.safetyRepo.createGuardrailEvent({
        followerSubscriptionId: subscriptionId,
        userId,
        eventType: 're_enabled',
        reason: 'user_re_enabled',
      });
      logger.info(`[Safety] Re-enabled subscription ${subscriptionId} by user ${userId}`);
      // Phase 5: Notify user
      NotificationService.getInstance().subscriptionReEnabled(userId, subscriptionId);
    }
    return success;
  }

  /**
   * Determine current trading session (simplified).
   */
  private getCurrentSession(): string | null {
    const hour = new Date().getUTCHours();
    if (hour >= 0 && hour < 7) return 'asian';
    if (hour >= 7 && hour < 12) return 'london';
    if (hour >= 12 && hour < 21) return 'new_york';
    return 'asian'; // Late night wraps back to Asian
  }
}
