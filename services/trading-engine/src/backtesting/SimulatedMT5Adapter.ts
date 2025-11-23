/**
 * SimulatedMT5Adapter - Simulates MT5 Connector for backtesting
 * 
 * Provides the same interface as MT5Connector but tracks positions in memory
 * and simulates SL/TP hits, spread, and slippage.
 */

import { Logger } from '@providencex/shared-utils';
import { SimulatedPosition } from './types';
import { HistoricalCandle } from './types';

const logger = new Logger('SimMT5');

export interface SimulatedMT5Config {
  initialBalance: number;
  spreadPips?: number; // Default spread in pips
  slippagePips?: number; // Slippage per trade in pips
}

/**
 * SimulatedMT5Adapter - Replacement for MT5Connector in backtests
 */
export class SimulatedMT5Adapter {
  private config: SimulatedMT5Config;
  private positions: Map<number, SimulatedPosition> = new Map();
  private nextTicket: number = 1;
  private balance: number;
  private closedTrades: Array<SimulatedPosition & { profit: number }> = [];

  constructor(config: SimulatedMT5Config) {
    this.config = config;
    this.balance = config.initialBalance;
    logger.info(
      `[SimMT5] Initialized with balance: ${config.initialBalance}, spread: ${config.spreadPips || 0} pips, slippage: ${config.slippagePips || 0} pips`
    );
  }

  /**
   * Open a simulated trade
   */
  openTrade(params: {
    symbol: string;
    direction: 'buy' | 'sell';
    volume: number;
    entryPrice?: number; // If not provided, uses current candle open
    stopLoss?: number | null;
    takeProfit?: number | null;
    currentCandle?: HistoricalCandle; // For realistic entry price
  }): SimulatedPosition {
    const ticket = this.nextTicket++;
    const { symbol, direction, volume, stopLoss, takeProfit, currentCandle } = params;

    // Determine entry price
    let entryPrice: number;
    if (params.entryPrice !== undefined) {
      entryPrice = params.entryPrice;
    } else if (currentCandle) {
      // Use candle open as entry (default behavior)
      entryPrice = currentCandle.open;
    } else {
      // Fallback: use default price if no candle provided
      entryPrice = 100.0;
      logger.warn(`[SimMT5] No entry price or candle provided, using ${entryPrice}`);
    }

    // Apply spread to entry price
    const spread = this.getSpreadInPriceUnits(symbol, entryPrice);
    if (direction === 'buy') {
      entryPrice = entryPrice + spread / 2; // Buy at ask (higher)
    } else {
      entryPrice = entryPrice - spread / 2; // Sell at bid (lower)
    }

    // Apply slippage
    const slippage = this.getSlippageInPriceUnits(symbol, entryPrice);
    if (direction === 'buy') {
      entryPrice = entryPrice + slippage;
    } else {
      entryPrice = entryPrice - slippage;
    }

    const position: SimulatedPosition = {
      ticket,
      symbol,
      volume,
      entryPrice,
      sl: stopLoss || null,
      tp: takeProfit || null,
      direction,
      openTime: currentCandle?.timestamp || Date.now(),
    };

    this.positions.set(ticket, position);

    logger.debug(
      `[SimMT5] Opened ${direction} ${volume} lots ${symbol} @ ${entryPrice.toFixed(5)} (ticket: ${ticket})`
    );

    return { ...position };
  }

  /**
   * Close a position by ticket
   */
  closeTrade(ticket: number, exitPrice: number, exitTime: number): {
    success: boolean;
    profit?: number;
    error?: string;
  } {
    const position = this.positions.get(ticket);
    if (!position) {
      return {
        success: false,
        error: `Position with ticket ${ticket} not found`,
      };
    }

    // Apply spread to exit price
    const spread = this.getSpreadInPriceUnits(position.symbol, exitPrice);
    let finalExitPrice = exitPrice;
    if (position.direction === 'buy') {
      finalExitPrice = exitPrice - spread / 2; // Close buy at bid (lower)
    } else {
      finalExitPrice = exitPrice + spread / 2; // Close sell at ask (higher)
    }

    // Calculate profit
    const profit = this.calculateProfit(position, finalExitPrice);
    
    position.closeTime = exitTime;
    position.closePrice = finalExitPrice;
    position.profit = profit;

    // Update balance
    this.balance += profit;

    // Move to closed trades
    this.positions.delete(ticket);
    this.closedTrades.push({ ...position, profit });

    logger.debug(
      `[SimMT5] Closed ticket ${ticket} @ ${finalExitPrice.toFixed(5)}, profit: ${profit.toFixed(2)} (balance: ${this.balance.toFixed(2)})`
    );

    return {
      success: true,
      profit,
    };
  }

  /**
   * Get all open positions
   */
  getOpenPositions(): SimulatedPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Check if any positions hit SL/TP on this candle
   * Returns array of tickets that should be closed
   */
  checkStopLossTakeProfit(candle: HistoricalCandle): Array<{
    ticket: number;
    reason: 'sl' | 'tp';
    exitPrice: number;
  }> {
    const hits: Array<{ ticket: number; reason: 'sl' | 'tp'; exitPrice: number }> = [];

    for (const [ticket, position] of this.positions.entries()) {
      if (position.symbol.toUpperCase() !== candle.symbol.toUpperCase()) {
        continue;
      }

      // Check SL/TP hits
      if (position.direction === 'buy') {
        // BUY: SL below, TP above
        if (position.sl && candle.low <= position.sl) {
          hits.push({
            ticket,
            reason: 'sl',
            exitPrice: position.sl, // Hit at SL price
          });
        } else if (position.tp && candle.high >= position.tp) {
          hits.push({
            ticket,
            reason: 'tp',
            exitPrice: position.tp, // Hit at TP price
          });
        }
      } else {
        // SELL: SL above, TP below
        if (position.sl && candle.high >= position.sl) {
          hits.push({
            ticket,
            reason: 'sl',
            exitPrice: position.sl,
          });
        } else if (position.tp && candle.low <= position.tp) {
          hits.push({
            ticket,
            reason: 'tp',
            exitPrice: position.tp,
          });
        }
      }
    }

    return hits;
  }

  /**
   * Get current balance
   */
  getBalance(): number {
    return this.balance;
  }

  /**
   * Get closed trades history
   */
  getClosedTrades(): Array<SimulatedPosition & { profit: number }> {
    return [...this.closedTrades];
  }

  /**
   * Reset adapter (for new backtest run)
   */
  reset(initialBalance: number): void {
    this.positions.clear();
    this.closedTrades = [];
    this.nextTicket = 1;
    this.balance = initialBalance;
    logger.info(`[SimMT5] Reset with balance: ${initialBalance}`);
  }

  /**
   * Calculate profit for a position
   */
  private calculateProfit(position: SimulatedPosition, exitPrice: number): number {
    const priceDiff = position.direction === 'buy'
      ? exitPrice - position.entryPrice
      : position.entryPrice - exitPrice;

    // Simplified: profit = price difference * volume * contract size
    // For now, assume 1 lot = 100 units of base currency
    // TODO: Use proper contract sizes per symbol (XAUUSD = 100 oz, EURUSD = 100k, etc.)
    const contractSize = this.getContractSize(position.symbol);
    const profit = priceDiff * position.volume * contractSize;

    return profit;
  }

  /**
   * Get contract size for a symbol (simplified)
   */
  private getContractSize(symbol: string): number {
    const upperSymbol = symbol.toUpperCase();
    if (upperSymbol === 'XAUUSD' || upperSymbol === 'GOLD') {
      return 100; // 1 lot = 100 oz of gold
    }
    if (upperSymbol.includes('USD') && !upperSymbol.includes('XAU')) {
      return 100000; // Forex: 1 lot = 100k units
    }
    if (upperSymbol === 'US30') {
      return 1; // Index: 1 lot = 1 contract
    }
    return 100; // Default
  }

  /**
   * Convert spread from pips to price units
   */
  private getSpreadInPriceUnits(symbol: string, price: number): number {
    if (!this.config.spreadPips) {
      return 0;
    }

    const upperSymbol = symbol.toUpperCase();
    let pipValue: number;

    if (upperSymbol === 'XAUUSD' || upperSymbol === 'GOLD') {
      pipValue = 0.1; // Gold: 1 pip = 0.1
    } else if (upperSymbol === 'US30') {
      pipValue = 1.0; // Index: 1 pip = 1 point
    } else {
      // Forex: 1 pip = 0.0001 (for most pairs)
      pipValue = 0.0001;
    }

    return this.config.spreadPips * pipValue;
  }

  /**
   * Convert slippage from pips to price units
   */
  private getSlippageInPriceUnits(symbol: string, price: number): number {
    if (!this.config.slippagePips) {
      return 0;
    }

    // Use same logic as spread
    return this.getSpreadInPriceUnits(symbol, price);
  }
}

