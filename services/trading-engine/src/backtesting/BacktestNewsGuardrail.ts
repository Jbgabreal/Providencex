/**
 * BacktestNewsGuardrail - Checks news guardrail for historical dates during backtesting
 * 
 * Queries the daily_news_windows table to check if a trade timestamp falls within
 * an avoid window for that date, preventing trades during high-impact news events.
 */

import { Pool } from 'pg';
import axios from 'axios';
import { Logger, formatDateForPX, parseToPXTimezone, isTimeInWindow } from '@providencex/shared-utils';
import { NewsWindow, DailyNewsMap } from '@providencex/shared-types';
import { GuardrailMode } from '../types';
import { getConfig } from '../config';

const logger = new Logger('BacktestNewsGuardrail');

export interface BacktestGuardrailDecision {
  can_trade: boolean;
  inside_avoid_window: boolean;
  active_window: NewsWindow | null;
  mode: GuardrailMode;
  reason_summary: string;
}

/**
 * BacktestNewsGuardrail - Checks news guardrail for historical dates
 */
export class BacktestNewsGuardrail {
  private pool: Pool | null = null;
  private newsCache: Map<string, NewsWindow[]> = new Map(); // Cache news data by date
  private newsGuardrailUrl: string | null = null;
  private apiFallbackDisabled = false; // Track if API fallback should be disabled

  constructor(databaseUrl?: string, newsGuardrailUrl?: string) {
    if (databaseUrl) {
      try {
        this.pool = new Pool({
          connectionString: databaseUrl,
          ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        });
        
        this.pool.on('error', (err) => {
          logger.error('[BacktestNewsGuardrail] Database pool error (non-fatal):', err);
        });
        
        logger.info('[BacktestNewsGuardrail] Connected to Postgres for news guardrail checks');
      } catch (error) {
        logger.error('[BacktestNewsGuardrail] Failed to connect to Postgres', error);
      }
    } else {
      logger.warn('[BacktestNewsGuardrail] No DATABASE_URL provided - will try API endpoint fallback');
    }

    // Get news guardrail URL from config or parameter
    this.newsGuardrailUrl = newsGuardrailUrl || getConfig().newsGuardrailUrl || null;
    if (this.newsGuardrailUrl) {
      logger.info(`[BacktestNewsGuardrail] News guardrail API endpoint: ${this.newsGuardrailUrl}`);
    }
  }

  /**
   * Get news windows for a specific date (YYYY-MM-DD format in NY timezone)
   * 
   * Flow:
   * 1. Check cache first
   * 2. Try database query
   * 3. If not found in DB, try API endpoint as fallback
   * 4. Cache the result (even if empty)
   */
  async getNewsWindowsForDate(dateStr: string): Promise<NewsWindow[]> {
    // Check cache first
    if (this.newsCache.has(dateStr)) {
      return this.newsCache.get(dateStr)!;
    }

    let avoidWindows: NewsWindow[] = [];

    // Step 1: Try database query
    if (this.pool) {
      try {
        const result = await this.pool.query(
          'SELECT avoid_windows FROM daily_news_windows WHERE date = $1',
          [dateStr]
        );

        if (result.rows.length > 0) {
          avoidWindows = result.rows[0].avoid_windows as NewsWindow[];
          logger.debug(`[BacktestNewsGuardrail] Found ${avoidWindows.length} news windows for ${dateStr} in database`);
        }
      } catch (error) {
        logger.warn(`[BacktestNewsGuardrail] Database query failed for ${dateStr}, trying API fallback:`, error);
      }
    }

    // Step 2: If not found in DB, try API endpoint as fallback (if not disabled)
    if (avoidWindows.length === 0 && this.newsGuardrailUrl && !this.apiFallbackDisabled) {
      try {
        const response = await axios.get<DailyNewsMap>(
          `${this.newsGuardrailUrl}/news-map/${dateStr}`,
          { timeout: 2000 } // 2 second timeout (reduced from 5s to prevent backtest slowdown)
        );

        if (response.data && response.data.avoid_windows) {
          avoidWindows = response.data.avoid_windows;
          logger.info(`[BacktestNewsGuardrail] Fetched ${avoidWindows.length} news windows for ${dateStr} from API endpoint`);
          
          // Optionally save to database for future use (async, don't wait)
          if (this.pool && avoidWindows.length > 0) {
            this.saveNewsWindowsToDatabase(dateStr, avoidWindows).catch(err => {
              logger.warn(`[BacktestNewsGuardrail] Failed to save news windows to database:`, err);
            });
          }
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          if (error.response?.status === 404) {
            logger.debug(`[BacktestNewsGuardrail] No news data available for ${dateStr} (neither in DB nor API)`);
          } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
            // API service is down or unreachable - disable API fallback for this session
            logger.warn(`[BacktestNewsGuardrail] API endpoint unreachable (${error.code}) - disabling API fallback for this backtest session`);
            this.apiFallbackDisabled = true; // Disable API fallback to prevent further delays
          } else {
            logger.warn(`[BacktestNewsGuardrail] API endpoint failed for ${dateStr}:`, error.message);
          }
        } else {
          logger.warn(`[BacktestNewsGuardrail] API endpoint error for ${dateStr}:`, error);
        }
      }
    }

    // Cache the result (even if empty) to avoid repeated queries
    this.newsCache.set(dateStr, avoidWindows);
    return avoidWindows;
  }

  /**
   * Save news windows to database (for caching)
   */
  private async saveNewsWindowsToDatabase(dateStr: string, avoidWindows: NewsWindow[]): Promise<void> {
    if (!this.pool) return;

    try {
      await this.pool.query(
        `INSERT INTO daily_news_windows (date, avoid_windows, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (date) 
         DO UPDATE SET avoid_windows = $2::jsonb, updated_at = NOW()`,
        [dateStr, JSON.stringify(avoidWindows)]
      );
      logger.debug(`[BacktestNewsGuardrail] Saved news windows for ${dateStr} to database`);
    } catch (error) {
      // Non-fatal - just log warning
      logger.warn(`[BacktestNewsGuardrail] Failed to save news windows to database:`, error);
    }
  }

  /**
   * Check if a timestamp falls within any avoid window for that date
   */
  async checkCanTrade(timestamp: number, strategy?: 'low' | 'high'): Promise<BacktestGuardrailDecision> {
    if (!this.pool) {
      // No database - allow all trades
      return {
        can_trade: true,
        inside_avoid_window: false,
        active_window: null,
        mode: 'normal',
        reason_summary: 'News guardrail disabled (no database connection)',
      };
    }

    try {
      // Convert timestamp to NY timezone date string (YYYY-MM-DD)
      const date = new Date(timestamp);
      const isoString = date.toISOString();
      // Parse and convert to PX timezone, then format as date
      const nyDate = parseToPXTimezone(isoString);
      const dateStr = formatDateForPX(nyDate); // YYYY-MM-DD

      // Get news windows for this date
      const avoidWindows = await this.getNewsWindowsForDate(dateStr);

      if (avoidWindows.length === 0) {
        return {
          can_trade: true,
          inside_avoid_window: false,
          active_window: null,
          mode: 'normal',
          reason_summary: 'No news events for this date',
        };
      }

      // Check if timestamp falls within any avoid window
      // Convert timestamp to DateTime in PX timezone for comparison
      const timestampDate = parseToPXTimezone(new Date(timestamp).toISOString());
      
      for (const window of avoidWindows) {
        // Use isTimeInWindow helper which handles timezone conversion
        if (isTimeInWindow(timestampDate, window.start_time, window.end_time)) {
          // Inside an avoid window
          const mode: GuardrailMode = window.is_critical || window.risk_score >= 80
            ? 'blocked'
            : window.risk_score >= 60
            ? 'reduced'
            : 'normal';

          const reason = window.is_critical
            ? `CRITICAL: ${window.event_name} (${window.currency}, risk: ${window.risk_score})`
            : `News event: ${window.event_name} (${window.currency}, risk: ${window.risk_score})`;

          return {
            can_trade: mode !== 'blocked',
            inside_avoid_window: true,
            active_window: window,
            mode,
            reason_summary: reason,
          };
        }
      }

      // Not inside any avoid window
      return {
        can_trade: true,
        inside_avoid_window: false,
        active_window: null,
        mode: 'normal',
        reason_summary: 'No active news windows at this time',
      };
    } catch (error) {
      logger.error(`[BacktestNewsGuardrail] Error checking news guardrail:`, error);
      // Fail-safe: allow trades if check fails
      return {
        can_trade: true,
        inside_avoid_window: false,
        active_window: null,
        mode: 'normal',
        reason_summary: 'News guardrail check failed - allowing trade',
      };
    }
  }

  /**
   * Clear cache (useful for long backtests)
   */
  clearCache(): void {
    this.newsCache.clear();
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.newsCache.clear();
      logger.info('[BacktestNewsGuardrail] Database connection closed');
    }
  }
}

