import express from 'express';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from './config';
import { MarketDataService } from './services/MarketDataService';
import { StrategyService } from './services/StrategyService';
import { GuardrailService } from './services/GuardrailService';
import { RiskService } from './services/RiskService';
import { ExecutionService } from './services/ExecutionService';
import { DecisionLogger } from './utils/DecisionLogger';
import {
  PriceFeedClient,
  CandleBuilder,
  CandleStore,
} from './marketData';
import {
  Strategy,
  RiskContext,
  TradeDecisionLog,
} from './types';
import { getNowInPXTimezone } from '@providencex/shared-utils';
import healthRoutes from './routes/health';
import simulateSignalRoutes from './routes/simulateSignal';
import adminRoutes, { initializeAdminServices } from './admin/routes';
import orderEventsRoutes, { initializeOrderEventService } from './routes/orderEvents';

// v3 Execution Filter imports
import { evaluateExecution } from './strategy/v3/ExecutionFilter';
import { executionFilterConfig } from './config/executionFilterConfig';
import { ExecutionFilterState } from './strategy/v3/ExecutionFilterState';
import { convertToRawSignal } from './strategy/v3/SignalConverter';

// v4 Open Trades & Exposure Service
import { OpenTradesService } from './services/OpenTradesService';

// v7/v8 + Execution v3 Services
import { OrderEventService } from './services/OrderEventService';
import { LivePnlService } from './services/LivePnlService';
import { KillSwitchService } from './services/KillSwitchService';

const logger = new Logger('TradingEngine');
const app = express();
const config = getConfig();

app.use(express.json());

// CORS middleware for admin dashboard
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use('/health', healthRoutes);
app.use('/simulate-signal', simulateSignalRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1', orderEventsRoutes); // v3 order events webhook

// v4 Status endpoint for exposure monitoring
app.get('/api/v1/status/exposure', async (req, res) => {
  try {
    const symbols: Array<{
      symbol: string;
      longCount: number;
      shortCount: number;
      totalCount: number;
      estimatedRiskAmount: number;
      lastUpdated: string;
    }> = [];

    // Get snapshots for all configured symbols
    const symbolKeys = Object.keys(executionFilterConfig.rulesBySymbol);
    for (const symbol of symbolKeys) {
      const snapshot = openTradesService.getSnapshotForSymbol(symbol);
      if (snapshot) {
        symbols.push({
          symbol: snapshot.symbol,
          longCount: snapshot.longCount,
          shortCount: snapshot.shortCount,
          totalCount: snapshot.totalCount,
          estimatedRiskAmount: snapshot.estimatedRiskAmount,
          lastUpdated: snapshot.lastUpdated.toISOString(),
        });
      }
    }

    const globalSnapshot = openTradesService.getGlobalSnapshot();

    res.json({
      success: true,
      symbols,
      global: {
        totalOpenTrades: globalSnapshot.totalOpenTrades,
        totalEstimatedRiskAmount: globalSnapshot.totalEstimatedRiskAmount,
        lastUpdated: globalSnapshot.lastUpdated ? globalSnapshot.lastUpdated.toISOString() : null,
      },
    });
  } catch (error) {
    logger.error('Error getting exposure status', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Initialize Market Data Layer (v2) - using MarketDataConfig
import { getMarketDataConfig } from '@providencex/shared-config';

const marketDataConfig = getMarketDataConfig();
const candleStore = new CandleStore(marketDataConfig.maxCandlesPerSymbol);
const candleBuilder = new CandleBuilder(candleStore);

const priceFeed = new PriceFeedClient({
  mt5ConnectorUrl: config.mt5ConnectorUrl || 'http://localhost:3030',
  pollIntervalSeconds: marketDataConfig.feedIntervalSec,
  symbols: marketDataConfig.symbols,
});

// Wire tick stream to candle builder
priceFeed.on('tick', (tick) => {
  candleBuilder.processTick(tick);
});

// Start price feed
priceFeed.start();
logger.info(
  `Market data layer started. Tracking symbols: ${marketDataConfig.symbols.join(', ')} ` +
  `(poll interval: ${marketDataConfig.feedIntervalSec}s, max candles: ${marketDataConfig.maxCandlesPerSymbol} per symbol)`
);

// v14 Order Flow Service
import { getOrderFlowConfig } from '@providencex/shared-config';
const orderFlowConfig = getOrderFlowConfig();
const orderFlowService = new OrderFlowService({
  mt5ConnectorUrl: config.mt5ConnectorUrl || 'http://localhost:3030',
  pollIntervalMs: orderFlowConfig.pollIntervalMs,
  largeOrderMultiplier: orderFlowConfig.largeOrderMultiplier,
  minDeltaTrendConfirmation: orderFlowConfig.minDeltaTrendConfirmation,
  exhaustionThreshold: orderFlowConfig.exhaustionThreshold,
  absorptionLookback: orderFlowConfig.absorptionLookback,
  enabled: orderFlowConfig.enabled,
});

// Start order flow service if enabled
if (orderFlowConfig.enabled) {
  orderFlowService.start(marketDataConfig.symbols);
  logger.info(`[OrderFlow] Order Flow Service started for symbols: ${marketDataConfig.symbols.join(', ')}`);
} else {
  logger.info('[OrderFlow] Order Flow Service disabled');
}

// Historical Backfill Service
import { HistoricalBackfillService } from './services/HistoricalBackfillService';

const backfillEnabled = (process.env.HISTORICAL_BACKFILL_ENABLED ?? 'true') === 'true';
const backfillDays = Number(process.env.HISTORICAL_BACKFILL_DAYS ?? '90');

const historicalBackfillService = new HistoricalBackfillService({
  candleStore,
  symbols: marketDataConfig.symbols, // Use same symbol list as PriceFeedClient and OrderFlowService
  mt5BaseUrl: config.mt5ConnectorUrl || 'http://localhost:3030',
  backfillEnabled,
  backfillDays,
});

// Services (v2 - updated to use real market data)
// Pass candleStore to MarketDataService so it uses real candles instead of mocks
const marketDataService = new MarketDataService(candleStore);
const strategyService = new StrategyService(marketDataService);
const guardrailService = new GuardrailService();
const riskService = new RiskService();
const executionService = new ExecutionService(priceFeed, candleStore, orderFlowService); // v14: Pass order flow service for smart entry refinement
const decisionLogger = new DecisionLogger();

// v3 Execution Filter state helper
const executionFilterState = new ExecutionFilterState();

// v4 Open Trades & Exposure Service
const openTradesService = new OpenTradesService({
  mt5BaseUrl: config.mt5ConnectorUrl || 'http://localhost:3030',
  pollIntervalSec: executionFilterConfig.exposurePollIntervalSec || 10,
  defaultRiskPerTrade: 75.0, // Conservative default risk per trade if no SL
});

// v15 Loss Streak Filter Service
import { LossStreakFilterService } from './services/LossStreakFilterService';
const lossStreakFilterService = new LossStreakFilterService(config.databaseUrl || '');

// v7 Live PnL Service (pass Loss Streak Filter Service for win/loss tracking)
const livePnlService = new LivePnlService({
  databaseUrl: config.databaseUrl || '',
  mt5ConnectorUrl: config.mt5ConnectorUrl || 'http://localhost:3030',
  enabled: true,
}, lossStreakFilterService);

// Execution v3 Order Event Service
const orderEventService = new OrderEventService({
  databaseUrl: config.databaseUrl || '',
  enabled: true,
});

// Wire OrderEventService → LivePnlService callback
orderEventService.setLivePnlCallback((event) => livePnlService.processPositionClosed(event));

// Initialize order events route with service
initializeOrderEventService(orderEventService);

// v8 Kill Switch Service
const killSwitchService = new KillSwitchService(
  config.databaseUrl || '',
  livePnlService,
  openTradesService
);

// v9 Exit Service
import { ExitService } from './services/ExitService';
const exitService = new ExitService(
  {
    enabled: true,
    exitTickIntervalSec: 2,
    mt5ConnectorUrl: config.mt5ConnectorUrl || 'http://localhost:3030',
    databaseUrl: config.databaseUrl || '',
    breakEvenEnabled: true,
    partialCloseEnabled: true,
    trailingEnabled: true,
    structureExitEnabled: true,
    timeExitEnabled: true,
    commissionExitEnabled: true,
  },
  openTradesService,
  killSwitchService,
  orderEventService,
  priceFeed
);

// v12 Multi-Account Distributed Executor
import { AccountRegistry } from './multiaccount/AccountRegistry';
import { PerAccountRiskService } from './multiaccount/PerAccountRiskService';
import { PerAccountKillSwitch } from './multiaccount/PerAccountKillSwitch';
import { DistributedExecutionOrchestrator } from './multiaccount/DistributedExecutionOrchestrator';
import { ExecutionFilterContext } from './strategy/v3/types';

// v14 Order Flow Service
import { OrderFlowService } from './services/OrderFlowService';

const accountRegistry = new AccountRegistry();
const perAccountRiskService = new PerAccountRiskService(config.databaseUrl);
const perAccountKillSwitch = new PerAccountKillSwitch(config.databaseUrl);
const distributedOrchestrator = new DistributedExecutionOrchestrator(
  accountRegistry,
  perAccountRiskService,
  perAccountKillSwitch,
  config.databaseUrl,
  priceFeed,
  candleStore
);

// Load accounts (backward compatible - works even if no accounts.json)
accountRegistry.loadAccounts()
  .then(() => {
    // Register accounts with kill switch after loading
    const accounts = accountRegistry.getAllAccounts();
    for (const account of accounts) {
      perAccountKillSwitch.registerAccount(account);
    }

    if (accountRegistry.isMultiAccountMode()) {
      logger.info(`[MultiAccount] Multi-account mode enabled with ${accounts.length} account(s)`);
    } else {
      logger.info('[MultiAccount] Single-account mode (no accounts.json or empty)');
    }
  })
  .catch((error) => {
    logger.warn('[MultiAccount] Failed to load accounts (backward compatible - single-account mode)', error);
  });

// Initialize admin routes with services
initializeAdminServices(livePnlService, killSwitchService);

// State tracking (in-memory for v1; should be in DB for production)
interface DailyStats {
  todayPnL: number;
  tradesToday: number;
  lastResetDate: string; // YYYY-MM-DD
}

const dailyStats: Map<Strategy, DailyStats> = new Map();

/**
 * Reset daily stats if new day
 */
function ensureDailyStatsReset(strategy: Strategy): void {
  const today = getNowInPXTimezone().toFormat('yyyy-MM-dd');
  const stats = dailyStats.get(strategy);

  if (!stats || stats.lastResetDate !== today) {
    dailyStats.set(strategy, {
      todayPnL: 0,
      tradesToday: 0,
      lastResetDate: today,
    });
    logger.info(`Reset daily stats for ${strategy} strategy - new day`);
  }
}

/**
 * Get daily stats for a strategy
 */
function getDailyStats(strategy: Strategy): DailyStats {
  ensureDailyStatsReset(strategy);
  return dailyStats.get(strategy) || { todayPnL: 0, tradesToday: 0, lastResetDate: getNowInPXTimezone().toFormat('yyyy-MM-dd') };
}

/**
 * Update daily stats
 */
function updateDailyStats(strategy: Strategy, tradesIncrement: number = 0, pnlDelta: number = 0): void {
  const stats = getDailyStats(strategy);
  stats.tradesToday += tradesIncrement;
  stats.todayPnL += pnlDelta;
}

/**
 * Simulate account equity (for v1; should get from broker/MT5 in production)
 */
function getAccountEquity(): number {
  // In v1, use a mock account equity
  // TODO: Get from MT5 Connector or broker API
  return parseFloat(process.env.MOCK_ACCOUNT_EQUITY || '10000');
}

/**
 * Convert price distance to pips based on symbol type
 * This is a simplified conversion for demo purposes
 */
function convertPriceDistanceToPips(symbol: string, priceDistance: number): number {
  symbol = symbol.toUpperCase();
  
  // Forex pairs (EURUSD, GBPUSD): 1 pip = 0.0001 (4 decimal places)
  if (symbol === 'EURUSD' || symbol === 'GBPUSD') {
    return priceDistance / 0.0001; // Convert to pips
  }
  
  // XAUUSD (Gold): 1 pip = 0.1 (1 decimal place typically, but can be 2)
  if (symbol === 'XAUUSD' || symbol === 'GOLD') {
    return priceDistance / 0.1; // Convert to pips
  }
  
  // US30: 1 point = 1.0
  if (symbol === 'US30' || symbol === 'DOW') {
    return priceDistance; // Already in points
  }
  
  // Default: assume forex-like (0.0001 per pip)
  // This is a fallback for unknown symbols
  return priceDistance / 0.0001;
}

/**
 * Process a trading decision for a symbol and strategy
 */
async function processTradingDecision(
  symbol: string,
  strategy: Strategy
): Promise<TradeDecisionLog> {
  const timestamp = getNowInPXTimezone().toISO()!;
  const accountEquity = getAccountEquity();
  const stats = getDailyStats(strategy);

  // Build risk context
    const riskContext: RiskContext = {
      strategy,
      account_equity: accountEquity,
      today_realized_pnl: stats.todayPnL,
      trades_taken_today: stats.tradesToday,
      guardrail_mode: 'normal', // Will be updated after guardrail check
      symbol, // v15: Pass symbol for per-symbol risk overrides
    };

  // Step 1: Check guardrail
  logger.debug(`[${symbol}] Checking guardrail for ${strategy} strategy...`);
  const guardrailDecision = await guardrailService.getDecision(strategy);
  riskContext.guardrail_mode = guardrailDecision.mode;

  // Build initial decision log
  const decisionLog: TradeDecisionLog = {
    timestamp,
    symbol,
    strategy,
    guardrail_mode: guardrailDecision.mode,
    guardrail_reason: guardrailDecision.reason_summary,
    decision: 'skip', // Default to skip
    risk_score: guardrailDecision.active_windows[0]?.risk_score || null,
    // Initialize execution filter fields (will be set by v3 filter or remain null)
    execution_filter_action: null,
    execution_filter_reasons: null,
  };

  // Fail-safe: Block if guardrail says no
  if (!guardrailDecision.can_trade || guardrailDecision.mode === 'blocked') {
    decisionLog.risk_reason = `Guardrail blocked: ${guardrailDecision.reason_summary}`;
    await decisionLogger.logDecision(decisionLog);
    return decisionLog;
  }

  // Step 2: Get trade signal from strategy
  logger.debug(`[${symbol}] Generating signal...`);
  const signal = await strategyService.generateSignal(symbol);

  if (!signal) {
    // Check if this was an internal error vs "no setup"
    // Note: StrategyService.getLastStrategyError() is public method that returns error message if one occurred
    let strategyError: string | null = null;
    if ('getLastStrategyError' in strategyService && typeof (strategyService as any).getLastStrategyError === 'function') {
      strategyError = (strategyService as any).getLastStrategyError();
    }
    
    if (strategyError) {
      decisionLog.signal_reason = `strategy_error: ${strategyError}`;
      // Log as risk_reason for visibility (execution filter fields remain null - error occurred before filter)
      decisionLog.risk_reason = `Strategy service error: ${strategyError}`;
    } else {
      // Try to get detailed SMC rejection reason
      let smcReason: string | null = null;
      if ('getLastSmcReason' in strategyService && typeof (strategyService as any).getLastSmcReason === 'function') {
        smcReason = (strategyService as any).getLastSmcReason();
      }
      
      if (smcReason) {
        // Use detailed SMC rejection reason
        decisionLog.signal_reason = smcReason;
      } else if (config.useSMCV2) {
        // Fallback for SMC v2 when no specific reason available
        decisionLog.signal_reason = 'No valid SMC setup found (check SMC_DEBUG logs for details)';
        
        // Log helpful message for debugging
        const smcDebug = process.env.SMC_DEBUG === 'true';
        if (!smcDebug && symbol === 'XAUUSD') {
          logger.info(`[${symbol}] No SMC setup found. Set SMC_DEBUG=true to see detailed rejection reasons.`);
        }
      } else {
        // Fallback for v1 or when SMC v2 is disabled
        decisionLog.signal_reason = 'No valid SMC setup found';
      }
    }
    await decisionLogger.logDecision(decisionLog);
    return decisionLog;
  }

  decisionLog.signal_reason = signal.reason;
  
  // Log setup found
  if (symbol === 'XAUUSD') {
    logger.info(
      `[${symbol}] ✅ SMC SETUP FOUND: ${signal.direction.toUpperCase()} @ ${signal.entry.toFixed(2)}, ` +
      `SL=${signal.stopLoss.toFixed(2)}, TP=${signal.takeProfit.toFixed(2)}, ` +
      `reason: ${signal.reason}`
    );
  }

  // Step 2.5: v13 ML Alpha Layer (if enabled)
  let mlDecision: import('./ml/types').MLDecision | null = null;
  let regime: import('./ml/types').RegimeType = 'ranging';
  let features: import('./ml/types').FeatureVector = {};
  let mlScore: import('./ml/types').MLSignalScore | null = null;

  // Import ML services (conditional to avoid circular dependencies)
  const { getMLConfig } = await import('./ml/MLConfig');
  const mlConfig = getMLConfig();

  if (mlConfig.enabled) {
    try {
      // Import ML services dynamically
      const { RegimeDetector } = await import('./ml/RegimeDetector');
      const { FeatureBuilder } = await import('./ml/FeatureBuilder');
      const { MLDecisionService } = await import('./ml/MLDecisionService');
      const { MLModelLightGBM } = await import('./ml/MLModelLightGBM');
      const { MLModelONNX } = await import('./ml/MLModelONNX');
      const { FeatureStore } = await import('./ml/FeatureStore');

      // Initialize ML services (singleton pattern - initialize once)
      if (!(global as any).mlServices) {
        const regimeDetector = new RegimeDetector(candleStore, priceFeed);
        const featureBuilder = new FeatureBuilder(candleStore, priceFeed);
        const featureStore = new FeatureStore(config.databaseUrl);
        
        // Load ML model
        let mlModel: import('./ml/MLModelInterface').MLModelInterface | null = null;
        try {
          if (mlConfig.modelType === 'lightgbm') {
            mlModel = new MLModelLightGBM();
            await mlModel.loadModel(mlConfig.modelPath);
          } else if (mlConfig.modelType === 'onnx') {
            mlModel = new MLModelONNX();
            await mlModel.loadModel(mlConfig.modelPath);
          }
        } catch (error) {
          logger.error('[ML] Failed to load ML model', error);
          mlModel = null;
        }

        const mlDecisionService = new MLDecisionService(mlModel);
        mlDecisionService.setModel(mlModel);

        (global as any).mlServices = {
          regimeDetector,
          featureBuilder,
          mlDecisionService,
          featureStore,
        };
        logger.info('[ML] ML services initialized');
      }

      const mlServices = (global as any).mlServices;

      // Detect regime
      regime = await mlServices.regimeDetector.detect(symbol);

      // Convert signal to RawSignal for ML evaluation (reuse existing conversion logic)
      let rawSignalForML: import('./strategy/v3/types').RawSignal | null = null;
      if (config.useExecutionFilterV3) {
        try {
          // Check for HTF trend in multiple possible locations (v1 uses htf_trend, v2 uses htfTrend)
          const htfTrendFromMeta = signal.meta?.htfTrend || signal.meta?.htf_trend || 'bullish';
          const htfTrend = htfTrendFromMeta === 'sideways' ? 'range' : htfTrendFromMeta;
          rawSignalForML = convertToRawSignal(
            signal,
            htfTrend as any,
            config.smcTimeframes.htf,
            config.smcTimeframes.ltf
          );
        } catch (error) {
          logger.warn(`[ML] Failed to convert signal for ML evaluation: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Build features
      const candles = candleStore.getCandles(symbol, 50);
      const currentTick = priceFeed.getLatestTick(symbol);
      const smcMetadata = rawSignalForML?.smcMetadata || signal.meta;

      features = await mlServices.featureBuilder.buildFeatures({
        symbol,
        signal: rawSignalForML || signal,
        candles: candles.map(c => ({
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 0,
          timestamp: c.startTime.getTime(),
        })),
        currentTick,
        smcMetadata,
        regime,
      });

      // Get ML prediction
      if (mlServices.mlDecisionService) {
        try {
          mlScore = await mlServices.mlDecisionService.mlModel?.predict(features) || null;
        } catch (error) {
          logger.error('[ML] Failed to get ML prediction', error);
        }
      }

      // Evaluate ML decision
      mlDecision = await mlServices.mlDecisionService.evaluate(
        rawSignalForML,
        regime,
        features,
        mlScore
      );

      // Store features for retraining
      if (mlServices.featureStore && mlScore) {
        await mlServices.featureStore.storeFeatures(
          symbol,
          features,
          regime,
          mlScore,
          signal.direction === 'buy' ? 'buy' : 'sell'
        );
      }

      // If ML decision fails, skip trade
      if (mlDecision && !mlDecision.mlPass) {
        decisionLog.ml_pass = false;
        decisionLog.ml_score = mlScore ? {
          probabilityWin: mlScore.probabilityWin,
          probabilitySL: mlScore.probabilitySL,
          probabilityTP: mlScore.probabilityTP,
          expectedMove: mlScore.expectedMove,
          confidence: mlScore.confidence,
        } : null;
        decisionLog.ml_reasons = mlDecision.mlReasons;
        decisionLog.regime = regime;
        decisionLog.features = mlConfig.debug ? features : undefined;
        decisionLog.risk_reason = `ML Alpha Layer: ${mlDecision.mlReasons.join('; ')}`;
        decisionLog.decision = 'skip';
        await decisionLogger.logDecision(decisionLog);
        return decisionLog;
      }

      // ML passed - continue to risk checks
      if (mlDecision) {
        decisionLog.ml_pass = true;
        decisionLog.ml_score = mlScore ? {
          probabilityWin: mlScore.probabilityWin,
          probabilitySL: mlScore.probabilitySL,
          probabilityTP: mlScore.probabilityTP,
          expectedMove: mlScore.expectedMove,
          confidence: mlScore.confidence,
        } : null;
        decisionLog.ml_reasons = mlDecision.mlReasons;
        decisionLog.regime = regime;
        decisionLog.features = mlConfig.debug ? features : undefined;
      }
      
      logger.debug(`[${symbol}] ML Alpha Layer PASSED: regime=${regime}, confidence=${mlScore?.confidence.toFixed(3) || 'N/A'}`);
    } catch (error) {
      logger.error(`[ML] ML evaluation failed for ${symbol}`, error);
      // On ML error, continue without ML (backward compatible)
      decisionLog.ml_pass = null;
      decisionLog.ml_reasons = [`ML evaluation error: ${error instanceof Error ? error.message : String(error)}`];
    }
  } else {
    // ML disabled - skip ML checks
    decisionLog.ml_pass = null;
  }

  // Step 3: Check spread
  const spread = await marketDataService.getCurrentSpread(symbol);
  const spreadPips = convertPriceDistanceToPips(symbol, spread);
  
  // Skip old RiskService spread check if Execution Filter v3 is enabled
  // (Execution Filter already handles per-symbol spread checks)
  if (!config.useExecutionFilterV3 && !riskService.isSpreadAcceptable(symbol, spread)) {
    decisionLog.risk_reason = `Spread too wide: ${spread} > ${config.maxSpread}`;
    await decisionLogger.logDecision(decisionLog);
    return decisionLog;
  }

  // Step 4: Check risk constraints
  const riskCheck = riskService.canTakeNewTrade(riskContext);
  if (!riskCheck.allowed) {
    decisionLog.risk_reason = riskCheck.reason || 'Risk check failed';
    await decisionLogger.logDecision(decisionLog);
    return decisionLog;
  }

  // Step 5: v3 Execution Filter (if enabled)
  if (config.useExecutionFilterV3) {
    try {
      // Convert v2 TradeSignal to v3 RawSignal
      // Extract HTF trend from signal metadata (populated by StrategyService)
      // Check for HTF trend in multiple possible locations (v1 uses htf_trend, v2 uses htfTrend)
      const htfTrendFromMeta = signal.meta?.htfTrend || signal.meta?.htf_trend || 'bullish';
      const htfTrend = htfTrendFromMeta === 'sideways' ? 'range' : htfTrendFromMeta;
      
      // Convert signal to v3 format - throws if conversion fails (caught by outer try-catch)
      let rawSignal;
      try {
        rawSignal = convertToRawSignal(
          signal,
          htfTrend as any,
          config.smcTimeframes.htf,
          config.smcTimeframes.ltf
        );

        // Log RawSignal for debugging v3 flow
        logger.debug(`[${symbol}] Converted to RawSignal for v3 ExecutionFilter`, {
          symbol: rawSignal.symbol,
          direction: rawSignal.direction,
          entryPrice: rawSignal.entryPrice,
          strategyName: rawSignal.strategyName,
          htfTrend: rawSignal.timeframeContext.htfTrend,
          hasLiquiditySweep: rawSignal.smcMetadata?.liquiditySwept,
          hasDisplacement: rawSignal.smcMetadata?.displacementCandle,
        });
      } catch (conversionError) {
        // Signal conversion failed - treat as strategy error
        const errorMsg = conversionError instanceof Error ? conversionError.message : String(conversionError);
        logger.error(`[${symbol}] Failed to convert TradeSignal to RawSignal: ${errorMsg}`, {
          symbol,
          errorMessage: errorMsg,
          stack: conversionError instanceof Error ? conversionError.stack : undefined,
        });
        decisionLog.signal_reason = `strategy_error: Signal conversion failed: ${errorMsg}`;
        decisionLog.risk_reason = `Signal conversion error: ${errorMsg}`;
        await decisionLogger.logDecision(decisionLog);
        return decisionLog;
      }

      // Get execution filter context
      const todayTradeCount = await executionFilterState.getTodayTradeCount(symbol, strategy);
      const lastTradeAt = await executionFilterState.getLastTradeTimestamp(symbol, strategy);
      const openTrades = await executionFilterState.getOpenTradeCount(symbol);
      
      // Get current price and daily high/low (if available from candle store)
      const latestTick = priceFeed.getLatestTick(symbol);
      const currentPrice = latestTick?.mid || signal.entry;
      
      // TODO: Get daily high/low from candle store when available
      // For now, skip distance from high/low check

      const executionContext = {
        guardrailMode: guardrailDecision.mode,
        spreadPips,
        now: new Date(),
        openTradesForSymbol: openTrades,
        todayTradeCountForSymbolStrategy: todayTradeCount,
        lastTradeAtForSymbolStrategy: lastTradeAt,
        currentPrice,
      };

      // Evaluate execution filter (v3 + v4 exposure checks + v15 loss streak filter)
      const executionDecision = await evaluateExecution(
        rawSignal,
        executionFilterConfig,
        executionContext,
        openTradesService, // Pass OpenTradesService for v4 exposure checks
        orderFlowService, // v14: Pass order flow service
        executionFilterState, // Pass ExecutionFilterState for DB-based exposure queries as fallback
        lossStreakFilterService // v15: Pass Loss Streak Filter Service for loss streak checks
      );

      // If execution filter says SKIP, do not proceed
      if (executionDecision.action === 'SKIP') {
        decisionLog.execution_filter_action = 'skip';
        decisionLog.execution_filter_reasons = executionDecision.reasons;
        decisionLog.risk_reason = `v3 Execution Filter: ${executionDecision.reasons.join('; ')}`;
        await decisionLogger.logDecision(decisionLog);
        return decisionLog;
      }

      // Filter passed - mark as 'pass' for successful trade
      decisionLog.execution_filter_action = 'pass';
      decisionLog.execution_filter_reasons = [];
      logger.debug(`[${symbol}] v3 Execution Filter PASSED`);

      // Step 5.5: v12 Multi-Account Execution (if enabled)
      if (accountRegistry.isMultiAccountMode()) {
        // Use distributed orchestrator for multi-account execution
        const executionContext: ExecutionFilterContext = {
          guardrailMode: guardrailDecision.mode,
          spreadPips,
          now: new Date(),
          openTradesForSymbol: openTrades,
          todayTradeCountForSymbolStrategy: todayTradeCount,
          lastTradeAtForSymbolStrategy: lastTradeAt,
          currentPrice,
        };

        const aggregatedResult = await distributedOrchestrator.execute(
          rawSignal,
          executionContext,
          guardrailDecision.mode,
          strategy
        );

        // Log aggregated results
        decisionLog.kill_switch_active = false;
        decisionLog.kill_switch_reasons = [];

        if (aggregatedResult.tradedAccounts.length > 0) {
          decisionLog.decision = 'trade';
          decisionLog.execution_result = {
            success: true,
            ticket: aggregatedResult.tradedAccounts.length > 0 ? undefined : undefined, // Multiple tickets - stored per account
          };
          (decisionLog as any).multiAccountResult = aggregatedResult;
          
          // Update stats
          updateDailyStats(strategy, aggregatedResult.tradedAccounts.length, 0);

          // Store exit plans for successful trades
          for (const result of aggregatedResult.results) {
            if (result.success && result.ticket) {
              try {
                const exitPlan: import('@providencex/shared-types').ExitPlan = {
                  symbol,
                  entry_price: rawSignal.entryPrice,
                  stop_loss_initial: rawSignal.sl,
                  tp1: rawSignal.tp,
                  break_even_trigger: 20,
                  partial_close_percent: 50,
                  trail_mode: 'fixed_pips',
                  trail_value: 20,
                  time_limit_seconds: 5400, // v15: 90 minutes (5400 seconds)
                };
                // TODO: Map account decision to decision_id for exit plan storage
                // For now, exit plans will be stored per account in v12
              } catch (error) {
                logger.error(`[MultiAccount] Failed to store exit plan for account ${result.accountId}`, error);
              }
            }
          }
        } else {
          // All accounts skipped/failed
          const allReasons = aggregatedResult.skippedAccounts.map((a: { accountId: string; reason: string }) => `${a.accountId}: ${a.reason}`);
          decisionLog.risk_reason = `Multi-account execution: ${allReasons.join('; ')}`;
          decisionLog.decision = 'skip';
        }

        const decisionId = await decisionLogger.logDecision(decisionLog);
        return decisionLog;
      }

      // Step 5.5: v8 Kill Switch (after execution filter passes) - single-account mode
      const killSwitchResult = await killSwitchService.evaluate({
        symbol,
        strategy,
        latestTick,
        exposureSnapshot: openTradesService.getSnapshotForSymbol(symbol) || undefined,
        globalExposure: openTradesService.getGlobalSnapshot(),
        now: new Date(),
      });

      if (killSwitchResult.blocked) {
        decisionLog.kill_switch_active = true;
        decisionLog.kill_switch_reasons = killSwitchResult.reasons;
        decisionLog.risk_reason = `Kill Switch: ${killSwitchResult.reasons.join('; ')}`;
        await decisionLogger.logDecision(decisionLog);
        return decisionLog;
      }

      decisionLog.kill_switch_active = false;
      decisionLog.kill_switch_reasons = [];
    } catch (error) {
      // Safe fallback: if filter errors, SKIP the trade
      logger.error(`[${symbol}] Execution filter error, skipping trade`, error);
      decisionLog.execution_filter_action = 'skip';
      decisionLog.execution_filter_reasons = ['Execution filter error'];
      decisionLog.risk_reason = 'Execution filter error';
      await decisionLogger.logDecision(decisionLog);
      return decisionLog;
    }
  } else {
    // v3 execution filter disabled - set null values for backward compatibility
    decisionLog.execution_filter_action = null;
    decisionLog.execution_filter_reasons = null;

    // Still check kill switch even if v3 filter is disabled
    const latestTickForKillSwitch = priceFeed.getLatestTick(symbol);
    const killSwitchResult = await killSwitchService.evaluate({
      symbol,
      strategy,
      latestTick: latestTickForKillSwitch,
      exposureSnapshot: openTradesService.getSnapshotForSymbol(symbol) || undefined,
      globalExposure: openTradesService.getGlobalSnapshot(),
      now: new Date(),
    });

    if (killSwitchResult.blocked) {
      decisionLog.kill_switch_active = true;
      decisionLog.kill_switch_reasons = killSwitchResult.reasons;
      decisionLog.risk_reason = `Kill Switch: ${killSwitchResult.reasons.join('; ')}`;
      await decisionLogger.logDecision(decisionLog);
      return decisionLog;
    }

    decisionLog.kill_switch_active = false;
    decisionLog.kill_switch_reasons = [];
  }

  // Step 6: Calculate position size
  const stopLossDistance = Math.abs(signal.entry - signal.stopLoss);
  const stopLossPips = convertPriceDistanceToPips(symbol, stopLossDistance);
  const lotSize = riskService.getPositionSize(riskContext, stopLossPips, signal.entry);

  if (lotSize <= 0) {
    decisionLog.risk_reason = `Invalid lot size calculated: ${lotSize}`;
    await decisionLogger.logDecision(decisionLog);
    return decisionLog;
  }

  // Step 7: Execute trade
  logger.info(`[${symbol}] Executing trade: ${signal.direction} @ ${signal.entry}, lot: ${lotSize}`);
  const executionResult = await executionService.openTrade(signal, lotSize, strategy);

  // Step 8: Update stats and log decision
  if (executionResult.success) {
    decisionLog.decision = 'trade';
    // If v3 filter was enabled and passed, set action to 'pass'
    if (config.useExecutionFilterV3) {
      // If we got here, filter must have passed (SKIP would have returned earlier)
      decisionLog.execution_filter_action = 'pass';
      decisionLog.execution_filter_reasons = [];
    } else {
      // Filter disabled - keep null for backward compatibility
      decisionLog.execution_filter_action = null;
      decisionLog.execution_filter_reasons = null;
    }
    updateDailyStats(strategy, 1, 0); // Trade opened (PnL will update when closed)
    decisionLog.trade_request = {
      direction: signal.direction,
      entry: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      lotSize,
    };
  } else {
    decisionLog.risk_reason = `Execution failed: ${executionResult.error}`;
  }

  decisionLog.execution_result = executionResult;
  const decisionId = await decisionLogger.logDecision(decisionLog);

  // Step 9: Store exit plan for successful trades (v9)
  if (executionResult.success && decisionId && executionResult.ticket) {
    try {
      // Calculate 1R in pips for break-even trigger (v15 improvement)
      const riskAmount = Math.abs(signal.entry - signal.stopLoss);
      const convertPriceDistanceToPips = (sym: string, distance: number): number => {
        const upperSym = sym.toUpperCase();
        if (upperSym === 'XAUUSD' || upperSym === 'GOLD') {
          return distance * 100; // Gold: 0.01 = 1 pip
        }
        if (upperSym.includes('30') || upperSym.includes('100') || upperSym.includes('500')) {
          return distance; // Indices: 1.0 = 1 pip
        }
        if (upperSym.length === 6 && upperSym.match(/^[A-Z]{6}$/)) {
          return distance * 10000; // Forex: 0.0001 = 1 pip
        }
        return distance * 10000; // Default: forex-style
      };
      const oneRInPips = convertPriceDistanceToPips(symbol, riskAmount);
      
      const exitPlan: import('@providencex/shared-types').ExitPlan = {
        symbol,
        entry_price: signal.entry,
        stop_loss_initial: signal.stopLoss,
        tp1: signal.takeProfit, // Use signal TP as TP1 (adaptive TP from SMC v2)
        break_even_trigger: oneRInPips, // v15: Use 1R instead of fixed 20 pips
        partial_close_percent: 50, // Default: 50% at TP1
        trail_mode: 'fixed_pips', // Default: fixed pips trailing
        trail_value: 20, // Default: 20 pips trail
        time_limit_seconds: 5400, // v15: 90 minutes (5400 seconds) instead of 24 hours
      };
      
      logger.debug(
        `[${symbol}] Exit plan created: TP=${signal.takeProfit.toFixed(2)}, ` +
        `BE trigger=${oneRInPips.toFixed(2)} pips (1R), ` +
        `time limit=${(5400 / 60).toFixed(0)} minutes`
      );

      const exitPlanId = await exitService.storeExitPlan(decisionId, exitPlan);
      if (exitPlanId) {
        logger.debug(`[ExitService] Stored exit plan ${exitPlanId} for decision ${decisionId}, ticket ${executionResult.ticket}`);
      }
    } catch (error) {
      logger.error(`[ExitService] Failed to store exit plan for decision ${decisionId}`, error);
      // Don't fail the trade execution if exit plan storage fails
    }
  }

  return decisionLog;
}

/**
 * Tick loop - processes trading decisions for all symbols
 */
async function tickLoop(): Promise<void> {
  try {
    logger.debug('Tick loop started');

    // Reset daily stats if needed
    ensureDailyStatsReset('low');
    ensureDailyStatsReset('high');

    // For v1: Process all symbols with low-risk strategy
    // In production, this could be configurable per symbol
    for (const symbol of config.symbols) {
      try {
        await processTradingDecision(symbol, 'low');
      } catch (error) {
        logger.error(`Error processing ${symbol}`, error);
      }
    }

    logger.debug('Tick loop completed');
  } catch (error) {
    logger.error('Error in tick loop', error);
  }
}

/**
 * Start the server
 */
async function start(): Promise<void> {
  try {
    // Start Express server
    app.listen(config.port, () => {
      logger.info(`Trading Engine service started on port ${config.port}`);
      logger.info(`Target symbols: ${config.symbols.join(', ')}`);
      logger.info(`News Guardrail URL: ${config.newsGuardrailUrl}`);
      logger.info(`MT5 Connector URL: ${config.mt5ConnectorUrl}`);
      logger.info(`Tick interval: ${config.tickIntervalSeconds} seconds`);
      logger.info(`SMC timeframes: HTF=${config.smcTimeframes.htf}, LTF=${config.smcTimeframes.ltf}`);

      // Run historical backfill (non-blocking, but wait for it before starting tick loop)
      logger.info('[HistoricalBackfill] Starting historical backfill...');
      historicalBackfillService
        .backfillAll()
        .then(() => {
          logger.info('[HistoricalBackfill] Historical backfill completed');
        })
        .catch((error) => {
          logger.error('[HistoricalBackfill] Backfill failed', { error });
          // Continue anyway - engine can run with partial history
        })
        .finally(() => {
          // Start tick loop after backfill completes (or fails)
          logger.info('Starting tick loop...');
          setInterval(() => {
            tickLoop().catch((error) => {
              logger.error('Unhandled error in tick loop', error);
            });
          }, config.tickIntervalSeconds * 1000);

          // Run first tick immediately (after a short delay)
          setTimeout(() => {
            tickLoop().catch((error) => {
              logger.error('Error in initial tick', error);
            });
          }, 5000); // Wait 5 seconds for services to be ready
        });

      // Start v4 Open Trades Service
      openTradesService.start();
      logger.info('v4 OpenTradesService started');

      // Start v7 Live PnL Service
      livePnlService.start();
      logger.info('v7 LivePnlService started');

      // Start v9 Exit Service
      exitService.start();
      logger.info('v9 ExitService started');

      logger.info('Trading Engine v7/v8/v9 initialized and running');
    });

        // Graceful shutdown handlers
        const shutdown = async (signal: string) => {
          logger.info(`${signal} received, shutting down gracefully...`);
          priceFeed.stop();
          if (orderFlowService.isServiceRunning()) {
            orderFlowService.stop();
          }
          openTradesService.stop();
          livePnlService.stop();
          exitService.stop();
          await orderEventService.close();
          await livePnlService.close();
          await killSwitchService.close();
          await exitService.close();
          await executionFilterState.close();
          await decisionLogger.close();
          process.exit(0);
        };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start service', error);
    process.exit(1);
  }
}

start();

