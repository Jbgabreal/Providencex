/**
 * BayesOptimizer - Bayesian optimization (Trading Engine v11)
 * 
 * Uses simplified Tree-structured Parzen Estimator (TPE) approach
 * (No heavy ML libraries - lightweight implementation)
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

const logger = new Logger('BayesOptimizer');

/**
 * BayesOptimizer - Bayesian optimization using simplified TPE
 */
export class BayesOptimizer {
  private config = getOptimizerConfig();
  private observedResults: Array<{ paramSet: SMC_V2_ParamSet; score: number }> = [];

  /**
   * Run Bayesian optimization
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
    
    // Start with random exploration (first 20% of trials)
    const explorationTrials = Math.floor(trials * 0.2);
    const exploitationTrials = trials - explorationTrials;

    logger.info(`[BayesOptimizer] Starting Bayesian optimization with ${trials} trials (${explorationTrials} exploration, ${exploitationTrials} exploitation)`);

    this.observedResults = [];

    // Phase 1: Random exploration
    const explorationResults = await this.exploreRandom(paramRanges, explorationTrials, request, backtestConfig, dataLoaderConfig);
    this.observedResults.push(...explorationResults.map(r => ({ paramSet: r.paramSet, score: r.rankedScore })));

    // Phase 2: Bayesian-guided exploitation
    const exploitationResults = await this.exploitBayesian(paramRanges, exploitationTrials, request, backtestConfig, dataLoaderConfig);
    
    // Combine results
    const allResults = [...explorationResults, ...exploitationResults];

    // Sort by ranked score (best first)
    allResults.sort((a, b) => b.rankedScore - a.rankedScore);

    logger.info(`[BayesOptimizer] Bayesian optimization completed. Best score: ${allResults[0]?.rankedScore || 0}`);

    return allResults;
  }

  /**
   * Phase 1: Random exploration
   */
  private async exploreRandom(
    paramRanges: ParameterRanges,
    trials: number,
    request: OptimizationRequest,
    backtestConfig: BacktestConfig,
    dataLoaderConfig: any
  ): Promise<OptimizationResult[]> {
    logger.info(`[BayesOptimizer] Exploration phase: ${trials} random trials`);
    
    const randomOptimizer = new (await import('./RandomSearchOptimizer')).RandomSearchOptimizer();
    const explorationRequest: OptimizationRequest = {
      ...request,
      trials,
      paramRanges,
    };
    
    return await randomOptimizer.optimize(explorationRequest, backtestConfig, dataLoaderConfig);
  }

  /**
   * Phase 2: Bayesian-guided exploitation
   */
  private async exploitBayesian(
    paramRanges: ParameterRanges,
    trials: number,
    request: OptimizationRequest,
    backtestConfig: BacktestConfig,
    dataLoaderConfig: any
  ): Promise<OptimizationResult[]> {
    logger.info(`[BayesOptimizer] Exploitation phase: ${trials} Bayesian-guided trials`);
    
    const results: OptimizationResult[] = [];
    const maxParallel = request.parallelRuns || this.config.maxParallelRuns || 4;

    // Find threshold (median of observed scores)
    const sortedScores = [...this.observedResults].map(r => r.score).sort((a, b) => b - a);
    const threshold = sortedScores[Math.floor(sortedScores.length / 2)];

    // Split into "good" and "bad" results
    const goodResults = this.observedResults.filter(r => r.score >= threshold);
    const badResults = this.observedResults.filter(r => r.score < threshold);

    if (goodResults.length === 0 || badResults.length === 0) {
      // Fallback to random if not enough data
      logger.warn('[BayesOptimizer] Insufficient data for Bayesian guidance - falling back to random');
      const randomOptimizer = new (await import('./RandomSearchOptimizer')).RandomSearchOptimizer();
      const randomRequest: OptimizationRequest = {
        ...request,
        trials,
        paramRanges,
      };
      return await randomOptimizer.optimize(randomRequest, backtestConfig, dataLoaderConfig);
    }

    // Generate new parameter sets using simplified TPE logic
    for (let i = 0; i < trials; i += maxParallel) {
      const batchSize = Math.min(maxParallel, trials - i);
      const batch = await Promise.all(
        Array.from({ length: batchSize }, async () => {
          // Sample from "good" distribution with some exploration
          const paramSet = this.sampleFromGoodDistribution(paramRanges, goodResults, badResults);
          
          try {
            const testConfig: BacktestConfig = {
              ...backtestConfig,
              overrideParamSet: paramSet,
            };

            const runner = new BacktestRunner(testConfig, dataLoaderConfig);
            const backtestResult = await runner.run();

            const metrics = convertBacktestToMetrics(backtestResult);
            const trades = convertBacktestTrades(backtestResult.trades);
            const equityCurve = convertEquityCurve(backtestResult.equityCurve);
            const rankedScore = calculateRankedScore(metrics, this.config.scoringWeights);

            // Update observed results
            this.observedResults.push({ paramSet, score: rankedScore });

            return {
              runId: 0,
              paramSet,
              metrics,
              equityCurve,
              trades,
              rankedScore,
            };
          } catch (error) {
            logger.error(`[BayesOptimizer] Backtest failed in exploitation phase`, error);
            return {
              runId: 0,
              paramSet,
              metrics: this.createEmptyMetrics(),
              equityCurve: [],
              trades: [],
              rankedScore: -Infinity,
            };
          }
        })
      );

      results.push(...batch);
    }

    return results;
  }

  /**
   * Sample parameter set from "good" distribution (simplified TPE)
   */
  private sampleFromGoodDistribution(
    paramRanges: ParameterRanges,
    goodResults: Array<{ paramSet: SMC_V2_ParamSet; score: number }>,
    badResults: Array<{ paramSet: SMC_V2_ParamSet; score: number }>
  ): SMC_V2_ParamSet {
    const paramSet: SMC_V2_ParamSet = {};

    // For each parameter, use weighted sampling from good results
    for (const [key, range] of Object.entries(paramRanges)) {
      const { min, max, type = 'float' } = range;

      // Get values from good results
      const goodValues = goodResults.map(r => (r.paramSet as any)[key]).filter(v => v !== undefined);
      const badValues = badResults.map(r => (r.paramSet as any)[key]).filter(v => v !== undefined);

      if (goodValues.length === 0) {
        // Fallback to random
        paramSet[key as keyof SMC_V2_ParamSet] = type === 'int' 
          ? Math.floor(Math.random() * (max - min + 1)) + min as any
          : (Math.random() * (max - min) + min) as any;
      } else {
        // Sample from good values with some variance (exploration)
        const randomGood = goodValues[Math.floor(Math.random() * goodValues.length)];
        const variance = (max - min) * 0.1; // 10% variance
        let value: number;

        if (type === 'int') {
          value = Math.round(randomGood + (Math.random() - 0.5) * variance * 2);
          value = Math.max(min, Math.min(max, value));
        } else {
          value = randomGood + (Math.random() - 0.5) * variance * 2;
          value = Math.max(min, Math.min(max, value));
          value = parseFloat(value.toFixed(4));
        }

        paramSet[key as keyof SMC_V2_ParamSet] = value as any;
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

