/**
 * Batch Backtest Tool - Run multiple monthly backtests and analyze results
 * 
 * Usage:
 *   pnpm tsx src/tools/batchBacktest.ts --symbol XAUUSD --data-source postgres
 *   pnpm tsx src/tools/batchBacktest.ts --symbol XAUUSD --data-source mt5 --year 2023
 */

import dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs/promises';
import { BacktestRunner } from '../backtesting/BacktestRunner';
import { BacktestConfig } from '../backtesting/types';
import { HistoricalDataLoader } from '../backtesting/HistoricalDataLoader';
import { Logger } from '@providencex/shared-utils';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const logger = new Logger('BatchBacktest');

interface MonthlyResult {
  month: string;
  startDate: string;
  endDate: string;
  trades: number;
  winRate: number;
  totalPnL: number;
  profitFactor: number;
  avgRR: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  totalReturn: number;
  totalReturnPercent: number;
  expectancy: number;
  runtimeMs: number;
  success: boolean;
  error?: string;
}

interface AggregatedResults {
  months: MonthlyResult[];
  summary: {
    totalMonths: number;
    profitableMonths: number;
    losingMonths: number;
    totalTrades: number;
    avgTradesPerMonth: number;
    avgWinRate: number;
    totalPnL: number;
    avgMonthlyReturn: number;
    avgProfitFactor: number;
    avgRR: number;
    maxDrawdown: number;
    maxDrawdownPercent: number;
    bestMonth: MonthlyResult | null;
    worstMonth: MonthlyResult | null;
    profitableMonthsList: string[];
    losingMonthsList: string[];
  };
}

/**
 * Generate 12 monthly date ranges for a given year
 */
function generateMonthlyRanges(year: number): Array<{ start: string; end: string; month: string }> {
  const ranges: Array<{ start: string; end: string; month: string }> = [];
  
  for (let month = 1; month <= 12; month++) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // Last day of the month
    
    ranges.push({
      start: startDate.toISOString().split('T')[0],
      end: endDate.toISOString().split('T')[0],
      month: `${year}-${String(month).padStart(2, '0')}`,
    });
  }
  
  return ranges;
}

/**
 * Run a single monthly backtest
 */
async function runMonthlyBacktest(
  symbol: string,
  startDate: string,
  endDate: string,
  month: string,
  dataSource: 'csv' | 'postgres' | 'mt5' | 'mock',
  csvPath?: string
): Promise<MonthlyResult> {
  const startTime = Date.now();
  
  try {
    logger.info(`[BatchBacktest] Running backtest for ${month} (${startDate} to ${endDate})`);
    
    const config: BacktestConfig = {
      symbol,
      strategies: ['low'],
      startDate,
      endDate,
      timeframe: 'M5',
      initialBalance: 10000,
      dataSource,
      csvPath,
    };
    
    const dataLoaderConfig = {
      dataSource,
      csvPath,
      databaseUrl: process.env.DATABASE_URL,
      mt5BaseUrl: process.env.MT5_CONNECTOR_URL || 'http://localhost:3030',
    };
    
    const runner = new BacktestRunner(config, dataLoaderConfig);
    const result = await runner.run();
    
    const runtimeMs = Date.now() - startTime;
    
    return {
      month,
      startDate,
      endDate,
      trades: result.stats.totalTrades,
      winRate: result.stats.winRate,
      totalPnL: result.stats.totalPnL,
      profitFactor: result.stats.profitFactor,
      avgRR: result.stats.averageRr,
      maxDrawdown: result.stats.maxDrawdown,
      maxDrawdownPercent: result.stats.maxDrawdownPercent,
      totalReturn: result.totalReturn,
      totalReturnPercent: result.totalReturnPercent,
      expectancy: result.stats.expectancy,
      runtimeMs,
      success: true,
    };
  } catch (error) {
    const runtimeMs = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`[BatchBacktest] Error running backtest for ${month}: ${errorMsg}`);
    
    return {
      month,
      startDate,
      endDate,
      trades: 0,
      winRate: 0,
      totalPnL: 0,
      profitFactor: 0,
      avgRR: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      totalReturn: 0,
      totalReturnPercent: 0,
      expectancy: 0,
      runtimeMs,
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Aggregate results from all months
 */
function aggregateResults(months: MonthlyResult[]): AggregatedResults['summary'] {
  const successfulMonths = months.filter(m => m.success);
  const profitableMonths = successfulMonths.filter(m => m.totalPnL > 0);
  const losingMonths = successfulMonths.filter(m => m.totalPnL <= 0);
  
  const totalTrades = successfulMonths.reduce((sum, m) => sum + m.trades, 0);
  const totalPnL = successfulMonths.reduce((sum, m) => sum + m.totalPnL, 0);
  const totalReturn = successfulMonths.reduce((sum, m) => sum + m.totalReturnPercent, 0);
  
  const avgWinRate = successfulMonths.length > 0
    ? successfulMonths.reduce((sum, m) => sum + m.winRate, 0) / successfulMonths.length
    : 0;
  
  const avgProfitFactor = successfulMonths.length > 0
    ? successfulMonths.reduce((sum, m) => sum + m.profitFactor, 0) / successfulMonths.length
    : 0;
  
  const avgRR = successfulMonths.length > 0
    ? successfulMonths.reduce((sum, m) => sum + m.avgRR, 0) / successfulMonths.length
    : 0;
  
  const maxDrawdown = Math.max(...successfulMonths.map(m => m.maxDrawdown));
  const maxDrawdownPercent = Math.max(...successfulMonths.map(m => m.maxDrawdownPercent));
  
  const bestMonth = profitableMonths.length > 0
    ? profitableMonths.reduce((best, m) => m.totalPnL > best.totalPnL ? m : best)
    : null;
  
  const worstMonth = losingMonths.length > 0
    ? losingMonths.reduce((worst, m) => m.totalPnL < worst.totalPnL ? m : worst)
    : null;
  
  return {
    totalMonths: months.length,
    profitableMonths: profitableMonths.length,
    losingMonths: losingMonths.length,
    totalTrades,
    avgTradesPerMonth: successfulMonths.length > 0 ? totalTrades / successfulMonths.length : 0,
    avgWinRate,
    totalPnL,
    avgMonthlyReturn: successfulMonths.length > 0 ? totalReturn / successfulMonths.length : 0,
    avgProfitFactor,
    avgRR,
    maxDrawdown,
    maxDrawdownPercent,
    bestMonth,
    worstMonth,
    profitableMonthsList: profitableMonths.map(m => m.month),
    losingMonthsList: losingMonths.map(m => m.month),
  };
}

/**
 * Print results in a readable format
 */
function printResults(results: AggregatedResults): void {
  console.log('\n' + '='.repeat(80));
  console.log('BATCH BACKTEST RESULTS - 12 MONTHS ANALYSIS');
  console.log('='.repeat(80));
  
  console.log('\n📊 SUMMARY');
  console.log('-'.repeat(80));
  console.log(`Total Months Tested: ${results.summary.totalMonths}`);
  console.log(`Profitable Months: ${results.summary.profitableMonths} (${((results.summary.profitableMonths / results.summary.totalMonths) * 100).toFixed(1)}%)`);
  console.log(`Losing Months: ${results.summary.losingMonths} (${((results.summary.losingMonths / results.summary.totalMonths) * 100).toFixed(1)}%)`);
  console.log(`Total Trades: ${results.summary.totalTrades}`);
  console.log(`Avg Trades/Month: ${results.summary.avgTradesPerMonth.toFixed(1)}`);
  console.log(`Avg Win Rate: ${results.summary.avgWinRate.toFixed(2)}%`);
  console.log(`Total PnL: $${results.summary.totalPnL.toFixed(2)}`);
  console.log(`Avg Monthly Return: ${results.summary.avgMonthlyReturn.toFixed(2)}%`);
  console.log(`Avg Profit Factor: ${results.summary.avgProfitFactor.toFixed(2)}`);
  console.log(`Avg R:R: ${results.summary.avgRR.toFixed(2)}`);
  console.log(`Max Drawdown: $${results.summary.maxDrawdown.toFixed(2)} (${results.summary.maxDrawdownPercent.toFixed(2)}%)`);
  
  if (results.summary.bestMonth) {
    console.log(`\n🏆 Best Month: ${results.summary.bestMonth.month}`);
    console.log(`   PnL: $${results.summary.bestMonth.totalPnL.toFixed(2)} (${results.summary.bestMonth.totalReturnPercent.toFixed(2)}%)`);
    console.log(`   Trades: ${results.summary.bestMonth.trades}, WR: ${results.summary.bestMonth.winRate.toFixed(2)}%, PF: ${results.summary.bestMonth.profitFactor.toFixed(2)}`);
  }
  
  if (results.summary.worstMonth) {
    console.log(`\n📉 Worst Month: ${results.summary.worstMonth.month}`);
    console.log(`   PnL: $${results.summary.worstMonth.totalPnL.toFixed(2)} (${results.summary.worstMonth.totalReturnPercent.toFixed(2)}%)`);
    console.log(`   Trades: ${results.summary.worstMonth.trades}, WR: ${results.summary.worstMonth.winRate.toFixed(2)}%, PF: ${results.summary.worstMonth.profitFactor.toFixed(2)}`);
  }
  
  console.log(`\n✅ Profitable Months: ${results.summary.profitableMonthsList.join(', ') || 'None'}`);
  console.log(`❌ Losing Months: ${results.summary.losingMonthsList.join(', ') || 'None'}`);
  
  console.log('\n📅 MONTHLY BREAKDOWN');
  console.log('-'.repeat(80));
  console.log('Month      | Trades | WR%   | PnL      | PF    | R:R  | Return% | DD%');
  console.log('-'.repeat(80));
  
  for (const month of results.months) {
    const status = month.success ? (month.totalPnL > 0 ? '✅' : '❌') : '⚠️';
    console.log(
      `${month.month} | ${String(month.trades).padStart(6)} | ${month.winRate.toFixed(1).padStart(5)} | ` +
      `${month.totalPnL >= 0 ? '+' : ''}${month.totalPnL.toFixed(2).padStart(8)} | ` +
      `${month.profitFactor.toFixed(2).padStart(5)} | ${month.avgRR.toFixed(2).padStart(4)} | ` +
      `${month.totalReturnPercent >= 0 ? '+' : ''}${month.totalReturnPercent.toFixed(2).padStart(7)} | ` +
      `${month.maxDrawdownPercent.toFixed(1).padStart(4)} ${status}`
    );
  }
  
  console.log('='.repeat(80) + '\n');
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  let symbol = 'XAUUSD';
  let dataSource: 'csv' | 'postgres' | 'mt5' | 'mock' = 'postgres';
  let year = 2023;
  let csvPath: string | undefined;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    switch (arg) {
      case '--symbol':
      case '-s':
        if (nextArg) {
          symbol = nextArg;
        }
        i++;
        break;
      
      case '--data-source':
        if (nextArg) {
          dataSource = nextArg as 'csv' | 'postgres' | 'mt5' | 'mock';
        }
        i++;
        break;
      
      case '--year':
      case '-y':
        if (nextArg) {
          year = parseInt(nextArg, 10);
        }
        i++;
        break;
      
      case '--csv-path':
        if (nextArg) {
          csvPath = nextArg;
        }
        i++;
        break;
    }
  }
  
  logger.info(`[BatchBacktest] Starting batch backtest for ${symbol} (${year})`);
  logger.info(`[BatchBacktest] Data source: ${dataSource}`);
  
  const monthlyRanges = generateMonthlyRanges(year);
  const results: MonthlyResult[] = [];
  
  // Run backtests sequentially to avoid overwhelming the system
  for (const range of monthlyRanges) {
    const result = await runMonthlyBacktest(
      symbol,
      range.start,
      range.end,
      range.month,
      dataSource,
      csvPath
    );
    results.push(result);
    
    // Small delay between backtests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  const aggregated = aggregateResults(results);
  const finalResults: AggregatedResults = {
    months: results,
    summary: aggregated,
  };
  
  // Print results
  printResults(finalResults);
  
  // Save results to file
  const outputDir = path.join(process.cwd(), 'backtests', 'batch');
  await fs.mkdir(outputDir, { recursive: true });
  
  const outputPath = path.join(outputDir, `batch_${symbol}_${year}_${Date.now()}.json`);
  await fs.writeFile(outputPath, JSON.stringify(finalResults, null, 2));
  
  logger.info(`[BatchBacktest] Results saved to: ${outputPath}`);
  
  // Exit with error code if more than 50% of months are losing
  if (aggregated.losingMonths > aggregated.profitableMonths) {
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    logger.error('[BatchBacktest] Fatal error:', error);
    process.exit(1);
  });
}


