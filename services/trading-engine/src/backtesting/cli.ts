/**
 * CLI entry point for backtesting
 * 
 * Usage:
 *   pnpm backtest --symbol XAUUSD --from 2024-01-01 --to 2024-12-31 --data-source mt5
 *   pnpm backtest --symbol EURUSD --from 2024-01-01 --to 2024-12-31 --strategy low --data-source mt5
 *   pnpm backtest --symbol XAUUSD,EURUSD --from 2024-01-01 --to 2024-12-31 --strategy low,high --data-source postgres
 */

// Load environment variables from .env file (if present)
import dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
// Try multiple paths to find .env (root, trading-engine, or cwd)
// Since __dirname changes based on compiled vs source, try several options
const rootEnvPath = path.join(__dirname, '../../../.env'); // From dist/backtesting to root
const localEnvPath = path.join(__dirname, '../../.env'); // From dist/backtesting to trading-engine
const cwdEnvPath = path.join(process.cwd(), '.env'); // Current working directory

// Try multiple root paths - root .env is critical for ICT model
const rootPaths = [
  path.resolve(process.cwd(), '../../.env'), // From services/trading-engine to root (most common)
  path.resolve(__dirname, '../../../../.env'), // From compiled dist/backtesting to root
  path.resolve(process.cwd(), '../../../.env'), // Alternative root path  
  rootEnvPath, // Original calculation
];

// Load .env files: Try all paths, root takes precedence (loaded last with override)
let rootEnvLoaded = false;
const allPaths = [
  { name: 'cwd', path: cwdEnvPath, isRoot: false },
  { name: 'local', path: localEnvPath, isRoot: false },
  ...rootPaths.map((p, i) => ({ name: `root-${i + 1}`, path: p, isRoot: true })),
];

allPaths.forEach(({ name, path: envPath, isRoot }) => {
  try {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: isRoot }); // Root paths override, local don't
      if (isRoot && !rootEnvLoaded) {
        console.log(`[BacktestCLI] ✅ Loaded root .env from: ${name} (${envPath})`);
        rootEnvLoaded = true;
      }
    }
  } catch (error) {
    // Ignore errors, try next path
  }
});

// If root .env not loaded, warn user
if (!rootEnvLoaded) {
  console.log('[BacktestCLI] ⚠️  WARNING: Root .env file not found!');
  console.log('[BacktestCLI] ICT Model may not work. Check that root .env exists at: ../../.env');
}

// CRITICAL: Ensure SMC v2 is enabled for backtests
if (!process.env.USE_SMC_V2) {
  process.env.USE_SMC_V2 = 'true';
  console.log('[BacktestCLI] USE_SMC_V2 not set, defaulting to true for backtests');
}

// Log ICT Model configuration status
const useICTModel = (process.env.USE_ICT_MODEL || 'false').toLowerCase() === 'true';
if (useICTModel) {
  console.log('[BacktestCLI] ✅ ICT Model ENABLED - USE_ICT_MODEL=true');
  console.log(`[BacktestCLI] ICT_DEBUG=${process.env.ICT_DEBUG || 'false'}`);
  console.log(`[BacktestCLI] SMC_RISK_REWARD=${process.env.SMC_RISK_REWARD || '3'}`);
} else {
  console.log('[BacktestCLI] ⚠️  ICT Model NOT enabled - USE_ICT_MODEL=' + (process.env.USE_ICT_MODEL || 'not set'));
  console.log('[BacktestCLI] Set USE_ICT_MODEL=true in root .env file to enable ICT model');
}

import { BacktestRunner } from './BacktestRunner';
import { BacktestConfig } from './types';
import { Logger } from '@providencex/shared-utils';

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
  let initialBalance = 1000;
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

    // Log ICT Model status before summary
    const useICTModel = (process.env.USE_ICT_MODEL || 'false').toLowerCase() === 'true';
    const ictDebug = (process.env.ICT_DEBUG || 'false').toLowerCase() === 'true';
    const smcRiskReward = process.env.SMC_RISK_REWARD || '3';
    
    console.log('\n' + '='.repeat(80));
    console.log('BACKTEST CONFIGURATION');
    console.log('='.repeat(80));
    console.log(`ICT Model: ${useICTModel ? '✅ ENABLED' : '❌ DISABLED'}`);
    if (useICTModel) {
      console.log(`  ICT_DEBUG: ${ictDebug}`);
      console.log(`  SMC_RISK_REWARD: ${smcRiskReward}`);
    }
    console.log(`USE_ICT_MODEL env var: ${process.env.USE_ICT_MODEL || 'not set'}`);
    console.log('='.repeat(80));

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('BACKTEST RESULTS');
    console.log('='.repeat(80));
    console.log(`Run ID: ${result.runId}`);
    console.log(`Date Range: ${args.from} to ${args.to}`);
    console.log(`Symbol(s): ${Array.isArray(args.symbol) ? args.symbol.join(', ') : args.symbol}`);
    console.log(`Strategy(ies): ${args.strategies.join(', ')}`);
    console.log(`ICT Model: ${useICTModel ? '✅ ENABLED' : '❌ DISABLED'}`);
    console.log(`Runtime: ${(result.runtimeMs / 1000).toFixed(2)}s`);
    console.log('\n--- Statistics ---');
    console.log(`Total Trades: ${result.stats.totalTrades}`);
    console.log(`  Won: ${result.stats.winningTrades}`);
    console.log(`  Lost: ${result.stats.losingTrades}`);
    console.log(`  Break-Even: ${result.stats.breakEvenTrades}`);
    console.log(`Win Rate: ${result.stats.winRate.toFixed(2)}%`);
    
    // Display SMC Core Statistics
    if (result.stats.smcStats) {
      console.log(`\n--- SMC Core Statistics ---`);
      console.log(`Total Evaluations: ${result.stats.smcStats.totalEvaluations}`);
      
      // HTF Stats - Show H4 if ICT model is enabled, otherwise M15
      const useICTModel = process.env.USE_ICT_MODEL === 'true';
      const htfLabel = useICTModel ? 'H4' : 'M15';
      const htf = result.stats.smcStats.htf;
      console.log(`\nHTF (${htfLabel}):`);
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
    
    // Show news guardrail stats
    if (runner) {
      const newsBlocked = runner.getNewsBlockedCount();
      if (newsBlocked > 0) {
        console.log(`News Guardrail: ${newsBlocked} potential trades blocked by high-impact news events`);
      }
    }
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


