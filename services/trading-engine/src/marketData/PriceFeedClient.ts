/**
 * PriceFeedClient - Polls MT5 Connector for live price ticks
 * Emits tick events for registered symbols at configurable intervals
 */
import { EventEmitter } from 'events';
import { Logger } from '@providencex/shared-utils';
import { Tick } from './types';
import axios, { AxiosError } from 'axios';

const logger = new Logger('PriceFeedClient');

export interface PriceFeedConfig {
  mt5ConnectorUrl: string;
  pollIntervalSeconds: number;
  symbols: string[];
  retryAttempts?: number;  // Max retry attempts per symbol (default: 3)
  retryDelayMs?: number;   // Initial retry delay in ms (default: 1000)
}

interface SymbolState {
  lastTick?: Tick;
  retryCount: number;
  lastError?: string;
}

export class PriceFeedClient extends EventEmitter {
  private config: Required<PriceFeedConfig>;
  private pollIntervals: Map<string, NodeJS.Timeout> = new Map();
  private symbolStates: Map<string, SymbolState> = new Map();
  private isRunning: boolean = false;

  constructor(config: PriceFeedConfig) {
    super();
    
    // Ensure symbols array exists and is valid
    const symbols = config.symbols || [];
    if (!Array.isArray(symbols) || symbols.length === 0) {
      logger.warn('No symbols provided to PriceFeedClient, using default: XAUUSD');
      config.symbols = ['XAUUSD'];
    }
    
    this.config = {
      retryAttempts: 3,
      retryDelayMs: 1000,
      ...config,
      symbols: config.symbols || ['XAUUSD'],
    };
    
    // Initialize symbol states
    this.config.symbols.forEach(symbol => {
      this.symbolStates.set(symbol, {
        retryCount: 0,
      });
    });

    logger.info(
      `PriceFeedClient initialized: ${this.config.symbols.length} symbols, ` +
      `poll interval: ${this.config.pollIntervalSeconds}s, ` +
      `base URL: ${this.config.mt5ConnectorUrl}`
    );
  }

  /**
   * Start polling for all registered symbols
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('PriceFeedClient is already running');
      return;
    }

    this.isRunning = true;
    logger.info(`Starting price feed for symbols: ${this.config.symbols.join(', ')}`);

    // Start polling for each symbol
    this.config.symbols.forEach(symbol => {
      this.startPollingForSymbol(symbol);
    });
  }

  /**
   * Stop polling for all symbols
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    logger.info('Stopping price feed');

    // Clear all intervals
    this.pollIntervals.forEach(interval => clearInterval(interval));
    this.pollIntervals.clear();
  }

  /**
   * Register a new symbol to track
   */
  registerSymbol(symbol: string): void {
    if (this.config.symbols.includes(symbol)) {
      logger.debug(`Symbol ${symbol} is already registered`);
      return;
    }

    this.config.symbols.push(symbol);
    this.symbolStates.set(symbol, {
      retryCount: 0,
    });

    if (this.isRunning) {
      this.startPollingForSymbol(symbol);
    }

    logger.info(`Registered new symbol: ${symbol}`);
  }

  /**
   * Unregister a symbol (stop tracking)
   */
  unregisterSymbol(symbol: string): void {
    if (!this.config.symbols.includes(symbol)) {
      return;
    }

    // Remove from config
    this.config.symbols = this.config.symbols.filter(s => s !== symbol);

    // Stop polling
    const interval = this.pollIntervals.get(symbol);
    if (interval) {
      clearInterval(interval);
      this.pollIntervals.delete(symbol);
    }

    // Remove state
    this.symbolStates.delete(symbol);

    logger.info(`Unregistered symbol: ${symbol}`);
  }

  /**
   * Get the latest tick for a symbol
   */
  getLatestTick(symbol: string): Tick | undefined {
    const state = this.symbolStates.get(symbol);
    return state?.lastTick;
  }

  /**
   * Start polling for a specific symbol
   */
  private startPollingForSymbol(symbol: string): void {
    // Clear any existing interval
    const existingInterval = this.pollIntervals.get(symbol);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Poll immediately
    this.fetchPriceForSymbol(symbol);

    // Then poll at intervals
    const interval = setInterval(() => {
      this.fetchPriceForSymbol(symbol);
    }, this.config.pollIntervalSeconds * 1000);

    this.pollIntervals.set(symbol, interval);
  }

  /**
   * Fetch price for a symbol from MT5 Connector
   */
  private async fetchPriceForSymbol(symbol: string): Promise<void> {
    const url = `${this.config.mt5ConnectorUrl}/api/v1/price/${symbol}`;
    const state = this.symbolStates.get(symbol);

    if (!state) {
      logger.error(`No state found for symbol: ${symbol}`);
      return;
    }

    try {
      const response = await axios.get(url, {
        timeout: 5000, // 5 second timeout
      });

      if (!response.data.success) {
        const errorMsg = response.data.error || 'Unknown error';
        this.handleFetchError(symbol, errorMsg);
        return;
      }

      // Reset retry count on success
      state.retryCount = 0;
      state.lastError = undefined;

      // Convert response to Tick
      const tick: Tick = {
        symbol: response.data.symbol,
        bid: response.data.bid,
        ask: response.data.ask,
        mid: response.data.mid || (response.data.bid + response.data.ask) / 2,
        time: new Date(response.data.time_iso || response.data.time * 1000),
      };

      // Update last tick
      state.lastTick = tick;

      // Emit tick event
      this.emit('tick', tick);

      logger.debug(
        `Price tick for ${symbol}: bid=${tick.bid}, ask=${tick.ask}, mid=${tick.mid.toFixed(5)}`
      );

    } catch (error) {
      const errorMsg = error instanceof AxiosError
        ? `Network error: ${error.message}`
        : `Error: ${error instanceof Error ? error.message : String(error)}`;
      
      this.handleFetchError(symbol, errorMsg);
    }
  }

  /**
   * Handle fetch errors with retry logic
   */
  private handleFetchError(symbol: string, errorMsg: string): void {
    const state = this.symbolStates.get(symbol);
    if (!state) {
      return;
    }

    state.lastError = errorMsg;
    state.retryCount += 1;

    if (state.retryCount <= this.config.retryAttempts) {
      const delay = this.config.retryDelayMs * Math.pow(2, state.retryCount - 1); // Exponential backoff
      logger.warn(
        `Error fetching price for ${symbol} (attempt ${state.retryCount}/${this.config.retryAttempts}): ` +
        `${errorMsg}. Retrying in ${delay}ms...`
      );

      setTimeout(() => {
        if (this.isRunning && this.config.symbols.includes(symbol)) {
          this.fetchPriceForSymbol(symbol);
        }
      }, delay);
    } else {
      logger.error(
        `Failed to fetch price for ${symbol} after ${this.config.retryAttempts} attempts. ` +
        `Last error: ${errorMsg}. Skipping this polling cycle.`
      );
      // Reset retry count for next polling cycle
      state.retryCount = 0;
    }
  }

  /**
   * Get all registered symbols
   */
  getRegisteredSymbols(): string[] {
    return [...this.config.symbols];
  }

  /**
   * Get symbol state (for debugging)
   */
  getSymbolState(symbol: string): SymbolState | undefined {
    return this.symbolStates.get(symbol);
  }
}

