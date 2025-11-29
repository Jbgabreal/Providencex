import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';

const logger = new Logger('TradeHistoryRepository');

export interface ExecutedTrade {
  id: string;
  user_id: string;
  mt5_account_id: string;
  strategy_profile_id: string;
  assignment_id: string | null;
  mt5_ticket: number;
  mt5_order_id: number | null;
  symbol: string;
  direction: 'BUY' | 'SELL';
  lot_size: number;
  entry_price: number;
  stop_loss_price: number | null;
  take_profit_price: number | null;
  exit_price: number | null;
  closed_at: string | null;
  profit: number | null;
  commission: number | null;
  swap: number | null;
  opened_at: string;
  entry_reason: string | null;
  exit_reason: string | null;
  metadata: Record<string, any>;
}

export interface DailyAccountMetric {
  id: string;
  date: string;
  user_id: string;
  mt5_account_id: string;
  strategy_profile_id: string;
  assignment_id: string | null;
  balance_start: number;
  balance_end: number;
  equity_start: number;
  equity_end: number;
  realized_pnl: number;
  unrealized_pnl: number;
  total_pnl: number;
  trades_opened: number;
  trades_closed: number;
  trades_won: number;
  trades_lost: number;
  max_drawdown: number;
  max_drawdown_percent: number;
  win_rate: number | null;
  profit_factor: number | null;
  average_win: number | null;
  average_loss: number | null;
  largest_win: number | null;
  largest_loss: number | null;
  average_r: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * TradeHistoryRepository
 *
 * Manages trade history and daily metrics persistence
 */
export class TradeHistoryRepository {
  private pool: Pool | null = null;

  constructor(databaseUrl?: string) {
    const config = getConfig();
    const url = databaseUrl || config.databaseUrl;

    if (!url) {
      logger.warn('[TradeHistoryRepository] No databaseUrl configured, repository is disabled');
      return;
    }

    this.pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    });

    this.pool.on('error', (err) => {
      logger.error('[TradeHistoryRepository] Database pool error (non-fatal):', err);
    });
  }

  private ensurePool(): Pool {
    if (!this.pool) {
      throw new Error('[TradeHistoryRepository] Database pool not initialized');
    }
    return this.pool;
  }

  /**
   * Record a trade when it opens
   */
  async recordTradeOpened(params: {
    userId: string;
    mt5AccountId: string;
    strategyProfileId: string;
    assignmentId?: string;
    mt5Ticket: number;
    mt5OrderId?: number;
    symbol: string;
    direction: 'BUY' | 'SELL';
    lotSize: number;
    entryPrice: number;
    stopLossPrice?: number;
    takeProfitPrice?: number;
    entryReason?: string;
    metadata?: Record<string, any>;
  }): Promise<ExecutedTrade> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO executed_trades (
         user_id, mt5_account_id, strategy_profile_id, assignment_id,
         mt5_ticket, mt5_order_id, symbol, direction, lot_size,
         entry_price, stop_loss_price, take_profit_price,
         entry_reason, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        params.userId,
        params.mt5AccountId,
        params.strategyProfileId,
        params.assignmentId || null,
        params.mt5Ticket,
        params.mt5OrderId || null,
        params.symbol,
        params.direction,
        params.lotSize,
        params.entryPrice,
        params.stopLossPrice || null,
        params.takeProfitPrice || null,
        params.entryReason || null,
        JSON.stringify(params.metadata || {}),
      ]
    );
    return result.rows[0];
  }

  /**
   * Update a trade when it closes
   */
  async recordTradeClosed(params: {
    mt5Ticket: number;
    exitPrice: number;
    profit: number;
    commission?: number;
    swap?: number;
    exitReason?: string;
  }): Promise<ExecutedTrade | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `UPDATE executed_trades
       SET exit_price = $2,
           closed_at = NOW(),
           profit = $3,
           commission = COALESCE($4, commission),
           swap = COALESCE($5, swap),
           exit_reason = COALESCE($6, exit_reason),
           updated_at = NOW()
       WHERE mt5_ticket = $1 AND closed_at IS NULL
       RETURNING *`,
      [
        params.mt5Ticket,
        params.exitPrice,
        params.profit,
        params.commission || null,
        params.swap || null,
        params.exitReason || null,
      ]
    );
    return result.rows[0] || null;
  }

  /**
   * Get trades for a user (with optional filters)
   */
  async getTradesForUser(params: {
    userId: string;
    mt5AccountId?: string;
    strategyProfileId?: string;
    limit?: number;
    offset?: number;
    includeOpen?: boolean;
  }): Promise<{ trades: ExecutedTrade[]; total: number }> {
    const pool = this.ensurePool();
    const conditions: string[] = ['user_id = $1'];
    const paramsList: any[] = [params.userId];
    let paramIndex = 2;

    if (params.mt5AccountId) {
      conditions.push(`mt5_account_id = $${paramIndex++}`);
      paramsList.push(params.mt5AccountId);
    }

    if (params.strategyProfileId) {
      conditions.push(`strategy_profile_id = $${paramIndex++}`);
      paramsList.push(params.strategyProfileId);
    }

    if (params.includeOpen === false) {
      conditions.push('closed_at IS NOT NULL');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = params.limit || 100;
    const offset = params.offset || 0;

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM executed_trades ${whereClause}`,
      paramsList
    );
    const total = parseInt(countResult.rows[0]?.total || '0', 10);

    // Get trades
    paramsList.push(limit, offset);
    const result = await pool.query(
      `SELECT * FROM executed_trades
       ${whereClause}
       ORDER BY opened_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      paramsList
    );

    return { trades: result.rows, total };
  }

  /**
   * Get open positions for a user
   */
  async getOpenPositions(params: {
    userId: string;
    mt5AccountId?: string;
    strategyProfileId?: string;
  }): Promise<ExecutedTrade[]> {
    const pool = this.ensurePool();
    const conditions: string[] = ['user_id = $1', 'closed_at IS NULL'];
    const paramsList: any[] = [params.userId];
    let paramIndex = 2;

    if (params.mt5AccountId) {
      conditions.push(`mt5_account_id = $${paramIndex++}`);
      paramsList.push(params.mt5AccountId);
    }

    if (params.strategyProfileId) {
      conditions.push(`strategy_profile_id = $${paramIndex++}`);
      paramsList.push(params.strategyProfileId);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const result = await pool.query(
      `SELECT * FROM executed_trades
       ${whereClause}
       ORDER BY opened_at DESC`,
      paramsList
    );

    return result.rows;
  }

  /**
   * Upsert daily metrics (called by AnalyticsService after computing)
   */
  async upsertDailyMetric(metric: {
    date: string; // YYYY-MM-DD
    userId: string;
    mt5AccountId: string;
    strategyProfileId: string;
    assignmentId?: string;
    balanceStart: number;
    balanceEnd: number;
    equityStart: number;
    equityEnd: number;
    realizedPnL: number;
    unrealizedPnL: number;
    totalPnL: number;
    tradesOpened: number;
    tradesClosed: number;
    tradesWon: number;
    tradesLost: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    winRate?: number;
    profitFactor?: number;
    averageWin?: number;
    averageLoss?: number;
    largestWin?: number;
    largestLoss?: number;
    averageR?: number;
  }): Promise<DailyAccountMetric> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO daily_account_metrics (
         date, user_id, mt5_account_id, strategy_profile_id, assignment_id,
         balance_start, balance_end, equity_start, equity_end,
         realized_pnl, unrealized_pnl, total_pnl,
         trades_opened, trades_closed, trades_won, trades_lost,
         max_drawdown, max_drawdown_percent,
         win_rate, profit_factor, average_win, average_loss,
         largest_win, largest_loss, average_r
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)
       ON CONFLICT (date, mt5_account_id, strategy_profile_id)
       DO UPDATE SET
         balance_end = EXCLUDED.balance_end,
         equity_end = EXCLUDED.equity_end,
         realized_pnl = EXCLUDED.realized_pnl,
         unrealized_pnl = EXCLUDED.unrealized_pnl,
         total_pnl = EXCLUDED.total_pnl,
         trades_opened = EXCLUDED.trades_opened,
         trades_closed = EXCLUDED.trades_closed,
         trades_won = EXCLUDED.trades_won,
         trades_lost = EXCLUDED.trades_lost,
         max_drawdown = EXCLUDED.max_drawdown,
         max_drawdown_percent = EXCLUDED.max_drawdown_percent,
         win_rate = EXCLUDED.win_rate,
         profit_factor = EXCLUDED.profit_factor,
         average_win = EXCLUDED.average_win,
         average_loss = EXCLUDED.average_loss,
         largest_win = EXCLUDED.largest_win,
         largest_loss = EXCLUDED.largest_loss,
         average_r = EXCLUDED.average_r,
         updated_at = NOW()
       RETURNING *`,
      [
        metric.date,
        metric.userId,
        metric.mt5AccountId,
        metric.strategyProfileId,
        metric.assignmentId || null,
        metric.balanceStart,
        metric.balanceEnd,
        metric.equityStart,
        metric.equityEnd,
        metric.realizedPnL,
        metric.unrealizedPnL,
        metric.totalPnL,
        metric.tradesOpened,
        metric.tradesClosed,
        metric.tradesWon,
        metric.tradesLost,
        metric.maxDrawdown,
        metric.maxDrawdownPercent,
        metric.winRate || null,
        metric.profitFactor || null,
        metric.averageWin || null,
        metric.averageLoss || null,
        metric.largestWin || null,
        metric.largestLoss || null,
        metric.averageR || null,
      ]
    );
    return result.rows[0];
  }

  /**
   * Get daily metrics for a user (with optional filters)
   */
  async getDailyMetrics(params: {
    userId: string;
    mt5AccountId?: string;
    strategyProfileId?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
  }): Promise<DailyAccountMetric[]> {
    const pool = this.ensurePool();
    const conditions: string[] = ['user_id = $1'];
    const paramsList: any[] = [params.userId];
    let paramIndex = 2;

    if (params.mt5AccountId) {
      conditions.push(`mt5_account_id = $${paramIndex++}`);
      paramsList.push(params.mt5AccountId);
    }

    if (params.strategyProfileId) {
      conditions.push(`strategy_profile_id = $${paramIndex++}`);
      paramsList.push(params.strategyProfileId);
    }

    if (params.fromDate) {
      conditions.push(`date >= $${paramIndex++}`);
      paramsList.push(params.fromDate);
    }

    if (params.toDate) {
      conditions.push(`date <= $${paramIndex++}`);
      paramsList.push(params.toDate);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const limit = params.limit || 365; // Default to 1 year

    paramsList.push(limit);
    const result = await pool.query(
      `SELECT * FROM daily_account_metrics
       ${whereClause}
       ORDER BY date DESC
       LIMIT $${paramIndex++}`,
      paramsList
    );

    return result.rows;
  }
}

