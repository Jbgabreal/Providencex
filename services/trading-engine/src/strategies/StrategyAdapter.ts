/**
 * Strategy Adapter
 * 
 * Adapts IStrategy interface to work with existing StrategyService interface
 * for backward compatibility with CandleReplayEngine and other services.
 */

import { Logger } from '@providencex/shared-utils';
import { IStrategy, StrategyContext, StrategyResult } from './types';
import { TradeSignal } from '../types';
import { MarketDataService } from '../services/MarketDataService';
import { Candle } from '../marketData/types';

const logger = new Logger('StrategyAdapter');

/**
 * Adapter that makes IStrategy compatible with StrategyService interface
 */
export class StrategyAdapter {
  private strategy: IStrategy;
  private marketDataService: MarketDataService;

  constructor(strategy: IStrategy, marketDataService: MarketDataService) {
    this.strategy = strategy;
    this.marketDataService = marketDataService;
  }

  /**
   * Generate signal (compatible with StrategyService.generateSignal)
   */
  async generateSignal(symbol: string): Promise<TradeSignal | null> {
    try {
      // Create strategy context
      const context: StrategyContext = {
        symbol,
        timeframe: 'M1', // Default, can be overridden
        candles: [], // Will be fetched by strategy if needed
        marketDataService: this.marketDataService,
      };

      // Execute strategy
      const result: StrategyResult = await this.strategy.execute(context);

      // If no orders, return null
      if (!result.orders || result.orders.length === 0) {
        return null;
      }

      // Return first order's signal (for now, we only support one order per execution)
      const order = result.orders[0];
      return order.signal;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[StrategyAdapter] Error generating signal for ${symbol}:`, errorMsg);
      return null;
    }
  }

  /**
   * Get last SMC reason (for compatibility with StrategyService)
   */
  getLastSmcReason(): string | null {
    // Strategy implementations can store rejection reasons in debug metadata
    // For now, return null (can be enhanced later)
    return null;
  }

  /**
   * Get last SMC debug reasons (for compatibility with StrategyService)
   */
  getLastSmcDebugReasons(): string[] {
    // Strategy implementations can store debug reasons in debug metadata
    // For now, return empty array (can be enhanced later)
    return [];
  }

  /**
   * Get metrics summary (for compatibility with StrategyService)
   */
  getMetricsSummary() {
    // Strategy implementations can provide metrics in result.metadata
    // For now, return null (can be enhanced later)
    return null;
  }

  /**
   * Log metrics summary (for compatibility with StrategyService)
   */
  logMetricsSummary() {
    // Strategy implementations can log metrics
    // For now, do nothing (can be enhanced later)
  }

  /**
   * Reset metrics (for compatibility with StrategyService)
   */
  resetMetrics() {
    // Strategy implementations can reset metrics
    // For now, do nothing (can be enhanced later)
  }
}

