/**
 * LivePnlService (Trading Engine v7)
 * 
 * Tracks realized PnL from closed trades and maintains live equity curve.
 * Consumes order events from OrderEventService and periodically snapshots account equity.
 */

import { Pool } from 'pg';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { Logger } from '@providencex/shared-utils';
import { OrderEvent, LiveTrade, LiveEquity, AccountSummary } from '@providencex/shared-types';
import { getLivePnlConfig } from '@providencex/shared-config';
import { getConfig } from '../config';
import { getNowInPXTimezone } from '@providencex/shared-utils';

const logger = new Logger('LivePnlService');

export interface LivePnlServiceConfig {
  databaseUrl: string;
  mt5ConnectorUrl: string;
  enabled: boolean; // Default: true
}

export class LivePnlService {
  private pool: Pool | null = null;
  private useDatabase: boolean = false;
  private httpClient: AxiosInstance;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private config: ReturnType<typeof getLivePnlConfig>;

  constructor(serviceConfig: LivePnlServiceConfig) {
    this.useDatabase = serviceConfig.enabled && !!serviceConfig.databaseUrl;
    this.config = getLivePnlConfig();
    
    if (this.useDatabase) {
      try {
        this.pool = new Pool({
          connectionString: serviceConfig.databaseUrl,
          ssl: serviceConfig.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        });
        
        // Handle pool errors gracefully (prevent app crash)
        this.pool.on('error', (err) => {
          logger.error('[LivePnlService] Database pool error (non-fatal):', err);
          // Don't crash the app - just log the error
        });
        
        this.initializeDatabase();
        logger.info('[LivePnlService] Connected to Postgres for live PnL tracking');
      } catch (error) {
        logger.error('[LivePnlService] Failed to connect to Postgres', error);
        this.useDatabase = false;
      }
    } else {
      logger.warn('[LivePnlService] Disabled or no DATABASE_URL provided');
    }

    // Create HTTP client for MT5 Connector
    this.httpClient = axios.create({
      baseURL: serviceConfig.mt5ConnectorUrl,
      timeout: 5000,
    });
  }

  /**
   * Initialize database tables (create if not exist)
   */
  private async initializeDatabase(): Promise<void> {
    if (!this.pool) return;

    try {
      // Load migration SQL (same as OrderEventService)
      const fs = require('fs');
      const path = require('path');
      let migrationPath: string;
      try {
        migrationPath = path.join(__dirname, '../db/migrations/v7_v8_execution_v3.sql');
      } catch (error) {
        // Fallback if path resolution fails
        migrationPath = path.resolve(__dirname, '..', 'db', 'migrations', 'v7_v8_execution_v3.sql');
      }
      
      let migrationSQL: string;
      try {
        migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
      } catch (error) {
        logger.warn('[LivePnlService] Migration file not found, creating tables inline');
        migrationSQL = `
          CREATE TABLE IF NOT EXISTS live_trades (
            id                BIGSERIAL PRIMARY KEY,
            mt5_ticket        BIGINT NOT NULL,
            mt5_position_id   BIGINT,
            symbol            VARCHAR(20) NOT NULL,
            strategy          VARCHAR(32),
            direction         VARCHAR(4) NOT NULL,
            volume            DOUBLE PRECISION NOT NULL,
            entry_time        TIMESTAMPTZ NOT NULL,
            exit_time         TIMESTAMPTZ NOT NULL,
            entry_price       DOUBLE PRECISION NOT NULL,
            exit_price        DOUBLE PRECISION NOT NULL,
            sl_price          DOUBLE PRECISION,
            tp_price          DOUBLE PRECISION,
            commission        DOUBLE PRECISION DEFAULT 0,
            swap              DOUBLE PRECISION DEFAULT 0,
            profit_gross      DOUBLE PRECISION NOT NULL,
            profit_net        DOUBLE PRECISION NOT NULL,
            magic_number      BIGINT,
            comment           TEXT,
            closed_reason     VARCHAR(32),
            created_at        TIMESTAMPTZ DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_live_trades_symbol_time ON live_trades(symbol, exit_time);
          CREATE INDEX IF NOT EXISTS idx_live_trades_strategy_time ON live_trades(strategy, exit_time);
          CREATE INDEX IF NOT EXISTS idx_live_trades_mt5_ticket ON live_trades(mt5_ticket);

          CREATE TABLE IF NOT EXISTS live_equity (
            id                  BIGSERIAL PRIMARY KEY,
            timestamp           TIMESTAMPTZ NOT NULL,
            balance             DOUBLE PRECISION NOT NULL,
            equity              DOUBLE PRECISION NOT NULL,
            floating_pnl        DOUBLE PRECISION NOT NULL,
            closed_pnl_today    DOUBLE PRECISION NOT NULL,
            closed_pnl_week     DOUBLE PRECISION NOT NULL,
            max_drawdown_abs    DOUBLE PRECISION NOT NULL,
            max_drawdown_pct    DOUBLE PRECISION NOT NULL,
            comment             TEXT,
            created_at          TIMESTAMPTZ DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_live_equity_timestamp ON live_equity(timestamp);
        `;
      }

      await this.pool.query(migrationSQL);
      logger.info('[LivePnlService] Database tables initialized');
    } catch (error) {
      logger.error('[LivePnlService] Failed to initialize database tables', error);
      this.useDatabase = false;
    }
  }

  /**
   * Start periodic equity snapshots
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('[LivePnlService] Already running');
      return;
    }

    if (!this.useDatabase) {
      logger.warn('[LivePnlService] Cannot start: database not available');
      return;
    }

    this.isRunning = true;
    const intervalMs = this.config.equitySnapshotIntervalSec * 1000;

    logger.info(
      `[LivePnlService] Starting equity snapshot loop (interval: ${this.config.equitySnapshotIntervalSec}s)`
    );

    // Run immediately on start
    this.snapshotEquity().catch((error) => {
      logger.error('[LivePnlService] Error in initial equity snapshot', error);
    });

    // Set up periodic snapshots
    this.snapshotTimer = setInterval(() => {
      this.snapshotEquity().catch((error) => {
        logger.error('[LivePnlService] Error in periodic equity snapshot', error);
      });
    }, intervalMs);
  }

  /**
   * Stop periodic equity snapshots
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }

    logger.info('[LivePnlService] Stopped');
  }

  /**
   * Process a position_closed event from OrderEventService
   */
  async processPositionClosed(event: OrderEvent): Promise<void> {
    if (event.event_type !== 'position_closed') {
      logger.warn(`[LivePnlService] Expected position_closed event, got: ${event.event_type}`);
      return;
    }

    if (!event.entry_time || !event.exit_time || !event.entry_price || !event.exit_price) {
      logger.error('[LivePnlService] Missing required fields for position_closed event', event);
      return;
    }

    try {
      // Calculate profit_gross and profit_net
      const profitGross = event.profit || 0;
      const commission = event.commission || 0;
      const swap = event.swap || 0;
      const profitNet = profitGross - Math.abs(commission) - Math.abs(swap);

      // Create LiveTrade record
      const liveTrade: LiveTrade = {
        mt5_ticket: event.ticket,
        mt5_position_id: event.position_id || event.ticket,
        symbol: event.symbol,
        strategy: undefined, // Will be extracted from comment or metadata if available
        direction: event.direction || 'buy',
        volume: event.volume || 0,
        entry_time: event.entry_time,
        exit_time: event.exit_time,
        entry_price: event.entry_price,
        exit_price: event.exit_price,
        sl_price: event.sl_price || undefined,
        tp_price: event.tp_price || undefined,
        commission: commission || 0,
        swap: swap || 0,
        profit_gross: profitGross,
        profit_net: profitNet,
        magic_number: event.magic_number || 123456,
        comment: event.comment,
        closed_reason: event.reason || 'unknown',
      };

      // Store in database
      await this.storeLiveTrade(liveTrade);
      logger.info(
        `[LivePnlService] Stored closed trade: ${liveTrade.symbol} ${liveTrade.direction} ` +
        `ticket=${liveTrade.mt5_ticket}, profit_net=${liveTrade.profit_net.toFixed(2)}`
      );

      // Trigger immediate equity snapshot (or schedule one soon)
      // For now, let the periodic snapshot handle it
    } catch (error) {
      logger.error('[LivePnlService] Failed to process position_closed event', error);
      // Don't throw - log and continue
    }
  }

  /**
   * Store a closed trade in live_trades table
   */
  private async storeLiveTrade(trade: LiveTrade): Promise<void> {
    if (!this.pool) return;

    await this.pool.query(
      `INSERT INTO live_trades (
        mt5_ticket, mt5_position_id, symbol, strategy, direction, volume,
        entry_time, exit_time, entry_price, exit_price,
        sl_price, tp_price, commission, swap,
        profit_gross, profit_net, magic_number, comment, closed_reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        trade.mt5_ticket,
        trade.mt5_position_id || null,
        trade.symbol,
        trade.strategy || null,
        trade.direction,
        trade.volume,
        new Date(trade.entry_time),
        new Date(trade.exit_time),
        trade.entry_price,
        trade.exit_price,
        trade.sl_price || null,
        trade.tp_price || null,
        trade.commission || 0,
        trade.swap || 0,
        trade.profit_gross,
        trade.profit_net,
        trade.magic_number || null,
        trade.comment || null,
        trade.closed_reason || 'unknown',
      ]
    );
  }

  /**
   * Snapshot account equity and store in live_equity table
   */
  private async snapshotEquity(): Promise<void> {
    if (!this.useDatabase || !this.pool) {
      return;
    }

    try {
      // Get account summary from MT5 Connector
      const response = await this.httpClient.get<AccountSummary>('/api/v1/account-summary');
      
      if (!response.data.success) {
        logger.error(
          `[LivePnlService] Failed to get account summary: ${response.data.error || 'Unknown error'}`
        );
        return;
      }

      const account = response.data;
      const timezone = this.config.timezone || 'America/New_York';
      const now = getNowInPXTimezone().setZone(timezone);
      const today = now.startOf('day').toJSDate();
      const endOfToday = now.endOf('day').toJSDate();
      const weekStart = now.startOf('week').toJSDate();
      const weekEnd = now.endOf('week').toJSDate();

      // Calculate closed PnL for today
      const todayPnLResult = await this.pool.query(
        `SELECT COALESCE(SUM(profit_net), 0) as closed_pnl_today
         FROM live_trades
         WHERE exit_time >= $1 AND exit_time <= $2`,
        [today, endOfToday]
      );
      const closedPnlToday = parseFloat(todayPnLResult.rows[0]?.closed_pnl_today || '0');

      // Calculate closed PnL for week
      const weekPnLResult = await this.pool.query(
        `SELECT COALESCE(SUM(profit_net), 0) as closed_pnl_week
         FROM live_trades
         WHERE exit_time >= $1 AND exit_time <= $2`,
        [weekStart, weekEnd]
      );
      const closedPnlWeek = parseFloat(weekPnLResult.rows[0]?.closed_pnl_week || '0');

      // Calculate floating PnL (equity - balance)
      const floatingPnl = account.equity - account.balance;

      // Calculate max drawdown from equity history
      const drawdownResult = await this.getMaxDrawdown(account.equity);
      const maxDrawdownAbs = drawdownResult.abs;
      const maxDrawdownPct = drawdownResult.pct;

      // Store equity snapshot
          const liveEquity: LiveEquity = {
            timestamp: now.toISO()!,
            balance: account.balance,
            equity: account.equity,
            floating_pnl: floatingPnl,
            closed_pnl_today: closedPnlToday,
            closed_pnl_week: closedPnlWeek,
            max_drawdown_abs: maxDrawdownAbs,
            max_drawdown_pct: maxDrawdownPct,
            // comment is optional, so we don't set it if null
          };

      await this.storeEquitySnapshot(liveEquity);
      logger.debug(
        `[LivePnlService] Equity snapshot: balance=${account.balance.toFixed(2)}, ` +
        `equity=${account.equity.toFixed(2)}, closed_today=${closedPnlToday.toFixed(2)}, ` +
        `drawdown=${maxDrawdownPct.toFixed(2)}%`
      );
    } catch (error) {
      // Handle Axios errors separately for better logging
      if (axios.isAxiosError(error)) {
        logger.warn('[LivePnlService] MT5 Connector unavailable, skipping equity snapshot', error.message);
      } else {
        logger.error('[LivePnlService] Error in equity snapshot', error);
      }
      // Don't throw - log and continue
    }
  }

  /**
   * Calculate max drawdown from equity history
   */
  private async getMaxDrawdown(currentEquity: number): Promise<{ abs: number; pct: number }> {
    if (!this.pool) {
      return { abs: 0, pct: 0 };
    }

    try {
      // Get equity history (last 1000 points for performance)
      const result = await this.pool.query(
        `SELECT equity, timestamp
         FROM live_equity
         ORDER BY timestamp DESC
         LIMIT 1000`
      );

      if (result.rows.length === 0) {
        // No history yet, no drawdown
        return { abs: 0, pct: 0 };
      }

      // Calculate drawdown: peak equity - current equity
      const equities = result.rows.map((row: any) => parseFloat(row.equity));
      equities.push(currentEquity); // Include current equity

      let peak = equities[0];
      let maxDrawdown = 0;
      let maxDrawdownPct = 0;

      for (const equity of equities) {
        if (equity > peak) {
          peak = equity;
        }
        const drawdown = peak - equity;
        const drawdownPct = peak > 0 ? (drawdown / peak) * 100 : 0;
        
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
        if (drawdownPct > maxDrawdownPct) {
          maxDrawdownPct = drawdownPct;
        }
      }

      return { abs: maxDrawdown, pct: maxDrawdownPct };
    } catch (error) {
      logger.error('[LivePnlService] Error calculating max drawdown', error);
      return { abs: 0, pct: 0 };
    }
  }

  /**
   * Store equity snapshot in live_equity table
   */
  private async storeEquitySnapshot(snapshot: LiveEquity): Promise<void> {
    if (!this.pool) return;

    await this.pool.query(
      `INSERT INTO live_equity (
        timestamp, balance, equity, floating_pnl,
        closed_pnl_today, closed_pnl_week,
        max_drawdown_abs, max_drawdown_pct, comment
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        new Date(snapshot.timestamp),
        snapshot.balance,
        snapshot.equity,
        snapshot.floating_pnl,
        snapshot.closed_pnl_today,
        snapshot.closed_pnl_week,
        snapshot.max_drawdown_abs,
        snapshot.max_drawdown_pct,
        snapshot.comment || null,
      ]
    );
  }

  /**
   * Get latest equity snapshot
   */
  async getLatestEquity(): Promise<LiveEquity | null> {
    if (!this.pool) return null;

    try {
      const result = await this.pool.query(
        `SELECT * FROM live_equity
         ORDER BY timestamp DESC
         LIMIT 1`
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        timestamp: new Date(row.timestamp).toISOString(),
        balance: parseFloat(row.balance),
        equity: parseFloat(row.equity),
        floating_pnl: parseFloat(row.floating_pnl),
        closed_pnl_today: parseFloat(row.closed_pnl_today),
        closed_pnl_week: parseFloat(row.closed_pnl_week),
        max_drawdown_abs: parseFloat(row.max_drawdown_abs),
        max_drawdown_pct: parseFloat(row.max_drawdown_pct),
        comment: row.comment,
        created_at: new Date(row.created_at).toISOString(),
      };
    } catch (error) {
      logger.error('[LivePnlService] Error getting latest equity', error);
      return null;
    }
  }

  /**
   * Get closed trades for a date range
   */
  async getClosedTrades(
    symbol?: string,
    strategy?: string,
    from?: Date,
    to?: Date,
    limit: number = 100,
    offset: number = 0
  ): Promise<LiveTrade[]> {
    if (!this.pool) return [];

    try {
      const conditions: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (symbol) {
        conditions.push(`symbol = $${paramIndex++}`);
        params.push(symbol.toUpperCase());
      }

      if (strategy) {
        conditions.push(`strategy = $${paramIndex++}`);
        params.push(strategy);
      }

      if (from) {
        conditions.push(`exit_time >= $${paramIndex++}`);
        params.push(from);
      }

      if (to) {
        conditions.push(`exit_time <= $${paramIndex++}`);
        params.push(to);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const result = await this.pool.query(
        `SELECT * FROM live_trades
         ${whereClause}
         ORDER BY exit_time DESC
         LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
        [...params, limit, offset]
      );

      return result.rows.map((row: any) => ({
        id: row.id,
        mt5_ticket: row.mt5_ticket,
        mt5_position_id: row.mt5_position_id,
        symbol: row.symbol,
        strategy: row.strategy,
        direction: row.direction,
        volume: parseFloat(row.volume),
        entry_time: new Date(row.entry_time).toISOString(),
        exit_time: new Date(row.exit_time).toISOString(),
        entry_price: parseFloat(row.entry_price),
        exit_price: parseFloat(row.exit_price),
        sl_price: row.sl_price ? parseFloat(row.sl_price) : undefined,
        tp_price: row.tp_price ? parseFloat(row.tp_price) : undefined,
        commission: parseFloat(row.commission || 0),
        swap: parseFloat(row.swap || 0),
        profit_gross: parseFloat(row.profit_gross),
        profit_net: parseFloat(row.profit_net),
        magic_number: row.magic_number,
        comment: row.comment,
        closed_reason: row.closed_reason,
        created_at: new Date(row.created_at).toISOString(),
      }));
    } catch (error) {
      logger.error('[LivePnlService] Error getting closed trades', error);
      return [];
    }
  }

  /**
   * Cleanup: Close database connection
   */
  async close(): Promise<void> {
    this.stop();

    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.useDatabase = false;
      logger.info('[LivePnlService] Database connection closed');
    }
  }
}

