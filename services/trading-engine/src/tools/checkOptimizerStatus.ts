/**
 * Quick status checker for AI Optimizer
 * 
 * Usage:
 *   pnpm tsx src/tools/checkOptimizerStatus.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '@providencex/shared-utils';

const logger = new Logger('OptimizerStatus');

interface IterationResult {
  summary: {
    totalPnL: number;
    avgMonthlyReturn: number;
    avgProfitFactor: number;
    avgWinRate: number;
    avgRR: number;
    maxDrawdown: number;
    profitableMonths: number;
    totalTrades: number;
  };
  iteration: number;
}

async function checkStatus() {
  const resultsDir = path.resolve(process.cwd(), 'backtests/ai_optimizer');
  
  try {
    const files = await fs.readdir(resultsDir);
    
    // Find all iteration files
    const iterationFiles = files
      .filter(f => f.startsWith('iteration_') && f.endsWith('.json'))
      .sort()
      .reverse(); // Most recent first
    
    if (iterationFiles.length === 0) {
      logger.info('❌ No iteration results found. Optimizer may not have started yet.');
      return;
    }
    
    logger.info(`\n📊 AI Optimizer Status`);
    logger.info('='.repeat(80));
    logger.info(`Total Iterations Completed: ${iterationFiles.length}`);
    
    // Read the most recent iteration
    const latestFile = iterationFiles[0];
    const latestPath = path.join(resultsDir, latestFile);
    const latestContent = await fs.readFile(latestPath, 'utf-8');
    const latest: IterationResult = JSON.parse(latestContent);
    
    logger.info(`\n🔄 Latest Iteration: ${latest.iteration}`);
    logger.info(`   File: ${latestFile}`);
    logger.info(`\n📈 Latest Results:`);
    logger.info(`   Total PnL: $${latest.summary.totalPnL.toFixed(2)}`);
    logger.info(`   Avg Monthly Return: ${latest.summary.avgMonthlyReturn.toFixed(2)}%`);
    logger.info(`   Avg Profit Factor: ${latest.summary.avgProfitFactor.toFixed(2)}`);
    logger.info(`   Avg Win Rate: ${latest.summary.avgWinRate.toFixed(2)}%`);
    logger.info(`   Avg R:R: ${latest.summary.avgRR.toFixed(2)}`);
    logger.info(`   Max Drawdown: ${latest.summary.maxDrawdown.toFixed(2)}%`);
    logger.info(`   Profitable Months: ${latest.summary.profitableMonths}/12`);
    logger.info(`   Total Trades: ${latest.summary.totalTrades}`);
    
    // Check if profitable
    const isProfitable = (
      latest.summary.totalPnL > 0 &&
      latest.summary.avgMonthlyReturn >= 30 &&
      latest.summary.avgProfitFactor >= 1.3 &&
      latest.summary.maxDrawdown <= 25 &&
      latest.summary.avgRR >= 2.5 &&
      latest.summary.avgWinRate >= 35 &&
      latest.summary.profitableMonths >= 10
    );
    
    if (isProfitable) {
      logger.info(`\n✅ STRATEGY IS PROFITABLE! All targets met.`);
    } else {
      logger.info(`\n⚠️  Strategy not yet profitable. Optimization continuing...`);
    }
    
    // Check for analysis files
    const analysisFiles = files.filter(f => f.startsWith('analysis_') && f.endsWith('.json'));
    if (analysisFiles.length > 0) {
      logger.info(`\n🤖 AI Analysis Files: ${analysisFiles.length} found`);
      logger.info(`   Latest: ${analysisFiles.sort().reverse()[0]}`);
    }
    
    logger.info(`\n💡 Tip: Check terminal output for real-time progress`);
    logger.info(`   Or run: tail -f backtests/ai_optimizer/*.json`);
    
  } catch (error) {
    logger.error('Error checking status:', error);
  }
}

checkStatus().catch(console.error);


