/**
 * AdminRepository — Data access for admin action logs and cross-domain queries.
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';

const logger = new Logger('AdminRepository');

export class AdminRepository {
  private pool: Pool | null = null;

  constructor(databaseUrl?: string) {
    const config = getConfig();
    const url = databaseUrl || config.databaseUrl;
    if (!url) { logger.warn('[AdminRepository] No databaseUrl'); return; }
    this.pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    });
  }

  private ensurePool(): Pool {
    if (!this.pool) throw new Error('[AdminRepository] Pool not initialized');
    return this.pool;
  }

  // ==================== Audit Log ====================

  async logAction(params: {
    adminUserId: string; targetType: string; targetId: string;
    actionType: string; oldStatus?: string; newStatus?: string;
    reason?: string; notes?: string; metadata?: Record<string, unknown>;
  }): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `INSERT INTO admin_action_logs (admin_user_id, target_type, target_id, action_type, old_status, new_status, reason, notes, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [params.adminUserId, params.targetType, params.targetId, params.actionType,
       params.oldStatus || null, params.newStatus || null, params.reason || null,
       params.notes || null, JSON.stringify(params.metadata || {})]
    );
  }

  async getActionLogs(opts?: { targetType?: string; targetId?: string; limit?: number }): Promise<any[]> {
    const pool = this.ensurePool();
    let where = '1=1';
    const params: any[] = [];
    let i = 1;
    if (opts?.targetType) { where += ` AND target_type = $${i++}`; params.push(opts.targetType); }
    if (opts?.targetId) { where += ` AND target_id = $${i++}`; params.push(opts.targetId); }
    params.push(opts?.limit || 50);
    const result = await pool.query(
      `SELECT * FROM admin_action_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${i}`,
      params
    );
    return result.rows;
  }

  // ==================== Mentor Moderation ====================

  async getAllMentors(opts?: { status?: string; limit?: number }): Promise<any[]> {
    const pool = this.ensurePool();
    let where = '1=1';
    const params: any[] = [];
    let i = 1;
    if (opts?.status === 'pending') { where += ' AND is_approved = FALSE AND is_active = TRUE'; }
    if (opts?.status === 'approved') { where += ' AND is_approved = TRUE AND is_active = TRUE'; }
    if (opts?.status === 'suspended') { where += ' AND is_active = FALSE'; }
    params.push(opts?.limit || 50);
    const result = await pool.query(
      `SELECT mp.*, u.email as user_email FROM mentor_profiles mp
       JOIN users u ON u.id = mp.user_id
       WHERE ${where} ORDER BY mp.created_at DESC LIMIT $${i}`,
      params
    );
    return result.rows;
  }

  async updateMentorStatus(mentorId: string, updates: {
    isApproved?: boolean; isActive?: boolean; isFeatured?: boolean; featuredOrder?: number;
  }): Promise<any> {
    const pool = this.ensurePool();
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (updates.isApproved !== undefined) { sets.push(`is_approved = $${i++}`); params.push(updates.isApproved); }
    if (updates.isActive !== undefined) { sets.push(`is_active = $${i++}`); params.push(updates.isActive); }
    if (updates.isFeatured !== undefined) { sets.push(`is_featured = $${i++}`); params.push(updates.isFeatured); }
    if (updates.featuredOrder !== undefined) { sets.push(`featured_order = $${i++}`); params.push(updates.featuredOrder); }
    if (sets.length === 0) return null;
    sets.push('updated_at = NOW()');
    params.push(mentorId);
    const result = await pool.query(
      `UPDATE mentor_profiles SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );
    return result.rows[0];
  }

  // ==================== Billing Ops ====================

  async getInvoices(opts?: { status?: string; limit?: number }): Promise<any[]> {
    const pool = this.ensurePool();
    let where = '1=1';
    const params: any[] = [];
    let i = 1;
    if (opts?.status) { where += ` AND status = $${i++}`; params.push(opts.status); }
    params.push(opts?.limit || 50);
    const result = await pool.query(
      `SELECT cpi.*, u.email as user_email FROM crypto_payment_invoices cpi
       JOIN users u ON u.id = cpi.user_id
       WHERE ${where} ORDER BY cpi.created_at DESC LIMIT $${i}`,
      params
    );
    return result.rows;
  }

  async updateInvoiceStatus(invoiceId: string, status: string, notes?: string): Promise<any> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `UPDATE crypto_payment_invoices SET status = $2, notes = $3, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [invoiceId, status, notes || null]
    );
    return result.rows[0];
  }

  // ==================== Referral Ops ====================

  async getCommissions(opts?: { status?: string; limit?: number }): Promise<any[]> {
    const pool = this.ensurePool();
    let where = '1=1';
    const params: any[] = [];
    let i = 1;
    if (opts?.status) { where += ` AND rc.status = $${i++}`; params.push(opts.status); }
    params.push(opts?.limit || 50);
    const result = await pool.query(
      `SELECT rc.*, u.email as referrer_email FROM referral_commissions rc
       JOIN users u ON u.id = rc.referrer_user_id
       WHERE ${where} ORDER BY rc.created_at DESC LIMIT $${i}`,
      params
    );
    return result.rows;
  }

  async updateCommissionStatus(commissionId: string, status: string, notes?: string): Promise<any> {
    const pool = this.ensurePool();
    const extras = status === 'paid_out' ? ', paid_out_at = NOW()' : '';
    const result = await pool.query(
      `UPDATE referral_commissions SET status = $2, notes = $3${extras}, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [commissionId, status, notes || null]
    );
    return result.rows[0];
  }

  async getAttributions(limit = 50): Promise<any[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT ra.*, u1.email as referrer_email, u2.email as referred_email
       FROM referral_attributions ra
       JOIN users u1 ON u1.id = ra.referrer_user_id
       JOIN users u2 ON u2.id = ra.referred_user_id
       ORDER BY ra.created_at DESC LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  // ==================== Review Moderation ====================

  async getReviews(opts?: { status?: string; limit?: number }): Promise<any[]> {
    const pool = this.ensurePool();
    let where = '1=1';
    const params: any[] = [];
    let i = 1;
    if (opts?.status) { where += ` AND mr.moderation_status = $${i++}`; params.push(opts.status); }
    params.push(opts?.limit || 50);
    const result = await pool.query(
      `SELECT mr.*, u.email as reviewer_email, mp.display_name as mentor_name
       FROM mentor_reviews mr
       JOIN users u ON u.id = mr.reviewer_user_id
       JOIN mentor_profiles mp ON mp.id = mr.mentor_profile_id
       WHERE ${where} ORDER BY mr.created_at DESC LIMIT $${i}`,
      params
    );
    return result.rows;
  }

  async updateReviewStatus(reviewId: string, status: string): Promise<any> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `UPDATE mentor_reviews SET moderation_status = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [reviewId, status]
    );
    return result.rows[0];
  }

  // ==================== Support / Debug ====================

  async getSubscriptions(opts?: { userId?: string; mode?: string; limit?: number }): Promise<any[]> {
    const pool = this.ensurePool();
    let where = '1=1';
    const params: any[] = [];
    let i = 1;
    if (opts?.userId) { where += ` AND fs.user_id = $${i++}`; params.push(opts.userId); }
    if (opts?.mode) { where += ` AND fs.mode = $${i++}`; params.push(opts.mode); }
    params.push(opts?.limit || 50);
    const result = await pool.query(
      `SELECT fs.*, u.email, mp.display_name as mentor_name
       FROM follower_subscriptions fs
       JOIN users u ON u.id = fs.user_id
       JOIN mentor_profiles mp ON mp.id = fs.mentor_profile_id
       WHERE ${where} ORDER BY fs.created_at DESC LIMIT $${i}`,
      params
    );
    return result.rows;
  }

  async getCopiedTrades(opts?: { userId?: string; status?: string; limit?: number }): Promise<any[]> {
    const pool = this.ensurePool();
    let where = '1=1';
    const params: any[] = [];
    let i = 1;
    if (opts?.userId) { where += ` AND ct.user_id = $${i++}`; params.push(opts.userId); }
    if (opts?.status) { where += ` AND ct.status = $${i++}`; params.push(opts.status); }
    params.push(opts?.limit || 50);
    const result = await pool.query(
      `SELECT ct.* FROM copied_trades ct WHERE ${where} ORDER BY ct.created_at DESC LIMIT $${i}`,
      params
    );
    return result.rows;
  }

  async getBlockedAttempts(limit = 50): Promise<any[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT bca.*, u.email FROM blocked_copy_attempts bca
       JOIN users u ON u.id = bca.user_id
       ORDER BY bca.created_at DESC LIMIT $1`, [limit]
    );
    return result.rows;
  }

  async getImportCandidates(opts?: { status?: string; limit?: number }): Promise<any[]> {
    const pool = this.ensurePool();
    let where = '1=1';
    const params: any[] = [];
    let i = 1;
    if (opts?.status) { where += ` AND isc.review_status = $${i++}`; params.push(opts.status); }
    params.push(opts?.limit || 50);
    const result = await pool.query(
      `SELECT isc.*, mp.display_name as mentor_name
       FROM imported_signal_candidates isc
       JOIN mentor_profiles mp ON mp.id = isc.mentor_profile_id
       WHERE ${where} ORDER BY isc.created_at DESC LIMIT $${i}`,
      params
    );
    return result.rows;
  }

  async getShadowTrades(opts?: { userId?: string; limit?: number }): Promise<any[]> {
    const pool = this.ensurePool();
    let where = '1=1';
    const params: any[] = [];
    let i = 1;
    if (opts?.userId) { where += ` AND st.user_id = $${i++}`; params.push(opts.userId); }
    params.push(opts?.limit || 50);
    const result = await pool.query(
      `SELECT st.* FROM simulated_trades st WHERE ${where} ORDER BY st.created_at DESC LIMIT $${i}`,
      params
    );
    return result.rows;
  }

  // ==================== Overview Stats ====================

  async getOverviewStats(): Promise<Record<string, number>> {
    const pool = this.ensurePool();
    const queries = [
      { key: 'totalUsers', sql: 'SELECT COUNT(*) FROM users' },
      { key: 'totalMentors', sql: "SELECT COUNT(*) FROM mentor_profiles WHERE is_approved = TRUE" },
      { key: 'pendingMentors', sql: "SELECT COUNT(*) FROM mentor_profiles WHERE is_approved = FALSE AND is_active = TRUE" },
      { key: 'totalSignals', sql: 'SELECT COUNT(*) FROM mentor_signals' },
      { key: 'activeSubscriptions', sql: "SELECT COUNT(*) FROM follower_subscriptions WHERE status = 'active'" },
      { key: 'shadowSubscriptions', sql: "SELECT COUNT(*) FROM follower_subscriptions WHERE mode = 'shadow' AND status = 'active'" },
      { key: 'openCopiedTrades', sql: "SELECT COUNT(*) FROM copied_trades WHERE status = 'open'" },
      { key: 'openSimTrades', sql: "SELECT COUNT(*) FROM simulated_trades WHERE status = 'open'" },
      { key: 'pendingInvoices', sql: "SELECT COUNT(*) FROM crypto_payment_invoices WHERE status IN ('awaiting_payment', 'manual_review')" },
      { key: 'manualReviewInvoices', sql: "SELECT COUNT(*) FROM crypto_payment_invoices WHERE status = 'manual_review'" },
      { key: 'pendingCommissions', sql: "SELECT COUNT(*) FROM referral_commissions WHERE status = 'pending'" },
      { key: 'pendingReviews', sql: "SELECT COUNT(*) FROM mentor_reviews WHERE moderation_status = 'pending'" },
      { key: 'pendingImports', sql: "SELECT COUNT(*) FROM imported_signal_candidates WHERE review_status = 'pending'" },
      { key: 'blockedAttempts24h', sql: "SELECT COUNT(*) FROM blocked_copy_attempts WHERE created_at > NOW() - INTERVAL '24 hours'" },
    ];

    const stats: Record<string, number> = {};
    for (const q of queries) {
      try {
        const result = await pool.query(q.sql);
        stats[q.key] = parseInt(result.rows[0].count);
      } catch {
        stats[q.key] = 0;
      }
    }
    return stats;
  }
}
