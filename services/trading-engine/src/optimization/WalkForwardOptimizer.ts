/**
 * WalkForwardOptimizer - Walk-forward optimization (Trading Engine v11)
 * 
 * Industry-standard walk-forward analysis:
 * 1. Split data into rolling windows (IS + OOS)
 * 2. Optimize on IS
 * 3. Validate on OOS
 * 4. Roll window forward
 * 5. Compute stability metrics
 */

import { Logger } from '@providencex/shared-utils';
import { BacktestRunner } from '../backtesting/BacktestRunner';
import { BacktestConfig } from '../backtesting/types';
import {
  OptimizationRequest,
  OptimizationResult,
  WalkForwardResult,
  WalkForwardWindowResult,
  OptimizationMetrics,
  SMC_V2_ParamSet,
  DateRange,
  ParameterRanges,
} from './OptimizationTypes';
import { convertBacktestToMetrics, convertBacktestTrades, convertEquityCurve, calculateRankedScore } from './OptimizationUtils';
import { getOptimizerConfig, DEFAULT_PARAM_RANGES } from './OptimizationConfig';
import { GridSearchOptimizer } from './GridSearchOptimizer';

const logger = new Logger('WalkForwardOptimizer');

/**
 * WalkForwardOptimizer - Walk-forward analysis
 */
export class WalkForwardOptimizer {
  private config = getOptimizerConfig();

  /**
   * Run walk-forward optimization
   */
  async optimize(
    request: OptimizationRequest,
    backtestConfig: BacktestConfig,
    dataLoaderConfig: {
      dataSource: 'csv' | 'postgres' | 'mock';
      csvPath?: string;
      databaseUrl?: string;
    }
  ): Promise<WalkForwardResult> {
    const windows = request.walkForwardWindows || this.config.defaultWalkForwardWindows || 5;
    const stepDays = request.walkForwardStep || this.config.defaultWalkForwardStep || 30;
    const inSamplePercent = 0.7; // 70% IS, 30% OOS

    logger.info(`[WalkForwardOptimizer] Starting walk-forward analysis: ${windows} windows, ${stepDays} day step`);

    // Parse dates
    const startDate = new Date(request.dateRange.from);
    const endDate = new Date(request.dateRange.to);
    const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const windowSize = totalDays / windows;

    // Generate walk-forward windows
    const windowResults: WalkForwardWindowResult[] = [];

    for (let i = 0; i < windows; i++) {
      const windowStart = new Date(startDate.getTime() + i * stepDays * 24 * 60 * 60 * 1000);
      const windowEnd = new Date(Math.min(windowStart.getTime() + windowSize * 24 * 60 * 60 * 1000, endDate.getTime()));

      if (windowEnd <= windowStart) break;

      const isSize = (windowEnd.getTime() - windowStart.getTime()) * inSamplePercent;
      const isEnd = new Date(windowStart.getTime() + isSize);
      const oosStart = isEnd;
      const oosEnd = windowEnd;

      const inSampleRange: DateRange = {
        from: windowStart.toISOString().split('T')[0],
        to: isEnd.toISOString().split('T')[0],
      };

      const outSampleRange: DateRange = {
        from: oosStart.toISOString().split('T')[0],
        to: oosEnd.toISOString().split('T')[0],
      };

      logger.info(`[WalkForwardOptimizer] Window ${i + 1}/${windows}: IS ${inSampleRange.from} to ${inSampleRange.to}, OOS ${outSampleRange.from} to ${outSampleRange.to}`);

      // Optimize on IS
      const isBacktestConfig: BacktestConfig = {
        ...backtestConfig,
        startDate: inSampleRange.from,
        endDate: inSampleRange.to,
      };

      // Use grid search for IS optimization (or use paramRanges for random/bayes)
      let bestParamSet: SMC_V2_ParamSet;
      let inSampleMetrics: OptimizationMetrics;

      if (request.paramGrid) {
        // Grid search on IS
        const gridOptimizer = new GridSearchOptimizer();
        const gridRequest: OptimizationRequest = {
          ...request,
          method: 'grid',
          dateRange: inSampleRange,
        };
        const isResults = await gridOptimizer.optimize(gridRequest, isBacktestConfig, dataLoaderConfig);
        bestParamSet = isResults[0]?.paramSet || {};
        inSampleMetrics = isResults[0]?.metrics || this.createEmptyMetrics();
      } else {
        // Random search on IS (simpler for walk-forward)
        const randomOptimizer = new (await import('./RandomSearchOptimizer')).RandomSearchOptimizer();
        const randomRequest: OptimizationRequest = {
          ...request,
          method: 'random',
          dateRange: inSampleRange,
          trials: 10, // Fewer trials per window
        };
        const isResults = await randomOptimizer.optimize(randomRequest, isBacktestConfig, dataLoaderConfig);
        bestParamSet = isResults[0]?.paramSet || {};
        inSampleMetrics = isResults[0]?.metrics || this.createEmptyMetrics();
      }

      // Validate on OOS with best IS parameters
      const oosBacktestConfig: BacktestConfig = {
        ...backtestConfig,
        startDate: outSampleRange.from,
        endDate: outSampleRange.to,
        overrideParamSet: bestParamSet,
      };

      const oosRunner = new BacktestRunner(oosBacktestConfig, dataLoaderConfig);
      const oosResult = await oosRunner.run();
      const outSampleMetrics = convertBacktestToMetrics(oosResult);

      // Calculate stability (consistency between IS and OOS)
      const stability = this.calculateStability(inSampleMetrics, outSampleMetrics);

      windowResults.push({
        windowIndex: i,
        inSampleRange,
        outSampleRange,
        bestParamSet,
        inSampleMetrics,
        outSampleMetrics,
        stability,
      });
    }

    // Find most stable parameter set (appears in multiple windows)
    const bestStableParamSet = this.findMostStableParamSet(windowResults);

    // Calculate average metrics across all windows
    const averageMetrics = this.calculateAverageMetrics(windowResults);

    // Calculate overall stability score
    const stabilityScore = windowResults.reduce((sum, w) => sum + w.stability, 0) / windowResults.length;

    const result: WalkForwardResult = {
      symbol: request.symbol,
      totalWindows: windowResults.length,
      windows: windowResults,
      bestStableParamSet,
      averageMetrics,
      stabilityScore,
    };

    logger.info(`[WalkForwardOptimizer] Walk-forward analysis completed. Stability score: ${stabilityScore.toFixed(2)}`);

    return result;
  }

  /**
   * Calculate stability between IS and OOS metrics
   */
  private calculateStability(isMetrics: OptimizationMetrics, oosMetrics: OptimizationMetrics): number {
    // Compare key metrics
    const winRateDiff = Math.abs(isMetrics.winRate - oosMetrics.winRate);
    const profitFactorDiff = Math.abs(isMetrics.profitFactor - oosMetrics.profitFactor);
    const sharpeDiff = Math.abs(isMetrics.sharpeRatio - oosMetrics.sharpeRatio);

    // Normalize differences (0 = identical, 1 = completely different)
    const winRateStability = Math.max(0, 1 - winRateDiff);
    const profitFactorStability = Math.max(0, 1 - profitFactorDiff / 2); // PF can vary more
    const sharpeStability = Math.max(0, 1 - sharpeDiff / 2);

    // Weighted average
    return (winRateStability * 0.4 + profitFactorStability * 0.4 + sharpeStability * 0.2);
  }

  /**
   * Find most stable parameter set across windows
   */
  private findMostStableParamSet(windows: WalkForwardWindowResult[]): SMC_V2_ParamSet {
    // Count parameter occurrences across windows
    const paramCounts = new Map<string, { value: any; count: number }[]>();

    for (const window of windows) {
      const paramSet = window.bestParamSet;
      for (const [key, value] of Object.entries(paramSet)) {
        if (value === undefined || value === null) continue;

        if (!paramCounts.has(key)) {
          paramCounts.set(key, []);
        }

        const counts = paramCounts.get(key)!;
        const existing = counts.find(c => c.value === value);
        if (existing) {
          existing.count++;
        } else {
          counts.push({ value, count: 1 });
        }
      }
    }

    // Select most common value for each parameter
    const stableParamSet: SMC_V2_ParamSet = {};
    for (const [key, counts] of paramCounts.entries()) {
      counts.sort((a, b) => b.count - a.count);
      stableParamSet[key as keyof SMC_V2_ParamSet] = counts[0].value;
    }

    return stableParamSet;
  }

  /**
   * Calculate average metrics across all windows
   */
  private calculateAverageMetrics(windows: WalkForwardWindowResult[]): OptimizationMetrics {
    if (windows.length === 0) {
      return this.createEmptyMetrics();
    }

    const avg = {
      winRate: windows.reduce((sum, w) => sum + w.outSampleMetrics.winRate, 0) / windows.length,
      totalNetProfit: windows.reduce((sum, w) => sum + w.outSampleMetrics.totalNetProfit, 0) / windows.length,
      profitFactor: windows.reduce((sum, w) => sum + w.outSampleMetrics.profitFactor, 0) / windows.length,
      expectancy: windows.reduce((sum, w) => sum + w.outSampleMetrics.expectancy, 0) / windows.length,
      avgWinner: windows.reduce((sum, w) => sum + w.outSampleMetrics.avgWinner, 0) / windows.length,
      avgLoser: windows.reduce((sum, w) => sum + w.outSampleMetrics.avgLoser, 0) / windows.length,
      maxDrawdown: windows.reduce((sum, w) => sum + w.outSampleMetrics.maxDrawdown, 0) / windows.length,
      maxDrawdownPct: windows.reduce((sum, w) => sum + w.outSampleMetrics.maxDrawdownPct, 0) / windows.length,
      recoveryFactor: windows.reduce((sum, w) => sum + w.outSampleMetrics.recoveryFactor, 0) / windows.length,
      sharpeRatio: windows.reduce((sum, w) => sum + w.outSampleMetrics.sharpeRatio, 0) / windows.length,
      sortinoRatio: windows.reduce((sum, w) => sum + w.outSampleMetrics.sortinoRatio, 0) / windows.length,
      tradeFrequency: windows.reduce((sum, w) => sum + w.outSampleMetrics.tradeFrequency, 0) / windows.length,
      losingStreakMax: windows.reduce((sum, w) => sum + w.outSampleMetrics.losingStreakMax, 0) / windows.length,
      losingStreakAvg: windows.reduce((sum, w) => sum + w.outSampleMetrics.losingStreakAvg, 0) / windows.length,
    };

    return avg;
  }

  /**
   * Create empty metrics
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

