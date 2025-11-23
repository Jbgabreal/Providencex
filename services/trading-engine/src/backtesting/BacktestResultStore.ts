/**
 * BacktestResultStore - Stores backtest results in Postgres
 * 
 * Creates and manages tables:
 * - backtest_runs
 * - backtest_trades
 * - backtest_equity
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { BacktestResult, BacktestTrade, EquityPoint } from './types';

const logger = new Logger('BacktestStore');

/**
 * BacktestResultStore - Manages backtest result storage in Postgres
 */
export class BacktestResultStore {
  private pool: Pool | null = null;

  constructor(databaseUrl?: string) {
    if (databaseUrl) {
      try {
        this.pool = new Pool({
          connectionString: databaseUrl,
          ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        });
        
        // Handle pool errors gracefully (prevent app crash)
        this.pool.on('error', (err) => {
          logger.error('[BacktestStore] Database pool error (non-fatal):', err);
          // Don't crash the app - just log the error
        });
        
        logger.info('[BacktestStore] Connected to Postgres for backtest results');
      } catch (error) {
        logger.error('[BacktestStore] Failed to connect to Postgres', error);
      }
    } else {
      logger.warn('[BacktestStore] No DATABASE_URL provided - results will not be stored in DB');
    }
  }

  /**
   * Initialize database tables (create if not exist)
   */
  async initializeTables(): Promise<void> {
    if (!this.pool) {
      logger.warn('[BacktestStore] No database connection - skipping table creation');
      return;
    }

    try {
      // Create backtest_runs table
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS backtest_runs (
          id SERIAL PRIMARY KEY,
          run_id VARCHAR(255) UNIQUE NOT NULL,
          config_json JSONB NOT NULL,
          start_time TIMESTAMP NOT NULL,
          end_time TIMESTAMP NOT NULL,
          runtime_ms INTEGER NOT NULL,
          stats_json JSONB NOT NULL,
          initial_balance NUMERIC(12, 2) NOT NULL,
          final_balance NUMERIC(12, 2) NOT NULL,
          total_return NUMERIC(12, 2) NOT NULL,
          total_return_percent NUMERIC(8, 4) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create backtest_trades table
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS backtest_trades (
          id SERIAL PRIMARY KEY,
          run_id VARCHAR(255) NOT NULL REFERENCES backtest_runs(run_id) ON DELETE CASCADE,
          ticket INTEGER NOT NULL,
          symbol VARCHAR(20) NOT NULL,
          direction VARCHAR(4) NOT NULL,
          strategy VARCHAR(10) NOT NULL,
          entry_price NUMERIC(12, 5) NOT NULL,
          exit_price NUMERIC(12, 5) NOT NULL,
          entry_time TIMESTAMP NOT NULL,
          exit_time TIMESTAMP NOT NULL,
          sl NUMERIC(12, 5),
          tp NUMERIC(12, 5),
          volume NUMERIC(8, 2) NOT NULL,
          profit NUMERIC(12, 2) NOT NULL,
          duration_minutes INTEGER NOT NULL,
          pips NUMERIC(10, 2),
          risk_reward NUMERIC(8, 4),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create index on run_id for faster queries
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_backtest_trades_run_id ON backtest_trades(run_id)
      `);

      // Create backtest_equity table
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS backtest_equity (
          id SERIAL PRIMARY KEY,
          run_id VARCHAR(255) NOT NULL REFERENCES backtest_runs(run_id) ON DELETE CASCADE,
          timestamp TIMESTAMP NOT NULL,
          balance NUMERIC(12, 2) NOT NULL,
          equity NUMERIC(12, 2) NOT NULL,
          drawdown NUMERIC(12, 2) NOT NULL,
          drawdown_percent NUMERIC(8, 4) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create index on run_id for faster queries
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_backtest_equity_run_id ON backtest_equity(run_id)
      `);

      logger.info('[BacktestStore] Database tables initialized');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[BacktestStore] Failed to initialize tables: ${errorMsg}`, error);
      throw error;
    }
  }

  /**
   * Save backtest result to database
   */
  async saveResult(result: BacktestResult): Promise<void> {
    if (!this.pool) {
      logger.warn('[BacktestStore] No database connection - skipping DB save');
      return;
    }

    try {
      // Initialize tables if needed
      await this.initializeTables();

      // Insert backtest run
      await this.pool.query(
        `INSERT INTO backtest_runs (
          run_id, config_json, start_time, end_time, runtime_ms, stats_json,
          initial_balance, final_balance, total_return, total_return_percent
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (run_id) DO UPDATE SET
          config_json = EXCLUDED.config_json,
          stats_json = EXCLUDED.stats_json,
          final_balance = EXCLUDED.final_balance,
          total_return = EXCLUDED.total_return,
          total_return_percent = EXCLUDED.total_return_percent`,
        [
          result.runId,
          JSON.stringify(result.config),
          new Date(result.startTime).toISOString(),
          new Date(result.endTime).toISOString(),
          result.runtimeMs,
          JSON.stringify(result.stats),
          result.initialBalance,
          result.finalBalance,
          result.totalReturn,
          result.totalReturnPercent,
        ]
      );

      // Insert trades (batch insert for efficiency)
      if (result.trades.length > 0) {
        const values: any[] = [];
        const placeholders: string[] = [];
        let paramIndex = 1;

        for (const trade of result.trades) {
          placeholders.push(
            `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, ` +
            `$${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, ` +
            `$${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
          );
          values.push(
            result.runId,
            trade.ticket,
            trade.symbol,
            trade.direction,
            trade.strategy,
            trade.entryPrice,
            trade.exitPrice,
            new Date(trade.entryTime).toISOString(),
            new Date(trade.exitTime).toISOString(),
            trade.sl,
            trade.tp,
            trade.volume,
            trade.profit,
            trade.durationMinutes,
            trade.pips,
            trade.riskReward,
          );
        }

        await this.pool.query(
          `INSERT INTO backtest_trades (
            run_id, ticket, symbol, direction, strategy, entry_price, exit_price,
            entry_time, exit_time, sl, tp, volume, profit, duration_minutes, pips, risk_reward
          ) VALUES ${placeholders.join(', ')}`,
          values
        );
      }

      // Insert equity curve (sample every Nth point to avoid too much data)
      if (result.equityCurve.length > 0) {
        const sampleRate = Math.max(1, Math.floor(result.equityCurve.length / 1000)); // Max 1000 points
        const sampledEquity = result.equityCurve.filter((_, index) => index % sampleRate === 0 || index === result.equityCurve.length - 1);

        const values: any[] = [];
        const placeholders: string[] = [];
        let paramIndex = 1;

        for (const point of sampledEquity) {
          placeholders.push(
            `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
          );
          values.push(
            result.runId,
            new Date(point.timestamp).toISOString(),
            point.balance,
            point.equity,
            point.drawdown,
            point.drawdownPercent,
          );
        }

        await this.pool.query(
          `INSERT INTO backtest_equity (run_id, timestamp, balance, equity, drawdown, drawdown_percent)
           VALUES ${placeholders.join(', ')}`,
          values
        );
      }

      logger.info(`[BacktestStore] Saved backtest result ${result.runId} to database`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[BacktestStore] Failed to save result: ${errorMsg}`, error);
      // Don't throw - backtest results are still saved to disk
    }
  }

  /**
   * Get backtest run by run_id
   */
  async getRun(runId: string): Promise<any | null> {
    if (!this.pool) {
      return null;
    }

    try {
      const result = await this.pool.query(
        'SELECT * FROM backtest_runs WHERE run_id = $1',
        [runId]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error(`[BacktestStore] Failed to get run: ${error}`, error);
      return null;
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('[BacktestStore] Database connection closed');
    }
  }
}


