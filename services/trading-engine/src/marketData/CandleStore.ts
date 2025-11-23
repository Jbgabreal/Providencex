/**
 * CandleStore - In-memory storage for candles per symbol
 * Maintains a rolling window of candles (e.g., last 1000 per symbol)
 */
import { Candle } from './types';
import { Logger } from '@providencex/shared-utils';

const logger = new Logger('CandleStore');

export class CandleStore {
  private candles: Map<string, Candle[]> = new Map();
  private maxCandlesPerSymbol: number;

  constructor(maxCandlesPerSymbol: number = 1000) {
    this.maxCandlesPerSymbol = maxCandlesPerSymbol;
    logger.info(`CandleStore initialized with max ${maxCandlesPerSymbol} candles per symbol`);
  }

  /**
   * Add a candle to the store
   * Maintains rolling window by removing oldest candle if limit exceeded
   */
  addCandle(candle: Candle): void {
    const symbol = candle.symbol;
    let candleArray = this.candles.get(symbol);

    if (!candleArray) {
      candleArray = [];
      this.candles.set(symbol, candleArray);
    }

    // Add new candle
    candleArray.push(candle);

    // Maintain rolling window
    if (candleArray.length > this.maxCandlesPerSymbol) {
      const removed = candleArray.shift();
      logger.debug(
        `Rolling window: removed oldest candle for ${symbol} (startTime: ${removed?.startTime.toISOString()})`
      );
    }

    logger.debug(
      `Added candle for ${symbol}: O=${candle.open} H=${candle.high} L=${candle.low} C=${candle.close} ` +
      `(${candleArray.length} candles stored)`
    );
  }

  /**
   * Get the latest candle for a symbol
   */
  getLatestCandle(symbol: string): Candle | undefined {
    const candleArray = this.candles.get(symbol);
    if (!candleArray || candleArray.length === 0) {
      return undefined;
    }
    return candleArray[candleArray.length - 1];
  }

  /**
   * Get the last N candles for a symbol
   * Returns most recent candles first (newest last)
   */
  getCandles(symbol: string, limit: number): Candle[] {
    const candleArray = this.candles.get(symbol);
    if (!candleArray || candleArray.length === 0) {
      return [];
    }

    // Return last N candles (they're already sorted by time, newest last)
    const startIndex = Math.max(0, candleArray.length - limit);
    return candleArray.slice(startIndex);
  }

  /**
   * Get all candles for a symbol
   */
  getAllCandles(symbol: string): Candle[] {
    return this.candles.get(symbol) || [];
  }

  /**
   * Clear candles for a symbol, or all symbols if no symbol specified
   */
  clear(symbol?: string): void {
    if (symbol) {
      this.candles.delete(symbol);
      logger.info(`Cleared candles for symbol: ${symbol}`);
    } else {
      this.candles.clear();
      logger.info('Cleared all candles');
    }
  }

  /**
   * Get count of stored candles for a symbol
   */
  getCandleCount(symbol: string): number {
    return this.candles.get(symbol)?.length || 0;
  }

  /**
   * Get all tracked symbols
   */
  getTrackedSymbols(): string[] {
    return Array.from(this.candles.keys());
  }
}

