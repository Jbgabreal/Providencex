/**
 * NotificationService — Central service for creating notifications.
 * Respects user preferences. All calls are non-blocking (fire-and-forget safe).
 *
 * Future: Add DeliveryChannel interface for email/push/Telegram dispatch.
 */

import { Logger } from '@providencex/shared-utils';
import { NotificationRepository } from './NotificationRepository';
import type { CreateNotificationInput, Notification, NotificationCategory } from './types';

const logger = new Logger('NotificationService');

// Singleton instance for use across services
let _instance: NotificationService | null = null;

export class NotificationService {
  constructor(private repo: NotificationRepository) {}

  /**
   * Get or create the singleton instance.
   */
  static getInstance(): NotificationService {
    if (!_instance) {
      _instance = new NotificationService(new NotificationRepository());
    }
    return _instance;
  }

  /**
   * Create a notification for a user.
   * Respects preferences — returns null if suppressed.
   * Idempotent via idempotency_key.
   */
  async notify(input: CreateNotificationInput): Promise<Notification | null> {
    try {
      // Check category preference
      const categoryEnabled = await this.repo.isCategoryEnabled(input.userId, input.category);
      if (!categoryEnabled) {
        return null;
      }

      // Check event mute
      const muted = await this.repo.isEventMuted(input.userId, input.eventType);
      if (muted) {
        return null;
      }

      const notification = await this.repo.create({
        userId: input.userId,
        category: input.category,
        eventType: input.eventType,
        title: input.title,
        body: input.body,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
      });

      if (notification) {
        logger.debug(`[Notify] ${input.category}/${input.eventType} → user ${input.userId}`);
      }

      // Future: dispatch to other channels (email, push, telegram) here
      // if (prefs.email_enabled) await emailChannel.send(notification);
      // if (prefs.telegram_enabled) await telegramChannel.send(notification);

      return notification;
    } catch (error) {
      // Non-fatal: never block callers
      logger.error(`[Notify] Failed: ${input.category}/${input.eventType} for user ${input.userId}`, error);
      return null;
    }
  }

  // ==================== Trading Notifications ====================

  async tradeCreated(userId: string, symbol: string, direction: string, tpLevel: number, signalId: string) {
    return this.notify({
      userId,
      category: 'trading',
      eventType: 'trade_created',
      title: 'Trade Copied',
      body: `${direction} ${symbol} TP${tpLevel} copied from mentor signal`,
      payload: { symbol, direction, tp_level: tpLevel, signal_id: signalId },
      idempotencyKey: `trade_created_${signalId}_tp${tpLevel}_${userId}`,
    });
  }

  async tradeFilled(userId: string, symbol: string, direction: string, ticket: number | string, entryPrice: number) {
    return this.notify({
      userId,
      category: 'trading',
      eventType: 'trade_filled',
      title: 'Trade Filled',
      body: `${direction} ${symbol} filled at ${entryPrice} (ticket ${ticket})`,
      payload: { symbol, direction, ticket, entry_price: entryPrice },
    });
  }

  async tradeFailed(userId: string, symbol: string, direction: string, error: string) {
    return this.notify({
      userId,
      category: 'trading',
      eventType: 'trade_failed',
      title: 'Trade Failed',
      body: `${direction} ${symbol} failed: ${error}`,
      payload: { symbol, direction, error },
    });
  }

  // ==================== Safety Notifications ====================

  async tradeBlocked(userId: string, symbol: string, reason: string, guardrailType: string) {
    return this.notify({
      userId,
      category: 'safety',
      eventType: 'trade_blocked',
      title: 'Trade Blocked',
      body: `${symbol} blocked: ${reason.replace(/_/g, ' ')}`,
      payload: { symbol, reason, guardrail_type: guardrailType },
    });
  }

  async subscriptionAutoDisabled(userId: string, subscriptionId: string, reason: string) {
    return this.notify({
      userId,
      category: 'safety',
      eventType: 'subscription_auto_disabled',
      title: 'Subscription Auto-Disabled',
      body: `Copy trading paused: ${reason.replace(/_/g, ' ')}`,
      payload: { subscription_id: subscriptionId, reason },
      idempotencyKey: `auto_disabled_${subscriptionId}_${new Date().toISOString().slice(0, 10)}`,
    });
  }

  async subscriptionReEnabled(userId: string, subscriptionId: string) {
    return this.notify({
      userId,
      category: 'safety',
      eventType: 'subscription_re_enabled',
      title: 'Subscription Re-Enabled',
      body: 'Copy trading resumed',
      payload: { subscription_id: subscriptionId },
    });
  }

  // ==================== Billing Notifications ====================

  async invoicePaid(userId: string, invoiceId: string, amountFiat: number, planType: string) {
    return this.notify({
      userId,
      category: 'billing',
      eventType: 'invoice_paid',
      title: 'Payment Confirmed',
      body: `$${amountFiat} payment confirmed for ${planType.replace(/_/g, ' ')}`,
      payload: { invoice_id: invoiceId, amount_fiat: amountFiat, plan_type: planType },
      idempotencyKey: `invoice_paid_${invoiceId}`,
    });
  }

  async entitlementActivated(userId: string, planType: string, planName: string, expiresAt: string) {
    return this.notify({
      userId,
      category: 'billing',
      eventType: 'entitlement_activated',
      title: 'Subscription Activated',
      body: `${planName} is now active until ${new Date(expiresAt).toLocaleDateString()}`,
      payload: { plan_type: planType, plan_name: planName, expires_at: expiresAt },
    });
  }

  async invoiceExpired(userId: string, invoiceId: string, amountFiat: number) {
    return this.notify({
      userId,
      category: 'billing',
      eventType: 'invoice_expired',
      title: 'Invoice Expired',
      body: `$${amountFiat} invoice expired without payment`,
      payload: { invoice_id: invoiceId, amount_fiat: amountFiat },
      idempotencyKey: `invoice_expired_${invoiceId}`,
    });
  }

  // ==================== Referral Notifications ====================

  async referralAttributed(referrerUserId: string, referralCode: string) {
    return this.notify({
      userId: referrerUserId,
      category: 'referrals',
      eventType: 'referral_attributed',
      title: 'New Referral',
      body: `Someone signed up using your referral code ${referralCode}`,
      payload: { referral_code: referralCode },
    });
  }

  async commissionEarned(referrerUserId: string, commissionAmount: number, grossAmount: number, conversionType: string) {
    return this.notify({
      userId: referrerUserId,
      category: 'referrals',
      eventType: 'commission_earned',
      title: 'Commission Earned',
      body: `$${commissionAmount.toFixed(2)} commission from $${grossAmount.toFixed(2)} ${conversionType.replace(/_/g, ' ')}`,
      payload: { commission_amount: commissionAmount, gross_amount: grossAmount, conversion_type: conversionType },
    });
  }
}
