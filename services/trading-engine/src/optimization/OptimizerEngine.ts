/**
 * OptimizerEngine - Main orchestrator for optimization (Trading Engine v11)
 * 
 * Coordinates optimization runs:
 * - Accepts OptimizationRequest
 * - Dispatches to correct optimizer (grid, random, bayes, walkforward)
 * - Handles async parallel runs
 * - Collects metrics
 * - Stores results in database
 * - Returns OptimizationResult
 */

import { Logger } from '@providencex/shared-utils';
import { BacktestRunner } from '../backtesting/BacktestRunner';
import { BacktestConfig } from '../backtesting/types';
import {
  OptimizationRequest,
  OptimizationResult,
  OptimizationRun,
  OptimizationMethod,
  WalkForwardResult,
  SMC_V2_ParamSet,
} from './OptimizationTypes';
import { GridSearchOptimizer } from './GridSearchOptimizer';
import { RandomSearchOptimizer } from './RandomSearchOptimizer';
import { BayesOptimizer } from './BayesOptimizer';
import { WalkForwardOptimizer } from './WalkForwardOptimizer';
import { OptimizerResultStore } from './OptimizerResultStore';
import { getOptimizerConfig } from './OptimizationConfig';

const logger = new Logger('OptimizerEngine');

/**
 * OptimizerEngine - Main optimization orchestrator
 */
export class OptimizerEngine {
  private config = getOptimizerConfig();
  private resultStore: OptimizerResultStore;

  constructor() {
    this.resultStore = new OptimizerResultStore(this.config.databaseUrl);
  }

  /**
   * Initialize database tables
   */
  async initialize(): Promise<void> {
    await this.resultStore.initializeTables();
    logger.info('[OptimizerEngine] Initialized database tables');
  }

  /**
   * Run optimization
   */
  async optimize(request: OptimizationRequest): Promise<OptimizationResult[] | WalkForwardResult> {
    logger.info(`[OptimizerEngine] Starting optimization: method=${request.method}, symbol=${Array.isArray(request.symbol) ? request.symbol.join(',') : request.symbol}`);

    // Create optimization run record
    const run: OptimizationRun = {
      method: request.method,
      symbol: request.symbol,
      paramSet: null, // Set for specific runs, null for grid/random
      inSampleRange: request.dateRange,
      outSampleRange: request.outOfSampleRange,
      status: 'running',
    };

    const runId = await this.resultStore.saveRun(run);

    try {
      // Prepare backtest config
      const backtestConfig: BacktestConfig = {
        symbol: request.symbol,
        strategies: ['low'], // Default to low risk strategy
        startDate: request.dateRange.from,
        endDate: request.dateRange.to,
        timeframe: 'M5',
        initialBalance: 10000, // Default initial balance
        dataSource: 'postgres', // Use postgres for historical data
        overrideParamSet: undefined, // Will be set by optimizer
      };

      const dataLoaderConfig = {
        dataSource: 'postgres' as const,
        databaseUrl: this.config.databaseUrl,
      };

      // Dispatch to appropriate optimizer
      let results: OptimizationResult[] | WalkForwardResult;

      switch (request.method) {
        case 'grid':
          results = await this.runGridSearch(request, backtestConfig, dataLoaderConfig, runId);
          break;
        case 'random':
          results = await this.runRandomSearch(request, backtestConfig, dataLoaderConfig, runId);
          break;
        case 'bayes':
          results = await this.runBayesSearch(request, backtestConfig, dataLoaderConfig, runId);
          break;
        case 'walkforward':
          results = await this.runWalkForward(request, backtestConfig, dataLoaderConfig, runId);
          break;
        default:
          throw new Error(`Unsupported optimization method: ${request.method}`);
      }

      // Save results to database
      if (request.saveToDb !== false && !(results instanceof Object && 'totalWindows' in results)) {
        // Only save individual results, not walk-forward results (handled separately)
        const resultArray = results as OptimizationResult[];
        for (const result of resultArray) {
          result.runId = runId;
          await this.resultStore.saveResult(result);
        }
      }

      // Update run status
      await this.resultStore.updateRunStatus(runId, 'completed');

      logger.info(`[OptimizerEngine] Optimization completed: runId=${runId}, results=${Array.isArray(results) ? results.length : 1}`);

      return results;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[OptimizerEngine] Optimization failed: ${errorMsg}`, error);
      
      await this.resultStore.updateRunStatus(runId, 'failed', errorMsg);
      
      throw error;
    }
  }

  /**
   * Run grid search optimization
   */
  private async runGridSearch(
    request: OptimizationRequest,
    backtestConfig: BacktestConfig,
    dataLoaderConfig: any,
    runId: number
  ): Promise<OptimizationResult[]> {
    const optimizer = new GridSearchOptimizer();
    const results = await optimizer.optimize(request, backtestConfig, dataLoaderConfig);
    
    // Update runId for all results
    results.forEach(r => { r.runId = runId; });
    
    return results;
  }

  /**
   * Run random search optimization
   */
  private async runRandomSearch(
    request: OptimizationRequest,
    backtestConfig: BacktestConfig,
    dataLoaderConfig: any,
    runId: number
  ): Promise<OptimizationResult[]> {
    const optimizer = new RandomSearchOptimizer();
    const results = await optimizer.optimize(request, backtestConfig, dataLoaderConfig);
    
    // Update runId for all results
    results.forEach(r => { r.runId = runId; });
    
    return results;
  }

  /**
   * Run Bayesian optimization
   */
  private async runBayesSearch(
    request: OptimizationRequest,
    backtestConfig: BacktestConfig,
    dataLoaderConfig: any,
    runId: number
  ): Promise<OptimizationResult[]> {
    const optimizer = new BayesOptimizer();
    const results = await optimizer.optimize(request, backtestConfig, dataLoaderConfig);
    
    // Update runId for all results
    results.forEach(r => { r.runId = runId; });
    
    return results;
  }

  /**
   * Run walk-forward optimization
   */
  private async runWalkForward(
    request: OptimizationRequest,
    backtestConfig: BacktestConfig,
    dataLoaderConfig: any,
    runId: number
  ): Promise<WalkForwardResult> {
    const optimizer = new WalkForwardOptimizer();
    const result = await optimizer.optimize(request, backtestConfig, dataLoaderConfig);
    
    // Store walk-forward result as optimization results (one per window)
    if (request.saveToDb !== false) {
      for (const window of result.windows) {
        const optimizationResult: OptimizationResult = {
          runId,
          paramSet: window.bestParamSet,
          metrics: {
            ...window.outSampleMetrics,
            outOfSampleWinRate: window.outSampleMetrics.winRate,
            outOfSampleProfitFactor: window.outSampleMetrics.profitFactor,
            parameterStability: window.stability,
          },
          equityCurve: [], // Walk-forward doesn't store full equity curve per window
          trades: [],
          rankedScore: window.stability, // Use stability as score
        };
        await this.resultStore.saveResult(optimizationResult);
      }
    }
    
    return result;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.resultStore.close();
  }
}

