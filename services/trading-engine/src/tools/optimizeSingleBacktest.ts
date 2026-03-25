/**
 * Single Backtest Optimizer - Analyze results, get AI suggestions, apply, re-test
 * 
 * Usage:
 *   pnpm tsx src/tools/optimizeSingleBacktest.ts --from 2024-05-01 --to 2024-06-30 --symbol XAUUSD --data-source postgres
 */

import dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { BacktestRunner } from '../backtesting/BacktestRunner';
import { BacktestConfig } from '../backtesting/types';
import { Logger } from '@providencex/shared-utils';
import OpenAI from 'openai';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// CRITICAL: Ensure SMC v2 is enabled for backtests
if (!process.env.USE_SMC_V2) {
  process.env.USE_SMC_V2 = 'true';
  console.log('[OptimizeSingleBacktest] USE_SMC_V2 not set, defaulting to true for backtests');
}

const logger = new Logger('OptimizeSingleBacktest');

interface BacktestResults {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  winRate: number;
  totalPnL: number;
  profitFactor: number;
  avgRR: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  totalReturnPercent: number;
  averageWin: number;
  averageLoss: number;
  expectancy: number;
}

interface ChangeLogEntry {
  iteration: number;
  timestamp: string;
  changes: Array<{
    file: string;
    type: 'env' | 'code';
    variable?: string;
    oldValue?: string;
    newValue?: string;
    reason?: string;
  }>;
  results: BacktestResults;
  reverted: boolean;
  revertReason?: string;
}

class SingleBacktestOptimizer {
  private openai: OpenAI;
  private maxIterations: number;
  private changeLog: ChangeLogEntry[] = [];
  private changeLogPath: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    this.openai = new OpenAI({ apiKey });
    this.maxIterations = 3; // Allow up to 3 iterations
    
    // Set up change log path
    const optimizationDir = path.join(process.cwd(), 'backtests', 'optimization');
    this.changeLogPath = path.join(optimizationDir, 'change_log.json');
  }

  async loadChangeLog(): Promise<ChangeLogEntry[]> {
    try {
      const content = await fs.readFile(this.changeLogPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      // File doesn't exist yet, return empty array
      return [];
    }
  }

  async saveChangeLog(): Promise<void> {
    const optimizationDir = path.dirname(this.changeLogPath);
    await fs.mkdir(optimizationDir, { recursive: true });
    await fs.writeFile(this.changeLogPath, JSON.stringify(this.changeLog, null, 2), 'utf-8');
  }

  async saveChangeSummary(iteration: number, changes: Array<{file: string; type: 'env' | 'code'; variable?: string; oldValue?: string; newValue?: string; reason?: string}>, results: BacktestResults): Promise<void> {
    const optimizationDir = path.dirname(this.changeLogPath);
    const summaryPath = path.join(optimizationDir, `changes_iteration_${iteration}_${Date.now()}.md`);
    
    let summary = `# Optimization Changes - Iteration ${iteration}\n\n`;
    summary += `**Date:** ${new Date().toISOString()}\n\n`;
    summary += `## Results After Changes\n\n`;
    summary += `- Total Trades: ${results.totalTrades}\n`;
    summary += `- Won: ${results.winningTrades} | Lost: ${results.losingTrades} | Break-Even: ${results.breakEvenTrades}\n`;
    summary += `- Win Rate: ${results.winRate.toFixed(2)}%\n`;
    summary += `- Total PnL: $${results.totalPnL.toFixed(2)}\n`;
    summary += `- Profit Factor: ${results.profitFactor.toFixed(2)}\n`;
    summary += `- Avg R:R: ${results.avgRR.toFixed(2)}\n`;
    summary += `- Max Drawdown: ${results.maxDrawdownPercent.toFixed(2)}%\n`;
    summary += `- Total Return: ${results.totalReturnPercent.toFixed(2)}%\n\n`;
    summary += `## Changes Applied\n\n`;
    
    changes.forEach((change, idx) => {
      summary += `### ${idx + 1}. ${change.type === 'env' ? 'Environment Variable' : 'Code Change'}\n\n`;
      summary += `**File:** \`${change.file}\`\n\n`;
      
      if (change.type === 'env' && change.variable) {
        summary += `**Variable:** \`${change.variable}\`\n\n`;
        summary += `**Old Value:** \`${change.oldValue || '(not set)'}\`\n\n`;
        summary += `**New Value:** \`${change.newValue || '(not set)'}\`\n\n`;
      }
      
      if (change.reason) {
        summary += `**Reason:** ${change.reason}\n\n`;
      }
      
      summary += `---\n\n`;
    });
    
    await fs.writeFile(summaryPath, summary, 'utf-8');
    logger.info(`📄 Human-readable summary saved to: ${summaryPath}`);
  }

  async runBacktest(config: BacktestConfig, dataSource: 'mt5' | 'postgres' | 'csv' | 'mock' | 'deriv'): Promise<BacktestResults | null> {
    try {
      logger.info(`Running backtest: ${config.symbol} from ${config.startDate} to ${config.endDate}`);
      logger.info(`⏱️  This may take 2-5 minutes. Progress will be shown in terminal...`);
      
      // Build data loader config (required by BacktestRunner)
      const dataLoaderConfig = {
        dataSource,
        csvPath: config.csvPath,
        databaseUrl: process.env.DATABASE_URL,
        mt5BaseUrl: process.env.MT5_CONNECTOR_URL || 'http://localhost:3030',
      };
      
      // Add timeout (10 minutes max per backtest - should be enough for a week of data)
      const timeoutMs = 10 * 60 * 1000; // 10 minutes (increased from 5)
      let timeoutId: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Backtest timed out after ${timeoutMs / 60000} minutes. This may indicate the backtest is stuck. Try reducing the date range or disabling news guardrail with DISABLE_BACKTEST_NEWS_GUARDRAIL=true`));
        }, timeoutMs);
      });
      
      logger.info(`⏱️  Backtest timeout set to ${timeoutMs / 60000} minutes`);
      logger.info(`📊 Starting backtest... (this may take a few minutes)`);
      
      const runner = new BacktestRunner(config, dataLoaderConfig);
      let results;
      try {
        logger.info('[OptimizeSingleBacktest] ⏳ Waiting for backtest to complete...');
        logger.info('[OptimizeSingleBacktest] Starting Promise.race between runner.run() and timeout...');
        
        const backtestPromise = runner.run();
        logger.info('[OPTIMIZER] Backtest promise created, waiting for race...');
        process.stdout.write('[OPTIMIZER] ⏳ Waiting for backtest Promise.race to resolve...\n');
        console.log('[OPTIMIZER] ⏳ Waiting for backtest Promise.race to resolve...');
        
        results = await Promise.race([
          backtestPromise,
          timeoutPromise,
        ]);
        
        // CRITICAL: Immediate output after Promise.race resolves
        process.stdout.write('\n[OPTIMIZER] ✅✅✅ PROMISE.RACE RESOLVED! ✅✅✅\n');
        process.stdout.write(`[OPTIMIZER] Results type: ${typeof results}, is null: ${results === null}, is undefined: ${results === undefined}\n`);
        console.log('\n[OPTIMIZER] ✅✅✅ PROMISE.RACE RESOLVED! ✅✅✅');
        console.log(`[OPTIMIZER] Results type: ${typeof results}, is null: ${results === null}, is undefined: ${results === undefined}`);
        logger.info('[OPTIMIZER] ✅ Promise.race resolved!');
        logger.info(`[OPTIMIZER] Results type: ${typeof results}, is null: ${results === null}, is undefined: ${results === undefined}`);
      } catch (error) {
        logger.error('[OptimizeSingleBacktest] ❌ Error during backtest execution:', error);
        logger.error('[OptimizeSingleBacktest] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        if (error instanceof Error && error.message.includes('timed out')) {
          logger.error('❌ Backtest timed out!');
          logger.error('💡 Suggestions:');
          logger.error('   1. Reduce the date range (e.g., --to 2024-05-03)');
          logger.error('   2. Disable news guardrail: DISABLE_BACKTEST_NEWS_GUARDRAIL=true');
          logger.error('   3. Check database connection and performance');
          throw error;
        }
        throw error;
      }
      
      console.log('[OptimizeSingleBacktest] 📊 Checking if results exist...');
      logger.info('[OptimizeSingleBacktest] 📊 Checking if results exist...');
      if (!results) {
        console.warn('[OptimizeSingleBacktest] ❌ No results returned from backtest');
        logger.warn('[OptimizeSingleBacktest] ❌ No results returned from backtest');
        return null;
      }
      
      console.log('[OptimizeSingleBacktest] ✅ Results object received, checking structure...');
      console.log('[OptimizeSingleBacktest] Results keys:', Object.keys(results).join(', '));
      logger.info('[OptimizeSingleBacktest] ✅ Results object received, checking structure...');
      logger.info('[OptimizeSingleBacktest] Results keys:', Object.keys(results).join(', '));

      // BacktestResult has stats nested inside
      logger.info('[OptimizeSingleBacktest] 📈 Extracting stats from results...');
      const stats = results.stats;
      
      if (!stats) {
        logger.error('❌ Backtest results missing stats object!');
        logger.error('Results structure:', JSON.stringify(Object.keys(results), null, 2));
        logger.error('Full results (first 500 chars):', JSON.stringify(results, null, 2).substring(0, 500));
        return null;
      }

      // Log what we're extracting for debugging
      logger.info(`[OptimizeSingleBacktest] ✅ Stats object found, extracting values...`);
      logger.info(`[OptimizeSingleBacktest] Stats keys: ${Object.keys(stats).join(', ')}`);
      logger.info(`[OptimizeSingleBacktest] Extracting stats: totalTrades=${stats.totalTrades}, winRate=${stats.winRate}, totalPnL=${stats.totalPnL}`);
      
      logger.info('[OptimizeSingleBacktest] 🔄 Building BacktestResults object...');
      
      // Helper to safely parse numbers (handle strings, percentages, etc.)
      const parseNumber = (value: any, defaultValue: number = 0): number => {
        if (value === null || value === undefined) return defaultValue;
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
          // Remove percentage signs and trim
          const cleaned = value.replace('%', '').trim();
          const parsed = parseFloat(cleaned);
          return isNaN(parsed) ? defaultValue : parsed;
        }
        return defaultValue;
      };
      
      const extractedResults = {
        totalTrades: parseNumber(stats.totalTrades, 0),
        winningTrades: parseNumber(stats.winningTrades, 0),
        losingTrades: parseNumber(stats.losingTrades, 0),
        breakEvenTrades: parseNumber(stats.breakEvenTrades, 0),
        winRate: parseNumber(stats.winRate, 0),
        totalPnL: parseNumber(stats.totalPnL, 0),
        profitFactor: parseNumber(stats.profitFactor, 0),
        avgRR: parseNumber(stats.averageRr, 0), // Average Risk:Reward ratio
        maxDrawdown: parseNumber(stats.maxDrawdown, 0),
        maxDrawdownPercent: parseNumber(stats.maxDrawdownPercent, 0),
        totalReturnPercent: parseNumber(results.totalReturnPercent, 0),
        averageWin: parseNumber(stats.averageWin, 0),
        averageLoss: parseNumber(stats.averageLoss, 0),
        expectancy: parseNumber(stats.expectancy, 0),
      };
      
      logger.info(`[OptimizeSingleBacktest] 📊 Extracted values: winRate=${extractedResults.winRate}, totalReturnPercent=${extractedResults.totalReturnPercent}, totalPnL=${extractedResults.totalPnL}`);
      
      logger.info('[OptimizeSingleBacktest] ✅ Results extraction complete!');
      logger.info(`[OptimizeSingleBacktest] Returning: ${extractedResults.totalTrades} trades, PnL: $${extractedResults.totalPnL.toFixed(2)}, Win Rate: ${extractedResults.winRate.toFixed(2)}%`);
      // CRITICAL: Use stdout.write for immediate unbuffered output
      process.stdout.write('[OptimizeSingleBacktest] 🚀 About to return from runBacktest() method...\n');
      process.stdout.write(`[OptimizeSingleBacktest] ✅✅✅ CRITICAL: runBacktest() is returning now! ✅✅✅\n`);
      process.stdout.write(`[OptimizeSingleBacktest] Return value type: ${typeof extractedResults}, totalTrades: ${extractedResults.totalTrades}\n`);
      process.stdout.write(`[OptimizeSingleBacktest] Extracted PnL: $${extractedResults.totalPnL.toFixed(2)}, WinRate: ${extractedResults.winRate.toFixed(2)}%, Return%: ${extractedResults.totalReturnPercent.toFixed(2)}%\n`);
      
      console.log('[OptimizeSingleBacktest] 🚀 About to return from runBacktest() method...');
      console.log(`[OptimizeSingleBacktest] ✅✅✅ CRITICAL: runBacktest() is returning now! ✅✅✅`);
      console.log(`[OptimizeSingleBacktest] Return value type: ${typeof extractedResults}, totalTrades: ${extractedResults.totalTrades}`);
      console.log(`[OptimizeSingleBacktest] Extracted PnL: $${extractedResults.totalPnL.toFixed(2)}, WinRate: ${extractedResults.winRate.toFixed(2)}%, Return%: ${extractedResults.totalReturnPercent.toFixed(2)}%`);
      
      logger.info('[OptimizeSingleBacktest] 🚀 About to return from runBacktest() method...');
      logger.info(`[OptimizeSingleBacktest] ✅✅✅ CRITICAL: runBacktest() is returning now! ✅✅✅`);
      logger.info(`[OptimizeSingleBacktest] Return value type: ${typeof extractedResults}, totalTrades: ${extractedResults.totalTrades}`);
      logger.info(`[OptimizeSingleBacktest] Full extracted results:`, JSON.stringify(extractedResults, null, 2));
      
      // Force immediate flush
      if (process.stdout.isTTY) {
        process.stdout.uncork && process.stdout.uncork();
      }
      
      return extractedResults;
    } catch (error) {
      logger.error('Backtest failed:', error instanceof Error ? error.message : String(error));
      if (error instanceof Error && error.message.includes('timed out')) {
        logger.error('⚠️  Backtest appears to be stuck. This could be due to:');
        logger.error('   - Too many candles being processed');
        logger.error('   - Strategy generating too many signals');
        logger.error('   - Database connection issues');
        logger.error('   - Infinite loop in strategy logic');
      }
      return null;
    }
  }

  async getStrategyLogic(): Promise<string> {
    // Read key strategy files (optimized: read in parallel, with timeout)
    const strategyPath = path.join(process.cwd(), 'src/strategy/v2/SMCStrategyV2.ts');
    const m1ExecutionPath = path.join(process.cwd(), 'src/strategy/v2/M1ExecutionService.ts');
    const configPath = path.join(process.cwd(), '.env');

    let strategyLogic = '## Strategy Logic Summary\n\n';
    
    // Read all files in parallel for better performance
    const readPromises = [
      fs.readFile(strategyPath, 'utf-8').catch(() => null),
      fs.readFile(m1ExecutionPath, 'utf-8').catch(() => null),
      fs.readFile(configPath, 'utf-8').catch(() => null),
    ];
    
    try {
      const [strategyContent, m1Content, envContent] = await Promise.all(readPromises);
      
      if (strategyContent) {
        // Extract key methods (simplified - just get entry logic)
        const entryMatch = strategyContent.match(/generateEnhancedSignal[\s\S]{1,5000}/);
        if (entryMatch) {
          strategyLogic += '### Entry Signal Generation:\n' + entryMatch[0].substring(0, 2000) + '\n\n';
        }
      }

      if (m1Content) {
        const executionMatch = m1Content.match(/shouldEnterTrade[\s\S]{1,3000}/);
        if (executionMatch) {
          strategyLogic += '### M1 Execution Logic:\n' + executionMatch[0].substring(0, 2000) + '\n\n';
        }
      }

      if (envContent) {
        // Limit .env content to relevant lines only (reduce size)
        const envLines = envContent.split('\n').filter(line => 
          line.trim() && 
          !line.startsWith('#') && 
          (line.includes('SMC_') || line.includes('EXEC_') || line.includes('SL_') || line.includes('RISK'))
        ).slice(0, 50); // Limit to 50 relevant lines
        strategyLogic += '### Current Configuration (.env - relevant lines only):\n' + envLines.join('\n') + '\n\n';
      }
    } catch (error) {
      logger.warn('Error reading strategy files:', error);
    }

    return strategyLogic;
  }

  async analyzeWithAI(
    results: BacktestResults, 
    strategyLogic: string, 
    previousResults: BacktestResults | null = null,
    changeHistory: ChangeLogEntry[] = []
  ): Promise<string> {
    logger.info(`[OptimizeSingleBacktest] 🔍 analyzeWithAI() called`);
    logger.info(`[OptimizeSingleBacktest] Checking OpenAI API key...`);
    
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const errorMsg = 'OPENAI_API_KEY environment variable is not set! Cannot analyze with AI.';
      logger.error(`[OptimizeSingleBacktest] ❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    logger.info(`[OptimizeSingleBacktest] ✅ OpenAI API key found (length: ${apiKey.length} chars)`);
    logger.info(`[OptimizeSingleBacktest] Using model: ${process.env.OPENAI_MODEL || 'gpt-4o-mini'}`);
    logger.info(`[OptimizeSingleBacktest] Building prompt for OpenAI...`);
    
    const prompt = `You are analyzing a Smart Money Concepts (SMC) trading strategy backtest that is performing very poorly.

## Current Backtest Results (Iteration ${previousResults ? 'N' : '1'}):
- Total Trades: ${results.totalTrades}
  - Won: ${results.winningTrades}
  - Lost: ${results.losingTrades}
  - Break-Even: ${results.breakEvenTrades || 0}
- Win Rate: ${results.winRate.toFixed(2)}% (TARGET: ≥35%)
- Total PnL: $${results.totalPnL.toFixed(2)} (TARGET: Positive)
- Profit Factor: ${results.profitFactor.toFixed(2)} (TARGET: ≥1.3)
- Average R:R: ${results.avgRR.toFixed(2)} (TARGET: 2.5-3.0)
- Max Drawdown: ${results.maxDrawdownPercent.toFixed(2)}% (TARGET: ≤25%)
- Total Return: ${results.totalReturnPercent.toFixed(2)}% (TARGET: 30-35% monthly)
- Average Win: $${results.averageWin.toFixed(2)}
- Average Loss: $${results.averageLoss.toFixed(2)}
- Expectancy: $${results.expectancy.toFixed(2)}

${changeHistory.length > 0 ? `## Previous Changes History (DO NOT REPEAT THESE):
${changeHistory.map((entry, idx) => `
### Change Entry ${idx + 1} (Iteration ${entry.iteration}):
- **Changes Made:**
${entry.changes.map(c => `  - ${c.file}: ${c.variable || 'code'} = ${c.oldValue || 'N/A'} → ${c.newValue || 'N/A'}`).join('\n')}
- **Results After Changes:**
  - Trades: ${entry.results.totalTrades}
  - Win Rate: ${entry.results.winRate.toFixed(2)}%
  - Total PnL: $${entry.results.totalPnL.toFixed(2)}
  - Profit Factor: ${entry.results.profitFactor.toFixed(2)}
  - Avg R:R: ${entry.results.avgRR.toFixed(2)}
  - Max Drawdown: ${entry.results.maxDrawdownPercent.toFixed(2)}%
  - Total Return: ${entry.results.totalReturnPercent.toFixed(2)}%
${entry.reverted ? `- **STATUS: REVERTED** - Reason: ${entry.revertReason || 'Performance worsened'}` : ''}
`).join('\n')}

**IMPORTANT**: Do NOT repeat any of the above changes. They have already been tried. If they were reverted, they made things worse.` : ''}

${previousResults ? `## Previous Iteration Results (for comparison):
- Total Trades: ${previousResults.totalTrades} → ${results.totalTrades} (${results.totalTrades > previousResults.totalTrades ? '↑' : results.totalTrades < previousResults.totalTrades ? '↓' : '='})
- Win Rate: ${previousResults.winRate.toFixed(2)}% → ${results.winRate.toFixed(2)}% (${results.winRate > previousResults.winRate ? '↑' : results.winRate < previousResults.winRate ? '↓' : '='})
- Total PnL: $${previousResults.totalPnL.toFixed(2)} → $${results.totalPnL.toFixed(2)} (${results.totalPnL > previousResults.totalPnL ? '↑ IMPROVED' : results.totalPnL < previousResults.totalPnL ? '↓ WORSE' : '='})
- Profit Factor: ${previousResults.profitFactor.toFixed(2)} → ${results.profitFactor.toFixed(2)} (${results.profitFactor > previousResults.profitFactor ? '↑' : results.profitFactor < previousResults.profitFactor ? '↓' : '='})
- Avg R:R: ${previousResults.avgRR.toFixed(2)} → ${results.avgRR.toFixed(2)} (${results.avgRR > previousResults.avgRR ? '↑' : results.avgRR < previousResults.avgRR ? '↓' : '='})
- Max Drawdown: ${previousResults.maxDrawdownPercent.toFixed(2)}% → ${results.maxDrawdownPercent.toFixed(2)}% (${results.maxDrawdownPercent < previousResults.maxDrawdownPercent ? '↓ IMPROVED' : results.maxDrawdownPercent > previousResults.maxDrawdownPercent ? '↑ WORSE' : '='})
- Total Return: ${previousResults.totalReturnPercent.toFixed(2)}% → ${results.totalReturnPercent.toFixed(2)}% (${results.totalReturnPercent > previousResults.totalReturnPercent ? '↑' : results.totalReturnPercent < previousResults.totalReturnPercent ? '↓' : '='})

**IMPORTANT**: The previous changes ${results.totalPnL > previousResults.totalPnL ? 'IMPROVED' : 'WORSENED'} performance. ${results.totalPnL < previousResults.totalPnL ? 'You MUST revert or adjust the previous suggestions - they made things worse!' : 'Continue improving in this direction.'}` : ''}

## Strategy Logic:
${strategyLogic}

## Key Issues Identified:
1. **CRITICAL: Win rate is very low (${results.winRate.toFixed(2)}% vs target 35%+)**
   - Only ${results.winningTrades} winning trades vs ${results.losingTrades} losing trades
   - Loss ratio: ${((results.losingTrades / results.totalTrades) * 100).toFixed(1)}% of trades are losses
   - This indicates entry quality is poor - too many false signals
2. Profit factor is below 1.0 (${results.profitFactor.toFixed(2)}) - losing more than winning
3. Average R:R is too low (${results.avgRR.toFixed(2)} vs target 2.5-3.0) - TPs not being hit
4. Max drawdown is excessive (${results.maxDrawdownPercent.toFixed(2)}%) - risk management failing
5. Strategy is losing money overall - ${results.totalPnL < 0 ? 'LOSING' : 'BREAKING EVEN'} $${Math.abs(results.totalPnL).toFixed(2)}

## Your Task:
Analyze the strategy logic and backtest results. Identify the root causes of poor performance and provide SPECIFIC, ACTIONABLE suggestions to improve:

1. **Entry Quality**: Are entries being taken at the right time? Are filters too loose or too strict?
2. **Stop Loss Placement**: Are SLs being hit too often? Are they placed correctly relative to POIs?
3. **Take Profit Placement**: Is the R:R actually being achieved? Are TPs too far/close?
4. **Risk Management**: Is position sizing appropriate?
5. **Market Conditions**: Is the strategy trading in unfavorable conditions (sideways, low volatility)?

## Required Output Format:
Provide your analysis and suggestions in the following format:

### DIAGNOSIS:
[Brief diagnosis of main issues]

### ROOT CAUSES:
1. [Root cause 1]
2. [Root cause 2]
3. [Root cause 3]

### SUGGESTIONS:
For each suggestion, use this exact format:

FILE:path/to/file.ts
SET:variableName
TO:newValue
REASON:explanation

OR for code changes:

FILE:path/to/file.ts
LINE:lineNumber
CHANGE:old code
TO:new code
REASON:explanation

OR for .env changes:

FILE:.env
SET:ENV_VAR_NAME
TO:newValue
REASON:explanation

## Important:
- Be specific with file paths, variable names, and values
- Focus on the most impactful changes first
- Ensure suggestions are implementable and testable
- Consider SMC/ICT best practices (Order Blocks, FVG, CHoCH, liquidity sweeps, POI-anchored SLs)
- Target improvements: Win rate ≥35%, PF ≥1.3, R:R 2.5-3.0, Max DD ≤25%`;

    try {
      // Add timeout for OpenAI API calls (60 seconds)
      const timeoutMs = 60 * 1000;
      logger.info(`[OptimizeSingleBacktest] Setting up timeout (${timeoutMs / 1000} seconds) for OpenAI API call...`);
      
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          logger.error(`[OptimizeSingleBacktest] ⏰ Timeout reached after ${timeoutMs / 1000} seconds`);
          reject(new Error(`OpenAI API call timed out after ${timeoutMs / 1000} seconds`));
        }, timeoutMs);
      });

      // Add progress indicator
      const progressInterval = setInterval(() => {
        logger.info('⏳ Still waiting for OpenAI API response... (this is normal, can take 30-60 seconds)');
      }, 15000); // Log every 15 seconds

      try {
        logger.info(`[OptimizeSingleBacktest] 🚀 Making OpenAI API call now...`);
        logger.info(`[OptimizeSingleBacktest] Prompt length: ${prompt.length} characters`);
        logger.info(`[OptimizeSingleBacktest] Model: ${process.env.OPENAI_MODEL || 'gpt-4o-mini'}`);
        const apiCall = this.openai.chat.completions.create({
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content: 'You are an expert trading strategy analyst specializing in Smart Money Concepts (SMC) and ICT trading methodologies. You analyze backtest results and provide specific, actionable code and configuration improvements.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.7,
          max_tokens: 2000,
          // Note: timeout removed - handled via Promise.race with timeoutPromise
        });

        logger.info(`[OptimizeSingleBacktest] ⏳ Waiting for OpenAI API response (Promise.race)...`);
        const response = await Promise.race([apiCall, timeoutPromise]);
        clearInterval(progressInterval);
        logger.info(`[OptimizeSingleBacktest] ✅ OpenAI API response received!`);
        // Type guard: check if response is ChatCompletion (not Stream)
        if ('choices' in response && response.choices && response.choices.length > 0) {
          logger.info(`[OptimizeSingleBacktest] Response length: ${response.choices[0]?.message?.content?.length || 0} characters`);
          const content = response.choices[0]?.message?.content || 'No response from AI';
          logger.info(`[OptimizeSingleBacktest] Returning AI analysis content (first 200 chars): ${content.substring(0, 200)}...`);
          return content;
        } else {
          logger.warn('[OptimizeSingleBacktest] Unexpected response type from OpenAI API');
          return 'No response from AI - unexpected response format';
        }
      } catch (error) {
        clearInterval(progressInterval);
        throw error;
      }
    } catch (error) {
      logger.error('OpenAI API error:', error);
      if (error instanceof Error && error.message.includes('timed out')) {
        logger.warn('⚠️  OpenAI API timed out - continuing without AI analysis');
        return 'OpenAI API timed out. Please check your connection and API key.';
      }
      throw error;
    }
  }

  async revertChanges(changeEntry: ChangeLogEntry): Promise<void> {
    logger.info(`🔄 Reverting ${changeEntry.changes.length} changes from iteration ${changeEntry.iteration}...`);
    
    for (const change of changeEntry.changes) {
      if (change.type === 'env' && change.variable) {
        const envPath = path.resolve(process.cwd(), '.env');
        try {
          let content: string;
          try {
            content = await fs.readFile(envPath, 'utf-8');
          } catch (error: any) {
            if (error.code === 'ENOENT') {
              logger.warn(`  ⚠️  .env file not found, cannot revert ${change.variable}`);
              continue;
            }
            throw error;
          }
          
          // Handle both with and without quotes, handle oldValue being undefined (new variable)
          if (change.oldValue !== undefined) {
            const regex = new RegExp(`^${change.variable}\\s*=\\s*.*$`, 'm');
            if (regex.test(content)) {
              content = content.replace(regex, `${change.variable}=${change.oldValue}`);
              await fs.writeFile(envPath, content, 'utf-8');
              dotenv.config({ path: envPath });
              logger.info(`  ✅ Reverted: ${change.variable} = ${change.newValue || '(was set)'} → ${change.oldValue}`);
            } else {
              logger.warn(`  ⚠️  Variable ${change.variable} not found in .env, skipping revert`);
            }
          } else {
            // Old value was undefined, meaning this was a new variable - remove it
            const regex = new RegExp(`^${change.variable}\\s*=\\s*.*$`, 'm');
            if (regex.test(content)) {
              content = content.replace(regex, '');
              // Clean up extra newlines
              content = content.replace(/\n\n\n+/g, '\n\n');
              await fs.writeFile(envPath, content, 'utf-8');
              dotenv.config({ path: envPath });
              logger.info(`  ✅ Removed new variable: ${change.variable}`);
            }
          }
        } catch (error) {
          logger.error(`  ❌ Failed to revert ${change.variable}:`, error);
        }
      } else if (change.type === 'code') {
        logger.warn(`  ⚠️  Code file changes for ${change.file} cannot be auto-reverted. Manual review required.`);
      }
    }
  }

  async applySuggestions(suggestions: string): Promise<Array<{file: string; type: 'env' | 'code'; variable?: string; oldValue?: string; newValue?: string; reason?: string}>> {
    const changes: Array<{file: string; type: 'env' | 'code'; variable?: string; oldValue?: string; newValue?: string; reason?: string}> = [];
    const lines = suggestions.split('\n');
    let currentFile: string | null = null;
    let currentSection: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith('FILE:')) {
        // Process previous file if any
        if (currentFile && currentSection.length > 0) {
          const fileChanges = await this.processFileSection(currentFile, currentSection);
          changes.push(...fileChanges);
          currentSection = [];
        }
        currentFile = line.substring(5).trim();
      } else if (line.startsWith('SET:') || line.startsWith('LINE:') || line.startsWith('CHANGE:') || line.startsWith('TO:') || line.startsWith('REASON:')) {
        currentSection.push(line);
      } else if (line && !line.startsWith('###') && !line.startsWith('##') && !line.startsWith('DIAGNOSIS:') && !line.startsWith('ROOT CAUSES:') && !line.startsWith('SUGGESTIONS:')) {
        // Skip headers and non-command lines
        continue;
      }
    }

    // Process last file
    if (currentFile && currentSection.length > 0) {
      const fileChanges = await this.processFileSection(currentFile, currentSection);
      changes.push(...fileChanges);
    }
    
    return changes;
  }

  async processFileSection(filePath: string, sections: string[]): Promise<Array<{file: string; type: 'env' | 'code'; variable?: string; oldValue?: string; newValue?: string; reason?: string}>> {
    const changes: Array<{file: string; type: 'env' | 'code'; variable?: string; oldValue?: string; newValue?: string; reason?: string}> = [];
    const fullPath = path.resolve(process.cwd(), filePath);
    
    try {
      if (filePath === '.env') {
        // Handle .env file
        let content: string;
        try {
          content = await fs.readFile(fullPath, 'utf-8');
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            // .env file doesn't exist, create it
            logger.info(`📝 .env file not found, creating new one at ${fullPath}`);
            content = '# Auto-generated by optimizer\n';
            await fs.writeFile(fullPath, content, 'utf-8');
          } else {
            throw error;
          }
        }
        
        for (let i = 0; i < sections.length; i++) {
          if (sections[i].startsWith('SET:')) {
            const varName = sections[i].substring(4).trim();
            if (i + 1 < sections.length && sections[i + 1].startsWith('TO:')) {
              const newValue = sections[i + 1].substring(3).trim();
              
              // Get old value before updating
              // Handle both with and without quotes
              const regex = new RegExp(`^${varName}\\s*=\\s*(.*)$`, 'm');
              let oldValue: string | undefined;
              if (regex.test(content)) {
                const match = content.match(regex);
                oldValue = match ? match[1].trim().replace(/^["']|["']$/g, '') : undefined; // Remove quotes
                // Replace the line
                content = content.replace(regex, `${varName}=${newValue}`);
                logger.info(`✅ Updated .env: ${varName}=${oldValue || '(not set)'} → ${newValue}`);
              } else {
                oldValue = undefined;
                // Check if file ends with newline
                const needsNewline = !content.endsWith('\n');
                content += `${needsNewline ? '\n' : ''}${varName}=${newValue}\n`;
                logger.info(`✅ Added .env: ${varName}=${newValue}`);
              }
              
              // Get reason if available
              let reason: string | undefined;
              if (i + 2 < sections.length && sections[i + 2].startsWith('REASON:')) {
                reason = sections[i + 2].substring(7).trim();
              }
              
              changes.push({
                file: '.env',
                type: 'env',
                variable: varName,
                oldValue,
                newValue,
                reason,
              });
              
              i++; // Skip TO: line
            }
          }
        }
        
        await fs.writeFile(fullPath, content, 'utf-8');
        // Reload .env
        dotenv.config({ path: fullPath });
      } else {
        // Handle code files - try to apply simple line-based changes
        // For now, focus on .env variables but log code suggestions for manual review
        logger.warn(`⚠️  Code file changes for ${filePath} are logged but not auto-applied for safety.`);
        logger.warn(`   Please review and apply manually, or ensure AI suggests .env variable changes instead.`);
        
        // Parse code change suggestions and log them
        let lineNumber: number | undefined;
        let changeFrom: string | undefined;
        let changeTo: string | undefined;
        let reason: string | undefined;
        
        for (let i = 0; i < sections.length; i++) {
          const line = sections[i];
          if (line.startsWith('LINE:')) {
            lineNumber = parseInt(line.substring(5).trim(), 10);
          } else if (line.startsWith('CHANGE:')) {
            changeFrom = line.substring(7).trim();
          } else if (line.startsWith('TO:')) {
            changeTo = line.substring(3).trim();
          } else if (line.startsWith('REASON:')) {
            reason = line.substring(7).trim();
          }
        }
        
        if (lineNumber || changeFrom || changeTo) {
          logger.info(`   Suggested change for ${filePath}:`);
          if (lineNumber) logger.info(`     Line: ${lineNumber}`);
          if (changeFrom) logger.info(`     From: ${changeFrom.substring(0, 100)}${changeFrom.length > 100 ? '...' : ''}`);
          if (changeTo) logger.info(`     To: ${changeTo.substring(0, 100)}${changeTo.length > 100 ? '...' : ''}`);
          if (reason) logger.info(`     Reason: ${reason}`);
          
          changes.push({
            file: filePath,
            type: 'code',
            oldValue: changeFrom,
            newValue: changeTo,
            reason,
          });
        }
      }
    } catch (error) {
      logger.error(`Error processing file ${filePath}:`, error);
    }
    
    return changes;
  }

  async optimize(config: BacktestConfig): Promise<void> {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('🚀 STARTING SINGLE BACKTEST OPTIMIZATION');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`Date range: ${config.startDate} to ${config.endDate}`);
    console.log(`Symbol: ${config.symbol}`);
    console.log(`Max iterations: ${this.maxIterations}`);
    console.log(`[OptimizeSingleBacktest] Optimizer initialized, starting optimization loop...`);
    
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('🚀 STARTING SINGLE BACKTEST OPTIMIZATION');
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info(`Date range: ${config.startDate} to ${config.endDate}`);
    logger.info(`Symbol: ${config.symbol}`);
    logger.info(`Max iterations: ${this.maxIterations}`);
    logger.info(`[OptimizeSingleBacktest] Optimizer initialized, starting optimization loop...`);

    // Create optimization directory
    const optimizationDir = path.join(process.cwd(), 'backtests', 'optimization');
    await fs.mkdir(optimizationDir, { recursive: true });
    
    // Load previous change log
    this.changeLog = await this.loadChangeLog();
    if (this.changeLog.length > 0) {
      logger.info(`📚 Loaded ${this.changeLog.length} previous change log entries`);
    }
    
    // Track previous results for comparison
    const previousResults: BacktestResults[] = [];

    // CRITICAL: Log that we're about to start the loop
    process.stdout.write(`\n${'='.repeat(80)}\n`);
    process.stdout.write(`[OPTIMIZER] 🔄 STARTING OPTIMIZATION LOOP\n`);
    process.stdout.write(`[OPTIMIZER] Max iterations: ${this.maxIterations}\n`);
    process.stdout.write(`[OPTIMIZER] Loop will run from iteration 1 to ${this.maxIterations}\n`);
    process.stdout.write(`${'='.repeat(80)}\n\n`);
    logger.info(`[OPTIMIZER] 🔄 Starting optimization loop - will run ${this.maxIterations} iterations`);

    for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
      // CRITICAL: Log that we're entering the loop
      process.stdout.write(`\n${'='.repeat(80)}\n`);
      process.stdout.write(`[OPTIMIZER] 🔄 ENTERING ITERATION LOOP - Iteration ${iteration}/${this.maxIterations}\n`);
      process.stdout.write(`${'='.repeat(80)}\n\n`);
      logger.info(`[OPTIMIZER] 🔄 ENTERING ITERATION ${iteration}/${this.maxIterations}`);
      
      // CRITICAL: Wrap entire iteration in try-catch to ensure we always continue
      try {
        process.stdout.write(`\n${'='.repeat(80)}\n`);
        process.stdout.write(`[OPTIMIZER] ITERATION ${iteration}/${this.maxIterations}\n`);
        process.stdout.write(`${'='.repeat(80)}\n\n`);
        logger.info(`\n${'='.repeat(60)}`);
        logger.info(`ITERATION ${iteration}/${this.maxIterations}`);
        logger.info(`${'='.repeat(60)}\n`);

        // Run backtest
        process.stdout.write(`[OPTIMIZER] 🚀 Starting backtest...\n`);
        logger.info('🚀 Starting backtest...');
        logger.info(`[OPTIMIZER] About to call runBacktest()...`);
      
      let results: BacktestResults | null = null;
      
      // CRITICAL: Wrap in try-catch with timeout and force continuation
      try {
        // Use process.stdout.write for immediate unbuffered output
        process.stdout.write('\n' + '='.repeat(80) + '\n');
        process.stdout.write(`[OPTIMIZER] 🚀 STARTING BACKTEST (Iteration ${iteration}/${this.maxIterations})\n`);
        process.stdout.write('='.repeat(80) + '\n\n');
        console.log('\n' + '='.repeat(80));
        console.log(`[OPTIMIZER] 🚀 STARTING BACKTEST (Iteration ${iteration}/${this.maxIterations})`);
        console.log('='.repeat(80) + '\n');
        logger.info(`[OPTIMIZER] 🔵 About to await runBacktest()...`);
        
        // Add a timeout wrapper to detect hangs
        const backtestWithTimeout = Promise.race([
          this.runBacktest(config, config.dataSource || 'postgres'),
          new Promise<null>((_, reject) => 
            setTimeout(() => reject(new Error('runBacktest() method timed out after 15 minutes')), 15 * 60 * 1000)
          )
        ]);
        
        process.stdout.write(`[OPTIMIZER] ⏳ Awaiting backtest (with 15min timeout)...\n`);
        results = await backtestWithTimeout;
        
        // CRITICAL: Immediate output after backtest completes
        process.stdout.write('\n' + '='.repeat(80) + '\n');
        process.stdout.write(`[OPTIMIZER] ✅ BACKTEST AWAIT COMPLETED!\n`);
        process.stdout.write(`[OPTIMIZER] Results type: ${typeof results}, is null: ${results === null}\n`);
        process.stdout.write('='.repeat(80) + '\n\n');
        console.log('\n' + '='.repeat(80));
        console.log(`[OPTIMIZER] ✅ BACKTEST AWAIT COMPLETED!`);
        console.log(`[OPTIMIZER] Results type: ${typeof results}, is null: ${results === null}`);
        console.log('='.repeat(80) + '\n');
        logger.info(`[OPTIMIZER] 🟢 runBacktest() AWAIT COMPLETED!`);
        
        if (results) {
          process.stdout.write(`[OPTIMIZER] ✅ Results received! Trades: ${results.totalTrades}, PnL: $${results.totalPnL?.toFixed(2) || 'N/A'}\n`);
          console.log(`[OPTIMIZER] ✅ Results received! Trades: ${results.totalTrades}, PnL: $${results.totalPnL?.toFixed(2) || 'N/A'}`);
          logger.info(`[OPTIMIZER] Results: ${results.totalTrades} trades, PnL: $${results.totalPnL?.toFixed(2)}`);
        } else {
          process.stdout.write(`[OPTIMIZER] ❌ Results is NULL!\n`);
          console.error(`[OPTIMIZER] ❌ Results is NULL!`);
          logger.error(`[OPTIMIZER] Results is null`);
        }
      } catch (error) {
        process.stdout.write(`[OPTIMIZER] ❌ EXCEPTION: ${error instanceof Error ? error.message : String(error)}\n`);
        console.error(`[OPTIMIZER] ❌ EXCEPTION:`, error);
        logger.error('[OPTIMIZER] Exception caught:', error);
        if (error instanceof Error) {
          logger.error('[OPTIMIZER] Stack:', error.stack);
        }
        // Don't throw - continue to next iteration
        results = null;
      }
      
      // CRITICAL: Force stdout flush
      if (process.stdout.isTTY) {
        if (typeof process.stdout.cork === 'function' && typeof process.stdout.uncork === 'function') {
          process.stdout.cork();
          process.stdout.uncork();
        }
      }
      
      // CRITICAL: Check results and continue
      process.stdout.write(`[OPTIMIZER] 📊 POST-BACKTEST CHECK: Results is ${results ? 'VALID' : 'NULL'}\n`);
      console.log(`[OPTIMIZER] 📊 POST-BACKTEST CHECK: Results is ${results ? 'VALID' : 'NULL'}`);
      logger.info(`[OPTIMIZER] Post-backtest check: Results is ${results ? 'valid' : 'null'}`);
      
      if (!results) {
        process.stdout.write(`\n${'='.repeat(80)}\n`);
        process.stdout.write(`[OPTIMIZER] ❌ RESULTS IS NULL - SKIPPING TO NEXT ITERATION\n`);
        process.stdout.write(`[OPTIMIZER] Iteration ${iteration} completed with null results\n`);
        process.stdout.write(`[OPTIMIZER] Moving to next iteration (${iteration + 1}/${this.maxIterations})\n`);
        process.stdout.write(`${'='.repeat(80)}\n\n`);
        console.error(`[OPTIMIZER] ❌ RESULTS IS NULL - SKIPPING TO NEXT ITERATION`);
        logger.error(`[OPTIMIZER] Iteration ${iteration}: Backtest returned null, skipping to next iteration`);
        logger.error('This could be due to:');
        logger.error('  - Stats extraction failed');
        logger.error('  - Backtest timed out');
        logger.error('  - Backtest returned invalid results');
        // Continue to next iteration instead of breaking
        continue;
      }
      
      // CRITICAL: Log successful results
      process.stdout.write(`\n${'='.repeat(80)}\n`);
      process.stdout.write(`[OPTIMIZER] ✅ ITERATION ${iteration} SUCCESS - Results received!\n`);
      process.stdout.write(`[OPTIMIZER] Trades: ${results.totalTrades}, PnL: $${results.totalPnL?.toFixed(2) || 'N/A'}\n`);
      process.stdout.write(`${'='.repeat(80)}\n\n`);
      logger.info(`[OPTIMIZER] ✅ Iteration ${iteration} completed successfully with results`);
      
      // CRITICAL: Immediate console output when results exist
      process.stdout.write(`[OptimizeSingleBacktest] ✅ RESULTS NOT NULL - CONTINUING!\n`);
      process.stdout.write(`[OptimizeSingleBacktest] Results: ${results.totalTrades} trades, PnL: $${results.totalPnL?.toFixed(2) || 'N/A'}\n`);
      console.log(`[OptimizeSingleBacktest] ✅ RESULTS NOT NULL - CONTINUING!`);
      console.log(`[OptimizeSingleBacktest] Results: ${results.totalTrades} trades, PnL: $${results.totalPnL?.toFixed(2) || 'N/A'}`);
      
      logger.info(`✅ Results extracted: ${results.totalTrades} trades, PnL: $${results.totalPnL.toFixed(2)}`);
      console.log(`\n[OptimizeSingleBacktest] ✅✅✅ RESULTS EXTRACTED SUCCESSFULLY! ✅✅✅`);
      console.log(`  Trades: ${results.totalTrades}`);
      console.log(`  Win Rate: ${results.winRate.toFixed(2)}%`);
      console.log(`  Total PnL: $${results.totalPnL.toFixed(2)}`);
      console.log(`  Profit Factor: ${results.profitFactor.toFixed(2)}`);
      console.log(`  Total Return: ${results.totalReturnPercent.toFixed(2)}%\n`);
      logger.info(`[OptimizeSingleBacktest] ✅ runBacktest() completed successfully, continuing to save results...`);
      logger.info(`[OptimizeSingleBacktest] Continuing to save results to disk...`);
      
      // CRITICAL: Force flush logs and continue
      process.stdout.write(`\n[OptimizeSingleBacktest] 🔄 CONTINUING OPTIMIZATION LOOP... (iteration ${iteration}/${this.maxIterations})\n`);
      process.stdout.write(`[OptimizeSingleBacktest] 📋 Next steps: Save results → Display → Check profitability → AI analysis\n\n`);
      console.log(`\n[OptimizeSingleBacktest] 🔄 CONTINUING OPTIMIZATION LOOP... (iteration ${iteration}/${this.maxIterations})`);
      console.log(`[OptimizeSingleBacktest] 📋 Next steps: Save results → Display → Check profitability → AI analysis\n`);

      // Save results to JSON for tracking (with timeout to prevent hanging)
      process.stdout.write(`[OptimizeSingleBacktest] 💾 Starting file write operation...\n`);
      console.log(`[OptimizeSingleBacktest] 💾 Starting file write operation...`);
      logger.info('💾 Saving results to disk...');
      console.log(`[OptimizeSingleBacktest] 📁 About to save results file to disk...`);
      logger.info(`[OptimizeSingleBacktest] About to write results file to disk...`);
      logger.info(`[OptimizeSingleBacktest] About to write results file...`);
      const resultsFile = path.join(optimizationDir, `results_iteration_${iteration}_${Date.now()}.json`);
      try {
        logger.info(`[OptimizeSingleBacktest] Writing to: ${resultsFile}`);
        
        // Add timeout for file write (5 seconds max)
        const writePromise = fs.writeFile(resultsFile, JSON.stringify({
          iteration,
          timestamp: new Date().toISOString(),
          config: {
            symbol: config.symbol,
            startDate: config.startDate,
            endDate: config.endDate,
            timeframe: config.timeframe,
          },
          results,
        }, null, 2), 'utf-8');
        
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('File write timed out after 5 seconds')), 5000);
        });
        
        await Promise.race([writePromise, timeoutPromise]);
        
        process.stdout.write(`[OptimizeSingleBacktest] ✅ File write completed successfully\n`);
        logger.info(`✅ Results saved to: ${resultsFile}`);
        logger.info(`[OptimizeSingleBacktest] File write completed successfully`);
      } catch (error) {
        process.stdout.write(`[OptimizeSingleBacktest] ⚠️  File write failed or timed out - continuing anyway\n`);
        console.warn(`[OptimizeSingleBacktest] ⚠️  File write failed or timed out - continuing anyway`);
        logger.warn(`⚠️  Failed to save results file: ${error}`);
        // Continue anyway - results are still in memory
      }
      
      process.stdout.write(`[OptimizeSingleBacktest] 📝 File write section complete, continuing...\n`);
      console.log(`[OptimizeSingleBacktest] 📝 File write section complete, continuing...`);

      // Display results
      console.log(`\n[OptimizeSingleBacktest] 📊 DISPLAYING RESULTS...\n`);
      logger.info('\n📊 BACKTEST RESULTS:');
      logger.info(`[OptimizeSingleBacktest] About to display results...`);
      logger.info(`  Trades: ${results.totalTrades}`);
      logger.info(`    Won: ${results.winningTrades}`);
      logger.info(`    Lost: ${results.losingTrades}`);
      logger.info(`    Break-Even: ${results.breakEvenTrades}`);
      logger.info(`  Win Rate: ${results.winRate.toFixed(2)}%`);
      logger.info(`  Total PnL: $${results.totalPnL.toFixed(2)}`);
      logger.info(`  Profit Factor: ${results.profitFactor.toFixed(2)}`);
      logger.info(`  Avg R:R: ${results.avgRR.toFixed(2)}`);
      logger.info(`  Max Drawdown: ${results.maxDrawdownPercent.toFixed(2)}%`);
      logger.info(`  Total Return: ${results.totalReturnPercent.toFixed(2)}%`);

      // Compare with previous iteration if available
      let performanceWorsened = false;
      if (previousResults.length > 0) {
        const prev = previousResults[previousResults.length - 1];
        logger.info('\n📈 COMPARISON WITH PREVIOUS ITERATION:');
        logger.info(`  Trades: ${prev.totalTrades} → ${results.totalTrades} (${results.totalTrades > prev.totalTrades ? '+' : ''}${results.totalTrades - prev.totalTrades})`);
        logger.info(`  Win Rate: ${prev.winRate.toFixed(2)}% → ${results.winRate.toFixed(2)}% (${results.winRate > prev.winRate ? '+' : ''}${(results.winRate - prev.winRate).toFixed(2)}%)`);
        logger.info(`  Total PnL: $${prev.totalPnL.toFixed(2)} → $${results.totalPnL.toFixed(2)} (${results.totalPnL > prev.totalPnL ? '+' : ''}${(results.totalPnL - prev.totalPnL).toFixed(2)})`);
        logger.info(`  Profit Factor: ${prev.profitFactor.toFixed(2)} → ${results.profitFactor.toFixed(2)} (${results.profitFactor > prev.profitFactor ? '+' : ''}${(results.profitFactor - prev.profitFactor).toFixed(2)})`);
        logger.info(`  Avg R:R: ${prev.avgRR.toFixed(2)} → ${results.avgRR.toFixed(2)} (${results.avgRR > prev.avgRR ? '+' : ''}${(results.avgRR - prev.avgRR).toFixed(2)})`);
        logger.info(`  Max Drawdown: ${prev.maxDrawdownPercent.toFixed(2)}% → ${results.maxDrawdownPercent.toFixed(2)}% (${results.maxDrawdownPercent < prev.maxDrawdownPercent ? 'IMPROVED' : 'WORSE'})`);
        logger.info(`  Total Return: ${prev.totalReturnPercent.toFixed(2)}% → ${results.totalReturnPercent.toFixed(2)}% (${results.totalReturnPercent > prev.totalReturnPercent ? '+' : ''}${(results.totalReturnPercent - prev.totalReturnPercent).toFixed(2)}%)`);
        
        // Check if performance worsened (PnL decreased significantly)
        performanceWorsened = results.totalPnL < prev.totalPnL - 100; // Allow small variance
      }

      // Store for next iteration comparison
      previousResults.push(results);
      
      // If performance worsened and we have previous changes, revert them
      if (performanceWorsened && this.changeLog.length > 0 && iteration > 1) {
        const lastChangeEntry = this.changeLog[this.changeLog.length - 1];
        if (!lastChangeEntry.reverted) {
          logger.warn('\n⚠️  Performance worsened! Reverting previous changes...');
          await this.revertChanges(lastChangeEntry);
          lastChangeEntry.reverted = true;
          lastChangeEntry.revertReason = `Performance worsened: PnL dropped from $${previousResults[previousResults.length - 2].totalPnL.toFixed(2)} to $${results.totalPnL.toFixed(2)}`;
          await this.saveChangeLog();
          logger.info('✅ Previous changes reverted');
        }
      }

      // Check if profitable
      process.stdout.write(`\n[OptimizeSingleBacktest] 📊 CHECKING PROFITABILITY CRITERIA...\n`);
      console.log(`\n[OptimizeSingleBacktest] 📊 CHECKING PROFITABILITY CRITERIA...\n`);
      logger.info('\n📊 Checking profitability criteria...');
      logger.info(`  Profit Factor: ${results.profitFactor.toFixed(2)} (target: ≥1.3) - ${results.profitFactor >= 1.3 ? '✅' : '❌'}`);
      logger.info(`  Max Drawdown: ${results.maxDrawdownPercent.toFixed(2)}% (target: ≤25%) - ${results.maxDrawdownPercent <= 25 ? '✅' : '❌'}`);
      logger.info(`  Avg R:R: ${results.avgRR.toFixed(2)} (target: ≥2.5) - ${results.avgRR >= 2.5 ? '✅' : '❌'}`);
      logger.info(`  Win Rate: ${results.winRate.toFixed(2)}% (target: ≥35%) - ${results.winRate >= 35 ? '✅' : '❌'}`);
      logger.info(`  Total Return: ${results.totalReturnPercent.toFixed(2)}% (target: >0%) - ${results.totalReturnPercent > 0 ? '✅' : '❌'}`);
      
      const isProfitable = 
        results.profitFactor >= 1.3 &&
        results.maxDrawdownPercent <= 25 &&
        results.avgRR >= 2.5 &&
        results.winRate >= 35 &&
        results.totalReturnPercent > 0;

      if (isProfitable) {
        console.log(`\n[OptimizeSingleBacktest] ✅✅✅ STRATEGY IS PROFITABLE! ✅✅✅`);
        console.log(`[OptimizeSingleBacktest] All criteria met. Stopping optimization.\n`);
        logger.info('\n✅ Strategy is now profitable! All criteria met. Stopping optimization.');
        break;
      } else {
        console.log(`\n[OptimizeSingleBacktest] ⚠️  Strategy is NOT profitable yet.`);
        console.log(`[OptimizeSingleBacktest] Continuing to AI analysis phase...\n`);
        logger.info('\n⚠️  Strategy is not yet profitable. Continuing to AI analysis...');
      }

      if (iteration === this.maxIterations) {
        console.log(`\n[OptimizeSingleBacktest] ⚠️  Reached max iterations (${this.maxIterations}). Stopping optimization.\n`);
        logger.info('\n⚠️  Reached max iterations. Stopping optimization.');
        logger.info(`[OptimizeSingleBacktest] Current iteration: ${iteration}, Max iterations: ${this.maxIterations}`);
        break;
      }

      console.log(`\n[OptimizeSingleBacktest] 🔄 Continuing to iteration ${iteration + 1}/${this.maxIterations}...`);
      console.log(`[OptimizeSingleBacktest] Next: Read strategy logic → AI analysis → Apply suggestions → Re-test\n`);
      logger.info(`[OptimizeSingleBacktest] ✅ Iteration ${iteration} is not max (${this.maxIterations}), continuing to AI analysis...`);

      // Get strategy logic (with timeout to prevent hanging)
      logger.info('\n📖 Step 1: Reading strategy logic...');
      logger.info(`[OptimizeSingleBacktest] About to call getStrategyLogic()...`);
      let strategyLogic: string;
      try {
        const strategyLogicPromise = this.getStrategyLogic();
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('Reading strategy files timed out after 10 seconds'));
          }, 10000);
        });
        strategyLogic = await Promise.race([strategyLogicPromise, timeoutPromise]);
        logger.info('✅ Strategy logic loaded successfully');
      } catch (error) {
        logger.warn('⚠️  Could not read strategy files (using minimal context):', error);
        strategyLogic = 'Strategy files could not be read. Please provide suggestions based on backtest results only.';
      }

      // Analyze with AI (include previous results and change history for comparison)
      process.stdout.write(`\n[OptimizeSingleBacktest] 🤖 STEP 2: ABOUT TO ANALYZE WITH OPENAI...\n`);
      process.stdout.write(`[OptimizeSingleBacktest] ⏱️  This may take 30-60 seconds...\n`);
      console.log(`\n[OptimizeSingleBacktest] 🤖 STEP 2: ABOUT TO ANALYZE WITH OPENAI...`);
      console.log(`[OptimizeSingleBacktest] ⏱️  This may take 30-60 seconds...`);
      logger.info('\n🤖 Step 2: Analyzing with OpenAI...');
      logger.info('⏱️  This may take 30-60 seconds (or up to 2 minutes if API is slow)...');
      logger.info('💡 If this hangs, check your OPENAI_API_KEY and network connection');
      logger.info(`[OptimizeSingleBacktest] About to call analyzeWithAI()...`);
      logger.info(`[OptimizeSingleBacktest] Previous results count: ${previousResults.length}`);
      logger.info(`[OptimizeSingleBacktest] Change log entries: ${this.changeLog.length}`);
      
      const previousResult = previousResults.length > 1 ? previousResults[previousResults.length - 2] : null;
      const changeHistory = this.changeLog.filter(entry => !entry.reverted).slice(-3); // Last 3 non-reverted changes
      
      logger.info(`[OptimizeSingleBacktest] Previous result: ${previousResult ? 'exists' : 'null'}`);
      logger.info(`[OptimizeSingleBacktest] Change history entries: ${changeHistory.length}`);
      
      // CRITICAL: Verify OpenAI API key before making call
      if (!process.env.OPENAI_API_KEY) {
        process.stdout.write(`[OptimizeSingleBacktest] ❌ ERROR: OPENAI_API_KEY not set!\n`);
        console.error(`[OptimizeSingleBacktest] ❌ ERROR: OPENAI_API_KEY not set!`);
        throw new Error('OPENAI_API_KEY environment variable is required for AI analysis');
      }
      
      process.stdout.write(`[OptimizeSingleBacktest] ✅ OPENAI_API_KEY found, calling analyzeWithAI() now...\n`);
      console.log(`[OptimizeSingleBacktest] ✅ OPENAI_API_KEY found, calling analyzeWithAI() now...`);
      
      let analysis: string;
      try {
        logger.info(`[OptimizeSingleBacktest] Calling analyzeWithAI() now...`);
        process.stdout.write(`[OptimizeSingleBacktest] ⏳ Awaiting analyzeWithAI()...\n`);
        analysis = await this.analyzeWithAI(results, strategyLogic, previousResult, changeHistory);
        process.stdout.write(`[OptimizeSingleBacktest] ✅ analyzeWithAI() returned successfully!\n`);
        console.log(`[OptimizeSingleBacktest] ✅ analyzeWithAI() returned successfully!`);
        logger.info('✅ AI analysis completed');
        logger.info(`[OptimizeSingleBacktest] ✅ analyzeWithAI() returned successfully, length: ${analysis.length} chars`);
      } catch (error) {
        logger.error(`[OptimizeSingleBacktest] ❌ Error in analyzeWithAI():`, error);
        if (error instanceof Error && error.message.includes('timed out')) {
          logger.error('❌ OpenAI API timed out!');
          logger.warn('⚠️  Skipping AI analysis for this iteration. Continuing with manual optimization...');
          logger.warn('💡 Check your OpenAI API key and network connection.');
          // Continue without AI analysis - skip to next iteration
          continue;
        }
        logger.error('❌ AI analysis failed:', error);
        throw error;
      }
      
      // Save analysis
      const analysisDir = path.join(process.cwd(), 'backtests', 'optimization');
      await fs.mkdir(analysisDir, { recursive: true });
      const analysisFile = path.join(analysisDir, `analysis_iteration_${iteration}_${Date.now()}.md`);
      await fs.writeFile(analysisFile, analysis, 'utf-8');
      logger.info(`💾 Analysis saved to: ${analysisFile}`);

      // Display analysis
      logger.info('\n📋 AI ANALYSIS:');
      logger.info(analysis);

      // Apply suggestions and log changes
      logger.info('\n🔧 Applying suggestions...');
      try {
        const changes = await this.applySuggestions(analysis);
        
        if (changes.length === 0) {
          logger.warn('⚠️  No changes were applied. AI suggestions may not have been in the correct format.');
          logger.warn('💡 Tip: Ensure AI uses the exact format:');
          logger.warn('   FILE:.env');
          logger.warn('   SET:VARIABLE_NAME');
          logger.warn('   TO:new_value');
          logger.warn('   REASON:explanation');
          logger.warn('Skipping to next iteration...');
          continue;
        }
        
        // Filter out code changes that weren't actually applied
        const appliedChanges = changes.filter(c => {
          if (c.type === 'code' && !c.oldValue && !c.newValue) {
            logger.warn(`⚠️  Skipping code change for ${c.file} - not auto-applied for safety`);
            return false;
          }
          return true;
        });
        
        if (appliedChanges.length === 0) {
          logger.warn('⚠️  No valid changes could be applied (code changes require manual review).');
          logger.warn('💡 Tip: Ask AI to suggest .env variable changes instead of code changes.');
          logger.warn('Skipping to next iteration...');
          continue;
        }

        // Display detailed change summary
        logger.info('\n📝 CHANGES APPLIED:');
        logger.info('='.repeat(80));
        appliedChanges.forEach((change, idx) => {
          logger.info(`\n${idx + 1}. ${change.type === 'env' ? '📄 .env' : '💻 Code'} - ${change.file}`);
          if (change.type === 'env' && change.variable) {
            logger.info(`   Variable: ${change.variable}`);
            logger.info(`   Old Value: ${change.oldValue || '(not set)'}`);
            logger.info(`   New Value: ${change.newValue || '(not set)'}`);
          }
          if (change.reason) {
            logger.info(`   Reason: ${change.reason}`);
          }
        });
        logger.info('\n' + '='.repeat(80));

        // Log the changes
        const changeEntry: ChangeLogEntry = {
          iteration,
          timestamp: new Date().toISOString(),
          changes: appliedChanges,
          results,
          reverted: false,
        };
        this.changeLog.push(changeEntry);
        await this.saveChangeLog();
        logger.info(`💾 Changes logged to: ${this.changeLogPath}`);
        
        // Also save a human-readable markdown summary (non-blocking)
        this.saveChangeSummary(iteration, appliedChanges, results).catch(err => {
          logger.warn('⚠️  Failed to save change summary (non-critical):', err);
        });
        logger.info('✅ Suggestions applied');
      } catch (error) {
        logger.error('❌ Error applying suggestions:', error);
        break;
      }

        // Wait a bit for file writes to complete
        process.stdout.write(`\n[OPTIMIZER] ⏳ Waiting 2 seconds before next iteration...\n`);
        console.log(`\n[OPTIMIZER] ⏳ Waiting 2 seconds for file writes to complete...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        process.stdout.write(`[OPTIMIZER] ✅ Ready to start next iteration\n\n`);
        console.log(`[OPTIMIZER] ✅ Ready to start next iteration\n`);
      } catch (iterationError) {
        // CRITICAL: Catch any iteration errors and continue
        process.stderr.write(`\n[OPTIMIZER] ❌ ERROR IN ITERATION ${iteration}: ${iterationError instanceof Error ? iterationError.message : String(iterationError)}\n`);
        console.error(`\n[OPTIMIZER] ❌ ERROR IN ITERATION ${iteration}:`, iterationError);
        logger.error(`[OPTIMIZER] Error in iteration ${iteration}:`, iterationError);
        if (iterationError instanceof Error && iterationError.stack) {
          logger.error(`[OPTIMIZER] Stack trace:`, iterationError.stack);
        }
        // Continue to next iteration instead of breaking
        process.stdout.write(`[OPTIMIZER] ⚠️  Continuing to next iteration despite error...\n\n`);
        logger.warn(`[OPTIMIZER] Continuing to next iteration despite error`);
      }
    }

    // CRITICAL: Always print completion message with explicit stdout
    process.stdout.write('\n' + '█'.repeat(80) + '\n');
    process.stdout.write('█' + ' '.repeat(78) + '█\n');
    process.stdout.write('█' + ' OPTIMIZATION COMPLETE! '.padStart(51).padEnd(78) + '█\n');
    process.stdout.write('█' + ' '.repeat(78) + '█\n');
    process.stdout.write('█'.repeat(80) + '\n\n');
    console.log('\n' + '█'.repeat(80));
    console.log('█' + ' '.repeat(78) + '█');
    console.log('█' + ' OPTIMIZATION COMPLETE! '.padStart(51).padEnd(78) + '█');
    console.log('█' + ' '.repeat(78) + '█');
    console.log('█'.repeat(80) + '\n');
    
    // Print summary
    process.stdout.write(`\n${'='.repeat(80)}\n`);
    process.stdout.write(`[OptimizeSingleBacktest] ✅ Optimization loop completed!\n`);
    process.stdout.write(`[OptimizeSingleBacktest] Max iterations: ${this.maxIterations}\n`);
    process.stdout.write(`[OptimizeSingleBacktest] Successful iterations: ${previousResults.length}\n`);
    process.stdout.write(`${'='.repeat(80)}\n\n`);
    
    if (previousResults.length === 0) {
      process.stdout.write(`\n${'='.repeat(80)}\n`);
      process.stdout.write(`[OptimizeSingleBacktest] ⚠️  WARNING: NO ITERATIONS COMPLETED SUCCESSFULLY!\n`);
      process.stdout.write(`[OptimizeSingleBacktest] All ${this.maxIterations} iterations returned null results.\n`);
      process.stdout.write(`[OptimizeSingleBacktest] This suggests the backtest is failing or timing out.\n`);
      process.stdout.write(`${'='.repeat(80)}\n\n`);
      logger.warn(`⚠️  WARNING: No iterations completed successfully - all returned null results`);
      logger.warn(`This suggests the backtest is failing or timing out`);
    }
    
    process.stdout.write(`[OptimizeSingleBacktest] ✅ Optimization completed!\n`);
    process.stdout.write(`[OptimizeSingleBacktest] Total successful iterations: ${previousResults.length}\n`);
    if (previousResults.length > 0) {
      const lastResult = previousResults[previousResults.length - 1];
      process.stdout.write(`[OptimizeSingleBacktest] Final Results:\n`);
      process.stdout.write(`  - Trades: ${lastResult.totalTrades}\n`);
      process.stdout.write(`  - Win Rate: ${lastResult.winRate.toFixed(2)}%\n`);
      process.stdout.write(`  - Total PnL: $${lastResult.totalPnL.toFixed(2)}\n`);
      process.stdout.write(`  - Profit Factor: ${lastResult.profitFactor.toFixed(2)}\n`);
      process.stdout.write(`  - Total Return: ${lastResult.totalReturnPercent.toFixed(2)}%\n`);
    }
    process.stdout.write(`[OptimizeSingleBacktest] Final results and change log saved to: backtests/optimization/\n\n`);
    
    logger.info('\n✅ Optimization complete!');
    logger.info(`Total iterations completed: ${previousResults.length}`);
    if (previousResults.length > 0) {
      const lastResult = previousResults[previousResults.length - 1];
      logger.info(`Final Results: ${lastResult.totalTrades} trades, ${lastResult.winRate.toFixed(2)}% win rate, $${lastResult.totalPnL.toFixed(2)} PnL`);
    }
    console.log('[OptimizeSingleBacktest] Final results and change log saved to: backtests/optimization/\n');
    
    // Force flush all output
    process.stdout.write('');
    process.stderr.write('');
  }
}

// Main execution
async function main() {
  // CRITICAL: Log immediately to confirm script is running
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📋 OPTIMIZE-SINGLE SCRIPT STARTED');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`[OptimizeSingleBacktest] Script file: ${__filename}`);
  console.log(`[OptimizeSingleBacktest] Working directory: ${process.cwd()}`);
  
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('📋 OPTIMIZE-SINGLE SCRIPT STARTED');
  logger.info('═══════════════════════════════════════════════════════════');
  
  const args = process.argv.slice(2);
  console.log(`[OptimizeSingleBacktest] Command line args: ${args.join(' ')}`);
  logger.info(`[OptimizeSingleBacktest] Command line args: ${args.join(' ')}`);
  
  function getArg(flag: string, defaultValue: string): string {
    const index = args.indexOf(flag);
    if (index > -1 && index + 1 < args.length) {
      return args[index + 1];
    }
    return defaultValue;
  }

  const from = getArg('--from', '2024-05-01');
  const to = getArg('--to', '2024-06-30');
  const symbol = getArg('--symbol', 'XAUUSD');
  const dataSource = getArg('--data-source', 'postgres') as 'mt5' | 'postgres';
  
  logger.info(`[OptimizeSingleBacktest] Parsed config: from=${from}, to=${to}, symbol=${symbol}, dataSource=${dataSource}`);

  // Use M5 timeframe for faster backtests (5x fewer candles to process)
  // M5 is still accurate enough for SMC strategy testing
  const config: BacktestConfig = {
    symbol,
    strategies: ['low'],
    startDate: from,
    endDate: to,
    dataSource,
    timeframe: 'M5', // Changed from M1 to M5 for 5x speed improvement
    initialBalance: 10000,
    riskPerTradePercent: 0.25,
  };
  
  logger.info(`Using ${config.timeframe} timeframe for faster backtesting (5x fewer candles than M1)`);
  logger.info(`[OptimizeSingleBacktest] Creating optimizer instance...`);

  console.log(`[OptimizeSingleBacktest] Creating optimizer instance...`);
  const optimizer = new SingleBacktestOptimizer();
  console.log(`[OptimizeSingleBacktest] Optimizer created, calling optimize()...`);
  logger.info(`[OptimizeSingleBacktest] Optimizer created, calling optimize()...`);
  
  try {
    process.stdout.write(`[OptimizeSingleBacktest] 🔵 About to await optimize()...\n`);
    console.log(`[OptimizeSingleBacktest] 🔵 About to await optimize()...`);
    
    await optimizer.optimize(config);
    
    process.stdout.write(`[OptimizeSingleBacktest] ✅ Optimize() completed successfully\n`);
    console.log(`[OptimizeSingleBacktest] ✅ Optimize() completed successfully`);
    logger.info(`[OptimizeSingleBacktest] ✅ Optimize() completed successfully`);
  } catch (error) {
    process.stderr.write(`[OptimizeSingleBacktest] ❌ Optimize() failed: ${error}\n`);
    console.error(`[OptimizeSingleBacktest] ❌ Optimize() failed:`, error);
    logger.error(`[OptimizeSingleBacktest] ❌ Optimize() failed:`, error);
    throw error;
  } finally {
    // Always ensure we've flushed output
    process.stdout.write('');
    process.stderr.write('');
  }
}

// CRITICAL: Use console.log for immediate output (bypasses logger buffering)
console.log('\n' + '█'.repeat(80));
console.log('█' + ' '.repeat(78) + '█');
console.log('█' + ' OPTIMIZE-SINGLE BACKTEST SCRIPT - STARTING NOW '.padStart(54).padEnd(78) + '█');
console.log('█' + ' '.repeat(78) + '█');
console.log('█'.repeat(80) + '\n');
console.log('[OptimizeSingleBacktest] Script file loaded, calling main()...');
console.log('[OptimizeSingleBacktest] Process args:', process.argv.slice(2).join(' '));
console.log('[OptimizeSingleBacktest] Working directory:', process.cwd());
console.log('[OptimizeSingleBacktest] Node version:', process.version);
console.log('[OptimizeSingleBacktest] Script path:', __filename);
console.log('');

// Check critical environment variables
if (!process.env.OPENAI_API_KEY) {
  console.error('\n❌ ERROR: OPENAI_API_KEY environment variable is not set!');
  console.error('   Set it in your .env file or export it before running.');
  console.error('   Example: export OPENAI_API_KEY=sk-...\n');
  process.exit(1);
} else {
  console.log(`[OptimizeSingleBacktest] ✅ OPENAI_API_KEY is set (length: ${process.env.OPENAI_API_KEY.length} chars)`);
}

if (!process.env.DATABASE_URL && process.argv.includes('--data-source') && process.argv[process.argv.indexOf('--data-source') + 1] === 'postgres') {
  console.warn('⚠️  WARNING: DATABASE_URL not set but --data-source=postgres specified.');
  console.warn('   Falling back to mock data source.');
} else if (process.env.DATABASE_URL) {
  console.log(`[OptimizeSingleBacktest] ✅ DATABASE_URL is set`);
}

console.log('\n' + '='.repeat(80));
console.log('🚀 CALLING main() FUNCTION NOW...');
console.log('='.repeat(80) + '\n');

// Add global unhandled exception handlers
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  process.stderr.write(`\n[OptimizeSingleBacktest] ❌ UNHANDLED REJECTION:\n`);
  process.stderr.write(`Reason: ${reason}\n`);
  if (reason instanceof Error) {
    process.stderr.write(`Stack: ${reason.stack || 'No stack trace'}\n`);
  }
  console.error('\n[OptimizeSingleBacktest] ❌ UNHANDLED REJECTION:', reason);
  logger.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (error: Error) => {
  process.stderr.write(`\n[OptimizeSingleBacktest] ❌ UNCAUGHT EXCEPTION:\n`);
  process.stderr.write(`Error: ${error.message}\n`);
  process.stderr.write(`Stack: ${error.stack || 'No stack trace'}\n`);
  console.error('\n[OptimizeSingleBacktest] ❌ UNCAUGHT EXCEPTION:', error);
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

main().catch(error => {
  process.stderr.write('\n' + '='.repeat(80) + '\n');
  process.stderr.write('[OptimizeSingleBacktest] ❌ FATAL ERROR in main():\n');
  process.stderr.write('='.repeat(80) + '\n');
  process.stderr.write(`${error}\n`);
  if (error instanceof Error) {
    process.stderr.write(`\nError message: ${error.message}\n`);
    process.stderr.write(`\nError stack:\n`);
    process.stderr.write(`${error.stack || 'No stack trace available'}\n`);
  }
  console.error('\n' + '='.repeat(80));
  console.error('[OptimizeSingleBacktest] ❌ FATAL ERROR in main():');
  console.error('='.repeat(80));
  console.error(error);
  if (error instanceof Error) {
    console.error('\nError message:', error.message);
    console.error('\nError stack:');
    console.error(error.stack || 'No stack trace available');
  }
  logger.error('Optimization failed:', error);
  process.exit(1);
});

