/**
 * HistoricalBackfillService - Loads historical M1 candles from MT5 on startup
 * Backfills CandleStore with ~3 months of historical data so SMC has structure from day one
 */
import axios, { AxiosError } from 'axios';
import { Logger } from '@providencex/shared-utils';
import { CandleStore } from '../marketData/CandleStore';
import { Candle } from '../marketData/types';

const logger = new Logger('HistoricalBackfill');

/**
 * Response type from MT5 history endpoint
 */
interface HistoryCandleResponse {
  time: string;   // ISO 8601 string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HistoricalBackfillConfig {
  candleStore: CandleStore;
  symbols: string[];
  mt5BaseUrl: string;
  backfillEnabled: boolean;
  backfillDays: number;
}

/**
 * HistoricalBackfillService - Fetches historical M1 candles from MT5 and loads them into CandleStore
 */
export class HistoricalBackfillService {
  private candleStore: CandleStore;
  private symbols: string[];
  private mt5BaseUrl: string;
  private backfillEnabled: boolean;
  private backfillDays: number;

  constructor(config: HistoricalBackfillConfig) {
    this.candleStore = config.candleStore;
    this.symbols = config.symbols;
    this.mt5BaseUrl = config.mt5BaseUrl;
    this.backfillEnabled = config.backfillEnabled;
    this.backfillDays = config.backfillDays;
  }

  /**
   * Backfill all configured symbols with historical M1 candles
   */
  async backfillAll(): Promise<void> {
    if (!this.backfillEnabled) {
      logger.info('[HistoricalBackfill] Disabled via config');
      return;
    }

    logger.info(
      `[HistoricalBackfill] Starting backfill: ${this.backfillDays} days, symbols=${this.symbols.join(', ')}`
    );

    for (const symbol of this.symbols) {
      await this.backfillSymbol(symbol);
    }

    logger.info('[HistoricalBackfill] Completed backfill for all symbols');
  }

  /**
   * Backfill a single symbol with historical M1 candles
   */
  private async backfillSymbol(symbol: string): Promise<void> {
    try {
      logger.info(
        `[HistoricalBackfill] Fetching history for ${symbol}, days=${this.backfillDays}`
      );

      const url = `${this.mt5BaseUrl}/api/v1/history`;
      const response = await axios.get<HistoryCandleResponse[]>(url, {
        params: {
          symbol,
          timeframe: 'M1',
          days: this.backfillDays,
        },
        timeout: 60_000, // 60 second timeout
      });

      const candles = response.data;

      if (!candles || candles.length === 0) {
        logger.warn(
          `[HistoricalBackfill] No history returned for ${symbol} (days=${this.backfillDays})`
        );
        return;
      }

      // Sort ascending by time (oldest first) to ensure proper insertion order
      candles.sort(
        (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
      );

      // Map to CandleStore candle type and insert
      let inserted = 0;
      for (const c of candles) {
        const candleTime = new Date(c.time);
        
        // Create candle with M1 timeframe
        // Calculate end time (1 minute after start time)
        const endTime = new Date(candleTime.getTime() + 60 * 1000);
        
        const candle: Candle = {
          symbol: symbol,
          timeframe: 'M1',
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          startTime: candleTime,
          endTime: endTime,
        };

        // Insert into CandleStore (will handle rolling window if needed)
        this.candleStore.addCandle(candle);
        inserted++;
      }

      const firstTime = candles[0].time;
      const lastTime = candles[candles.length - 1].time;

      logger.info(
        `[HistoricalBackfill] Loaded ${inserted} candles for ${symbol} (from ${firstTime} to ${lastTime})`
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ detail?: string; error?: string }>;
        if (axiosError.response) {
          const errorMessage = axiosError.response.data?.detail || 
                              axiosError.response.data?.error || 
                              axiosError.message;
          logger.error(
            `[HistoricalBackfill] Failed to backfill ${symbol}: HTTP ${axiosError.response.status} - ${errorMessage}`
          );
        } else {
          logger.error(
            `[HistoricalBackfill] Failed to backfill ${symbol} (network error): ${axiosError.message}`
          );
        }
      } else {
        logger.error(
          `[HistoricalBackfill] Failed to backfill ${symbol}`,
          { error }
        );
      }
      // Continue with other symbols even if one fails
    }
  }
}

