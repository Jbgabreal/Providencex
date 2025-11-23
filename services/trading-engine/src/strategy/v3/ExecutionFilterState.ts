/**
 * Execution Filter State Helper
 * 
 * Queries database and MT5 for execution filter context data:
 * - Today's trade count per symbol/strategy
 * - Last trade timestamp per symbol/strategy
 * - Open trades per symbol
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../../config';
import { Strategy } from '../../types';

const logger = new Logger('ExecutionFilterState');

export class ExecutionFilterState {
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
          logger.error('[ExecutionFilterState] Database pool error (non-fatal):', err);
          // Don't crash the app - just log the error
        });
        
        this.useDatabase = true;
        logger.info('ExecutionFilterState: Using Postgres for state queries');
      } catch (error) {
        logger.warn('ExecutionFilterState: Database connection failed, using in-memory fallback', error);
        this.useDatabase = false;
      }
    } else {
      logger.info('ExecutionFilterState: No DATABASE_URL, using in-memory fallback');
    }
  }

  /**
   * Get count of trades taken today for a symbol and strategy
   */
  async getTodayTradeCount(symbol: string, strategy: Strategy): Promise<number> {
    if (!this.useDatabase || !this.pool) {
      // Fallback: return 0 (allow trades if no DB)
      return 0;
    }

    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const query = `
        SELECT COUNT(*) as count
        FROM trade_decisions
        WHERE symbol = $1
          AND strategy = $2
          AND decision = 'trade'
          AND DATE(timestamp) = $3
      `;

      const result = await this.pool.query(query, [symbol.toUpperCase(), strategy, today]);
      return parseInt(result.rows[0]?.count || '0', 10);
    } catch (error) {
      logger.error(`Error getting today trade count for ${symbol}/${strategy}`, error);
      return 0; // Fail safe: allow trades if query fails
    }
  }

  /**
   * Get timestamp of last trade for a symbol and strategy
   * Returns null if no trades found
   */
  async getLastTradeTimestamp(symbol: string, strategy: Strategy): Promise<Date | null> {
    if (!this.useDatabase || !this.pool) {
      return null;
    }

    try {
      const query = `
        SELECT timestamp
        FROM trade_decisions
        WHERE symbol = $1
          AND strategy = $2
          AND decision = 'trade'
        ORDER BY timestamp DESC
        LIMIT 1
      `;

      const result = await this.pool.query(query, [symbol.toUpperCase(), strategy]);
      if (result.rows.length === 0) {
        return null;
      }

      return new Date(result.rows[0].timestamp);
    } catch (error) {
      logger.error(`Error getting last trade timestamp for ${symbol}/${strategy}`, error);
      return null; // Fail safe: allow trades if query fails
    }
  }

  /**
   * Get count of open trades for a symbol
   * 
   * Note: This requires MT5 Connector integration or a position cache.
   * For v3, we'll use a simple placeholder that returns 0.
   * TODO: Integrate with MT5 Connector or position manager service.
   */
  async getOpenTradeCount(symbol: string): Promise<number> {
    // TODO: Query MT5 Connector for open positions
    // For now, return 0 (assume no open trades)
    // This is safe but not ideal - we should cache or query MT5 in future
    return 0;
  }

  /**
   * Get exposure snapshot for a symbol by querying live_trades table directly
   * 
   * This queries open positions from live_trades where exit_time is in the future
   * or where exit_time equals entry_time (indicating still open).
   * 
   * Returns a zero exposure snapshot if no open trades exist (NOT null/undefined).
   * Throws an error only if the database query fails.
   * 
   * Note: For multi-account setups, accountId should be provided. For single-account,
   * it's optional.
   */
  async getExposureSnapshot(symbol: string, accountId?: string): Promise<SymbolExposureSnapshot> {
    if (!this.useDatabase || !this.pool) {
      // If no DB, return zero exposure (not an error - allow trades to proceed)
      return {
        accountId,
        symbol: symbol.toUpperCase(),
        longVolumeLots: 0,
        shortVolumeLots: 0,
        netVolumeLots: 0,
        longCount: 0,
        shortCount: 0,
        totalCount: 0,
      };
    }

    try {
      // Query live_trades for open positions
      // Open positions are those where exit_time >= NOW() or exit_time = entry_time
      // OR where exit_time is NULL (if the schema allows it, though current schema shows NOT NULL)
      // For now, we'll query positions where exit_time > NOW() or exit_time = entry_time
      const query = `
        SELECT 
          direction,
          COUNT(*) as trade_count,
          SUM(volume) as total_volume
        FROM live_trades
        WHERE symbol = $1
          AND (exit_time > NOW() OR exit_time = entry_time)
        GROUP BY direction
      `;

      const normalizedSymbol = symbol.toUpperCase();
      const result = await this.pool.query<{
        direction: string;
        trade_count: string | number;
        total_volume: string | number | null;
      }>(query, [normalizedSymbol]);

      // Initialize counters
      let longVolumeLots = 0;
      let shortVolumeLots = 0;
      let longCount = 0;
      let shortCount = 0;

      // Process results
      if (result.rows && result.rows.length > 0) {
        for (const row of result.rows) {
          const volume = Number(row.total_volume ?? 0);
          const count = Number(row.trade_count ?? 0);
          const direction = row.direction?.toLowerCase();

          if (direction === 'buy' || direction === 'long') {
            longVolumeLots += volume;
            longCount += count;
          } else if (direction === 'sell' || direction === 'short') {
            shortVolumeLots += volume;
            shortCount += count;
          }
        }
      }

      // Return exposure snapshot (always defined, even if all zeros)
      return {
        accountId,
        symbol: normalizedSymbol,
        longVolumeLots,
        shortVolumeLots,
        netVolumeLots: longVolumeLots - shortVolumeLots,
        longCount,
        shortCount,
        totalCount: longCount + shortCount,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        `[ExecutionFilterState] Failed to load exposure snapshot for ${symbol}${accountId ? ` (account: ${accountId})` : ''}: ${errorMessage}`,
        error
      );

      // Bubble up error so ExecutionFilter can decide to skip on DB failure
      throw new Error(
        `Failed to load exposure snapshot for ${symbol}: ${errorMessage}`
      );
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.useDatabase = false;
    }
  }
}

/**
 * Symbol exposure snapshot from live_trades table
 */
export type SymbolExposureSnapshot = {
  accountId?: string; // Optional for single-account setups
  symbol: string;
  longVolumeLots: number;
  shortVolumeLots: number;
  netVolumeLots: number;
  longCount: number;
  shortCount: number;
  totalCount: number;
};


