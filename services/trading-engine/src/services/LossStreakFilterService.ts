/**
 * Loss Streak Filter Service - Per-Symbol Loss Streak Tracking & Filtering
 * 
 * Tracks consecutive losses per symbol and pauses trading when thresholds are exceeded:
 * - 2 consecutive losses: pause for 6 hours
 * - 3 consecutive losses within a day: pause for the rest of the day
 * 
 * Helps reduce drawdown during losing streaks by temporarily pausing trades per symbol.
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';

const logger = new Logger('LossStreakFilterService');

export interface LossStreakState {
  symbol: string;
  consecutiveLosses: number;
  lastLossTime: Date | null;
  pausedUntil: Date | null;
  pausedReason: string | null;
}

export interface LossStreakCheckResult {
  allowed: boolean;
  reason?: string;
  consecutiveLosses: number;
  pausedUntil?: Date;
}

export class LossStreakFilterService {
  private pool: Pool | null;
  private inMemoryState: Map<string, LossStreakState> = new Map();
  private config: {
    enabled: boolean;
    pauseAfterConsecutiveLosses: number; // Default: 2
    pauseDurationHours: number; // Default: 6
    pauseAfterDailyLosses: number; // Default: 3
  };

  constructor(databaseUrl?: string) {
    this.config = {
      enabled: process.env.LOSS_STREAK_FILTER_ENABLED !== 'false',
      pauseAfterConsecutiveLosses: parseInt(process.env.LOSS_STREAK_PAUSE_AFTER || '2', 10),
      pauseDurationHours: parseInt(process.env.LOSS_STREAK_PAUSE_HOURS || '6', 10),
      pauseAfterDailyLosses: parseInt(process.env.LOSS_STREAK_PAUSE_DAILY || '3', 10),
    };

    // Initialize database connection if URL provided
    if (databaseUrl) {
      try {
        this.pool = new Pool({
          connectionString: databaseUrl,
          ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        });
        
        this.pool.on('error', (err) => {
          logger.error('[LossStreakFilter] Database pool error (non-fatal):', err);
        });
        
        this.initializeDatabase();
        logger.info('[LossStreakFilter] Connected to Postgres for loss streak tracking');
      } catch (error) {
        logger.error('[LossStreakFilter] Failed to connect to Postgres', error);
        this.pool = null;
      }
    } else {
      this.pool = null;
      logger.info('[LossStreakFilter] Using in-memory state only (no database URL provided)');
    }

    logger.info(
      `[LossStreakFilter] Initialized: enabled=${this.config.enabled}, ` +
      `pause_after=${this.config.pauseAfterConsecutiveLosses} losses, ` +
      `pause_duration=${this.config.pauseDurationHours}h, ` +
      `pause_daily_after=${this.config.pauseAfterDailyLosses} losses`
    );
  }

  /**
   * Initialize database table for loss streak tracking
   */
  private async initializeDatabase(): Promise<void> {
    if (!this.pool) return;

    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS symbol_loss_streaks (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(20) NOT NULL,
          consecutive_losses INTEGER NOT NULL DEFAULT 0,
          last_loss_time TIMESTAMPTZ,
          paused_until TIMESTAMPTZ,
          paused_reason TEXT,
          last_updated TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(symbol)
        );
        
        CREATE INDEX IF NOT EXISTS idx_symbol_loss_streaks_symbol ON symbol_loss_streaks(symbol);
        CREATE INDEX IF NOT EXISTS idx_symbol_loss_streaks_paused_until ON symbol_loss_streaks(paused_until);
      `);
      logger.info('[LossStreakFilter] Database table initialized');
    } catch (error) {
      logger.error('[LossStreakFilter] Failed to initialize database table', error);
    }
  }

  /**
   * Check if trading is allowed for a symbol (considers loss streak state)
   */
  async checkLossStreak(symbol: string): Promise<LossStreakCheckResult> {
    if (!this.config.enabled) {
      return { allowed: true, consecutiveLosses: 0 };
    }

    try {
      const state = await this.getLossStreakState(symbol);
      const now = new Date();

      // Check if symbol is currently paused
      if (state.pausedUntil && now < state.pausedUntil) {
        const remainingMinutes = Math.ceil((state.pausedUntil.getTime() - now.getTime()) / 1000 / 60);
        return {
          allowed: false,
          reason: `Loss streak pause active: ${state.consecutiveLosses} consecutive losses, paused until ${state.pausedUntil.toISOString()} (${remainingMinutes} minutes remaining)`,
          consecutiveLosses: state.consecutiveLosses,
          pausedUntil: state.pausedUntil,
        };
      }

      // Check if pause period has expired
      if (state.pausedUntil && now >= state.pausedUntil) {
        // Reset pause state
        state.pausedUntil = null;
        state.pausedReason = null;
        await this.saveLossStreakState(state);
      }

      // All checks passed
      return {
        allowed: true,
        consecutiveLosses: state.consecutiveLosses,
      };
    } catch (error) {
      logger.error(`[LossStreakFilter] Error checking loss streak for ${symbol}`, error);
      // On error, allow trading (fail-open for safety)
      return { allowed: true, consecutiveLosses: 0 };
    }
  }

  /**
   * Record a loss for a symbol (called after a trade closes with a loss)
   */
  async recordLoss(symbol: string): Promise<void> {
    if (!this.config.enabled) return;

    try {
      const state = await this.getLossStreakState(symbol);
      const now = new Date();
      
      state.consecutiveLosses += 1;
      state.lastLossTime = now;

      // Check if we need to pause
      if (state.consecutiveLosses >= this.config.pauseAfterDailyLosses) {
        // 3+ losses within a day: pause for the rest of the day
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);
        state.pausedUntil = endOfDay;
        state.pausedReason = `${state.consecutiveLosses} consecutive losses within day - pausing until end of day`;
        
        logger.warn(
          `[LossStreakFilter] ${symbol}: ${state.consecutiveLosses} consecutive losses - ` +
          `pausing until end of day (${endOfDay.toISOString()})`
        );
      } else if (state.consecutiveLosses >= this.config.pauseAfterConsecutiveLosses) {
        // 2 consecutive losses: pause for 6 hours
        const pauseUntil = new Date(now.getTime() + this.config.pauseDurationHours * 60 * 60 * 1000);
        state.pausedUntil = pauseUntil;
        state.pausedReason = `${state.consecutiveLosses} consecutive losses - pausing for ${this.config.pauseDurationHours} hours`;
        
        logger.warn(
          `[LossStreakFilter] ${symbol}: ${state.consecutiveLosses} consecutive losses - ` +
          `pausing for ${this.config.pauseDurationHours} hours until ${pauseUntil.toISOString()}`
        );
      }

      await this.saveLossStreakState(state);
    } catch (error) {
      logger.error(`[LossStreakFilter] Error recording loss for ${symbol}`, error);
    }
  }

  /**
   * Record a win for a symbol (resets consecutive loss counter)
   */
  async recordWin(symbol: string): Promise<void> {
    if (!this.config.enabled) return;

    try {
      const state = await this.getLossStreakState(symbol);
      
      // Reset streak on win
      if (state.consecutiveLosses > 0) {
        state.consecutiveLosses = 0;
        state.lastLossTime = null;
        state.pausedUntil = null;
        state.pausedReason = null;
        await this.saveLossStreakState(state);
        
        logger.info(`[LossStreakFilter] ${symbol}: Win recorded - loss streak reset`);
      }
    } catch (error) {
      logger.error(`[LossStreakFilter] Error recording win for ${symbol}`, error);
    }
  }

  /**
   * Get loss streak state for a symbol (from DB or in-memory cache)
   */
  private async getLossStreakState(symbol: string): Promise<LossStreakState> {
    const upperSymbol = symbol.toUpperCase();
    
    // Check in-memory cache first
    if (this.inMemoryState.has(upperSymbol)) {
      return this.inMemoryState.get(upperSymbol)!;
    }

    // Try to load from database
    if (this.pool) {
      try {
        const result = await this.pool.query(
          `SELECT * FROM symbol_loss_streaks WHERE symbol = $1`,
          [upperSymbol]
        );

        if (result.rows.length > 0) {
          const row = result.rows[0];
          const state: LossStreakState = {
            symbol: upperSymbol,
            consecutiveLosses: row.consecutive_losses || 0,
            lastLossTime: row.last_loss_time ? new Date(row.last_loss_time) : null,
            pausedUntil: row.paused_until ? new Date(row.paused_until) : null,
            pausedReason: row.paused_reason || null,
          };
          this.inMemoryState.set(upperSymbol, state);
          return state;
        }
      } catch (error) {
        logger.error(`[LossStreakFilter] Error loading state for ${symbol} from DB`, error);
      }
    }

    // Return default state if not found
    const defaultState: LossStreakState = {
      symbol: upperSymbol,
      consecutiveLosses: 0,
      lastLossTime: null,
      pausedUntil: null,
      pausedReason: null,
    };
    this.inMemoryState.set(upperSymbol, defaultState);
    return defaultState;
  }

  /**
   * Save loss streak state to database (and update in-memory cache)
   */
  private async saveLossStreakState(state: LossStreakState): Promise<void> {
    this.inMemoryState.set(state.symbol, state);

    if (this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO symbol_loss_streaks (symbol, consecutive_losses, last_loss_time, paused_until, paused_reason, last_updated)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (symbol) DO UPDATE SET
             consecutive_losses = EXCLUDED.consecutive_losses,
             last_loss_time = EXCLUDED.last_loss_time,
             paused_until = EXCLUDED.paused_until,
             paused_reason = EXCLUDED.paused_reason,
             last_updated = NOW()`,
          [
            state.symbol,
            state.consecutiveLosses,
            state.lastLossTime,
            state.pausedUntil,
            state.pausedReason,
          ]
        );
      } catch (error) {
        logger.error(`[LossStreakFilter] Error saving state for ${state.symbol} to DB`, error);
      }
    }
  }

  /**
   * Reset loss streak for a symbol (utility method)
   */
  async resetLossStreak(symbol: string): Promise<void> {
    try {
      const state = await this.getLossStreakState(symbol);
      state.consecutiveLosses = 0;
      state.lastLossTime = null;
      state.pausedUntil = null;
      state.pausedReason = null;
      await this.saveLossStreakState(state);
      logger.info(`[LossStreakFilter] ${symbol}: Loss streak reset manually`);
    } catch (error) {
      logger.error(`[LossStreakFilter] Error resetting loss streak for ${symbol}`, error);
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('[LossStreakFilter] Database connection closed');
    }
  }
}

