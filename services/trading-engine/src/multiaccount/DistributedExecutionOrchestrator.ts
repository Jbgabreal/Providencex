/**
 * Distributed Execution Orchestrator (Trading Engine v12)
 * 
 * Orchestrates trade execution across multiple accounts in parallel
 */

import { Logger } from '@providencex/shared-utils';
import { RawSignal, ExecutionFilterContext } from '../strategy/v3/types';
import { AccountRegistry } from './AccountRegistry';
import { PerAccountRiskService } from './PerAccountRiskService';
import { PerAccountKillSwitch } from './PerAccountKillSwitch';
import { AccountExecutionEngine } from './AccountExecutionEngine';
import { AccountExecutionResult } from './AccountExecutionEngine';
import { PriceFeedClient, CandleStore } from '../marketData';
import { Pool } from 'pg';

const logger = new Logger('DistributedExecutionOrchestrator');

/**
 * Aggregated execution result across all accounts
 */
export interface AggregatedExecutionResult {
  symbol: string;
  strategy: string;
  timestamp: Date;
  totalAccounts: number;
  tradedAccounts: string[];
  skippedAccounts: Array<{ accountId: string; reason: string }>;
  failedAccounts: Array<{ accountId: string; error: string }>;
  results: AccountExecutionResult[];
}

/**
 * Distributed Execution Orchestrator
 */
export class DistributedExecutionOrchestrator {
  private accountRegistry: AccountRegistry;
  private riskService: PerAccountRiskService;
  private killSwitch: PerAccountKillSwitch;
  private priceFeed?: PriceFeedClient;
  private candleStore?: CandleStore;
  private pool: Pool | null = null;

  constructor(
    accountRegistry: AccountRegistry,
    riskService: PerAccountRiskService,
    killSwitch: PerAccountKillSwitch,
    databaseUrl?: string,
    priceFeed?: PriceFeedClient,
    candleStore?: CandleStore
  ) {
    this.accountRegistry = accountRegistry;
    this.riskService = riskService;
    this.killSwitch = killSwitch;
    this.priceFeed = priceFeed;
    this.candleStore = candleStore;

    if (databaseUrl) {
      try {
        this.pool = new Pool({
          connectionString: databaseUrl,
          ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        });
        
        // Handle pool errors gracefully (prevent app crash)
        this.pool.on('error', (err) => {
          logger.error('[DistributedExecutionOrchestrator] Database pool error (non-fatal):', err);
          // Don't crash the app - just log the error
        });
        
        logger.info('[DistributedExecutionOrchestrator] Connected to database');
        this.initializeDatabase();
      } catch (error) {
        logger.error('[DistributedExecutionOrchestrator] Failed to connect to database', error);
        this.pool = null;
      }
    }
  }

  /**
   * Execute signal across all eligible accounts in parallel
   */
  async execute(
    signal: RawSignal,
    baseContext: ExecutionFilterContext,
    guardrailMode: string,
    strategy: string
  ): Promise<AggregatedExecutionResult> {
    const timestamp = new Date();

    // Get accounts that trade this symbol
    const eligibleAccounts = this.accountRegistry.getAccountsForSymbol(signal.symbol);

    if (eligibleAccounts.length === 0) {
      logger.warn(`[DistributedExecutionOrchestrator] No accounts configured for symbol ${signal.symbol}`);
      return {
        symbol: signal.symbol,
        strategy,
        timestamp,
        totalAccounts: 0,
        tradedAccounts: [],
        skippedAccounts: [],
        failedAccounts: [],
        results: [],
      };
    }

    logger.info(
      `[DistributedExecutionOrchestrator] Executing signal for ${signal.symbol} across ${eligibleAccounts.length} account(s)`
    );

    // Execute in parallel for all accounts
    const executionPromises = eligibleAccounts.map(async (account) => {
      const engine = new AccountExecutionEngine(
        account,
        this.accountRegistry,
        this.riskService,
        this.killSwitch,
        this.priceFeed,
        this.candleStore,
        undefined // Legacy mode: no StrategyProfileRiskConfig
      );

      return engine.execute(signal, baseContext, guardrailMode, strategy);
    });

    const results = await Promise.all(executionPromises);

    // Persist results to database
    await this.persistResults(signal, results, guardrailMode, strategy);

    // Aggregate results
    const tradedAccounts: string[] = [];
    const skippedAccounts: Array<{ accountId: string; reason: string }> = [];
    const failedAccounts: Array<{ accountId: string; error: string }> = [];

    for (const result of results) {
      if (result.success && result.decision === 'TRADE') {
        tradedAccounts.push(result.accountId);
      } else if (result.decision === 'SKIP') {
        skippedAccounts.push({
          accountId: result.accountId,
          reason: result.reasons.join('; '),
        });
      } else {
        failedAccounts.push({
          accountId: result.accountId,
          error: result.error || 'Unknown error',
        });
      }
    }

    const aggregatedResult: AggregatedExecutionResult = {
      symbol: signal.symbol,
      strategy,
      timestamp,
      totalAccounts: eligibleAccounts.length,
      tradedAccounts,
      skippedAccounts,
      failedAccounts,
      results,
    };

    logger.info(
      `[DistributedExecutionOrchestrator] Execution complete: ${tradedAccounts.length} traded, ` +
      `${skippedAccounts.length} skipped, ${failedAccounts.length} failed`
    );

    return aggregatedResult;
  }

  /**
   * Initialize database tables (create if not exist)
   */
  private async initializeDatabase(): Promise<void> {
    if (!this.pool) {
      return;
    }

    try {
      // Create account_trade_decisions table if it doesn't exist
      // Note: This table may also be created by PerAccountRiskService, but we ensure it exists here too
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
      // Note: These indexes may already exist if PerAccountRiskService created them first
      try {
        await this.pool.query(`
          CREATE INDEX IF NOT EXISTS idx_account_trade_decisions_account_ts
          ON account_trade_decisions (account_id, timestamp DESC)
        `);
      } catch (error: any) {
        if (error?.code !== '42P17') {
          throw error;
        }
        logger.debug('[DistributedExecutionOrchestrator] Index idx_account_trade_decisions_account_ts already exists');
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
        logger.debug('[DistributedExecutionOrchestrator] Index idx_account_trade_decisions_account_symbol already exists');
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
        logger.debug('[DistributedExecutionOrchestrator] Index idx_account_trade_decisions_account_date already exists');
      }

      logger.info('[DistributedExecutionOrchestrator] Database tables initialized');
    } catch (error) {
      logger.error('[DistributedExecutionOrchestrator] Failed to initialize database tables', error);
      // Don't throw - allow orchestrator to continue without DB persistence
    }
  }

  /**
   * Persist execution results to database
   */
  private async persistResults(
    signal: RawSignal,
    results: AccountExecutionResult[],
    guardrailMode: string,
    strategy: string
  ): Promise<void> {
    if (!this.pool) {
      return;
    }

    try {
      for (const result of results) {
        await this.pool.query(
          `INSERT INTO account_trade_decisions (
            account_id, timestamp, symbol, strategy, decision,
            risk_reason, filter_reason, kill_switch_reason,
            execution_result, pnl
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            result.accountId,
            new Date(),
            signal.symbol,
            strategy,
            result.decision,
            result.riskReason || null,
            result.filterReason || null,
            result.killSwitchReason || null,
            JSON.stringify({
              success: result.success,
              ticket: result.ticket || null,
              error: result.error || null,
            }),
            null, // PnL will be updated when trade closes
          ]
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Log table name for easier debugging
      logger.error(`[DistributedExecutionOrchestrator] Failed to persist results to account_trade_decisions table: ${errorMessage}`, error);
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

