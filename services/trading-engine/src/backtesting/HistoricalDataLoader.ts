/**
 * HistoricalDataLoader - Loads historical candle data for backtesting
 * 
 * Supports:
 * - CSV files (OHLCV format)
 * - Postgres historical_candles table
 * - MT5 connector /api/v1/history endpoint (live historical data)
 * - Mock data generation (for testing)
 */

import { Pool } from 'pg';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import { Logger } from '@providencex/shared-utils';
import { HistoricalCandle } from './types';

const logger = new Logger('DataLoader');

export interface DataLoaderConfig {
  dataSource: 'csv' | 'postgres' | 'mt5' | 'mock';
  csvPath?: string;
  databaseUrl?: string;
  mt5BaseUrl?: string; // MT5 Connector base URL (e.g., http://localhost:3030)
  symbol?: string;
}

/**
 * HistoricalDataLoader - Loads and normalizes historical candle data
 */
export class HistoricalDataLoader {
  private config: DataLoaderConfig;
  private pool: Pool | null = null;

  constructor(config: DataLoaderConfig) {
    this.config = config;
    
    if (config.dataSource === 'postgres' && config.databaseUrl) {
      try {
        this.pool = new Pool({
          connectionString: config.databaseUrl,
          ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        });
        
        // Handle pool errors gracefully (prevent app crash)
        this.pool.on('error', (err) => {
          logger.error('[DataLoader] Database pool error (non-fatal):', err);
          // Don't crash the app - just log the error
        });
        
        logger.info('[DataLoader] Connected to Postgres for historical data');
      } catch (error) {
        logger.error('[DataLoader] Failed to connect to Postgres', error);
      }
    }
    
    if (config.dataSource === 'mt5') {
      const mt5Url = config.mt5BaseUrl || process.env.MT5_CONNECTOR_URL || 'http://localhost:3030';
      logger.info(`[DataLoader] MT5 data source configured: ${mt5Url}`);
    }
  }

  /**
   * Load historical candles for a date range
   */
  async loadCandles(
    symbol: string,
    startDate: Date,
    endDate: Date,
    timeframe: string = 'M5'
  ): Promise<HistoricalCandle[]> {
    logger.info(
      `[DataLoader] Loading candles for ${symbol} from ${startDate.toISOString()} to ${endDate.toISOString()} (${timeframe})`
    );

    switch (this.config.dataSource) {
      case 'csv':
        return await this.loadFromCsv(symbol, startDate, endDate);
      
      case 'postgres':
        return await this.loadFromPostgres(symbol, startDate, endDate, timeframe);
      
      case 'mt5':
        return await this.loadFromMT5(symbol, startDate, endDate, timeframe);
      
      case 'mock':
        return await this.generateMockData(symbol, startDate, endDate, timeframe);
      
      default:
        throw new Error(`Unsupported data source: ${this.config.dataSource}`);
    }
  }

  /**
   * Load candles from CSV file
   * Expected format: timestamp,open,high,low,close,volume (CSV header optional)
   */
  private async loadFromCsv(
    symbol: string,
    startDate: Date,
    endDate: Date
  ): Promise<HistoricalCandle[]> {
    if (!this.config.csvPath) {
      throw new Error('CSV path not provided for CSV data source');
    }

    try {
      const csvContent = await fs.readFile(this.config.csvPath, 'utf-8');
      const lines = csvContent.split('\n').filter(line => line.trim());
      
      const candles: HistoricalCandle[] = [];
      const startTime = startDate.getTime();
      const endTime = endDate.getTime();

      // Skip header if present
      let startIndex = 0;
      if (lines[0] && lines[0].toLowerCase().includes('timestamp')) {
        startIndex = 1;
      }

      for (let i = startIndex; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const parts = line.split(',').map(p => p.trim());
        if (parts.length < 6) continue;

        // Parse timestamp (support multiple formats)
        let timestamp: number;
        if (/^\d+$/.test(parts[0])) {
          // Epoch millis or seconds
          timestamp = parseInt(parts[0], 10);
          if (timestamp < 10000000000) {
            // Assume seconds if less than 10 digits
            timestamp = timestamp * 1000;
          }
        } else {
          // ISO string or other date format
          timestamp = new Date(parts[0]).getTime();
        }

        // Filter by date range
        if (timestamp < startTime || timestamp > endTime) {
          continue;
        }

        const candle: HistoricalCandle = {
          symbol,
          timestamp,
          open: parseFloat(parts[1]),
          high: parseFloat(parts[2]),
          low: parseFloat(parts[3]),
          close: parseFloat(parts[4]),
          volume: parseFloat(parts[5]) || 0,
        };

        // Validate candle data
        if (
          isNaN(candle.open) || isNaN(candle.high) || isNaN(candle.low) || isNaN(candle.close) ||
          candle.high < candle.low ||
          candle.open < candle.low || candle.open > candle.high ||
          candle.close < candle.low || candle.close > candle.high
        ) {
          logger.warn(`[DataLoader] Skipping invalid candle at ${new Date(timestamp).toISOString()}`);
          continue;
        }

        candles.push(candle);
      }

      // Sort by timestamp
      candles.sort((a, b) => a.timestamp - b.timestamp);

      logger.info(`[DataLoader] Loaded ${candles.length} candles from CSV`);
      return candles;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[DataLoader] Error loading CSV: ${errorMsg}`, error);
      throw new Error(`Failed to load CSV: ${errorMsg}`);
    }
  }

  /**
   * Load candles from Postgres historical_candles table
   */
  private async loadFromPostgres(
    symbol: string,
    startDate: Date,
    endDate: Date,
    timeframe: string
  ): Promise<HistoricalCandle[]> {
    if (!this.pool) {
      throw new Error('Postgres connection not available');
    }

    try {
      // Map timeframe to expected format (M5 -> M5, H1 -> H1, etc.)
      const tf = timeframe.toUpperCase();

      const result = await this.pool.query(
        `SELECT timestamp, open, high, low, close, volume
         FROM historical_candles
         WHERE symbol = $1
           AND timeframe = $2
           AND timestamp >= $3
           AND timestamp <= $4
         ORDER BY timestamp ASC`,
        [symbol, tf, startDate.toISOString(), endDate.toISOString()]
      );

      const candles: HistoricalCandle[] = result.rows.map((row) => ({
        symbol,
        timestamp: new Date(row.timestamp).getTime(),
        open: parseFloat(row.open),
        high: parseFloat(row.high),
        low: parseFloat(row.low),
        close: parseFloat(row.close),
        volume: parseFloat(row.volume) || 0,
      }));

      logger.info(`[DataLoader] Loaded ${candles.length} candles from Postgres`);
      return candles;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[DataLoader] Error loading from Postgres: ${errorMsg}`, error);
      
      // If table doesn't exist, log warning and return empty array
      if (errorMsg.includes('does not exist') || errorMsg.includes('relation')) {
        logger.warn('[DataLoader] historical_candles table not found - using mock data fallback');
        return this.generateMockData(symbol, startDate, endDate, timeframe);
      }
      
      throw new Error(`Failed to load from Postgres: ${errorMsg}`);
    }
  }

  /**
   * Load candles from MT5 Connector /api/v1/history endpoint
   * Fetches live historical data directly from MT5 terminal
   */
  private async loadFromMT5(
    symbol: string,
    startDate: Date,
    endDate: Date,
    timeframe: string
  ): Promise<HistoricalCandle[]> {
    const mt5BaseUrl = this.config.mt5BaseUrl || process.env.MT5_CONNECTOR_URL || 'http://localhost:3030';
    
    if (!mt5BaseUrl) {
      throw new Error('MT5 base URL not configured. Set MT5_CONNECTOR_URL env var or pass mt5BaseUrl in config');
    }

    try {
      // Format dates as ISO strings (YYYY-MM-DD format for MT5)
      const startDateStr = startDate.toISOString().split('T')[0]; // YYYY-MM-DD
      const endDateStr = endDate.toISOString().split('T')[0]; // YYYY-MM-DD
      
      logger.info(
        `[DataLoader] Fetching MT5 history for ${symbol}: ${timeframe}, date range: ${startDateStr} to ${endDateStr}`
      );

      // Call MT5 connector history endpoint with startDate and endDate
      const url = `${mt5BaseUrl}/api/v1/history`;
      const response = await axios.get<Array<{
        time: string;  // ISO 8601 string
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }>>(url, {
        params: {
          symbol,
          timeframe: timeframe.toUpperCase(),
          startDate: startDateStr,
          endDate: endDateStr,
        },
        timeout: 60000, // 60 second timeout for large requests
      });

      if (!response.data || !Array.isArray(response.data)) {
        logger.warn(`[DataLoader] MT5 connector returned invalid response for ${symbol}`);
        return [];
      }

      const rawCandles = response.data;
      
      // Check if MT5 returned empty data
      if (!rawCandles || rawCandles.length === 0) {
        const now = new Date();
        const isFutureDate = startDate > now;
        const isPastDate = endDate < now;
        
        let errorMsg = `MT5 connector returned no historical data for ${symbol} (timeframe: ${timeframe})`;
        errorMsg += `\n  Requested date range: ${startDate.toISOString()} to ${endDate.toISOString()}`;
        
        if (isFutureDate) {
          errorMsg += `\n  ⚠️  Start date is in the future (current time: ${now.toISOString()})`;
        } else if (!isPastDate) {
          errorMsg += `\n  ⚠️  End date extends into the future (current time: ${now.toISOString()})`;
        }
        
        // Try to query MT5 for available date range to provide helpful diagnostics
        // Use 'days' parameter instead of date range to avoid MT5 connector bugs with large ranges
        let availableRangeInfo = '';
        try {
          const mt5BaseUrl = this.config.mt5BaseUrl || process.env.MT5_CONNECTOR_URL || 'http://localhost:3030';
          
          // Query with 'days' parameter to get what MT5 actually has available
          // Try a large number of days (365) to see the full range
          const diagnosticResponse = await axios.get<Array<{ time: string }>>(
            `${mt5BaseUrl}/api/v1/history`,
            {
              params: {
                symbol,
                timeframe: timeframe.toUpperCase(),
                days: 365, // Query last year to see what's available
              },
              timeout: 15000,
            }
          );
          
          if (diagnosticResponse.data && diagnosticResponse.data.length > 0) {
            // Sort by time to get earliest and latest
            const sortedCandles = [...diagnosticResponse.data].sort((a, b) => 
              new Date(a.time).getTime() - new Date(b.time).getTime()
            );
            const firstCandle = new Date(sortedCandles[0].time);
            const lastCandle = new Date(sortedCandles[sortedCandles.length - 1].time);
            availableRangeInfo = `\n  📅 MT5 available date range: ${firstCandle.toISOString().split('T')[0]} to ${lastCandle.toISOString().split('T')[0]}`;
            availableRangeInfo += `\n     (${diagnosticResponse.data.length} total candles available)`;
            
            // Check if requested dates are outside available range
            if (startDate < firstCandle) {
              errorMsg += `\n  ⚠️  Start date (${startDate.toISOString().split('T')[0]}) is before MT5's earliest data (${firstCandle.toISOString().split('T')[0]})`;
            }
            if (endDate > lastCandle) {
              errorMsg += `\n  ⚠️  End date (${endDate.toISOString().split('T')[0]}) is after MT5's latest data (${lastCandle.toISOString().split('T')[0]})`;
            }
            if (startDate >= firstCandle && endDate <= lastCandle) {
              errorMsg += `\n  ℹ️  Requested range is within MT5's available range, but no data returned`;
              errorMsg += `\n     This may indicate: MT5 terminal needs history download, or symbol was unavailable during this period`;
            }
          } else {
            availableRangeInfo = `\n  ⚠️  MT5 connector returned no data even for recent dates - check MT5 terminal connection`;
          }
        } catch (diagError) {
          // Silently fail diagnostic query - don't break the main error message
          logger.debug(`[DataLoader] Could not query MT5 for available date range: ${diagError}`);
        }
        
        errorMsg += availableRangeInfo;
        errorMsg += `\n  Possible reasons:`;
        errorMsg += `\n    1. MT5 terminal doesn't have historical data for this date range`;
        errorMsg += `\n    2. Symbol ${symbol} was not available during this period`;
        errorMsg += `\n    3. MT5 history synchronization is incomplete`;
        errorMsg += `\n    4. Date range is outside MT5's available history`;
        errorMsg += `\n  Suggestions:`;
        errorMsg += `\n    - Use a date range within MT5's available history (see above)`;
        errorMsg += `\n    - Try a more recent date range (e.g., last 30-90 days from today)`;
        errorMsg += `\n    - Check if MT5 terminal has history enabled for ${symbol}`;
        errorMsg += `\n    - Verify the symbol name matches MT5's symbol format`;
        errorMsg += `\n    - Use 'postgres' data source if you have historical data stored`;
        
        logger.error(`[DataLoader] ${errorMsg}`);
        throw new Error(errorMsg);
      }
      
      // Log date range of returned candles for debugging
      if (rawCandles.length > 0) {
        const firstTime = new Date(rawCandles[0].time);
        const lastTime = new Date(rawCandles[rawCandles.length - 1].time);
        logger.info(
          `[DataLoader] MT5 returned ${rawCandles.length} candles, actual date range: ${firstTime.toISOString()} to ${lastTime.toISOString()}`
        );
        logger.info(
          `[DataLoader] Requested date range: ${startDate.toISOString()} to ${endDate.toISOString()}`
        );
      }
      
      // Convert MT5 response to HistoricalCandle format
      const candles: HistoricalCandle[] = [];
      
      // For MT5 data source, accept ALL valid candles that MT5 returns
      // MT5 already filters by "last N days" from broker time, so we trust its filtering
      // The broker time might not exactly match our requested dates, but MT5 returns what's available
      const startTime = startDate.getTime();
      const endTime = endDate.getTime();
      
      let invalidCount = 0;
      let inRequestedRange = 0;
      let outsideRequestedRange = 0;

      for (const raw of rawCandles) {
        // Parse ISO 8601 time string to timestamp
        const timestamp = new Date(raw.time).getTime();
        
        // Track if it's in the requested range (for logging only - we accept all valid candles)
        if (timestamp >= startTime && timestamp <= endTime) {
          inRequestedRange++;
        } else {
          outsideRequestedRange++;
        }

        // Validate candle data
        if (
          isNaN(raw.open) || isNaN(raw.high) || isNaN(raw.low) || isNaN(raw.close) ||
          raw.high < raw.low ||
          raw.open < raw.low || raw.open > raw.high ||
          raw.close < raw.low || raw.close > raw.high
        ) {
          invalidCount++;
          logger.warn(`[DataLoader] Skipping invalid MT5 candle at ${raw.time}`);
          continue;
        }

        candles.push({
          symbol,
          timestamp,
          open: raw.open,
          high: raw.high,
          low: raw.low,
          close: raw.close,
          volume: raw.volume || 0,
        });
      }

      // Sort by timestamp (ascending - oldest first)
      candles.sort((a, b) => a.timestamp - b.timestamp);

      logger.info(
        `[DataLoader] Loaded ${candles.length} valid candles from MT5 (from ${rawCandles.length} total: ${invalidCount} invalid)`
      );
      
      if (inRequestedRange > 0) {
        logger.info(
          `[DataLoader] ${inRequestedRange} candles in requested range (${startDate.toISOString()} to ${endDate.toISOString()}), ${outsideRequestedRange} outside (but included)`
        );
      } else if (candles.length > 0) {
        logger.warn(
          `[DataLoader] No candles in exact requested range (${startDate.toISOString()} to ${endDate.toISOString()}), but using ${candles.length} candles from MT5's available range`
        );
      }
      
      if (candles.length === 0) {
        logger.warn(
          `[DataLoader] No valid candles returned from MT5 for ${symbol} (${rawCandles.length} raw candles, ${invalidCount} invalid)`
        );
      } else {
        logger.info(
          `[DataLoader] Using ${candles.length} MT5 candles from ${new Date(candles[0].timestamp).toISOString()} to ${new Date(candles[candles.length - 1].timestamp).toISOString()}`
        );
      }

      return candles;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // Handle axios errors specifically
      if (axios.isAxiosError(error)) {
        const axiosError = error;
        const status = axiosError.response?.status;
        const statusText = axiosError.response?.statusText;
        const errorDetail = axiosError.response?.data as any;
        const detail = errorDetail?.detail || errorDetail?.error || axiosError.message;
        
        logger.error(
          `[DataLoader] MT5 connector error for ${symbol}: ${status || 'network'} - ${detail}`
        );
        
        if (status === 502 || status === 503) {
          throw new Error(`MT5 connector unavailable: ${detail}`);
        } else if (status === 404) {
          throw new Error(`Symbol ${symbol} not found in MT5: ${detail}`);
        } else {
          throw new Error(`MT5 connector error: ${detail}`);
        }
      }
      
      logger.error(`[DataLoader] Error loading from MT5: ${errorMsg}`, error);
      throw new Error(`Failed to load from MT5: ${errorMsg}`);
    }
  }

  /**
   * Generate mock historical data for testing.
   * Uses a multi-scale trend model that creates realistic ICT market structure:
   * - Long-term H4 trends with periodic reversals (CHoCH opportunities)
   * - Medium-term M15 swing highs/lows within H4 trends
   * - Realistic OHLC wick/body sizes
   */
  private async generateMockData(
    symbol: string,
    startDate: Date,
    endDate: Date,
    timeframe: string
  ): Promise<HistoricalCandle[]> {
    logger.info(`[DataLoader] Generating mock data for ${symbol}`);

    const candles: HistoricalCandle[] = [];

    // Candle interval
    const intervalMs = (() => {
      switch (timeframe.toUpperCase()) {
        case 'M1':  return 60_000;
        case 'M5':  return 300_000;
        case 'M15': return 900_000;
        case 'H1':  return 3_600_000;
        default:    return 60_000;
      }
    })();

    // Symbol parameters: [basePrice, m1Volatility, m1WickFactor]
    const params: Record<string, [number, number, number]> = {
      XAUUSD: [2050.0, 0.20, 0.30],   // $0.20 per M1 candle body, $0.30 wick
      GOLD:   [2050.0, 0.20, 0.30],
      EURUSD: [1.0850, 0.00008, 0.00012],
      GBPUSD: [1.2650, 0.00010, 0.00015],
      US30:   [35000.0, 10.0, 15.0],
    };
    const [basePrice, m1Vol, m1Wick] = params[symbol.toUpperCase()] ?? [100.0, 0.05, 0.08];

    // Scale volatility for the requested timeframe (sqrt-of-time)
    const m1PerInterval = intervalMs / 60_000;
    const vol = m1Vol * Math.sqrt(m1PerInterval);
    const wick = m1Wick * Math.sqrt(m1PerInterval);

    // --- Multi-scale trend state ---
    // htfBias changes every ~200 H4 candles (~33 days) → long-term trend
    // mtfBias changes every ~30 M15 candles (~7.5 hours) → intraday swing
    const H4_MS = 14_400_000;
    const M15_MS = 900_000;

    let htfBias = 1.0;        // +1 bullish, -1 bearish
    let htfTimer = 0;
    const htfPeriodMs = H4_MS * 200; // ~33 days

    let mtfBias = 1.0;
    let mtfTimer = 0;
    const mtfPeriodMs = M15_MS * 30; // ~7.5 hours

    // Small drift per candle contributed by each layer
    const htfDriftPerMs = (basePrice * 0.0002) / htfPeriodMs;  // ~0.02% per HTF cycle
    const mtfDriftPerMs = (basePrice * 0.0003) / mtfPeriodMs;  // ~0.03% per MTF cycle

    let currentPrice = basePrice;
    let currentTimestamp = startDate.getTime();

    while (currentTimestamp <= endDate.getTime()) {
      // Advance timers and flip trend phases at boundaries
      htfTimer += intervalMs;
      mtfTimer += intervalMs;

      if (htfTimer >= htfPeriodMs) {
        htfBias = -htfBias;
        htfTimer = 0;
      }

      // MTF reversal is probabilistic near the end of the period to create natural-looking swings
      if (mtfTimer >= mtfPeriodMs * 0.7 && Math.random() < intervalMs / (mtfPeriodMs * 0.3)) {
        mtfBias = -mtfBias;
        mtfTimer = 0;
      }

      // Composite drift: HTF adds slow persistent bias, MTF adds swing-level oscillation
      const drift = htfBias * htfDriftPerMs * intervalMs
                  + mtfBias * mtfDriftPerMs * intervalMs;

      // M1-scale noise (gaussian approximation via CLT)
      const noise = (Math.random() + Math.random() + Math.random() - 1.5) * vol * (2 / Math.sqrt(3));

      const open = currentPrice;
      const closeRaw = open + drift + noise;
      const close = Math.max(closeRaw, open * 0.90); // guard against absurd values

      // Wicks: realistic upper/lower shadows
      const bodyHigh = Math.max(open, close);
      const bodyLow  = Math.min(open, close);
      const upperWick = Math.random() * wick;
      const lowerWick = Math.random() * wick;

      candles.push({
        symbol,
        timestamp: currentTimestamp,
        open,
        high:   bodyHigh + upperWick,
        low:    bodyLow  - lowerWick,
        close,
        volume: Math.floor(Math.random() * 100) + 10,
      });

      currentPrice = close;
      currentTimestamp += intervalMs;
    }

    logger.info(`[DataLoader] Generated ${candles.length} mock candles`);
    return candles;
  }

  /**
   * Cleanup: Close database connection if used
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('[DataLoader] Postgres connection closed');
    }
  }
}


