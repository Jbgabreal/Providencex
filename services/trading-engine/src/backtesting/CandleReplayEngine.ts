/**
 * CandleReplayEngine - Replays historical candles through the strategy pipeline
 * 
 * For each candle:
 * - Feeds candle to CandleStore
 * - Triggers StrategyService.generateSignal()
 * - Converts to RawSignal v3
 * - Runs ExecutionFilter v3
 * - Simulates exposure with v4 logic
 * - Opens simulated position if pass
 * - Checks SL/TP hits
 */

import { Logger } from '@providencex/shared-utils';
import { StrategyService } from '../services/StrategyService';
import { MarketDataService } from '../services/MarketDataService';
import { CandleStore } from '../marketData/CandleStore';
import { Candle as MarketDataCandle } from '../marketData/types';
import { convertToRawSignal } from '../strategy/v3/SignalConverter';
import { evaluateExecution } from '../strategy/v3/ExecutionFilter';
import { executionFilterConfig } from '../config/executionFilterConfig';
import { backtestExecutionFilterConfig } from '../config/backtestExecutionFilterConfig';
import { SimulatedMT5Adapter } from './SimulatedMT5Adapter';
import { SimulatedRiskService } from './SimulatedRiskService';
import { HistoricalCandle, BacktestTrade, SimulatedPosition } from './types';
import { Strategy, RiskContext, RiskCheckResult, GuardrailMode } from '../types';
import { TrendDirection } from '../types';
import { GuardrailDecision } from '../types';
import { ExecutionFilterContext } from '../strategy/v3/types';
import { OpenTradesService } from '../services/OpenTradesService';

const logger = new Logger('Replay');

/**
 * Helper function to convert timeframe string to minutes
 */
function timeframeToMinutes(timeframe: string): number {
  const upper = timeframe.toUpperCase();
  if (upper === 'M1') return 1;
  if (upper === 'M5') return 5;
  if (upper === 'M15') return 15;
  if (upper === 'M30') return 30;
  if (upper === 'H1') return 60;
  if (upper === 'H4') return 240;
  if (upper === 'D1') return 1440;
  // Default to M1 if unknown
  logger.warn(`[Replay] Unknown timeframe: ${timeframe}, defaulting to M1`);
  return 1;
}

export interface ReplayEngineConfig {
  strategy: Strategy;
  executionFilterState?: any; // ExecutionFilterState for v3
  openTradesService?: OpenTradesService; // For v4 exposure checks
  simulatedMT5: SimulatedMT5Adapter;
  simulatedRisk: SimulatedRiskService;
  guardrailMode?: GuardrailMode; // Simulated guardrail mode (default: 'normal')
  dailyTradeCounts?: Map<string, number>; // Optional: share tracking across strategies
  lastTradeTimestamps?: Map<string, number>; // Optional: share tracking across strategies
  // v11 SMC v2 parameter overrides for optimization
  overrideParamSet?: import('../optimization/OptimizationTypes').SMC_V2_ParamSet;
  // Source timeframe of historical data (default: 'M5')
  sourceTimeframe?: string;
}

/**
 * CandleReplayEngine - Replays candles and generates trades
 */
export class CandleReplayEngine {
  private config: ReplayEngineConfig;
  private candleStore: CandleStore;
  private marketDataService: MarketDataService;
  private strategyService: StrategyService;
  private trades: BacktestTrade[] = [];
  private currentBalance: number;
  private dailyTradeCounts: Map<string, number>;
  private lastTradeTimestamps: Map<string, number>;
  // SENIOR DEV: Track signal generation vs blocking for diagnostics
  private signalStats = {
    signalsGenerated: 0,
    signalsBlockedByRisk: 0,
    signalsBlockedByExecutionFilter: 0,
    signalsExecuted: 0,
  };

  constructor(config: ReplayEngineConfig) {
    this.config = config;
    this.currentBalance = config.simulatedMT5.getBalance();
    
    // Initialize or use shared tracking maps
    this.dailyTradeCounts = config.dailyTradeCounts || new Map();
    this.lastTradeTimestamps = config.lastTradeTimestamps || new Map();

    // Initialize CandleStore and services
    // Increase max candles to handle expanded M1 candles from higher timeframes
    // For example: 1000 M5 candles → 5000 M1 candles, 1000 M15 → 15000 M1
    const sourceTimeframe = config.sourceTimeframe || 'M5';
    const tfMinutes = timeframeToMinutes(sourceTimeframe);
    const maxCandles = Math.max(1000 * tfMinutes, 12000); // Ensure enough for H4 aggregation (50 H4 = 12000 M1)
    this.candleStore = new CandleStore(maxCandles);
    
    if (sourceTimeframe !== 'M1') {
      logger.info(`[Replay] Source timeframe: ${sourceTimeframe} (${tfMinutes} minutes) - will expand to M1 candles`);
    }
    
    // Pass CandleStore to MarketDataService so it can read from it
    this.marketDataService = new MarketDataService(this.candleStore);
    // v11: Pass parameter overrides to StrategyService for optimization
    this.strategyService = new StrategyService(
      this.marketDataService,
      config.overrideParamSet
    );
    
    logger.info(`[Replay] Initialized for strategy: ${config.strategy}`);
  }

  /**
   * Process a single candle through the replay engine
   * Expands higher-timeframe candles (M5, M15, H1, etc.) into M1 candles
   * to ensure the strategy has enough data for H4 aggregation
   */
  async processCandle(
    historicalCandle: HistoricalCandle,
    guardrailDecision: GuardrailDecision = {
      can_trade: true,
      mode: (this.config.guardrailMode as GuardrailMode) || 'normal',
      active_windows: [],
      reason_summary: 'Normal mode',
    }
  ): Promise<void> {
    const { symbol } = historicalCandle;

    // SENIOR DEV FIX: If source is already M1, use it directly - no expansion needed
    // This ensures we use real price action data, not synthetic/expanded candles
    const sourceTimeframe = this.config.sourceTimeframe || 'M1';
    const tfMinutes = timeframeToMinutes(sourceTimeframe);

    if (tfMinutes === 1) {
      // Already M1 - use directly (deterministic, real data)
      const marketDataCandle: MarketDataCandle = {
        symbol,
        timeframe: 'M1',
        open: historicalCandle.open,
        high: historicalCandle.high,
        low: historicalCandle.low,
        close: historicalCandle.close,
        volume: historicalCandle.volume,
        startTime: new Date(historicalCandle.timestamp),
        endTime: new Date(historicalCandle.timestamp + 60_000),
      };
      this.candleStore.addCandle(marketDataCandle);
      // CRITICAL BUG FIX: Don't return early - continue to signal generation below
      // Previously this returned early, preventing ALL signal generation for M1 data
    } else {
      // Fallback: Expand higher-timeframe candles only if we somehow get non-M1 data
      // This should rarely happen now that we force M1 loading
      logger.warn(`[Replay] ⚠️  Non-M1 candle detected (${sourceTimeframe}) - expanding to M1 (this should not happen with M1 data source)`);
      
      for (let i = 0; i < tfMinutes; i++) {
        const startTime = new Date(historicalCandle.timestamp + i * 60_000);
        const endTime = new Date(startTime.getTime() + 60_000);
        
        const marketDataCandle: MarketDataCandle = {
          symbol,
          timeframe: 'M1',
          open: historicalCandle.open,
          high: historicalCandle.high,
          low: historicalCandle.low,
          close: historicalCandle.close,
          volume: historicalCandle.volume / tfMinutes,
          startTime,
          endTime,
        };
        
        this.candleStore.addCandle(marketDataCandle);
      }
    }

    // Check for SL/TP hits on existing positions first
    const slTpHits = this.config.simulatedMT5.checkStopLossTakeProfit(historicalCandle);
    for (const hit of slTpHits) {
      const exitResult = this.config.simulatedMT5.closeTrade(
        hit.ticket,
        hit.exitPrice,
        historicalCandle.timestamp
      );

      if (exitResult.success && exitResult.profit !== undefined) {
        // Record trade completion
        const dateStr = new Date(historicalCandle.timestamp).toISOString().split('T')[0];
        this.config.simulatedRisk.recordTradeCompletion(
          dateStr,
          exitResult.profit,
          this.config.simulatedMT5.getBalance()
        );

        // Create BacktestTrade record
        const position = this.config.simulatedMT5.getOpenPositions().find(
          p => p.ticket === hit.ticket
        );
        // Position should be closed, so get from closed trades
        const closedTrades = this.config.simulatedMT5.getClosedTrades();
        const closedTrade = closedTrades[closedTrades.length - 1]; // Last closed

        if (closedTrade) {
          this.trades.push(this.createBacktestTrade(closedTrade, this.config.strategy));
        }

        this.currentBalance = this.config.simulatedMT5.getBalance();
      }
    }

    // SENIOR DEV: Log guardrail status to diagnose why no signals are generated
    const candleTime = new Date(historicalCandle.timestamp).toISOString();
    const debugMode = process.env.SMC_DEBUG === 'true' || process.env.SMC_DEBUG_MINIMAL_ENTRY === 'true';
    const backtestDebugMode = process.env.BACKTEST_DEBUG === 'true';
    
    // Count signal attempts (before guardrail check)
    const signalAttemptCount = this.signalStats.signalsGenerated + this.signalStats.signalsBlockedByRisk + this.signalStats.signalsBlockedByExecutionFilter;
    const shouldLogSignalAttempt = backtestDebugMode || debugMode || signalAttemptCount < 50 || this.trades.length < 5;
    
    // SENIOR DEV: Always log guardrail blocks (first 20) to see if this is the issue
    if (!guardrailDecision.can_trade) {
      if (shouldLogSignalAttempt || signalAttemptCount < 20) {
        logger.warn(`[Replay] ${symbol} @ ${candleTime}: 🚫 BLOCKED by guardrail (mode: ${guardrailDecision.mode}) - ${guardrailDecision.reason_summary || 'No reason'}`);
      }
      return; // Guardrail blocking - skip signal generation
    }

    // Generate signal from strategy
    const signal = await this.strategyService.generateSignal(symbol);

    if (!signal) {
      // SENIOR DEV: Always log rejection reasons (first 100 attempts) to diagnose why no trades
      const rejectionReason = this.strategyService.getLastSmcReason();
      if (shouldLogSignalAttempt || signalAttemptCount < 100) {
        if (rejectionReason) {
          logger.warn(`[Replay] ${symbol} @ ${candleTime}: ❌ Signal REJECTED by Strategy [attempt ${signalAttemptCount + 1}] - ${rejectionReason}`);
        } else {
          logger.warn(`[Replay] ${symbol} @ ${candleTime}: ❌ Signal REJECTED by Strategy [attempt ${signalAttemptCount + 1}] - No reason provided`);
        }
      }
      return; // No valid setup
    }
    
    // SENIOR DEV: Always log when signal is generated (critical for backtesting)
    this.signalStats.signalsGenerated++;
    logger.info(`[Replay] ${symbol} @ ${candleTime}: ✅ Signal GENERATED [${this.signalStats.signalsGenerated}] - ${signal.direction.toUpperCase()} @ ${signal.entry.toFixed(2)} (SL: ${signal.stopLoss.toFixed(2)}, TP: ${signal.takeProfit.toFixed(2)})`);

    // Check risk constraints
    const riskContext: RiskContext = {
      strategy: this.config.strategy,
      account_equity: this.currentBalance,
      today_realized_pnl: 0, // Will be updated per day
      trades_taken_today: 0, // Will be updated per day
      guardrail_mode: guardrailDecision.mode as any,
    };

    const riskCheck = this.config.simulatedRisk.canTakeNewTrade(riskContext, this.currentBalance);
    if (!riskCheck.allowed) {
      // SENIOR DEV: Always log risk check blocks in backtesting
      this.signalStats.signalsBlockedByRisk++;
      logger.warn(`[Replay] ${symbol} @ ${candleTime}: ⚠️ Risk check BLOCKED [${this.signalStats.signalsBlockedByRisk}/${this.signalStats.signalsGenerated}] - ${riskCheck.reason || 'Unknown reason'}`);
      return; // Risk check failed
    }

    // Convert to RawSignal v3
    const htfTrend = (signal.meta?.htf_trend || 'bullish') as TrendDirection;
    const rawSignal = convertToRawSignal(
      signal,
      htfTrend,
      'H1', // HTF timeframe (from config)
      'M5'  // LTF timeframe (from config)
    );

    // Get execution filter context
    const executionContext: ExecutionFilterContext = {
      guardrailMode: guardrailDecision.mode,
      spreadPips: 0, // Calculate from candle if needed
      now: new Date(historicalCandle.timestamp),
      openTradesForSymbol: this.config.simulatedMT5.getOpenPositions().filter(
        p => p.symbol.toUpperCase() === symbol.toUpperCase()
      ).length,
      todayTradeCountForSymbolStrategy: 0, // TODO: Track per symbol/strategy
      lastTradeAtForSymbolStrategy: null, // TODO: Track last trade
      currentPrice: historicalCandle.close,
    };

    // SENIOR DEV: Use relaxed execution filter for backtesting
    // Allows us to see if signals are being generated vs blocked by filters
    const useRelaxedFilters = process.env.BACKTEST_RELAXED_FILTERS === 'true' || 
                              process.env.BACKTEST_DEBUG === 'true';
    const filterConfig = useRelaxedFilters ? backtestExecutionFilterConfig : executionFilterConfig;
    
    if (useRelaxedFilters && this.trades.length === 0) {
      logger.info(`[Replay] Using RELAXED execution filters for backtesting (BACKTEST_RELAXED_FILTERS=true)`);
    }
    
    // Evaluate execution filter (v3 + v4)
    const executionDecision = await evaluateExecution(
      rawSignal,
      filterConfig, // Use relaxed config if enabled
      executionContext,
      this.config.openTradesService, // For v4 exposure checks
      undefined, // orderFlowService - not used in backtesting
      this.config.executionFilterState // ExecutionFilterState for v3
    );

    if (executionDecision.action === 'SKIP') {
      // SENIOR DEV: Always log execution filter blocks (this is likely the main blocker)
      this.signalStats.signalsBlockedByExecutionFilter++;
      const reasons = executionDecision.reasons?.join('; ') || 'Unknown reason';
      logger.warn(`[Replay] ${symbol} @ ${candleTime}: ⚠️ Execution filter BLOCKED [${this.signalStats.signalsBlockedByExecutionFilter}/${this.signalStats.signalsGenerated}] - ${reasons}`);
      
      // Log signal details for debugging (only first few or in debug mode)
      if (this.signalStats.signalsBlockedByExecutionFilter <= 5 || backtestDebugMode) {
        logger.warn(`[Replay] Signal details: direction=${signal.direction}, entry=${signal.entry.toFixed(2)}, SL=${signal.stopLoss.toFixed(2)}, TP=${signal.takeProfit.toFixed(2)}`);
        logger.warn(`[Replay] Context: spreadPips=${executionContext.spreadPips}, openTrades=${executionContext.openTradesForSymbol}, price=${executionContext.currentPrice?.toFixed(2) || 'N/A'}`);
      }
      
      return; // Execution filter blocked
    }

    // Calculate position size based on risk
    const riskPercent = riskCheck.adjusted_risk_percent || 0.5;
    const stopLossDistance = Math.abs(signal.entry - signal.stopLoss);
    const riskAmount = (this.currentBalance * riskPercent) / 100;
    
    // Calculate lot size
    // Simplified: lot_size = risk_amount / (stop_loss_distance * contract_size * pip_value)
    const contractSize = this.getContractSize(symbol);
    const pipValue = this.getPipValue(symbol, signal.entry);
    const lotSize = riskAmount / (stopLossDistance * contractSize * pipValue);
    
    // Normalize lot size (min 0.01, max reasonable)
    const normalizedLotSize = Math.max(0.01, Math.min(lotSize, 10.0));
    // Round to 2 decimal places
    const finalLotSize = Math.round(normalizedLotSize * 100) / 100;

    // SENIOR DEV: Track successful trade execution
    this.signalStats.signalsExecuted++;
    
    // Open simulated trade
    const position = this.config.simulatedMT5.openTrade({
      symbol,
      direction: signal.direction,
      volume: finalLotSize,
      entryPrice: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      currentCandle: historicalCandle,
    });
    
    logger.info(`[Replay] ${symbol} @ ${candleTime}: 🎯 TRADE OPENED [${this.signalStats.signalsExecuted}/${this.signalStats.signalsGenerated}] - ${signal.direction.toUpperCase()} ${finalLotSize} lots @ ${signal.entry.toFixed(2)}`);

    // Update trade tracking
    const todayStr = new Date(historicalCandle.timestamp).toISOString().split('T')[0];
    const tradeKey = `${symbol}-${this.config.strategy}`;
    const dailyKey = `${todayStr}-${tradeKey}`;
    
    // Increment today's trade count
    const currentCount = this.dailyTradeCounts.get(dailyKey) || 0;
    this.dailyTradeCounts.set(dailyKey, currentCount + 1);
    
    // Update last trade timestamp
    this.lastTradeTimestamps.set(tradeKey, historicalCandle.timestamp);

    // Always log trade execution
    logger.info(
      `[Replay] ${symbol} @ ${candleTime}: 🎯 TRADE EXECUTED - ${signal.direction.toUpperCase()} ${finalLotSize} lots @ ${signal.entry.toFixed(2)} (ticket: ${position.ticket}, SL: ${signal.stopLoss.toFixed(2)}, TP: ${signal.takeProfit.toFixed(2)})`
    );
  }

  /**
   * Convert closed SimulatedPosition to BacktestTrade
   */
  private createBacktestTrade(
    closedPosition: SimulatedPosition,
    strategy: Strategy
  ): BacktestTrade {
    const durationMs = (closedPosition.closeTime || 0) - closedPosition.openTime;
    const durationMinutes = Math.floor(durationMs / (1000 * 60));

    // Calculate pips moved
    const priceDiff = closedPosition.direction === 'buy'
      ? (closedPosition.closePrice || 0) - closedPosition.entryPrice
      : closedPosition.entryPrice - (closedPosition.closePrice || 0);
    
    const pipValue = this.getPipValue(closedPosition.symbol, closedPosition.entryPrice);
    const pips = priceDiff / pipValue;

    // Calculate Risk:Reward if SL was set
    let riskReward: number | undefined;
    if (closedPosition.sl) {
      const risk = Math.abs(closedPosition.entryPrice - closedPosition.sl);
      const reward = Math.abs((closedPosition.closePrice || 0) - closedPosition.entryPrice);
      if (risk > 0) {
        riskReward = reward / risk;
      }
    }

    return {
      ticket: closedPosition.ticket,
      symbol: closedPosition.symbol,
      direction: closedPosition.direction,
      strategy,
      entryPrice: closedPosition.entryPrice,
      exitPrice: closedPosition.closePrice || closedPosition.entryPrice,
      entryTime: closedPosition.openTime,
      exitTime: closedPosition.closeTime || closedPosition.openTime,
      sl: closedPosition.sl,
      tp: closedPosition.tp,
      volume: closedPosition.volume,
      profit: closedPosition.profit ?? 0,
      durationMinutes,
      pips,
      riskReward,
    };
  }

  /**
   * Get all trades generated during replay
   */
  getTrades(): BacktestTrade[] {
    return [...this.trades];
  }

  /**
   * Get signal generation statistics for diagnostics
   */
  getSignalStats() {
    return { ...this.signalStats };
  }

  /**
   * Get StrategyService instance (for metrics access)
   */
  getStrategyService(): StrategyService {
    return this.strategyService;
  }

  /**
   * Get contract size for symbol (simplified)
   */
  private getContractSize(symbol: string): number {
    const upperSymbol = symbol.toUpperCase();
    if (upperSymbol === 'XAUUSD' || upperSymbol === 'GOLD') {
      return 100; // 1 lot = 100 oz
    }
    if (upperSymbol.includes('USD') && !upperSymbol.includes('XAU')) {
      return 100000; // Forex: 1 lot = 100k
    }
    if (upperSymbol === 'US30') {
      return 1; // Index: 1 lot = 1 contract
    }
    return 100; // Default
  }

  /**
   * Get pip value for symbol (price units per pip)
   */
  private getPipValue(symbol: string, price: number): number {
    const upperSymbol = symbol.toUpperCase();
    if (upperSymbol === 'XAUUSD' || upperSymbol === 'GOLD') {
      return 0.1; // Gold: 1 pip = 0.1
    }
    if (upperSymbol === 'US30') {
      return 1.0; // Index: 1 pip = 1 point
    }
    // Forex: 1 pip = 0.0001 (for most pairs)
    return 0.0001;
  }
}

