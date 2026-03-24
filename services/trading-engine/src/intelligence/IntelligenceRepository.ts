/**
 * IntelligenceRepository — Data access for intelligence queries, risk warnings, and analytics.
 * All queries derive from existing platform tables.
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';
import type { RiskWarning, WarningSeverity } from './types';

const logger = new Logger('IntelligenceRepository');

export class IntelligenceRepository {
  private pool: Pool | null = null;

  constructor(databaseUrl?: string) {
    const config = getConfig();
    const url = databaseUrl || config.databaseUrl;
    if (!url) { logger.warn('[IntelligenceRepo] No databaseUrl'); return; }
    this.pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    });
  }

  private ensurePool(): Pool {
    if (!this.pool) throw new Error('[IntelligenceRepo] Pool not initialized');
    return this.pool;
  }

  // ==================== Risk Warnings ====================

  async createWarning(params: {
    userId: string; warningType: string; severity: WarningSeverity;
    title: string; description: string; reasonCodes?: string[];
    relatedEntityType?: string; relatedEntityId?: string; metadata?: Record<string, unknown>;
  }): Promise<RiskWarning> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO risk_warnings (user_id, warning_type, severity, title, description, reason_codes, related_entity_type, related_entity_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [params.userId, params.warningType, params.severity, params.title, params.description,
       params.reasonCodes || [], params.relatedEntityType || null, params.relatedEntityId || null,
       JSON.stringify(params.metadata || {})]
    );
    return result.rows[0];
  }

  async getWarningsForUser(userId: string, includeDismissed = false): Promise<RiskWarning[]> {
    const pool = this.ensurePool();
    const where = includeDismissed ? 'user_id = $1' : 'user_id = $1 AND is_dismissed = FALSE';
    const result = await pool.query(
      `SELECT * FROM risk_warnings WHERE ${where} ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );
    return result.rows;
  }

  async dismissWarning(warningId: string, userId: string): Promise<boolean> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `UPDATE risk_warnings SET is_dismissed = TRUE, dismissed_at = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING id`,
      [warningId, userId]
    );
    return (result.rowCount || 0) > 0;
  }

  // ==================== Mentor BI Queries ====================

  async getMentorFollowerGrowth(mentorProfileId: string): Promise<{ date: string; count: number }[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM follower_subscriptions WHERE mentor_profile_id = $1
       GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30`,
      [mentorProfileId]
    );
    return result.rows.map(r => ({ date: r.date, count: parseInt(r.count) }));
  }

  async getMentorEarningsTrend(mentorProfileId: string): Promise<{ month: string; gross: number; net: number }[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT TO_CHAR(created_at, 'YYYY-MM') as month,
              SUM(gross_amount_fiat) as gross, SUM(mentor_net_fiat) as net
       FROM revenue_ledger
       WHERE mentor_profile_id = $1 AND ledger_type = 'mentor_revenue'
       GROUP BY month ORDER BY month DESC LIMIT 12`,
      [mentorProfileId]
    );
    return result.rows.map(r => ({ month: r.month, gross: Number(r.gross), net: Number(r.net) }));
  }

  async getMentorPlanConversionRate(mentorProfileId: string): Promise<number> {
    const pool = this.ensurePool();
    const viewsResult = await pool.query(
      "SELECT COUNT(*) FROM follower_subscriptions WHERE mentor_profile_id = $1",
      [mentorProfileId]
    );
    const paidResult = await pool.query(
      "SELECT COUNT(*) FROM mentor_plan_subscriptions WHERE mentor_profile_id = $1 AND status = 'active'",
      [mentorProfileId]
    );
    const views = parseInt(viewsResult.rows[0].count);
    const paid = parseInt(paidResult.rows[0].count);
    return views > 0 ? (paid / views) * 100 : 0;
  }

  async getMentorChurnStats(mentorProfileId: string): Promise<{ active: number; churned: number }> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'stopped') as churned
       FROM follower_subscriptions WHERE mentor_profile_id = $1`,
      [mentorProfileId]
    );
    return { active: parseInt(result.rows[0].active), churned: parseInt(result.rows[0].churned) };
  }

  async getMentorSignalEngagement(mentorProfileId: string): Promise<{ month: string; signals: number; copies: number }[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT TO_CHAR(ms.published_at, 'YYYY-MM') as month,
              COUNT(DISTINCT ms.id) as signals,
              COUNT(ct.id) as copies
       FROM mentor_signals ms
       LEFT JOIN copied_trades ct ON ct.mentor_signal_id = ms.id
       WHERE ms.mentor_profile_id = $1
       GROUP BY month ORDER BY month DESC LIMIT 12`,
      [mentorProfileId]
    );
    return result.rows.map(r => ({ month: r.month, signals: parseInt(r.signals), copies: parseInt(r.copies) }));
  }

  async getMentorShadowToLiveRate(mentorProfileId: string): Promise<number> {
    const pool = this.ensurePool();
    const shadowResult = await pool.query(
      "SELECT COUNT(*) FROM follower_subscriptions WHERE mentor_profile_id = $1 AND mode = 'shadow'",
      [mentorProfileId]
    );
    const liveResult = await pool.query(
      "SELECT COUNT(*) FROM follower_subscriptions WHERE mentor_profile_id = $1 AND mode = 'auto_trade'",
      [mentorProfileId]
    );
    const shadow = parseInt(shadowResult.rows[0].count);
    const live = parseInt(liveResult.rows[0].count);
    const total = shadow + live;
    return total > 0 ? (live / total) * 100 : 0;
  }

  // ==================== Recommendation Queries ====================

  async getUserSubscribedMentors(userId: string): Promise<string[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      "SELECT DISTINCT mentor_profile_id FROM follower_subscriptions WHERE user_id = $1 AND status != 'stopped'",
      [userId]
    );
    return result.rows.map(r => r.mentor_profile_id);
  }

  async getUserPreferredStyles(userId: string): Promise<{ styles: string[]; symbols: string[] }> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT mp.trading_style, mp.markets_traded
       FROM follower_subscriptions fs
       JOIN mentor_profiles mp ON mp.id = fs.mentor_profile_id
       WHERE fs.user_id = $1 AND fs.status != 'stopped'`,
      [userId]
    );
    const styles = new Set<string>();
    const symbols = new Set<string>();
    for (const row of result.rows) {
      (row.trading_style || []).forEach((s: string) => styles.add(s));
      (row.markets_traded || []).forEach((s: string) => symbols.add(s));
    }
    return { styles: [...styles], symbols: [...symbols] };
  }

  async getTopMentorsByMetric(metric: string, limit = 10): Promise<any[]> {
    const pool = this.ensurePool();
    let orderBy: string;
    switch (metric) {
      case 'followers': orderBy = 'total_followers DESC'; break;
      case 'rating': orderBy = 'avg_rating DESC'; break;
      case 'newest': orderBy = 'created_at DESC'; break;
      default: orderBy = 'total_followers DESC';
    }
    const result = await pool.query(
      `SELECT * FROM mentor_profiles
       WHERE is_active = TRUE AND is_approved = TRUE
       ORDER BY ${orderBy} LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  // ==================== Risk Assessment Queries ====================

  async getUserBlockedCount24h(userId: string): Promise<number> {
    const pool = this.ensurePool();
    const result = await pool.query(
      "SELECT COUNT(*) FROM blocked_copy_attempts WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'",
      [userId]
    );
    return parseInt(result.rows[0].count);
  }

  async getUserAutoDisabledSubs(userId: string): Promise<number> {
    const pool = this.ensurePool();
    const result = await pool.query(
      "SELECT COUNT(*) FROM follower_subscriptions WHERE user_id = $1 AND auto_disabled_at IS NOT NULL",
      [userId]
    );
    return parseInt(result.rows[0].count);
  }

  // ==================== Platform Intelligence Queries ====================

  async getMentorConversionFunnel(): Promise<{ stage: string; count: number }[]> {
    const pool = this.ensurePool();
    const stages = [
      { stage: 'Profiles Created', sql: 'SELECT COUNT(*) FROM mentor_profiles' },
      { stage: 'Approved', sql: "SELECT COUNT(*) FROM mentor_profiles WHERE is_approved = TRUE" },
      { stage: 'Has Signals', sql: "SELECT COUNT(DISTINCT mentor_profile_id) FROM mentor_signals" },
      { stage: 'Has Followers', sql: "SELECT COUNT(*) FROM mentor_profiles WHERE total_followers > 0" },
      { stage: 'Has Paid Plans', sql: "SELECT COUNT(DISTINCT mentor_profile_id) FROM mentor_plans WHERE price_usd > 0" },
    ];
    const funnel = [];
    for (const s of stages) {
      try {
        const r = await pool.query(s.sql);
        funnel.push({ stage: s.stage, count: parseInt(r.rows[0].count) });
      } catch { funnel.push({ stage: s.stage, count: 0 }); }
    }
    return funnel;
  }

  async getReferralFunnel(): Promise<{ stage: string; count: number }[]> {
    const pool = this.ensurePool();
    const stages = [
      { stage: 'Referral Profiles', sql: 'SELECT COUNT(*) FROM referral_profiles' },
      { stage: 'Attributions', sql: 'SELECT COUNT(*) FROM referral_attributions' },
      { stage: 'Conversions', sql: 'SELECT COUNT(*) FROM referral_conversions' },
      { stage: 'Commissions', sql: 'SELECT COUNT(*) FROM referral_commissions' },
      { stage: 'Earned', sql: "SELECT COUNT(*) FROM referral_commissions WHERE status IN ('earned', 'payout_ready', 'paid_out')" },
    ];
    const funnel = [];
    for (const s of stages) {
      try {
        const r = await pool.query(s.sql);
        funnel.push({ stage: s.stage, count: parseInt(r.rows[0].count) });
      } catch { funnel.push({ stage: s.stage, count: 0 }); }
    }
    return funnel;
  }

  async getTopBlockReasons(limit = 10): Promise<{ reason: string; count: number }[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT block_reason as reason, COUNT(*) as count
       FROM blocked_copy_attempts
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY block_reason ORDER BY count DESC LIMIT $1`,
      [limit]
    );
    return result.rows.map(r => ({ reason: r.reason, count: parseInt(r.count) }));
  }

  async getImportQualityRate(): Promise<number> {
    const pool = this.ensurePool();
    const total = await pool.query('SELECT COUNT(*) FROM imported_messages');
    const parsed = await pool.query("SELECT COUNT(*) FROM imported_messages WHERE parse_status = 'parsed'");
    const t = parseInt(total.rows[0].count);
    const p = parseInt(parsed.rows[0].count);
    return t > 0 ? (p / t) * 100 : 0;
  }

  async getChurnHotspots(): Promise<{ reason: string; count: number }[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT
        CASE
          WHEN auto_disabled_reason IS NOT NULL THEN 'auto_disabled: ' || auto_disabled_reason
          WHEN status = 'stopped' THEN 'manual_stop'
          ELSE 'other'
        END as reason,
        COUNT(*) as count
       FROM follower_subscriptions
       WHERE status IN ('stopped', 'paused')
       GROUP BY reason ORDER BY count DESC LIMIT 10`
    );
    return result.rows.map(r => ({ reason: r.reason, count: parseInt(r.count) }));
  }

  async getShadowToLiveRate(): Promise<number> {
    const pool = this.ensurePool();
    const shadow = await pool.query("SELECT COUNT(*) FROM follower_subscriptions WHERE mode = 'shadow'");
    const live = await pool.query("SELECT COUNT(*) FROM follower_subscriptions WHERE mode = 'auto_trade'");
    const s = parseInt(shadow.rows[0].count);
    const l = parseInt(live.rows[0].count);
    return (s + l) > 0 ? (l / (s + l)) * 100 : 0;
  }
}
