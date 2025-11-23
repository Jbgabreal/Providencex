/**
 * Per-Account Kill Switch (Trading Engine v12)
 * 
 * Triggers kill switch independently per account
 */

import { Logger } from '@providencex/shared-utils';
import { AccountInfo, AccountKillSwitchConfig } from './AccountConfig';
import { Pool } from 'pg';

const logger = new Logger('PerAccountKillSwitch');

/**
 * Account kill switch state
 */
export interface AccountKillSwitchState {
  accountId: string;
  active: boolean;
  reasons: string[];
  activatedAt: Date | null;
}

/**
 * Kill switch evaluation context
 */
export interface AccountKillSwitchContext {
  accountId: string;
  symbol: string;
  todayRealizedPnL: number;
  weeklyRealizedPnL?: number;
  currentDrawdown: number;
  currentSpreadPips: number;
  currentExposure: number;
  consecutiveLosses: number;
  latestTick?: any;
}

/**
 * Spread configuration for kill switch
 */
interface SpreadConfig {
  defaultMaxSpreadPips: number;
  perSymbol?: Record<string, number>; // e.g. { "US30": 10, "XAUUSD": 3 }
}

/**
 * Per-Account Kill Switch Service
 */
export class PerAccountKillSwitch {
  private pool: Pool | null = null;
  private states: Map<string, AccountKillSwitchState> = new Map();
  private accountConfigs: Map<string, AccountKillSwitchConfig> = new Map();
  private spreadConfig: SpreadConfig;

  constructor(databaseUrl?: string) {
    // Load spread configuration from environment with defaults
    const env = process.env.NODE_ENV || 'development';
    const defaultMaxSpreadPips = env === 'production' ? 2 : 10; // Relaxed for dev
    
    // Read from env or use environment-based default
    const envMaxSpread = process.env.PER_ACCOUNT_MAX_SPREAD_PIPS;
    const defaultSpread = envMaxSpread ? parseFloat(envMaxSpread) : defaultMaxSpreadPips;
    
    // Support per-symbol overrides via env (format: "XAUUSD:3,US30:10")
    const perSymbolEnv = process.env.PER_ACCOUNT_MAX_SPREAD_PIPS_PER_SYMBOL;
    const perSymbol: Record<string, number> = {};
    
    if (perSymbolEnv) {
      perSymbolEnv.split(',').forEach(entry => {
        const [symbol, value] = entry.split(':').map(s => s.trim());
        if (symbol && value) {
          perSymbol[symbol.toUpperCase()] = parseFloat(value);
        }
      });
    }
    
    this.spreadConfig = {
      defaultMaxSpreadPips: defaultSpread,
      perSymbol: Object.keys(perSymbol).length > 0 ? perSymbol : undefined,
    };
    
    logger.info(
      `[PerAccountKillSwitch] Spread config initialized: default=${this.spreadConfig.defaultMaxSpreadPips} pips, ` +
      `per-symbol=${this.spreadConfig.perSymbol ? JSON.stringify(this.spreadConfig.perSymbol) : 'none'}, env=${env}`
    );
    if (databaseUrl) {
      try {
        this.pool = new Pool({
          connectionString: databaseUrl,
          ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        });
        
        // Handle pool errors gracefully (prevent app crash)
        this.pool.on('error', (err) => {
          logger.error('[PerAccountKillSwitch] Database pool error (non-fatal):', err);
          // Don't crash the app - just log the error
        });
        
        logger.info('[PerAccountKillSwitch] Connected to database');
        this.initializeDatabase();
      } catch (error) {
        logger.error('[PerAccountKillSwitch] Failed to connect to database', error);
        this.pool = null;
      }
    }
  }

  /**
   * Register account configuration
   */
  registerAccount(account: AccountInfo): void {
    this.accountConfigs.set(account.id, account.killSwitch);
    this.states.set(account.id, {
      accountId: account.id,
      active: false,
      reasons: [],
      activatedAt: null,
    });

    // Load latest state from database
    this.loadLatestState(account.id);
  }

  /**
   * Evaluate kill switch for account
   */
  async evaluate(
    account: AccountInfo,
    context: AccountKillSwitchContext
  ): Promise<{ blocked: boolean; active: boolean; reasons: string[] }> {
    const killSwitchConfig = account.killSwitch;

    if (!killSwitchConfig.enabled) {
      return { blocked: false, active: false, reasons: [] };
    }

    const reasons: string[] = [];
    const state = this.states.get(account.id) || {
      accountId: account.id,
      active: false,
      reasons: [],
      activatedAt: null,
    };

    // Check daily drawdown limit
    if (Math.abs(context.todayRealizedPnL) >= killSwitchConfig.dailyDDLimit) {
      reasons.push(
        `Daily drawdown limit exceeded: ${Math.abs(context.todayRealizedPnL).toFixed(2)} >= ${killSwitchConfig.dailyDDLimit}`
      );
    }

    // Check weekly drawdown limit
    if (killSwitchConfig.weeklyDDLimit && context.weeklyRealizedPnL) {
      if (Math.abs(context.weeklyRealizedPnL) >= killSwitchConfig.weeklyDDLimit) {
        reasons.push(
          `Weekly drawdown limit exceeded: ${Math.abs(context.weeklyRealizedPnL).toFixed(2)} >= ${killSwitchConfig.weeklyDDLimit}`
        );
      }
    }

    // Check consecutive losses
    if (killSwitchConfig.maxConsecutiveLosses && context.consecutiveLosses >= killSwitchConfig.maxConsecutiveLosses) {
      reasons.push(
        `Max consecutive losses reached: ${context.consecutiveLosses} >= ${killSwitchConfig.maxConsecutiveLosses}`
      );
    }

    // Check spread - use configurable threshold with per-symbol support
    const symbolMaxSpread = this.getMaxSpreadForSymbol(context.symbol, killSwitchConfig.maxSpreadPips);
    const env = process.env.NODE_ENV || 'development';
    
    // Use > instead of >= to allow trades when spread exactly equals threshold (edge case handling)
    if (symbolMaxSpread && context.currentSpreadPips > symbolMaxSpread) {
      logger.warn(
        `[PerAccountKillSwitch] [${account.id}/${context.symbol}] Spread too high: ${context.currentSpreadPips.toFixed(1)} > ${symbolMaxSpread} pips (env=${env})`
      );
      reasons.push(
        `Spread too high: ${context.currentSpreadPips.toFixed(1)} > ${symbolMaxSpread} pips`
      );
    } else if (symbolMaxSpread) {
      logger.debug(
        `[PerAccountKillSwitch] [${account.id}/${context.symbol}] Spread check: ${context.currentSpreadPips.toFixed(1)} < ${symbolMaxSpread} pips (OK)`
      );
    }

    // Check exposure
    if (killSwitchConfig.maxExposure && context.currentExposure >= killSwitchConfig.maxExposure) {
      reasons.push(
        `Exposure too high: ${context.currentExposure.toFixed(2)} >= ${killSwitchConfig.maxExposure}`
      );
    }

    const shouldBeActive = reasons.length > 0;
    const wasActive = state.active;

    // If kill switch should be activated and wasn't before
    if (shouldBeActive && !wasActive) {
      await this.activate(account.id, reasons);
    } else if (!shouldBeActive && wasActive) {
      // Kill switch should be cleared
      await this.deactivate(account.id);
    }

    return {
      blocked: shouldBeActive,
      active: shouldBeActive,
      reasons: shouldBeActive ? reasons : [],
    };
  }

  /**
   * Check if account is currently blocked
   */
  isBlocked(accountId: string): boolean {
    const state = this.states.get(accountId);
    return state?.active || false;
  }

  /**
   * Get kill switch state for account
   */
  getState(accountId: string): AccountKillSwitchState | undefined {
    return this.states.get(accountId);
  }

  /**
   * Manually activate kill switch
   */
  async activate(accountId: string, reasons: string[]): Promise<void> {
    const state = this.states.get(accountId);
    if (!state) {
      logger.warn(`[PerAccountKillSwitch] Cannot activate kill switch for unknown account: ${accountId}`);
      return;
    }

    state.active = true;
    state.reasons = reasons;
    state.activatedAt = new Date();

    // Persist to database
    await this.logKillSwitchEvent(accountId, 'activated', reasons.join('; '));

    logger.warn(`[PerAccountKillSwitch] Kill switch activated for ${accountId}: ${reasons.join('; ')}`);
  }

  /**
   * Deactivate kill switch
   */
  async deactivate(accountId: string): Promise<void> {
    const state = this.states.get(accountId);
    if (!state) {
      return;
    }

    const wasActive = state.active;
    state.active = false;
    state.reasons = [];
    state.activatedAt = null;

    if (wasActive) {
      await this.logKillSwitchEvent(accountId, 'deactivated', 'Conditions cleared');
      logger.info(`[PerAccountKillSwitch] Kill switch deactivated for ${accountId}`);
    }
  }

  /**
   * Initialize database tables
   */
  private async initializeDatabase(): Promise<void> {
    if (!this.pool) {
      return;
    }

    try {
      // Create account_kill_switch_events table
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS account_kill_switch_events (
          id BIGSERIAL PRIMARY KEY,
          account_id VARCHAR(64) NOT NULL,
          event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('activated', 'deactivated')),
          reason TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_account_kill_switch_events_account_id 
        ON account_kill_switch_events(account_id)
      `);

      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_account_kill_switch_events_created_at 
        ON account_kill_switch_events(created_at DESC)
      `);

      logger.info('[PerAccountKillSwitch] Database tables initialized');
    } catch (error) {
      logger.error('[PerAccountKillSwitch] Failed to initialize database', error);
    }
  }

  /**
   * Load latest state from database
   */
  private async loadLatestState(accountId: string): Promise<void> {
    if (!this.pool) {
      return;
    }

    try {
      // Check if there's an active kill switch event
      const result = await this.pool.query(
        `SELECT event_type, reason, created_at
         FROM account_kill_switch_events
         WHERE account_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [accountId]
      );

      if (result.rows.length > 0 && result.rows[0].event_type === 'activated') {
        const state = this.states.get(accountId);
        if (state) {
          state.active = true;
          state.reasons = [result.rows[0].reason || 'Kill switch active'];
          state.activatedAt = new Date(result.rows[0].created_at);
        }
      }
    } catch (error) {
      logger.error(`[PerAccountKillSwitch] Failed to load state for ${accountId}`, error);
    }
  }

  /**
   * Log kill switch event to database
   */
  private async logKillSwitchEvent(
    accountId: string,
    eventType: 'activated' | 'deactivated',
    reason: string
  ): Promise<void> {
    if (!this.pool) {
      return;
    }

    try {
      await this.pool.query(
        `INSERT INTO account_kill_switch_events (account_id, event_type, reason)
         VALUES ($1, $2, $3)`,
        [accountId, eventType, reason]
      );
    } catch (error) {
      logger.error(`[PerAccountKillSwitch] Failed to log event for ${accountId}`, error);
    }
  }

  /**
   * Get max spread threshold for a symbol
   * Priority: per-symbol override > account config > environment default
   */
  private getMaxSpreadForSymbol(symbol: string, accountMaxSpread?: number): number | undefined {
    const normalizedSymbol = symbol.toUpperCase();
    
    // Check per-symbol override first
    if (this.spreadConfig.perSymbol && this.spreadConfig.perSymbol[normalizedSymbol] !== undefined) {
      return this.spreadConfig.perSymbol[normalizedSymbol];
    }
    
    // Check account config second
    if (accountMaxSpread !== undefined && accountMaxSpread !== null) {
      return accountMaxSpread;
    }
    
    // Use environment-based default last
    return this.spreadConfig.defaultMaxSpreadPips;
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

