/**
 * TradingView Strategy
 *
 * IStrategy implementation that uses TradingView Desktop as the signal source.
 * Pine indicators running on TradingView charts provide the ICT/SMC analysis,
 * and this strategy reads the indicator drawings via CDP to generate trade signals.
 *
 * Activation: Add TV_SIGNAL to ACTIVE_STRATEGIES env var
 * Requirements: TradingView Desktop running with --remote-debugging-port=9222
 */

import { Logger } from '@providencex/shared-utils';
import { IStrategy, StrategyContext, StrategyResult } from '../strategies/types';
import { StrategyProfile } from '../strategies/profiles/types';
import { TradingViewBridge } from './TradingViewBridge';
import { TradingViewSignalService, TVSignalConfig } from './TradingViewSignalService';
import { TradingViewBridgeConfig } from './types';

const logger = new Logger('TradingViewStrategy');

export class TradingViewStrategy implements IStrategy {
  readonly key = 'TV_SIGNAL_V1';
  readonly displayName = 'TradingView Signal (Pine Indicators)';

  private bridge: TradingViewBridge;
  private signalService: TradingViewSignalService;
  private profile: StrategyProfile;
  private initialized = false;

  constructor(profile: StrategyProfile) {
    this.profile = profile;

    // Read config from profile or env
    const bridgeConfig: Partial<TradingViewBridgeConfig> = {
      cdpHost: process.env.TV_CDP_HOST || 'localhost',
      cdpPort: parseInt(process.env.TV_CDP_PORT || '9222', 10),
    };

    const signalConfig: Partial<TVSignalConfig> = {
      obIndicatorFilter: process.env.TV_OB_INDICATOR || profile.config?.obIndicatorFilter,
      biasIndicatorFilter: process.env.TV_BIAS_INDICATOR || profile.config?.biasIndicatorFilter,
      entryIndicatorFilter: process.env.TV_ENTRY_INDICATOR || profile.config?.entryIndicatorFilter,
      minRR: parseFloat(process.env.TV_MIN_RR || '') || profile.config?.minRR || 1.5,
    };

    this.bridge = new TradingViewBridge(bridgeConfig);
    this.signalService = new TradingViewSignalService(this.bridge, signalConfig);

    logger.info(`[TradingViewStrategy] Initialized with profile: ${profile.key}`);
  }

  async execute(context: StrategyContext): Promise<StrategyResult> {
    const { symbol } = context;

    // Lazy connect on first execution
    if (!this.initialized) {
      try {
        await this.bridge.ensureConnected();
        this.initialized = true;
        const health = await this.bridge.healthCheck();
        logger.info(`[TradingViewStrategy] CDP connected. Chart symbol: ${health.symbol}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[TradingViewStrategy] CDP connection failed: ${msg}`);
        return {
          orders: [],
          debug: { reason: `TradingView not connected: ${msg}` },
        };
      }
    }

    try {
      const signal = await this.signalService.generateSignal(symbol);

      if (!signal) {
        return {
          orders: [],
          debug: { reason: this.signalService.getLastSmcReason() || 'No TV signal' },
        };
      }

      return {
        orders: [{ signal, metadata: { source: 'tradingview' } }],
        debug: {
          reason: signal.reason,
          snapshot: this.signalService.getLastSnapshot(),
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[TradingViewStrategy] Error for ${symbol}: ${msg}`);
      return {
        orders: [],
        debug: { reason: `TV strategy error: ${msg}` },
      };
    }
  }

  /** Expose bridge for health checks and API endpoints */
  getBridge(): TradingViewBridge {
    return this.bridge;
  }

  getSignalService(): TradingViewSignalService {
    return this.signalService;
  }
}
