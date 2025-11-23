/**
 * CandleBuilder - Aggregates ticks into 1-minute OHLC candles
 * Maintains current candle per symbol and finalizes on minute boundary
 */
import { Tick, Candle } from './types';
import { CandleStore } from './CandleStore';
import { Logger } from '@providencex/shared-utils';

const logger = new Logger('CandleBuilder');

export class CandleBuilder {
  private currentCandles: Map<string, Candle | null> = new Map();

  constructor(private candleStore: CandleStore) {
    logger.info('CandleBuilder initialized');
  }

  /**
   * Process a tick and update the current candle
   * Closes and finalizes candle when minute boundary is crossed
   */
  processTick(tick: Tick): void {
    const symbol = tick.symbol;
    const tickTime = tick.time;
    
    // Get minute boundary (floor to minute)
    const minuteStart = new Date(tickTime);
    minuteStart.setSeconds(0, 0);
    const minuteEnd = new Date(minuteStart);
    minuteEnd.setMinutes(minuteEnd.getMinutes() + 1);

    const currentCandle = this.currentCandles.get(symbol);

    if (!currentCandle) {
      // First tick for this symbol - initialize new candle
      this.currentCandles.set(symbol, {
        symbol,
        timeframe: 'M1',
        open: tick.mid,
        high: tick.mid,
        low: tick.mid,
        close: tick.mid,
        volume: 1,
        startTime: minuteStart,
        endTime: minuteEnd,
      });
      logger.debug(`Initialized new candle for ${symbol} at ${minuteStart.toISOString()}`);
      return;
    }

    // Check if we've crossed a minute boundary
    if (tickTime >= currentCandle.endTime) {
      // Finalize previous candle
      this.candleStore.addCandle(currentCandle);
      logger.info(
        `Closed candle for ${symbol}: O=${currentCandle.open.toFixed(5)} ` +
        `H=${currentCandle.high.toFixed(5)} L=${currentCandle.low.toFixed(5)} ` +
        `C=${currentCandle.close.toFixed(5)} V=${currentCandle.volume} ` +
        `(${currentCandle.startTime.toISOString()})`
      );

      // Start new candle
      const newCandle: Candle = {
        symbol,
        timeframe: 'M1',
        open: tick.mid,
        high: tick.mid,
        low: tick.mid,
        close: tick.mid,
        volume: 1,
        startTime: minuteStart,
        endTime: minuteEnd,
      };
      this.currentCandles.set(symbol, newCandle);
      logger.debug(`Started new candle for ${symbol} at ${minuteStart.toISOString()}`);
    } else {
      // Same minute - update current candle
      currentCandle.high = Math.max(currentCandle.high, tick.mid);
      currentCandle.low = Math.min(currentCandle.low, tick.mid);
      currentCandle.close = tick.mid;
      currentCandle.volume += 1;
      
      logger.debug(
        `Updated candle for ${symbol}: H=${currentCandle.high.toFixed(5)} ` +
        `L=${currentCandle.low.toFixed(5)} C=${currentCandle.close.toFixed(5)} V=${currentCandle.volume}`
      );
    }
  }

  /**
   * Get the current (open) candle for a symbol
   */
  getCurrentCandle(symbol: string): Candle | undefined {
    return this.currentCandles.get(symbol) || undefined;
  }

  /**
   * Clear current candle for a symbol (useful for cleanup)
   */
  clearCurrentCandle(symbol: string): void {
    const currentCandle = this.currentCandles.get(symbol);
    if (currentCandle) {
      // Finalize before clearing
      this.candleStore.addCandle(currentCandle);
      logger.info(`Finalized and cleared current candle for ${symbol}`);
    }
    this.currentCandles.delete(symbol);
  }

  /**
   * Get all symbols with open candles
   */
  getSymbolsWithOpenCandles(): string[] {
    return Array.from(this.currentCandles.keys());
  }
}

