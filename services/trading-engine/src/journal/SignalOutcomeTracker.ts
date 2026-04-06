/**
 * Signal Outcome Tracker
 *
 * Monitors journal entries with status='signal' against live price.
 * When price hits TP or SL, updates the journal with the simulated result.
 * This allows validating strategies without executing real trades.
 *
 * Runs on a loop every N seconds, checking all active signals.
 */

import { Logger } from '@providencex/shared-utils';
import { TradeJournalRepository } from './TradeJournalRepository';

const logger = new Logger('SignalOutcomeTracker');

export class SignalOutcomeTracker {
  private repo: TradeJournalRepository;
  private priceFeed: any; // DerivCandleProvider
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  public onSignalResolved?: (strategyKey: string, symbol: string, direction: string) => void;
  private activeSignals: Map<string, {
    id: string;
    symbol: string;
    direction: 'buy' | 'sell';
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    strategyKey: string;
    lotSize?: number;
    createdAt: Date;
  }> = new Map();

  constructor(repo: TradeJournalRepository, priceFeed: any, intervalMs = 10000) {
    this.repo = repo;
    this.priceFeed = priceFeed;
    this.intervalMs = intervalMs;
  }

  /**
   * Start the outcome tracking loop
   */
  start(): void {
    logger.info(`[SignalOutcomeTracker] Starting with ${this.intervalMs}ms interval`);
    this.timer = setInterval(() => this.checkOutcomes(), this.intervalMs);
    // Initial load
    this.loadActiveSignals().catch(err => logger.error('[SignalOutcomeTracker] Initial load failed', err));
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('[SignalOutcomeTracker] Stopped');
  }

  /**
   * Register a new signal for tracking (called when journal entry is created)
   */
  trackSignal(journalId: string, data: {
    symbol: string;
    direction: 'buy' | 'sell';
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    strategyKey: string;
    lotSize?: number;
  }): void {
    this.activeSignals.set(journalId, {
      id: journalId,
      ...data,
      createdAt: new Date(),
    });
    logger.debug(`[SignalOutcomeTracker] Tracking signal ${journalId}: ${data.strategyKey} ${data.direction} ${data.symbol}`);
  }

  /**
   * Load active signals from DB (for restart recovery)
   */
  private async loadActiveSignals(): Promise<void> {
    try {
      const { entries } = await this.repo.list({ status: 'signal', limit: 200 });
      let loaded = 0;
      for (const entry of entries) {
        if (entry.entryPrice && entry.stopLoss && entry.takeProfit && entry.id) {
          this.activeSignals.set(entry.id, {
            id: entry.id,
            symbol: entry.symbol,
            direction: entry.direction,
            entryPrice: entry.entryPrice,
            stopLoss: entry.stopLoss,
            takeProfit: entry.takeProfit,
            strategyKey: entry.strategyKey,
            lotSize: entry.lotSize || entry.setupContext?.lotSize,
            createdAt: entry.createdAt || new Date(),
          });
          loaded++;
        }
      }
      if (loaded > 0) {
        logger.info(`[SignalOutcomeTracker] Loaded ${loaded} active signals from DB`);
      }
    } catch (err) {
      logger.error('[SignalOutcomeTracker] Failed to load active signals', err);
    }
  }

  /**
   * Check all active signals against current price
   */
  private async checkOutcomes(): Promise<void> {
    if (this.activeSignals.size === 0) return;

    const resolved: string[] = [];

    for (const [id, signal] of this.activeSignals) {
      try {
        const tick = this.priceFeed?.getLatestTick?.(signal.symbol);
        if (!tick) continue;

        const currentPrice = tick.mid || (tick.bid + tick.ask) / 2;
        let hit: 'tp' | 'sl' | null = null;

        if (signal.direction === 'buy') {
          if (currentPrice >= signal.takeProfit) hit = 'tp';
          else if (currentPrice <= signal.stopLoss) hit = 'sl';
        } else {
          if (currentPrice <= signal.takeProfit) hit = 'tp';
          else if (currentPrice >= signal.stopLoss) hit = 'sl';
        }

        if (hit) {
          const exitPrice = hit === 'tp' ? signal.takeProfit : signal.stopLoss;
          const risk = Math.abs(signal.entryPrice - signal.stopLoss);
          const priceDiff = signal.direction === 'buy'
            ? exitPrice - signal.entryPrice
            : signal.entryPrice - exitPrice;

          // Simulate P&L using actual lot size (or default 0.01 if unknown)
          const lotSize = signal.lotSize || 0.01;
          const contractSize = this.getContractSize(signal.symbol);
          const simulatedProfit = priceDiff * lotSize * contractSize;
          const rMultiple = risk > 0 ? priceDiff / risk : 0;
          const result: 'win' | 'loss' | 'breakeven' = hit === 'tp' ? 'win' : 'loss';

          await this.repo.updateOnClose(id, {
            exitPrice,
            profit: Math.round(simulatedProfit * 100) / 100,
            rMultiple: Math.round(rMultiple * 100) / 100,
            result,
            closeReason: hit === 'tp' ? 'tp_hit_simulated' : 'sl_hit_simulated',
            exitContext: {
              simulated: true,
              currentPrice,
              hitType: hit,
              timeToHit: Date.now() - signal.createdAt.getTime(),
            },
          });

          logger.info(
            `[SignalOutcomeTracker] ${signal.strategyKey} ${signal.symbol} ${signal.direction}: ` +
            `${result.toUpperCase()} (${hit}) | Entry: ${signal.entryPrice.toFixed(5)} → ${exitPrice.toFixed(5)} | ` +
            `P&L: $${simulatedProfit.toFixed(2)} | R: ${rMultiple.toFixed(2)}`
          );

          // Notify so dedupe cache can be cleared
          this.onSignalResolved?.(signal.strategyKey, signal.symbol, signal.direction);

          resolved.push(id);
        }

        // Expire signals older than 4 hours (stale setups)
        const ageMs = Date.now() - signal.createdAt.getTime();
        if (ageMs > 4 * 60 * 60 * 1000) {
          await this.repo.cancel(id, 'expired_4h');
          logger.debug(`[SignalOutcomeTracker] Expired signal ${id} (${signal.strategyKey} ${signal.symbol})`);
          resolved.push(id);
        }
      } catch (err) {
        logger.error(`[SignalOutcomeTracker] Error checking signal ${id}`, err);
      }
    }

    // Remove resolved signals
    for (const id of resolved) {
      this.activeSignals.delete(id);
    }
  }

  /**
   * Get contract size for P&L calculation
   * XAUUSD: 1 lot = 100 oz → $1 move = $100
   * Forex: 1 lot = 100,000 units → 0.0001 move = $10
   * US30: 1 lot = 1 contract → $1 move = $1
   */
  private getContractSize(symbol: string): number {
    const s = symbol.toUpperCase();
    if (s === 'XAUUSD' || s === 'GOLD') return 100;
    if (s === 'XAGUSD' || s === 'SILVER') return 5000;
    if (s === 'US30' || s === 'US100' || s === 'US500') return 1;
    if (s === 'BTCUSD' || s === 'BTCUSDT') return 1; // Crypto: 1 lot = 1 BTC
    if (s === 'ETHUSD' || s === 'ETHUSDT') return 1; // Crypto: 1 lot = 1 ETH
    if (s.startsWith('V') && /^V\d+$/.test(s)) return 1; // Volatility indices
    return 100000; // Standard forex lot
  }
}
