/**
 * CommissionService — Creates commissions from billing conversion events.
 * Called from CryptoInvoiceService after successful payment.
 *
 * Flow: Invoice Paid → activateEntitlement → processConversion → create conversion + commission
 */

import { Logger } from '@providencex/shared-utils';
import { ReferralRepository } from './ReferralRepository';
import { NotificationService } from '../notifications/NotificationService';
import { REFERRAL_CONFIG, type ReferralCommission, type ConversionType } from './types';

const logger = new Logger('CommissionService');

export class CommissionService {
  constructor(private repo: ReferralRepository) {}

  /**
   * Process a billing conversion event.
   * Creates a conversion record and a commission if the paying user was referred.
   *
   * Idempotent: Uses `conv_{invoiceId}` as idempotency key.
   * If already processed, returns null without error.
   */
  async processConversion(params: {
    payingUserId: string;
    invoiceId: string;
    conversionType: ConversionType;
    grossAmountFiat: number;
    currency?: string;
  }): Promise<ReferralCommission | null> {
    const { payingUserId, invoiceId, conversionType, grossAmountFiat, currency = 'USD' } = params;

    // 1. Check if paying user was referred
    const attribution = await this.repo.getAttributionByReferredUser(payingUserId);
    if (!attribution) {
      // User was not referred — no commission
      return null;
    }

    const referrerUserId = attribution.referrer_user_id;
    const idempotencyKey = `conv_${invoiceId}`;

    // 2. Create conversion (idempotent via ON CONFLICT)
    const conversion = await this.repo.createConversion({
      referrerUserId,
      referredUserId: payingUserId,
      attributionId: attribution.id,
      conversionType,
      revenueSourceId: invoiceId,
      idempotencyKey,
      grossAmountFiat,
      currency,
    });

    if (!conversion) {
      // Already processed (idempotency conflict) or error
      logger.info(`[Commission] Conversion already processed for invoice ${invoiceId}`);
      return null;
    }

    // 3. Determine commission rate
    const referrerProfile = await this.repo.getProfileByUserId(referrerUserId);
    const commissionPct = referrerProfile?.is_mentor_affiliate
      ? REFERRAL_CONFIG.mentorAffiliateCommissionPct
      : REFERRAL_CONFIG.userCommissionPct;

    const commissionAmount = Math.round(grossAmountFiat * commissionPct) / 100;

    // 4. Create commission (idempotent via UNIQUE on conversion_id)
    const commission = await this.repo.createCommission({
      referrerUserId,
      conversionId: conversion.id,
      grossAmountFiat,
      commissionRatePct: commissionPct,
      commissionAmountFiat: commissionAmount,
      currency,
    });

    if (!commission) {
      logger.warn(`[Commission] Commission already exists for conversion ${conversion.id}`);
      return null;
    }

    // 5. Update referrer profile stats
    await this.repo.incrementConversionCount(referrerUserId, commissionAmount);

    // Phase 5: Notify referrer of commission
    NotificationService.getInstance().commissionEarned(referrerUserId, commissionAmount, grossAmountFiat, conversionType);

    logger.info(
      `[Commission] Created: referrer=${referrerUserId}, ` +
      `conversion=${conversionType}, gross=$${grossAmountFiat}, ` +
      `rate=${commissionPct}%, commission=$${commissionAmount}`
    );

    return commission;
  }

  /**
   * Confirm pending commissions (called by admin or scheduled job).
   * Moves status from 'pending' to 'earned'.
   */
  async confirmPendingCommissions(referrerUserId?: string): Promise<number> {
    const confirmed = await this.repo.confirmPendingCommissions(referrerUserId);
    if (confirmed > 0) {
      logger.info(`[Commission] Confirmed ${confirmed} pending commissions${referrerUserId ? ` for ${referrerUserId}` : ''}`);
    }
    return confirmed;
  }

  /**
   * Mark earned commissions as ready for payout.
   */
  async markPayoutReady(commissionId: string): Promise<ReferralCommission | null> {
    return this.repo.updateCommissionStatus(commissionId, 'payout_ready');
  }

  /**
   * Cancel a commission (e.g. fraud, refund).
   */
  async cancelCommission(commissionId: string, reason: string): Promise<ReferralCommission | null> {
    return this.repo.updateCommissionStatus(commissionId, 'cancelled', reason);
  }
}
