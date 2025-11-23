/**
 * OptimizerRunner - CLI runner for optimization (Trading Engine v11)
 * 
 * Command-line interface for running optimization jobs
 */

import { Logger } from '@providencex/shared-utils';
import { OptimizerEngine } from './OptimizerEngine';
import {
  OptimizationRequest,
  OptimizationMethod,
  ParameterGrid,
  ParameterRanges,
} from './OptimizationTypes';
import { getOptimizerConfig, DEFAULT_PARAM_RANGES } from './OptimizationConfig';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = new Logger('OptimizerRunner');

/**
 * OptimizerRunner - CLI runner for optimization
 */
export class OptimizerRunner {
  private engine: OptimizerEngine;
  private config = getOptimizerConfig();

  constructor() {
    this.engine = new OptimizerEngine();
  }

  /**
   * Run optimization from CLI arguments
   */
  async run(args: {
    method: OptimizationMethod;
    symbol: string | string[];
    from: string;
    to: string;
    outOfSampleFrom?: string;
    outOfSampleTo?: string;
    paramGridPath?: string; // Path to JSON file with parameter grid
    paramRangesPath?: string; // Path to JSON file with parameter ranges
    trials?: number;
    walkForwardWindows?: number;
    walkForwardStep?: number;
    population?: number;
    generations?: number;
    exportCsv?: boolean;
    saveDb?: boolean;
    parallelRuns?: number;
  }): Promise<void> {
    logger.info('[OptimizerRunner] Starting optimization runner');

    try {
      // Initialize database
      await this.engine.initialize();

      // Parse parameter configuration
      let paramGrid: ParameterGrid | undefined;
      let paramRanges: ParameterRanges | undefined;

      if (args.paramGridPath) {
        const gridContent = await fs.readFile(args.paramGridPath, 'utf-8');
        paramGrid = JSON.parse(gridContent);
      }

      if (args.paramRangesPath) {
        const rangesContent = await fs.readFile(args.paramRangesPath, 'utf-8');
        paramRanges = JSON.parse(rangesContent);
      } else if (args.method === 'random' || args.method === 'bayes') {
        // Use default ranges if not provided
        paramRanges = DEFAULT_PARAM_RANGES;
      }

      // Build optimization request
      const request: OptimizationRequest = {
        method: args.method,
        symbol: Array.isArray(args.symbol) ? args.symbol : [args.symbol],
        dateRange: {
          from: args.from,
          to: args.to,
        },
        outOfSampleRange: args.outOfSampleFrom && args.outOfSampleTo
          ? {
              from: args.outOfSampleFrom,
              to: args.outOfSampleTo,
            }
          : undefined,
        paramGrid,
        paramRanges,
        trials: args.trials || (args.method === 'random' || args.method === 'bayes' ? this.config.defaultTrials : undefined),
        walkForwardWindows: args.walkForwardWindows || this.config.defaultWalkForwardWindows,
        walkForwardStep: args.walkForwardStep || this.config.defaultWalkForwardStep,
        population: args.population,
        generations: args.generations,
        saveToDb: args.saveDb !== false,
        exportCsv: args.exportCsv === true,
        parallelRuns: args.parallelRuns || this.config.maxParallelRuns,
      };

      logger.info(`[OptimizerRunner] Optimization request:`, {
        method: request.method,
        symbol: Array.isArray(request.symbol) ? request.symbol.join(',') : request.symbol,
        dateRange: request.dateRange,
        trials: request.trials,
      });

      // Run optimization
      const results = await this.engine.optimize(request);

      // Export results if requested
      if (args.exportCsv && !(results instanceof Object && 'totalWindows' in results)) {
        const resultArray = results as any[];
        const csvPath = await this.exportResultsToCsv(resultArray, args.method);
        logger.info(`[OptimizerRunner] Results exported to: ${csvPath}`);
      }

      // Display summary
      this.displaySummary(results);

      logger.info('[OptimizerRunner] Optimization completed successfully');

      // Close database connection
      await this.engine.close();
    } catch (error) {
      logger.error('[OptimizerRunner] Optimization failed', error);
      await this.engine.close();
      throw error;
    }
  }

  /**
   * Export results to CSV
   */
  private async exportResultsToCsv(results: any[], method: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `optimization_${method}_${timestamp}.csv`;
    const outputDir = path.join(process.cwd(), 'optimization_results');
    
    // Create output directory if it doesn't exist
    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    const filepath = path.join(outputDir, filename);

    // Build CSV header
    const headers = [
      'Rank',
      'Score',
      'WinRate',
      'ProfitFactor',
      'SharpeRatio',
      'MaxDrawdownPct',
      'TotalNetProfit',
      ...Object.keys(results[0]?.paramSet || {}),
    ];

    // Build CSV rows
    const rows = results.map((result, index) => {
      const row = [
        index + 1,
        result.rankedScore.toFixed(4),
        (result.metrics.winRate * 100).toFixed(2),
        result.metrics.profitFactor.toFixed(2),
        result.metrics.sharpeRatio.toFixed(2),
        result.metrics.maxDrawdownPct.toFixed(2),
        result.metrics.totalNetProfit.toFixed(2),
        ...Object.values(result.paramSet || {}).map(v => v?.toString() || ''),
      ];
      return row.join(',');
    });

    // Write CSV file
    const csvContent = [headers.join(','), ...rows].join('\n');
    await fs.writeFile(filepath, csvContent, 'utf-8');

    return filepath;
  }

  /**
   * Display optimization summary
   */
  private displaySummary(results: any): void {
    if (results instanceof Object && 'totalWindows' in results) {
      // Walk-forward result
      const wfResult = results as any;
      console.log('\n=== Walk-Forward Optimization Summary ===');
      console.log(`Total Windows: ${wfResult.totalWindows}`);
      console.log(`Stability Score: ${wfResult.stabilityScore.toFixed(2)}`);
      console.log(`Average Win Rate: ${(wfResult.averageMetrics.winRate * 100).toFixed(2)}%`);
      console.log(`Average Profit Factor: ${wfResult.averageMetrics.profitFactor.toFixed(2)}`);
      console.log(`Average Sharpe Ratio: ${wfResult.averageMetrics.sharpeRatio.toFixed(2)}`);
      console.log(`\nBest Stable Parameters:`, JSON.stringify(wfResult.bestStableParamSet, null, 2));
    } else {
      // Regular optimization results
      const resultArray = results as any[];
      if (resultArray.length === 0) {
        console.log('\n=== No Results ===');
        return;
      }

      const best = resultArray[0];
      console.log('\n=== Optimization Summary ===');
      console.log(`Total Runs: ${resultArray.length}`);
      console.log(`\nBest Result:`);
      console.log(`  Score: ${best.rankedScore.toFixed(4)}`);
      console.log(`  Win Rate: ${(best.metrics.winRate * 100).toFixed(2)}%`);
      console.log(`  Profit Factor: ${best.metrics.profitFactor.toFixed(2)}`);
      console.log(`  Sharpe Ratio: ${best.metrics.sharpeRatio.toFixed(2)}`);
      console.log(`  Max Drawdown: ${best.metrics.maxDrawdownPct.toFixed(2)}%`);
      console.log(`  Total Net Profit: ${best.metrics.totalNetProfit.toFixed(2)}`);
      console.log(`\nBest Parameters:`, JSON.stringify(best.paramSet, null, 2));
    }
  }
}

