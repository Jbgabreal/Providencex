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
import { SimulatedMT5Adapter } from './SimulatedMT5Adapter';
import { SimulatedRiskService } from './SimulatedRiskService';
import { HistoricalCandle, BacktestTrade, SimulatedPosition } from './types';
import { Strategy, RiskContext, RiskCheckResult, GuardrailMode } from '../types';
import { TrendDirection } from '../types';
import { GuardrailDecision } from '../types';
import { ExecutionFilterContext } from '../strategy/v3/types';
import { OpenTradesService } from '../services/OpenTradesService';

const logger = new Logger('Replay');

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

  constructor(config: ReplayEngineConfig) {
    this.config = config;
    this.currentBalance = config.simulatedMT5.getBalance();
    
    // Initialize or use shared tracking maps
    this.dailyTradeCounts = config.dailyTradeCounts || new Map();
    this.lastTradeTimestamps = config.lastTradeTimestamps || new Map();

    // Initialize CandleStore and services
    const maxCandles = 1000; // Keep enough for strategy analysis
    this.candleStore = new CandleStore(maxCandles);
    
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

    // Convert historical candle to MarketData Candle format for CandleStore
    // CandleStore uses marketData/types.ts Candle format
    const candleStartTime = new Date(historicalCandle.timestamp);
    const candleEndTime = new Date(historicalCandle.timestamp + (5 * 60 * 1000)); // M5 = 5 minutes
    
    const marketDataCandle: MarketDataCandle = {
      symbol,
      timeframe: 'M1', // Candle type only supports M1 currently
      open: historicalCandle.open,
      high: historicalCandle.high,
      low: historicalCandle.low,
      close: historicalCandle.close,
      volume: historicalCandle.volume,
      startTime: candleStartTime,
      endTime: candleEndTime,
    };
    
    // Add candle to CandleStore (MarketDataService will read from it)
    this.candleStore.addCandle(marketDataCandle);

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

    // If guardrail blocks, skip signal generation
    if (!guardrailDecision.can_trade) {
      return;
    }

    // Generate signal from strategy
    const signal = await this.strategyService.generateSignal(symbol);

    if (!signal) {
      return; // No valid setup
    }

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

    // Evaluate execution filter (v3 + v4)
    const executionDecision = await evaluateExecution(
      rawSignal,
      executionFilterConfig,
      executionContext,
      this.config.openTradesService, // For v4 exposure checks
      undefined, // orderFlowService - not used in backtesting
      undefined // executionFilterState - not used in backtesting
    );

    if (executionDecision.action === 'SKIP') {
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

    // Update trade tracking
    const todayStr = new Date(historicalCandle.timestamp).toISOString().split('T')[0];
    const tradeKey = `${symbol}-${this.config.strategy}`;
    const dailyKey = `${todayStr}-${tradeKey}`;
    
    // Increment today's trade count
    const currentCount = this.dailyTradeCounts.get(dailyKey) || 0;
    this.dailyTradeCounts.set(dailyKey, currentCount + 1);
    
    // Update last trade timestamp
    this.lastTradeTimestamps.set(tradeKey, historicalCandle.timestamp);

    logger.debug(
      `[Replay] Opened ${signal.direction} ${finalLotSize} lots ${symbol} @ ${signal.entry} (ticket: ${position.ticket})`
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

