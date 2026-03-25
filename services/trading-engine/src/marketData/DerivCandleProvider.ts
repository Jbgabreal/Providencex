/**
 * DerivCandleProvider — Fetches historical + live M1 candles from Deriv WebSocket API.
 *
 * Replaces PriceFeedClient + HistoricalBackfillService for market data.
 * MT5 connector is still used for trade execution only.
 *
 * Deriv ticks_history API (no auth needed for market data):
 *   - Historical: { ticks_history: "frxXAUUSD", style: "candles", granularity: 60, count: 5000, end: "latest" }
 *   - Live subscription: same + subscribe: 1 → streams ohlc updates
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Logger } from '@providencex/shared-utils';
import { CandleStore } from './CandleStore';
import { Tick, Candle } from './types';

const logger = new Logger('DerivCandleProvider');

// Map standard symbols to Deriv symbols
const SYMBOL_MAP: Record<string, string> = {
  // Forex
  XAUUSD: 'frxXAUUSD',
  EURUSD: 'frxEURUSD',
  GBPUSD: 'frxGBPUSD',
  USDJPY: 'frxUSDJPY',
  AUDUSD: 'frxAUDUSD',
  USDCAD: 'frxUSDCAD',
  USDCHF: 'frxUSDCHF',
  NZDUSD: 'frxNZDUSD',
  EURJPY: 'frxEURJPY',
  GBPJPY: 'frxGBPJPY',
  // Metals
  XAGUSD: 'frxXAGUSD',
  // Indices
  US30: 'OTC_DJI',
  US100: 'OTC_NDX',
  US500: 'OTC_SPC',
};

// Reverse map: frxXAUUSD → XAUUSD
const REVERSE_SYMBOL_MAP: Record<string, string> = {};
for (const [std, deriv] of Object.entries(SYMBOL_MAP)) {
  REVERSE_SYMBOL_MAP[deriv] = std;
}

export interface DerivCandleProviderConfig {
  symbols: string[];
  candleStore: CandleStore;
  appId?: string;
}

export class DerivCandleProvider extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: DerivCandleProviderConfig;
  private appId: string;
  private supportedSymbols: string[] = [];
  private unsupportedSymbols: string[] = [];
  private latestTicks: Map<string, Tick> = new Map();
  private reqIdCounter = 1;
  private isRunning = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private backfillComplete = new Set<string>();

  constructor(config: DerivCandleProviderConfig) {
    super();
    this.config = config;
    this.appId = config.appId || process.env.DERIV_APP_ID || '1089';

    // Split symbols into supported (has Deriv mapping) and unsupported
    for (const symbol of config.symbols) {
      if (SYMBOL_MAP[symbol.toUpperCase()]) {
        this.supportedSymbols.push(symbol.toUpperCase());
      } else {
        this.unsupportedSymbols.push(symbol.toUpperCase());
      }
    }

    if (this.unsupportedSymbols.length > 0) {
      logger.warn(
        `[DerivCandleProvider] Symbols not available on Deriv (skipped): ${this.unsupportedSymbols.join(', ')}`
      );
    }

    logger.info(
      `[DerivCandleProvider] Initialized: ${this.supportedSymbols.length} symbols (${this.supportedSymbols.join(', ')}), appId=${this.appId}`
    );
  }

  /**
   * Connect to Deriv WebSocket, fetch historical candles, and subscribe to live updates.
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    await this.connect();
  }

  /**
   * Stop the provider and close the WebSocket.
   */
  stop(): void {
    this.isRunning = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    logger.info('[DerivCandleProvider] Stopped');
  }

  /**
   * Get latest tick for a symbol (compatible with PriceFeedClient interface).
   */
  getLatestTick(symbol: string): Tick | undefined {
    return this.latestTicks.get(symbol.toUpperCase());
  }

  /**
   * Get symbol state (for admin engine-status compatibility).
   */
  getSymbolState(symbol: string): { lastTick?: Tick; retryCount: number } | undefined {
    const tick = this.latestTicks.get(symbol.toUpperCase());
    return tick ? { lastTick: tick, retryCount: 0 } : { retryCount: 0 };
  }

  // ==================== Private ====================

  private async connect(): Promise<void> {
    return new Promise((resolve) => {
      const url = `wss://ws.derivws.com/websockets/v3?app_id=${this.appId}`;
      logger.info(`[DerivCandleProvider] Connecting to ${url}`);

      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        logger.info('[DerivCandleProvider] WebSocket connected');

        // Keepalive ping every 30s
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ ping: 1 }));
          }
        }, 30000);

        // Subscribe to each symbol (historical + live)
        this.subscribeAll();
        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (err) {
          logger.error('[DerivCandleProvider] Failed to parse message', err);
        }
      });

      this.ws.on('close', () => {
        logger.warn('[DerivCandleProvider] WebSocket closed');
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        this.scheduleReconnect();
      });

      this.ws.on('error', (err: Error) => {
        logger.error('[DerivCandleProvider] WebSocket error', err);
      });
    });
  }

  private scheduleReconnect(): void {
    if (!this.isRunning || this.reconnectTimer) return;

    logger.info('[DerivCandleProvider] Reconnecting in 5 seconds...');
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (err) {
        logger.error('[DerivCandleProvider] Reconnect failed', err);
        this.scheduleReconnect();
      }
    }, 5000);
  }

  /**
   * Subscribe to historical + live candles for all supported symbols.
   */
  private subscribeAll(): void {
    for (const symbol of this.supportedSymbols) {
      const derivSymbol = SYMBOL_MAP[symbol];
      if (!derivSymbol) continue;

      const reqId = this.reqIdCounter++;
      const request = {
        ticks_history: derivSymbol,
        style: 'candles',
        granularity: 60, // M1
        count: 5000,
        end: 'latest',
        subscribe: 1,
        req_id: reqId,
      };

      logger.info(`[DerivCandleProvider] Requesting history + subscription for ${symbol} (${derivSymbol})`);
      this.ws?.send(JSON.stringify(request));
    }
  }

  /**
   * Handle incoming WebSocket messages.
   */
  private handleMessage(msg: any): void {
    // Ignore pings
    if (msg.msg_type === 'ping') return;

    // Error handling
    if (msg.error) {
      logger.error(`[DerivCandleProvider] API error: ${msg.error.message} (code: ${msg.error.code})`);
      return;
    }

    // Historical candles response
    if (msg.msg_type === 'candles' && msg.candles) {
      this.handleHistoricalCandles(msg);
    }

    // Live OHLC update (streaming subscription)
    if (msg.msg_type === 'ohlc' && msg.ohlc) {
      this.handleLiveOhlc(msg.ohlc);
    }
  }

  /**
   * Process historical candles from ticks_history response.
   */
  private handleHistoricalCandles(msg: any): void {
    const candles = msg.candles;
    if (!candles || !Array.isArray(candles) || candles.length === 0) return;

    // Determine the standard symbol from the first candle or the subscription echo
    const derivSymbol = msg.echo_req?.ticks_history;
    const stdSymbol = derivSymbol ? REVERSE_SYMBOL_MAP[derivSymbol] : null;

    if (!stdSymbol) {
      logger.warn(`[DerivCandleProvider] Unknown symbol in candles response: ${derivSymbol}`);
      return;
    }

    let inserted = 0;
    for (const c of candles) {
      const startTime = new Date(c.epoch * 1000);
      const endTime = new Date(startTime.getTime() + 60000);

      const candle: Candle = {
        symbol: stdSymbol,
        timeframe: 'M1',
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: 1,
        startTime,
        endTime,
      };

      this.config.candleStore.addCandle(candle);
      inserted++;
    }

    this.backfillComplete.add(stdSymbol);

    // Update latest tick from last candle
    const lastCandle = candles[candles.length - 1];
    const closePrice = Number(lastCandle.close);
    this.updateTick(stdSymbol, closePrice, new Date(lastCandle.epoch * 1000));

    logger.info(
      `[DerivCandleProvider] Loaded ${inserted} historical candles for ${stdSymbol} ` +
      `(store now has ${this.config.candleStore.getCandleCount(stdSymbol)} candles)`
    );
  }

  /**
   * Process live OHLC candle update from subscription.
   */
  private handleLiveOhlc(ohlc: any): void {
    const derivSymbol = ohlc.symbol;
    const stdSymbol = REVERSE_SYMBOL_MAP[derivSymbol];

    if (!stdSymbol) return;

    const closePrice = Number(ohlc.close);
    const openTime = new Date(Number(ohlc.open_time) * 1000);
    const now = new Date();

    // Create candle from the OHLC update
    const candle: Candle = {
      symbol: stdSymbol,
      timeframe: 'M1',
      open: Number(ohlc.open),
      high: Number(ohlc.high),
      low: Number(ohlc.low),
      close: closePrice,
      volume: 1,
      startTime: openTime,
      endTime: new Date(openTime.getTime() + 60000),
    };

    // Add to store (CandleStore handles deduplication via rolling window)
    this.config.candleStore.addCandle(candle);

    // Update and emit tick for live processing
    const tick = this.updateTick(stdSymbol, closePrice, now);
    this.emit('tick', tick);
  }

  /**
   * Update the latest tick for a symbol.
   */
  private updateTick(symbol: string, price: number, time: Date): Tick {
    const tick: Tick = {
      symbol,
      bid: price,
      ask: price,
      mid: price,
      time,
    };
    this.latestTicks.set(symbol, tick);
    return tick;
  }
}
