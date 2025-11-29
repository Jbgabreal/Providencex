/**
 * OrderEventService (Execution v3)
 * 
 * Receives order lifecycle events from MT5 Connector via webhook
 * and stores them in the database for tracking and PnL calculation.
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { OrderEvent, LiveTrade } from '@providencex/shared-types';
import { getConfig } from '../config';

const logger = new Logger('OrderEventService');

export interface OrderEventServiceConfig {
  databaseUrl: string;
  enabled: boolean; // Default: true
}

export class OrderEventService {
  private pool: Pool | null = null;
  private useDatabase: boolean = false;
  private livePnlServiceCallback: ((event: OrderEvent) => Promise<void>) | null = null;
  private tradeHistoryCallback: ((event: OrderEvent) => Promise<void>) | null = null;

  constructor(config: OrderEventServiceConfig) {
    this.useDatabase = config.enabled && !!config.databaseUrl;
    
    if (this.useDatabase) {
      try {
        this.pool = new Pool({
          connectionString: config.databaseUrl,
          ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        });
        
        // Handle pool errors gracefully (prevent app crash)
        this.pool.on('error', (err) => {
          logger.error('[OrderEventService] Database pool error (non-fatal):', err);
          // Don't crash the app - just log the error
        });
        
        this.initializeDatabase();
        logger.info('[OrderEventService] Connected to Postgres for order events');
      } catch (error) {
        logger.error('[OrderEventService] Failed to connect to Postgres', error);
        this.useDatabase = false;
      }
    } else {
      logger.warn('[OrderEventService] Disabled or no DATABASE_URL provided');
    }
  }

  /**
   * Initialize database tables (create if not exist)
   */
  private async initializeDatabase(): Promise<void> {
    if (!this.pool) return;

    try {
      // Load migration SQL
      const fs = require('fs');
      const path = require('path');
      const migrationPath = path.join(__dirname, '../db/migrations/v7_v8_execution_v3.sql');
      
      let migrationSQL: string;
      try {
        migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
      } catch (error) {
        logger.warn('[OrderEventService] Migration file not found, creating tables inline');
        // Fallback: create tables inline if migration file not found
        migrationSQL = `
          CREATE TABLE IF NOT EXISTS order_events (
            id             BIGSERIAL PRIMARY KEY,
            mt5_ticket     BIGINT NOT NULL,
            position_id    BIGINT,
            symbol         VARCHAR(20) NOT NULL,
            event_type     VARCHAR(32) NOT NULL,
            direction      VARCHAR(4),
            volume         DOUBLE PRECISION,
            timestamp      TIMESTAMPTZ NOT NULL,
            entry_time     TIMESTAMPTZ,
            exit_time      TIMESTAMPTZ,
            entry_price    DOUBLE PRECISION,
            exit_price     DOUBLE PRECISION,
            sl_price       DOUBLE PRECISION,
            tp_price       DOUBLE PRECISION,
            commission     DOUBLE PRECISION,
            swap           DOUBLE PRECISION,
            profit         DOUBLE PRECISION,
            reason         VARCHAR(32),
            magic_number   BIGINT,
            comment        TEXT,
            raw            JSONB,
            created_at     TIMESTAMPTZ DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_order_events_ticket ON order_events(mt5_ticket);
          CREATE INDEX IF NOT EXISTS idx_order_events_symbol_time ON order_events(symbol, timestamp);
          CREATE INDEX IF NOT EXISTS idx_order_events_event_type ON order_events(event_type);

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
        `;
      }

      await this.pool.query(migrationSQL);
      logger.info('[OrderEventService] Database tables initialized');
    } catch (error) {
      logger.error('[OrderEventService] Failed to initialize database tables', error);
      this.useDatabase = false;
    }
  }

  /**
   * Register callback for LivePnlService to be notified of position_closed events
   */
  setLivePnlCallback(callback: (event: OrderEvent) => Promise<void>): void {
    this.livePnlServiceCallback = callback;
  }

  /**
   * Register callback for TradeHistoryRepository to be notified of position_closed events
   */
  setTradeHistoryCallback(callback: (event: OrderEvent) => Promise<void>): void {
    this.tradeHistoryCallback = callback;
  }

  /**
   * Process an order event from MT5 Connector webhook
   */
  async processEvent(event: OrderEvent): Promise<void> {
    // Validate event
    if (!event.source || event.source !== 'mt5-connector') {
      throw new Error('Invalid event source');
    }

    if (!event.event_type) {
      throw new Error('Missing event_type');
    }

    if (!event.timestamp) {
      throw new Error('Missing timestamp');
    }

    // Store event in database
    if (this.useDatabase && this.pool) {
      try {
        await this.storeEvent(event);
        logger.debug(`[OrderEventService] Stored event: ${event.event_type} for ticket ${event.ticket}`);
      } catch (error) {
        logger.error('[OrderEventService] Failed to store event', error);
        // Continue - don't throw, just log
      }
    }

    // Notify LivePnlService if this is a position_closed event
    if (event.event_type === 'position_closed' && this.livePnlServiceCallback) {
      try {
        await this.livePnlServiceCallback(event);
        logger.debug(`[OrderEventService] Notified LivePnlService of position_closed event for ticket ${event.ticket}`);
      } catch (error) {
        logger.error('[OrderEventService] Failed to notify LivePnlService', error);
        // Continue - don't throw
      }
    }

    // Notify TradeHistoryRepository if this is a position_closed event
    if (event.event_type === 'position_closed' && this.tradeHistoryCallback) {
      try {
        await this.tradeHistoryCallback(event);
        logger.debug(`[OrderEventService] Notified TradeHistoryRepository of position_closed event for ticket ${event.ticket}`);
      } catch (error) {
        logger.error('[OrderEventService] Failed to notify TradeHistoryRepository', error);
        // Continue - don't throw
      }
    }
  }

  /**
   * Store order event in database
   */
  private async storeEvent(event: OrderEvent): Promise<void> {
    if (!this.pool) return;

    await this.pool.query(
      `INSERT INTO order_events (
        mt5_ticket, position_id, symbol, event_type, direction, volume,
        timestamp, entry_time, exit_time, entry_price, exit_price,
        sl_price, tp_price, commission, swap, profit, reason,
        magic_number, comment, raw
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [
        event.ticket,
        event.position_id || null,
        event.symbol,
        event.event_type,
        event.direction || null,
        event.volume || null,
        new Date(event.timestamp),
        event.entry_time ? new Date(event.entry_time) : null,
        event.exit_time ? new Date(event.exit_time) : null,
        event.entry_price || null,
        event.exit_price || null,
        event.sl_price || null,
        event.tp_price || null,
        event.commission || null,
        event.swap || null,
        event.profit || null,
        event.reason || null,
        event.magic_number || null,
        event.comment || null,
        event.raw ? JSON.stringify(event.raw) : null,
      ]
    );
  }

  /**
   * Cleanup: Close database connection
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.useDatabase = false;
      logger.info('[OrderEventService] Database connection closed');
    }
  }
}


