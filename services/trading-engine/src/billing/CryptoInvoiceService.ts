/**
 * CryptoInvoiceService — Invoice creation, status transitions, and payment verification.
 * This is the core billing orchestration service.
 */

import { Logger } from '@providencex/shared-utils';
import { BillingRepository } from './BillingRepository';
import { ExchangeRateService } from './ExchangeRateService';
import { getWatcherForRail } from './BlockchainWatcherService';
import {
  SUPPORTED_RAILS,
  BILLING_CONFIG,
  type PaymentRail,
  type InvoiceStatus,
  type CryptoPaymentInvoice,
  type CreateInvoiceInput,
} from './types';
import { CommissionService } from '../referrals/CommissionService';
import { ReferralRepository } from '../referrals/ReferralRepository';
import { NotificationService } from '../notifications/NotificationService';

const logger = new Logger('CryptoInvoiceService');

export class CryptoInvoiceService {
  private commissionService: CommissionService;

  constructor(
    private repo: BillingRepository,
    private exchangeRateService: ExchangeRateService
  ) {
    // Initialize commission service for referral tracking
    const referralRepo = new ReferralRepository();
    this.commissionService = new CommissionService(referralRepo);
  }

  /**
   * Create a new payment invoice.
   */
  async createInvoice(input: CreateInvoiceInput): Promise<CryptoPaymentInvoice> {
    const { userId, invoiceType, platformPlanId, mentorPlanId, paymentRail } = input;

    // Validate payment rail
    const railInfo = SUPPORTED_RAILS[paymentRail];
    if (!railInfo) {
      throw new Error(`Unsupported payment rail: ${paymentRail}`);
    }

    // Determine price
    let amountFiat: number;
    let mentorProfileId: string | undefined;

    if (invoiceType === 'platform_plan') {
      if (!platformPlanId) throw new Error('platformPlanId required for platform_plan invoice');
      const plan = await this.repo.getPlatformPlanById(platformPlanId);
      if (!plan || !plan.is_active) throw new Error('Invalid or inactive platform plan');
      if (plan.price_usd <= 0) throw new Error('Cannot create invoice for free plan');
      amountFiat = Number(plan.price_usd);
    } else if (invoiceType === 'mentor_plan') {
      if (!mentorPlanId) throw new Error('mentorPlanId required for mentor_plan invoice');
      const plan = await this.repo.getMentorPlanById(mentorPlanId);
      if (!plan || !plan.is_active) throw new Error('Invalid or inactive mentor plan');
      if (plan.price_usd <= 0) throw new Error('Cannot create invoice for free mentor plan');
      amountFiat = Number(plan.price_usd);
      mentorProfileId = plan.mentor_profile_id;
    } else {
      throw new Error(`Invalid invoice type: ${invoiceType}`);
    }

    // Get exchange rate snapshot
    const { amountCrypto, rate, snapshot } = await this.exchangeRateService.calculateCryptoAmount(
      amountFiat, railInfo.token
    );

    // Assign deposit address
    const depositAddress = await this.repo.assignDepositAddress(paymentRail, 'pending');
    if (!depositAddress) {
      throw new Error(`No available deposit addresses for ${paymentRail}. Please contact support.`);
    }

    // Calculate expiry
    const expiresAt = new Date(Date.now() + BILLING_CONFIG.invoiceExpiryMinutes * 60 * 1000).toISOString();

    // Create invoice
    const invoice = await this.repo.createInvoice({
      userId,
      invoiceType,
      platformPlanId,
      mentorPlanId,
      mentorProfileId,
      fiatCurrency: 'USD',
      amountFiat,
      paymentRail,
      chain: railInfo.chain,
      token: railInfo.token,
      amountCryptoExpected: amountCrypto,
      depositAddress,
      exchangeRateSnapshotId: snapshot.id,
      exchangeRateUsed: rate,
      confirmationsRequired: railInfo.confirmationsRequired,
      expiresAt,
    });

    // Update the address assignment to point to actual invoice
    // (We created with 'pending' placeholder above)
    await this.repo.assignDepositAddress(paymentRail, invoice.id);

    // Log creation event
    await this.repo.createPaymentEvent({
      invoiceId: invoice.id,
      eventType: 'created',
      newStatus: 'awaiting_payment',
      metadata: {
        amountFiat,
        amountCrypto,
        paymentRail,
        depositAddress,
        expiresAt,
      },
    });

    logger.info(`[Invoice] Created ${invoice.id} for ${amountFiat} USD → ${amountCrypto} ${railInfo.token} on ${railInfo.chain}`);
    return invoice;
  }

  /**
   * Check payment status for an invoice (triggered by user refresh or periodic job).
   */
  async refreshInvoiceStatus(invoiceId: string): Promise<CryptoPaymentInvoice | null> {
    const invoice = await this.repo.getInvoiceById(invoiceId);
    if (!invoice) return null;

    // Only refresh invoices that are waiting for payment
    if (!['awaiting_payment', 'detected', 'confirming'].includes(invoice.status)) {
      return invoice;
    }

    // Check if expired
    if (new Date(invoice.expires_at) < new Date() && invoice.status === 'awaiting_payment') {
      return this.transitionStatus(invoice, 'expired');
    }

    // Check blockchain for payment
    const watcher = getWatcherForRail(invoice.payment_rail);
    if (!watcher) {
      logger.error(`[Invoice] No watcher for rail ${invoice.payment_rail}`);
      return invoice;
    }

    const transactions = await watcher.checkForPayment(
      invoice.deposit_address,
      Number(invoice.amount_crypto_expected)
    );

    if (transactions.length === 0) {
      return invoice;
    }

    // Process the first matching transaction
    const tx = transactions[0];
    const expectedAmount = Number(invoice.amount_crypto_expected);
    const threshold = expectedAmount * (1 - BILLING_CONFIG.underpaymentThresholdPct / 100);

    if (invoice.status === 'awaiting_payment' || invoice.status === 'detected') {
      // Payment detected
      if (tx.amount < threshold) {
        return this.transitionStatus(invoice, 'underpaid', {
          txHash: tx.txHash,
          fromAddress: tx.fromAddress,
          amountCryptoReceived: tx.amount,
          detectedAt: new Date().toISOString(),
        });
      }

      if (tx.isConfirmed) {
        // Fully confirmed
        const newStatus: InvoiceStatus = tx.amount > expectedAmount * 1.05 ? 'overpaid' : 'paid';
        return this.transitionStatus(invoice, newStatus, {
          txHash: tx.txHash,
          fromAddress: tx.fromAddress,
          amountCryptoReceived: tx.amount,
          confirmationCount: tx.confirmations,
          paidAt: new Date().toISOString(),
          detectedAt: invoice.detected_at || new Date().toISOString(),
        });
      }

      // Detected but not yet confirmed
      return this.transitionStatus(invoice, 'confirming', {
        txHash: tx.txHash,
        fromAddress: tx.fromAddress,
        amountCryptoReceived: tx.amount,
        confirmationCount: tx.confirmations,
        detectedAt: new Date().toISOString(),
      });
    }

    if (invoice.status === 'confirming') {
      // Check if enough confirmations now
      const confirmations = await watcher.getConfirmations(invoice.tx_hash || tx.txHash);
      if (confirmations >= invoice.confirmations_required) {
        const newStatus: InvoiceStatus = tx.amount > expectedAmount * 1.05 ? 'overpaid' : 'paid';
        return this.transitionStatus(invoice, newStatus, {
          confirmationCount: confirmations,
          paidAt: new Date().toISOString(),
        });
      }
      // Update confirmation count
      return this.transitionStatus(invoice, 'confirming', {
        confirmationCount: confirmations,
      });
    }

    return invoice;
  }

  /**
   * Manually mark an invoice for review (admin action).
   */
  async markForManualReview(invoiceId: string, notes: string): Promise<CryptoPaymentInvoice | null> {
    const invoice = await this.repo.getInvoiceById(invoiceId);
    if (!invoice) return null;
    return this.transitionStatus(invoice, 'manual_review', undefined, notes);
  }

  /**
   * Manually confirm payment (admin action for manual_review invoices).
   */
  async manuallyConfirmPayment(invoiceId: string, txHash?: string): Promise<CryptoPaymentInvoice | null> {
    const invoice = await this.repo.getInvoiceById(invoiceId);
    if (!invoice) return null;
    return this.transitionStatus(invoice, 'paid', {
      txHash,
      paidAt: new Date().toISOString(),
      amountCryptoReceived: Number(invoice.amount_crypto_expected),
    });
  }

  /**
   * Get invoice with its event history.
   */
  async getInvoiceWithEvents(invoiceId: string) {
    const invoice = await this.repo.getInvoiceById(invoiceId);
    if (!invoice) return null;
    const events = await this.repo.getPaymentEvents(invoiceId);
    return { invoice, events };
  }

  /**
   * Run periodic maintenance: expire overdue invoices.
   */
  async runMaintenance(): Promise<{ expired: number }> {
    const expired = await this.repo.expireOverdueInvoices();
    if (expired > 0) {
      logger.info(`[Invoice] Expired ${expired} overdue invoices`);
    }
    return { expired };
  }

  // ==================== Private ====================

  private async transitionStatus(
    invoice: CryptoPaymentInvoice,
    newStatus: InvoiceStatus,
    extras?: {
      txHash?: string;
      fromAddress?: string;
      amountCryptoReceived?: number;
      confirmationCount?: number;
      paidAt?: string;
      detectedAt?: string;
    },
    notes?: string
  ): Promise<CryptoPaymentInvoice> {
    const oldStatus = invoice.status;

    const updated = await this.repo.updateInvoiceStatus(invoice.id, newStatus, extras);

    await this.repo.createPaymentEvent({
      invoiceId: invoice.id,
      eventType: newStatus,
      oldStatus,
      newStatus,
      txHash: extras?.txHash,
      amountReceived: extras?.amountCryptoReceived,
      confirmationCount: extras?.confirmationCount,
      metadata: notes ? { notes } : {},
    });

    logger.info(`[Invoice] ${invoice.id}: ${oldStatus} → ${newStatus}`);

    // If paid, activate entitlement
    if (newStatus === 'paid' || newStatus === 'overpaid') {
      await this.activateEntitlement(updated || invoice);
      // Phase 5: Notify user of payment
      NotificationService.getInstance().invoicePaid(
        invoice.user_id, invoice.id, Number(invoice.amount_fiat), invoice.invoice_type
      );
    }

    // Release address on terminal states
    if (['expired', 'failed'].includes(newStatus)) {
      await this.repo.releaseDepositAddress(invoice.id);
      if (newStatus === 'expired') {
        NotificationService.getInstance().invoiceExpired(invoice.user_id, invoice.id, Number(invoice.amount_fiat));
      }
    }

    return updated || invoice;
  }

  /**
   * Activate the subscription/entitlement after confirmed payment.
   */
  private async activateEntitlement(invoice: CryptoPaymentInvoice): Promise<void> {
    const expiresAt = new Date(Date.now() + BILLING_CONFIG.subscriptionDurationDays * 24 * 60 * 60 * 1000).toISOString();

    if (invoice.invoice_type === 'platform_plan' && invoice.platform_plan_id) {
      await this.repo.createPlatformSubscription({
        userId: invoice.user_id,
        platformPlanId: invoice.platform_plan_id,
        expiresAt,
        invoiceId: invoice.id,
      });
      logger.info(`[Entitlement] Platform subscription activated for user ${invoice.user_id}`);
    }

    if (invoice.invoice_type === 'mentor_plan' && invoice.mentor_plan_id && invoice.mentor_profile_id) {
      await this.repo.createMentorPlanSubscription({
        userId: invoice.user_id,
        mentorPlanId: invoice.mentor_plan_id,
        mentorProfileId: invoice.mentor_profile_id,
        expiresAt,
        invoiceId: invoice.id,
      });
      logger.info(`[Entitlement] Mentor subscription activated for user ${invoice.user_id} → mentor ${invoice.mentor_profile_id}`);

      // Create revenue ledger entries
      await this.recordRevenue(invoice);
    }

    // Process referral commission (for both platform and mentor plan payments)
    try {
      await this.commissionService.processConversion({
        payingUserId: invoice.user_id,
        invoiceId: invoice.id,
        conversionType: invoice.invoice_type as 'platform_plan' | 'mentor_plan',
        grossAmountFiat: Number(invoice.amount_fiat),
      });
    } catch (err) {
      // Non-fatal: don't block entitlement activation if commission fails
      logger.error('[Entitlement] Referral commission processing failed (non-fatal)', err);
    }
  }

  /**
   * Record revenue split for a mentor plan payment.
   */
  private async recordRevenue(invoice: CryptoPaymentInvoice): Promise<void> {
    if (invoice.invoice_type !== 'mentor_plan') return;

    const grossFiat = Number(invoice.amount_fiat);
    const platformFeeFiat = Math.round(grossFiat * BILLING_CONFIG.platformFeePct) / 100;
    const mentorNetFiat = grossFiat - platformFeeFiat;
    const grossCrypto = Number(invoice.amount_crypto_received) || Number(invoice.amount_crypto_expected);

    // Platform revenue entry
    await this.repo.createRevenueLedgerEntry({
      invoiceId: invoice.id,
      mentorProfileId: invoice.mentor_profile_id || undefined,
      grossAmountFiat: grossFiat,
      platformFeeFiat,
      mentorNetFiat: 0,
      grossAmountCrypto: grossCrypto,
      paymentRail: invoice.payment_rail as any,
      platformFeePct: BILLING_CONFIG.platformFeePct,
      ledgerType: 'platform_revenue',
    });

    // Mentor revenue entry
    if (invoice.mentor_profile_id) {
      await this.repo.createRevenueLedgerEntry({
        invoiceId: invoice.id,
        mentorProfileId: invoice.mentor_profile_id,
        grossAmountFiat: grossFiat,
        platformFeeFiat,
        mentorNetFiat,
        grossAmountCrypto: grossCrypto,
        paymentRail: invoice.payment_rail as any,
        platformFeePct: BILLING_CONFIG.platformFeePct,
        ledgerType: 'mentor_revenue',
      });
    }

    logger.info(`[Revenue] Recorded: gross=$${grossFiat}, platform=$${platformFeeFiat}, mentor=$${mentorNetFiat}`);
  }
}
