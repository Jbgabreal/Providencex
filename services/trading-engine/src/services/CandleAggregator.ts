/**
 * CandleAggregator - Aggregates M1 candles into higher timeframes (M5, M15, H1, H4)
 * Converts from marketData/types.ts Candle format to types/index.ts Candle format
 */
import { Logger } from '@providencex/shared-utils';
import { Candle as MarketDataCandle } from '../marketData/types';
import { Candle, Timeframe } from '../types';

const logger = new Logger('CandleAggregator');

/**
 * Get the number of M1 candles needed for a given timeframe
 */
function getM1CandlesPerTimeframe(timeframe: Timeframe): number {
  const map: Record<Timeframe, number> = {
    M1: 1,
    M5: 5,
    M15: 15,
    H1: 60,
    H4: 240,
  };
  return map[timeframe] || 1;
}

/**
 * Group M1 candles by timeframe buckets based on actual time boundaries
 * Returns grouped candles where each group represents one candle in the target timeframe
 * 
 * For M5: Groups candles into 5-minute windows (e.g., 10:00-10:05, 10:05-10:10)
 * For M15: Groups candles into 15-minute windows (e.g., 10:00-10:15, 10:15-10:30)
 * For H1: Groups candles into 1-hour windows (e.g., 10:00-11:00, 11:00-12:00)
 * For H4: Groups candles into 4-hour windows (e.g., 00:00-04:00, 04:00-08:00, 08:00-12:00)
 */
function groupCandlesByTimeframe(
  m1Candles: MarketDataCandle[],
  targetTimeframe: Timeframe
): MarketDataCandle[][] {
  if (targetTimeframe === 'M1') {
    return m1Candles.map(c => [c]);
  }

  if (m1Candles.length === 0) {
    return [];
  }

  const groups: MarketDataCandle[][] = [];
  let currentGroup: MarketDataCandle[] = [];
  let currentWindowStart: Date | null = null;

  const candlesPerBucket = getM1CandlesPerTimeframe(targetTimeframe);

  // Helper to get the window start time for a given candle
  const getWindowStart = (candle: MarketDataCandle, tf: Timeframe): Date => {
    const time = candle.startTime;
    const windowStart = new Date(time);
    
    if (tf === 'M5') {
      // Round down to nearest 5-minute boundary
      windowStart.setMinutes(Math.floor(time.getMinutes() / 5) * 5, 0, 0);
    } else if (tf === 'M15') {
      // Round down to nearest 15-minute boundary
      windowStart.setMinutes(Math.floor(time.getMinutes() / 15) * 15, 0, 0);
    } else if (tf === 'H1') {
      // Round down to nearest hour boundary
      windowStart.setMinutes(0, 0, 0);
    } else if (tf === 'H4') {
      // Round down to nearest 4-hour boundary (00:00, 04:00, 08:00, 12:00, 16:00, 20:00)
      windowStart.setMinutes(0, 0, 0);
      windowStart.setHours(Math.floor(time.getHours() / 4) * 4, 0, 0, 0);
    } else {
      // Default: same minute
      windowStart.setSeconds(0, 0);
    }
    
    return windowStart;
  };

  // Group candles by time window
  for (const candle of m1Candles) {
    const windowStart = getWindowStart(candle, targetTimeframe);
    
    if (currentWindowStart === null) {
      // First candle - start new group
      currentWindowStart = windowStart;
      currentGroup = [candle];
    } else if (windowStart.getTime() === currentWindowStart.getTime()) {
      // Same window - add to current group
      currentGroup.push(candle);
    } else {
      // New window - finalize current group and start new one
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
      }
      currentWindowStart = windowStart;
      currentGroup = [candle];
    }
  }

  // Add the last group
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

/**
 * Aggregate a group of M1 candles into a single candle for the target timeframe
 */
function aggregateCandles(
  m1Candles: MarketDataCandle[],
  targetTimeframe: Timeframe,
  symbol: string
): Candle {
  if (m1Candles.length === 0) {
    throw new Error('Cannot aggregate empty candle group');
  }

  // Sort candles by time to ensure correct order
  const sorted = [...m1Candles].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  // Aggregate OHLCV
  const open = first.open;
  const close = last.close;
  const high = Math.max(...sorted.map(c => c.high));
  const low = Math.min(...sorted.map(c => c.low));
  const volume = sorted.reduce((sum, c) => sum + c.volume, 0);

  // Use the start time of the first candle as the timestamp
  const timestamp = first.startTime.toISOString();

  return {
    timestamp,
    open,
    high,
    low,
    close,
    volume,
  };
}

/**
 * Aggregate M1 candles from CandleStore into the target timeframe
 * 
 * @param m1Candles - Array of M1 candles from CandleStore (marketData/types.ts format)
 * @param targetTimeframe - Target timeframe (M5, M15, H1)
 * @param symbol - Symbol name (for logging)
 * @param limit - Maximum number of candles to return
 * @returns Array of aggregated candles (types/index.ts format)
 */
export function aggregateM1Candles(
  m1Candles: MarketDataCandle[],
  targetTimeframe: Timeframe,
  symbol: string,
  limit: number
): Candle[] {
  if (m1Candles.length === 0) {
    return [];
  }

  // For M1, just convert format and return
  if (targetTimeframe === 'M1') {
    return m1Candles
      .slice(-limit)
      .map(c => ({
        timestamp: c.startTime.toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      }));
  }

  // Calculate how many M1 candles we need (with buffer for incomplete windows)
  const candlesPerBucket = getM1CandlesPerTimeframe(targetTimeframe);
  const neededM1Count = limit * candlesPerBucket + candlesPerBucket; // Add buffer for incomplete window
  const availableM1Count = m1Candles.length;

  // Take enough candles for aggregation (most recent candles)
  // Sort by time (oldest first) for proper aggregation by time windows
  const allCandles = [...m1Candles].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime()
  );
  
  // Take the most recent candles we need (from the end of sorted array)
  const startIndex = Math.max(0, allCandles.length - Math.min(neededM1Count, availableM1Count));
  const recentM1Candles = allCandles.slice(startIndex);

  // Group candles by timeframe buckets
  const groups = groupCandlesByTimeframe(recentM1Candles, targetTimeframe);

  // Aggregate each group into a single candle
  const aggregatedCandles: Candle[] = [];

  for (const group of groups) {
    if (group.length > 0) {
      try {
        const aggregated = aggregateCandles(group, targetTimeframe, symbol);
        aggregatedCandles.push(aggregated);
      } catch (error) {
        logger.warn(`Failed to aggregate candles for ${symbol} on ${targetTimeframe}: ${error}`);
        // Continue with other groups
      }
    }
  }

  // Return only the last 'limit' candles (most recent)
  const result = aggregatedCandles.slice(-limit);

  // Log aggregation for debugging (only for XAUUSD to avoid spam, only when aggregation actually happens)
  // Note: We already returned early for M1, so targetTimeframe here is always M5, M15, H1, or H4
  if (symbol === 'XAUUSD' && result.length > 0) {
    logger.debug(
      `[CandleAggregator] Aggregated ${recentM1Candles.length} M1 candles into ${result.length} ${targetTimeframe} candles for ${symbol}`
    );
  }

  return result;
}

