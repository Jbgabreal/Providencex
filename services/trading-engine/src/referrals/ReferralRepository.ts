/**
 * ReferralRepository — Data access for all referral tables.
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';
import type {
  ReferralProfile,
  ReferralAttribution,
  ReferralConversion,
  ReferralCommission,
  CommissionStatus,
} from './types';

const logger = new Logger('ReferralRepository');

export class ReferralRepository {
  private pool: Pool | null = null;

  constructor(databaseUrl?: string) {
    const config = getConfig();
    const url = databaseUrl || config.databaseUrl;
    if (!url) {
      logger.warn('[ReferralRepository] No databaseUrl, repository disabled');
      return;
    }
    this.pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    });
  }

  private ensurePool(): Pool {
    if (!this.pool) throw new Error('[ReferralRepository] Pool not initialized');
    return this.pool;
  }

  // ==================== Referral Profiles ====================

  async getProfileByUserId(userId: string): Promise<ReferralProfile | null> {
    const pool = this.ensurePool();
    const result = await pool.query('SELECT * FROM referral_profiles WHERE user_id = $1', [userId]);
    return result.rows[0] || null;
  }

  async getProfileByCode(referralCode: string): Promise<ReferralProfile | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM referral_profiles WHERE referral_code = $1 AND is_active = TRUE',
      [referralCode.toUpperCase()]
    );
    return result.rows[0] || null;
  }

  async createProfile(params: {
    userId: string;
    referralCode: string;
    isMentorAffiliate?: boolean;
  }): Promise<ReferralProfile> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO referral_profiles (user_id, referral_code, is_mentor_affiliate)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [params.userId, params.referralCode.toUpperCase(), params.isMentorAffiliate || false]
    );
    return result.rows[0];
  }

  async updateProfileCode(userId: string, newCode: string): Promise<ReferralProfile | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `UPDATE referral_profiles SET referral_code = $2, updated_at = NOW()
       WHERE user_id = $1 RETURNING *`,
      [userId, newCode.toUpperCase()]
    );
    return result.rows[0] || null;
  }

  async incrementReferralCount(referrerUserId: string): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `UPDATE referral_profiles SET total_referrals = total_referrals + 1, updated_at = NOW()
       WHERE user_id = $1`,
      [referrerUserId]
    );
  }

  async incrementConversionCount(referrerUserId: string, earnedAmount: number): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `UPDATE referral_profiles
       SET total_conversions = total_conversions + 1,
           total_earned_fiat = total_earned_fiat + $2,
           updated_at = NOW()
       WHERE user_id = $1`,
      [referrerUserId, earnedAmount]
    );
  }

  async setMentorAffiliate(userId: string, isMentor: boolean): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `UPDATE referral_profiles SET is_mentor_affiliate = $2, updated_at = NOW()
       WHERE user_id = $1`,
      [userId, isMentor]
    );
  }

  async isCodeTaken(code: string): Promise<boolean> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT 1 FROM referral_profiles WHERE referral_code = $1',
      [code.toUpperCase()]
    );
    return (result.rowCount || 0) > 0;
  }

  // ==================== Attributions ====================

  async getAttributionByReferredUser(referredUserId: string): Promise<ReferralAttribution | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM referral_attributions WHERE referred_user_id = $1',
      [referredUserId]
    );
    return result.rows[0] || null;
  }

  async createAttribution(params: {
    referrerUserId: string;
    referredUserId: string;
    referralCode: string;
    attributionSource: string;
  }): Promise<ReferralAttribution> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO referral_attributions (referrer_user_id, referred_user_id, referral_code, attribution_source)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [params.referrerUserId, params.referredUserId, params.referralCode.toUpperCase(), params.attributionSource]
    );
    return result.rows[0];
  }

  async getAttributionsByReferrer(referrerUserId: string, limit = 50): Promise<ReferralAttribution[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM referral_attributions WHERE referrer_user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [referrerUserId, limit]
    );
    return result.rows;
  }

  // ==================== Conversions ====================

  async createConversion(params: {
    referrerUserId: string;
    referredUserId: string;
    attributionId: string;
    conversionType: string;
    revenueSourceId: string;
    idempotencyKey: string;
    grossAmountFiat: number;
    currency?: string;
  }): Promise<ReferralConversion | null> {
    const pool = this.ensurePool();
    try {
      const result = await pool.query(
        `INSERT INTO referral_conversions (
          referrer_user_id, referred_user_id, attribution_id,
          conversion_type, revenue_source_id, idempotency_key,
          gross_amount_fiat, currency
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING *`,
        [
          params.referrerUserId, params.referredUserId, params.attributionId,
          params.conversionType, params.revenueSourceId, params.idempotencyKey,
          params.grossAmountFiat, params.currency || 'USD',
        ]
      );
      return result.rows[0] || null; // null means idempotency conflict (already exists)
    } catch (error) {
      logger.error('[ReferralRepo] Create conversion failed', error);
      return null;
    }
  }

  async getConversionsByReferrer(referrerUserId: string, limit = 50): Promise<ReferralConversion[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM referral_conversions WHERE referrer_user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [referrerUserId, limit]
    );
    return result.rows;
  }

  // ==================== Commissions ====================

  async createCommission(params: {
    referrerUserId: string;
    conversionId: string;
    grossAmountFiat: number;
    commissionRatePct: number;
    commissionAmountFiat: number;
    currency?: string;
  }): Promise<ReferralCommission | null> {
    const pool = this.ensurePool();
    try {
      const result = await pool.query(
        `INSERT INTO referral_commissions (
          referrer_user_id, conversion_id, gross_amount_fiat,
          commission_rate_pct, commission_amount_fiat, currency
        ) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (conversion_id) DO NOTHING
        RETURNING *`,
        [
          params.referrerUserId, params.conversionId, params.grossAmountFiat,
          params.commissionRatePct, params.commissionAmountFiat, params.currency || 'USD',
        ]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error('[ReferralRepo] Create commission failed', error);
      return null;
    }
  }

  async getCommissionsByReferrer(referrerUserId: string, limit = 50): Promise<ReferralCommission[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM referral_commissions WHERE referrer_user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [referrerUserId, limit]
    );
    return result.rows;
  }

  async updateCommissionStatus(commissionId: string, status: CommissionStatus, notes?: string): Promise<ReferralCommission | null> {
    const pool = this.ensurePool();
    const extras = status === 'paid_out' ? ', paid_out_at = NOW()' : '';
    const result = await pool.query(
      `UPDATE referral_commissions SET status = $2, notes = COALESCE($3, notes)${extras}, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [commissionId, status, notes || null]
    );
    return result.rows[0] || null;
  }

  async getCommissionSummary(referrerUserId: string): Promise<{
    pending: number;
    earned: number;
    payoutReady: number;
    paidOut: number;
    cancelled: number;
    total: number;
  }> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT
        COALESCE(SUM(commission_amount_fiat) FILTER (WHERE status = 'pending'), 0) as pending,
        COALESCE(SUM(commission_amount_fiat) FILTER (WHERE status = 'earned'), 0) as earned,
        COALESCE(SUM(commission_amount_fiat) FILTER (WHERE status = 'payout_ready'), 0) as payout_ready,
        COALESCE(SUM(commission_amount_fiat) FILTER (WHERE status = 'paid_out'), 0) as paid_out,
        COALESCE(SUM(commission_amount_fiat) FILTER (WHERE status = 'cancelled'), 0) as cancelled,
        COALESCE(SUM(commission_amount_fiat) FILTER (WHERE status IN ('earned', 'payout_ready', 'paid_out')), 0) as total
       FROM referral_commissions WHERE referrer_user_id = $1`,
      [referrerUserId]
    );
    const r = result.rows[0];
    return {
      pending: Number(r.pending),
      earned: Number(r.earned),
      payoutReady: Number(r.payout_ready),
      paidOut: Number(r.paid_out),
      cancelled: Number(r.cancelled),
      total: Number(r.total),
    };
  }

  /**
   * Bulk confirm pending commissions (e.g. after a waiting period).
   */
  async confirmPendingCommissions(referrerUserId?: string): Promise<number> {
    const pool = this.ensurePool();
    let query = `UPDATE referral_commissions SET status = 'earned', updated_at = NOW()
                 WHERE status = 'pending'`;
    const params: any[] = [];
    if (referrerUserId) {
      query += ' AND referrer_user_id = $1';
      params.push(referrerUserId);
    }
    query += ' RETURNING id';
    const result = await pool.query(query, params);
    return result.rowCount || 0;
  }
}
