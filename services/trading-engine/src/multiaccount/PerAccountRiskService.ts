/**
 * Per-Account Risk Service (Trading Engine v12)
 * 
 * Calculates risk limits, position sizing, and exposure per account
 */

import { Logger } from '@providencex/shared-utils';
import { AccountInfo, AccountRiskConfig } from './AccountConfig';
import { Pool } from 'pg';

const logger = new Logger('PerAccountRiskService');

/**
 * Account risk context
 */
export interface AccountRiskContext {
  accountId: string;
  accountEquity: number;
  todayRealizedPnL: number;
  tradesTakenToday: number;
  currentExposure: number; // Total open position risk
  concurrentTrades: number;
  guardrailMode: 'normal' | 'reduced' | 'blocked';
}

/**
 * Account risk check result
 */
export interface AccountRiskCheckResult {
  allowed: boolean;
  reason?: string;
  adjustedRiskPercent?: number;
  maxLotSize?: number;
}

/**
 * Per-Account Risk Service
 */
export class PerAccountRiskService {
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
          logger.error('[PerAccountRiskService] Database pool error (non-fatal):', err);
          // Don't crash the app - just log the error
        });
        
        logger.info('[PerAccountRiskService] Connected to database');
        this.initializeDatabase();
      } catch (error) {
        logger.error('[PerAccountRiskService] Failed to connect to database', error);
        this.pool = null;
      }
    }
  }

  /**
   * Check if account can take new trade
   */
  canTakeNewTrade(
    account: AccountInfo,
    context: AccountRiskContext
  ): AccountRiskCheckResult {
    const riskConfig = account.risk;

    // Check daily loss limit
    if (context.todayRealizedPnL <= -riskConfig.maxDailyLoss) {
      return {
        allowed: false,
        reason: `Daily loss limit reached: ${context.todayRealizedPnL.toFixed(2)} <= ${-riskConfig.maxDailyLoss} (${account.id})`,
      };
    }

    // Check weekly loss limit (if we track it)
    // TODO: Implement weekly tracking

    // Check max concurrent trades
    if (riskConfig.maxConcurrentTrades && context.concurrentTrades >= riskConfig.maxConcurrentTrades) {
      return {
        allowed: false,
        reason: `Max concurrent trades reached: ${context.concurrentTrades}/${riskConfig.maxConcurrentTrades} (${account.id})`,
      };
    }

    // Check max daily risk
    if (riskConfig.maxDailyRisk && context.currentExposure >= riskConfig.maxDailyRisk) {
      return {
        allowed: false,
        reason: `Max daily risk reached: ${context.currentExposure.toFixed(2)} >= ${riskConfig.maxDailyRisk} (${account.id})`,
      };
    }

    // Check max exposure
    if (riskConfig.maxExposure && context.currentExposure >= riskConfig.maxExposure) {
      return {
        allowed: false,
        reason: `Max exposure reached: ${context.currentExposure.toFixed(2)} >= ${riskConfig.maxExposure} (${account.id})`,
      };
    }

    // If blocked mode, don't allow trades
    if (context.guardrailMode === 'blocked') {
      return {
        allowed: false,
        reason: `Guardrail mode is blocked (${account.id})`,
      };
    }

    // Calculate adjusted risk percent
    let adjustedRiskPercent = riskConfig.riskPercent;
    if (context.guardrailMode === 'reduced') {
      adjustedRiskPercent = adjustedRiskPercent * 0.5;
    }

    return {
      allowed: true,
      adjustedRiskPercent,
    };
  }

  /**
   * Calculate position size (lot size) for account
   */
  calculateLotSize(
    account: AccountInfo,
    context: AccountRiskContext,
    stopLossPips: number,
    currentPrice: number,
    symbol: string
  ): number {
    const riskConfig = account.risk;
    
    // Get adjusted risk percent
    const riskPercent = context.guardrailMode === 'reduced'
      ? riskConfig.riskPercent * 0.5
      : riskConfig.riskPercent;

    const riskAmount = (riskPercent / 100) * context.accountEquity;

    // Simplified lot size calculation
    // TODO: Implement proper pip value calculation per symbol
    const pipValue = this.getPipValue(symbol, currentPrice);
    const lotSize = riskAmount / (stopLossPips * pipValue * 100000); // Standard lot = 100k units

    // Round to 2 decimal places (0.01 minimum)
    const roundedLotSize = Math.max(0.01, Math.round(lotSize * 100) / 100);

    logger.debug(
      `[${account.id}] Lot size calculation: risk_percent=${riskPercent}%, ` +
      `risk_amount=${riskAmount.toFixed(2)}, stop_loss_pips=${stopLossPips}, ` +
      `lot_size=${roundedLotSize}`
    );

    return roundedLotSize;
  }

  /**
   * Get pip value for symbol (simplified)
   */
  private getPipValue(symbol: string, price: number): number {
    symbol = symbol.toUpperCase();

    // Forex pairs: 1 pip = 0.0001 (4 decimal places)
    if (symbol.includes('USD') && !symbol.includes('XAU')) {
      return 0.0001;
    }

    // XAUUSD (Gold): 1 pip = 0.1 (1 decimal place typically)
    if (symbol === 'XAUUSD' || symbol === 'GOLD') {
      return 0.1;
    }

    // US30: 1 point = 1.0
    if (symbol === 'US30' || symbol === 'DOW') {
      return 1.0;
    }

    // Default: assume forex-like
    return 0.0001;
  }

  /**
   * Get account equity from database
   */
  async getAccountEquity(accountId: string): Promise<number | null> {
    if (!this.pool) {
      return null;
    }

    try {
      // Query latest equity from account_live_equity table
      const result = await this.pool.query(
        `SELECT equity FROM account_live_equity 
         WHERE account_id = $1 
         ORDER BY timestamp DESC 
         LIMIT 1`,
        [accountId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return parseFloat(result.rows[0].equity);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Log table name for easier debugging
      logger.error(`[PerAccountRiskService] Failed to get equity for ${accountId} from account_live_equity table: ${errorMessage}`, error);
      return null;
    }
  }

  /**
   * Get today's realized PnL for account
   */
  async getTodayRealizedPnL(accountId: string): Promise<number> {
    if (!this.pool) {
      return 0;
    }

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Query today's closed trades
      const result = await this.pool.query(
        `SELECT COALESCE(SUM(pnl), 0) as total_pnl
         FROM account_trade_decisions
         WHERE account_id = $1
         AND decision = 'TRADE'
         AND execution_result->>'success' = 'true'
         AND pnl IS NOT NULL
         AND timestamp >= $2`,
        [accountId, today.toISOString()]
      );

      return parseFloat(result.rows[0]?.total_pnl || '0');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Log table name for easier debugging
      logger.error(`[PerAccountRiskService] Failed to get today PnL for ${accountId} from account_trade_decisions table: ${errorMessage}`, error);
      return 0;
    }
  }

  /**
   * Get today's trade count for account
   */
  async getTodayTradeCount(accountId: string): Promise<number> {
    if (!this.pool) {
      return 0;
    }

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const result = await this.pool.query(
        `SELECT COUNT(*) as count
         FROM account_trade_decisions
         WHERE account_id = $1
         AND decision = 'TRADE'
         AND timestamp >= $2`,
        [accountId, today.toISOString()]
      );

      return parseInt(result.rows[0]?.count || '0', 10);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Log table name for easier debugging
      logger.error(`[PerAccountRiskService] Failed to get today trade count for ${accountId} from account_trade_decisions table: ${errorMessage}`, error);
      return 0;
    }
  }

  /**
   * Initialize database tables (create if not exist)
   */
  private async initializeDatabase(): Promise<void> {
    if (!this.pool) {
      return;
    }

    try {
      // Create account_live_equity table for per-account equity snapshots
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS account_live_equity (
          id BIGSERIAL PRIMARY KEY,
          account_id VARCHAR(64) NOT NULL,
          broker_account VARCHAR(64),
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          balance DOUBLE PRECISION NOT NULL,
          equity DOUBLE PRECISION NOT NULL,
          floating_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
          closed_pnl_today DOUBLE PRECISION NOT NULL DEFAULT 0,
          closed_pnl_week DOUBLE PRECISION NOT NULL DEFAULT 0,
          max_drawdown_abs DOUBLE PRECISION NOT NULL DEFAULT 0
        )
      `);

      // Create indexes with error handling for duplicate index errors (42P17)
      try {
        await this.pool.query(`
          CREATE INDEX IF NOT EXISTS idx_account_live_equity_account_ts
          ON account_live_equity (account_id, timestamp DESC)
        `);
      } catch (error: any) {
        // Handle duplicate index error (42P17) gracefully
        if (error?.code !== '42P17') {
          throw error;
        }
        logger.debug('[PerAccountRiskService] Index idx_account_live_equity_account_ts already exists');
      }

      // Create account_trade_decisions table for per-account trade decisions/results
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS account_trade_decisions (
          id BIGSERIAL PRIMARY KEY,
          account_id VARCHAR(64) NOT NULL,
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          symbol VARCHAR(20) NOT NULL,
          strategy VARCHAR(32) NOT NULL,
          decision VARCHAR(10) NOT NULL CHECK (decision IN ('TRADE', 'SKIP')),
          risk_reason TEXT,
          filter_reason TEXT,
          kill_switch_reason TEXT,
          execution_result JSONB,
          pnl DOUBLE PRECISION
        )
      `);

      // Create indexes with error handling for duplicate index errors (42P17)
      try {
        await this.pool.query(`
          CREATE INDEX IF NOT EXISTS idx_account_trade_decisions_account_ts
          ON account_trade_decisions (account_id, timestamp DESC)
        `);
      } catch (error: any) {
        if (error?.code !== '42P17') {
          throw error;
        }
        logger.debug('[PerAccountRiskService] Index idx_account_trade_decisions_account_ts already exists');
      }

      try {
        await this.pool.query(`
          CREATE INDEX IF NOT EXISTS idx_account_trade_decisions_account_symbol
          ON account_trade_decisions (account_id, symbol)
        `);
      } catch (error: any) {
        if (error?.code !== '42P17') {
          throw error;
        }
        logger.debug('[PerAccountRiskService] Index idx_account_trade_decisions_account_symbol already exists');
      }

      try {
        await this.pool.query(`
          CREATE INDEX IF NOT EXISTS idx_account_trade_decisions_account_date
          ON account_trade_decisions (account_id, DATE(timestamp))
        `);
      } catch (error: any) {
        if (error?.code !== '42P17') {
          throw error;
        }
        logger.debug('[PerAccountRiskService] Index idx_account_trade_decisions_account_date already exists');
      }

      logger.info('[PerAccountRiskService] Database tables initialized');
    } catch (error) {
      logger.error('[PerAccountRiskService] Failed to initialize database tables', error);
      // Don't throw - allow service to continue without DB
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

