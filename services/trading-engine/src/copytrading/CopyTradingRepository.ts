/**
 * CopyTradingRepository — Data access for mentor/follower copy trading tables.
 * Follows the same pattern as TenantRepository.
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';
import type {
  MentorProfile,
  MentorSignal,
  MentorSignalUpdate,
  FollowerSubscription,
  CopiedTrade,
  SignalUpdateType,
  SubscriptionMode,
  RiskMode,
} from './types';

const logger = new Logger('CopyTradingRepository');

export class CopyTradingRepository {
  private pool: Pool | null = null;

  constructor(databaseUrl?: string) {
    const config = getConfig();
    const url = databaseUrl || config.databaseUrl;
    if (!url) {
      logger.warn('[CopyTradingRepository] No databaseUrl, repository disabled');
      return;
    }
    this.pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    });
  }

  private ensurePool(): Pool {
    if (!this.pool) throw new Error('[CopyTradingRepository] Pool not initialized');
    return this.pool;
  }

  // ==================== Mentor Profiles ====================

  async createMentorProfile(userId: string, displayName: string, bio?: string): Promise<MentorProfile> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO mentor_profiles (user_id, display_name, bio)
       VALUES ($1, $2, $3) RETURNING *`,
      [userId, displayName, bio || null]
    );
    return result.rows[0];
  }

  async getMentorProfileByUserId(userId: string): Promise<MentorProfile | null> {
    const pool = this.ensurePool();
    const result = await pool.query('SELECT * FROM mentor_profiles WHERE user_id = $1', [userId]);
    return result.rows[0] || null;
  }

  async getMentorProfileById(id: string): Promise<MentorProfile | null> {
    const pool = this.ensurePool();
    const result = await pool.query('SELECT * FROM mentor_profiles WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async updateMentorProfile(id: string, updates: { display_name?: string; bio?: string }): Promise<MentorProfile | null> {
    const pool = this.ensurePool();
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (updates.display_name !== undefined) { sets.push(`display_name = $${i++}`); params.push(updates.display_name); }
    if (updates.bio !== undefined) { sets.push(`bio = $${i++}`); params.push(updates.bio); }
    if (sets.length === 0) return this.getMentorProfileById(id);
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const result = await pool.query(
      `UPDATE mentor_profiles SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params
    );
    return result.rows[0] || null;
  }

  async getPublicMentors(limit = 20, offset = 0): Promise<MentorProfile[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT * FROM mentor_profiles WHERE is_active = TRUE AND is_approved = TRUE
       ORDER BY total_followers DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  }

  async approveMentor(id: string): Promise<MentorProfile | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `UPDATE mentor_profiles SET is_approved = TRUE, updated_at = NOW() WHERE id = $1 RETURNING *`, [id]
    );
    return result.rows[0] || null;
  }

  async incrementFollowerCount(mentorProfileId: string, delta: number): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `UPDATE mentor_profiles SET total_followers = GREATEST(0, total_followers + $2), updated_at = NOW() WHERE id = $1`,
      [mentorProfileId, delta]
    );
  }

  // ==================== Mentor Signals ====================

  async createSignal(params: {
    mentorProfileId: string;
    symbol: string;
    direction: 'BUY' | 'SELL';
    orderKind: 'market' | 'limit' | 'stop';
    entryPrice: number;
    stopLoss: number;
    tp1?: number;
    tp2?: number;
    tp3?: number;
    tp4?: number;
    notes?: string;
    idempotencyKey: string;
  }): Promise<MentorSignal> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO mentor_signals (
        mentor_profile_id, symbol, direction, order_kind, entry_price, stop_loss,
        tp1, tp2, tp3, tp4, notes, idempotency_key
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        params.mentorProfileId, params.symbol.toUpperCase(), params.direction,
        params.orderKind, params.entryPrice, params.stopLoss,
        params.tp1 || null, params.tp2 || null, params.tp3 || null, params.tp4 || null,
        params.notes || null, params.idempotencyKey,
      ]
    );
    return result.rows[0];
  }

  async getSignalById(id: string): Promise<MentorSignal | null> {
    const pool = this.ensurePool();
    const result = await pool.query('SELECT * FROM mentor_signals WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async getSignalsByMentor(mentorProfileId: string, status?: string, limit = 50, offset = 0): Promise<{ signals: MentorSignal[]; total: number }> {
    const pool = this.ensurePool();
    let where = 'WHERE mentor_profile_id = $1';
    const params: any[] = [mentorProfileId];
    let i = 2;
    if (status) { where += ` AND status = $${i++}`; params.push(status); }
    const countResult = await pool.query(`SELECT COUNT(*) FROM mentor_signals ${where}`, params);
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT * FROM mentor_signals ${where} ORDER BY published_at DESC LIMIT $${i++} OFFSET $${i}`, params
    );
    return { signals: result.rows, total: parseInt(countResult.rows[0].count) };
  }

  async updateSignalStatus(id: string, status: string): Promise<void> {
    const pool = this.ensurePool();
    const extras = status === 'closed' ? ', closed_at = NOW()' : status === 'cancelled' ? ', cancelled_at = NOW()' : '';
    await pool.query(
      `UPDATE mentor_signals SET status = $2${extras}, updated_at = NOW() WHERE id = $1`, [id, status]
    );
  }

  async updateSignalSL(id: string, newSl: number): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(`UPDATE mentor_signals SET stop_loss = $2, updated_at = NOW() WHERE id = $1`, [id, newSl]);
  }

  // ==================== Signal Updates ====================

  async createSignalUpdate(params: {
    mentorSignalId: string;
    updateType: SignalUpdateType;
    newSl?: number;
    closeTpLevel?: number;
    newTpValue?: number;
    notes?: string;
    idempotencyKey: string;
  }): Promise<MentorSignalUpdate> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO mentor_signal_updates (
        mentor_signal_id, update_type, new_sl, close_tp_level, new_tp_value, notes, idempotency_key
      ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [params.mentorSignalId, params.updateType, params.newSl || null,
       params.closeTpLevel || null, params.newTpValue || null, params.notes || null, params.idempotencyKey]
    );
    return result.rows[0];
  }

  async updatePropagationStatus(updateId: string, status: string, propagated: number, failed: number): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `UPDATE mentor_signal_updates SET propagation_status = $2, propagated_count = $3, failed_count = $4 WHERE id = $1`,
      [updateId, status, propagated, failed]
    );
  }

  // ==================== Follower Subscriptions ====================

  async createSubscription(params: {
    userId: string;
    mentorProfileId: string;
    mt5AccountId: string;
    mode?: SubscriptionMode;
    riskMode?: RiskMode;
    riskAmount?: number;
    selectedTpLevels?: number[];
  }): Promise<FollowerSubscription> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO follower_subscriptions (
        user_id, mentor_profile_id, mt5_account_id, mode, risk_mode, risk_amount, selected_tp_levels
      ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        params.userId, params.mentorProfileId, params.mt5AccountId,
        params.mode || 'auto_trade', params.riskMode || 'percentage',
        params.riskAmount || 1.0, params.selectedTpLevels || [1],
      ]
    );
    return result.rows[0];
  }

  async getSubscriptionsForUser(userId: string): Promise<FollowerSubscription[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM follower_subscriptions WHERE user_id = $1 ORDER BY created_at DESC', [userId]
    );
    return result.rows;
  }

  async getActiveAutoTradeSubscriptions(mentorProfileId: string): Promise<FollowerSubscription[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT * FROM follower_subscriptions
       WHERE mentor_profile_id = $1 AND status = 'active' AND mode = 'auto_trade'`,
      [mentorProfileId]
    );
    return result.rows;
  }

  async updateSubscriptionConfig(id: string, userId: string, updates: {
    mode?: SubscriptionMode;
    riskMode?: RiskMode;
    riskAmount?: number;
    selectedTpLevels?: number[];
  }): Promise<FollowerSubscription | null> {
    const pool = this.ensurePool();
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (updates.mode) { sets.push(`mode = $${i++}`); params.push(updates.mode); }
    if (updates.riskMode) { sets.push(`risk_mode = $${i++}`); params.push(updates.riskMode); }
    if (updates.riskAmount !== undefined) { sets.push(`risk_amount = $${i++}`); params.push(updates.riskAmount); }
    if (updates.selectedTpLevels) { sets.push(`selected_tp_levels = $${i++}`); params.push(updates.selectedTpLevels); }
    if (sets.length === 0) return null;
    sets.push(`updated_at = NOW()`);
    params.push(id, userId);
    const result = await pool.query(
      `UPDATE follower_subscriptions SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`, params
    );
    return result.rows[0] || null;
  }

  async updateSubscriptionStatus(id: string, userId: string, status: string): Promise<FollowerSubscription | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `UPDATE follower_subscriptions SET status = $3, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, userId, status]
    );
    return result.rows[0] || null;
  }

  // ==================== Copied Trades ====================

  async createCopiedTrade(params: {
    followerSubscriptionId: string;
    mentorSignalId: string;
    tpLevel: number;
    userId: string;
    mt5AccountId: string;
    brokerType: string;
    lotSize: number;
    stopLoss: number;
    takeProfit: number | null;
  }): Promise<CopiedTrade> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO copied_trades (
        follower_subscription_id, mentor_signal_id, tp_level, user_id, mt5_account_id,
        broker_type, lot_size, stop_loss, take_profit
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (follower_subscription_id, mentor_signal_id, tp_level) DO NOTHING
      RETURNING *`,
      [
        params.followerSubscriptionId, params.mentorSignalId, params.tpLevel,
        params.userId, params.mt5AccountId, params.brokerType,
        params.lotSize, params.stopLoss, params.takeProfit,
      ]
    );
    return result.rows[0];
  }

  async updateCopiedTradeExecution(id: string, updates: {
    status: string;
    mt5Ticket?: number;
    entryPrice?: number;
    errorMessage?: string;
  }): Promise<void> {
    const pool = this.ensurePool();
    const sets = ['status = $2', 'updated_at = NOW()'];
    const params: any[] = [id, updates.status];
    let i = 3;
    if (updates.mt5Ticket) { sets.push(`mt5_ticket = $${i++}`); params.push(updates.mt5Ticket); }
    if (updates.entryPrice) { sets.push(`entry_price = $${i++}`); params.push(updates.entryPrice); }
    if (updates.errorMessage) { sets.push(`error_message = $${i++}`); params.push(updates.errorMessage); }
    await pool.query(`UPDATE copied_trades SET ${sets.join(', ')} WHERE id = $1`, params);
  }

  async closeCopiedTrade(id: string, exitPrice: number | null, profit: number | null, reason: string): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `UPDATE copied_trades SET status = 'closed', exit_price = $2, profit = $3,
       close_reason = $4, closed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id, exitPrice, profit, reason]
    );
  }

  async updateCopiedTradeSL(copiedTradeId: string, newSl: number): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `UPDATE copied_trades SET stop_loss = $2, updated_at = NOW() WHERE id = $1`, [copiedTradeId, newSl]
    );
  }

  async getOpenCopiedTradesBySignal(mentorSignalId: string): Promise<CopiedTrade[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT * FROM copied_trades WHERE mentor_signal_id = $1 AND status = 'open'`, [mentorSignalId]
    );
    return result.rows;
  }

  async getOpenCopiedTradesBySignalAndTpLevel(mentorSignalId: string, tpLevel: number): Promise<CopiedTrade[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT * FROM copied_trades WHERE mentor_signal_id = $1 AND tp_level = $2 AND status = 'open'`,
      [mentorSignalId, tpLevel]
    );
    return result.rows;
  }

  async getCopiedTradesForUser(userId: string, limit = 50, offset = 0): Promise<{ trades: CopiedTrade[]; total: number }> {
    const pool = this.ensurePool();
    const countResult = await pool.query('SELECT COUNT(*) FROM copied_trades WHERE user_id = $1', [userId]);
    const result = await pool.query(
      'SELECT * FROM copied_trades WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [userId, limit, offset]
    );
    return { trades: result.rows, total: parseInt(countResult.rows[0].count) };
  }

  async getCopiedTradeById(id: string): Promise<CopiedTrade | null> {
    const pool = this.ensurePool();
    const result = await pool.query('SELECT * FROM copied_trades WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  // ==================== Mentor Performance Analytics ====================

  async getMentorPerformance(mentorProfileId: string): Promise<{
    total_signals: number;
    active_signals: number;
    closed_signals: number;
    total_copied_trades: number;
    winning_trades: number;
    losing_trades: number;
    win_rate: number;
    total_pnl: number;
    avg_profit_per_trade: number;
    profit_factor: number;
    best_trade: number;
    worst_trade: number;
    avg_pips_per_signal: number;
  }> {
    const pool = this.ensurePool();

    // Signal stats
    const signalStats = await pool.query(
      `SELECT
        COUNT(*) as total_signals,
        COUNT(*) FILTER (WHERE status = 'active') as active_signals,
        COUNT(*) FILTER (WHERE status IN ('closed', 'partially_closed')) as closed_signals
       FROM mentor_signals WHERE mentor_profile_id = $1`,
      [mentorProfileId]
    );

    // Copied trade stats (across all followers for this mentor's signals)
    const tradeStats = await pool.query(
      `SELECT
        COUNT(*) as total_trades,
        COUNT(*) FILTER (WHERE ct.profit > 0) as winning_trades,
        COUNT(*) FILTER (WHERE ct.profit < 0) as losing_trades,
        COALESCE(SUM(ct.profit), 0) as total_pnl,
        COALESCE(AVG(ct.profit) FILTER (WHERE ct.status = 'closed'), 0) as avg_profit,
        COALESCE(SUM(ct.profit) FILTER (WHERE ct.profit > 0), 0) as gross_profit,
        COALESCE(ABS(SUM(ct.profit) FILTER (WHERE ct.profit < 0)), 0.01) as gross_loss,
        COALESCE(MAX(ct.profit), 0) as best_trade,
        COALESCE(MIN(ct.profit), 0) as worst_trade
       FROM copied_trades ct
       JOIN mentor_signals ms ON ms.id = ct.mentor_signal_id
       WHERE ms.mentor_profile_id = $1 AND ct.status = 'closed'`,
      [mentorProfileId]
    );

    const ss = signalStats.rows[0];
    const ts = tradeStats.rows[0];
    const totalClosed = Number(ts.winning_trades) + Number(ts.losing_trades);

    return {
      total_signals: parseInt(ss.total_signals),
      active_signals: parseInt(ss.active_signals),
      closed_signals: parseInt(ss.closed_signals),
      total_copied_trades: parseInt(ts.total_trades),
      winning_trades: parseInt(ts.winning_trades),
      losing_trades: parseInt(ts.losing_trades),
      win_rate: totalClosed > 0 ? (Number(ts.winning_trades) / totalClosed) * 100 : 0,
      total_pnl: Number(ts.total_pnl),
      avg_profit_per_trade: Number(ts.avg_profit),
      profit_factor: Number(ts.gross_loss) > 0 ? Number(ts.gross_profit) / Number(ts.gross_loss) : 0,
      best_trade: Number(ts.best_trade),
      worst_trade: Number(ts.worst_trade),
      avg_pips_per_signal: 0, // TODO: calculate from entry/exit prices
    };
  }

  async getSignalPerformance(signalId: string): Promise<{
    total_copies: number;
    open: number;
    closed: number;
    failed: number;
    total_pnl: number;
    winning: number;
    losing: number;
  }> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT
        COUNT(*) as total_copies,
        COUNT(*) FILTER (WHERE status = 'open') as open,
        COUNT(*) FILTER (WHERE status = 'closed') as closed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COALESCE(SUM(profit) FILTER (WHERE status = 'closed'), 0) as total_pnl,
        COUNT(*) FILTER (WHERE profit > 0) as winning,
        COUNT(*) FILTER (WHERE profit < 0) as losing
       FROM copied_trades WHERE mentor_signal_id = $1`,
      [signalId]
    );
    const r = result.rows[0];
    return {
      total_copies: parseInt(r.total_copies),
      open: parseInt(r.open),
      closed: parseInt(r.closed),
      failed: parseInt(r.failed),
      total_pnl: Number(r.total_pnl),
      winning: parseInt(r.winning),
      losing: parseInt(r.losing),
    };
  }

  async getCopiedTradesSummaryBySignal(signalId: string): Promise<{ total: number; open: number; closed: number; failed: number }> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'open') as open,
        COUNT(*) FILTER (WHERE status = 'closed') as closed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
       FROM copied_trades WHERE mentor_signal_id = $1`,
      [signalId]
    );
    const row = result.rows[0];
    return { total: parseInt(row.total), open: parseInt(row.open), closed: parseInt(row.closed), failed: parseInt(row.failed) };
  }
}
