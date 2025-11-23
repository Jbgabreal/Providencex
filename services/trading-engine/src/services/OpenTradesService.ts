/**
 * OpenTradesService - Real-time exposure and open trades awareness (v4)
 * 
 * Polls MT5 Connector for open positions and maintains an in-memory
 * snapshot of current exposure per symbol and globally.
 */

import axios, { AxiosInstance } from 'axios';
import { Logger } from '@providencex/shared-utils';

const logger = new Logger('OpenTradesService');

/**
 * Open trade from MT5 Connector
 */
export type OpenTrade = {
  symbol: string;
  ticket: number;
  direction: 'buy' | 'sell';
  volume: number;
  openPrice: number;
  sl?: number | null;
  tp?: number | null;
  openTime: Date;
};

/**
 * Exposure snapshot for a symbol
 */
export type ExposureSnapshot = {
  symbol: string;
  longCount: number;
  shortCount: number;
  totalCount: number;
  estimatedRiskAmount: number; // Sum of max loss per trade in account currency
  lastUpdated: Date;
};

/**
 * Global exposure snapshot
 */
export type GlobalSnapshot = {
  totalOpenTrades: number;
  totalEstimatedRiskAmount: number;
  lastUpdated: Date | null;
};

/**
 * Configuration for OpenTradesService
 */
export interface OpenTradesServiceConfig {
  mt5BaseUrl: string;
  pollIntervalSec?: number; // Default: 10
  defaultRiskPerTrade?: number; // Default risk if no SL (e.g., 50-100 units)
}

/**
 * OpenTradesService - Maintains real-time view of open positions
 */
export class OpenTradesService {
  private config: Required<OpenTradesServiceConfig>;
  private httpClient: AxiosInstance;
  private symbolSnapshots: Map<string, ExposureSnapshot> = new Map();
  private globalSnapshot: GlobalSnapshot = {
    totalOpenTrades: 0,
    totalEstimatedRiskAmount: 0,
    lastUpdated: null,
  };
  private pollTimer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(config: OpenTradesServiceConfig) {
    this.config = {
      mt5BaseUrl: config.mt5BaseUrl,
      pollIntervalSec: config.pollIntervalSec || 10,
      defaultRiskPerTrade: config.defaultRiskPerTrade || 75.0, // Conservative default
    };

    // Create HTTP client for MT5 Connector
    this.httpClient = axios.create({
      baseURL: this.config.mt5BaseUrl,
      timeout: 5000, // 5 second timeout
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info(`OpenTradesService initialized: mt5BaseUrl=${this.config.mt5BaseUrl}, pollInterval=${this.config.pollIntervalSec}s`);
  }

  /**
   * Start polling for open positions
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('OpenTradesService is already running');
      return;
    }

    this.isRunning = true;
    logger.info(`Starting OpenTradesService polling (interval: ${this.config.pollIntervalSec}s)`);

    // Poll immediately on start
    this.pollOpenPositions();

    // Set up interval polling
    this.pollTimer = setInterval(() => {
      this.pollOpenPositions();
    }, this.config.pollIntervalSec * 1000);
  }

  /**
   * Stop polling for open positions
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    logger.info('OpenTradesService stopped');
  }

  /**
   * Poll MT5 Connector for open positions
   */
  private async pollOpenPositions(): Promise<void> {
    try {
      const response = await this.httpClient.get<{
        success: boolean;
        positions: Array<{
          symbol: string;
          ticket: number;
          direction: 'buy' | 'sell';
          volume: number;
          open_price: number;
          sl?: number | null;
          tp?: number | null;
          open_time: string; // ISO 8601
        }>;
        error?: string;
      }>('/api/v1/open-positions');

      if (!response.data.success) {
        logger.error(`Failed to get open positions: ${response.data.error || 'Unknown error'}`);
        // Keep last known snapshots on error
        return;
      }

      // Convert API response to OpenTrade format
      const openTrades: OpenTrade[] = response.data.positions.map((pos) => ({
        symbol: pos.symbol.toUpperCase(), // Normalize to uppercase
        ticket: pos.ticket,
        direction: pos.direction.toLowerCase() as 'buy' | 'sell',
        volume: pos.volume,
        openPrice: pos.open_price,
        sl: pos.sl || null,
        tp: pos.tp || null,
        openTime: new Date(pos.open_time),
      }));

      // Update snapshots
      this.updateSnapshots(openTrades);

      logger.debug(`Updated open positions snapshot: ${openTrades.length} positions across ${this.symbolSnapshots.size} symbols`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error polling open positions: ${errorMessage}`, {
        error: errorMessage,
        mt5BaseUrl: this.config.mt5BaseUrl,
      });
      // Keep last known snapshots on error - don't crash
    }
  }

  /**
   * Update exposure snapshots from open trades
   * Public method for backtesting (allows manual injection of positions)
   */
  updateSnapshots(openTrades: OpenTrade[]): void {
    const now = new Date();
    
    // Reset symbol snapshots map
    this.symbolSnapshots.clear();

    // Group trades by symbol
    const tradesBySymbol = new Map<string, OpenTrade[]>();
    for (const trade of openTrades) {
      const symbol = trade.symbol;
      if (!tradesBySymbol.has(symbol)) {
        tradesBySymbol.set(symbol, []);
      }
      tradesBySymbol.get(symbol)!.push(trade);
    }

    // Calculate exposure per symbol
    let totalRisk = 0;
    
    for (const [symbol, trades] of tradesBySymbol.entries()) {
      let longCount = 0;
      let shortCount = 0;
      let estimatedRiskAmount = 0;

      for (const trade of trades) {
        // Count by direction
        if (trade.direction === 'buy') {
          longCount++;
        } else {
          shortCount++;
        }

        // Calculate estimated risk per trade
        // If SL is present, use distance from open price
        // Otherwise, use default risk
        let tradeRisk: number;
        if (trade.sl && trade.sl > 0) {
          // Risk = |openPrice - sl| * volume
          // TODO: In future, multiply by tick value if available from broker
          const slDistance = Math.abs(trade.openPrice - trade.sl);
          tradeRisk = slDistance * trade.volume;
        } else {
          // No SL - use conservative default risk
          tradeRisk = this.config.defaultRiskPerTrade * trade.volume;
        }

        estimatedRiskAmount += tradeRisk;
        totalRisk += tradeRisk;
      }

      const snapshot: ExposureSnapshot = {
        symbol,
        longCount,
        shortCount,
        totalCount: trades.length,
        estimatedRiskAmount,
        lastUpdated: now,
      };

      this.symbolSnapshots.set(symbol, snapshot);
    }

    // Update global snapshot
    this.globalSnapshot = {
      totalOpenTrades: openTrades.length,
      totalEstimatedRiskAmount: totalRisk,
      lastUpdated: now,
    };
  }

  /**
   * Get exposure snapshot for a specific symbol
   * Returns null if symbol has no open trades
   */
  getSnapshotForSymbol(symbol: string): ExposureSnapshot | null {
    const normalizedSymbol = symbol.toUpperCase();
    return this.symbolSnapshots.get(normalizedSymbol) || null;
  }

  /**
   * Get global exposure snapshot
   */
  getGlobalSnapshot(): GlobalSnapshot {
    return { ...this.globalSnapshot }; // Return a copy
  }

  /**
   * Check if service is running
   */
  isServiceRunning(): boolean {
    return this.isRunning;
  }
}

