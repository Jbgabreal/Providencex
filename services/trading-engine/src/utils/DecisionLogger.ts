import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';
import { TradeDecisionLog } from '../types';

const logger = new Logger('DecisionLogger');

/**
 * DecisionLogger - Logs trade decisions for transparency and audit
 * v1: Can use Postgres or file-based logging
 */
export class DecisionLogger {
  private pool: Pool | null = null;
  private useDatabase: boolean = false;

  constructor() {
    const config = getConfig();
    if (config.databaseUrl) {
      try {
        this.pool = new Pool({
          connectionString: config.databaseUrl,
          ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        });
        
        // Handle pool errors gracefully (prevent app crash)
        this.pool.on('error', (err) => {
          logger.error('[DecisionLogger] Database pool error (non-fatal):', err);
          // Don't crash the app - just log the error
        });
        
        this.useDatabase = true;
        // Initialize schema asynchronously (don't block constructor)
        this.ensureSchema().catch((err) => {
          logger.error('[DecisionLogger] Failed to ensure schema:', err);
          // Continue - we'll try again on first insert
        });
        logger.info('Using Postgres for trade decision logging');
      } catch (error) {
        logger.warn('Database logging failed, falling back to console logging', error);
        this.useDatabase = false;
      }
    } else {
      logger.info('No DATABASE_URL configured, using console logging only');
    }
  }

  /**
   * Ensure database schema exists and is up-to-date
   * Creates table if not exists, and adds missing columns
   */
  private async ensureSchema(): Promise<void> {
    if (!this.pool) return;

    try {
      // Step 1: Create table if not exists (with minimal schema for compatibility)
      const createTable = `
        CREATE TABLE IF NOT EXISTS trade_decisions (
          id SERIAL PRIMARY KEY,
          timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
          symbol VARCHAR(20) NOT NULL,
          strategy VARCHAR(10) NOT NULL,
          guardrail_mode VARCHAR(20) NOT NULL,
          guardrail_reason TEXT,
          decision VARCHAR(10) NOT NULL,
          risk_reason TEXT,
          signal_reason TEXT,
          risk_score INTEGER,
          trade_request JSONB,
          execution_result JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `;
      await this.pool.query(createTable);

      // Step 2: Add missing columns if they don't exist
      const columnsToAdd = [
        { name: 'execution_filter_action', type: 'VARCHAR(10)' },
        { name: 'execution_filter_reasons', type: 'JSONB' },
        { name: 'kill_switch_active', type: 'BOOLEAN' },
        { name: 'kill_switch_reasons', type: 'JSONB' },
        { name: 'ml_pass', type: 'BOOLEAN' },
        { name: 'ml_score', type: 'JSONB' },
        { name: 'ml_reasons', type: 'JSONB' },
        { name: 'regime', type: 'VARCHAR(32)' },
        { name: 'features', type: 'JSONB' },
        { name: 'orderflow_snapshot', type: 'JSONB' },
        { name: 'orderflow_delta15s', type: 'DOUBLE PRECISION' },
        { name: 'orderflow_order_imbalance', type: 'DOUBLE PRECISION' },
        { name: 'orderflow_large_orders_against', type: 'INT' },
      ];

      const addedColumns: string[] = [];

      for (const column of columnsToAdd) {
        try {
          // Check if column exists by querying information_schema
          // Check in 'public' schema (default schema)
          const checkColumn = await this.pool.query(
            `SELECT column_name 
             FROM information_schema.columns 
             WHERE table_schema = 'public' 
             AND table_name = 'trade_decisions' 
             AND column_name = $1`,
            [column.name]
          );

          if (checkColumn.rows.length === 0) {
            // Column doesn't exist, add it
            await this.pool.query(
              `ALTER TABLE trade_decisions ADD COLUMN IF NOT EXISTS ${column.name} ${column.type}`
            );
            addedColumns.push(column.name);
          }
        } catch (columnError) {
          // Column might already exist or there's a conflict - log and continue
          logger.debug(`[DecisionLogger] Column ${column.name} check/add failed (may already exist):`, columnError);
          // Try to add it anyway (IF NOT EXISTS will handle conflicts)
          try {
            await this.pool.query(
              `ALTER TABLE trade_decisions ADD COLUMN IF NOT EXISTS ${column.name} ${column.type}`
            );
            // If we get here, the column was added
            if (!addedColumns.includes(column.name)) {
              addedColumns.push(column.name);
            }
          } catch (addError) {
            // Column likely already exists - ignore
            logger.debug(`[DecisionLogger] Column ${column.name} already exists or cannot be added`);
          }
        }
      }

      // Step 3: Create indexes if they don't exist
      const indexes = [
        { name: 'idx_trade_decisions_timestamp', sql: 'CREATE INDEX IF NOT EXISTS idx_trade_decisions_timestamp ON trade_decisions(timestamp DESC)' },
        { name: 'idx_trade_decisions_symbol', sql: 'CREATE INDEX IF NOT EXISTS idx_trade_decisions_symbol ON trade_decisions(symbol)' },
        { name: 'idx_trade_decisions_strategy', sql: 'CREATE INDEX IF NOT EXISTS idx_trade_decisions_strategy ON trade_decisions(strategy)' },
      ];

      for (const index of indexes) {
        try {
          await this.pool.query(index.sql);
        } catch (indexError) {
          logger.debug(`[DecisionLogger] Index ${index.name} creation failed (may already exist):`, indexError);
        }
      }

      if (addedColumns.length > 0) {
        logger.info(`[DecisionLogger] Schema updated: added missing columns: ${addedColumns.join(', ')}`);
      } else {
        logger.debug('[DecisionLogger] Schema is up-to-date (all columns exist)');
      }
    } catch (error) {
      logger.error('[DecisionLogger] Failed to ensure schema:', error);
      // Don't disable database logging - we'll try again on next insert
      // this.useDatabase = false;
    }
  }

  /**
   * Log a trade decision
   * Returns the decision ID if logged to database, null otherwise
   */
  async logDecision(decisionLog: TradeDecisionLog): Promise<number | null> {
    // Always log to console for visibility
    this.logToConsole(decisionLog);

    // If database is available, also log to Postgres
    if (this.useDatabase && this.pool) {
      try {
        return await this.logToDatabase(decisionLog);
      } catch (error) {
        logger.error('Failed to log decision to database', error);
        // Continue - console logging already happened
      }
    }
    return null;
  }

  /**
   * Log to console
   */
  private logToConsole(decisionLog: TradeDecisionLog): void {
    const {
      timestamp,
      symbol,
      strategy,
      guardrail_mode,
      decision,
      risk_reason,
      signal_reason,
      execution_result,
    } = decisionLog;

    const emoji = decision === 'trade' ? '✅' : '⏭️';
    const message = `${emoji} [${symbol}] ${decision.toUpperCase()} - Strategy: ${strategy}, Guardrail: ${guardrail_mode}`;

    // Include v3 execution filter reasons if present
    const v3Reasons = decisionLog.execution_filter_reasons || [];

    if (decision === 'trade') {
      logger.info(message, {
        signal_reason,
        execution: execution_result?.success ? `Ticket: ${execution_result.ticket}` : `Error: ${execution_result?.error}`,
        ...(v3Reasons.length > 0 && { execution_filter: v3Reasons.join('; ') }),
      });
    } else {
      logger.info(message, {
        guardrail_reason: decisionLog.guardrail_reason,
        risk_reason,
        signal_reason,
        ...(v3Reasons.length > 0 && { execution_filter: v3Reasons.join('; ') }),
      });
    }
  }

  /**
   * Log to Postgres database
   * Returns the decision ID if successful, null otherwise
   */
  private async logToDatabase(decisionLog: TradeDecisionLog): Promise<number | null> {
    if (!this.pool) return null;

    // Ensure schema is up-to-date before inserting (handles migration)
    // This is safe to call multiple times - it only adds missing columns
    try {
      await this.ensureSchema();
    } catch (schemaError) {
      logger.warn('[DecisionLogger] Schema check failed, proceeding with insert anyway:', schemaError);
    }

    // Normalize execution filter fields - ensure they're always set (null if not provided)
    const executionFilterAction = decisionLog.execution_filter_action || null;
    const executionFilterReasons = decisionLog.execution_filter_reasons 
      ? (Array.isArray(decisionLog.execution_filter_reasons) ? JSON.stringify(decisionLog.execution_filter_reasons) : null)
      : null;

    // Normalize kill switch fields - ensure they're always set (null if not provided)
    const killSwitchActive = decisionLog.kill_switch_active ?? null;
    const killSwitchReasons = decisionLog.kill_switch_reasons 
      ? (Array.isArray(decisionLog.kill_switch_reasons) ? JSON.stringify(decisionLog.kill_switch_reasons) : null)
      : null;

    // Normalize ML fields - ensure they're always set (null if not provided)
    const mlPass = decisionLog.ml_pass ?? null;
    const mlScore = decisionLog.ml_score ? JSON.stringify(decisionLog.ml_score) : null;
    const mlReasons = decisionLog.ml_reasons 
      ? (Array.isArray(decisionLog.ml_reasons) ? JSON.stringify(decisionLog.ml_reasons) : null)
      : null;
    const regime = decisionLog.regime || null;
    const features = decisionLog.features ? JSON.stringify(decisionLog.features) : null;

    // Normalize v14 Order Flow fields
    const orderflowSnapshot = decisionLog.orderflow_snapshot ? JSON.stringify(decisionLog.orderflow_snapshot) : null;
    const orderflowDelta15s = decisionLog.orderflow_delta15s ?? null;
    const orderflowOrderImbalance = decisionLog.orderflow_order_imbalance ?? null;
    const orderflowLargeOrdersAgainst = decisionLog.orderflow_large_orders_against ?? null;

    const result = await this.pool.query(
      `INSERT INTO trade_decisions (
        timestamp, symbol, strategy, guardrail_mode, guardrail_reason,
        decision, risk_reason, signal_reason, risk_score,
        trade_request, execution_result,
        execution_filter_action, execution_filter_reasons,
        kill_switch_active, kill_switch_reasons,
        ml_pass, ml_score, ml_reasons, regime, features,
        orderflow_snapshot, orderflow_delta15s, orderflow_order_imbalance, orderflow_large_orders_against
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
      RETURNING id`,
      [
        decisionLog.timestamp,
        decisionLog.symbol,
        decisionLog.strategy,
        decisionLog.guardrail_mode,
        decisionLog.guardrail_reason || null,
        decisionLog.decision,
        decisionLog.risk_reason || null,
        decisionLog.signal_reason || null,
        decisionLog.risk_score || null,
        decisionLog.trade_request ? JSON.stringify(decisionLog.trade_request) : null,
        decisionLog.execution_result ? JSON.stringify(decisionLog.execution_result) : null,
        executionFilterAction,
        executionFilterReasons,
        killSwitchActive,
        killSwitchReasons,
        mlPass,
        mlScore,
        mlReasons,
        regime,
        features,
        orderflowSnapshot,
        orderflowDelta15s,
        orderflowOrderImbalance,
        orderflowLargeOrdersAgainst,
      ]
    );

    if (result.rows.length > 0) {
      return parseInt(result.rows[0].id, 10);
    }
    return null;
  }

  /**
   * Get recent decisions (for debugging/monitoring)
   */
  async getRecentDecisions(limit: number = 50): Promise<TradeDecisionLog[]> {
    if (!this.useDatabase || !this.pool) {
      return [];
    }

    try {
      const result = await this.pool.query(
        `SELECT * FROM trade_decisions 
         ORDER BY timestamp DESC 
         LIMIT $1`,
        [limit]
      );

      return result.rows.map((row: any) => ({
        id: row.id.toString(),
        timestamp: row.timestamp,
        symbol: row.symbol,
        strategy: row.strategy as 'low' | 'high',
        guardrail_mode: row.guardrail_mode as 'normal' | 'reduced' | 'blocked',
        guardrail_reason: row.guardrail_reason,
        decision: row.decision as 'trade' | 'skip',
        risk_reason: row.risk_reason,
        signal_reason: row.signal_reason,
        risk_score: row.risk_score,
        trade_request: row.trade_request,
        execution_result: row.execution_result,
        execution_filter_action: row.execution_filter_action,
        execution_filter_reasons: row.execution_filter_reasons ? JSON.parse(row.execution_filter_reasons) : null,
      }));
    } catch (error) {
      logger.error('Failed to fetch recent decisions', error);
      return [];
    }
  }

  /**
   * Cleanup: Close database connection
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

