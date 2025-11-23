/**
 * ExitService (Trading Engine v9)
 * 
 * Manages post-entry trade lifecycle decisions:
 * - Dynamic stop loss movement (break-even, trailing)
 * - Partial profit-taking
 * - Structure-based exits
 * - Time-based exits
 * - Commission/swap-aware exits
 * - Kill-switch forced exits
 * 
 * Polls open positions every 2 seconds and evaluates exit rules per position.
 */

import axios, { AxiosInstance } from 'axios';
import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import type { ExitPlan, ModifyTradeRequest, PartialCloseRequest } from '@providencex/shared-types';
import { getExitEngineConfig, ExitEngineConfig } from '@providencex/shared-config';
import { OpenTradesService, OpenTrade } from './OpenTradesService';
import { KillSwitchService } from './KillSwitchService';
import { OrderEventService } from './OrderEventService';
import { PriceFeedClient, Tick } from '../marketData';

const logger = new Logger('ExitService');

export interface ExitServiceConfig {
  enabled: boolean;
  exitTickIntervalSec: number;
  mt5ConnectorUrl: string;
  databaseUrl: string;
  breakEvenEnabled: boolean;
  partialCloseEnabled: boolean;
  trailingEnabled: boolean;
  structureExitEnabled: boolean;
  timeExitEnabled: boolean;
  commissionExitEnabled: boolean;
  breakEvenTriggerPips?: number;
  defaultPartialClosePercent?: number;
  defaultTrailMode?: 'atr' | 'fixed_pips' | 'structure' | 'volatility_adaptive';
  defaultTrailPips?: number;
  maxTimeInTradeSeconds?: number;
}

interface ExitPlanCache {
  [ticket: number]: ExitPlan;
}

interface PositionActionHistory {
  [ticket: number]: {
    lastBreakEvenTime?: Date;
    lastTrailTime?: Date;
    lastPartialCloseTime?: Date;
    breakEvenSet: boolean;
    partialCloseExecuted: boolean;
  };
}

export class ExitService {
  private config: ExitEngineConfig;
  private httpClient: AxiosInstance;
  private pool: Pool | null = null;
  private exitTickInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private exitPlans: ExitPlanCache = {};
  private actionHistory: PositionActionHistory = {};
  private openTradesService: OpenTradesService;
  private killSwitchService?: KillSwitchService;
  private orderEventService?: OrderEventService;
  private priceFeed?: PriceFeedClient;

  constructor(
    config: Partial<ExitServiceConfig>,
    openTradesService: OpenTradesService,
    killSwitchService?: KillSwitchService,
    orderEventService?: OrderEventService,
    priceFeed?: PriceFeedClient
  ) {
    const defaultConfig = getExitEngineConfig();
    this.config = { ...defaultConfig, ...config } as ExitEngineConfig;
    this.openTradesService = openTradesService;
    this.killSwitchService = killSwitchService;
    this.orderEventService = orderEventService;
    this.priceFeed = priceFeed;

    // Create HTTP client for MT5 Connector
    this.httpClient = axios.create({
      baseURL: this.config.mt5ConnectorUrl,
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Initialize database connection if URL provided
    if (this.config.databaseUrl) {
      try {
        this.pool = new Pool({
          connectionString: this.config.databaseUrl,
          ssl: this.config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        });
        
        // Handle pool errors gracefully (prevent app crash)
        this.pool.on('error', (err) => {
          logger.error('[ExitService] Database pool error (non-fatal):', err);
          // Don't crash the app - just log the error
        });
        
        this.initializeDatabase();
        logger.info('[ExitService] Connected to Postgres for exit plans');
      } catch (error) {
        logger.error('[ExitService] Failed to connect to Postgres', error);
        this.pool = null;
      }
    }

    logger.info(
      `[ExitService] Initialized: enabled=${this.config.enabled}, ` +
      `interval=${this.config.exitTickIntervalSec}s, ` +
      `mt5Url=${this.config.mt5ConnectorUrl}`
    );
  }

  /**
   * Initialize database tables (create if not exist)
   */
  private async initializeDatabase(): Promise<void> {
    if (!this.pool) return;

    try {
      const fs = require('fs');
      const path = require('path');
      const migrationPath = path.join(__dirname, '../db/migrations/v9_exit_engine.sql');

      let migrationSQL: string;
      try {
        migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
      } catch (error) {
        logger.warn('[ExitService] Migration file not found, creating tables inline');
        // Fallback: create tables inline
        migrationSQL = `
          CREATE TABLE IF NOT EXISTS exit_plans (
            exit_plan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            decision_id INTEGER REFERENCES trade_decisions(id) ON DELETE CASCADE,
            symbol VARCHAR(20) NOT NULL,
            entry_price DOUBLE PRECISION NOT NULL,
            tp1 DOUBLE PRECISION,
            tp2 DOUBLE PRECISION,
            tp3 DOUBLE PRECISION,
            stop_loss_initial DOUBLE PRECISION NOT NULL,
            break_even_trigger DOUBLE PRECISION,
            partial_close_percent DOUBLE PRECISION,
            trail_mode VARCHAR(32),
            trail_value DOUBLE PRECISION,
            time_limit_seconds INTEGER,
            created_at TIMESTAMPTZ DEFAULT NOW()
          );

          CREATE INDEX IF NOT EXISTS idx_exit_plans_decision_id ON exit_plans(decision_id);
          CREATE INDEX IF NOT EXISTS idx_exit_plans_symbol ON exit_plans(symbol);

          ALTER TABLE live_trades
            ADD COLUMN IF NOT EXISTS exit_action VARCHAR(32),
            ADD COLUMN IF NOT EXISTS exit_reason TEXT,
            ADD COLUMN IF NOT EXISTS exit_plan_id UUID REFERENCES exit_plans(exit_plan_id) ON DELETE SET NULL;

          CREATE INDEX IF NOT EXISTS idx_live_trades_exit_plan_id ON live_trades(exit_plan_id);
        `;
      }

      await this.pool.query(migrationSQL);
      logger.info('[ExitService] Database tables initialized');
    } catch (error) {
      logger.error('[ExitService] Failed to initialize database tables', error);
      this.pool = null;
    }
  }

  /**
   * Start exit evaluation loop
   */
  start(): void {
    if (!this.config.enabled) {
      logger.info('[ExitService] Disabled, not starting');
      return;
    }

    if (this.isRunning) {
      logger.warn('[ExitService] Already running');
      return;
    }

    this.isRunning = true;
    logger.info(`[ExitService] Starting exit evaluation loop (${this.config.exitTickIntervalSec}s interval)`);

    // Start polling immediately
    this.evaluateAllPositions().catch((error) => {
      logger.error('[ExitService] Error in initial evaluation', error);
    });

    // Set up interval
    this.exitTickInterval = setInterval(() => {
      this.evaluateAllPositions().catch((error) => {
        logger.error('[ExitService] Error in exit evaluation loop', error);
      });
    }, this.config.exitTickIntervalSec * 1000);
  }

  /**
   * Stop exit evaluation loop
   */
  stop(): void {
    if (this.exitTickInterval) {
      clearInterval(this.exitTickInterval);
      this.exitTickInterval = null;
    }
    this.isRunning = false;
    logger.info('[ExitService] Stopped exit evaluation loop');
  }

  /**
   * Evaluate all open positions
   */
  private async evaluateAllPositions(): Promise<void> {
    try {
      // Get open positions from OpenTradesService (which polls MT5 Connector)
      const openPositions = await this.getOpenPositions();
      
      if (openPositions.length === 0) {
        return; // No open positions
      }

      logger.debug(`[ExitService] Evaluating ${openPositions.length} open position(s)`);

      // Check kill switch first - if active, force close all positions
      if (this.killSwitchService && this.killSwitchService.getState().active) {
        logger.warn('[ExitService] Kill switch ACTIVE - forcing closure of all positions');
        for (const position of openPositions) {
          await this.forceCloseAllForKillSwitch(position);
        }
        return;
      }

      // Evaluate each position
      for (const position of openPositions) {
        await this.evaluatePosition(position);
      }
    } catch (error) {
      logger.error('[ExitService] Error evaluating positions', error);
    }
  }

  /**
   * Get open positions from MT5 Connector
   */
  private async getOpenPositions(): Promise<OpenTrade[]> {
    try {
      const response = await this.httpClient.get('/api/v1/open-positions');
      if (response.data.success && response.data.positions) {
        return response.data.positions.map((pos: any) => ({
          symbol: pos.symbol,
          ticket: pos.ticket,
          direction: pos.direction,
          volume: pos.volume,
          openPrice: pos.open_price,
          sl: pos.stop_loss,
          tp: pos.take_profit,
          openTime: new Date(pos.open_time),
        }));
      }
      return [];
    } catch (error) {
      logger.error('[ExitService] Error fetching open positions', error);
      return [];
    }
  }

  /**
   * Evaluate a single position for exit actions
   */
  async evaluatePosition(position: OpenTrade): Promise<void> {
    try {
      // Load exit plan for this position if not cached
      let exitPlan = this.exitPlans[position.ticket];
      if (!exitPlan) {
        const loadedPlan = await this.loadExitPlan(position.ticket);
        if (loadedPlan) {
          exitPlan = loadedPlan;
          this.exitPlans[position.ticket] = exitPlan;
        } else {
          return; // No exit plan found, skip evaluation
        }
      }

      // If no exit plan, skip (static SL/TP only)
      if (!exitPlan) {
        return;
      }

      // Initialize action history if not exists
      if (!this.actionHistory[position.ticket]) {
        this.actionHistory[position.ticket] = {
          breakEvenSet: false,
          partialCloseExecuted: false,
        };
      }

      const history = this.actionHistory[position.ticket];
      const latestTick = this.priceFeed?.getLatestTick(position.symbol);
      
      if (!latestTick) {
        return; // No price data available
      }

      const currentPrice = latestTick.mid;
      const profitPips = this.calculateProfitPips(position, currentPrice);

      // 1. Break-even check
      if (this.config.breakEvenEnabled && !history.breakEvenSet) {
        await this.applyBreakEven(position, exitPlan, profitPips, currentPrice);
      }

      // 2. Partial close check (at TP1)
      if (this.config.partialCloseEnabled && !history.partialCloseExecuted && exitPlan.tp1) {
        await this.applyPartialClose(position, exitPlan, currentPrice);
      }

      // 3. Trailing stop check
      if (this.config.trailingEnabled && exitPlan.trail_mode) {
        await this.applyTrailingStop(position, exitPlan, currentPrice, profitPips);
      }

      // 4. Structure exit check
      if (this.config.structureExitEnabled) {
        await this.applyStructureExit(position, exitPlan, currentPrice);
      }

      // 5. Time-based exit check
      if (this.config.timeExitEnabled && exitPlan.time_limit_seconds) {
        await this.applyTimeExit(position, exitPlan);
      }

      // 6. Commission/swap exit check
      if (this.config.commissionExitEnabled) {
        await this.applyCommissionExit(position, exitPlan);
      }

    } catch (error) {
      logger.error(`[ExitService] Error evaluating position ${position.ticket}`, error);
    }
  }

  /**
   * Apply break-even: Move SL to entry price when profit >= 1R
   * v15: Changed from fixed pips (20) to 1R (Risk:Reward = 1:1)
   */
  private async applyBreakEven(
    position: OpenTrade,
    exitPlan: ExitPlan,
    profitPips: number,
    currentPrice: number
  ): Promise<void> {
    const history = this.actionHistory[position.ticket];
    
    // Calculate 1R in pips (risk = entry - stop loss, 1R = same distance as risk)
    const entryPrice = exitPlan.entry_price || position.openPrice;
    const stopLossPrice = position.sl || exitPlan.stop_loss_initial;
    if (!stopLossPrice) return; // No SL, can't calculate R
    
    const riskAmount = Math.abs(entryPrice - stopLossPrice);
    const oneRInPips = this.convertPriceDistanceToPips(position.symbol, riskAmount);
    
    // Use 1R as trigger (v15 improvement)
    const triggerPips = exitPlan.break_even_trigger || oneRInPips;
    
    if (profitPips >= triggerPips && !history.breakEvenSet) {
      // Move SL to entry price (break-even)
      const modifyRequest: ModifyTradeRequest = {
        ticket: position.ticket,
        stop_loss: exitPlan.entry_price,
        take_profit: position.tp || undefined,
      };

      try {
        const response = await this.httpClient.post('/api/v1/trades/modify', modifyRequest);
        
        if (response.data.success) {
          history.breakEvenSet = true;
          history.lastBreakEvenTime = new Date();

          // Emit event
          if (this.orderEventService) {
            await this.orderEventService.processEvent({
              source: 'mt5-connector',
              event_type: 'break_even_set',
              timestamp: new Date().toISOString(),
              ticket: position.ticket,
              symbol: position.symbol,
              direction: position.direction,
              entry_price: exitPlan.entry_price,
              sl_price: exitPlan.entry_price,
              comment: `Break-even set at ${triggerPips} pips profit`,
            });
          }

          logger.info(
            `[ExitService] Break-even set for ticket ${position.ticket} ` +
            `(profit: ${profitPips.toFixed(2)} pips >= 1R: ${triggerPips.toFixed(2)} pips)`
          );
        }
      } catch (error) {
        logger.error(`[ExitService] Failed to set break-even for ticket ${position.ticket}`, error);
      }
    }
  }

  /**
   * Apply partial close: Close X% at TP1
   */
  private async applyPartialClose(
    position: OpenTrade,
    exitPlan: ExitPlan,
    currentPrice: number
  ): Promise<void> {
    if (!exitPlan.tp1) return;

    const history = this.actionHistory[position.ticket];
    const isBuy = position.direction === 'buy';
    const hitTP1 = isBuy ? currentPrice >= exitPlan.tp1 : currentPrice <= exitPlan.tp1;

    if (hitTP1 && !history.partialCloseExecuted) {
      const closePercent = exitPlan.partial_close_percent || this.config.defaultPartialClosePercent || 50;
      const partialCloseRequest: PartialCloseRequest = {
        ticket: position.ticket,
        volume_percent: closePercent,
      };

      try {
        const response = await this.httpClient.post('/api/v1/trades/partial-close', partialCloseRequest);
        
        if (response.data.success) {
          history.partialCloseExecuted = true;
          history.lastPartialCloseTime = new Date();

          // Emit event
          if (this.orderEventService) {
            await this.orderEventService.processEvent({
              source: 'mt5-connector',
              event_type: 'partial_close',
              timestamp: new Date().toISOString(),
              ticket: position.ticket,
              symbol: position.symbol,
              direction: position.direction,
              volume: position.volume * (closePercent / 100),
              entry_price: exitPlan.entry_price,
              exit_price: exitPlan.tp1,
              tp_price: exitPlan.tp1,
              comment: `Partial close ${closePercent}% at TP1`,
            });
          }

          logger.info(`[ExitService] Partial close ${closePercent}% executed for ticket ${position.ticket}`);
        }
      } catch (error) {
        logger.error(`[ExitService] Failed to execute partial close for ticket ${position.ticket}`, error);
      }
    }
  }

  /**
   * Apply trailing stop: Move SL based on trail mode
   */
  private async applyTrailingStop(
    position: OpenTrade,
    exitPlan: ExitPlan,
    currentPrice: number,
    profitPips: number
  ): Promise<void> {
    const history = this.actionHistory[position.ticket];
    const trailMode = exitPlan.trail_mode || this.config.defaultTrailMode || 'fixed_pips';
    const trailValue = exitPlan.trail_value || this.config.defaultTrailPips || 20;

    // Only trail if in profit
    if (profitPips <= 0) return;

    let newSL: number | null = null;

    switch (trailMode) {
      case 'fixed_pips':
        // Trail SL by fixed pips behind current price
        const pipValue = this.getPipValue(position.symbol, currentPrice);
        if (position.direction === 'buy') {
          newSL = currentPrice - (trailValue * pipValue);
        } else {
          newSL = currentPrice + (trailValue * pipValue);
        }
        break;

      case 'atr':
        // ATR-based trailing (simplified - would need ATR calculation)
        // For now, use fixed pips as fallback
        const atrPipValue = this.getPipValue(position.symbol, currentPrice);
        if (position.direction === 'buy') {
          newSL = currentPrice - (trailValue * atrPipValue);
        } else {
          newSL = currentPrice + (trailValue * atrPipValue);
        }
        break;

      default:
        // structure and volatility_adaptive not implemented yet
        return;
    }

    // Only move SL if new SL is better than current SL (further from entry for buys, closer for sells)
    const currentSL = position.sl || exitPlan.stop_loss_initial;
    if (!currentSL) return;

    const shouldMove = position.direction === 'buy'
      ? newSL > currentSL && newSL > exitPlan.entry_price
      : newSL < currentSL && newSL < exitPlan.entry_price;

    if (shouldMove) {
      // Throttle trailing stops (don't move more than once per 30 seconds)
      const now = new Date();
      if (history.lastTrailTime && (now.getTime() - history.lastTrailTime.getTime()) < 30000) {
        return;
      }

      const modifyRequest: ModifyTradeRequest = {
        ticket: position.ticket,
        stop_loss: newSL,
        take_profit: position.tp || undefined,
      };

      try {
        const response = await this.httpClient.post('/api/v1/trades/modify', modifyRequest);
        
        if (response.data.success) {
          history.lastTrailTime = now;

          // Emit event
          if (this.orderEventService) {
            await this.orderEventService.processEvent({
              source: 'mt5-connector',
              event_type: 'trail_sl_move',
              timestamp: now.toISOString(),
              ticket: position.ticket,
              symbol: position.symbol,
              direction: position.direction,
              sl_price: newSL,
              comment: `Trailing stop moved to ${newSL.toFixed(5)}`,
            });
          }

          logger.debug(`[ExitService] Trailing stop moved for ticket ${position.ticket} to ${newSL.toFixed(5)}`);
        }
      } catch (error) {
        logger.error(`[ExitService] Failed to move trailing stop for ticket ${position.ticket}`, error);
      }
    }
  }

  /**
   * Apply structure exit: Close if structure breaks against trade
   */
  private async applyStructureExit(
    position: OpenTrade,
    exitPlan: ExitPlan,
    currentPrice: number
  ): Promise<void> {
    // Structure-based exit logic would require LTF structure analysis
    // This is a placeholder - would need integration with MarketDataService
    // For now, skip this rule
    return;
  }

  /**
   * Apply time-based exit: Close if position has been open too long
   */
  private async applyTimeExit(
    position: OpenTrade,
    exitPlan: ExitPlan
  ): Promise<void> {
    if (!exitPlan.time_limit_seconds) return;

    const now = new Date();
    const openTime = position.openTime;
    const elapsedSeconds = (now.getTime() - openTime.getTime()) / 1000;

    if (elapsedSeconds >= exitPlan.time_limit_seconds) {
      // Close position
      try {
        const response = await this.httpClient.post('/api/v1/trades/close', {
          ticket: position.ticket,
          reason: 'time_exit',
        });

        if (response.data.success) {
          // Emit event
          if (this.orderEventService) {
            await this.orderEventService.processEvent({
              source: 'mt5-connector',
              event_type: 'time_exit',
              timestamp: now.toISOString(),
              ticket: position.ticket,
              symbol: position.symbol,
              direction: position.direction,
              comment: `Time-based exit after ${elapsedSeconds.toFixed(0)} seconds`,
            });
          }

          const elapsedMinutes = (elapsedSeconds / 60).toFixed(1);
          logger.info(
            `[ExitService] Time-based exit executed for ticket ${position.ticket} ` +
            `(open: ${elapsedMinutes} minutes, limit: ${(exitPlan.time_limit_seconds! / 60).toFixed(0)} minutes)`
          );
          
          // Clean up
          delete this.exitPlans[position.ticket];
          delete this.actionHistory[position.ticket];
        }
      } catch (error) {
        logger.error(`[ExitService] Failed to execute time-based exit for ticket ${position.ticket}`, error);
      }
    }
  }

  /**
   * Apply commission exit: Close if swap+commission exceeds expected reward
   */
  private async applyCommissionExit(
    position: OpenTrade,
    exitPlan: ExitPlan
  ): Promise<void> {
    // This would require getting swap/commission data from MT5
    // For now, skip this rule (placeholder)
    return;
  }

  /**
   * Force close all positions due to kill switch
   */
  private async forceCloseAllForKillSwitch(position: OpenTrade): Promise<void> {
    try {
      const response = await this.httpClient.post('/api/v1/trades/close', {
        ticket: position.ticket,
        reason: 'kill_switch_forced_exit',
      });

      if (response.data.success) {
        // Emit event
        if (this.orderEventService) {
          await this.orderEventService.processEvent({
            source: 'mt5-connector',
            event_type: 'kill_switch_forced_exit',
            timestamp: new Date().toISOString(),
            ticket: position.ticket,
            symbol: position.symbol,
            direction: position.direction,
            comment: 'Forced exit due to kill switch activation',
          });
        }

        logger.warn(`[ExitService] Kill-switch forced exit for ticket ${position.ticket}`);
        
        // Clean up
        delete this.exitPlans[position.ticket];
        delete this.actionHistory[position.ticket];
      }
    } catch (error) {
      logger.error(`[ExitService] Failed to force close ticket ${position.ticket}`, error);
    }
  }

  /**
   * Store exit plan for a position
   */
  async storeExitPlan(decisionId: number, exitPlan: ExitPlan): Promise<string | null> {
    if (!this.pool) return null;

    try {
      const result = await this.pool.query(
        `INSERT INTO exit_plans (
          decision_id, symbol, entry_price, tp1, tp2, tp3,
          stop_loss_initial, break_even_trigger, partial_close_percent,
          trail_mode, trail_value, time_limit_seconds
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING exit_plan_id`,
        [
          decisionId,
          exitPlan.symbol,
          exitPlan.entry_price,
          exitPlan.tp1 || null,
          exitPlan.tp2 || null,
          exitPlan.tp3 || null,
          exitPlan.stop_loss_initial,
          exitPlan.break_even_trigger || null,
          exitPlan.partial_close_percent || null,
          exitPlan.trail_mode || null,
          exitPlan.trail_value || null,
          exitPlan.time_limit_seconds || null,
        ]
      );

      if (result.rows.length > 0) {
        const exitPlanId = result.rows[0].exit_plan_id;
        logger.debug(`[ExitService] Stored exit plan ${exitPlanId} for decision ${decisionId}`);
        return exitPlanId;
      }
      return null;
    } catch (error) {
      logger.error(`[ExitService] Failed to store exit plan for decision ${decisionId}`, error);
      return null;
    }
  }

  /**
   * Load exit plan for a position ticket
   */
  private async loadExitPlan(ticket: number): Promise<ExitPlan | null> {
    if (!this.pool) return null;

    try {
      // Find exit plan via decision_id -> live_trades -> ticket
      const result = await this.pool.query(
        `SELECT ep.* FROM exit_plans ep
         JOIN trade_decisions td ON ep.decision_id = td.id
         WHERE td.execution_result->>'ticket' = $1::text
         ORDER BY ep.created_at DESC
         LIMIT 1`,
        [ticket.toString()]
      );

      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          exit_plan_id: row.exit_plan_id,
          decision_id: row.decision_id,
          symbol: row.symbol,
          entry_price: parseFloat(row.entry_price),
          tp1: row.tp1 ? parseFloat(row.tp1) : null,
          tp2: row.tp2 ? parseFloat(row.tp2) : null,
          tp3: row.tp3 ? parseFloat(row.tp3) : null,
          stop_loss_initial: parseFloat(row.stop_loss_initial),
          break_even_trigger: row.break_even_trigger ? parseFloat(row.break_even_trigger) : null,
          partial_close_percent: row.partial_close_percent ? parseFloat(row.partial_close_percent) : null,
          trail_mode: row.trail_mode as ExitPlan['trail_mode'],
          trail_value: row.trail_value ? parseFloat(row.trail_value) : null,
          time_limit_seconds: row.time_limit_seconds || null,
        };
      }
      return null;
    } catch (error) {
      logger.error(`[ExitService] Failed to load exit plan for ticket ${ticket}`, error);
      return null;
    }
  }

  /**
   * Convert price distance to pips based on symbol type
   */
  private convertPriceDistanceToPips(symbol: string, priceDistance: number): number {
    const upperSymbol = symbol.toUpperCase();
    
    // Gold (XAUUSD): 1 pip = 0.01 (or 0.1 depending on broker)
    if (upperSymbol === 'XAUUSD' || upperSymbol === 'GOLD') {
      return priceDistance * 100; // Assuming 0.01 = 1 pip
    }
    
    // Indices (US30, NAS100, etc.): 1 pip = 1.0
    if (upperSymbol.includes('30') || upperSymbol.includes('100') || upperSymbol.includes('500')) {
      return priceDistance;
    }
    
    // Forex pairs (EURUSD, GBPUSD, etc.): 1 pip = 0.0001 (4 decimal places)
    if (upperSymbol.length === 6 && upperSymbol.match(/^[A-Z]{6}$/)) {
      return priceDistance * 10000; // 0.0001 = 1 pip
    }
    
    // Default: assume 4 decimal places (forex-style)
    return priceDistance * 10000;
  }

  /**
   * Calculate profit in pips
   */
  private calculateProfitPips(position: OpenTrade, currentPrice: number): number {
    const pipValue = this.getPipValue(position.symbol, currentPrice);
    const priceDiff = position.direction === 'buy'
      ? currentPrice - position.openPrice
      : position.openPrice - currentPrice;
    return priceDiff / pipValue;
  }

  /**
   * Get pip value for a symbol
   */
  private getPipValue(symbol: string, price: number): number {
    // Simplified pip calculation
    if (symbol.includes('USD') && symbol.length === 6) {
      // Major FX pairs
      return 0.0001;
    } else if (symbol.includes('XAU')) {
      // Gold
      return 0.1;
    } else if (symbol.includes('US30')) {
      // US30
      return 1;
    }
    return 0.0001; // Default fallback
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    this.stop();
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('[ExitService] Database connection closed');
    }
  }
}

