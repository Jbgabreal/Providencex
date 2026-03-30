import { Logger } from '@providencex/shared-utils';
import { Candle, Timeframe } from '../types';
import { CandleStore } from '../marketData/CandleStore';
import { Candle as MarketDataCandle } from '../marketData/types';
import { DerivCandleProvider } from '../marketData/DerivCandleProvider';
import { aggregateM1Candles } from './CandleAggregator';

const logger = new Logger('MarketDataService');

/**
 * MarketDataService - Provides OHLC candle data with multi-timeframe aggregation
 * Uses real H4/M15 candles from Deriv when available, falls back to M1 aggregation.
 */
export class MarketDataService {
  private candleStore?: CandleStore;
  private derivProvider?: DerivCandleProvider;

  constructor(candleStore?: CandleStore, derivProvider?: DerivCandleProvider) {
    this.candleStore = candleStore;
    this.derivProvider = derivProvider;
    if (candleStore) {
      logger.info('MarketDataService initialized with CandleStore - using real M1 candles');
    }
    if (derivProvider) {
      logger.info('MarketDataService initialized with DerivCandleProvider - using real H4/M15 candles');
    }
    if (!candleStore && !derivProvider) {
      logger.warn('MarketDataService initialized without data sources - candle data unavailable');
    }
  }

  /** Set DerivCandleProvider after construction (for late binding). */
  setDerivProvider(provider: DerivCandleProvider): void {
    this.derivProvider = provider;
  }

  /**
   * Get recent candles for a symbol and timeframe
   * Aggregates M1 candles from CandleStore into higher timeframes if needed
   */
  async getRecentCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 100
  ): Promise<Candle[]> {
    // Use real H4/M15 candles from Deriv when available (not re-aggregated from M1)
    if (this.derivProvider) {
      if (timeframe === 'H4') {
        const h4 = this.derivProvider.getH4Candles(symbol, limit);
        logger.info(`[MarketDataService] ${symbol} H4: derivProvider has ${h4.length} candles`);
        if (h4.length > 0) {
          logger.info(`[MarketDataService] ${symbol}: Using ${h4.length} real H4 candles from Deriv, first high=${h4[0].high}, last close=${h4[h4.length-1].close}`);
          return h4.map(c => ({
            timestamp: c.startTime.toISOString(),
            startTime: c.startTime,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })) as any;
        }
      }
      if (timeframe === 'M15') {
        const m15 = this.derivProvider.getM15Candles(symbol, limit);
        logger.info(`[MarketDataService] ${symbol} M15: derivProvider has ${m15.length} candles`);

        // Also check M1 aggregation — use whichever has more candles
        // DerivProvider M15 can be stale/few after market reopen
        if (this.candleStore) {
          const m1All = this.candleStore.getAllCandles(symbol);
          const aggregatedCount = Math.floor(m1All.length / 15);
          if (aggregatedCount > m15.length) {
            // M1 aggregation produces more — skip DerivProvider, fall through to aggregation
            logger.info(`[MarketDataService] ${symbol}: M1 aggregation (${aggregatedCount}) > derivProvider M15 (${m15.length}), using aggregation`);
          } else if (m15.length > 0) {
            return m15.map(c => ({
              timestamp: c.startTime.toISOString(),
              startTime: c.startTime,
              open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
            })) as any;
          }
        } else if (m15.length > 0) {
          return m15.map(c => ({
            timestamp: c.startTime.toISOString(),
            startTime: c.startTime,
            open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
          })) as any;
        }
      }
    } else {
      logger.warn(`[MarketDataService] ${symbol} ${timeframe}: No derivProvider available, using M1 aggregation`);
    }

    if (!this.candleStore) {
      logger.warn(`[MarketDataService] CandleStore not available - returning empty array for ${symbol} ${timeframe}`);
      return [];
    }

    // Fallback: Aggregate M1 candles from CandleStore
    let candlesPerBucket: number;
    let maxM1CandlesNeeded: number;

    if (timeframe === 'H4') {
      // For H4, ensure we have enough for swing detection (50 H4 candles = 12,000 M1 candles)
      // 1 H4 = 240 M1 candles, so 50 H4 = 12,000 M1 candles
      const minH4CandlesForSwings = 50;
      const m1CandlesForSwings = minH4CandlesForSwings * 240; // 12,000 M1 candles
      const requestedM1Candles = limit * 240; // Requested amount
      maxM1CandlesNeeded = Math.max(m1CandlesForSwings, requestedM1Candles) + 240; // Add buffer
      candlesPerBucket = 240;
    } else if (timeframe === 'H1') {
      candlesPerBucket = 60;
      maxM1CandlesNeeded = limit * candlesPerBucket + candlesPerBucket; // Add buffer for incomplete window
    } else if (timeframe === 'M15') {
      candlesPerBucket = 15;
      maxM1CandlesNeeded = limit * candlesPerBucket + candlesPerBucket; // Add buffer for incomplete window
    } else if (timeframe === 'M5') {
      candlesPerBucket = 5;
      maxM1CandlesNeeded = limit * candlesPerBucket + candlesPerBucket; // Add buffer for incomplete window
    } else if (timeframe === 'M3') {
      candlesPerBucket = 3;
      maxM1CandlesNeeded = limit * candlesPerBucket + candlesPerBucket; // Add buffer for incomplete window
    } else {
      // M1 or other
      candlesPerBucket = 1;
      maxM1CandlesNeeded = limit;
    }
    
    const m1Candles = this.candleStore.getCandles(symbol, maxM1CandlesNeeded);
    
    if (m1Candles.length === 0) {
      logger.debug(`[MarketDataService] No M1 candles available for ${symbol}`);
      return [];
    }
    
    // Debug: Log M1 candle count for XAUUSD to verify data availability (only for higher timeframes)
    const smcDebug = process.env.SMC_DEBUG === 'true';
    if ((smcDebug || symbol === 'XAUUSD') && timeframe !== 'M1' && m1Candles.length > 0) {
      const firstTime = m1Candles[0].startTime.toISOString();
      const lastTime = m1Candles[m1Candles.length - 1].startTime.toISOString();
      const priceRange = {
        low: Math.min(...m1Candles.map(c => c.low)),
        high: Math.max(...m1Candles.map(c => c.high)),
      };
      logger.info(`[MarketDataService] ${symbol}: Found ${m1Candles.length} M1 candles for ${timeframe} aggregation (need ~${limit * candlesPerBucket}), range: ${firstTime} to ${lastTime}, price: ${priceRange.low}-${priceRange.high}`);
    }

    // Aggregate M1 candles into target timeframe
    try {
      const aggregatedCandles = aggregateM1Candles(
        m1Candles as MarketDataCandle[],
        timeframe,
        symbol,
        limit
      );
      
      if (aggregatedCandles.length === 0 && timeframe !== 'M1') {
        const smcDebug = process.env.SMC_DEBUG === 'true';
        if (smcDebug || symbol === 'XAUUSD') {
          const candlesNeeded = limit * (timeframe === 'H4' ? 240 : timeframe === 'H1' ? 60 : timeframe === 'M15' ? 15 : timeframe === 'M5' ? 5 : 1);
          logger.warn(
            `[MarketDataService] ${symbol}: Insufficient M1 candles for ${timeframe} aggregation ` +
            `(have ${m1Candles.length} M1 candles, need at least ${candlesNeeded})`
          );
        }
      } else if ((smcDebug || symbol === 'XAUUSD') && aggregatedCandles.length > 0 && timeframe !== 'M1') {
        logger.info(`[MarketDataService] ${symbol}: Aggregated ${m1Candles.length} M1 candles into ${aggregatedCandles.length} ${timeframe} candles (requested ${limit})`);
      }
      
      return aggregatedCandles;
    } catch (error) {
      logger.error(`[MarketDataService] Failed to aggregate candles for ${symbol} on ${timeframe}:`, error);
      return [];
    }
  }

  /**
   * Get current price for a symbol
   * Uses latest candle close if available, otherwise falls back to mock
   */
  async getCurrentPrice(symbol: string): Promise<number> {
    const smcDebug = process.env.SMC_DEBUG === 'true';
    
    // Try to get price from latest candle
    if (this.candleStore) {
      const m1Candles = this.candleStore.getCandles(symbol, 1);
      if (m1Candles.length > 0) {
        const latestCandle = m1Candles[m1Candles.length - 1];
        const price = latestCandle.close;
        if (smcDebug && symbol === 'XAUUSD') {
          logger.debug(`[SMC_DEBUG] ${symbol}: Using latest M1 candle close as current price: ${price} (timestamp: ${latestCandle.startTime.toISOString()})`);
        }
        return price;
      }
    }
    
    // Fallback: return a mock price (should rarely be used in production)
    const mockPrices: Record<string, number> = {
      XAUUSD: 2650.0,
      EURUSD: 1.0850,
      GBPUSD: 1.2750,
      US30: 39500.0,
    };
    
    if (smcDebug) {
      logger.warn(`[SMC_DEBUG] ${symbol}: No candles available, using mock price: ${mockPrices[symbol] || 0}`);
    }
    
    return mockPrices[symbol] || 0;
  }

  /**
   * Get current spread for a symbol
   */
  async getCurrentSpread(symbol: string): Promise<number> {
    logger.debug(`Getting current spread for ${symbol}`);
    
    // In v1, return a mock spread (in price units)
    // TODO: Replace with real broker API call
    const mockSpreads: Record<string, number> = {
      XAUUSD: 0.5, // ~$0.50 spread for gold
      EURUSD: 0.0002, // ~2 pips
      GBPUSD: 0.0003, // ~3 pips
      US30: 5.0, // ~5 points
    };
    
    return mockSpreads[symbol] || 0;
  }

}
