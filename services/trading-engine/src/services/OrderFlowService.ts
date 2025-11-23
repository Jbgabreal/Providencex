/**
 * OrderFlowService (Trading Engine v14)
 * 
 * Polls MT5 Connector for order flow data, computes deltas, CVD, and pressure metrics
 */

import { EventEmitter } from 'events';
import { Logger } from '@providencex/shared-utils';
import axios, { AxiosInstance, AxiosError } from 'axios';

const logger = new Logger('OrderFlowService');

/**
 * Order flow snapshot from MT5 Connector
 */
export interface MT5OrderFlowResponse {
  symbol: string;
  timestamp: string;
  bid_volume: number;
  ask_volume: number;
  delta: number;
  delta_sign: 'buying_pressure' | 'selling_pressure' | 'neutral';
  imbalance_buy_pct: number;
  imbalance_sell_pct: number;
  large_orders: Array<{
    volume: number;
    side: 'buy' | 'sell';
    price: number;
  }>;
}

/**
 * Processed order flow snapshot with computed metrics
 */
export interface OrderFlowSnapshot {
  timestamp: Date;
  symbol: string;
  delta1s: number; // 1-second delta
  delta5s: number; // 5-second delta
  delta15s: number; // 15-second delta
  delta60s: number; // 60-second delta (optional)
  cvd: number; // Cumulative Volume Delta
  buyPressureScore: number; // 0-100
  sellPressureScore: number; // 0-100
  orderImbalance: number; // -100 to 100 (positive = buy pressure)
  largeBuyOrders: number; // Count of large buy orders
  largeSellOrders: number; // Count of large sell orders
  absorptionBuy: boolean; // Detected absorption on buy side
  absorptionSell: boolean; // Detected absorption on sell side
  deltaMomentum: number; // Rate of change in delta
  rawData: MT5OrderFlowResponse; // Original response
  askVolume: number; // Ask volume from raw data (for smart entry refinement)
  bidVolume: number; // Bid volume from raw data (for smart entry refinement)
}

/**
 * Order flow configuration
 */
export interface OrderFlowConfig {
  mt5ConnectorUrl: string;
  pollIntervalMs: number; // Default: 1000ms
  largeOrderMultiplier: number; // Default: 20x
  minDeltaTrendConfirmation: number; // Default: 50
  exhaustionThreshold: number; // Default: 70
  absorptionLookback: number; // Default: 5 seconds
  enabled: boolean; // Default: true
}

/**
 * OrderFlowService - Monitors order flow in real-time
 */
export class OrderFlowService extends EventEmitter {
  private config: Required<OrderFlowConfig>;
  private httpClient: AxiosInstance;
  private pollIntervals: Map<string, NodeJS.Timeout> = new Map();
  private snapshots: Map<string, OrderFlowSnapshot[]> = new Map(); // Rolling windows
  private latestSnapshots: Map<string, OrderFlowSnapshot> = new Map();
  private cvdHistory: Map<string, number[]> = new Map(); // Cumulative CVD per symbol
  private isRunning: boolean = false;
  private symbolStates: Map<string, { retryCount: number; lastError?: string }> = new Map();

  constructor(config: OrderFlowConfig) {
    super();
    
    this.config = {
      mt5ConnectorUrl: config.mt5ConnectorUrl,
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      largeOrderMultiplier: config.largeOrderMultiplier ?? 20,
      minDeltaTrendConfirmation: config.minDeltaTrendConfirmation ?? 50,
      exhaustionThreshold: config.exhaustionThreshold ?? 70,
      absorptionLookback: config.absorptionLookback ?? 5,
      enabled: config.enabled ?? true,
    };

    // Create HTTP client for MT5 Connector
    this.httpClient = axios.create({
      baseURL: this.config.mt5ConnectorUrl,
      timeout: 5000,
    });

    logger.info(`[OrderFlowService] Initialized: pollInterval=${this.config.pollIntervalMs}ms, enabled=${this.config.enabled}`);
  }

  /**
   * Start polling for order flow data
   */
  start(symbols: string[]): void {
    if (!this.config.enabled) {
      logger.info('[OrderFlowService] Order flow disabled - skipping start');
      return;
    }

    if (this.isRunning) {
      logger.warn('[OrderFlowService] Already running');
      return;
    }

    this.isRunning = true;
    logger.info(`[OrderFlowService] Starting order flow monitoring for symbols: ${symbols.join(', ')}`);

    // Initialize symbol states
    symbols.forEach(symbol => {
      this.symbolStates.set(symbol, { retryCount: 0 });
      this.snapshots.set(symbol, []);
      this.cvdHistory.set(symbol, []);
    });

    // Start polling for each symbol
    symbols.forEach(symbol => {
      this.startPollingForSymbol(symbol);
    });
  }

  /**
   * Stop polling for all symbols
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    logger.info('[OrderFlowService] Stopping order flow monitoring');

    // Clear all intervals
    this.pollIntervals.forEach(interval => clearInterval(interval));
    this.pollIntervals.clear();
  }

  /**
   * Start polling for a specific symbol
   */
  private startPollingForSymbol(symbol: string): void {
    if (this.pollIntervals.has(symbol)) {
      return; // Already polling
    }

    const poll = async () => {
      try {
        await this.fetchOrderFlow(symbol);
        
        // Reset retry count on success
        const state = this.symbolStates.get(symbol);
        if (state) {
          state.retryCount = 0;
          state.lastError = undefined;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[OrderFlowService] Failed to fetch order flow for ${symbol}`, error);
        
        // Track retry count
        const state = this.symbolStates.get(symbol);
        if (state) {
          state.retryCount++;
          state.lastError = errorMsg;
        }

        // If too many retries, stop polling for this symbol
        if (state && state.retryCount >= 5) {
          logger.error(`[OrderFlowService] Too many retries for ${symbol} - stopping polling`);
          this.stopPollingForSymbol(symbol);
        }
      }
    };

    // Poll immediately, then at interval
    poll();
    const interval = setInterval(poll, this.config.pollIntervalMs);
    this.pollIntervals.set(symbol, interval);
  }

  /**
   * Stop polling for a specific symbol
   */
  private stopPollingForSymbol(symbol: string): void {
    const interval = this.pollIntervals.get(symbol);
    if (interval) {
      clearInterval(interval);
      this.pollIntervals.delete(symbol);
    }
  }

  /**
   * Fetch order flow data from MT5 Connector
   */
  private async fetchOrderFlow(symbol: string): Promise<void> {
    try {
      const response = await this.httpClient.get<MT5OrderFlowResponse>(
        `/api/v1/order-flow/${symbol}`
      );

      const rawData = response.data;
      
      // Process and compute metrics
      const snapshot = this.processSnapshot(rawData);
      
      // Store snapshot
      this.latestSnapshots.set(symbol, snapshot);
      
      // Add to rolling window (keep last 60 snapshots = ~60 seconds)
      const snapshots = this.snapshots.get(symbol) || [];
      snapshots.push(snapshot);
      
      // Maintain rolling window (keep last 60)
      if (snapshots.length > 60) {
        snapshots.shift();
      }
      this.snapshots.set(symbol, snapshots);

      // Emit event
      this.emit('snapshot', snapshot);

      logger.debug(`[OrderFlowService] ${symbol}: delta15s=${snapshot.delta15s.toFixed(2)}, CVD=${snapshot.cvd.toFixed(2)}, buyPressure=${snapshot.buyPressureScore.toFixed(1)}`);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        
        // Handle 404 - endpoint not available (backward compatible)
        if (axiosError.response?.status === 404) {
          logger.debug(`[OrderFlowService] Order flow endpoint not available for ${symbol} - skipping`);
          return;
        }
        
        // Handle network errors gracefully (ECONNRESET, ECONNREFUSED, ETIMEDOUT, etc.)
        const errorCode = axiosError.code || (axiosError as any).errno;
        const isNetworkError = 
          errorCode === 'ECONNRESET' ||
          errorCode === 'ECONNREFUSED' ||
          errorCode === 'ETIMEDOUT' ||
          errorCode === 'ENOTFOUND' ||
          errorCode === 'ECONNABORTED';
        
        if (isNetworkError) {
          // Get symbol state to check if we should log
          const state = this.symbolStates.get(symbol);
          const retryCount = state?.retryCount || 0;
          
          // Only log detailed error on first occurrence or every 10 retries
          if (retryCount === 0 || retryCount % 10 === 0) {
            logger.warn(
              `[OrderFlowService] Network error for ${symbol}: ${errorCode || 'unknown'} - ` +
              `will retry (attempt ${retryCount + 1})`
            );
          } else {
            // Suppress detailed logging for repeated errors
            logger.debug(`[OrderFlowService] ${symbol}: Still failing with ${errorCode} (suppressed log)`);
          }
          
          // Don't throw - let the polling loop continue and retry
          return;
        }
        
        // Handle HTTP errors (502, 503, 500, etc.)
        if (axiosError.response?.status) {
          const status = axiosError.response.status;
          if (status >= 500 || status === 502 || status === 503) {
            // Server error - log and continue
            const state = this.symbolStates.get(symbol);
            const retryCount = state?.retryCount || 0;
            
            if (retryCount === 0 || retryCount % 10 === 0) {
              logger.warn(
                `[OrderFlowService] Server error for ${symbol}: HTTP ${status} - will retry (attempt ${retryCount + 1})`
              );
            }
            
            // Don't throw - let the polling loop continue
            return;
          }
        }
      }
      
      // For unknown errors, log once but don't crash
      const state = this.symbolStates.get(symbol);
      const retryCount = state?.retryCount || 0;
      
      if (retryCount === 0) {
        logger.error(`[OrderFlowService] Unexpected error for ${symbol}`, error);
      }
      
      // Don't throw - let the polling loop continue
      return;
    }
  }

  /**
   * Process raw order flow data and compute metrics
   */
  private processSnapshot(rawData: MT5OrderFlowResponse): OrderFlowSnapshot {
    const symbol = rawData.symbol;
    const timestamp = new Date(rawData.timestamp);
    const snapshots = this.snapshots.get(symbol) || [];
    
    // Compute deltas for different time windows
    const delta1s = rawData.delta;
    
    // For multi-second deltas, we need historical snapshots
    // For now, use current delta as approximation
    const delta5s = this.computeDeltaForWindow(snapshots, 5);
    const delta15s = this.computeDeltaForWindow(snapshots, 15);
    const delta60s = this.computeDeltaForWindow(snapshots, 60);

    // Compute Cumulative Volume Delta (CVD)
    const cvdHistory = this.cvdHistory.get(symbol) || [];
    const lastCvd = cvdHistory.length > 0 ? cvdHistory[cvdHistory.length - 1] : 0;
    const newCvd = lastCvd + delta1s;
    cvdHistory.push(newCvd);
    
    // Keep CVD history (last 60 values)
    if (cvdHistory.length > 60) {
      cvdHistory.shift();
    }
    this.cvdHistory.set(symbol, cvdHistory);

    // Compute buy/sell pressure scores
    const buyPressureScore = rawData.imbalance_buy_pct;
    const sellPressureScore = rawData.imbalance_sell_pct;
    const orderImbalance = rawData.imbalance_buy_pct - rawData.imbalance_sell_pct; // -100 to 100

    // Count large orders
    const largeBuyOrders = rawData.large_orders.filter(o => o.side === 'buy').length;
    const largeSellOrders = rawData.large_orders.filter(o => o.side === 'sell').length;

    // Detect absorption
    const { absorptionBuy, absorptionSell } = this.detectAbsorption(snapshots, symbol);

    // Compute delta momentum (rate of change)
    const deltaMomentum = this.computeDeltaMomentum(snapshots);

    return {
      timestamp,
      symbol,
      delta1s,
      delta5s,
      delta15s,
      delta60s,
      cvd: newCvd,
      buyPressureScore,
      sellPressureScore,
      orderImbalance,
      largeBuyOrders,
      largeSellOrders,
      absorptionBuy,
      absorptionSell,
      deltaMomentum,
      rawData,
      askVolume: rawData.ask_volume,
      bidVolume: rawData.bid_volume,
    };
  }

  /**
   * Compute delta for a time window
   */
  private computeDeltaForWindow(snapshots: OrderFlowSnapshot[], windowSeconds: number): number {
    if (snapshots.length === 0) {
      return 0;
    }

    // Get snapshots within the window (assuming 1 snapshot per second)
    const windowSnapshots = snapshots.slice(-windowSeconds);
    
    if (windowSnapshots.length === 0) {
      return 0;
    }

    // Sum deltas in the window
    const sumDelta = windowSnapshots.reduce((sum, s) => sum + s.delta1s, 0);
    return sumDelta;
  }

  /**
   * Detect absorption patterns
   */
  private detectAbsorption(snapshots: OrderFlowSnapshot[], symbol: string): { absorptionBuy: boolean; absorptionSell: boolean } {
    if (snapshots.length < this.config.absorptionLookback) {
      return { absorptionBuy: false, absorptionSell: false };
    }

    // Check last N snapshots for absorption patterns
    const recent = snapshots.slice(-this.config.absorptionLookback);
    
    // Absorption: price moves up but delta decreases (or vice versa)
    // For now, simplified detection: if delta is positive but decreasing while price should be rising
    // This is a placeholder - real absorption detection needs price data
    
    let absorptionBuy = false;
    let absorptionSell = false;

    // Check if delta is consistently high but momentum is negative (absorption)
    const avgDelta = recent.reduce((sum, s) => sum + s.delta1s, 0) / recent.length;
    const momentum = recent[recent.length - 1].deltaMomentum - recent[0].deltaMomentum;

    if (avgDelta > 0 && momentum < -this.config.exhaustionThreshold) {
      absorptionSell = true; // Buy absorption (sellers absorbing)
    } else if (avgDelta < 0 && momentum > this.config.exhaustionThreshold) {
      absorptionBuy = true; // Sell absorption (buyers absorbing)
    }

    return { absorptionBuy, absorptionSell };
  }

  /**
   * Compute delta momentum (rate of change)
   */
  private computeDeltaMomentum(snapshots: OrderFlowSnapshot[]): number {
    if (snapshots.length < 2) {
      return 0;
    }

    const recent = snapshots.slice(-5); // Last 5 snapshots
    if (recent.length < 2) {
      return 0;
    }

    const firstDelta = recent[0].delta1s;
    const lastDelta = recent[recent.length - 1].delta1s;
    return lastDelta - firstDelta;
  }

  /**
   * Get latest order flow snapshot for a symbol
   */
  getSnapshot(symbol: string): OrderFlowSnapshot | null {
    return this.latestSnapshots.get(symbol) || null;
  }

  /**
   * Get order flow snapshots for a symbol (rolling window)
   */
  getSnapshots(symbol: string, limit?: number): OrderFlowSnapshot[] {
    const snapshots = this.snapshots.get(symbol) || [];
    if (limit) {
      return snapshots.slice(-limit);
    }
    return snapshots;
  }

  /**
   * Check if service is running
   */
  isServiceRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Check if service is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

