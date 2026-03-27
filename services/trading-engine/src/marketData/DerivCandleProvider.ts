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
  // Volatility Indices (24/7)
  V25: '1HZ25V',
  V50: '1HZ50V',
  V75: '1HZ75V',
  V100: '1HZ100V',
  V10: '1HZ10V',
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

// Global reference for direct access from strategy code
let _globalInstance: DerivCandleProvider | null = null;

export function getDerivCandleProvider(): DerivCandleProvider | null {
  return _globalInstance;
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
  private m1RetryCount: Map<string, number> = new Map();
  private m1RetryInProgress: Set<string> = new Set();
  private static MAX_M1_RETRIES = 5;

  // Direct H4 and M15 candle caches (real Deriv data, not expanded/re-aggregated)
  private h4Candles: Map<string, Candle[]> = new Map();
  private m15Candles: Map<string, Candle[]> = new Map();

  constructor(config: DerivCandleProviderConfig) {
    super();
    this.config = config;
    this.appId = config.appId || process.env.DERIV_APP_ID || '1089';
    _globalInstance = this; // Set global singleton

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
   * Get real H4 candles directly from Deriv (not re-aggregated from M1).
   */
  getH4Candles(symbol: string, limit: number = 50): Candle[] {
    const candles = this.h4Candles.get(symbol.toUpperCase()) || [];
    return candles.slice(-limit);
  }

  /**
   * Get real M15 candles directly from Deriv (not re-aggregated from M1).
   */
  getM15Candles(symbol: string, limit: number = 200): Candle[] {
    const candles = this.m15Candles.get(symbol.toUpperCase()) || [];
    return candles.slice(-limit);
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

        // Reset retry counters on fresh connection
        this.m1RetryCount.clear();
        this.m1RetryInProgress.clear();

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
   * For each symbol, requests:
   *   1. H4 candles (50) — expanded into M1-spaced candles for MarketDataService aggregation
   *   2. M15 candles (200) — expanded into M1-spaced candles
   *   3. M1 candles (live subscription) — real-time updates
   * Staggers symbols with 6s delay; within a symbol, staggers timeframes with 1s.
   */
  private subscribeAll(): void {
    this.supportedSymbols.forEach((symbol, symbolIndex) => {
      const derivSymbol = SYMBOL_MAP[symbol];
      if (!derivSymbol) return;

      const baseDelay = symbolIndex * 6000; // 6s per symbol

      // Request 1: H4 historical candles (backfill for bias detection)
      setTimeout(() => {
        if (!this.ws || this.ws.readyState !== 1) return;
        const reqId = this.reqIdCounter++;
        this.ws!.send(JSON.stringify({
          ticks_history: derivSymbol,
          style: 'candles',
          granularity: 14400, // H4
          count: 50,
          end: 'latest',
          req_id: reqId,
        }));
        logger.info(`[DerivCandleProvider] Requesting H4 history for ${symbol} (${derivSymbol}) [${symbolIndex + 1}/${this.supportedSymbols.length}]`);
      }, baseDelay);

      // Request 2: M15 historical candles (backfill for setup detection)
      setTimeout(() => {
        if (!this.ws || this.ws.readyState !== 1) return;
        const reqId = this.reqIdCounter++;
        this.ws!.send(JSON.stringify({
          ticks_history: derivSymbol,
          style: 'candles',
          granularity: 900, // M15
          count: 200,
          end: 'latest',
          req_id: reqId,
        }));
        logger.info(`[DerivCandleProvider] Requesting M15 history for ${symbol} (${derivSymbol})`);
      }, baseDelay + 1000);

      // Request 3: M1 candles with live subscription (real-time updates)
      setTimeout(() => {
        if (!this.ws || this.ws.readyState !== 1) {
          logger.error(`[DerivCandleProvider] ❌ WebSocket not ready for M1 request: ${symbol} (readyState=${this.ws?.readyState})`);
          return;
        }
        const reqId = this.reqIdCounter++;
        this.ws!.send(JSON.stringify({
          ticks_history: derivSymbol,
          style: 'candles',
          granularity: 60, // M1
          count: 5000,
          end: 'latest',
          subscribe: 1,
          req_id: reqId,
        }));
        logger.info(`[DerivCandleProvider] Requesting M1 history + live subscription for ${symbol} (${derivSymbol}) [reqId=${reqId}]`);
      }, baseDelay + 2000);
    });

    // Verify M1 data loaded after all subscriptions should have completed
    const totalDelay = this.supportedSymbols.length * 6000 + 15000; // extra 15s for API responses
    setTimeout(() => this.verifyM1Data(), totalDelay);
  }

  /**
   * Verify M1 candle data loaded for all symbols. Retry if missing.
   */
  private verifyM1Data(): void {
    for (const symbol of this.supportedSymbols) {
      const count = this.config.candleStore.getCandleCount(symbol);
      if (count === 0) {
        logger.error(`[DerivCandleProvider] ❌ M1 VERIFICATION FAILED: ${symbol} has 0 M1 candles in CandleStore after backfill!`);
        const derivSymbol = SYMBOL_MAP[symbol];
        if (derivSymbol) {
          logger.info(`[DerivCandleProvider] Retrying M1 subscription for ${symbol}...`);
          this.retryM1Subscription(derivSymbol);
        }
      } else {
        logger.info(`[DerivCandleProvider] ✅ M1 verified: ${symbol} has ${count} M1 candles in CandleStore`);
      }
    }
  }

  /**
   * Retry M1 subscription for a single symbol (Deriv symbol format).
   * Uses exponential backoff and prevents duplicate retries.
   */
  private retryM1Subscription(derivSymbol: string): void {
    const stdSymbol = REVERSE_SYMBOL_MAP[derivSymbol] || derivSymbol;

    // Prevent duplicate retries
    if (this.m1RetryInProgress.has(stdSymbol)) return;

    const retryNum = (this.m1RetryCount.get(stdSymbol) || 0) + 1;
    if (retryNum > DerivCandleProvider.MAX_M1_RETRIES) {
      logger.error(`[DerivCandleProvider] ❌ M1 max retries (${DerivCandleProvider.MAX_M1_RETRIES}) reached for ${stdSymbol}. Giving up — will retry on next reconnect.`);
      return;
    }
    this.m1RetryCount.set(stdSymbol, retryNum);
    this.m1RetryInProgress.add(stdSymbol);

    // Exponential backoff: 10s, 20s, 40s, 80s, 160s
    const backoffMs = 10000 * Math.pow(2, retryNum - 1);
    logger.info(`[DerivCandleProvider] 🔄 M1 retry #${retryNum} for ${stdSymbol} in ${backoffMs / 1000}s...`);

    setTimeout(() => {
      this.m1RetryInProgress.delete(stdSymbol);

      if (!this.ws || this.ws.readyState !== 1) {
        logger.error(`[DerivCandleProvider] Cannot retry M1 — WebSocket not connected`);
        return;
      }

      // Check if data arrived in the meantime
      const count = this.config.candleStore.getCandleCount(stdSymbol);
      if (count > 0) {
        logger.info(`[DerivCandleProvider] ✅ M1 already loaded for ${stdSymbol} (${count} candles) — skipping retry`);
        return;
      }

      const reqId = this.reqIdCounter++;
      this.ws!.send(JSON.stringify({
        ticks_history: derivSymbol,
        style: 'candles',
        granularity: 60,
        count: 1000,
        end: 'latest',
        subscribe: 1,
        req_id: reqId,
      }));
      logger.info(`[DerivCandleProvider] 🔄 Retry M1 #${retryNum} for ${stdSymbol} (${derivSymbol}) [reqId=${reqId}]`);
    }, backoffMs);
  }

  /**
   * Handle incoming WebSocket messages.
   */
  private handleMessage(msg: any): void {
    // Ignore pings
    if (msg.msg_type === 'ping') return;

    // Error handling
    if (msg.error) {
      const symbol = msg.echo_req?.ticks_history || 'unknown';
      const granularity = msg.echo_req?.granularity || '?';
      const tfLabel = granularity === 14400 ? 'H4' : granularity === 900 ? 'M15' : granularity === 60 ? 'M1' : `g${granularity}`;
      logger.error(`[DerivCandleProvider] API error for ${symbol} (${tfLabel}): ${msg.error.message} (code: ${msg.error.code})`);
      // If M1 subscription fails, schedule a retry with backoff
      if (granularity === 60) {
        const stdSymbol = REVERSE_SYMBOL_MAP[symbol];
        logger.error(`[DerivCandleProvider] ❌ M1 subscription FAILED for ${stdSymbol || symbol}`);
        this.retryM1Subscription(symbol);
      }
      // If H4/M15 fail, retry once after 30s
      if ((granularity === 14400 || granularity === 900) && this.ws?.readyState === 1) {
        setTimeout(() => {
          if (!this.ws || this.ws.readyState !== 1) return;
          const reqId = this.reqIdCounter++;
          this.ws!.send(JSON.stringify({
            ticks_history: symbol,
            style: 'candles',
            granularity,
            count: granularity === 14400 ? 50 : 200,
            end: 'latest',
            req_id: reqId,
          }));
          logger.info(`[DerivCandleProvider] 🔄 Retry ${tfLabel} for ${REVERSE_SYMBOL_MAP[symbol] || symbol} [reqId=${reqId}]`);
        }, 30000);
      }
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

    // Tick history response (may come as 'history' msg_type for non-candle styles)
    if (msg.msg_type === 'history') {
      logger.warn(`[DerivCandleProvider] Got 'history' instead of 'candles' — check request style param`);
    }

    // Log unhandled message types for debugging
    if (msg.msg_type && !['ping', 'candles', 'ohlc', 'history'].includes(msg.msg_type) && !msg.error) {
      logger.warn(`[DerivCandleProvider] Unhandled msg_type: ${msg.msg_type} (keys: ${Object.keys(msg).join(', ')})`);
    }
  }

  /**
   * Process historical candles from ticks_history response.
   * H4/M15 candles are expanded into M1-spaced candles so MarketDataService can aggregate them.
   */
  private handleHistoricalCandles(msg: any): void {
    const candles = msg.candles;
    const derivSymbol = msg.echo_req?.ticks_history;
    const granularity = msg.echo_req?.granularity || 60;

    const tfLabel = granularity === 14400 ? 'H4' : granularity === 900 ? 'M15' : 'M1';

    logger.info(`[DerivCandleProvider] Received ${tfLabel} candles: symbol=${derivSymbol}, count=${candles?.length || 0}`);

    if (!candles || !Array.isArray(candles) || candles.length === 0) {
      logger.warn(`[DerivCandleProvider] Empty ${tfLabel} candles for ${derivSymbol}`);
      return;
    }

    const stdSymbol = derivSymbol ? REVERSE_SYMBOL_MAP[derivSymbol] : null;

    if (!stdSymbol) {
      logger.warn(`[DerivCandleProvider] Unknown symbol in candles response: ${derivSymbol}`);
      return;
    }

    let inserted = 0;

    if (granularity === 60) {
      // M1 candles — insert directly into CandleStore
      for (const c of candles) {
        const startTime = new Date(c.epoch * 1000);
        const endTime = new Date(startTime.getTime() + 60000);
        this.config.candleStore.addCandle({
          symbol: stdSymbol, timeframe: 'M1',
          open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
          volume: 1, startTime, endTime,
        });
        inserted++;
      }
    } else {
      // H4 or M15 candles — store directly in dedicated caches (no M1 expansion)
      // On reconnect, replace entirely to avoid duplicates that break pivot detection
      const cache = granularity === 14400 ? this.h4Candles : this.m15Candles;
      const freshCandles: Candle[] = [];
      const seenEpochs = new Set<number>();

      for (const c of candles) {
        const epoch = c.epoch * 1000;
        if (seenEpochs.has(epoch)) continue; // skip duplicate epochs within same batch
        seenEpochs.add(epoch);

        const startTime = new Date(epoch);
        const endTime = new Date(epoch + granularity * 1000);
        freshCandles.push({
          symbol: stdSymbol, timeframe: 'M1', // type field is 'M1' for interface compat
          open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
          volume: Number(c.volume || 1), startTime, endTime,
        });
        inserted++;
      }

      // Sort by time and REPLACE the cache (not append) to prevent reconnect duplicates
      freshCandles.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      cache.set(stdSymbol, freshCandles);
      logger.info(`[DerivCandleProvider] ${tfLabel} cache for ${stdSymbol}: ${freshCandles.length} unique candles (replaced, not appended)`);
    }

    this.backfillComplete.add(stdSymbol);

    // Update latest tick from last candle
    const lastCandle = candles[candles.length - 1];
    const closePrice = Number(lastCandle.close);
    this.updateTick(stdSymbol, closePrice, new Date(lastCandle.epoch * 1000));

    if (granularity === 60) {
      logger.info(
        `[DerivCandleProvider] ✅ M1 BACKFILL: Loaded ${inserted} M1 candles for ${stdSymbol} ` +
        `(CandleStore now has ${this.config.candleStore.getCandleCount(stdSymbol)} M1 candles)`
      );
    } else {
      logger.info(
        `[DerivCandleProvider] ${tfLabel} cache loaded: ${inserted} candles for ${stdSymbol} ` +
        `(M1 CandleStore has ${this.config.candleStore.getCandleCount(stdSymbol)} candles)`
      );
    }
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
