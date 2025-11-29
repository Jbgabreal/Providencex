/**
 * Per-Account Risk Service (Trading Engine v12)
 * 
 * Calculates risk limits, position sizing, and exposure per account
 */

import { Logger } from '@providencex/shared-utils';
import { AccountInfo, AccountRiskConfig } from './AccountConfig';
import { Pool } from 'pg';
import { StrategyProfileRiskConfig } from '../risk/RiskConfigFromProfile';

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
    context: AccountRiskContext,
    profileRiskConfig?: StrategyProfileRiskConfig
  ): AccountRiskCheckResult {
    // Build runtime risk config: profile-driven if provided, otherwise static account.risk
    const runtimeRisk: AccountRiskConfig = this.buildRuntimeRiskConfig(
      account,
      context,
      profileRiskConfig
    );

    // Check daily loss limit
    if (runtimeRisk.maxDailyLoss > 0 && context.todayRealizedPnL <= -runtimeRisk.maxDailyLoss) {
      return {
        allowed: false,
        reason: `Daily loss limit reached: ${context.todayRealizedPnL.toFixed(2)} <= ${-runtimeRisk.maxDailyLoss} (${account.id})`,
      };
    }

    // Check weekly loss limit (if we track it)
    // TODO: Implement weekly tracking

    // Check max concurrent trades
    if (runtimeRisk.maxConcurrentTrades && context.tradesTakenToday >= runtimeRisk.maxConcurrentTrades) {
      return {
        allowed: false,
        reason: `Max trades per day reached: ${context.tradesTakenToday}/${runtimeRisk.maxConcurrentTrades} (${account.id})`,
      };
    }

    // Check max daily risk (absolute)
    if (runtimeRisk.maxDailyRisk && context.currentExposure >= runtimeRisk.maxDailyRisk) {
      return {
        allowed: false,
        reason: `Max daily risk reached: ${context.currentExposure.toFixed(2)} >= ${runtimeRisk.maxDailyRisk} (${account.id})`,
      };
    }

    // Check max exposure (absolute)
    if (runtimeRisk.maxExposure && context.currentExposure >= runtimeRisk.maxExposure) {
      return {
        allowed: false,
        reason: `Max exposure reached: ${context.currentExposure.toFixed(2)} >= ${runtimeRisk.maxExposure} (${account.id})`,
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
    let adjustedRiskPercent = runtimeRisk.riskPercent;
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
    symbol: string,
    profileRiskConfig?: StrategyProfileRiskConfig
  ): number {
    const runtimeRisk = this.buildRuntimeRiskConfig(
      account,
      context,
      profileRiskConfig
    );

    // Get adjusted risk percent
    const riskPercent = context.guardrailMode === 'reduced'
      ? runtimeRisk.riskPercent * 0.5
      : runtimeRisk.riskPercent;

    const riskAmount = (riskPercent / 100) * context.accountEquity;

    // Lot size calculation per symbol type
    const pipValue = this.getPipValue(symbol, currentPrice);
    const contractSize = this.getContractSize(symbol);
    
    // Formula: riskAmount = lotSize * stopLossPips * pipValue * contractSize
    // Solving for lotSize: lotSize = riskAmount / (stopLossPips * pipValue * contractSize)
    let lotSize: number;
    
    if (symbol.toUpperCase() === 'US30' || symbol.toUpperCase() === 'US30CASH' || symbol.toUpperCase() === 'DOW') {
      // For indices: contractSize is $ per point, pipValue is 1.0
      // Risk = lotSize * stopLossPoints * contractSizePerPoint
      lotSize = riskAmount / (stopLossPips * contractSize);
    } else {
      // For forex/metals: contractSize is units per lot, pipValue is pip size
      // Risk = lotSize * stopLossPips * pipValue * contractSize
      lotSize = riskAmount / (stopLossPips * pipValue * contractSize);
    }

    // Round to 2 decimal places
    let roundedLotSize = Math.round(lotSize * 100) / 100;

    // Apply symbol-specific minimum lot size (broker requirement)
    const minLotSize = this.getMinLotSize(symbol);
    if (roundedLotSize < minLotSize) {
      logger.warn(
        `[${account.id}] Calculated lot size ${roundedLotSize} below broker minimum ${minLotSize} for ${symbol}. ` +
        `Using minimum ${minLotSize} lots.`
      );
      roundedLotSize = minLotSize;
    }

    logger.debug(
      `[${account.id}] Lot size calculation: risk_percent=${riskPercent}%, ` +
      `risk_amount=${riskAmount.toFixed(2)}, stop_loss_pips=${stopLossPips}, ` +
      `calculated_lot_size=${lotSize.toFixed(4)}, rounded=${roundedLotSize}, min_lot_size=${minLotSize}`
    );

    return roundedLotSize;
  }

  /**
   * Get minimum lot size for symbol (broker-specific)
   * TODO: Fetch from MT5 connector symbol info API in future
   */
  private getMinLotSize(symbol: string): number {
    symbol = symbol.toUpperCase();

    // Known broker minimums (should be fetched from MT5 connector in production)
    const minLotSizes: Record<string, number> = {
      'US30': 0.1,        // US30Cash typically requires 0.1 minimum
      'US30CASH': 0.1,
      'DOW': 0.1,
      'XAUUSD': 0.01,    // Gold typically allows 0.01
      'GOLD': 0.01,
      'EURUSD': 0.01,    // Forex typically allows 0.01
      'GBPUSD': 0.01,
    };

    return minLotSizes[symbol] || 0.01; // Default to 0.01 if unknown
  }

  /**
   * Get contract size per lot for symbol
   * For forex: 100,000 units per standard lot
   * For indices: Contract size per point (e.g., $5-10 per point for US30)
   * TODO: Fetch from MT5 connector symbol info API in future
   */
  private getContractSize(symbol: string): number {
    symbol = symbol.toUpperCase();

    // Contract sizes (should be fetched from MT5 connector in production)
    const contractSizes: Record<string, number> = {
      'US30': 5.0,        // US30Cash: typically $5 per point per lot (varies by broker)
      'US30CASH': 5.0,
      'DOW': 5.0,
      'XAUUSD': 100,      // Gold: 100 oz per standard lot
      'GOLD': 100,
      'EURUSD': 100000,   // Forex: 100,000 units per standard lot
      'GBPUSD': 100000,
    };

    return contractSizes[symbol] || 100000; // Default to forex standard
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
    if (symbol === 'US30' || symbol === 'DOW' || symbol === 'US30CASH') {
      return 1.0;
    }

    // Default: assume forex-like
    return 0.0001;
  }

  /**
   * Build runtime risk config from strategy profile (preferred) or static account config (legacy)
   */
  private buildRuntimeRiskConfig(
    account: AccountInfo,
    context: AccountRiskContext,
    profileRiskConfig?: StrategyProfileRiskConfig
  ): AccountRiskConfig {
    if (!profileRiskConfig) {
      return account.risk;
    }

    const equity = context.accountEquity;

    // Convert percentage-based limits to absolute currency amounts
    const maxDailyLoss =
      (profileRiskConfig.maxDailyDrawdownPercent / 100) * equity;

    const maxDailyRisk =
      (profileRiskConfig.maxOpenRiskPercent / 100) * equity;

    // Weekly drawdown could be implemented when we track weekly stats; for now, keep same as daily
    const maxWeeklyLoss =
      (profileRiskConfig.maxWeeklyDrawdownPercent / 100) * equity;

    const runtime: AccountRiskConfig = {
      riskPercent: profileRiskConfig.riskPerTradePercent,
      maxDailyLoss,
      maxWeeklyLoss,
      maxConcurrentTrades: profileRiskConfig.maxTradesPerDay,
      maxDailyRisk,
      maxExposure: maxDailyRisk,
    };

    logger.debug(
      `[PerAccountRiskService] Runtime risk for account ${account.id} from profile: ` +
        `risk=${runtime.riskPercent}%, maxDailyLoss=${runtime.maxDailyLoss.toFixed(
          2
        )}, maxDailyRisk=${runtime.maxDailyRisk}, maxTradesPerDay=${runtime.maxConcurrentTrades}`
    );

    return runtime;
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

