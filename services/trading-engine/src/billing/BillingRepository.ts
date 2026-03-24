/**
 * BillingRepository — Data access for all crypto billing tables.
 * Follows the same Pool pattern as CopyTradingRepository.
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';
import type {
  PlatformPlan,
  PlatformSubscription,
  MentorPlan,
  MentorPlanSubscription,
  CryptoPaymentInvoice,
  CryptoPaymentEvent,
  ExchangeRateSnapshot,
  RevenueLedgerEntry,
  CryptoPaymentSweep,
  InvoiceStatus,
  PaymentRail,
} from './types';

const logger = new Logger('BillingRepository');

export class BillingRepository {
  private pool: Pool | null = null;

  constructor(databaseUrl?: string) {
    const config = getConfig();
    const url = databaseUrl || config.databaseUrl;
    if (!url) {
      logger.warn('[BillingRepository] No databaseUrl, repository disabled');
      return;
    }
    this.pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    });
  }

  private ensurePool(): Pool {
    if (!this.pool) throw new Error('[BillingRepository] Pool not initialized');
    return this.pool;
  }

  // ==================== Platform Plans ====================

  async getPlatformPlans(activeOnly = true): Promise<PlatformPlan[]> {
    const pool = this.ensurePool();
    const where = activeOnly ? 'WHERE is_active = TRUE' : '';
    const result = await pool.query(
      `SELECT * FROM platform_plans ${where} ORDER BY sort_order ASC`
    );
    return result.rows;
  }

  async getPlatformPlanById(id: string): Promise<PlatformPlan | null> {
    const pool = this.ensurePool();
    const result = await pool.query('SELECT * FROM platform_plans WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async getPlatformPlanBySlug(slug: string): Promise<PlatformPlan | null> {
    const pool = this.ensurePool();
    const result = await pool.query('SELECT * FROM platform_plans WHERE slug = $1', [slug]);
    return result.rows[0] || null;
  }

  // ==================== Platform Subscriptions ====================

  async getActivePlatformSubscription(userId: string): Promise<(PlatformSubscription & { plan?: PlatformPlan }) | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT ps.*, row_to_json(pp.*) as plan
       FROM platform_subscriptions ps
       JOIN platform_plans pp ON pp.id = ps.platform_plan_id
       WHERE ps.user_id = $1 AND ps.status = 'active'
         AND (ps.expires_at IS NULL OR ps.expires_at > NOW())
       ORDER BY ps.created_at DESC LIMIT 1`,
      [userId]
    );
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return { ...row, plan: row.plan };
  }

  async createPlatformSubscription(params: {
    userId: string;
    platformPlanId: string;
    expiresAt: string | null;
    invoiceId?: string;
  }): Promise<PlatformSubscription> {
    const pool = this.ensurePool();
    // Expire any existing active subscriptions
    await pool.query(
      `UPDATE platform_subscriptions SET status = 'expired', updated_at = NOW()
       WHERE user_id = $1 AND status = 'active'`,
      [params.userId]
    );
    const result = await pool.query(
      `INSERT INTO platform_subscriptions (user_id, platform_plan_id, expires_at, invoice_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [params.userId, params.platformPlanId, params.expiresAt, params.invoiceId || null]
    );
    return result.rows[0];
  }

  // ==================== Mentor Plans ====================

  async getMentorPlans(mentorProfileId: string, activeOnly = true): Promise<MentorPlan[]> {
    const pool = this.ensurePool();
    let where = 'WHERE mentor_profile_id = $1';
    if (activeOnly) where += ' AND is_active = TRUE';
    const result = await pool.query(
      `SELECT * FROM mentor_plans ${where} ORDER BY sort_order ASC, price_usd ASC`,
      [mentorProfileId]
    );
    return result.rows;
  }

  async getPublicMentorPlans(mentorProfileId: string): Promise<MentorPlan[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT * FROM mentor_plans
       WHERE mentor_profile_id = $1 AND is_active = TRUE AND is_public = TRUE
       ORDER BY sort_order ASC, price_usd ASC`,
      [mentorProfileId]
    );
    return result.rows;
  }

  async getMentorPlanById(id: string): Promise<MentorPlan | null> {
    const pool = this.ensurePool();
    const result = await pool.query('SELECT * FROM mentor_plans WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async createMentorPlan(params: {
    mentorProfileId: string;
    name: string;
    description?: string;
    priceUsd: number;
    features?: string[];
    isPublic?: boolean;
  }): Promise<MentorPlan> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO mentor_plans (mentor_profile_id, name, description, price_usd, features, is_public)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        params.mentorProfileId,
        params.name,
        params.description || null,
        params.priceUsd,
        JSON.stringify(params.features || []),
        params.isPublic !== false,
      ]
    );
    return result.rows[0];
  }

  async updateMentorPlan(id: string, mentorProfileId: string, updates: {
    name?: string;
    description?: string;
    priceUsd?: number;
    isActive?: boolean;
    isPublic?: boolean;
    features?: string[];
    sortOrder?: number;
  }): Promise<MentorPlan | null> {
    const pool = this.ensurePool();
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (updates.name !== undefined) { sets.push(`name = $${i++}`); params.push(updates.name); }
    if (updates.description !== undefined) { sets.push(`description = $${i++}`); params.push(updates.description); }
    if (updates.priceUsd !== undefined) { sets.push(`price_usd = $${i++}`); params.push(updates.priceUsd); }
    if (updates.isActive !== undefined) { sets.push(`is_active = $${i++}`); params.push(updates.isActive); }
    if (updates.isPublic !== undefined) { sets.push(`is_public = $${i++}`); params.push(updates.isPublic); }
    if (updates.features !== undefined) { sets.push(`features = $${i++}`); params.push(JSON.stringify(updates.features)); }
    if (updates.sortOrder !== undefined) { sets.push(`sort_order = $${i++}`); params.push(updates.sortOrder); }
    if (sets.length === 0) return this.getMentorPlanById(id);
    sets.push('updated_at = NOW()');
    params.push(id, mentorProfileId);
    const result = await pool.query(
      `UPDATE mentor_plans SET ${sets.join(', ')} WHERE id = $${i++} AND mentor_profile_id = $${i} RETURNING *`,
      params
    );
    return result.rows[0] || null;
  }

  // ==================== Mentor Plan Subscriptions ====================

  async getActiveMentorSubscription(userId: string, mentorProfileId: string): Promise<MentorPlanSubscription | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT * FROM mentor_plan_subscriptions
       WHERE user_id = $1 AND mentor_profile_id = $2 AND status = 'active'
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC LIMIT 1`,
      [userId, mentorProfileId]
    );
    return result.rows[0] || null;
  }

  async getUserMentorSubscriptions(userId: string): Promise<(MentorPlanSubscription & { plan?: MentorPlan })[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT mps.*, row_to_json(mp.*) as plan
       FROM mentor_plan_subscriptions mps
       JOIN mentor_plans mp ON mp.id = mps.mentor_plan_id
       WHERE mps.user_id = $1
       ORDER BY mps.created_at DESC`,
      [userId]
    );
    return result.rows.map((r: any) => ({ ...r, plan: r.plan }));
  }

  async createMentorPlanSubscription(params: {
    userId: string;
    mentorPlanId: string;
    mentorProfileId: string;
    expiresAt: string | null;
    invoiceId?: string;
  }): Promise<MentorPlanSubscription> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO mentor_plan_subscriptions (user_id, mentor_plan_id, mentor_profile_id, expires_at, invoice_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [params.userId, params.mentorPlanId, params.mentorProfileId, params.expiresAt, params.invoiceId || null]
    );
    return result.rows[0];
  }

  // ==================== Exchange Rates ====================

  async createExchangeRateSnapshot(params: {
    fiatCurrency: string;
    cryptoToken: string;
    rate: number;
    source: string;
  }): Promise<ExchangeRateSnapshot> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO exchange_rate_snapshots (fiat_currency, crypto_token, rate, source)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [params.fiatCurrency, params.cryptoToken, params.rate, params.source]
    );
    return result.rows[0];
  }

  // ==================== Crypto Payment Addresses ====================

  async assignDepositAddress(paymentRail: PaymentRail, invoiceId: string): Promise<string | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `UPDATE crypto_payment_addresses
       SET is_assigned = TRUE, assigned_to_invoice_id = $2
       WHERE id = (
         SELECT id FROM crypto_payment_addresses
         WHERE payment_rail = $1 AND is_assigned = FALSE
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       ) RETURNING address`,
      [paymentRail, invoiceId]
    );
    return result.rows[0]?.address || null;
  }

  async releaseDepositAddress(invoiceId: string): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `UPDATE crypto_payment_addresses
       SET is_assigned = FALSE, assigned_to_invoice_id = NULL
       WHERE assigned_to_invoice_id = $1`,
      [invoiceId]
    );
  }

  async seedDepositAddress(params: {
    chain: string;
    token: string;
    paymentRail: PaymentRail;
    address: string;
    privateKeyEnc?: string;
  }): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `INSERT INTO crypto_payment_addresses (chain, token, payment_rail, address, private_key_enc)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [params.chain, params.token, params.paymentRail, params.address, params.privateKeyEnc || null]
    );
  }

  // ==================== Invoices ====================

  async createInvoice(params: {
    userId: string;
    invoiceType: string;
    platformPlanId?: string;
    mentorPlanId?: string;
    mentorProfileId?: string;
    fiatCurrency: string;
    amountFiat: number;
    paymentRail: PaymentRail;
    chain: string;
    token: string;
    amountCryptoExpected: number;
    depositAddress: string;
    exchangeRateSnapshotId: string;
    exchangeRateUsed: number;
    confirmationsRequired: number;
    expiresAt: string;
  }): Promise<CryptoPaymentInvoice> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO crypto_payment_invoices (
        user_id, invoice_type, platform_plan_id, mentor_plan_id, mentor_profile_id,
        fiat_currency, amount_fiat, payment_rail, chain, token,
        amount_crypto_expected, deposit_address, exchange_rate_snapshot_id,
        exchange_rate_used, confirmations_required, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        params.userId, params.invoiceType, params.platformPlanId || null,
        params.mentorPlanId || null, params.mentorProfileId || null,
        params.fiatCurrency, params.amountFiat, params.paymentRail,
        params.chain, params.token, params.amountCryptoExpected,
        params.depositAddress, params.exchangeRateSnapshotId,
        params.exchangeRateUsed, params.confirmationsRequired, params.expiresAt,
      ]
    );
    return result.rows[0];
  }

  async getInvoiceById(id: string): Promise<CryptoPaymentInvoice | null> {
    const pool = this.ensurePool();
    const result = await pool.query('SELECT * FROM crypto_payment_invoices WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async getInvoicesByUser(userId: string, limit = 20): Promise<CryptoPaymentInvoice[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM crypto_payment_invoices WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return result.rows;
  }

  async updateInvoiceStatus(id: string, status: InvoiceStatus, extras?: {
    txHash?: string;
    fromAddress?: string;
    amountCryptoReceived?: number;
    confirmationCount?: number;
    paidAt?: string;
    detectedAt?: string;
  }): Promise<CryptoPaymentInvoice | null> {
    const pool = this.ensurePool();
    const sets = ['status = $2', 'updated_at = NOW()'];
    const params: any[] = [id, status];
    let i = 3;
    if (extras?.txHash) { sets.push(`tx_hash = $${i++}`); params.push(extras.txHash); }
    if (extras?.fromAddress) { sets.push(`from_address = $${i++}`); params.push(extras.fromAddress); }
    if (extras?.amountCryptoReceived !== undefined) { sets.push(`amount_crypto_received = $${i++}`); params.push(extras.amountCryptoReceived); }
    if (extras?.confirmationCount !== undefined) { sets.push(`confirmation_count = $${i++}`); params.push(extras.confirmationCount); }
    if (extras?.paidAt) { sets.push(`paid_at = $${i++}`); params.push(extras.paidAt); }
    if (extras?.detectedAt) { sets.push(`detected_at = $${i++}`); params.push(extras.detectedAt); }
    const result = await pool.query(
      `UPDATE crypto_payment_invoices SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );
    return result.rows[0] || null;
  }

  async getAwaitingInvoices(): Promise<CryptoPaymentInvoice[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT * FROM crypto_payment_invoices
       WHERE status IN ('awaiting_payment', 'detected', 'confirming')
       ORDER BY created_at ASC`
    );
    return result.rows;
  }

  async expireOverdueInvoices(): Promise<number> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `UPDATE crypto_payment_invoices
       SET status = 'expired', updated_at = NOW()
       WHERE status = 'awaiting_payment' AND expires_at < NOW()
       RETURNING id`
    );
    // Release addresses for expired invoices
    for (const row of result.rows) {
      await this.releaseDepositAddress(row.id);
    }
    return result.rowCount || 0;
  }

  // ==================== Payment Events ====================

  async createPaymentEvent(params: {
    invoiceId: string;
    eventType: string;
    oldStatus?: string;
    newStatus?: string;
    txHash?: string;
    amountReceived?: number;
    confirmationCount?: number;
    metadata?: Record<string, unknown>;
  }): Promise<CryptoPaymentEvent> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO crypto_payment_events (
        invoice_id, event_type, old_status, new_status, tx_hash,
        amount_received, confirmation_count, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        params.invoiceId, params.eventType, params.oldStatus || null,
        params.newStatus || null, params.txHash || null,
        params.amountReceived || null, params.confirmationCount || null,
        JSON.stringify(params.metadata || {}),
      ]
    );
    return result.rows[0];
  }

  async getPaymentEvents(invoiceId: string): Promise<CryptoPaymentEvent[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM crypto_payment_events WHERE invoice_id = $1 ORDER BY created_at ASC',
      [invoiceId]
    );
    return result.rows;
  }

  // ==================== Revenue Ledger ====================

  async createRevenueLedgerEntry(params: {
    invoiceId: string;
    mentorProfileId?: string;
    grossAmountFiat: number;
    platformFeeFiat: number;
    mentorNetFiat: number;
    grossAmountCrypto: number;
    paymentRail: PaymentRail;
    platformFeePct: number;
    ledgerType: 'platform_revenue' | 'mentor_revenue';
  }): Promise<RevenueLedgerEntry> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO revenue_ledger (
        invoice_id, mentor_profile_id, gross_amount_fiat, platform_fee_fiat,
        mentor_net_fiat, gross_amount_crypto, payment_rail, platform_fee_pct, ledger_type
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        params.invoiceId, params.mentorProfileId || null,
        params.grossAmountFiat, params.platformFeeFiat,
        params.mentorNetFiat, params.grossAmountCrypto,
        params.paymentRail, params.platformFeePct, params.ledgerType,
      ]
    );
    return result.rows[0];
  }

  async getMentorEarnings(mentorProfileId: string): Promise<{
    totalGross: number;
    totalPlatformFee: number;
    totalNet: number;
    entries: RevenueLedgerEntry[];
  }> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT * FROM revenue_ledger
       WHERE mentor_profile_id = $1 AND ledger_type = 'mentor_revenue'
       ORDER BY created_at DESC`,
      [mentorProfileId]
    );
    const entries = result.rows;
    const totalGross = entries.reduce((s: number, e: any) => s + Number(e.gross_amount_fiat), 0);
    const totalPlatformFee = entries.reduce((s: number, e: any) => s + Number(e.platform_fee_fiat), 0);
    const totalNet = entries.reduce((s: number, e: any) => s + Number(e.mentor_net_fiat), 0);
    return { totalGross, totalPlatformFee, totalNet, entries };
  }

  async getPlatformRevenue(): Promise<{
    totalRevenue: number;
    totalFees: number;
    entries: RevenueLedgerEntry[];
  }> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT * FROM revenue_ledger ORDER BY created_at DESC`
    );
    const entries = result.rows;
    const totalRevenue = entries.reduce((s: number, e: any) => s + Number(e.gross_amount_fiat), 0);
    const totalFees = entries.reduce((s: number, e: any) => s + Number(e.platform_fee_fiat), 0);
    return { totalRevenue, totalFees, entries };
  }

  // ==================== Sweeps ====================

  async createSweep(params: {
    sourceAddress: string;
    destinationAddress: string;
    chain: string;
    token: string;
    paymentRail: PaymentRail;
    amount: number;
    invoiceId?: string;
  }): Promise<CryptoPaymentSweep> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO crypto_payment_sweeps (
        source_address, destination_address, chain, token, payment_rail, amount, invoice_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        params.sourceAddress, params.destinationAddress,
        params.chain, params.token, params.paymentRail,
        params.amount, params.invoiceId || null,
      ]
    );
    return result.rows[0];
  }

  async updateSweepStatus(id: string, status: string, txHash?: string): Promise<void> {
    const pool = this.ensurePool();
    const sets = ['status = $2', 'updated_at = NOW()'];
    const params: any[] = [id, status];
    if (txHash) { sets.push('tx_hash = $3'); params.push(txHash); }
    await pool.query(`UPDATE crypto_payment_sweeps SET ${sets.join(', ')} WHERE id = $1`, params);
  }
}
