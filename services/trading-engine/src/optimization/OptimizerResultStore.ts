/**
 * OptimizerResultStore - Stores optimization runs and results in PostgreSQL (Trading Engine v11)
 * 
 * Manages tables:
 * - optimization_runs
 * - optimization_results
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import {
  OptimizationRun,
  OptimizationResult,
  OptimizationMetrics,
} from './OptimizationTypes';

const logger = new Logger('OptimizerResultStore');

/**
 * OptimizerResultStore - Manages optimization result storage in Postgres
 */
export class OptimizerResultStore {
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
          logger.error('[OptimizerResultStore] Database pool error (non-fatal):', err);
          // Don't crash the app - just log the error
        });
        
        logger.info('[OptimizerResultStore] Connected to Postgres for optimization results');
      } catch (error) {
        logger.error('[OptimizerResultStore] Failed to connect to Postgres', error);
        this.pool = null;
      }
    } else {
      logger.warn('[OptimizerResultStore] No DATABASE_URL provided - results will not be stored in DB');
    }
  }

  /**
   * Initialize database tables (create if not exist)
   */
  async initializeTables(): Promise<void> {
    if (!this.pool) {
      logger.warn('[OptimizerResultStore] No database connection - skipping table creation');
      return;
    }

    try {
      // Create optimization_runs table
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS optimization_runs (
          id BIGSERIAL PRIMARY KEY,
          method VARCHAR(32) NOT NULL,
          symbol TEXT NOT NULL, -- Can store array as JSON string
          param_set JSONB, -- SMC_V2_ParamSet or null for grid/random
          in_sample_range JSONB NOT NULL, -- {from, to}
          out_sample_range JSONB, -- {from, to} for walk-forward
          status VARCHAR(16) NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          error TEXT
        )
      `);

      // Create optimization_results table
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS optimization_results (
          id BIGSERIAL PRIMARY KEY,
          run_id BIGINT REFERENCES optimization_runs(id) ON DELETE CASCADE,
          param_set JSONB NOT NULL, -- SMC_V2_ParamSet
          metrics JSONB NOT NULL, -- OptimizationMetrics
          equity_curve JSONB, -- Array of EquityPoint
          trades JSONB, -- Array of OptimizationTrade
          ranked_score DOUBLE PRECISION, -- Composite score for ranking
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Create indexes
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_optimization_runs_method ON optimization_runs(method)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_optimization_runs_status ON optimization_runs(status)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_optimization_runs_created_at ON optimization_runs(created_at DESC)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_optimization_results_run_id ON optimization_results(run_id)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_optimization_results_ranked_score ON optimization_results(ranked_score DESC)
      `);

      logger.info('[OptimizerResultStore] Database tables initialized');
    } catch (error) {
      logger.error('[OptimizerResultStore] Failed to initialize tables', error);
      throw error;
    }
  }

  /**
   * Save optimization run
   */
  async saveRun(run: OptimizationRun): Promise<number> {
    if (!this.pool) {
      logger.warn('[OptimizerResultStore] No database connection - skipping save');
      return 0;
    }

    try {
      const result = await this.pool.query(
        `INSERT INTO optimization_runs (
          method, symbol, param_set, in_sample_range, out_sample_range, status, error
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id`,
        [
          run.method,
          Array.isArray(run.symbol) ? JSON.stringify(run.symbol) : run.symbol,
          run.paramSet ? JSON.stringify(run.paramSet) : null,
          JSON.stringify(run.inSampleRange),
          run.outSampleRange ? JSON.stringify(run.outSampleRange) : null,
          run.status,
          run.error || null,
        ]
      );

      const id = result.rows[0].id;
      logger.debug(`[OptimizerResultStore] Saved optimization run with id: ${id}`);
      return id;
    } catch (error) {
      logger.error('[OptimizerResultStore] Failed to save run', error);
      throw error;
    }
  }

  /**
   * Update optimization run status
   */
  async updateRunStatus(
    id: number,
    status: OptimizationRun['status'],
    error?: string
  ): Promise<void> {
    if (!this.pool) {
      return;
    }

    try {
      await this.pool.query(
        `UPDATE optimization_runs 
         SET status = $1, completed_at = CASE WHEN $1 IN ('completed', 'failed') THEN NOW() ELSE completed_at END, error = $2
         WHERE id = $3`,
        [status, error || null, id]
      );
    } catch (error) {
      logger.error('[OptimizerResultStore] Failed to update run status', error);
      throw error;
    }
  }

  /**
   * Save optimization result
   */
  async saveResult(result: OptimizationResult): Promise<number> {
    if (!this.pool) {
      logger.warn('[OptimizerResultStore] No database connection - skipping save');
      return 0;
    }

    try {
      const dbResult = await this.pool.query(
        `INSERT INTO optimization_results (
          run_id, param_set, metrics, equity_curve, trades, ranked_score
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id`,
        [
          result.runId,
          JSON.stringify(result.paramSet),
          JSON.stringify(result.metrics),
          JSON.stringify(result.equityCurve),
          JSON.stringify(result.trades),
          result.rankedScore,
        ]
      );

      const id = dbResult.rows[0].id;
      logger.debug(`[OptimizerResultStore] Saved optimization result with id: ${id}`);
      return id;
    } catch (error) {
      logger.error('[OptimizerResultStore] Failed to save result', error);
      throw error;
    }
  }

  /**
   * Load optimization run by ID
   */
  async loadRun(id: number): Promise<OptimizationRun | null> {
    if (!this.pool) {
      return null;
    }

    try {
      const result = await this.pool.query(
        `SELECT * FROM optimization_runs WHERE id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        method: row.method as OptimizationRun['method'],
        symbol: this.parseSymbol(row.symbol),
        paramSet: row.param_set ? JSON.parse(row.param_set) : null,
        inSampleRange: JSON.parse(row.in_sample_range),
        outSampleRange: row.out_sample_range ? JSON.parse(row.out_sample_range) : undefined,
        status: row.status,
        created_at: row.created_at ? new Date(row.created_at).toISOString() : undefined,
        completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
        error: row.error || undefined,
      };
    } catch (error) {
      logger.error('[OptimizerResultStore] Failed to load run', error);
      return null;
    }
  }

  /**
   * Load all results for a run
   */
  async loadResults(runId: number): Promise<OptimizationResult[]> {
    if (!this.pool) {
      return [];
    }

    try {
      const result = await this.pool.query(
        `SELECT * FROM optimization_results WHERE run_id = $1 ORDER BY ranked_score DESC`,
        [runId]
      );

      return result.rows.map(row => ({
        runId: row.run_id,
        paramSet: JSON.parse(row.param_set),
        metrics: JSON.parse(row.metrics),
        equityCurve: JSON.parse(row.equity_curve || '[]'),
        trades: JSON.parse(row.trades || '[]'),
        rankedScore: row.ranked_score,
      }));
    } catch (error) {
      logger.error('[OptimizerResultStore] Failed to load results', error);
      return [];
    }
  }

  /**
   * Get all runs with optional filters
   */
  async getAllRuns(filters?: {
    method?: OptimizationRun['method'];
    symbol?: string;
    status?: OptimizationRun['status'];
    limit?: number;
  }): Promise<OptimizationRun[]> {
    if (!this.pool) {
      return [];
    }

    try {
      let query = `SELECT * FROM optimization_runs WHERE 1=1`;
      const params: any[] = [];
      let paramIndex = 1;

      if (filters?.method) {
        query += ` AND method = $${paramIndex++}`;
        params.push(filters.method);
      }

      if (filters?.symbol) {
        query += ` AND symbol LIKE $${paramIndex++}`;
        params.push(`%${filters.symbol}%`);
      }

      if (filters?.status) {
        query += ` AND status = $${paramIndex++}`;
        params.push(filters.status);
      }

      query += ` ORDER BY created_at DESC`;

      if (filters?.limit) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(filters.limit);
      }

      const result = await this.pool.query(query, params);

      return result.rows.map(row => ({
        id: row.id,
        method: row.method as OptimizationRun['method'],
        symbol: this.parseSymbol(row.symbol),
        paramSet: row.param_set ? JSON.parse(row.param_set) : null,
        inSampleRange: JSON.parse(row.in_sample_range),
        outSampleRange: row.out_sample_range ? JSON.parse(row.out_sample_range) : undefined,
        status: row.status,
        created_at: row.created_at ? new Date(row.created_at).toISOString() : undefined,
        completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : undefined,
        error: row.error || undefined,
      }));
    } catch (error) {
      logger.error('[OptimizerResultStore] Failed to get all runs', error);
      return [];
    }
  }

  /**
   * Parse symbol from database (can be string or JSON array)
   */
  private parseSymbol(symbol: string | string[]): string | string[] {
    if (typeof symbol === 'string') {
      try {
        // Try to parse as JSON array
        const parsed = JSON.parse(symbol);
        if (Array.isArray(parsed)) {
          return parsed;
        }
        return symbol;
      } catch {
        return symbol;
      }
    }
    return symbol;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      logger.info('[OptimizerResultStore] Database connection closed');
    }
  }
}

