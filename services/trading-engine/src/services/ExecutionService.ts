import axios from 'axios';
import { TradeRequest, TradeResponse } from '@providencex/shared-types';
import { getConfig } from '../config';
import { Logger } from '@providencex/shared-utils';
import { PriceFeedClient, CandleStore } from '../marketData';
import { TradeSignal, ExecutionResult, Strategy } from '../types';
import { OrderFlowService } from './OrderFlowService';

const logger = new Logger('ExecutionService');

/**
 * ExecutionService - Sends trade instructions to MT5 Connector
 * v2: Uses real market data for price context
 */
export class ExecutionService {
  private mt5ConnectorUrl: string;
  private priceFeed?: PriceFeedClient;
  private candleStore?: CandleStore;
  private orderFlowService?: OrderFlowService; // v14: Order flow service

  constructor(
    priceFeed?: PriceFeedClient, 
    candleStore?: CandleStore,
    orderFlowService?: OrderFlowService // v14: Optional order flow service
  ) {
    const config = getConfig();
    this.mt5ConnectorUrl = config.mt5ConnectorUrl;
    this.priceFeed = priceFeed;
    this.candleStore = candleStore;
    this.orderFlowService = orderFlowService;
  }

  /**
   * Open a trade via MT5 Connector
   */
  async openTrade(
    signal: TradeSignal,
    lotSize: number,
    strategy: Strategy
  ): Promise<ExecutionResult> {
    try {
      // Get real-time price context (v2)
      const latestTick = this.priceFeed?.getLatestTick(signal.symbol);
      const latestCandle = this.candleStore?.getLatestCandle(signal.symbol);

      if (latestTick) {
        logger.info(
          `Opening trade: ${signal.symbol} ${signal.direction} @ ${signal.entry}, ` +
          `lot_size: ${lotSize}, current_price: bid=${latestTick.bid} ask=${latestTick.ask} ` +
          `(mid=${latestTick.mid.toFixed(5)}), latest_candle_close: ${latestCandle?.close.toFixed(5) || 'N/A'}`
        );
      } else {
        logger.warn(
          `No price data available for ${signal.symbol}. Proceeding with trade execution, ` +
          `but price context is unavailable.`
        );
      }

      logger.info(
        `Opening trade: ${signal.symbol} ${signal.direction} @ ${signal.entry}, lot_size: ${lotSize}`
      );

      // Build TradeRequest payload
      const tradeRequest: TradeRequest = {
        symbol: signal.symbol,
        direction: signal.direction.toUpperCase() as 'BUY' | 'SELL',
        entry_type: 'MARKET', // Legacy field
        order_kind: 'market', // Market execution for now
        entry_price: signal.entry, // May be ignored for market orders
        lot_size: lotSize,
        stop_loss_price: signal.stopLoss,
        take_profit_price: signal.takeProfit,
        strategy_id: 'smc_v1',
        metadata: {
          signal_reason: signal.reason,
          strategy,
          ...signal.meta,
        },
      };

      // Call MT5 Connector API
      const response = await axios.post<TradeResponse>(
        `${this.mt5ConnectorUrl}/api/v1/trades/open`,
        tradeRequest,
        {
          timeout: 10000, // 10 second timeout
          validateStatus: (status) => status < 500, // Accept 4xx as errors, but handle gracefully
        }
      );

      if (response.status >= 200 && response.status < 300) {
        logger.info(
          `Trade executed successfully: MT5 ticket ${response.data.mt5_ticket}`
        );

        return {
          success: true,
          ticket: response.data.mt5_ticket,
        };
      } else {
        const errorMessage = `MT5 Connector returned status ${response.status}`;
        logger.error(errorMessage);
        return {
          success: false,
          error: errorMessage,
        };
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorMessage = error.response?.data?.error || error.message || 'Unknown error';
        logger.error(`Failed to execute trade: ${errorMessage}`, {
          symbol: signal.symbol,
          direction: signal.direction,
          entry: signal.entry,
        });

        return {
          success: false,
          error: errorMessage,
        };
      }

      logger.error('Unexpected error executing trade', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Close a trade via MT5 Connector
   */
  async closeTrade(mt5Ticket: string | number, reason?: string): Promise<ExecutionResult> {
    try {
      logger.info(`Closing trade: MT5 ticket ${mt5Ticket}, reason: ${reason || 'N/A'}`);

      const response = await axios.post(
        `${this.mt5ConnectorUrl}/api/v1/trades/close`,
        {
          mt5_ticket: mt5Ticket,
          reason,
        },
        {
          timeout: 10000,
        }
      );

      if (response.status >= 200 && response.status < 300) {
        logger.info(`Trade closed successfully: MT5 ticket ${mt5Ticket}`);
        return {
          success: true,
        };
      } else {
        return {
          success: false,
          error: `MT5 Connector returned status ${response.status}`,
        };
      }
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.error || error.message
        : error instanceof Error
        ? error.message
        : 'Unknown error';

      logger.error(`Failed to close trade: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * v14: Smart Entry Refinement - Validate micro order flow before execution
   * 
   * Checks order flow for micro-confirmation (1-3 ticks) before executing market order.
   * Waits up to 3 seconds, checking every 200ms.
   * 
   * Returns true if micro-confirmation passes, false otherwise.
   */
  private async validateMicroOrderFlow(
    signal: TradeSignal,
    timeoutMs: number = 3000
  ): Promise<{ valid: boolean; reason: string }> {
    if (!this.orderFlowService) {
      return { valid: true, reason: 'Order flow service not available' };
    }

    const checkIntervalMs = 200; // Check every 200ms
    const maxChecks = timeoutMs / checkIntervalMs;
    let consecutiveFailures = 0;
    const maxFailures = 3; // Fail after 3 consecutive failures

    for (let i = 0; i < maxChecks; i++) {
      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));

      const snapshot = this.orderFlowService.getSnapshot(signal.symbol);
      if (!snapshot) {
        // No snapshot available - continue checking
        continue;
      }

      let checkPassed = true;
      const checkReasons: string[] = [];

      if (signal.direction === 'buy') {
        // For buy: require ask volume > bid volume, delta1s > 0, no large sell orders
        if (snapshot.askVolume <= snapshot.bidVolume) {
          checkPassed = false;
          checkReasons.push(`ask_volume <= bid_volume (${snapshot.askVolume} <= ${snapshot.bidVolume})`);
        }
        if (snapshot.delta1s <= 0) {
          checkPassed = false;
          checkReasons.push(`delta1s <= 0 (${snapshot.delta1s.toFixed(2)})`);
        }
        if (snapshot.largeSellOrders > 0) {
          checkPassed = false;
          checkReasons.push(`${snapshot.largeSellOrders} large sell orders detected`);
        }
      } else {
        // For sell: require bid volume > ask volume, delta1s < 0, no large buy orders
        if (snapshot.bidVolume <= snapshot.askVolume) {
          checkPassed = false;
          checkReasons.push(`bid_volume <= ask_volume (${snapshot.bidVolume} <= ${snapshot.askVolume})`);
        }
        if (snapshot.delta1s >= 0) {
          checkPassed = false;
          checkReasons.push(`delta1s >= 0 (${snapshot.delta1s.toFixed(2)})`);
        }
        if (snapshot.largeBuyOrders > 0) {
          checkPassed = false;
          checkReasons.push(`${snapshot.largeBuyOrders} large buy orders detected`);
        }
      }

      if (checkPassed) {
        // Micro-confirmation passed
        return { 
          valid: true, 
          reason: `Micro-confirmation passed: delta1s=${snapshot.delta1s.toFixed(2)}, buyPressure=${snapshot.buyPressureScore.toFixed(1)}` 
        };
      } else {
        consecutiveFailures++;
        if (consecutiveFailures >= maxFailures) {
          return { 
            valid: false, 
            reason: `Micro-confirmation failed after ${maxFailures} checks: ${checkReasons.join('; ')}` 
          };
        }
      }
    }

    // Timeout - no confirmation within timeout period
    return { 
      valid: false, 
      reason: `Micro-confirmation timeout after ${timeoutMs}ms` 
    };
  }
}
