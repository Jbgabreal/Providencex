/**
 * AvoidWindowManagerService - Manages pending orders and positions during avoid windows
 * 
 * Senior Dev Approach: Instead of polling, we schedule timers based on avoid window times
 * from the database. This is more efficient and precise.
 * 
 * Responsibilities:
 * 1. Load avoid windows from database at startup
 * 2. Schedule timers for each window's start/end times
 * 3. Cancel pending orders when entering avoid window
 * 4. Close profitable/breakeven positions when entering avoid window
 * 5. Re-enter canceled orders after avoid window if still valid
 */

import axios, { AxiosInstance } from 'axios';
import { Pool } from 'pg';
import { Logger, getNowInPXTimezone, formatDateForPX, parseToPXTimezone } from '@providencex/shared-utils';
import { NewsWindow } from '@providencex/shared-types';
import { Strategy } from '../types';
import { getConfig } from '../config';

// DateTime type from luxon (return type of parseToPXTimezone)
type DateTime = ReturnType<typeof parseToPXTimezone>;

const logger = new Logger('AvoidWindowManager');

interface PendingOrder {
  symbol: string;
  ticket: number;
  direction: 'buy' | 'sell';
  order_kind: 'limit' | 'stop';
  volume: number;
  entry_price: number;
  sl?: number | null;
  tp?: number | null;
  setup_time: string;
}

interface OpenPosition {
  symbol: string;
  ticket: number;
  direction: 'buy' | 'sell';
  volume: number;
  open_price: number;
  sl?: number | null;
  tp?: number | null;
  open_time: string;
  profit?: number; // Current profit/loss in account currency (from MT5)
}

interface CanceledOrder {
  symbol: string;
  direction: 'buy' | 'sell';
  order_kind: 'limit' | 'stop';
  volume: number;
  entry_price: number;
  sl?: number | null;
  tp?: number | null;
  canceled_at: Date;
  canceled_reason: string;
  window_end_time: DateTime; // When to check for re-entry
}

interface ScheduledTimer {
  window: NewsWindow;
  startTimer: NodeJS.Timeout | null;
  endTimer: NodeJS.Timeout | null;
}

interface AvoidWindowManagerConfig {
  mt5BaseUrl: string;
  databaseUrl: string;
  strategy: Strategy;
  refreshIntervalHours?: number; // How often to refresh windows from DB (default: 1 hour)
}

export class AvoidWindowManagerService {
  private config: Required<Omit<AvoidWindowManagerConfig, 'databaseUrl'>> & { databaseUrl: string };
  private httpClient: AxiosInstance;
  private pool: Pool | null = null;
  private isRunning: boolean = false;
  private scheduledTimers: Map<string, ScheduledTimer> = new Map(); // window key -> timer
  private canceledOrders: Map<number, CanceledOrder> = new Map(); // ticket -> canceled order
  private refreshTimer: NodeJS.Timeout | null = null;
  private currentDate: string = ''; // Track current date to refresh windows daily

  constructor(config: AvoidWindowManagerConfig) {
    this.config = {
      mt5BaseUrl: config.mt5BaseUrl,
      databaseUrl: config.databaseUrl,
      strategy: config.strategy,
      refreshIntervalHours: config.refreshIntervalHours || 1,
    };

    this.httpClient = axios.create({
      baseURL: this.config.mt5BaseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Initialize database connection
    if (this.config.databaseUrl) {
      this.pool = new Pool({
        connectionString: this.config.databaseUrl,
        ssl: this.config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
      });

      this.pool.on('error', (err) => {
        logger.error('[AvoidWindowManager] Database pool error (non-fatal):', err);
      });
    }

    logger.info(
      `AvoidWindowManagerService initialized: mt5BaseUrl=${this.config.mt5BaseUrl}, ` +
      `refreshInterval=${this.config.refreshIntervalHours}h`
    );
  }

  /**
   * Start monitoring avoid windows
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('AvoidWindowManagerService is already running');
      return;
    }

    this.isRunning = true;
    logger.info('AvoidWindowManagerService started');

    // Load and schedule windows for today
    await this.loadAndScheduleWindows();

    // Schedule periodic refresh to catch new windows or daily updates
    this.scheduleRefresh();
  }

  /**
   * Stop monitoring avoid windows
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    // Clear all scheduled timers
    this.clearAllTimers();

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (this.pool) {
      this.pool.end().catch((err) => {
        logger.error('[AvoidWindowManager] Error closing database pool:', err);
      });
    }

    logger.info('AvoidWindowManagerService stopped');
  }

  /**
   * Load avoid windows from database and schedule timers
   */
  private async loadAndScheduleWindows(): Promise<void> {
    try {
      const today = getNowInPXTimezone();
      const todayStr = formatDateForPX(today);
      this.currentDate = todayStr;

      logger.info(`[AvoidWindow] Loading avoid windows for ${todayStr} from database...`);

      if (!this.pool) {
        logger.warn('[AvoidWindow] Database pool not available, cannot load windows');
        return;
      }

      const result = await this.pool.query(
        'SELECT avoid_windows FROM daily_news_windows WHERE date = $1',
        [todayStr]
      );

      if (result.rows.length === 0) {
        logger.info(`[AvoidWindow] No avoid windows found for ${todayStr}`);
        return;
      }

      const avoidWindows: NewsWindow[] = result.rows[0].avoid_windows as NewsWindow[];
      logger.info(`[AvoidWindow] Found ${avoidWindows.length} avoid window(s) for ${todayStr}`);

      // Clear existing timers
      this.clearAllTimers();

      // Schedule timers for each window
      for (const window of avoidWindows) {
        this.scheduleWindow(window);
      }
    } catch (error) {
      logger.error('[AvoidWindow] Error loading windows from database:', error);
    }
  }

  /**
   * Schedule timers for a single avoid window
   */
  private scheduleWindow(window: NewsWindow): void {
    try {
      const startTime = parseToPXTimezone(window.start_time);
      const endTime = parseToPXTimezone(window.end_time);
      const now = getNowInPXTimezone();

      // Create unique key for this window
      const windowKey = `${window.start_time}_${window.end_time}_${window.event_name}`;

      // Check if window is in the past
      if (endTime < now) {
        logger.debug(
          `[AvoidWindow] Skipping past window: ${window.event_name} (${startTime.toISO()} - ${endTime.toISO()})`
        );
        return;
      }

      // Calculate milliseconds until start and end
      const msUntilStart = startTime.diff(now).as('milliseconds');
      const msUntilEnd = endTime.diff(now).as('milliseconds');

      const timers: ScheduledTimer = {
        window,
        startTimer: null,
        endTimer: null,
      };

      // Schedule start timer (if not already started)
      if (msUntilStart > 0) {
        timers.startTimer = setTimeout(() => {
          this.handleWindowStart(window);
        }, msUntilStart);

        logger.info(
          `[AvoidWindow] Scheduled window start: ${window.event_name} at ${startTime.toISO()} ` +
          `(in ${Math.round(msUntilStart / 1000 / 60)} minutes)`
        );
      } else if (now >= startTime && now < endTime) {
        // Window is already active
        logger.info(
          `[AvoidWindow] Window is already active: ${window.event_name}, handling immediately...`
        );
        this.handleWindowStart(window);
      }

      // Schedule end timer
      if (msUntilEnd > 0) {
        timers.endTimer = setTimeout(() => {
          this.handleWindowEnd(window);
        }, msUntilEnd);

        logger.info(
          `[AvoidWindow] Scheduled window end: ${window.event_name} at ${endTime.toISO()} ` +
          `(in ${Math.round(msUntilEnd / 1000 / 60)} minutes)`
        );
      }

      this.scheduledTimers.set(windowKey, timers);
    } catch (error) {
      logger.error(`[AvoidWindow] Error scheduling window ${window.event_name}:`, error);
    }
  }

  /**
   * Handle window start: Cancel pending orders and close profitable positions
   */
  private async handleWindowStart(window: NewsWindow): Promise<void> {
    logger.warn(
      `[AvoidWindow] ⚠️  Entering avoid window: ${window.event_name} ` +
      `(${window.currency}, risk: ${window.risk_score}, ${window.start_time} - ${window.end_time})`
    );

    try {
      // 1. Get and cancel all pending orders
      const pendingOrders = await this.getPendingOrders();
      if (pendingOrders.length > 0) {
        logger.info(`[AvoidWindow] Found ${pendingOrders.length} pending order(s) to cancel`);
        
        for (const order of pendingOrders) {
          await this.cancelPendingOrder(order, window);
        }
      }

      // 2. Get and close profitable/breakeven positions
      const openPositions = await this.getOpenPositions();
      if (openPositions.length > 0) {
        logger.info(`[AvoidWindow] Checking ${openPositions.length} open position(s) for closure`);
        
        for (const position of openPositions) {
          await this.checkAndClosePosition(position, window);
        }
      }
    } catch (error) {
      logger.error('[AvoidWindow] Error handling window start:', error);
    }
  }

  /**
   * Handle window end: Re-enter canceled orders if still valid
   */
  private async handleWindowEnd(window: NewsWindow): Promise<void> {
    logger.info(
      `[AvoidWindow] ✅ Exiting avoid window: ${window.event_name}. Checking for canceled orders to re-enter...`
    );

    if (this.canceledOrders.size === 0) {
      logger.debug('[AvoidWindow] No canceled orders to re-enter');
      return;
    }

    logger.info(`[AvoidWindow] Checking ${this.canceledOrders.size} canceled order(s) for re-entry`);

    // Filter orders that were canceled for this window
    const ordersToReenter: CanceledOrder[] = [];
    const ordersToRemove: number[] = [];

    for (const [ticket, canceledOrder] of this.canceledOrders.entries()) {
      // Check if this order was canceled for this window
      if (canceledOrder.window_end_time.toISO() === parseToPXTimezone(window.end_time).toISO()) {
        // Check if order is still valid
        const isValid = await this.isOrderStillValid(canceledOrder);
        
        if (isValid) {
          ordersToReenter.push(canceledOrder);
        } else {
          ordersToRemove.push(ticket);
          logger.debug(
            `[AvoidWindow] Canceled order ${ticket} (${canceledOrder.symbol} ${canceledOrder.direction}) ` +
            `is no longer valid, removing from re-entry queue`
          );
        }
      }
    }

    // Remove invalid orders
    for (const ticket of ordersToRemove) {
      this.canceledOrders.delete(ticket);
    }

    // Re-enter valid orders
    if (ordersToReenter.length > 0) {
      logger.info(`[AvoidWindow] Re-entering ${ordersToReenter.length} valid order(s) after avoid window`);
      
      for (const order of ordersToReenter) {
        await this.reenterOrder(order);
      }
    }

    // Clean up timer for this window
    const windowKey = `${window.start_time}_${window.end_time}_${window.event_name}`;
    this.scheduledTimers.delete(windowKey);
  }

  /**
   * Schedule periodic refresh to reload windows (catches new windows or daily updates)
   */
  private scheduleRefresh(): void {
    if (!this.isRunning) {
      return;
    }

    const refreshIntervalMs = this.config.refreshIntervalHours * 60 * 60 * 1000;

    this.refreshTimer = setTimeout(async () => {
      // Check if date changed (new day)
      const today = getNowInPXTimezone();
      const todayStr = formatDateForPX(today);

      if (todayStr !== this.currentDate) {
        logger.info(`[AvoidWindow] Date changed from ${this.currentDate} to ${todayStr}, reloading windows...`);
        await this.loadAndScheduleWindows();
      } else {
        // Same day, just refresh to catch any updates
        logger.debug('[AvoidWindow] Refreshing windows to catch any updates...');
        await this.loadAndScheduleWindows();
      }

      // Schedule next refresh
      this.scheduleRefresh();
    }, refreshIntervalMs);
  }

  /**
   * Clear all scheduled timers
   */
  private clearAllTimers(): void {
    for (const [key, timer] of this.scheduledTimers.entries()) {
      if (timer.startTimer) {
        clearTimeout(timer.startTimer);
      }
      if (timer.endTimer) {
        clearTimeout(timer.endTimer);
      }
    }
    this.scheduledTimers.clear();
  }

  /**
   * Get all pending orders from MT5
   */
  private async getPendingOrders(): Promise<PendingOrder[]> {
    try {
      const response = await this.httpClient.get<{ success: boolean; orders: PendingOrder[]; error?: string }>(
        '/api/v1/pending-orders'
      );

      if (response.data.success) {
        return response.data.orders || [];
      } else {
        logger.error(`Failed to get pending orders: ${response.data.error}`);
        return [];
      }
    } catch (error) {
      logger.error('[AvoidWindow] Error getting pending orders:', error);
      return [];
    }
  }

  /**
   * Get all open positions from MT5
   */
  private async getOpenPositions(): Promise<OpenPosition[]> {
    try {
      const response = await this.httpClient.get<{ success: boolean; positions: OpenPosition[]; error?: string }>(
        '/api/v1/open-positions'
      );

      if (response.data.success) {
        return response.data.positions || [];
      } else {
        logger.error(`Failed to get open positions: ${response.data.error}`);
        return [];
      }
    } catch (error) {
      logger.error('[AvoidWindow] Error getting open positions:', error);
      return [];
    }
  }

  /**
   * Cancel a pending order
   */
  private async cancelPendingOrder(order: PendingOrder, window: NewsWindow): Promise<void> {
    try {
      logger.info(
        `[AvoidWindow] Canceling pending order: ticket=${order.ticket}, ` +
        `${order.symbol} ${order.direction.toUpperCase()} ${order.order_kind.toUpperCase()} @ ${order.entry_price}`
      );

      const response = await this.httpClient.post<{ success: boolean; error?: string }>(
        '/api/v1/trades/cancel',
        { ticket: order.ticket }
      );

      if (response.data.success) {
        // Store canceled order for potential re-entry after window ends
        const windowEndTime = parseToPXTimezone(window.end_time);
        this.canceledOrders.set(order.ticket, {
          symbol: order.symbol,
          direction: order.direction,
          order_kind: order.order_kind,
          volume: order.volume,
          entry_price: order.entry_price,
          sl: order.sl,
          tp: order.tp,
          canceled_at: new Date(),
          canceled_reason: `Avoid window: ${window.event_name}`,
          window_end_time: windowEndTime,
        });

        logger.info(`[AvoidWindow] Successfully canceled pending order: ticket=${order.ticket}`);
      } else {
        logger.error(`[AvoidWindow] Failed to cancel order ${order.ticket}: ${response.data.error}`);
      }
    } catch (error) {
      logger.error(`[AvoidWindow] Error canceling order ${order.ticket}:`, error);
    }
  }

  /**
   * Check if position is profitable or at breakeven, and close if so
   */
  private async checkAndClosePosition(position: OpenPosition, window: NewsWindow): Promise<void> {
    try {
      // Get profit from position (MT5 provides this directly in account currency)
      const profit = position.profit || 0;

      // Check if position is profitable or at breakeven (profit >= 0)
      if (profit >= 0) {
        logger.info(
          `[AvoidWindow] Closing profitable/breakeven position: ticket=${position.ticket}, ` +
          `${position.symbol} ${position.direction.toUpperCase()}, profit=${profit.toFixed(2)}, ` +
          `reason: Entering avoid window (${window.event_name})`
        );

        const response = await this.httpClient.post<{ success: boolean; error?: string }>(
          '/api/v1/trades/close',
          {
            ticket: position.ticket,
            reason: `Avoid window: ${window.event_name}`,
          }
        );

        if (response.data.success) {
          logger.info(`[AvoidWindow] Successfully closed position: ticket=${position.ticket}`);
        } else {
          logger.error(`[AvoidWindow] Failed to close position ${position.ticket}: ${response.data.error}`);
        }
      } else {
        logger.debug(
          `[AvoidWindow] Position ${position.ticket} is in loss (${profit.toFixed(2)}), ` +
          `keeping it open during avoid window`
        );
      }
    } catch (error) {
      logger.error(`[AvoidWindow] Error checking/closing position ${position.ticket}:`, error);
    }
  }

  /**
   * Get current market price for a symbol (used for order validation)
   */
  private async getCurrentPrice(symbol: string): Promise<number | null> {
    try {
      // Try to get price from MT5 connector
      // Note: This endpoint may not exist yet, but we can use it for order validation
      const response = await this.httpClient.get<{ bid: number; ask: number }>(
        `/api/v1/price/${symbol}`
      );

      if (response.data) {
        // Return mid price
        return (response.data.bid + response.data.ask) / 2;
      }
      return null;
    } catch (error) {
      // If price endpoint doesn't exist, we can still validate orders using other methods
      logger.debug(`[AvoidWindow] Could not get current price for ${symbol} (endpoint may not exist):`, error);
      return null;
    }
  }

  /**
   * Check if a canceled order is still valid for re-entry
   */
  private async isOrderStillValid(canceledOrder: CanceledOrder): Promise<boolean> {
    try {
      const currentPrice = await this.getCurrentPrice(canceledOrder.symbol);
      if (!currentPrice) {
        // If we can't get price, be conservative and don't re-enter
        return false;
      }

      // Check if entry price still makes sense relative to current price
      const priceDiff = Math.abs(canceledOrder.entry_price - currentPrice);
      const priceDiffPercent = (priceDiff / currentPrice) * 100;

      // Order is valid if:
      // - For buy limit: entry < current (price needs to come down)
      // - For sell limit: entry > current (price needs to go up)
      // - For buy stop: entry > current (price needs to break up)
      // - For sell stop: entry < current (price needs to break down)
      // - And price hasn't moved too far (within 1% of original entry)

      if (canceledOrder.order_kind === 'limit') {
        if (canceledOrder.direction === 'buy') {
          // Buy limit: entry should be below current
          return canceledOrder.entry_price < currentPrice && priceDiffPercent < 1.0;
        } else {
          // Sell limit: entry should be above current
          return canceledOrder.entry_price > currentPrice && priceDiffPercent < 1.0;
        }
      } else {
        // Stop orders
        if (canceledOrder.direction === 'buy') {
          // Buy stop: entry should be above current
          return canceledOrder.entry_price > currentPrice && priceDiffPercent < 1.0;
        } else {
          // Sell stop: entry should be below current
          return canceledOrder.entry_price < currentPrice && priceDiffPercent < 1.0;
        }
      }
    } catch (error) {
      logger.error(`[AvoidWindow] Error validating order:`, error);
      return false;
    }
  }

  /**
   * Re-enter a canceled order after avoid window
   */
  private async reenterOrder(canceledOrder: CanceledOrder): Promise<void> {
    try {
      logger.info(
        `[AvoidWindow] Re-entering order: ${canceledOrder.symbol} ${canceledOrder.direction.toUpperCase()} ` +
        `${canceledOrder.order_kind.toUpperCase()} @ ${canceledOrder.entry_price}`
      );

      const response = await this.httpClient.post<{ success: boolean; ticket?: number; error?: string }>(
        '/api/v1/trades/open',
        {
          symbol: canceledOrder.symbol,
          direction: canceledOrder.direction.toUpperCase(),
          order_kind: canceledOrder.order_kind,
          entry_price: canceledOrder.entry_price,
          lot_size: canceledOrder.volume,
          stop_loss: canceledOrder.sl,
          take_profit: canceledOrder.tp,
          strategy: this.config.strategy,
        }
      );

      if (response.data.success) {
        // Remove from canceled orders map
        // Find by matching order details (since we don't have the original ticket)
        for (const [ticket, order] of this.canceledOrders.entries()) {
          if (
            order.symbol === canceledOrder.symbol &&
            order.direction === canceledOrder.direction &&
            order.order_kind === canceledOrder.order_kind &&
            Math.abs(order.entry_price - canceledOrder.entry_price) < 0.0001
          ) {
            this.canceledOrders.delete(ticket);
            break;
          }
        }

        logger.info(
          `[AvoidWindow] Successfully re-entered order: ticket=${response.data.ticket || 'unknown'}`
        );
      } else {
        logger.error(`[AvoidWindow] Failed to re-enter order: ${response.data.error}`);
      }
    } catch (error) {
      logger.error('[AvoidWindow] Error re-entering order:', error);
    }
  }
}
