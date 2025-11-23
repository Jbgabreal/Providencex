/**
 * KillSwitchService (Trading Engine v8)
 * 
 * Evaluates kill switch conditions based on PnL, trade counts, exposure, and spread.
 * Maintains in-memory state and persists transitions to database.
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getKillSwitchConfig } from '@providencex/shared-config';
import { getConfig } from '../config';
import { OpenTradesService, ExposureSnapshot, GlobalSnapshot } from './OpenTradesService';
import { PriceFeedClient, Tick } from '../marketData';
import { getNowInPXTimezone } from '@providencex/shared-utils';
import { LivePnlService } from './LivePnlService';

const logger = new Logger('KillSwitchService');

export interface KillSwitchState {
  active: boolean;
  reasons: string[];
  activatedAt?: Date;
  scope: 'global' | 'symbol' | 'strategy'; // v8 starts with global only
}

export interface KillSwitchEvaluationContext {
  symbol: string;
  strategy: string;
  latestTick?: Tick;
  exposureSnapshot?: ExposureSnapshot;
  globalExposure?: GlobalSnapshot;
  now: Date;
}

export interface KillSwitchEvaluationResult {
  blocked: boolean;
  active: boolean;
  reasons: string[];
}

export class KillSwitchService {
  private pool: Pool | null = null;
  private useDatabase: boolean = false;
  private config: ReturnType<typeof getKillSwitchConfig>;
  private state: KillSwitchState;
  private livePnlService?: LivePnlService;
  private openTradesService?: OpenTradesService;
  private lastDailyReset: string = ''; // YYYY-MM-DD
  private lastWeeklyReset: string = ''; // YYYY-WW (ISO week)

  constructor(
    databaseUrl: string,
    livePnlService?: LivePnlService,
    openTradesService?: OpenTradesService
  ) {
    this.config = getKillSwitchConfig();
    this.state = {
      active: false,
      reasons: [],
      scope: 'global',
    };
    this.livePnlService = livePnlService;
    this.openTradesService = openTradesService;

    // Only use database if kill switch is enabled
    this.useDatabase = this.config.enabled && !!databaseUrl;

    if (this.useDatabase) {
      try {
        this.pool = new Pool({
          connectionString: databaseUrl,
          ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        });
        
        // Handle pool errors gracefully (prevent app crash)
        this.pool.on('error', (err) => {
          logger.error('[KillSwitchService] Database pool error (non-fatal):', err);
          // Don't crash the app - just log the error
        });
        
        this.initializeDatabase();
        this.loadLatestState();
        logger.info('[KillSwitchService] Connected to Postgres');
      } catch (error) {
        logger.error('[KillSwitchService] Failed to connect to Postgres', error);
        this.useDatabase = false;
      }
    }

    if (!this.config.enabled) {
      logger.info('[KillSwitchService] Disabled (KILL_SWITCH_ENABLED=false)');
    } else {
      logger.info(
        `[KillSwitchService] Enabled. State: ${this.state.active ? 'ACTIVE' : 'INACTIVE'}, ` +
        `Reasons: [${this.state.reasons.join(', ')}]`
      );
    }
  }

  /**
   * Initialize database tables (create if not exist)
   */
  private async initializeDatabase(): Promise<void> {
    if (!this.pool) return;

    try {
      const migrationSQL = `
        CREATE TABLE IF NOT EXISTS kill_switch_events (
          id              BIGSERIAL PRIMARY KEY,
          timestamp       TIMESTAMPTZ NOT NULL,
          scope           VARCHAR(32) NOT NULL,
          symbol          VARCHAR(20),
          strategy        VARCHAR(32),
          active          BOOLEAN NOT NULL,
          reasons         JSONB NOT NULL,
          created_at      TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_kill_switch_events_timestamp ON kill_switch_events(timestamp);
        CREATE INDEX IF NOT EXISTS idx_kill_switch_events_scope ON kill_switch_events(scope);

        ALTER TABLE trade_decisions
          ADD COLUMN IF NOT EXISTS kill_switch_active BOOLEAN,
          ADD COLUMN IF NOT EXISTS kill_switch_reasons JSONB;
      `;

      await this.pool.query(migrationSQL);
      logger.info('[KillSwitchService] Database tables initialized');
    } catch (error) {
      logger.error('[KillSwitchService] Failed to initialize database tables', error);
      this.useDatabase = false;
    }
  }

  /**
   * Load latest kill switch state from database
   */
  private async loadLatestState(): Promise<void> {
    if (!this.pool) return;

    try {
      const result = await this.pool.query(
        `SELECT * FROM kill_switch_events
         WHERE scope = 'global'
         ORDER BY timestamp DESC
         LIMIT 1`
      );

      if (result.rows.length > 0) {
        const row = result.rows[0];
        this.state = {
          active: row.active,
          reasons: Array.isArray(row.reasons) ? row.reasons : [],
          activatedAt: row.active ? new Date(row.timestamp) : undefined,
          scope: 'global',
        };
        logger.info(
          `[KillSwitchService] Loaded state: ${this.state.active ? 'ACTIVE' : 'INACTIVE'}, ` +
          `Reasons: [${this.state.reasons.join(', ')}]`
        );
      }
    } catch (error) {
      logger.error('[KillSwitchService] Failed to load latest state', error);
    }
  }

  /**
   * Evaluate kill switch conditions for a trading decision
   */
  async evaluate(context: KillSwitchEvaluationContext): Promise<KillSwitchEvaluationResult> {
    // If kill switch is disabled, always return allowed
    if (!this.config.enabled) {
      return {
        blocked: false,
        active: false,
        reasons: [],
      };
    }

    // Check auto-resume conditions (daily/weekly boundaries)
    this.checkAutoResume(context.now);

    // If already active and not auto-resumed, return blocked
    if (this.state.active) {
      return {
        blocked: true,
        active: true,
        reasons: this.state.reasons,
      };
    }

    // Evaluate all conditions
    const reasons: string[] = [];

    // 1. Daily drawdown limit
    if (this.config.dailyMaxLossCurrency !== undefined || this.config.dailyMaxLossPercent !== undefined) {
      const dailyPnL = await this.getDailyPnL(context.now);
      if (this.config.dailyMaxLossCurrency !== undefined && dailyPnL <= -this.config.dailyMaxLossCurrency) {
        reasons.push(`Daily loss limit breached: ${dailyPnL.toFixed(2)} <= -${this.config.dailyMaxLossCurrency}`);
      }
      if (this.config.dailyMaxLossPercent !== undefined) {
        const startingEquity = await this.getStartingEquityForDay(context.now);
        if (startingEquity > 0 && (dailyPnL / startingEquity) * 100 <= -this.config.dailyMaxLossPercent) {
          reasons.push(
            `Daily loss % limit breached: ${((dailyPnL / startingEquity) * 100).toFixed(2)}% <= -${this.config.dailyMaxLossPercent}%`
          );
        }
      }
    }

    // 2. Weekly drawdown limit
    if (this.config.weeklyMaxLossCurrency !== undefined || this.config.weeklyMaxLossPercent !== undefined) {
      const weeklyPnL = await this.getWeeklyPnL(context.now);
      if (this.config.weeklyMaxLossCurrency !== undefined && weeklyPnL <= -this.config.weeklyMaxLossCurrency) {
        reasons.push(`Weekly loss limit breached: ${weeklyPnL.toFixed(2)} <= -${this.config.weeklyMaxLossCurrency}`);
      }
      if (this.config.weeklyMaxLossPercent !== undefined) {
        const startingEquity = await this.getStartingEquityForWeek(context.now);
        if (startingEquity > 0 && (weeklyPnL / startingEquity) * 100 <= -this.config.weeklyMaxLossPercent) {
          reasons.push(
            `Weekly loss % limit breached: ${((weeklyPnL / startingEquity) * 100).toFixed(2)}% <= -${this.config.weeklyMaxLossPercent}%`
          );
        }
      }
    }

    // 3. Max losing streak
    if (this.config.maxLosingStreak !== undefined) {
      const losingStreak = await this.getLosingStreak();
      if (losingStreak >= this.config.maxLosingStreak) {
        reasons.push(`Max losing streak breached: ${losingStreak} >= ${this.config.maxLosingStreak}`);
      }
    }

    // 4. Max daily trades
    if (this.config.maxDailyTrades !== undefined) {
      const dailyTrades = await this.getDailyTradeCount(context.now);
      if (dailyTrades >= this.config.maxDailyTrades) {
        reasons.push(`Max daily trades breached: ${dailyTrades} >= ${this.config.maxDailyTrades}`);
      }
    }

    // 5. Max weekly trades
    if (this.config.maxWeeklyTrades !== undefined) {
      const weeklyTrades = await this.getWeeklyTradeCount(context.now);
      if (weeklyTrades >= this.config.maxWeeklyTrades) {
        reasons.push(`Max weekly trades breached: ${weeklyTrades} >= ${this.config.maxWeeklyTrades}`);
      }
    }

    // 6. Max spread
    if (this.config.maxSpreadPoints !== undefined && context.latestTick) {
      const spread = context.latestTick.ask - context.latestTick.bid;
      const spreadPips = this.convertSpreadToPips(context.symbol, spread);
      if (spreadPips > this.config.maxSpreadPoints) {
        reasons.push(`Spread too high: ${spreadPips.toFixed(2)} pips > ${this.config.maxSpreadPoints} pips`);
      }
    }

    // 7. Max exposure risk
    if (this.config.maxExposureRiskCurrency !== undefined && context.globalExposure) {
      if (context.globalExposure.totalEstimatedRiskAmount > this.config.maxExposureRiskCurrency) {
        reasons.push(
          `Exposure too high: ${context.globalExposure.totalEstimatedRiskAmount.toFixed(2)} > ${this.config.maxExposureRiskCurrency}`
        );
      }
    }

    // 8. MT5 Connector health check (if multiple failures, activate)
    // This is handled externally via repeated failures in OpenTradesService

    // If any conditions met, activate kill switch
    if (reasons.length > 0) {
      await this.activate(reasons, context.now);
      return {
        blocked: true,
        active: true,
        reasons,
      };
    }

    // All checks passed
    return {
      blocked: false,
      active: false,
      reasons: [],
    };
  }

  /**
   * Activate kill switch
   */
  private async activate(reasons: string[], timestamp: Date): Promise<void> {
    if (this.state.active) {
      // Already active, just update reasons if they've changed
      if (reasons.length > 0 && JSON.stringify(reasons) !== JSON.stringify(this.state.reasons)) {
        this.state.reasons = reasons;
        await this.persistState(timestamp);
      }
      return;
    }

    this.state.active = true;
    this.state.reasons = reasons;
    this.state.activatedAt = timestamp;

    await this.persistState(timestamp);

    logger.warn(
      `[KillSwitchService] 🛑 KILL SWITCH ACTIVATED. Reasons: [${reasons.join('; ')}]`
    );
  }

  /**
   * Deactivate kill switch (for auto-resume or manual reset)
   */
  private async deactivate(reason: string, timestamp: Date): Promise<void> {
    if (!this.state.active) {
      return;
    }

    this.state.active = false;
    this.state.reasons = [];
    this.state.activatedAt = undefined;

    await this.persistState(timestamp, reason);

    logger.info(`[KillSwitchService] ✅ Kill switch DEACTIVATED. Reason: ${reason}`);
  }

  /**
   * Check auto-resume conditions (daily/weekly boundaries)
   */
  private checkAutoResume(now: Date): void {
    const timezone = this.config.timezone || 'America/New_York';
    const pxNow = getNowInPXTimezone().setZone(timezone);
    const today = pxNow.toFormat('yyyy-MM-dd');
    // ISO week format: yyyy-Www (e.g., 2025-W47)
    const weekNum = pxNow.weekNumber; // Get ISO week number
    const year = pxNow.year;
    const thisWeek = `${year}-W${weekNum.toString().padStart(2, '0')}`;

    // Daily reset
    if (this.config.autoResumeNextDay && this.lastDailyReset !== today) {
      if (this.state.active && this.lastDailyReset !== '') {
        // New day started, reset if enabled
        this.deactivate(`Auto-resume: new day (${today})`, now).catch((error) => {
          logger.error('[KillSwitchService] Failed to deactivate on daily reset', error);
        });
      }
      this.lastDailyReset = today;
    }

    // Weekly reset
    if (this.config.autoResumeNextWeek && this.lastWeeklyReset !== thisWeek) {
      if (this.state.active && this.lastWeeklyReset !== '') {
        // New week started, reset if enabled
        this.deactivate(`Auto-resume: new week (${thisWeek})`, now).catch((error) => {
          logger.error('[KillSwitchService] Failed to deactivate on weekly reset', error);
        });
      }
      this.lastWeeklyReset = thisWeek;
    }
  }

  /**
   * Persist kill switch state to database
   */
  private async persistState(timestamp: Date, deactivateReason?: string): Promise<void> {
    if (!this.pool) return;

    try {
      await this.pool.query(
        `INSERT INTO kill_switch_events (timestamp, scope, symbol, strategy, active, reasons)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          timestamp,
          this.state.scope,
          null, // Symbol (null for global scope)
          null, // Strategy (null for global scope)
          this.state.active,
          JSON.stringify(this.state.reasons),
        ]
      );
    } catch (error) {
      logger.error('[KillSwitchService] Failed to persist state', error);
    }
  }

  /**
   * Get current kill switch state
   */
  getState(): KillSwitchState {
    return { ...this.state };
  }

  /**
   * Manual reset (for admin API)
   */
  async manualReset(reason: string): Promise<void> {
    await this.deactivate(`Manual reset: ${reason}`, new Date());
  }

  // Helper methods for getting PnL and trade counts

  private async getDailyPnL(date: Date): Promise<number> {
    if (!this.livePnlService) return 0;
    
    const latestEquity = await this.livePnlService.getLatestEquity();
    return latestEquity?.closed_pnl_today || 0;
  }

  private async getWeeklyPnL(date: Date): Promise<number> {
    if (!this.livePnlService) return 0;
    
    const latestEquity = await this.livePnlService.getLatestEquity();
    return latestEquity?.closed_pnl_week || 0;
  }

  private async getStartingEquityForDay(date: Date): Promise<number> {
    if (!this.pool) return 10000; // Default fallback
    
    try {
      const pxDate = getNowInPXTimezone().setZone(this.config.timezone || 'America/New_York');
      const dayStart = pxDate.startOf('day').toJSDate();
      
      const result = await this.pool.query(
        `SELECT equity FROM live_equity
         WHERE timestamp >= $1
         ORDER BY timestamp ASC
         LIMIT 1`,
        [dayStart]
      );
      
      if (result.rows.length > 0) {
        return parseFloat(result.rows[0].equity);
      }
      
      // Fallback: use balance if no equity snapshot
      const latestEquity = await this.livePnlService?.getLatestEquity();
      return latestEquity?.balance || 10000;
    } catch (error) {
      logger.error('[KillSwitchService] Error getting starting equity for day', error);
      return 10000;
    }
  }

  private async getStartingEquityForWeek(date: Date): Promise<number> {
    if (!this.pool) return 10000; // Default fallback
    
    try {
      const pxDate = getNowInPXTimezone().setZone(this.config.timezone || 'America/New_York');
      const weekStart = pxDate.startOf('week').toJSDate();
      
      const result = await this.pool.query(
        `SELECT equity FROM live_equity
         WHERE timestamp >= $1
         ORDER BY timestamp ASC
         LIMIT 1`,
        [weekStart]
      );
      
      if (result.rows.length > 0) {
        return parseFloat(result.rows[0].equity);
      }
      
      // Fallback: use balance if no equity snapshot
      const latestEquity = await this.livePnlService?.getLatestEquity();
      return latestEquity?.balance || 10000;
    } catch (error) {
      logger.error('[KillSwitchService] Error getting starting equity for week', error);
      return 10000;
    }
  }

  private async getLosingStreak(): Promise<number> {
    if (!this.pool) return 0;
    
    try {
      const result = await this.pool.query(
        `SELECT profit_net FROM live_trades
         ORDER BY exit_time DESC
         LIMIT 20`
      );
      
      let streak = 0;
      for (const row of result.rows) {
        if (parseFloat(row.profit_net || '0') < 0) {
          streak++;
        } else {
          break; // Streak broken by winning trade
        }
      }
      
      return streak;
    } catch (error) {
      logger.error('[KillSwitchService] Error getting losing streak', error);
      return 0;
    }
  }

  private async getDailyTradeCount(date: Date): Promise<number> {
    if (!this.pool) return 0;
    
    try {
      const pxDate = getNowInPXTimezone().setZone(this.config.timezone || 'America/New_York');
      const dayStart = pxDate.startOf('day').toJSDate();
      const dayEnd = pxDate.endOf('day').toJSDate();
      
      const result = await this.pool.query(
        `SELECT COUNT(*) as count FROM trade_decisions
         WHERE timestamp >= $1 AND timestamp <= $2 AND decision = 'trade'`,
        [dayStart, dayEnd]
      );
      
      return parseInt(result.rows[0]?.count || '0', 10);
    } catch (error) {
      logger.error('[KillSwitchService] Error getting daily trade count', error);
      return 0;
    }
  }

  private async getWeeklyTradeCount(date: Date): Promise<number> {
    if (!this.pool) return 0;
    
    try {
      const pxDate = getNowInPXTimezone().setZone(this.config.timezone || 'America/New_York');
      const weekStart = pxDate.startOf('week').toJSDate();
      const weekEnd = pxDate.endOf('week').toJSDate();
      
      const result = await this.pool.query(
        `SELECT COUNT(*) as count FROM trade_decisions
         WHERE timestamp >= $1 AND timestamp <= $2 AND decision = 'trade'`,
        [weekStart, weekEnd]
      );
      
      return parseInt(result.rows[0]?.count || '0', 10);
    } catch (error) {
      logger.error('[KillSwitchService] Error getting weekly trade count', error);
      return 0;
    }
  }

  private convertSpreadToPips(symbol: string, spread: number): number {
    // Simplified conversion - can be improved
    if (symbol.includes('USD') && symbol.length === 6) {
      // Major FX pairs
      return spread / 0.0001;
    } else if (symbol.includes('XAU')) {
      // Gold
      return spread / 0.1;
    } else if (symbol.includes('US30')) {
      // US30
      return spread / 1.0;
    }
    return spread;
  }

  /**
   * Cleanup: Close database connection
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.useDatabase = false;
      logger.info('[KillSwitchService] Database connection closed');
    }
  }
}

