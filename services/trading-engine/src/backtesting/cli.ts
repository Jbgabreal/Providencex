/**
 * CLI entry point for backtesting
 * 
 * Usage:
 *   pnpm backtest --symbol XAUUSD --from 2024-01-01 --to 2024-12-31 --data-source mt5
 *   pnpm backtest --symbol EURUSD --from 2024-01-01 --to 2024-12-31 --strategy low --data-source mt5
 *   pnpm backtest --symbol XAUUSD,EURUSD --from 2024-01-01 --to 2024-12-31 --strategy low,high --data-source postgres
 */

import { BacktestRunner } from './BacktestRunner';
import { BacktestConfig } from './types';
import { Logger } from '@providencex/shared-utils';
import * as path from 'path';
import * as fs from 'fs/promises';

const logger = new Logger('BacktestCLI');

/**
 * Parse command-line arguments
 */
function parseArgs(): {
  symbol: string | string[];
  strategies: ('low' | 'high')[];
  from: string;
  to: string;
  dataSource: 'csv' | 'postgres' | 'mt5' | 'mock';
  csvPath?: string;
  initialBalance: number;
  outputDir?: string;
} {
  const args = process.argv.slice(2);
  
  let symbol: string | string[] = 'XAUUSD';
  let strategies: ('low' | 'high')[] = ['low'];
  let from = '2024-01-01';
  let to = '2024-12-31';
  let dataSource: 'csv' | 'postgres' | 'mt5' | 'mock' = 'mock';
  let csvPath: string | undefined;
  let initialBalance = 10000;
  let outputDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--symbol':
      case '-s':
        if (nextArg) {
          symbol = nextArg.includes(',') ? nextArg.split(',').map(s => s.trim()) : nextArg;
        }
        i++;
        break;

      case '--strategy':
        if (nextArg) {
          strategies = nextArg.includes(',')
            ? nextArg.split(',').map(s => s.trim()) as ('low' | 'high')[]
            : [nextArg as 'low' | 'high'];
        }
        i++;
        break;

      case '--from':
      case '-f':
        if (nextArg) {
          from = nextArg;
        }
        i++;
        break;

      case '--to':
      case '-t':
        if (nextArg) {
          to = nextArg;
        }
        i++;
        break;

      case '--data-source':
        if (nextArg) {
          dataSource = nextArg as 'csv' | 'postgres' | 'mt5' | 'mock';
        }
        i++;
        break;

      case '--csv-path':
        if (nextArg) {
          csvPath = nextArg;
        }
        i++;
        break;

      case '--initial-balance':
      case '-b':
        if (nextArg) {
          initialBalance = parseFloat(nextArg);
        }
        i++;
        break;

      case '--output-dir':
      case '-o':
        if (nextArg) {
          outputDir = nextArg;
        }
        i++;
        break;

      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return {
    symbol,
    strategies,
    from,
    to,
    dataSource,
    csvPath,
    initialBalance,
    outputDir,
  };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Trading Engine v5 - Backtesting CLI

Usage:
  pnpm backtest [options]

Options:
  --symbol, -s <SYMBOL>          Trading symbol(s) (e.g., XAUUSD or XAUUSD,EURUSD)
  --strategy <STRATEGY>          Strategy to test: low, high, or low,high (default: low)
  --from, -f <DATE>              Start date (YYYY-MM-DD) (default: 2024-01-01)
  --to, -t <DATE>                End date (YYYY-MM-DD) (default: 2024-12-31)
  --data-source <SOURCE>         Data source: csv, postgres, mt5, or mock (default: mock)
  --csv-path <PATH>              Path to CSV file (required if --data-source=csv)
  --initial-balance, -b <AMOUNT> Initial account balance (default: 10000)
  --output-dir, -o <DIR>         Output directory (default: ./backtests/run_<timestamp>)
  --help, -h                     Show this help message

Examples:
  # Run backtest on XAUUSD with default settings (mock data)
  pnpm backtest --symbol XAUUSD

  # Run backtest with custom date range
  pnpm backtest --symbol XAUUSD --from 2024-01-01 --to 2024-12-31

  # Run backtest with CSV data
  pnpm backtest --symbol XAUUSD --data-source csv --csv-path ./data/xauusd.csv

  # Run backtest with MT5 live historical data
  pnpm backtest --symbol XAUUSD --from 2024-10-21 --to 2024-11-21 --data-source mt5

  # Run backtest with Postgres data
  pnpm backtest --symbol XAUUSD --data-source postgres

  # Run backtest with multiple strategies
  pnpm backtest --symbol XAUUSD --strategy low,high

  # Run backtest with multiple symbols
  pnpm backtest --symbol XAUUSD,EURUSD,GBPUSD
`);
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  let runner: BacktestRunner | null = null;
  let outputDir: string | undefined;
  
  // Handle graceful shutdown - save partial results if terminated
  const shutdownHandler = async (signal: string) => {
    console.log(`\n\n[SIGINT/SIGTERM] Received ${signal} - gracefully shutting down...\n`);
    
    // Mark runner as terminated so it stops processing new candles
    if (runner) {
      runner.markTerminated();
    }
    
    // Wait a moment for the current candle to finish processing
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Save partial results if available
    if (runner && runner.hasPartialResults()) {
      try {
        const partialOutputDir = outputDir || path.join(
          process.cwd(),
          'backtests',
          `run_partial_${Date.now()}`
        );
        await runner.savePartialResults(partialOutputDir);
        console.log(`\n✅ Partial results saved to: ${partialOutputDir}\n`);
      } catch (error) {
        logger.error('[BacktestCLI] Failed to save partial results', error);
        console.error('\n❌ Failed to save partial results\n');
      }
    } else {
      console.log('\n⚠️  No partial results to save (backtest just started or no trades yet)\n');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdownHandler('SIGINT'));
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));

  try {
    const args = parseArgs();

    logger.info('[BacktestCLI] Starting backtest...');
    logger.info('[BacktestCLI] Arguments:', args);

    // Validate arguments
    if (args.dataSource === 'csv' && !args.csvPath) {
      logger.error('[BacktestCLI] --csv-path is required when --data-source=csv');
      process.exit(1);
    }

    // Build backtest config
    const config: BacktestConfig = {
      symbol: args.symbol,
      strategies: args.strategies,
      startDate: args.from,
      endDate: args.to,
      timeframe: 'M5',
      initialBalance: args.initialBalance,
      dataSource: args.dataSource,
      csvPath: args.csvPath,
    };

    // Build data loader config
    const dataLoaderConfig = {
      dataSource: args.dataSource,
      csvPath: args.csvPath,
      databaseUrl: process.env.DATABASE_URL,
      mt5BaseUrl: process.env.MT5_CONNECTOR_URL || 'http://localhost:3030',
    };

    // Create and run backtest
    runner = new BacktestRunner(config, dataLoaderConfig);
    const result = await runner.run();

    // Determine output directory
    outputDir = args.outputDir || path.join(
      process.cwd(),
      'backtests',
      `run_${result.runId}`
    );

    // Save results
    await runner.saveResults(outputDir);

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('BACKTEST RESULTS');
    console.log('='.repeat(80));
    console.log(`Run ID: ${result.runId}`);
    console.log(`Date Range: ${args.from} to ${args.to}`);
    console.log(`Symbol(s): ${Array.isArray(args.symbol) ? args.symbol.join(', ') : args.symbol}`);
    console.log(`Strategy(ies): ${args.strategies.join(', ')}`);
    console.log(`Runtime: ${(result.runtimeMs / 1000).toFixed(2)}s`);
    console.log('\n--- Statistics ---');
    console.log(`Total Trades: ${result.stats.totalTrades}`);
    console.log(`Win Rate: ${result.stats.winRate.toFixed(2)}%`);
    
    // Display SMC Core Statistics
    if (result.stats.smcStats) {
      console.log(`\n--- SMC Core Statistics ---`);
      console.log(`Total Evaluations: ${result.stats.smcStats.totalEvaluations}`);
      
      // HTF Stats
      const htf = result.stats.smcStats.htf;
      console.log(`\nHTF (H4):`);
      console.log(`  Swings: ${htf.totalSwings} (${htf.swingHighs} highs, ${htf.swingLows} lows) - Avg: ${htf.averageSwingsPerEvaluation.toFixed(2)}/eval`);
      console.log(`  BOS: ${htf.totalBOS} (${htf.bullishBOS} bullish, ${htf.bearishBOS} bearish)`);
      console.log(`  CHoCH: ${htf.totalCHoCH} (${htf.bullishCHoCH} bullish, ${htf.bearishCHoCH} bearish)`);
      console.log(`  MSB: ${htf.totalMSB} (${htf.bullishMSB} bullish, ${htf.bearishMSB} bearish)`);
      console.log(`  Trend: ${htf.trendBullish} bullish, ${htf.trendBearish} bearish, ${htf.trendSideways} sideways`);
      
      // ITF Stats
      const itf = result.stats.smcStats.itf;
      console.log(`\nITF (M15):`);
      console.log(`  Swings: ${itf.totalSwings} (${itf.swingHighs} highs, ${itf.swingLows} lows) - Avg: ${itf.averageSwingsPerEvaluation.toFixed(2)}/eval`);
      console.log(`  BOS: ${itf.totalBOS} (${itf.bullishBOS} bullish, ${itf.bearishBOS} bearish)`);
      console.log(`  CHoCH: ${itf.totalCHoCH} (${itf.bullishCHoCH} bullish, ${itf.bearishCHoCH} bearish)`);
      console.log(`  MSB: ${itf.totalMSB} (${itf.bullishMSB} bullish, ${itf.bearishMSB} bearish)`);
      console.log(`  Trend: ${itf.trendBullish} bullish, ${itf.trendBearish} bearish, ${itf.trendSideways} sideways`);
      
      // LTF Stats
      const ltf = result.stats.smcStats.ltf;
      console.log(`\nLTF (M1):`);
      console.log(`  Swings: ${ltf.totalSwings} (${ltf.swingHighs} highs, ${ltf.swingLows} lows) - Avg: ${ltf.averageSwingsPerEvaluation.toFixed(2)}/eval`);
      console.log(`  BOS: ${ltf.totalBOS} (${ltf.bullishBOS} bullish, ${ltf.bearishBOS} bearish)`);
      console.log(`  CHoCH: ${ltf.totalCHoCH} (${ltf.bullishCHoCH} bullish, ${ltf.bearishCHoCH} bearish)`);
      console.log(`  MSB: ${ltf.totalMSB} (${ltf.bullishMSB} bullish, ${ltf.bearishMSB} bearish)`);
      console.log(`  Trend: ${ltf.trendBullish} bullish, ${ltf.trendBearish} bearish, ${ltf.trendSideways} sideways`);
    } else {
      console.log(`\n--- SMC Core Statistics ---`);
      console.log(`(SMC stats not available - calculation may have failed or was skipped)`);
    }
    console.log(`Total PnL: $${result.stats.totalPnL.toFixed(2)}`);
    console.log(`Profit Factor: ${result.stats.profitFactor.toFixed(2)}`);
    console.log(`Max Drawdown: $${result.stats.maxDrawdown.toFixed(2)} (${result.stats.maxDrawdownPercent.toFixed(2)}%)`);
    console.log(`Max Consecutive Losses: ${result.stats.maxConsecutiveLosses}`);
    console.log(`Average R:R: ${result.stats.averageRr.toFixed(2)}`);
    console.log(`Expectancy: $${result.stats.expectancy.toFixed(2)}`);
    console.log(`\nInitial Balance: $${result.initialBalance.toFixed(2)}`);
    console.log(`Final Balance: $${result.finalBalance.toFixed(2)}`);
    console.log(`Total Return: $${result.totalReturn.toFixed(2)} (${result.totalReturnPercent.toFixed(2)}%)`);
    console.log('\n--- Per Symbol ---');
    for (const [symbol, stats] of Object.entries(result.stats.perSymbolStats)) {
      console.log(
        `  ${symbol}: ${stats.trades} trades, $${stats.pnl.toFixed(2)} PnL, ${stats.winRate.toFixed(2)}% win rate`
      );
    }
    console.log('\n--- Per Strategy ---');
    for (const [strategy, stats] of Object.entries(result.stats.perStrategyStats)) {
      console.log(
        `  ${strategy}: ${stats.trades} trades, $${stats.pnl.toFixed(2)} PnL, ${stats.winRate.toFixed(2)}% win rate`
      );
    }
    console.log('\n' + '='.repeat(80));
    console.log(`Results saved to: ${outputDir}`);
    console.log('='.repeat(80) + '\n');

    process.exit(0);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`[BacktestCLI] Backtest failed: ${errorMsg}`, error);
    console.error(`\n❌ Backtest failed: ${errorMsg}\n`);
    process.exit(1);
  }
}

// Run CLI
main().catch((error) => {
  logger.error('[BacktestCLI] Fatal error:', error);
  process.exit(1);
});


