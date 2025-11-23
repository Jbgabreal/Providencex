/**
 * RandomSearchOptimizer - Random search optimization (Trading Engine v11)
 * 
 * Randomly samples parameter space
 */

import { Logger } from '@providencex/shared-utils';
import { BacktestRunner } from '../backtesting/BacktestRunner';
import { BacktestConfig } from '../backtesting/types';
import {
  OptimizationRequest,
  OptimizationResult,
  OptimizationMetrics,
  SMC_V2_ParamSet,
  ParameterRanges,
} from './OptimizationTypes';
import { convertBacktestToMetrics, convertBacktestTrades, convertEquityCurve, calculateRankedScore } from './OptimizationUtils';
import { getOptimizerConfig, DEFAULT_PARAM_RANGES } from './OptimizationConfig';

const logger = new Logger('RandomSearchOptimizer');

/**
 * RandomSearchOptimizer - Random parameter sampling
 */
export class RandomSearchOptimizer {
  private config = getOptimizerConfig();

  /**
   * Run random search optimization
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
    const paramRanges = request.paramRanges || DEFAULT_PARAM_RANGES;
    const trials = request.trials || this.config.defaultTrials || 50;

    logger.info(`[RandomSearchOptimizer] Starting random search with ${trials} trials`);

    // Generate random parameter sets
    const paramSets: SMC_V2_ParamSet[] = [];
    for (let i = 0; i < trials; i++) {
      paramSets.push(this.generateRandomParamSet(paramRanges));
    }

    logger.info(`[RandomSearchOptimizer] Generated ${paramSets.length} random parameter sets`);

    // Run backtests for each parameter set (parallelized)
    const results: OptimizationResult[] = [];
    const maxParallel = request.parallelRuns || this.config.maxParallelRuns || 4;

    // Process in batches
    for (let i = 0; i < paramSets.length; i += maxParallel) {
      const batch = paramSets.slice(i, i + maxParallel);
      const batchResults = await Promise.all(
        batch.map(async (paramSet, index) => {
          const globalIndex = i + index;
          logger.info(`[RandomSearchOptimizer] Running backtest ${globalIndex + 1}/${paramSets.length} with param set: ${JSON.stringify(paramSet)}`);
          
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
            logger.error(`[RandomSearchOptimizer] Backtest failed for param set ${globalIndex + 1}`, error);
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

    logger.info(`[RandomSearchOptimizer] Random search completed. Best score: ${results[0]?.rankedScore || 0}`);

    return results;
  }

  /**
   * Generate random parameter set from ranges
   */
  private generateRandomParamSet(ranges: ParameterRanges): SMC_V2_ParamSet {
    const paramSet: SMC_V2_ParamSet = {};

    for (const [key, range] of Object.entries(ranges)) {
      const { min, max, type = 'float' } = range;
      
      if (type === 'int') {
        paramSet[key as keyof SMC_V2_ParamSet] = Math.floor(Math.random() * (max - min + 1)) + min as any;
      } else if (type === 'boolean') {
        paramSet[key as keyof SMC_V2_ParamSet] = Math.random() > 0.5 as any;
      } else {
        // float
        const value = Math.random() * (max - min) + min;
        paramSet[key as keyof SMC_V2_ParamSet] = parseFloat(value.toFixed(4)) as any;
      }
    }

    return paramSet;
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

