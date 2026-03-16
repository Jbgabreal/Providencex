/**
 * MentorAnalyticsService — computes verified, platform-derived analytics for mentors.
 *
 * All stats come from real mentor_signals + copied_trades data.
 * Nothing is self-reported by the mentor.
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';

const logger = new Logger('MentorAnalyticsService');

export interface MentorAnalytics {
  // Overview
  total_signals: number;
  active_signals: number;
  closed_signals: number;
  cancelled_signals: number;
  total_copied_trades: number;
  total_followers: number;
  active_subscribers: number;

  // Performance
  winning_trades: number;
  losing_trades: number;
  breakeven_trades: number;
  win_rate: number;
  loss_rate: number;
  total_pnl: number;
  avg_profit_per_trade: number;
  profit_factor: number;
  best_trade: number;
  worst_trade: number;
  avg_rr: number;
  avg_hold_time_hours: number;

  // Drawdown
  max_drawdown_pct: number;
  current_drawdown_pct: number;

  // Risk label
  risk_label: 'low' | 'moderate' | 'high';
  risk_score: number; // 0-100

  // Period performance
  last_30d: PeriodPerformance;
  last_90d: PeriodPerformance;
  last_180d: PeriodPerformance;

  // Monthly breakdown
  monthly_performance: MonthlyPerformance[];

  // Symbol breakdown
  symbol_breakdown: SymbolBreakdown[];

  // Recent signals
  recent_signals: RecentSignal[];
}

export interface PeriodPerformance {
  total_signals: number;
  total_trades: number;
  winning: number;
  losing: number;
  win_rate: number;
  total_pnl: number;
  profit_factor: number;
}

export interface MonthlyPerformance {
  month: string; // YYYY-MM
  signals: number;
  trades: number;
  winning: number;
  losing: number;
  win_rate: number;
  pnl: number;
  profit_factor: number;
}

export interface SymbolBreakdown {
  symbol: string;
  total_signals: number;
  total_trades: number;
  winning: number;
  losing: number;
  win_rate: number;
  pnl: number;
}

export interface RecentSignal {
  id: string;
  symbol: string;
  direction: string;
  entry_price: number;
  stop_loss: number;
  tp1: number | null;
  status: string;
  published_at: string;
  total_copies: number;
  pnl: number;
}

export class MentorAnalyticsService {
  private pool: Pool | null = null;

  constructor(databaseUrl?: string) {
    const config = getConfig();
    const url = databaseUrl || config.databaseUrl;
    if (!url) return;
    this.pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    });
  }

  private ensurePool(): Pool {
    if (!this.pool) throw new Error('MentorAnalyticsService pool not initialized');
    return this.pool;
  }

  async getFullAnalytics(mentorProfileId: string): Promise<MentorAnalytics> {
    const [
      overview,
      performance,
      drawdown,
      last30d,
      last90d,
      last180d,
      monthly,
      symbols,
      recent,
      subscribers,
    ] = await Promise.all([
      this.getOverview(mentorProfileId),
      this.getPerformance(mentorProfileId),
      this.getDrawdown(mentorProfileId),
      this.getPeriodPerformance(mentorProfileId, 30),
      this.getPeriodPerformance(mentorProfileId, 90),
      this.getPeriodPerformance(mentorProfileId, 180),
      this.getMonthlyPerformance(mentorProfileId),
      this.getSymbolBreakdown(mentorProfileId),
      this.getRecentSignals(mentorProfileId),
      this.getSubscriberCounts(mentorProfileId),
    ]);

    const riskResult = this.computeRiskLabel(performance, drawdown, overview);

    return {
      ...overview,
      ...performance,
      ...drawdown,
      ...subscribers,
      risk_label: riskResult.label,
      risk_score: riskResult.score,
      last_30d: last30d,
      last_90d: last90d,
      last_180d: last180d,
      monthly_performance: monthly,
      symbol_breakdown: symbols,
      recent_signals: recent,
    };
  }

  private async getOverview(mentorProfileId: string) {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT
        COUNT(*) as total_signals,
        COUNT(*) FILTER (WHERE status = 'active') as active_signals,
        COUNT(*) FILTER (WHERE status IN ('closed', 'partially_closed')) as closed_signals,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_signals
       FROM mentor_signals WHERE mentor_profile_id = $1`,
      [mentorProfileId]
    );
    const r = result.rows[0];

    const tradeCount = await pool.query(
      `SELECT COUNT(*) as total FROM copied_trades ct
       JOIN mentor_signals ms ON ms.id = ct.mentor_signal_id
       WHERE ms.mentor_profile_id = $1`,
      [mentorProfileId]
    );

    const followerResult = await pool.query(
      `SELECT total_followers FROM mentor_profiles WHERE id = $1`, [mentorProfileId]
    );

    return {
      total_signals: parseInt(r.total_signals),
      active_signals: parseInt(r.active_signals),
      closed_signals: parseInt(r.closed_signals),
      cancelled_signals: parseInt(r.cancelled_signals),
      total_copied_trades: parseInt(tradeCount.rows[0].total),
      total_followers: followerResult.rows[0]?.total_followers || 0,
    };
  }

  private async getPerformance(mentorProfileId: string) {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE ct.profit > 0) as winning,
        COUNT(*) FILTER (WHERE ct.profit < 0) as losing,
        COUNT(*) FILTER (WHERE ct.profit = 0) as breakeven,
        COALESCE(SUM(ct.profit), 0) as total_pnl,
        COALESCE(AVG(ct.profit) FILTER (WHERE ct.status = 'closed'), 0) as avg_profit,
        COALESCE(SUM(ct.profit) FILTER (WHERE ct.profit > 0), 0) as gross_profit,
        COALESCE(ABS(SUM(ct.profit) FILTER (WHERE ct.profit < 0)), 0.01) as gross_loss,
        COALESCE(MAX(ct.profit), 0) as best_trade,
        COALESCE(MIN(ct.profit), 0) as worst_trade,
        COALESCE(AVG(
          CASE WHEN ct.take_profit IS NOT NULL AND ct.stop_loss IS NOT NULL AND ct.entry_price IS NOT NULL
               AND ABS(ct.entry_price - ct.stop_loss) > 0
          THEN ABS(ct.take_profit - ct.entry_price) / ABS(ct.entry_price - ct.stop_loss)
          ELSE NULL END
        ), 0) as avg_rr,
        COALESCE(AVG(
          EXTRACT(EPOCH FROM (ct.closed_at - ct.created_at)) / 3600
        ) FILTER (WHERE ct.closed_at IS NOT NULL), 0) as avg_hold_hours
       FROM copied_trades ct
       JOIN mentor_signals ms ON ms.id = ct.mentor_signal_id
       WHERE ms.mentor_profile_id = $1 AND ct.status = 'closed'`,
      [mentorProfileId]
    );
    const r = result.rows[0];
    const totalClosed = parseInt(r.winning) + parseInt(r.losing) + parseInt(r.breakeven);

    return {
      winning_trades: parseInt(r.winning),
      losing_trades: parseInt(r.losing),
      breakeven_trades: parseInt(r.breakeven),
      win_rate: totalClosed > 0 ? (parseInt(r.winning) / totalClosed) * 100 : 0,
      loss_rate: totalClosed > 0 ? (parseInt(r.losing) / totalClosed) * 100 : 0,
      total_pnl: Number(r.total_pnl),
      avg_profit_per_trade: Number(r.avg_profit),
      profit_factor: Number(r.gross_loss) > 0 ? Number(r.gross_profit) / Number(r.gross_loss) : 0,
      best_trade: Number(r.best_trade),
      worst_trade: Number(r.worst_trade),
      avg_rr: Math.round(Number(r.avg_rr) * 100) / 100,
      avg_hold_time_hours: Math.round(Number(r.avg_hold_hours) * 10) / 10,
    };
  }

  private async getDrawdown(mentorProfileId: string) {
    const pool = this.ensurePool();
    // Calculate drawdown from cumulative PnL series
    const result = await pool.query(
      `WITH pnl_series AS (
        SELECT ct.profit, ct.closed_at,
          SUM(ct.profit) OVER (ORDER BY ct.closed_at) as cumulative_pnl
        FROM copied_trades ct
        JOIN mentor_signals ms ON ms.id = ct.mentor_signal_id
        WHERE ms.mentor_profile_id = $1 AND ct.status = 'closed' AND ct.profit IS NOT NULL
        ORDER BY ct.closed_at
      ),
      peaks AS (
        SELECT cumulative_pnl,
          MAX(cumulative_pnl) OVER (ORDER BY closed_at) as peak
        FROM pnl_series
      )
      SELECT
        COALESCE(MIN(cumulative_pnl - peak), 0) as max_drawdown,
        COALESCE((SELECT cumulative_pnl - peak FROM peaks ORDER BY cumulative_pnl - peak ASC LIMIT 1), 0) as current_dd
      FROM peaks`,
      [mentorProfileId]
    );
    const r = result.rows[0] || { max_drawdown: 0, current_dd: 0 };

    return {
      max_drawdown_pct: Math.abs(Number(r.max_drawdown)),
      current_drawdown_pct: Math.abs(Number(r.current_dd)),
    };
  }

  private async getPeriodPerformance(mentorProfileId: string, days: number): Promise<PeriodPerformance> {
    const pool = this.ensurePool();
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();

    const signalCount = await pool.query(
      `SELECT COUNT(*) as cnt FROM mentor_signals
       WHERE mentor_profile_id = $1 AND published_at >= $2`,
      [mentorProfileId, cutoff]
    );

    const result = await pool.query(
      `SELECT
        COUNT(*) as total_trades,
        COUNT(*) FILTER (WHERE ct.profit > 0) as winning,
        COUNT(*) FILTER (WHERE ct.profit < 0) as losing,
        COALESCE(SUM(ct.profit), 0) as total_pnl,
        COALESCE(SUM(ct.profit) FILTER (WHERE ct.profit > 0), 0) as gross_profit,
        COALESCE(ABS(SUM(ct.profit) FILTER (WHERE ct.profit < 0)), 0.01) as gross_loss
       FROM copied_trades ct
       JOIN mentor_signals ms ON ms.id = ct.mentor_signal_id
       WHERE ms.mentor_profile_id = $1 AND ct.status = 'closed' AND ct.closed_at >= $2`,
      [mentorProfileId, cutoff]
    );
    const r = result.rows[0];
    const total = parseInt(r.winning) + parseInt(r.losing);

    return {
      total_signals: parseInt(signalCount.rows[0].cnt),
      total_trades: parseInt(r.total_trades),
      winning: parseInt(r.winning),
      losing: parseInt(r.losing),
      win_rate: total > 0 ? (parseInt(r.winning) / total) * 100 : 0,
      total_pnl: Number(r.total_pnl),
      profit_factor: Number(r.gross_loss) > 0 ? Number(r.gross_profit) / Number(r.gross_loss) : 0,
    };
  }

  private async getMonthlyPerformance(mentorProfileId: string): Promise<MonthlyPerformance[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT
        TO_CHAR(ct.closed_at, 'YYYY-MM') as month,
        COUNT(DISTINCT ct.mentor_signal_id) as signals,
        COUNT(*) as trades,
        COUNT(*) FILTER (WHERE ct.profit > 0) as winning,
        COUNT(*) FILTER (WHERE ct.profit < 0) as losing,
        COALESCE(SUM(ct.profit), 0) as pnl,
        COALESCE(SUM(ct.profit) FILTER (WHERE ct.profit > 0), 0) as gross_profit,
        COALESCE(ABS(SUM(ct.profit) FILTER (WHERE ct.profit < 0)), 0.01) as gross_loss
       FROM copied_trades ct
       JOIN mentor_signals ms ON ms.id = ct.mentor_signal_id
       WHERE ms.mentor_profile_id = $1 AND ct.status = 'closed' AND ct.closed_at IS NOT NULL
       GROUP BY TO_CHAR(ct.closed_at, 'YYYY-MM')
       ORDER BY month DESC
       LIMIT 12`,
      [mentorProfileId]
    );

    return result.rows.map((r) => ({
      month: r.month,
      signals: parseInt(r.signals),
      trades: parseInt(r.trades),
      winning: parseInt(r.winning),
      losing: parseInt(r.losing),
      win_rate: (parseInt(r.winning) + parseInt(r.losing)) > 0
        ? (parseInt(r.winning) / (parseInt(r.winning) + parseInt(r.losing))) * 100 : 0,
      pnl: Number(r.pnl),
      profit_factor: Number(r.gross_loss) > 0 ? Number(r.gross_profit) / Number(r.gross_loss) : 0,
    }));
  }

  private async getSymbolBreakdown(mentorProfileId: string): Promise<SymbolBreakdown[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT
        ms.symbol,
        COUNT(DISTINCT ms.id) as total_signals,
        COUNT(ct.id) as total_trades,
        COUNT(*) FILTER (WHERE ct.profit > 0) as winning,
        COUNT(*) FILTER (WHERE ct.profit < 0) as losing,
        COALESCE(SUM(ct.profit), 0) as pnl
       FROM mentor_signals ms
       LEFT JOIN copied_trades ct ON ct.mentor_signal_id = ms.id AND ct.status = 'closed'
       WHERE ms.mentor_profile_id = $1
       GROUP BY ms.symbol
       ORDER BY COUNT(DISTINCT ms.id) DESC`,
      [mentorProfileId]
    );

    return result.rows.map((r) => ({
      symbol: r.symbol,
      total_signals: parseInt(r.total_signals),
      total_trades: parseInt(r.total_trades),
      winning: parseInt(r.winning),
      losing: parseInt(r.losing),
      win_rate: (parseInt(r.winning) + parseInt(r.losing)) > 0
        ? (parseInt(r.winning) / (parseInt(r.winning) + parseInt(r.losing))) * 100 : 0,
      pnl: Number(r.pnl),
    }));
  }

  private async getRecentSignals(mentorProfileId: string, limit = 10): Promise<RecentSignal[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT
        ms.id, ms.symbol, ms.direction, ms.entry_price, ms.stop_loss, ms.tp1,
        ms.status, ms.published_at,
        COUNT(ct.id) as total_copies,
        COALESCE(SUM(ct.profit) FILTER (WHERE ct.status = 'closed'), 0) as pnl
       FROM mentor_signals ms
       LEFT JOIN copied_trades ct ON ct.mentor_signal_id = ms.id
       WHERE ms.mentor_profile_id = $1
       GROUP BY ms.id
       ORDER BY ms.published_at DESC
       LIMIT $2`,
      [mentorProfileId, limit]
    );

    return result.rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      direction: r.direction,
      entry_price: Number(r.entry_price),
      stop_loss: Number(r.stop_loss),
      tp1: r.tp1 ? Number(r.tp1) : null,
      status: r.status,
      published_at: r.published_at,
      total_copies: parseInt(r.total_copies),
      pnl: Number(r.pnl),
    }));
  }

  private async getSubscriberCounts(mentorProfileId: string) {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'active') as active_subscribers
       FROM follower_subscriptions WHERE mentor_profile_id = $1`,
      [mentorProfileId]
    );
    return { active_subscribers: parseInt(result.rows[0].active_subscribers) };
  }

  /**
   * Compute risk label based on actual trading behavior.
   * Rule-based, transparent, no AI.
   */
  private computeRiskLabel(
    perf: { win_rate: number; avg_hold_time_hours: number; profit_factor: number; losing_trades: number; winning_trades: number },
    dd: { max_drawdown_pct: number },
    overview: { total_signals: number }
  ): { label: 'low' | 'moderate' | 'high'; score: number } {
    let score = 50; // Start neutral

    // Win rate impact
    if (perf.win_rate >= 60) score -= 10;
    else if (perf.win_rate < 40) score += 15;

    // Profit factor impact
    if (perf.profit_factor >= 2) score -= 15;
    else if (perf.profit_factor < 1) score += 20;

    // Drawdown impact
    if (dd.max_drawdown_pct > 500) score += 20;
    else if (dd.max_drawdown_pct > 200) score += 10;
    else if (dd.max_drawdown_pct < 50) score -= 10;

    // Trade frequency (more signals = more data = slightly lower risk)
    if (overview.total_signals >= 20) score -= 5;
    else if (overview.total_signals < 5) score += 10; // Too few to trust

    // Average hold time (very short = scalper = higher risk)
    if (perf.avg_hold_time_hours < 0.5) score += 10;

    // Clamp
    score = Math.max(0, Math.min(100, score));

    let label: 'low' | 'moderate' | 'high';
    if (score <= 35) label = 'low';
    else if (score <= 65) label = 'moderate';
    else label = 'high';

    return { label, score };
  }
}
