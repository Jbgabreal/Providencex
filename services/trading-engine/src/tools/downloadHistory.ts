#!/usr/bin/env tsx
/**
 * Download Historical Data from MT5 and Store in Postgres
 * 
 * This script downloads historical candles from MT5 (XM Global) and stores them
 * in the Postgres historical_candles table for backtesting.
 * 
 * Usage:
 *   pnpm download-history --symbol XAUUSD --from 2024-01-01 --to 2024-12-31 --timeframe M1
 *   pnpm download-history --symbol XAUUSD --days 90 --timeframe M1
 */

import { Pool } from 'pg';
import axios from 'axios';
import { Logger } from '@providencex/shared-utils';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

const logger = new Logger('DownloadHistory');

// Load environment variables
const envPath = path.join(process.cwd(), '../../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

interface MT5Candle {
  time: string;  // ISO 8601 string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface DownloadConfig {
  symbol: string;
  timeframe: string;
  startDate?: Date;
  endDate?: Date;
  days?: number;
  mt5BaseUrl: string;
  databaseUrl: string;
}

class HistoryDownloader {
  private pool: Pool;
  private config: DownloadConfig;

  constructor(config: DownloadConfig) {
    this.config = config;
    
    // Initialize Postgres connection
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
    });

    this.pool.on('error', (err) => {
      logger.error('[DownloadHistory] Database pool error:', err);
    });
  }

  /**
   * Ensure historical_candles table exists
   */
  async ensureSchema(): Promise<void> {
    // Try multiple possible paths for the schema file
    const possiblePaths = [
      path.join(__dirname, '../db/migrations/v15_historical_candles.sql'),
      path.join(process.cwd(), 'src/db/migrations/v15_historical_candles.sql'),
      path.join(process.cwd(), 'services/trading-engine/src/db/migrations/v15_historical_candles.sql'),
    ];
    
    let schema: string | null = null;
    for (const schemaPath of possiblePaths) {
      if (fs.existsSync(schemaPath)) {
        schema = fs.readFileSync(schemaPath, 'utf-8');
        break;
      }
    }
    
    // If file not found, use inline schema
    if (!schema) {
      schema = `
        CREATE TABLE IF NOT EXISTS historical_candles (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(20) NOT NULL,
          timeframe VARCHAR(10) NOT NULL,
          timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
          open NUMERIC(20, 8) NOT NULL,
          high NUMERIC(20, 8) NOT NULL,
          low NUMERIC(20, 8) NOT NULL,
          close NUMERIC(20, 8) NOT NULL,
          volume BIGINT NOT NULL DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(symbol, timeframe, timestamp)
        );

        CREATE INDEX IF NOT EXISTS idx_historical_candles_symbol_timeframe_timestamp 
          ON historical_candles(symbol, timeframe, timestamp);

        CREATE INDEX IF NOT EXISTS idx_historical_candles_timestamp 
          ON historical_candles(timestamp);

        CREATE INDEX IF NOT EXISTS idx_historical_candles_symbol_timeframe 
          ON historical_candles(symbol, timeframe);
      `;
    }
    
    try {
      await this.pool.query(schema);
      logger.info('[DownloadHistory] Database schema ensured');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[DownloadHistory] Failed to create schema: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * Download candles from MT5
   */
  async downloadFromMT5(): Promise<MT5Candle[]> {
    const { symbol, timeframe, startDate, endDate, days, mt5BaseUrl } = this.config;
    
    logger.info(
      `[DownloadHistory] Downloading ${symbol} ${timeframe} from MT5...`
    );

    const url = `${mt5BaseUrl}/api/v1/history`;
    const params: any = {
      symbol,
      timeframe: timeframe.toUpperCase(),
    };

    if (startDate && endDate) {
      params.startDate = startDate.toISOString().split('T')[0];
      params.endDate = endDate.toISOString().split('T')[0];
      logger.info(
        `[DownloadHistory] Date range: ${params.startDate} to ${params.endDate}`
      );
    } else if (days) {
      params.days = days;
      logger.info(`[DownloadHistory] Last ${days} days`);
    } else {
      throw new Error('Either --from/--to dates or --days must be provided');
    }

    try {
      const response = await axios.get<MT5Candle[]>(url, {
        params,
        timeout: 120000, // 2 minute timeout for large requests
      });

      if (!response.data || !Array.isArray(response.data)) {
        throw new Error('Invalid response from MT5 connector');
      }

      logger.info(`[DownloadHistory] Downloaded ${response.data.length} candles from MT5`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorMsg = error.response?.data?.detail || error.message;
        throw new Error(`MT5 download failed: ${errorMsg}`);
      }
      throw error;
    }
  }

  /**
   * Store candles in Postgres
   */
  async storeCandles(candles: MT5Candle[]): Promise<void> {
    if (candles.length === 0) {
      logger.warn('[DownloadHistory] No candles to store');
      return;
    }

    const { symbol, timeframe } = this.config;
    
    logger.info(`[DownloadHistory] Storing ${candles.length} candles in Postgres...`);

    // Use INSERT ... ON CONFLICT to handle duplicates
    const insertQuery = `
      INSERT INTO historical_candles (symbol, timeframe, timestamp, open, high, low, close, volume)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (symbol, timeframe, timestamp) DO UPDATE SET
        open = EXCLUDED.open,
        high = EXCLUDED.high,
        low = EXCLUDED.low,
        close = EXCLUDED.close,
        volume = EXCLUDED.volume
    `;

    let inserted = 0;
    let updated = 0;
    let errors = 0;

    // Process in batches of 1000 for better performance
    const batchSize = 1000;
    for (let i = 0; i < candles.length; i += batchSize) {
      const batch = candles.slice(i, i + batchSize);
      
      try {
        await this.pool.query('BEGIN');
        
        for (const candle of batch) {
          const timestamp = new Date(candle.time);
          
          try {
            const result = await this.pool.query(insertQuery, [
              symbol,
              timeframe.toUpperCase(),
              timestamp,
              candle.open,
              candle.high,
              candle.low,
              candle.close,
              candle.volume || 0,
            ]);
            
            // Check if it was an insert or update (Postgres doesn't tell us directly)
            // We'll assume insert for simplicity
            inserted++;
          } catch (err) {
            errors++;
            logger.warn(`[DownloadHistory] Failed to insert candle at ${candle.time}: ${err}`);
          }
        }
        
        await this.pool.query('COMMIT');
      } catch (err) {
        await this.pool.query('ROLLBACK');
        logger.error(`[DownloadHistory] Batch insert failed: ${err}`);
        throw err;
      }
    }

    logger.info(
      `[DownloadHistory] Stored ${inserted} candles (${errors} errors)`
    );

    // Get date range of stored data
    const firstCandle = candles[0];
    const lastCandle = candles[candles.length - 1];
    logger.info(
      `[DownloadHistory] Date range: ${firstCandle.time} to ${lastCandle.time}`
    );
  }

  /**
   * Get statistics about stored data
   */
  async getStatistics(): Promise<void> {
    const { symbol, timeframe } = this.config;
    
    const result = await this.pool.query(
      `SELECT 
        COUNT(*) as total_candles,
        MIN(timestamp) as earliest,
        MAX(timestamp) as latest
       FROM historical_candles
       WHERE symbol = $1 AND timeframe = $2`,
      [symbol, timeframe.toUpperCase()]
    );

    if (result.rows.length > 0) {
      const stats = result.rows[0];
      logger.info(
        `[DownloadHistory] Database statistics for ${symbol} ${timeframe}:`
      );
      logger.info(`  Total candles: ${stats.total_candles}`);
      logger.info(`  Earliest: ${stats.earliest}`);
      logger.info(`  Latest: ${stats.latest}`);
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.pool.end();
    logger.info('[DownloadHistory] Database connection closed');
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  // Parse command line arguments
  let symbol: string | undefined;
  let timeframe = 'M1';
  let startDate: Date | undefined;
  let endDate: Date | undefined;
  let days: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--symbol':
      case '-s':
        symbol = args[++i];
        break;
      case '--timeframe':
      case '-t':
        timeframe = args[++i] || 'M1';
        break;
      case '--from':
      case '-f':
        startDate = new Date(args[++i]);
        break;
      case '--to':
        endDate = new Date(args[++i]);
        break;
      case '--days':
      case '-d':
        days = parseInt(args[++i], 10);
        break;
      case '--help':
      case '-h':
        console.log(`
Download Historical Data from MT5 to Postgres

Usage:
  pnpm download-history --symbol SYMBOL [OPTIONS]

Options:
  --symbol, -s SYMBOL      Trading symbol (e.g., XAUUSD, EURUSD) [required]
  --timeframe, -t TF       Timeframe (M1, M5, M15, H1, H4) [default: M1]
  --from, -f DATE          Start date (YYYY-MM-DD)
  --to DATE                End date (YYYY-MM-DD)
  --days, -d DAYS          Number of days from today (alternative to --from/--to)
  --help, -h               Show this help message

Examples:
  # Download last 90 days
  pnpm download-history --symbol XAUUSD --days 90 --timeframe M1

  # Download specific date range
  pnpm download-history --symbol XAUUSD --from 2024-01-01 --to 2024-12-31 --timeframe M1

  # Download multiple symbols
  pnpm download-history --symbol XAUUSD --days 365 --timeframe M1
  pnpm download-history --symbol EURUSD --days 365 --timeframe M1
        `);
        process.exit(0);
    }
  }

  if (!symbol) {
    logger.error('[DownloadHistory] --symbol is required');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.error('[DownloadHistory] DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const mt5BaseUrl = process.env.MT5_CONNECTOR_URL || 'http://localhost:3030';

  const config: DownloadConfig = {
    symbol,
    timeframe,
    startDate,
    endDate,
    days,
    mt5BaseUrl,
    databaseUrl,
  };

  const downloader = new HistoryDownloader(config);

  try {
    // Ensure schema exists
    await downloader.ensureSchema();

    // Download from MT5
    const candles = await downloader.downloadFromMT5();

    if (candles.length === 0) {
      logger.warn('[DownloadHistory] No candles downloaded - check MT5 terminal history');
      process.exit(1);
    }

    // Store in Postgres
    await downloader.storeCandles(candles);

    // Show statistics
    await downloader.getStatistics();

    logger.info('[DownloadHistory] ✅ Download complete!');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`[DownloadHistory] Failed: ${errorMsg}`, error);
    process.exit(1);
  } finally {
    await downloader.close();
  }
}

// Run if called directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('[DownloadHistory] Unhandled error:', error);
    process.exit(1);
  });
}

export { HistoryDownloader };

