/**
 * GridSearchOptimizer - Grid search optimization (Trading Engine v11)
 * 
 * Tries every combination from parameter grid
 */

import { Logger } from '@providencex/shared-utils';
import { BacktestRunner } from '../backtesting/BacktestRunner';
import { BacktestConfig } from '../backtesting/types';
import {
  OptimizationRequest,
  OptimizationResult,
  OptimizationMetrics,
  SMC_V2_ParamSet,
  ParameterGrid,
} from './OptimizationTypes';
import { convertBacktestToMetrics, convertBacktestTrades, convertEquityCurve, calculateRankedScore } from './OptimizationUtils';
import { getOptimizerConfig } from './OptimizationConfig';

const logger = new Logger('GridSearchOptimizer');

/**
 * GridSearchOptimizer - Exhaustive grid search
 */
export class GridSearchOptimizer {
  private config = getOptimizerConfig();

  /**
   * Run grid search optimization
   */
  async optimize(
    request: OptimizationRequest,
    backtestConfig: BacktestConfig,
    dataLoaderConfig: {
      dataSource: 'csv' | 'postgres' | 'mock';
      csvPath?: string;
      databaseUrl?: string;
    }
  ): Promise<OptimizationResult[]> {
    if (!request.paramGrid) {
      throw new Error('Grid search requires paramGrid in request');
    }

    logger.info(`[GridSearchOptimizer] Starting grid search with ${this.countCombinations(request.paramGrid)} combinations`);

    // Generate all parameter combinations
    const paramSets = this.generateParamCombinations(request.paramGrid);
    
    logger.info(`[GridSearchOptimizer] Generated ${paramSets.length} parameter sets`);

    // Run backtests for each parameter set (parallelized)
    const results: OptimizationResult[] = [];
    const maxParallel = request.parallelRuns || this.config.maxParallelRuns || 4;
    
    // Process in batches
    for (let i = 0; i < paramSets.length; i += maxParallel) {
      const batch = paramSets.slice(i, i + maxParallel);
      const batchResults = await Promise.all(
        batch.map(async (paramSet, index) => {
          const globalIndex = i + index;
          logger.info(`[GridSearchOptimizer] Running backtest ${globalIndex + 1}/${paramSets.length} with param set: ${JSON.stringify(paramSet)}`);
          
          try {
            // Create backtest config with parameter override
            const testConfig: BacktestConfig = {
              ...backtestConfig,
              overrideParamSet: paramSet,
            };

            // Run backtest
            const runner = new BacktestRunner(testConfig, dataLoaderConfig);
            const backtestResult = await runner.run();

            // Convert to optimization metrics
            const metrics = convertBacktestToMetrics(backtestResult);
            const trades = convertBacktestTrades(backtestResult.trades);
            const equityCurve = convertEquityCurve(backtestResult.equityCurve);

            // Calculate ranked score
            const rankedScore = calculateRankedScore(metrics, this.config.scoringWeights);

            return {
              runId: 0, // Will be set by caller
              paramSet,
              metrics,
              equityCurve,
              trades,
              rankedScore,
            };
          } catch (error) {
            logger.error(`[GridSearchOptimizer] Backtest failed for param set ${globalIndex + 1}`, error);
            // Return failed result with zero score
            return {
              runId: 0,
              paramSet,
              metrics: this.createEmptyMetrics(),
              equityCurve: [],
              trades: [],
              rankedScore: -Infinity, // Worst possible score
            };
          }
        })
      );

      results.push(...batchResults);
    }

    // Sort by ranked score (best first)
    results.sort((a, b) => b.rankedScore - a.rankedScore);

    logger.info(`[GridSearchOptimizer] Grid search completed. Best score: ${results[0]?.rankedScore || 0}`);

    return results;
  }

  /**
   * Generate all parameter combinations from grid
   */
  private generateParamCombinations(grid: ParameterGrid): SMC_V2_ParamSet[] {
    const keys = Object.keys(grid);
    const values = keys.map(key => grid[key]);

    // Generate cartesian product
    const combinations: any[] = [];
    this.cartesianProduct(values, 0, {}, keys, combinations);

    return combinations;
  }

  /**
   * Generate cartesian product recursively
   */
  private cartesianProduct(
    arrays: any[][],
    index: number,
    current: any,
    keys: string[],
    result: any[]
  ): void {
    if (index === arrays.length) {
      result.push({ ...current });
      return;
    }

    for (const value of arrays[index]) {
      current[keys[index]] = value;
      this.cartesianProduct(arrays, index + 1, current, keys, result);
    }
  }

  /**
   * Count total combinations in grid
   */
  private countCombinations(grid: ParameterGrid): number {
    return Object.values(grid).reduce((count, values) => count * values.length, 1);
  }

  /**
   * Create empty metrics for failed backtests
   */
  private createEmptyMetrics(): OptimizationMetrics {
    return {
      winRate: 0,
      totalNetProfit: 0,
      profitFactor: 0,
      expectancy: 0,
      avgWinner: 0,
      avgLoser: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      recoveryFactor: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      tradeFrequency: 0,
      losingStreakMax: 0,
      losingStreakAvg: 0,
    };
  }
}

