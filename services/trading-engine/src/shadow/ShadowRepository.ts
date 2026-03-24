/**
 * ShadowRepository — Data access for simulated trades and events.
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';
import type { SimulatedTrade, SimulatedTradeEvent, ShadowSummary } from './types';

const logger = new Logger('ShadowRepository');

export class ShadowRepository {
  private pool: Pool | null = null;

  constructor(databaseUrl?: string) {
    const config = getConfig();
    const url = databaseUrl || config.databaseUrl;
    if (!url) { logger.warn('[ShadowRepository] No databaseUrl'); return; }
    this.pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    });
  }

  private ensurePool(): Pool {
    if (!this.pool) throw new Error('[ShadowRepository] Pool not initialized');
    return this.pool;
  }

  // ==================== Simulated Trades ====================

  async createTrade(params: {
    followerSubscriptionId: string; mentorSignalId: string; tpLevel: number;
    userId: string; symbol: string; direction: string; orderKind: string;
    entryPrice: number; stopLoss: number; takeProfit: number | null; lotSize: number;
  }): Promise<SimulatedTrade | null> {
    const pool = this.ensurePool();
    try {
      const result = await pool.query(
        `INSERT INTO simulated_trades (
          follower_subscription_id, mentor_signal_id, tp_level, user_id,
          symbol, direction, order_kind, entry_price, stop_loss, take_profit, lot_size
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (follower_subscription_id, mentor_signal_id, tp_level) DO NOTHING
        RETURNING *`,
        [
          params.followerSubscriptionId, params.mentorSignalId, params.tpLevel,
          params.userId, params.symbol, params.direction, params.orderKind,
          params.entryPrice, params.stopLoss, params.takeProfit, params.lotSize,
        ]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error('[ShadowRepo] Create trade failed', error);
      return null;
    }
  }

  async getTradesForUser(userId: string, opts?: {
    status?: string; limit?: number; offset?: number;
  }): Promise<SimulatedTrade[]> {
    const pool = this.ensurePool();
    let where = 'WHERE user_id = $1';
    const params: any[] = [userId];
    let i = 2;
    if (opts?.status) { where += ` AND status = $${i++}`; params.push(opts.status); }
    params.push(opts?.limit || 50, opts?.offset || 0);
    const result = await pool.query(
      `SELECT * FROM simulated_trades ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
      params
    );
    return result.rows;
  }

  async getTradeById(id: string): Promise<SimulatedTrade | null> {
    const pool = this.ensurePool();
    const result = await pool.query('SELECT * FROM simulated_trades WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async getOpenTradesBySignal(mentorSignalId: string): Promise<SimulatedTrade[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      "SELECT * FROM simulated_trades WHERE mentor_signal_id = $1 AND status = 'open'",
      [mentorSignalId]
    );
    return result.rows;
  }

  async getOpenTradesBySignalAndTp(mentorSignalId: string, tpLevel: number): Promise<SimulatedTrade[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      "SELECT * FROM simulated_trades WHERE mentor_signal_id = $1 AND tp_level = $2 AND status = 'open'",
      [mentorSignalId, tpLevel]
    );
    return result.rows;
  }

  async closeTrade(id: string, exitPrice: number, pnl: number, reason: string): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `UPDATE simulated_trades
       SET status = 'closed', exit_price = $2, simulated_pnl = $3, close_reason = $4,
           closed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id, exitPrice, pnl, reason]
    );
  }

  async cancelTrade(id: string): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      "UPDATE simulated_trades SET status = 'cancelled', closed_at = NOW(), updated_at = NOW() WHERE id = $1",
      [id]
    );
  }

  async updateTradeSL(id: string, newSl: number): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      'UPDATE simulated_trades SET stop_loss = $2, updated_at = NOW() WHERE id = $1',
      [id, newSl]
    );
  }

  // ==================== Summary / Performance ====================

  async getSummaryForUser(userId: string): Promise<ShadowSummary> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'open') as open_trades,
        COUNT(*) FILTER (WHERE status = 'closed') as closed_trades,
        COUNT(*) FILTER (WHERE status = 'closed' AND simulated_pnl > 0) as winning,
        COUNT(*) FILTER (WHERE status = 'closed' AND simulated_pnl < 0) as losing,
        COALESCE(SUM(simulated_pnl) FILTER (WHERE status = 'closed'), 0) as total_pnl,
        COALESCE(AVG(simulated_pnl) FILTER (WHERE status = 'closed'), 0) as avg_pnl,
        COALESCE(MAX(simulated_pnl) FILTER (WHERE status = 'closed'), 0) as best,
        COALESCE(MIN(simulated_pnl) FILTER (WHERE status = 'closed'), 0) as worst
       FROM simulated_trades WHERE user_id = $1`,
      [userId]
    );
    const r = result.rows[0];
    const closed = parseInt(r.closed_trades);
    const winning = parseInt(r.winning);
    return {
      totalTrades: parseInt(r.total),
      openTrades: parseInt(r.open_trades),
      closedTrades: closed,
      winningTrades: winning,
      losingTrades: parseInt(r.losing),
      totalPnl: Number(r.total_pnl),
      winRate: closed > 0 ? (winning / closed) * 100 : 0,
      avgPnl: Number(r.avg_pnl),
      bestTrade: Number(r.best),
      worstTrade: Number(r.worst),
    };
  }

  // ==================== Events ====================

  async createEvent(params: {
    simulatedTradeId: string; followerSubscriptionId: string;
    mentorSignalId: string; eventType: string; details?: Record<string, unknown>;
  }): Promise<SimulatedTradeEvent> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO simulated_trade_events (simulated_trade_id, follower_subscription_id, mentor_signal_id, event_type, details)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [params.simulatedTradeId, params.followerSubscriptionId, params.mentorSignalId,
       params.eventType, JSON.stringify(params.details || {})]
    );
    return result.rows[0];
  }

  async getTradeEvents(simulatedTradeId: string): Promise<SimulatedTradeEvent[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM simulated_trade_events WHERE simulated_trade_id = $1 ORDER BY created_at ASC',
      [simulatedTradeId]
    );
    return result.rows;
  }

  // ==================== Shadow Subscriptions ====================

  async getActiveShadowSubscriptions(mentorProfileId: string): Promise<any[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT * FROM follower_subscriptions
       WHERE mentor_profile_id = $1 AND status = 'active' AND mode = 'shadow'`,
      [mentorProfileId]
    );
    return result.rows;
  }
}
