/**
 * Trade Journal Repository
 *
 * Database access for the trade_journal table.
 * Follows TradeHistoryRepository pattern.
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { TradeJournalEntry, JournalFilters, JournalSummary, StrategyStats } from './types';

const logger = new Logger('TradeJournalRepo');

export class TradeJournalRepository {
  private pool: Pool;

  constructor(databaseUrl?: string) {
    const url = databaseUrl || process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL required for TradeJournalRepository');
    this.pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    });
    this.pool.on('error', (err) => {
      logger.error('Pool error (non-fatal):', err);
    });
  }

  async initialize(): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');

    // Try multiple paths: compiled dist vs source src (Docker vs local dev)
    const migrationDirs = [
      path.resolve(__dirname, '../db/migrations'),          // From dist/journal/ → dist/db/migrations
      path.resolve(process.cwd(), 'src/db/migrations'),     // From cwd (services/trading-engine)
      path.resolve(process.cwd(), 'services/trading-engine/src/db/migrations'), // From repo root
    ];

    const findMigration = (filename: string): string | null => {
      for (const dir of migrationDirs) {
        const fullPath = path.join(dir, filename);
        if (fs.existsSync(fullPath)) return fullPath;
      }
      return null;
    };

    // Run trade journal migration
    const v32Path = findMigration('v32_trade_journal.sql');
    if (v32Path) {
      await this.pool.query(fs.readFileSync(v32Path, 'utf-8'));
      logger.info('trade_journal table ensured');
    } else {
      logger.warn('v32_trade_journal.sql not found — tried: ' + migrationDirs.join(', '));
    }

    // Seed Silver Bullet profile
    const v33Path = findMigration('v33_silver_bullet_profile.sql');
    if (v33Path) {
      await this.pool.query(fs.readFileSync(v33Path, 'utf-8'));
      logger.info('Silver Bullet profile ensured');
    } else {
      logger.warn('v33_silver_bullet_profile.sql not found — tried: ' + migrationDirs.join(', '));
    }
  }

  async createEntry(entry: TradeJournalEntry): Promise<string> {
    const result = await this.pool.query(
      `INSERT INTO trade_journal (
        strategy_key, strategy_version, strategy_profile_key,
        symbol, direction, entry_price, stop_loss, take_profit,
        lot_size, risk_percent, rr_target,
        status, opened_at,
        setup_context, entry_context, exit_context
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING id`,
      [
        entry.strategyKey, entry.strategyVersion || null, entry.strategyProfileKey || null,
        entry.symbol, entry.direction, entry.entryPrice || null, entry.stopLoss || null, entry.takeProfit || null,
        entry.lotSize || null, entry.riskPercent || null, entry.rrTarget || null,
        entry.status, entry.openedAt || null,
        JSON.stringify(entry.setupContext || {}),
        JSON.stringify(entry.entryContext || {}),
        JSON.stringify(entry.exitContext || {}),
      ]
    );
    return result.rows[0].id;
  }

  async updateOnOpen(journalId: string, data: {
    executedTradeId?: string;
    tradeDecisionId?: number;
    lotSize?: number;
    entryPrice?: number;
    openedAt?: Date;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE trade_journal SET
        status = 'open',
        executed_trade_id = COALESCE($2, executed_trade_id),
        trade_decision_id = COALESCE($3, trade_decision_id),
        lot_size = COALESCE($4, lot_size),
        entry_price = COALESCE($5, entry_price),
        opened_at = COALESCE($6, opened_at, NOW()),
        updated_at = NOW()
      WHERE id = $1`,
      [journalId, data.executedTradeId || null, data.tradeDecisionId || null,
       data.lotSize || null, data.entryPrice || null, data.openedAt || null]
    );
  }

  async updateOnClose(journalId: string, data: {
    exitPrice: number;
    profit: number;
    rMultiple?: number;
    result: 'win' | 'loss' | 'breakeven';
    closeReason: string;
    exitContext?: Record<string, any>;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE trade_journal SET
        status = 'closed',
        exit_price = $2,
        profit = $3,
        r_multiple = $4,
        result = $5,
        close_reason = $6,
        exit_context = COALESCE($7, exit_context),
        closed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1`,
      [journalId, data.exitPrice, data.profit, data.rMultiple || null,
       data.result, data.closeReason, data.exitContext ? JSON.stringify(data.exitContext) : null]
    );
  }

  async cancel(journalId: string, reason: string): Promise<void> {
    await this.pool.query(
      `UPDATE trade_journal SET status = 'cancelled', close_reason = $2, updated_at = NOW() WHERE id = $1`,
      [journalId, reason]
    );
  }

  async getById(id: string): Promise<TradeJournalEntry | null> {
    const result = await this.pool.query('SELECT * FROM trade_journal WHERE id = $1', [id]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async list(filters: JournalFilters): Promise<{ entries: TradeJournalEntry[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (filters.strategyKey) { conditions.push(`strategy_key = $${idx++}`); params.push(filters.strategyKey); }
    if (filters.symbol) { conditions.push(`symbol = $${idx++}`); params.push(filters.symbol); }
    if (filters.direction) { conditions.push(`direction = $${idx++}`); params.push(filters.direction); }
    if (filters.status) { conditions.push(`status = $${idx++}`); params.push(filters.status); }
    if (filters.result) { conditions.push(`result = $${idx++}`); params.push(filters.result); }
    if (filters.dateFrom) { conditions.push(`created_at >= $${idx++}`); params.push(filters.dateFrom); }
    if (filters.dateTo) { conditions.push(`created_at <= $${idx++}`); params.push(filters.dateTo); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(filters.limit || 50, 500);
    const offset = filters.offset || 0;

    const [dataResult, countResult] = await Promise.all([
      this.pool.query(
        `SELECT * FROM trade_journal ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
      this.pool.query(`SELECT COUNT(*) FROM trade_journal ${where}`, params),
    ]);

    return {
      entries: dataResult.rows.map(this.mapRow),
      total: parseInt(countResult.rows[0].count, 10),
    };
  }

  async getSummary(filters?: JournalFilters): Promise<JournalSummary> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (filters?.symbol) { conditions.push(`symbol = $${idx++}`); params.push(filters.symbol); }
    if (filters?.dateFrom) { conditions.push(`created_at >= $${idx++}`); params.push(filters.dateFrom); }
    if (filters?.dateTo) { conditions.push(`created_at <= $${idx++}`); params.push(filters.dateTo); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await this.pool.query(`
      SELECT
        strategy_key,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'open') as open_count,
        COUNT(*) FILTER (WHERE status = 'closed') as closed_count,
        COUNT(*) FILTER (WHERE result = 'win') as wins,
        COUNT(*) FILTER (WHERE result = 'loss') as losses,
        COALESCE(AVG(r_multiple) FILTER (WHERE status = 'closed'), 0) as avg_r,
        COALESCE(SUM(profit) FILTER (WHERE status = 'closed'), 0) as total_profit,
        COALESCE(AVG(profit) FILTER (WHERE status = 'closed'), 0) as avg_profit,
        COALESCE(MAX(profit) FILTER (WHERE status = 'closed'), 0) as best_trade,
        COALESCE(MIN(profit) FILTER (WHERE status = 'closed'), 0) as worst_trade
      FROM trade_journal ${where}
      GROUP BY strategy_key
    `, params);

    const byStrategy: Record<string, StrategyStats> = {};
    let totalSignals = 0, totalTrades = 0, totalOpen = 0, totalClosed = 0;
    let totalWins = 0, totalLosses = 0, totalProfit = 0, rSum = 0, rCount = 0;

    for (const row of result.rows) {
      const closed = parseInt(row.closed_count);
      const wins = parseInt(row.wins);
      const losses = parseInt(row.losses);
      byStrategy[row.strategy_key] = {
        strategyKey: row.strategy_key,
        totalSignals: parseInt(row.total),
        totalTrades: closed,
        wins, losses,
        winRate: closed > 0 ? Math.round((wins / closed) * 10000) / 100 : 0,
        avgRMultiple: Math.round(parseFloat(row.avg_r) * 100) / 100,
        totalProfit: Math.round(parseFloat(row.total_profit) * 100) / 100,
        avgProfit: Math.round(parseFloat(row.avg_profit) * 100) / 100,
        bestTrade: parseFloat(row.best_trade),
        worstTrade: parseFloat(row.worst_trade),
      };
      totalSignals += parseInt(row.total);
      totalOpen += parseInt(row.open_count);
      totalClosed += closed;
      totalTrades += closed;
      totalWins += wins;
      totalLosses += losses;
      totalProfit += parseFloat(row.total_profit);
      if (closed > 0) { rSum += parseFloat(row.avg_r) * closed; rCount += closed; }
    }

    return {
      totalSignals, totalTrades, openTrades: totalOpen, closedTrades: totalClosed,
      wins: totalWins, losses: totalLosses,
      winRate: totalClosed > 0 ? Math.round((totalWins / totalClosed) * 10000) / 100 : 0,
      avgRMultiple: rCount > 0 ? Math.round((rSum / rCount) * 100) / 100 : 0,
      totalProfit: Math.round(totalProfit * 100) / 100,
      byStrategy,
    };
  }

  async getStrategyBreakdown(strategyKey: string): Promise<StrategyStats | null> {
    const summary = await this.getSummary({ strategyKey } as any);
    return summary.byStrategy[strategyKey] || null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private mapRow(row: any): TradeJournalEntry {
    return {
      id: row.id,
      tradeDecisionId: row.trade_decision_id,
      executedTradeId: row.executed_trade_id,
      strategyKey: row.strategy_key,
      strategyVersion: row.strategy_version,
      strategyProfileKey: row.strategy_profile_key,
      symbol: row.symbol,
      direction: row.direction,
      entryPrice: row.entry_price ? parseFloat(row.entry_price) : undefined,
      stopLoss: row.stop_loss ? parseFloat(row.stop_loss) : undefined,
      takeProfit: row.take_profit ? parseFloat(row.take_profit) : undefined,
      lotSize: row.lot_size ? parseFloat(row.lot_size) : undefined,
      riskPercent: row.risk_percent ? parseFloat(row.risk_percent) : undefined,
      rrTarget: row.rr_target ? parseFloat(row.rr_target) : undefined,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      exitPrice: row.exit_price ? parseFloat(row.exit_price) : undefined,
      profit: row.profit ? parseFloat(row.profit) : undefined,
      rMultiple: row.r_multiple ? parseFloat(row.r_multiple) : undefined,
      result: row.result,
      closeReason: row.close_reason,
      setupContext: row.setup_context || {},
      entryContext: row.entry_context || {},
      exitContext: row.exit_context || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
