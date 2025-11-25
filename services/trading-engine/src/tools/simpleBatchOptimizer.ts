/**
 * Simple Batch Optimizer - Run 12-month backtest, analyze with OpenAI, fix, repeat
 * 
 * Usage:
 *   pnpm tsx src/tools/simpleBatchOptimizer.ts --symbol XAUUSD --data-source postgres --year 2023
 */

import dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs/promises';
import { BacktestRunner } from '../backtesting/BacktestRunner';
import { BacktestConfig } from '../backtesting/types';
import { Logger } from '@providencex/shared-utils';
import OpenAI from 'openai';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// CRITICAL: Ensure SMC v2 is enabled for backtests
if (!process.env.USE_SMC_V2) {
  process.env.USE_SMC_V2 = 'true';
  console.log('[SimpleBatchOptimizer] USE_SMC_V2 not set, defaulting to true for backtests');
}

const logger = new Logger('SimpleBatchOptimizer');

interface MonthlyResult {
  month: string;
  startDate: string;
  endDate: string;
  trades: number;
  winRate: number;
  totalPnL: number;
  profitFactor: number;
  avgRR: number;
  totalReturn: number;
  totalReturnPercent: number;
  maxDrawdown: number;
  status: '✅' | '❌';
}

interface BatchSummary {
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
  monthlyResults: MonthlyResult[];
}

async function runBatchBacktest(
  symbol: string,
  dataSource: string,
  year: number,
  monthsToTest: number = 12
): Promise<BatchSummary> {
  logger.info(`\n📅 Starting ${monthsToTest}-month backtest batch for ${symbol} (${year})...`);

  const allMonthlyResults: MonthlyResult[] = [];
  let totalTrades = 0;
  let totalPnL = 0;
  let profitableMonths = 0;
  let losingMonths = 0;
  let totalWinRate = 0;
  let totalProfitFactor = 0;
  let totalAvgRR = 0;
  let totalReturn = 0;
  let maxOverallDrawdown = 0;

  for (let month = 1; month <= monthsToTest; month++) {
    const monthStr = month.toString().padStart(2, '0');
    const startDate = `${year}-${monthStr}-01`;
    const endDate = new Date(year, month, 0).toISOString().slice(0, 10);

    logger.info(`\n[${month}/12] Running backtest for ${year}-${monthStr} (${startDate} to ${endDate})...`);

    const config: BacktestConfig = {
      symbol,
      strategies: ['low'],
      startDate: startDate,
      endDate: endDate,
      timeframe: 'M1',
      initialBalance: 10000,
      riskPerTradePercent: 0.25,
      dataSource: dataSource as 'mt5' | 'postgres',
    };

    try {
      const dataLoaderConfig = {
        dataSource: dataSource as 'csv' | 'postgres' | 'mt5' | 'mock',
        databaseUrl: process.env.DATABASE_URL,
        mt5BaseUrl: process.env.MT5_CONNECTOR_URL,
      };
      const runner = new BacktestRunner(config, dataLoaderConfig);
      const startTime = Date.now();
      const results = await runner.run();
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      
      const stats = results.stats;
      logger.info(`[${month}/12] ✅ Completed in ${duration}s - Trades: ${stats.totalTrades}, PnL: $${stats.totalPnL.toFixed(2)}, WR: ${stats.winRate.toFixed(1)}%`);

      if (results && stats) {
        const monthlyResult: MonthlyResult = {
          month: `${year}-${monthStr}`,
          startDate,
          endDate,
          trades: stats.totalTrades,
          winRate: parseFloat(stats.winRate.toFixed(2)),
          totalPnL: parseFloat(stats.totalPnL.toFixed(2)),
          profitFactor: parseFloat(stats.profitFactor.toFixed(2)),
          avgRR: parseFloat(stats.averageRr.toFixed(2)),
          totalReturn: parseFloat(results.totalReturn.toFixed(2)),
          totalReturnPercent: parseFloat(results.totalReturnPercent.toFixed(2)),
          maxDrawdown: parseFloat(stats.maxDrawdownPercent.toFixed(2)),
          status: stats.totalPnL > 0 ? '✅' : '❌',
        };
        allMonthlyResults.push(monthlyResult);

        totalTrades += stats.totalTrades;
        totalPnL += stats.totalPnL;
        totalWinRate += stats.winRate;
        totalProfitFactor += stats.profitFactor;
        totalAvgRR += stats.averageRr;
        totalReturn += results.totalReturnPercent; // Use percentage return
        if (stats.totalPnL > 0) {
          profitableMonths++;
        } else {
          losingMonths++;
        }
        if (stats.maxDrawdownPercent > maxOverallDrawdown) {
          maxOverallDrawdown = stats.maxDrawdownPercent;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[${month}/12] ❌ Error: ${errorMessage}`);
      allMonthlyResults.push({
        month: `${year}-${monthStr}`,
        startDate,
        endDate,
        trades: 0,
        winRate: 0,
        totalPnL: 0,
        profitFactor: 0,
        avgRR: 0,
        totalReturn: 0,
        totalReturnPercent: 0,
        maxDrawdown: 0,
        status: '❌',
      });
      losingMonths++;
    }
  }

  const avgWinRate = totalWinRate / monthsToTest;
  const avgProfitFactor = totalProfitFactor / monthsToTest;
  const avgAvgRR = totalAvgRR / monthsToTest;
  const avgMonthlyReturn = totalReturn / monthsToTest; // Average of monthly return percentages

  return {
    totalMonths: monthsToTest,
    profitableMonths,
    losingMonths,
    totalTrades,
    avgTradesPerMonth: totalTrades / monthsToTest,
    avgWinRate,
    totalPnL,
    avgMonthlyReturn,
    avgProfitFactor,
    avgRR: avgAvgRR,
    maxDrawdown: maxOverallDrawdown,
    monthlyResults: allMonthlyResults,
  };
}

async function analyzeWithOpenAI(summary: BatchSummary): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const openai = new OpenAI({ apiKey });

  const prompt = `You are an expert algorithmic trading strategy optimizer specializing in Smart Money Concepts (SMC) and ICT trading strategies.

## Backtest Results (12 Months)

### Overall Performance
- Total Months: ${summary.totalMonths}
- Profitable Months: ${summary.profitableMonths} (${((summary.profitableMonths / summary.totalMonths) * 100).toFixed(1)}%)
- Losing Months: ${summary.losingMonths} (${((summary.losingMonths / summary.totalMonths) * 100).toFixed(1)}%)
- Total Trades: ${summary.totalTrades}
- Avg Trades/Month: ${summary.avgTradesPerMonth.toFixed(1)}
- Avg Win Rate: ${summary.avgWinRate.toFixed(2)}% (target: 35%+)
- Total PnL: $${summary.totalPnL.toFixed(2)}
- Avg Monthly Return: ${summary.avgMonthlyReturn.toFixed(2)}% (target: 30-35%+)
- Avg Profit Factor: ${summary.avgProfitFactor.toFixed(2)} (target: 1.3+)
- Avg R:R: ${summary.avgRR.toFixed(2)} (target: 2.5-3.0+)
- Max Drawdown: ${summary.maxDrawdown.toFixed(2)}% (target: <25%)

### Monthly Breakdown
${summary.monthlyResults.map(m => 
  `${m.month}: ${m.trades} trades, ${m.winRate.toFixed(1)}% WR, $${m.totalPnL.toFixed(2)} PnL, ${m.totalReturnPercent.toFixed(2)}% return, PF ${m.profitFactor.toFixed(2)}, R:R ${m.avgRR.toFixed(2)} ${m.status}`
).join('\n')}

## Your Task

Analyze why this SMC v2 strategy is losing money and provide SPECIFIC, ACTIONABLE suggestions to fix it.

Focus on:
1. **Entry Quality**: Are entries happening at the right time/price? Too many false signals?
2. **Stop Loss Placement**: Are SLs being hit too often? Are they placed correctly relative to POIs?
3. **Take Profit Placement**: Are TPs being reached? Is 3R too ambitious?
4. **Market Conditions**: Are we trading in choppy/sideways markets? Need better filters?
5. **Risk Management**: Is position sizing correct? Are we overtrading?

Provide your analysis in this format:

## DIAGNOSIS
[Explain the root causes of poor performance]

## ROOT CAUSES
1. [Specific issue 1]
2. [Specific issue 2]
3. [Specific issue 3]

## SUGGESTIONS
For each suggestion, provide:
- **What to change**: Specific code/config change
- **Why**: Reasoning based on SMC principles
- **Expected impact**: How this should improve metrics

1. [Suggestion 1]
2. [Suggestion 2]
3. [Suggestion 3]

## PRIORITY FIXES
List the top 3 most impactful changes to make first.`;

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are an expert algorithmic trading strategy optimizer. Provide detailed, actionable analysis.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.7,
  });

  return response.choices[0]?.message?.content || 'No analysis provided';
}

function getArg(args: string[], flag: string, defaultValue: string): string {
  const index = args.indexOf(flag);
  if (index > -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return defaultValue;
}

async function main() {
  const args = process.argv.slice(2);
  const symbol = getArg(args, '--symbol', 'XAUUSD');
  const dataSource = getArg(args, '--data-source', 'postgres');
  const year = parseInt(getArg(args, '--year', '2023'), 10);
  const monthsToTest = parseInt(getArg(args, '--months', '3'), 10); // Default to 3 months

  logger.info(`\n🚀 Simple Batch Optimizer`);
  logger.info(`Symbol: ${symbol}, Data Source: ${dataSource}, Year: ${year}, Months: ${monthsToTest}`);
  logger.info(`Target: 30-35% monthly return, PF ≥ 1.3, WR ≥ 35%, R:R ≥ 2.5\n`);

  // Step 1: Run batch backtest
  const batchStartTime = Date.now();
  const summary = await runBatchBacktest(symbol, dataSource, year, monthsToTest);
  const batchDuration = ((Date.now() - batchStartTime) / 60000).toFixed(1);
  logger.info(`\n✅ Batch backtest completed in ${batchDuration} minutes`);

  // Step 2: Print results
  logger.info('\n📊 BATCH BACKTEST RESULTS');
  logger.info('='.repeat(80));
  logger.info(`Total Trades: ${summary.totalTrades}`);
  logger.info(`Avg Trades/Month: ${summary.avgTradesPerMonth.toFixed(1)}`);
    logger.info(`Profitable Months: ${summary.profitableMonths}/${summary.totalMonths} (${((summary.profitableMonths / summary.totalMonths) * 100).toFixed(1)}%)`);
  logger.info(`Total PnL: $${summary.totalPnL.toFixed(2)}`);
  logger.info(`Avg Monthly Return: ${summary.avgMonthlyReturn.toFixed(2)}%`);
  logger.info(`Avg Win Rate: ${summary.avgWinRate.toFixed(2)}%`);
  logger.info(`Avg Profit Factor: ${summary.avgProfitFactor.toFixed(2)}`);
  logger.info(`Avg R:R: ${summary.avgRR.toFixed(2)}`);
  logger.info(`Max Drawdown: ${summary.maxDrawdown.toFixed(2)}%`);
  logger.info('\nMonthly Breakdown:');
  summary.monthlyResults.forEach(m => {
    logger.info(
      `  ${m.month}: ${m.trades.toString().padStart(3)} trades | ` +
      `${m.winRate.toFixed(1).padStart(5)}% WR | ` +
      `$${m.totalPnL.toFixed(2).padStart(10)} PnL | ` +
      `${m.totalReturnPercent.toFixed(2).padStart(6)}% return | ` +
      `PF ${m.profitFactor.toFixed(2)} | ` +
      `R:R ${m.avgRR.toFixed(2)} ${m.status}`
    );
  });

  // Step 3: Save results
  const resultsDir = path.resolve(process.cwd(), 'backtests/simple_batch');
  await fs.mkdir(resultsDir, { recursive: true });
  const resultsFile = path.join(resultsDir, `batch_${symbol}_${year}_${Date.now()}.json`);
  await fs.writeFile(resultsFile, JSON.stringify({ summary }, null, 2));
  logger.info(`\n💾 Results saved to ${resultsFile}`);

  // Step 4: Analyze with OpenAI
  logger.info('\n🤖 Requesting AI analysis...');
  try {
    const analysis = await analyzeWithOpenAI(summary);
    
    const analysisFile = path.join(resultsDir, `analysis_${symbol}_${year}_${Date.now()}.txt`);
    await fs.writeFile(analysisFile, analysis);
    
    logger.info('\n📋 AI ANALYSIS');
    logger.info('='.repeat(80));
    logger.info(analysis);
    logger.info(`\n💾 Analysis saved to ${analysisFile}`);
    
    logger.info('\n✅ Next Steps:');
    logger.info('1. Review the AI analysis above');
    logger.info('2. Implement the suggested fixes');
    logger.info('3. Run this script again to test improvements');
    
  } catch (error) {
    logger.error('Failed to get AI analysis:', error);
    logger.info('Results are still saved. You can manually review and improve the strategy.');
  }
}

main().catch(error => {
  logger.error('Simple batch optimizer failed:', error);
  process.exit(1);
});

