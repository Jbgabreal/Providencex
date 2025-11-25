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
   * Note: This operation has a timeout to prevent hanging
   */
  async saveResult(result: BacktestResult): Promise<void> {
    if (!this.pool) {
      logger.warn('[BacktestStore] No database connection - skipping DB save');
      return;
    }

    // Add overall timeout to prevent hanging (10 seconds max)
    const overallTimeout = 10000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Database save operation timed out after ${overallTimeout / 1000} seconds`));
      }, overallTimeout);
    });

    // Define columns outside try block for error handling
    const insertColumns = [
      'run_id',
      'config_json',
      'start_time',
      'end_time',
      'runtime_ms',
      'stats_json',
      'initial_balance',
      'final_balance',
      'total_return',
      'total_return_percent'
    ];

    try {
      // Wrap the entire save operation in a timeout race
      await Promise.race([
        (async () => {
          // Initialize tables if needed
          await this.initializeTables();

      // Insert backtest run - explicitly list columns to avoid schema mismatch
      // Only insert columns that exist in our schema (id and created_at are auto-generated)
      // Validate all values are defined before inserting
      const insertValues = [
        result.runId || '',
        JSON.stringify(result.config || {}),
        new Date(result.startTime).toISOString(),
        new Date(result.endTime).toISOString(),
        result.runtimeMs || 0,
        JSON.stringify(result.stats || {}),
        result.initialBalance ?? 0,
        result.finalBalance ?? 0,
        result.totalReturn ?? 0,
        result.totalReturnPercent ?? 0,
      ];

      // Validate that we have the correct number of values
      if (insertValues.length !== insertColumns.length) {
        throw new Error(`Value count mismatch: ${insertValues.length} values for ${insertColumns.length} columns`);
      }

      // Validate no undefined values (null is OK for nullable columns, but undefined is not)
      const undefinedIndices = insertValues.map((v, i) => v === undefined ? i : -1).filter(i => i !== -1);
      if (undefinedIndices.length > 0) {
        throw new Error(`Undefined values at indices: ${undefinedIndices.join(', ')}. Columns: ${undefinedIndices.map(i => insertColumns[i]).join(', ')}`);
      }
      
      // Ensure all values are actually defined (double-check)
      for (let i = 0; i < insertValues.length; i++) {
        if (insertValues[i] === undefined) {
          logger.error(`[BacktestStore] Value at index ${i} (column: ${insertColumns[i]}) is undefined`);
          insertValues[i] = null as any; // Convert undefined to null for nullable columns (pg accepts null)
        }
      }

      // Build parameterized query with explicit column list
      // Ensure we have exactly the right number of placeholders
      const placeholders = insertColumns.map((_, i) => `$${i + 1}`).join(', ');
      const columnsList = insertColumns.join(', ');
      
      // Final validation: ensure placeholders match values count
      const placeholderCount = (placeholders.match(/\$/g) || []).length;
      if (placeholderCount !== insertValues.length) {
        throw new Error(`Placeholder count mismatch: ${placeholderCount} placeholders for ${insertValues.length} values`);
      }
      if (insertColumns.length !== insertValues.length) {
        throw new Error(`Column count mismatch: ${insertColumns.length} columns for ${insertValues.length} values`);
      }
      
      // Construct the SQL query as a single line to avoid any parsing issues
      const insertQuery = `INSERT INTO backtest_runs (${columnsList}) VALUES (${placeholders}) ON CONFLICT (run_id) DO UPDATE SET config_json = EXCLUDED.config_json, stats_json = EXCLUDED.stats_json, final_balance = EXCLUDED.final_balance, total_return = EXCLUDED.total_return, total_return_percent = EXCLUDED.total_return_percent`;
      
      // Always log for debugging (since this is a persistent issue)
      logger.info(`[BacktestStore] Inserting ${insertValues.length} values into ${insertColumns.length} columns`);
      logger.info(`[BacktestStore] Placeholder count: ${placeholderCount}, Value count: ${insertValues.length}`);
      logger.info(`[BacktestStore] Columns: ${columnsList}`);
      logger.info(`[BacktestStore] Placeholders: ${placeholders}`);
      logger.info(`[BacktestStore] Values: ${insertValues.map((v, i) => `${insertColumns[i]}=${v === null ? 'null' : v === undefined ? 'undefined' : typeof v === 'string' ? v.substring(0, 50) : v}`).join(', ')}`);
      
      // Execute the query
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }
      let queryResult;
      try {
        queryResult = await this.pool.query(insertQuery, insertValues);
        
        if (process.env.NODE_ENV === 'development' || process.env.SMC_DEBUG === 'true') {
          logger.info(`[BacktestStore] Query executed successfully, rows affected: ${queryResult.rowCount}`);
        }
      } catch (queryError) {
        const queryErrorMsg = queryError instanceof Error ? queryError.message : String(queryError);
        logger.error(`[BacktestStore] Failed to insert backtest run: ${queryErrorMsg}`);
        throw queryError; // Re-throw to be caught by outer try-catch
      }

      // Insert trades (batch insert for efficiency) - wrapped in try-catch to not block on errors
      if (result.trades.length > 0) {
        try {
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

          if (!this.pool) {
            logger.warn('[BacktestStore] Database pool not initialized - skipping trades insert');
            return;
          }
          await this.pool.query(
            `INSERT INTO backtest_trades (
              run_id, ticket, symbol, direction, strategy, entry_price, exit_price,
              entry_time, exit_time, sl, tp, volume, profit, duration_minutes, pips, risk_reward
            ) VALUES ${placeholders.join(', ')}`,
            values
          );
          logger.info(`[BacktestStore] Inserted ${result.trades.length} trades`);
        } catch (tradesError) {
          logger.warn(`[BacktestStore] Failed to insert trades (non-critical): ${tradesError instanceof Error ? tradesError.message : String(tradesError)}`);
          // Continue - trades insertion failure is non-critical
        }
      }

      // Insert equity curve (sample every Nth point to avoid too much data) - wrapped in try-catch
      if (result.equityCurve.length > 0) {
        try {
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

          if (!this.pool) {
            logger.warn('[BacktestStore] Database pool not initialized - skipping equity curve insert');
            return;
          }
          await this.pool.query(
            `INSERT INTO backtest_equity (run_id, timestamp, balance, equity, drawdown, drawdown_percent)
             VALUES ${placeholders.join(', ')}`,
            values
          );
          logger.info(`[BacktestStore] Inserted ${sampledEquity.length} equity curve points`);
        } catch (equityError) {
          logger.warn(`[BacktestStore] Failed to insert equity curve (non-critical): ${equityError instanceof Error ? equityError.message : String(equityError)}`);
          // Continue - equity curve insertion failure is non-critical
        }
      }

          logger.info(`[BacktestStore] Saved backtest result ${result.runId} to database`);
        })(),
        timeoutPromise
      ]);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // Provide more detailed error information for schema mismatches
      if (errorMsg.includes('more target columns than expressions') || errorMsg.includes('42601') || errorMsg.includes('timed out')) {
        if (errorMsg.includes('timed out')) {
          logger.warn(`[BacktestStore] Database save timed out - this is non-critical, results are saved to disk`);
        } else {
          logger.error(`[BacktestStore] Schema mismatch detected. The database table may have different columns than expected.`);
          logger.error(`[BacktestStore] Attempted to insert into columns: ${insertColumns.join(', ')}`);
          logger.error(`[BacktestStore] Error: ${errorMsg}`);
          logger.warn(`[BacktestStore] Backtest results are still saved to disk, but not to database.`);
          
          // Try to get table schema for debugging (with timeout)
          try {
            const schemaPromise = this.pool?.query(`
              SELECT column_name, data_type 
              FROM information_schema.columns 
              WHERE table_name = 'backtest_runs' 
              ORDER BY ordinal_position
            `);
            if (schemaPromise) {
              const schemaResult = await Promise.race([
                schemaPromise,
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Schema check timeout')), 2000))
              ]);
              if (schemaResult && schemaResult.rows.length > 0) {
                logger.info(`[BacktestStore] Actual table columns: ${schemaResult.rows.map((r: any) => r.column_name).join(', ')}`);
              }
            }
          } catch (schemaError) {
            // Ignore schema check errors
          }
        }
      } else {
        logger.error(`[BacktestStore] Failed to save result: ${errorMsg}`, error);
      }
      
      // Don't throw - backtest results are still saved to disk
      // This ensures the optimizer continues even if database save fails
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


