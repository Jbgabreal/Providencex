/**
 * BacktestRunner - Main orchestrator for running backtests
 * 
 * Coordinates:
 * - Historical data loading
 * - Candle replay
 * - Statistics calculation
 * - Result storage
 */

import { Logger } from '@providencex/shared-utils';
import { HistoricalDataLoader } from './HistoricalDataLoader';
import { CandleReplayEngine } from './CandleReplayEngine';
import { SimulatedMT5Adapter } from './SimulatedMT5Adapter';
import { SimulatedRiskService } from './SimulatedRiskService';
import { ExecutionFilterState } from '../strategy/v3/ExecutionFilterState';
import { OpenTradesService } from '../services/OpenTradesService';
import { BacktestResultStore } from './BacktestResultStore';
import {
  BacktestConfig,
  BacktestResult,
  BacktestStats,
  BacktestTrade,
  EquityPoint,
} from './types';
import * as fs from 'fs/promises';
import * as path from 'path';
import { MarketStructureHTF } from '../strategy/v2/MarketStructureHTF';
import { MarketStructureITF } from '../strategy/v2/MarketStructureITF';
import { MarketStructureLTF } from '../strategy/v2/MarketStructureLTF';
import { MarketDataService } from '../services/MarketDataService';
import { CandleStore } from '../marketData/CandleStore';

const logger = new Logger('BacktestRunner');

/**
 * BacktestRunner - Orchestrates backtest execution
 */
export class BacktestRunner {
  private config: BacktestConfig;
  private dataLoader: HistoricalDataLoader;
  private resultStore: BacktestResultStore;
  private result: BacktestResult | null = null;
  private partialTrades: BacktestTrade[] = [];
  private partialEquityCurve: EquityPoint[] = [];
  private partialCurrentBalance: number;
  private partialPeakBalance: number;
  private isTerminated = false;

  constructor(config: BacktestConfig, dataLoaderConfig: {
    dataSource: 'csv' | 'postgres' | 'mt5' | 'mock';
    csvPath?: string;
    databaseUrl?: string;
    mt5BaseUrl?: string;
  }) {
    this.config = config;
    this.dataLoader = new HistoricalDataLoader(dataLoaderConfig);
    this.resultStore = new BacktestResultStore(dataLoaderConfig.databaseUrl);
    this.partialCurrentBalance = config.initialBalance;
    this.partialPeakBalance = config.initialBalance;
  }

  /**
   * Run the backtest
   */
  async run(): Promise<BacktestResult> {
    const startTime = Date.now();
    const runId = `backtest_${startTime}`;

    logger.info(`[BacktestRunner] Starting backtest run: ${runId}`);
    logger.info(`[BacktestRunner] Config:`, {
      symbol: Array.isArray(this.config.symbol) ? this.config.symbol.join(',') : this.config.symbol,
      strategies: this.config.strategies.join(','),
      startDate: this.config.startDate,
      endDate: this.config.endDate,
      initialBalance: this.config.initialBalance,
    });

    try {
      // Parse dates
      const startDate = new Date(this.config.startDate);
      const endDate = new Date(this.config.endDate);
      const symbols = Array.isArray(this.config.symbol) ? this.config.symbol : [this.config.symbol];

      // Load historical candles for all symbols
      const allCandles: Map<string, Array<{ candle: any; symbol: string }>> = new Map();
      
      for (const symbol of symbols) {
        logger.info(`[BacktestRunner] Loading candles for ${symbol}...`);
        const candles = await this.dataLoader.loadCandles(
          symbol,
          startDate,
          endDate,
          this.config.timeframe || 'M5'
        );

        if (candles.length === 0) {
          logger.warn(`[BacktestRunner] No candles loaded for ${symbol}`);
          continue;
        }

        allCandles.set(symbol, candles.map(c => ({ candle: c, symbol })));
        logger.info(`[BacktestRunner] Loaded ${candles.length} candles for ${symbol}`);
      }

      if (allCandles.size === 0) {
        throw new Error('No historical candles loaded for any symbol');
      }

      // Combine and sort all candles by timestamp
      // Use a loop instead of spread operator to avoid stack overflow with large arrays
      const sortedCandles: Array<{ candle: any; symbol: string }> = [];
      for (const candles of allCandles.values()) {
        // Push items one by one to avoid stack overflow (more memory efficient than spread/concat)
        for (const item of candles) {
          sortedCandles.push(item);
        }
      }
      sortedCandles.sort((a, b) => a.candle.timestamp - b.candle.timestamp);

      logger.info(`[BacktestRunner] Total candles to replay: ${sortedCandles.length}`);

      // Initialize simulated services
      const simulatedMT5 = new SimulatedMT5Adapter({
        initialBalance: this.config.initialBalance,
        spreadPips: this.config.spreadPips || 0,
        slippagePips: this.config.slippagePips || 0,
      });

      const simulatedRisk = new SimulatedRiskService({
        initialBalance: this.config.initialBalance,
        lowRiskMaxDailyLoss: 1.0,
        lowRiskMaxTrades: 2,
        highRiskMaxDailyLoss: 3.0,
        highRiskMaxTrades: 4,
        defaultLowRiskPerTrade: this.config.riskPerTradePercent || 0.5,
        defaultHighRiskPerTrade: (this.config.riskPerTradePercent || 0.5) * 3,
      });

      // Initialize ExecutionFilterState for v3
      const executionFilterState = new ExecutionFilterState();

      // Initialize OpenTradesService for v4 exposure (but don't start polling - it's simulated)
      // We'll manually update it during replay
      const openTradesService = new OpenTradesService({
        mt5BaseUrl: 'http://localhost:3030', // Not used in backtest
        pollIntervalSec: 10,
        defaultRiskPerTrade: 75.0,
      });

      // Run replay for each strategy
      const allTrades: BacktestTrade[] = [];
      const equityCurve: EquityPoint[] = [];
      let currentBalance = this.config.initialBalance;
      let peakBalance = this.config.initialBalance;
      let currentEquity = this.config.initialBalance;
      
      // Shared tracking maps across all strategies
      const dailyTradeCounts = new Map<string, number>();
      const lastTradeTimestamps = new Map<string, number>();

      // Initialize equity curve
      equityCurve.push({
        timestamp: startDate.getTime(),
        balance: this.config.initialBalance,
        equity: this.config.initialBalance,
        drawdown: 0,
        drawdownPercent: 0,
      });

      // Process each strategy
      for (const strategy of this.config.strategies) {
        logger.info(`[BacktestRunner] Running replay for strategy: ${strategy}`);

        // Reset services for new strategy run
        simulatedMT5.reset(this.config.initialBalance);
        simulatedRisk.reset();

        // Create replay engine for this strategy
        // Note: Each strategy shares the same MT5 adapter and risk service
        // so positions from one strategy affect the next
        const replayEngine = new CandleReplayEngine({
          strategy,
          executionFilterState,
          openTradesService,
          simulatedMT5,
          simulatedRisk,
          guardrailMode: 'normal', // Default: normal mode in backtest
          dailyTradeCounts, // Share tracking across strategies
          lastTradeTimestamps, // Share tracking across strategies
          overrideParamSet: this.config.overrideParamSet, // v11: Pass parameter overrides for optimization
        });

        // Replay candles
        let candleIndex = 0;
        const totalCandles = sortedCandles.length;
        
        for (const { candle, symbol } of sortedCandles) {
          // Check if terminated
          if (this.isTerminated) {
            logger.warn(`[BacktestRunner] Backtest terminated early at candle ${candleIndex + 1}/${totalCandles}`);
            break;
          }

          // Update OpenTradesService snapshot manually (simulate v4 exposure)
          // We'll do this by creating a mock snapshot from simulatedMT5
          this.updateOpenTradesSnapshot(openTradesService, simulatedMT5);

          await replayEngine.processCandle(candle);

          // Update equity curve periodically (every 100 candles or at end)
          candleIndex++;
          if (candleIndex % 100 === 0 || candleIndex === sortedCandles.length) {
            currentBalance = simulatedMT5.getBalance();
            
            // Calculate equity (balance + unrealized PnL from open positions)
            const openPositions = simulatedMT5.getOpenPositions();
            let unrealizedPnL = 0;
            for (const pos of openPositions) {
              // Simplified: use candle close as current price for unrealized PnL
              const currentPrice = candle.close;
              const priceDiff = pos.direction === 'buy'
                ? currentPrice - pos.entryPrice
                : pos.entryPrice - currentPrice;
              const contractSize = this.getContractSize(pos.symbol);
              const pipValue = this.getPipValue(pos.symbol, pos.entryPrice);
              unrealizedPnL += priceDiff * pos.volume * contractSize * pipValue;
            }

            currentEquity = currentBalance + unrealizedPnL;
            peakBalance = Math.max(peakBalance, currentEquity);

            const drawdown = peakBalance - currentEquity;
            const drawdownPercent = peakBalance > 0 ? (drawdown / peakBalance) * 100 : 0;

            equityCurve.push({
              timestamp: candle.timestamp,
              balance: currentBalance,
              equity: currentEquity,
              drawdown,
              drawdownPercent,
            });

            // Update partial results for graceful shutdown (collect trades from current strategy)
            const currentStrategyTrades = replayEngine.getTrades();
            this.partialTrades = [...allTrades, ...currentStrategyTrades];
            this.partialEquityCurve = [...equityCurve];
            this.partialCurrentBalance = currentBalance;
            this.partialPeakBalance = peakBalance;

            // Log progress every 1000 candles
            if (candleIndex % 1000 === 0) {
              const progressPercent = ((candleIndex / totalCandles) * 100).toFixed(1);
              logger.info(`[BacktestRunner] Progress: ${candleIndex}/${totalCandles} candles (${progressPercent}%) - ${this.partialTrades.length} trades so far`);
            }
          }
        }

        // Collect trades from this strategy
        const strategyTrades = replayEngine.getTrades();
        allTrades.push(...strategyTrades);
        
        // Log metrics summary for this strategy
        const strategyService = replayEngine.getStrategyService();
        if (strategyService && typeof strategyService.logMetricsSummary === 'function') {
          logger.info(`[BacktestRunner] Metrics summary for strategy: ${strategy}`);
          strategyService.logMetricsSummary();
        }
      }

      // Calculate SMC core statistics
      logger.info('[BacktestRunner] Calculating SMC core statistics...');
      let smcStats: BacktestStats['smcStats'];
      try {
        smcStats = await this.calculateSMCStats(allCandles, symbols);
        logger.info(`[BacktestRunner] SMC stats calculated: ${smcStats?.totalEvaluations || 0} evaluations`);
      } catch (error) {
        logger.error('[BacktestRunner] Error calculating SMC stats:', error);
        smcStats = undefined;
      }
      
      // Calculate statistics
      const stats = this.calculateStats(allTrades, equityCurve, this.config.initialBalance, smcStats);

      const endTime = Date.now();
      const runtimeMs = endTime - startTime;

      // Build result
      this.result = {
        runId,
        config: this.config,
        startTime,
        endTime,
        runtimeMs,
        stats,
        trades: allTrades,
        equityCurve,
        initialBalance: this.config.initialBalance,
        finalBalance: currentBalance,
        totalReturn: currentBalance - this.config.initialBalance,
        totalReturnPercent: ((currentBalance - this.config.initialBalance) / this.config.initialBalance) * 100,
      };

      logger.info(`[BacktestRunner] Backtest completed in ${runtimeMs}ms`);
      logger.info(`[BacktestRunner] Results:`, {
        totalTrades: stats.totalTrades,
        winRate: `${stats.winRate.toFixed(2)}%`,
        totalPnL: stats.totalPnL.toFixed(2),
        finalBalance: currentBalance.toFixed(2),
        returnPercent: this.result.totalReturnPercent.toFixed(2) + '%',
      });

      // Save to database
      try {
        await this.resultStore.saveResult(this.result);
      } catch (error) {
        logger.warn('[BacktestRunner] Failed to save to database (results still saved to disk)', error);
      }

      // Cleanup
      await this.dataLoader.close();
      await executionFilterState.close();
      await this.resultStore.close();

      return this.result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[BacktestRunner] Backtest failed: ${errorMsg}`, error);
      throw new Error(`Backtest failed: ${errorMsg}`);
    }
  }

  /**
   * Update OpenTradesService snapshot manually (for v4 exposure simulation)
   * Injects simulated positions into OpenTradesService so v4 exposure checks work
   */
  private updateOpenTradesSnapshot(
    openTradesService: OpenTradesService,
    simulatedMT5: SimulatedMT5Adapter
  ): void {
    // Convert SimulatedMT5Adapter positions to OpenTradesService format
    const openPositions = simulatedMT5.getOpenPositions();
    
    // Manually update the internal snapshots by accessing private method
    // This is a workaround since OpenTradesService polls from MT5 Connector
    // In backtesting, we inject positions directly
    const openTrades = openPositions.map(pos => ({
      symbol: pos.symbol,
      ticket: pos.ticket,
      direction: pos.direction as 'buy' | 'sell',
      volume: pos.volume,
      openPrice: pos.entryPrice,
      sl: pos.sl,
      tp: pos.tp,
      openTime: new Date(pos.openTime),
    }));
    
    // Access private updateSnapshots method via type assertion
    const service = openTradesService as any;
    if (typeof service.updateSnapshots === 'function') {
      service.updateSnapshots(openTrades);
    } else {
      // If updateSnapshots is not accessible, we'll need to expose it or use a different approach
      // For now, log a warning - v4 exposure checks may not work perfectly in backtest
      logger.debug('[BacktestRunner] Could not update OpenTradesService snapshot (v4 exposure may be limited)');
    }
  }

  /**
   * Calculate SMC core statistics from backtest
   * Tracks: Swings, BOS, CHoCH, Trend Bias for HTF, ITF, LTF
   */
  private async calculateSMCStats(
    allCandles: Map<string, Array<{ candle: any; symbol: string }>>,
    symbols: string[]
  ): Promise<BacktestStats['smcStats']> {
    const smcStats = {
      htf: {
        totalSwings: 0, swingHighs: 0, swingLows: 0,
        totalBOS: 0, bullishBOS: 0, bearishBOS: 0,
        totalCHoCH: 0, bullishCHoCH: 0, bearishCHoCH: 0,
        totalMSB: 0, bullishMSB: 0, bearishMSB: 0,
        trendBullish: 0, trendBearish: 0, trendSideways: 0,
        evaluations: 0,
      },
      itf: {
        totalSwings: 0, swingHighs: 0, swingLows: 0,
        totalBOS: 0, bullishBOS: 0, bearishBOS: 0,
        totalCHoCH: 0, bullishCHoCH: 0, bearishCHoCH: 0,
        totalMSB: 0, bullishMSB: 0, bearishMSB: 0,
        trendBullish: 0, trendBearish: 0, trendSideways: 0,
        evaluations: 0,
      },
      ltf: {
        totalSwings: 0, swingHighs: 0, swingLows: 0,
        totalBOS: 0, bullishBOS: 0, bearishBOS: 0,
        totalCHoCH: 0, bullishCHoCH: 0, bearishCHoCH: 0,
        totalMSB: 0, bullishMSB: 0, bearishMSB: 0,
        trendBullish: 0, trendBearish: 0, trendSideways: 0,
        evaluations: 0,
      },
      totalEvaluations: 0,
    };

    // Create structure analyzers
    const htfStructure = new MarketStructureHTF(50);
    const itfStructure = new MarketStructureITF(30);
    const ltfStructure = new MarketStructureLTF(20);

    // Create a temporary CandleStore and MarketDataService for analysis
    const candleStore = new CandleStore(1000);
    const marketDataService = new MarketDataService(candleStore);

    // Analyze structure for each symbol periodically (every 10 candles to avoid performance issues)
    for (const symbol of symbols) {
      const symbolCandles = allCandles.get(symbol);
      if (!symbolCandles || symbolCandles.length === 0) continue;

      // Sample every 10th candle for swing analysis (to balance accuracy vs performance)
      for (let i = 9; i < symbolCandles.length; i += 10) {
        // Clear candle store for each evaluation to start fresh
        candleStore.clear(symbol);
        
        // Build up all candles up to current index (incremental build-up)
        // This simulates how candles would accumulate in real-time
        for (let j = 0; j <= i && j < symbolCandles.length; j++) {
          const { candle } = symbolCandles[j];
          
          // Convert to MarketData format
          const marketDataCandle = {
            symbol,
            timeframe: 'M1' as const,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
            startTime: new Date(candle.timestamp),
            endTime: new Date(candle.timestamp + (5 * 60 * 1000)),
          };

          // Add to store (will maintain rolling window automatically)
          candleStore.addCandle(marketDataCandle);
        }

        // Get candles for each timeframe
        const htfCandlesRaw = await marketDataService.getRecentCandles(symbol, 'H4', 50);
        const itfCandlesRaw = await marketDataService.getRecentCandles(symbol, 'M15', 30);
        const ltfCandlesRaw = await marketDataService.getRecentCandles(symbol, 'M1', 20);

        // Convert from types/index Candle to marketData/types Candle format
        const convertCandle = (c: import('../types').Candle): import('../marketData/types').Candle => ({
          symbol,
          timeframe: 'M1' as const,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          startTime: new Date(c.timestamp),
          endTime: new Date(new Date(c.timestamp).getTime() + (5 * 60 * 1000)), // M1 = 5 min window
        });

        const htfCandles = htfCandlesRaw.map(convertCandle);
        const itfCandles = itfCandlesRaw.map(convertCandle);
        const ltfCandles = ltfCandlesRaw.map(convertCandle);

        // Analyze HTF
        if (htfCandles.length >= 3) {
          const htfResult = htfStructure.analyzeStructure(htfCandles);
          
          // Swings
          smcStats.htf.totalSwings += (htfResult.swingHighs?.length || 0) + (htfResult.swingLows?.length || 0);
          smcStats.htf.swingHighs += htfResult.swingHighs?.length || 0;
          smcStats.htf.swingLows += htfResult.swingLows?.length || 0;
          
          // BOS and CHoCH events
          // Note: We infer direction from price movement since the backward-compatible
          // bosEvents array doesn't include direction. BOS bullish = break above swing high,
          // BOS bearish = break below swing low
          if (htfResult.bosEvents) {
            for (const event of htfResult.bosEvents) {
              if (event.type === 'BOS') {
                smcStats.htf.totalBOS++;
                // Infer direction: if price broke above a swing high, it's bullish BOS
                // If price broke below a swing low, it's bearish BOS
                const eventIndex = event.index;
                if (eventIndex < htfCandles.length) {
                  const eventCandle = htfCandles[eventIndex];
                  // Check if this is likely a bullish or bearish break
                  // Bullish BOS typically breaks above previous swing high
                  // Bearish BOS typically breaks below previous swing low
                  const prevSwingHigh = htfResult.swingHighs?.slice(-1)[0];
                  const prevSwingLow = htfResult.swingLows?.slice(-1)[0];
                  
                  if (prevSwingHigh && event.price >= prevSwingHigh) {
                    smcStats.htf.bullishBOS++;
                  } else if (prevSwingLow && event.price <= prevSwingLow) {
                    smcStats.htf.bearishBOS++;
                  } else {
                    // Fallback: use price movement
                    if (eventIndex > 0) {
                      const prevCandle = htfCandles[eventIndex - 1];
                      if (eventCandle.close > prevCandle.close) {
                        smcStats.htf.bullishBOS++;
                      } else {
                        smcStats.htf.bearishBOS++;
                      }
                    }
                  }
                }
              } else if (event.type === 'CHoCH') {
                smcStats.htf.totalCHoCH++;
                // CHoCH indicates trend reversal, so direction is opposite of previous trend
                const eventIndex = event.index;
                if (eventIndex < htfCandles.length) {
                  // CHoCH bullish = trend changed from bearish to bullish
                  // CHoCH bearish = trend changed from bullish to bearish
                  // We can infer from the event context or price movement
                  if (eventIndex > 0) {
                    const prevCandle = htfCandles[eventIndex - 1];
                    const eventCandle = htfCandles[eventIndex];
                    // If price moved up significantly, likely bullish CHoCH
                    if (eventCandle.close > prevCandle.close * 1.001) {
                      smcStats.htf.bullishCHoCH++;
                    } else if (eventCandle.close < prevCandle.close * 0.999) {
                      smcStats.htf.bearishCHoCH++;
                    } else {
                      // Default based on price level
                      if (event.price > (htfResult.swingHigh || 0)) {
                        smcStats.htf.bullishCHoCH++;
                      } else {
                        smcStats.htf.bearishCHoCH++;
                      }
                    }
                  }
                }
              } else if (event.type === 'MSB') {
                smcStats.htf.totalMSB++;
                // MSB is a stronger CHoCH, same direction logic
                const eventIndex = event.index;
                if (eventIndex < htfCandles.length && eventIndex > 0) {
                  const prevCandle = htfCandles[eventIndex - 1];
                  const eventCandle = htfCandles[eventIndex];
                  if (eventCandle.close > prevCandle.close * 1.001) {
                    smcStats.htf.bullishMSB++;
                  } else if (eventCandle.close < prevCandle.close * 0.999) {
                    smcStats.htf.bearishMSB++;
                  } else {
                    if (event.price > (htfResult.swingHigh || 0)) {
                      smcStats.htf.bullishMSB++;
                    } else {
                      smcStats.htf.bearishMSB++;
                    }
                  }
                }
              }
            }
          }
          
          // Trend bias
          if (htfResult.trend === 'bullish') smcStats.htf.trendBullish++;
          else if (htfResult.trend === 'bearish') smcStats.htf.trendBearish++;
          else smcStats.htf.trendSideways++;
          
          smcStats.htf.evaluations++;
        }

        // Analyze ITF
        if (itfCandles.length >= 3) {
          const itfResult = itfStructure.analyzeStructure(itfCandles, 'sideways');
          
          // Swings
          smcStats.itf.totalSwings += (itfResult.swingHighs?.length || 0) + (itfResult.swingLows?.length || 0);
          smcStats.itf.swingHighs += itfResult.swingHighs?.length || 0;
          smcStats.itf.swingLows += itfResult.swingLows?.length || 0;
          
          // BOS and CHoCH events (same logic as HTF)
          if (itfResult.bosEvents) {
            for (const event of itfResult.bosEvents) {
              if (event.type === 'BOS') {
                smcStats.itf.totalBOS++;
                const eventIndex = event.index;
                if (eventIndex < itfCandles.length) {
                  const eventCandle = itfCandles[eventIndex];
                  const prevSwingHigh = itfResult.swingHighs?.slice(-1)[0];
                  const prevSwingLow = itfResult.swingLows?.slice(-1)[0];
                  
                  if (prevSwingHigh && event.price >= prevSwingHigh) {
                    smcStats.itf.bullishBOS++;
                  } else if (prevSwingLow && event.price <= prevSwingLow) {
                    smcStats.itf.bearishBOS++;
                  } else if (eventIndex > 0) {
                    const prevCandle = itfCandles[eventIndex - 1];
                    if (eventCandle.close > prevCandle.close) {
                      smcStats.itf.bullishBOS++;
                    } else {
                      smcStats.itf.bearishBOS++;
                    }
                  }
                }
              } else if (event.type === 'CHoCH') {
                smcStats.itf.totalCHoCH++;
                const eventIndex = event.index;
                if (eventIndex < itfCandles.length && eventIndex > 0) {
                  const prevCandle = itfCandles[eventIndex - 1];
                  const eventCandle = itfCandles[eventIndex];
                  if (eventCandle.close > prevCandle.close * 1.001) {
                    smcStats.itf.bullishCHoCH++;
                  } else if (eventCandle.close < prevCandle.close * 0.999) {
                    smcStats.itf.bearishCHoCH++;
                  } else {
                    if (event.price > (itfResult.swingHigh || 0)) {
                      smcStats.itf.bullishCHoCH++;
                    } else {
                      smcStats.itf.bearishCHoCH++;
                    }
                  }
                }
              } else if (event.type === 'MSB') {
                smcStats.itf.totalMSB++;
                const eventIndex = event.index;
                if (eventIndex < itfCandles.length && eventIndex > 0) {
                  const prevCandle = itfCandles[eventIndex - 1];
                  const eventCandle = itfCandles[eventIndex];
                  if (eventCandle.close > prevCandle.close * 1.001) {
                    smcStats.itf.bullishMSB++;
                  } else if (eventCandle.close < prevCandle.close * 0.999) {
                    smcStats.itf.bearishMSB++;
                  } else {
                    if (event.price > (itfResult.swingHigh || 0)) {
                      smcStats.itf.bullishMSB++;
                    } else {
                      smcStats.itf.bearishMSB++;
                    }
                  }
                }
              }
            }
          }
          
          // Trend bias
          if (itfResult.trend === 'bullish') smcStats.itf.trendBullish++;
          else if (itfResult.trend === 'bearish') smcStats.itf.trendBearish++;
          else smcStats.itf.trendSideways++;
          
          smcStats.itf.evaluations++;
        }

        // Analyze LTF
        if (ltfCandles.length >= 3) {
          const ltfResult = ltfStructure.analyzeStructure(ltfCandles, 'sideways');
          
          // Swings
          smcStats.ltf.totalSwings += (ltfResult.swingHighs?.length || 0) + (ltfResult.swingLows?.length || 0);
          smcStats.ltf.swingHighs += ltfResult.swingHighs?.length || 0;
          smcStats.ltf.swingLows += ltfResult.swingLows?.length || 0;
          
          // BOS and CHoCH events (same logic as HTF/ITF)
          if (ltfResult.bosEvents) {
            for (const event of ltfResult.bosEvents) {
              if (event.type === 'BOS') {
                smcStats.ltf.totalBOS++;
                const eventIndex = event.index;
                if (eventIndex < ltfCandles.length) {
                  const eventCandle = ltfCandles[eventIndex];
                  const prevSwingHigh = ltfResult.swingHighs?.slice(-1)[0];
                  const prevSwingLow = ltfResult.swingLows?.slice(-1)[0];
                  
                  if (prevSwingHigh && event.price >= prevSwingHigh) {
                    smcStats.ltf.bullishBOS++;
                  } else if (prevSwingLow && event.price <= prevSwingLow) {
                    smcStats.ltf.bearishBOS++;
                  } else if (eventIndex > 0) {
                    const prevCandle = ltfCandles[eventIndex - 1];
                    if (eventCandle.close > prevCandle.close) {
                      smcStats.ltf.bullishBOS++;
                    } else {
                      smcStats.ltf.bearishBOS++;
                    }
                  }
                }
              } else if (event.type === 'CHoCH') {
                smcStats.ltf.totalCHoCH++;
                const eventIndex = event.index;
                if (eventIndex < ltfCandles.length && eventIndex > 0) {
                  const prevCandle = ltfCandles[eventIndex - 1];
                  const eventCandle = ltfCandles[eventIndex];
                  if (eventCandle.close > prevCandle.close * 1.001) {
                    smcStats.ltf.bullishCHoCH++;
                  } else if (eventCandle.close < prevCandle.close * 0.999) {
                    smcStats.ltf.bearishCHoCH++;
                  } else {
                    if (event.price > (ltfResult.swingHigh || 0)) {
                      smcStats.ltf.bullishCHoCH++;
                    } else {
                      smcStats.ltf.bearishCHoCH++;
                    }
                  }
                }
              } else if (event.type === 'MSB') {
                smcStats.ltf.totalMSB++;
                const eventIndex = event.index;
                if (eventIndex < ltfCandles.length && eventIndex > 0) {
                  const prevCandle = ltfCandles[eventIndex - 1];
                  const eventCandle = ltfCandles[eventIndex];
                  if (eventCandle.close > prevCandle.close * 1.001) {
                    smcStats.ltf.bullishMSB++;
                  } else if (eventCandle.close < prevCandle.close * 0.999) {
                    smcStats.ltf.bearishMSB++;
                  } else {
                    if (event.price > (ltfResult.swingHigh || 0)) {
                      smcStats.ltf.bullishMSB++;
                    } else {
                      smcStats.ltf.bearishMSB++;
                    }
                  }
                }
              }
            }
          }
          
          // Trend bias
          if (ltfResult.trend === 'bullish') smcStats.ltf.trendBullish++;
          else if (ltfResult.trend === 'bearish') smcStats.ltf.trendBearish++;
          else smcStats.ltf.trendSideways++;
          
          smcStats.ltf.evaluations++;
        }

        smcStats.totalEvaluations++;
      }
    }
    
    logger.info(
      `[BacktestRunner] SMC stats calculation complete: ${smcStats.totalEvaluations} total evaluations. ` +
      `HTF: ${smcStats.htf.evaluations} evals, ${smcStats.htf.totalSwings} swings, ${smcStats.htf.totalBOS} BOS, ${smcStats.htf.totalCHoCH} CHoCH. ` +
      `ITF: ${smcStats.itf.evaluations} evals, ${smcStats.itf.totalSwings} swings, ${smcStats.itf.totalBOS} BOS, ${smcStats.itf.totalCHoCH} CHoCH. ` +
      `LTF: ${smcStats.ltf.evaluations} evals, ${smcStats.ltf.totalSwings} swings, ${smcStats.ltf.totalBOS} BOS, ${smcStats.ltf.totalCHoCH} CHoCH.`
    );

    return {
      htf: {
        totalSwings: smcStats.htf.totalSwings,
        swingHighs: smcStats.htf.swingHighs,
        swingLows: smcStats.htf.swingLows,
        averageSwingsPerEvaluation: smcStats.htf.evaluations > 0 
          ? smcStats.htf.totalSwings / smcStats.htf.evaluations 
          : 0,
        totalBOS: smcStats.htf.totalBOS,
        bullishBOS: smcStats.htf.bullishBOS,
        bearishBOS: smcStats.htf.bearishBOS,
        totalCHoCH: smcStats.htf.totalCHoCH,
        bullishCHoCH: smcStats.htf.bullishCHoCH,
        bearishCHoCH: smcStats.htf.bearishCHoCH,
        totalMSB: smcStats.htf.totalMSB,
        bullishMSB: smcStats.htf.bullishMSB,
        bearishMSB: smcStats.htf.bearishMSB,
        trendBullish: smcStats.htf.trendBullish,
        trendBearish: smcStats.htf.trendBearish,
        trendSideways: smcStats.htf.trendSideways,
        evaluations: smcStats.htf.evaluations,
      },
      itf: {
        totalSwings: smcStats.itf.totalSwings,
        swingHighs: smcStats.itf.swingHighs,
        swingLows: smcStats.itf.swingLows,
        averageSwingsPerEvaluation: smcStats.itf.evaluations > 0 
          ? smcStats.itf.totalSwings / smcStats.itf.evaluations 
          : 0,
        totalBOS: smcStats.itf.totalBOS,
        bullishBOS: smcStats.itf.bullishBOS,
        bearishBOS: smcStats.itf.bearishBOS,
        totalCHoCH: smcStats.itf.totalCHoCH,
        bullishCHoCH: smcStats.itf.bullishCHoCH,
        bearishCHoCH: smcStats.itf.bearishCHoCH,
        totalMSB: smcStats.itf.totalMSB,
        bullishMSB: smcStats.itf.bullishMSB,
        bearishMSB: smcStats.itf.bearishMSB,
        trendBullish: smcStats.itf.trendBullish,
        trendBearish: smcStats.itf.trendBearish,
        trendSideways: smcStats.itf.trendSideways,
        evaluations: smcStats.itf.evaluations,
      },
      ltf: {
        totalSwings: smcStats.ltf.totalSwings,
        swingHighs: smcStats.ltf.swingHighs,
        swingLows: smcStats.ltf.swingLows,
        averageSwingsPerEvaluation: smcStats.ltf.evaluations > 0 
          ? smcStats.ltf.totalSwings / smcStats.ltf.evaluations 
          : 0,
        totalBOS: smcStats.ltf.totalBOS,
        bullishBOS: smcStats.ltf.bullishBOS,
        bearishBOS: smcStats.ltf.bearishBOS,
        totalCHoCH: smcStats.ltf.totalCHoCH,
        bullishCHoCH: smcStats.ltf.bullishCHoCH,
        bearishCHoCH: smcStats.ltf.bearishCHoCH,
        totalMSB: smcStats.ltf.totalMSB,
        bullishMSB: smcStats.ltf.bullishMSB,
        bearishMSB: smcStats.ltf.bearishMSB,
        trendBullish: smcStats.ltf.trendBullish,
        trendBearish: smcStats.ltf.trendBearish,
        trendSideways: smcStats.ltf.trendSideways,
        evaluations: smcStats.ltf.evaluations,
      },
      totalEvaluations: smcStats.totalEvaluations,
    };
  }

  /**
   * Calculate backtest statistics
   */
  private calculateStats(
    trades: BacktestTrade[],
    equityCurve: EquityPoint[],
    initialBalance: number,
    smcStats?: BacktestStats['smcStats']
  ): BacktestStats {
    if (trades.length === 0) {
      return this.createEmptyStats(smcStats);
    }

    // Basic counts
    const winningTrades = trades.filter(t => t.profit > 0);
    const losingTrades = trades.filter(t => t.profit <= 0);
    const winRate = (winningTrades.length / trades.length) * 100;

    // PnL calculations
    const totalPnL = trades.reduce((sum, t) => sum + t.profit, 0);
    const grossProfit = winningTrades.reduce((sum, t) => sum + t.profit, 0);
    const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.profit, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

    // Risk metrics
    const drawdowns = equityCurve.map(e => e.drawdown);
    const maxDrawdown = Math.max(...drawdowns, 0);
    const maxDrawdownPercent = equityCurve.length > 0
      ? Math.max(...equityCurve.map(e => e.drawdownPercent), 0)
      : 0;

    // Consecutive losses/wins
    let maxConsecutiveLosses = 0;
    let maxConsecutiveWins = 0;
    let currentConsecutiveLosses = 0;
    let currentConsecutiveWins = 0;

    for (const trade of trades) {
      if (trade.profit > 0) {
        currentConsecutiveWins++;
        currentConsecutiveLosses = 0;
        maxConsecutiveWins = Math.max(maxConsecutiveWins, currentConsecutiveWins);
      } else {
        currentConsecutiveLosses++;
        currentConsecutiveWins = 0;
        maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentConsecutiveLosses);
      }
    }

    // Trade metrics
    const averageWin = winningTrades.length > 0
      ? grossProfit / winningTrades.length
      : 0;
    const averageLoss = losingTrades.length > 0
      ? grossLoss / losingTrades.length
      : 0;
    const averageRr = trades
      .filter(t => t.riskReward !== undefined)
      .reduce((sum, t) => sum + (t.riskReward || 0), 0) / trades.filter(t => t.riskReward).length || 0;
    const expectancy = (winRate / 100) * averageWin - ((100 - winRate) / 100) * Math.abs(averageLoss);
    const averageTradeDuration = trades.reduce((sum, t) => sum + t.durationMinutes, 0) / trades.length;

    // Per-symbol stats
    const perSymbolStats: Record<string, { trades: number; pnl: number; winRate: number }> = {};
    const symbolGroups = new Map<string, BacktestTrade[]>();
    for (const trade of trades) {
      if (!symbolGroups.has(trade.symbol)) {
        symbolGroups.set(trade.symbol, []);
      }
      symbolGroups.get(trade.symbol)!.push(trade);
    }

    for (const [symbol, symbolTrades] of symbolGroups.entries()) {
      const symbolWins = symbolTrades.filter(t => t.profit > 0).length;
      const symbolPnL = symbolTrades.reduce((sum, t) => sum + t.profit, 0);
      perSymbolStats[symbol] = {
        trades: symbolTrades.length,
        pnl: symbolPnL,
        winRate: (symbolWins / symbolTrades.length) * 100,
      };
    }

    // Per-strategy stats
    const perStrategyStats: Record<string, { trades: number; pnl: number; winRate: number }> = {};
    const strategyGroups = new Map<string, BacktestTrade[]>();
    for (const trade of trades) {
      if (!strategyGroups.has(trade.strategy)) {
        strategyGroups.set(trade.strategy, []);
      }
      strategyGroups.get(trade.strategy)!.push(trade);
    }

    for (const [strategy, strategyTrades] of strategyGroups.entries()) {
      const strategyWins = strategyTrades.filter(t => t.profit > 0).length;
      const strategyPnL = strategyTrades.reduce((sum, t) => sum + t.profit, 0);
      perStrategyStats[strategy] = {
        trades: strategyTrades.length,
        pnl: strategyPnL,
        winRate: (strategyWins / strategyTrades.length) * 100,
      };
    }

      return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      totalPnL,
      grossProfit,
      grossLoss,
      profitFactor,
      maxDrawdown,
      maxDrawdownPercent,
      maxConsecutiveLosses,
      maxConsecutiveWins,
      averageWin,
      averageLoss,
      averageRr,
      expectancy,
      averageTradeDurationMinutes: averageTradeDuration,
      perSymbolStats,
      perStrategyStats,
      smcStats,
    };
  }

  /**
   * Create empty stats when no trades
   */
  private createEmptyStats(smcStats?: BacktestStats['smcStats']): BacktestStats {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalPnL: 0,
      grossProfit: 0,
      grossLoss: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      maxConsecutiveLosses: 0,
      maxConsecutiveWins: 0,
      averageWin: 0,
      averageLoss: 0,
      averageRr: 0,
      expectancy: 0,
      averageTradeDurationMinutes: 0,
      perSymbolStats: {},
      perStrategyStats: {},
      smcStats,
    };
  }

  /**
   * Get contract size for symbol
   */
  private getContractSize(symbol: string): number {
    const upperSymbol = symbol.toUpperCase();
    if (upperSymbol === 'XAUUSD' || upperSymbol === 'GOLD') {
      return 100;
    }
    if (upperSymbol.includes('USD') && !upperSymbol.includes('XAU')) {
      return 100000;
    }
    if (upperSymbol === 'US30') {
      return 1;
    }
    return 100;
  }

  /**
   * Get pip value for symbol
   */
  private getPipValue(symbol: string, price: number): number {
    const upperSymbol = symbol.toUpperCase();
    if (upperSymbol === 'XAUUSD' || upperSymbol === 'GOLD') {
      return 0.1;
    }
    if (upperSymbol === 'US30') {
      return 1.0;
    }
    return 0.0001;
  }

  /**
   * Mark backtest as terminated (for graceful shutdown)
   */
  markTerminated(): void {
    this.isTerminated = true;
  }

  /**
   * Check if backtest has partial results
   */
  hasPartialResults(): boolean {
    return this.partialTrades.length > 0 || this.partialEquityCurve.length > 0;
  }

  /**
   * Save partial results to disk (for graceful shutdown)
   */
  async savePartialResults(outputDir: string): Promise<void> {
    if (!this.hasPartialResults()) {
      logger.warn('[BacktestRunner] No partial results to save');
      return;
    }

    try {
      // Create output directory
      await fs.mkdir(outputDir, { recursive: true });

      // Calculate partial statistics
      const partialStats = this.calculateStats(
        this.partialTrades,
        this.partialEquityCurve,
        this.config.initialBalance
      );

      const runId = `backtest_partial_${Date.now()}`;
      const endTime = Date.now();
      const startTime = endTime - (this.partialEquityCurve.length > 0 
        ? (endTime - this.partialEquityCurve[0].timestamp) 
        : 0);

      // Save partial summary JSON
      const summaryPath = path.join(outputDir, 'summary.json');
      await fs.writeFile(
        summaryPath,
        JSON.stringify({
          runId,
          status: 'PARTIAL',
          config: this.config,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
          stats: partialStats,
          initialBalance: this.config.initialBalance,
          finalBalance: this.partialCurrentBalance,
          totalReturn: this.partialCurrentBalance - this.config.initialBalance,
          totalReturnPercent: ((this.partialCurrentBalance - this.config.initialBalance) / this.config.initialBalance) * 100,
          note: 'This is a partial result saved after graceful shutdown',
        }, null, 2)
      );

      // Save partial trades CSV
      if (this.partialTrades.length > 0) {
        const tradesPath = path.join(outputDir, 'trades.csv');
        const csvHeader = 'ticket,symbol,direction,strategy,entryPrice,exitPrice,entryTime,exitTime,sl,tp,volume,profit,durationMinutes,pips,riskReward\n';
        const csvRows = this.partialTrades.map(t => {
          return [
            t.ticket,
            t.symbol,
            t.direction,
            t.strategy,
            t.entryPrice.toFixed(5),
            t.exitPrice.toFixed(5),
            new Date(t.entryTime).toISOString(),
            new Date(t.exitTime).toISOString(),
            t.sl?.toFixed(5) || '',
            t.tp?.toFixed(5) || '',
            t.volume.toFixed(2),
            t.profit.toFixed(2),
            t.durationMinutes,
            t.pips.toFixed(2),
            t.riskReward?.toFixed(2) || '',
          ].join(',');
        });
        await fs.writeFile(tradesPath, csvHeader + csvRows.join('\n'));
      }

      // Save partial equity curve JSON
      if (this.partialEquityCurve.length > 0) {
        const equityPath = path.join(outputDir, 'equity.json');
        await fs.writeFile(
          equityPath,
          JSON.stringify(this.partialEquityCurve, null, 2)
        );
      }

      logger.info(`[BacktestRunner] Partial results saved to: ${outputDir}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[BacktestRunner] Failed to save partial results: ${errorMsg}`, error);
      throw error;
    }
  }

  /**
   * Save results to disk
   */
  async saveResults(outputDir: string): Promise<void> {
    if (!this.result) {
      throw new Error('No backtest result to save. Run backtest first.');
    }

    try {
      // Create output directory
      await fs.mkdir(outputDir, { recursive: true });

      // Save summary JSON
      const summaryPath = path.join(outputDir, 'summary.json');
      await fs.writeFile(
        summaryPath,
        JSON.stringify({
          runId: this.result.runId,
          config: this.result.config,
          startTime: new Date(this.result.startTime).toISOString(),
          endTime: new Date(this.result.endTime).toISOString(),
          runtimeMs: this.result.runtimeMs,
          stats: this.result.stats,
          initialBalance: this.result.initialBalance,
          finalBalance: this.result.finalBalance,
          totalReturn: this.result.totalReturn,
          totalReturnPercent: this.result.totalReturnPercent,
        }, null, 2)
      );

      // Save trades CSV
      const tradesPath = path.join(outputDir, 'trades.csv');
      const csvHeader = 'ticket,symbol,direction,strategy,entryPrice,exitPrice,entryTime,exitTime,sl,tp,volume,profit,durationMinutes,pips,riskReward\n';
      const csvRows = this.result.trades.map(t => {
        return [
          t.ticket,
          t.symbol,
          t.direction,
          t.strategy,
          t.entryPrice.toFixed(5),
          t.exitPrice.toFixed(5),
          new Date(t.entryTime).toISOString(),
          new Date(t.exitTime).toISOString(),
          t.sl?.toFixed(5) || '',
          t.tp?.toFixed(5) || '',
          t.volume.toFixed(2),
          t.profit.toFixed(2),
          t.durationMinutes,
          t.pips.toFixed(2),
          t.riskReward?.toFixed(2) || '',
        ].join(',');
      });
      await fs.writeFile(tradesPath, csvHeader + csvRows.join('\n'));

      // Save equity curve JSON
      const equityPath = path.join(outputDir, 'equity.json');
      await fs.writeFile(
        equityPath,
        JSON.stringify(this.result.equityCurve.map(e => ({
          timestamp: new Date(e.timestamp).toISOString(),
          balance: e.balance,
          equity: e.equity,
          drawdown: e.drawdown,
          drawdownPercent: e.drawdownPercent,
        })), null, 2)
      );

      logger.info(`[BacktestRunner] Results saved to: ${outputDir}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[BacktestRunner] Failed to save results: ${errorMsg}`, error);
      throw error;
    }
  }

  /**
   * Get result (if available)
   */
  getResult(): BacktestResult | null {
    return this.result;
  }
}

