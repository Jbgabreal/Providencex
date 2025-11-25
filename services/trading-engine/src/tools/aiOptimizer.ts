/**
 * AI-Powered Strategy Optimizer
 * 
 * Uses OpenAI to analyze backtest results and suggest improvements
 * Iterates until strategy is profitable
 * 
 * Usage:
 *   pnpm tsx src/tools/aiOptimizer.ts --symbol XAUUSD --data-source postgres --year 2023
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
  console.log('[AIOptimizer] USE_SMC_V2 not set, defaulting to true for backtests');
}

const logger = new Logger('AIOptimizer');

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
  maxDrawdown: number;
  status: '✅' | '❌';
}

interface BacktestSummary {
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

interface AISuggestion {
  priority: 'high' | 'medium' | 'low';
  category: string;
  description: string;
  codeChanges: string[];
  configChanges: Record<string, string>;
  reasoning: string;
}

interface AIAnalysis {
  diagnosis: string;
  rootCauses: string[];
  suggestions: AISuggestion[];
  expectedImpact: string;
}

class AIStrategyOptimizer {
  private openai: OpenAI;
  private maxIterations: number;
  private targetMetrics: {
    profitFactor: number;
    maxDrawdown: number;
    avgRR: number;
    winRate: number;
    profitableMonths: number;
  };
  private targetMonthlyReturn: number;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    this.openai = new OpenAI({ apiKey });
    this.maxIterations = parseInt(process.env.AI_OPTIMIZER_MAX_ITERATIONS || '2', 10); // Default to 2 iterations
    
    this.targetMetrics = {
      profitFactor: 1.3,
      maxDrawdown: 25.0,
      avgRR: 2.5,
      winRate: 35.0,
      profitableMonths: 10, // At least 83% of months profitable (10/12)
    };
    
    // Target monthly return: 30-35%
    this.targetMonthlyReturn = 30.0;
  }

  /**
   * Run batch backtest and collect results
   */
  async runBatchBacktest(
    symbol: string,
    dataSource: 'mt5' | 'postgres',
    year: number,
    monthsToTest: number = 12
  ): Promise<BacktestSummary> {
    logger.info(`Running batch backtest for ${symbol} using ${dataSource} data for year ${year} (${monthsToTest} months)`);

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

    logger.info(`\n📅 Starting ${monthsToTest}-month backtest batch...`);
    for (let month = 1; month <= monthsToTest; month++) {
      const monthStr = month.toString().padStart(2, '0');
      const startDate = `${year}-${monthStr}-01`;
      const endDate = new Date(year, month, 0).toISOString().slice(0, 10);

      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`[${month}/${monthsToTest}] Running backtest for ${year}-${monthStr}`);
      logger.info(`  Date Range: ${startDate} to ${endDate}`);
      logger.info(`${'='.repeat(60)}`);

      const config: BacktestConfig = {
        symbol,
        strategies: ['low'], // Default strategy
        startDate: startDate, // ISO date string: '2024-01-01'
        endDate: endDate, // ISO date string: '2024-01-31'
        timeframe: 'M1',
        initialBalance: 10000,
        riskPerTradePercent: 0.25,
        dataSource,
      };

      try {
        // BacktestRunner requires dataLoaderConfig as second parameter
        const dataLoaderConfig = {
          dataSource: dataSource as 'csv' | 'postgres' | 'mt5' | 'mock',
          databaseUrl: process.env.DATABASE_URL,
          mt5BaseUrl: process.env.MT5_CONNECTOR_URL,
        };
        const runner = new BacktestRunner(config, dataLoaderConfig);
        const startTime = Date.now();
        logger.info(`[${month}/${monthsToTest}] ⏳ Starting backtest... (this may take 5-15 minutes)`);
        
        // Add timeout protection (30 minutes max per month)
        const timeoutMs = 30 * 60 * 1000; // 30 minutes
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Backtest timeout after 30 minutes')), timeoutMs);
        });
        
        const results = await Promise.race([
          runner.run(),
          timeoutPromise
        ]) as any;
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const durationMinutes = (parseFloat(duration) / 60).toFixed(1);
        
        // BacktestResult has stats property
        const stats = results.stats;
        logger.info(`[${month}/${monthsToTest}] ✅ Completed ${year}-${monthStr} in ${durationMinutes}min - Trades: ${stats.totalTrades}, PnL: $${stats.totalPnL.toFixed(2)}, WR: ${stats.winRate.toFixed(1)}%`);

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
            maxDrawdown: parseFloat(stats.maxDrawdownPercent.toFixed(2)),
            status: stats.totalPnL > 0 ? '✅' : '❌',
          };
          allMonthlyResults.push(monthlyResult);

          totalTrades += stats.totalTrades;
          totalPnL += stats.totalPnL;
          totalWinRate += stats.winRate;
          totalProfitFactor += stats.profitFactor;
          totalAvgRR += stats.averageRr;
          totalReturn += results.totalReturn;
          if (stats.totalPnL > 0) {
            profitableMonths++;
          } else {
            losingMonths++;
          }
          if (stats.maxDrawdownPercent > maxOverallDrawdown) {
            maxOverallDrawdown = stats.maxDrawdownPercent;
          }
        } else {
          logger.warn(`No results for ${year}-${monthStr}`);
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
            maxDrawdown: 0,
            status: '❌',
          });
          losingMonths++;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : '';
        logger.error(`[${month}/${monthsToTest}] ❌ Error running backtest for ${year}-${monthStr}: ${errorMessage}`);
        if (errorStack) {
          logger.error(`Stack trace: ${errorStack}`);
        }
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
          maxDrawdown: 0,
          status: '❌',
        });
        losingMonths++;
      }
    }

    const avgWinRate = totalWinRate / monthsToTest;
    const avgProfitFactor = totalProfitFactor / monthsToTest;
    const avgAvgRR = totalAvgRR / monthsToTest;
    // Calculate average monthly return as percentage (not absolute)
    const avgMonthlyReturn = allMonthlyResults.length > 0 
      ? allMonthlyResults.reduce((sum, m) => sum + m.totalReturn, 0) / allMonthlyResults.length
      : 0;

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

  /**
   * Get current strategy configuration
   */
  async getCurrentConfig(): Promise<string> {
    const envPath = path.resolve(process.cwd(), '.env');
    try {
      const envContent = await fs.readFile(envPath, 'utf-8');
      return envContent;
    } catch (error) {
      logger.warn('Could not read .env file, returning empty config');
      return '';
    }
  }

  /**
   * Get strategy code context (key files) - LIMITED to avoid token limits
   */
  async getStrategyContext(): Promise<string> {
    // Only include key configuration and critical logic (reduced to save tokens)
    const keyFiles = [
      { path: 'src/config/executionFilterConfig.ts', maxLines: 100 },
      { path: 'src/strategy/v2/M1ExecutionService.ts', maxLines: 200 }, // Focus on entry/SL/TP logic
    ];

    const context: string[] = [];
    context.push('## Key Strategy Configuration');
    context.push('Focus: Entry quality filters, SL/TP placement, market condition filters');
    
    for (const file of keyFiles) {
      try {
        const filePath = path.resolve(process.cwd(), file.path);
        const content = await fs.readFile(filePath, 'utf-8');
        // Only include first N lines to avoid token limits
        const lines = content.split('\n').slice(0, file.maxLines).join('\n');
        context.push(`\n=== ${file.path} (first ${file.maxLines} lines) ===\n${lines}`);
      } catch (error) {
        logger.warn(`Could not read ${file.path}`);
      }
    }

    return context.join('\n\n');
  }

  /**
   * Analyze backtest results using OpenAI
   */
  async analyzeResults(summary: BacktestSummary, iteration: number): Promise<AIAnalysis> {
    logger.info(`Requesting AI analysis (iteration ${iteration})...`);

    const config = await this.getCurrentConfig();
    const strategyContext = await this.getStrategyContext();

    const prompt = `You are an expert algorithmic trading strategy optimizer specializing in Smart Money Concepts (SMC) and ICT trading strategies.

## Current Strategy Context
${strategyContext}

## Current Configuration
\`\`\`
${config}
\`\`\`

## Backtest Results (Iteration ${iteration})

### Overall Performance
- Total Months: ${summary.totalMonths}
- Profitable Months: ${summary.profitableMonths} (${((summary.profitableMonths / summary.totalMonths) * 100).toFixed(1)}%)
- Losing Months: ${summary.losingMonths} (${((summary.losingMonths / summary.totalMonths) * 100).toFixed(1)}%)
- Total Trades: ${summary.totalTrades}
- Avg Trades/Month: ${summary.avgTradesPerMonth.toFixed(1)}
- Avg Win Rate: ${summary.avgWinRate.toFixed(2)}% (target: ${this.targetMetrics.winRate}%+)
- Total PnL: $${summary.totalPnL.toFixed(2)}
- Avg Monthly Return: ${summary.avgMonthlyReturn.toFixed(2)}% (target: ${this.targetMonthlyReturn}%+)
- Avg Profit Factor: ${summary.avgProfitFactor.toFixed(2)} (target: ${this.targetMetrics.profitFactor}+)
- Avg R:R: ${summary.avgRR.toFixed(2)} (target: ${this.targetMetrics.avgRR}+)
- Max Drawdown: ${summary.maxDrawdown.toFixed(2)}% (target: <${this.targetMetrics.maxDrawdown}%)

### Monthly Breakdown
${summary.monthlyResults.map(m => 
  `${m.month}: ${m.trades} trades, ${m.winRate.toFixed(1)}% WR, $${m.totalPnL.toFixed(2)} PnL, PF ${m.profitFactor.toFixed(2)}, R:R ${m.avgRR.toFixed(2)} ${m.status}`
).join('\n')}

## Target Metrics
- Profit Factor: ≥ ${this.targetMetrics.profitFactor}
- Max Drawdown: ≤ ${this.targetMetrics.maxDrawdown}%
- Avg R:R: ≈ ${this.targetMetrics.avgRR}
- Win Rate: ≥ ${this.targetMetrics.winRate}%
- Profitable Months: ≥ ${this.targetMetrics.profitableMonths}/12

## Your Task

Analyze the backtest results and provide:

1. **Diagnosis**: What is the primary issue preventing profitability?
2. **Root Causes**: List 3-5 specific root causes (e.g., "SLs being hit too often", "TPs not being reached", "Overtrading in choppy markets")
3. **Suggestions**: Provide 3-5 concrete, actionable suggestions with:
   - Priority (high/medium/low)
   - Category (Entry Quality, SL Placement, TP Placement, Market Filters, etc.)
   - Description
   - Specific code changes (file paths, function names, line numbers if possible)
   - Config changes (environment variable names and values)
   - Reasoning (why this will help)
4. **Expected Impact**: What improvement do you expect from these changes?

## Response Format

Return a JSON object with this structure:
\`\`\`json
{
  "diagnosis": "Brief diagnosis of the main problem",
  "rootCauses": ["Cause 1", "Cause 2", "Cause 3"],
  "suggestions": [
    {
      "priority": "high",
      "category": "SL Placement",
      "description": "What to change",
      "codeChanges": [
        "FILE:src/strategy/v2/M1ExecutionService.ts | SET:minRiskDistance | TO:0.8",
        "FILE:src/strategy/v2/M1ExecutionService.ts | SET:displacementQuality | TO:7"
      ],
      "configChanges": {"EXEC_FILTER_MIN_CONFLUENCE_SCORE": "60", "SL_POI_BUFFER": "0.0005"},
      "reasoning": "Why this helps",
      "expectedImpact": "Expected improvement"
    }
  ],
  "expectedImpact": "Overall expected improvement"
}
\`\`\`

**IMPORTANT**: For code changes, use this exact format:
- "FILE:path/to/file.ts | SET:variableName | TO:newValue" - Updates a variable value
- "FILE:path/to/file.ts | PATTERN:search pattern | REPLACE:old | WITH:new" - Pattern replacement

**Key variables you can modify**:
- M1ExecutionService.ts: displacementQuality, confluenceScore, minRiskDistance, minRetracePct, maxRetracePct
- SMCStrategyV2.ts: trendStrength, volatility
- executionFilterConfig.ts: minConfluenceScore, displacementMinATRMultiplier

Focus on the most impactful changes first. Be specific and actionable.`;

    try {
      // Use a smaller model or reduce prompt size to avoid rate limits
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'; // Use smaller model to avoid rate limits
      
      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert algorithmic trading strategy optimizer. Provide detailed, actionable suggestions in JSON format. Be concise but specific.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
        max_tokens: 2000, // Limit response size
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      const analysis = JSON.parse(content) as AIAnalysis;
      return analysis;
    } catch (error) {
      logger.error('Error analyzing results with AI:', error);
      throw error;
    }
  }

  /**
   * Apply AI suggestions to code and config
   */
  async applySuggestions(suggestions: AISuggestion[]): Promise<void> {
    logger.info(`Applying ${suggestions.length} AI suggestions...`);

    // Sort by priority
    const sorted = suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    // Apply config changes first
    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = await fs.readFile(envPath, 'utf-8').catch(() => '');

    for (const suggestion of sorted) {
      logger.info(`Applying suggestion: ${suggestion.description} (${suggestion.priority} priority)`);

      // Apply config changes
      for (const [key, value] of Object.entries(suggestion.configChanges)) {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(envContent)) {
          envContent = envContent.replace(regex, `${key}=${value}`);
          logger.info(`  ✅ Updated ${key}=${value}`);
        } else {
          envContent += `\n${key}=${value}`;
          logger.info(`  ✅ Added ${key}=${value}`);
        }
      }
    }

    await fs.writeFile(envPath, envContent);

    // Apply code changes automatically
    for (const suggestion of sorted) {
      if (suggestion.codeChanges.length > 0) {
        logger.info(`\n📝 Applying code changes for: ${suggestion.description}`);
        await this.applyCodeChanges(suggestion.codeChanges);
      }
    }
  }

  /**
   * Apply code changes to TypeScript files
   */
  async applyCodeChanges(codeChanges: string[]): Promise<void> {
    for (const change of codeChanges) {
      try {
        // Parse change instruction
        // Format: "FILE:path/to/file.ts | PATTERN:search pattern | REPLACE:replacement"
        // Or: "FILE:path/to/file.ts | LINE:123 | REPLACE:old value | WITH:new value"
        // Or: "FILE:path/to/file.ts | SET:variableName | TO:newValue"
        
        if (change.includes('|')) {
          const parts = change.split('|').map(p => p.trim());
          const filePart = parts.find(p => p.startsWith('FILE:'));
          const patternPart = parts.find(p => p.startsWith('PATTERN:'));
          const replacePart = parts.find(p => p.startsWith('REPLACE:'));
          const withPart = parts.find(p => p.startsWith('WITH:'));
          const setPart = parts.find(p => p.startsWith('SET:'));
          const toPart = parts.find(p => p.startsWith('TO:'));
          const linePart = parts.find(p => p.startsWith('LINE:'));

          if (filePart) {
            const filePath = filePart.replace('FILE:', '').trim();
            const fullPath = path.resolve(process.cwd(), filePath);
            
            let fileContent = await fs.readFile(fullPath, 'utf-8');
            let modified = false;

            // Pattern-based replacement
            if (patternPart && replacePart && withPart) {
              const pattern = patternPart.replace('PATTERN:', '').trim();
              const oldValue = replacePart.replace('REPLACE:', '').trim();
              const newValue = withPart.replace('WITH:', '').trim();
              
              // Try regex replacement
              const regex = new RegExp(pattern.replace(/\//g, '\\/'), 'g');
              if (regex.test(fileContent)) {
                fileContent = fileContent.replace(regex, (match) => {
                  return match.replace(oldValue, newValue);
                });
                modified = true;
                logger.info(`  ✅ Updated pattern in ${filePath}`);
              }
            }
            
            // Variable assignment (SET variable TO value)
            if (setPart && toPart) {
              const varName = setPart.replace('SET:', '').trim();
              const newValue = toPart.replace('TO:', '').trim();
              
              // Common patterns to update
              const patterns = [
                // Threshold assignments: const threshold = 6; -> const threshold = newValue;
                new RegExp(`(const\\s+${varName}\\s*=\\s*)[0-9.]+(\\s*;)`, 'g'),
                // If conditions: if (score < 6) -> if (score < newValue)
                new RegExp(`(if\\s*\\([^<]+<\\s*)${varName}(\\s*\\))`, 'g'),
                // Comparisons: threshold < 6 -> threshold < newValue
                new RegExp(`(${varName}\\s*[<>=!]+\\s*)[0-9.]+`, 'g'),
                // Direct value: 6 -> newValue (when near variable name)
                new RegExp(`(${varName}[^0-9]*)[0-9.]+`, 'g'),
              ];

              for (const pattern of patterns) {
                if (pattern.test(fileContent)) {
                  fileContent = fileContent.replace(pattern, `$1${newValue}`);
                  modified = true;
                }
              }

              // Specific known patterns
              const specificPatterns: Record<string, RegExp> = {
                'displacementQuality': /(displacementQuality\s*<\s*)[0-9.]+/g,
                'confluenceScore': /(confluenceScore\s*<\s*)[0-9.]+/g,
                'minRiskDistance': /(minRiskDistance\s*=\s*)[0-9.]+/g,
                'trendStrength': /(trendStrength\s*<\s*)[0-9.]+/g,
                'volatility': /(volatility\s*<\s*)[0-9.]+/g,
                'minRetracePct': /(minRetracePct\s*=\s*)[0-9.]+/g,
                'maxRetracePct': /(maxRetracePct\s*=\s*)[0-9.]+/g,
              };

              if (specificPatterns[varName]) {
                fileContent = fileContent.replace(specificPatterns[varName], `$1${newValue}`);
                modified = true;
              }

              if (modified) {
                logger.info(`  ✅ Updated ${varName} to ${newValue} in ${filePath}`);
              }
            }

            // Line-based replacement
            if (linePart && replacePart && withPart) {
              const lineNum = parseInt(linePart.replace('LINE:', '').trim(), 10);
              const oldValue = replacePart.replace('REPLACE:', '').trim();
              const newValue = withPart.replace('WITH:', '').trim();
              
              const lines = fileContent.split('\n');
              if (lineNum > 0 && lineNum <= lines.length) {
                const lineIndex = lineNum - 1;
                if (lines[lineIndex].includes(oldValue)) {
                  lines[lineIndex] = lines[lineIndex].replace(oldValue, newValue);
                  fileContent = lines.join('\n');
                  modified = true;
                  logger.info(`  ✅ Updated line ${lineNum} in ${filePath}`);
                }
              }
            }

            // Simple search and replace (fallback)
            if (!modified && replacePart && withPart) {
              const oldValue = replacePart.replace('REPLACE:', '').trim();
              const newValue = withPart.replace('WITH:', '').trim();
              
              if (fileContent.includes(oldValue)) {
                fileContent = fileContent.replace(oldValue, newValue);
                modified = true;
                logger.info(`  ✅ Replaced value in ${filePath}`);
              }
            }

            if (modified) {
              await fs.writeFile(fullPath, fileContent);
            } else {
              logger.warn(`  ⚠️  Could not apply change: ${change}`);
            }
          }
        } else {
          // Simple instruction format: "Increase displacementQuality threshold from 6 to 7"
          await this.applySimpleInstruction(change);
        }
      } catch (error) {
        logger.error(`  ❌ Error applying change: ${change}`, error);
      }
    }
  }

  /**
   * Apply simple instruction-based changes
   */
  async applySimpleInstruction(instruction: string): Promise<void> {
    // Parse instructions like:
    // "Increase displacementQuality threshold from 6 to 7"
    // "Decrease minRiskDistance from 1.0 to 0.8"
    // "Set confluenceScore minimum to 7"
    
    const increaseMatch = instruction.match(/increase\s+(\w+)\s+.*?from\s+([0-9.]+)\s+to\s+([0-9.]+)/i);
    const decreaseMatch = instruction.match(/decrease\s+(\w+)\s+.*?from\s+([0-9.]+)\s+to\s+([0-9.]+)/i);
    const setMatch = instruction.match(/set\s+(\w+)\s+.*?to\s+([0-9.]+)/i);

    let varName: string | null = null;
    let newValue: string | null = null;
    let filePath: string | null = null;

    if (increaseMatch || decreaseMatch || setMatch) {
      const match = increaseMatch || decreaseMatch || setMatch;
      if (match) {
        varName = match[1];
        newValue = match[match.length - 1]; // Last capture group is the new value

        // Determine which file to modify based on variable name
        if (['displacementQuality', 'confluenceScore', 'minRiskDistance', 'minRetracePct', 'maxRetracePct'].includes(varName)) {
          filePath = 'src/strategy/v2/M1ExecutionService.ts';
        } else if (['trendStrength', 'volatility'].includes(varName)) {
          filePath = 'src/strategy/v2/SMCStrategyV2.ts';
        } else if (['minConfluenceScore', 'displacementMinATRMultiplier'].includes(varName)) {
          filePath = 'src/config/executionFilterConfig.ts';
        }

        if (filePath && newValue) {
          const fullPath = path.resolve(process.cwd(), filePath);
          let fileContent = await fs.readFile(fullPath, 'utf-8');
          
          // Update the variable value
          const patterns: RegExp[] = [
            new RegExp(`(${varName}\\s*=\\s*)[0-9.]+`, 'g'),
            new RegExp(`(${varName}\\s*<\\s*)[0-9.]+`, 'g'),
            new RegExp(`(${varName}\\s*>\\s*)[0-9.]+`, 'g'),
            new RegExp(`(if\\s*\\([^)]*${varName}[^)]*[<>=]+\\s*)[0-9.]+`, 'g'),
          ];

          let modified = false;
          for (const pattern of patterns) {
            if (pattern.test(fileContent)) {
              fileContent = fileContent.replace(pattern, `$1${newValue}`);
              modified = true;
            }
          }

          if (modified) {
            await fs.writeFile(fullPath, fileContent);
            logger.info(`  ✅ Updated ${varName} to ${newValue} in ${filePath}`);
          }
        }
      }
    }
  }

  /**
   * Check if strategy meets target metrics
   */
  isProfitable(summary: BacktestSummary): boolean {
    return (
      summary.totalPnL > 0 &&
      summary.avgMonthlyReturn >= this.targetMonthlyReturn &&
      summary.avgProfitFactor >= this.targetMetrics.profitFactor &&
      summary.maxDrawdown <= this.targetMetrics.maxDrawdown &&
      summary.avgRR >= this.targetMetrics.avgRR &&
      summary.avgWinRate >= this.targetMetrics.winRate &&
      summary.profitableMonths >= this.targetMetrics.profitableMonths
    );
  }

  /**
   * Main optimization loop
   */
  async optimize(
    symbol: string,
    dataSource: 'mt5' | 'postgres',
    year: number,
    monthsToTest: number = 3
  ): Promise<void> {
    logger.info('Starting AI-powered strategy optimization...');
    logger.info(`Target metrics: Monthly Return ≥ ${this.targetMonthlyReturn}%, PF ≥ ${this.targetMetrics.profitFactor}, DD ≤ ${this.targetMetrics.maxDrawdown}%, R:R ≥ ${this.targetMetrics.avgRR}, WR ≥ ${this.targetMetrics.winRate}%`);

    const resultsDir = path.resolve(process.cwd(), 'backtests/ai_optimizer');
    await fs.mkdir(resultsDir, { recursive: true });

    for (let iteration = 1; iteration <= this.maxIterations; iteration++) {
      logger.info(`\n${'='.repeat(80)}`);
      logger.info(`ITERATION ${iteration}/${this.maxIterations}`);
      logger.info(`${'='.repeat(80)}\n`);

      // Run backtest
      const batchStartTime = Date.now();
      logger.info(`\n⏱️  Starting batch backtest (${monthsToTest} months, this may take 5-15 minutes)...`);
      const summary = await this.runBatchBacktest(symbol, dataSource, year, monthsToTest);
      const batchDuration = ((Date.now() - batchStartTime) / 60000).toFixed(1);
      logger.info(`\n✅ Batch backtest completed in ${batchDuration} minutes`);

      // Save results
      const resultsFile = path.join(resultsDir, `iteration_${iteration}_${Date.now()}.json`);
      await fs.writeFile(resultsFile, JSON.stringify({ summary, iteration }, null, 2));
      logger.info(`Results saved to ${resultsFile}`);

      // Print summary
      logger.info('\n📊 CURRENT RESULTS');
      logger.info('--------------------------------------------------------------------------------');
      logger.info(`Total PnL: $${summary.totalPnL.toFixed(2)}`);
      logger.info(`Avg Monthly Return: ${summary.avgMonthlyReturn.toFixed(2)}% (target: ${this.targetMonthlyReturn}%+)`);
      logger.info(`Avg Profit Factor: ${summary.avgProfitFactor.toFixed(2)} (target: ${this.targetMetrics.profitFactor}+)`);
      logger.info(`Avg Win Rate: ${summary.avgWinRate.toFixed(2)}% (target: ${this.targetMetrics.winRate}%+)`);
      logger.info(`Avg R:R: ${summary.avgRR.toFixed(2)} (target: ${this.targetMetrics.avgRR}+)`);
      logger.info(`Max Drawdown: ${summary.maxDrawdown.toFixed(2)}% (target: <${this.targetMetrics.maxDrawdown}%)`);
      logger.info(`Profitable Months: ${summary.profitableMonths}/${summary.totalMonths} (target: ${this.targetMetrics.profitableMonths}+)`);

      // Check if profitable
      if (this.isProfitable(summary)) {
        logger.info('\n✅ STRATEGY IS PROFITABLE! Target metrics achieved.');
        logger.info(`Final configuration saved. Results in ${resultsFile}`);
        return;
      }

      // Get AI analysis
      const analysis = await this.analyzeResults(summary, iteration);

      // Save analysis
      const analysisFile = path.join(resultsDir, `analysis_${iteration}_${Date.now()}.json`);
      await fs.writeFile(analysisFile, JSON.stringify(analysis, null, 2));
      logger.info(`\nAI Analysis saved to ${analysisFile}`);

      // Print analysis
      logger.info('\n🤖 AI ANALYSIS');
      logger.info('--------------------------------------------------------------------------------');
      logger.info(`Diagnosis: ${analysis.diagnosis}`);
      logger.info(`\nRoot Causes:`);
      analysis.rootCauses.forEach((cause, i) => logger.info(`  ${i + 1}. ${cause}`));
      logger.info(`\nSuggestions:`);
      analysis.suggestions.forEach((s, i) => {
        logger.info(`  ${i + 1}. [${s.priority.toUpperCase()}] ${s.category}: ${s.description}`);
        logger.info(`     Reasoning: ${s.reasoning}`);
      });
      logger.info(`\nExpected Impact: ${analysis.expectedImpact}`);

      // Apply suggestions
      try {
        await this.applySuggestions(analysis.suggestions);
        logger.info(`\n✅ Suggestions applied successfully`);
      } catch (error) {
        logger.error(`\n❌ Error applying suggestions: ${error}`);
        logger.warn(`Continuing to next iteration anyway...`);
      }

      logger.info(`\n✅ Iteration ${iteration} complete. Continuing to next iteration...\n`);
      
      // Reload environment variables before next iteration to pick up .env changes
      try {
        const envPath = path.resolve(process.cwd(), '.env');
        const envContent = fsSync.readFileSync(envPath, 'utf-8');
        envContent.split('\n').forEach((line: string) => {
          const [key, ...values] = line.split('=');
          if (key && values.length && !key.trim().startsWith('#')) {
            process.env[key.trim()] = values.join('=').trim();
          }
        });
        logger.info('✅ Environment variables reloaded for next iteration');
      } catch (error) {
        logger.warn('Could not reload .env before next iteration:', error);
      }
      
      // Small delay to ensure file writes are complete
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    logger.warn(`\n⚠️  Reached maximum iterations (${this.maxIterations}) without achieving profitability.`);
    logger.info('Review the analysis files in backtests/ai_optimizer/ for suggestions.');
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const symbol = getArg(args, '--symbol', 'XAUUSD');
  const dataSource = getArg(args, '--data-source', 'postgres') as 'mt5' | 'postgres';
  const year = parseInt(getArg(args, '--year', '2023'), 10);
  const monthsToTest = parseInt(getArg(args, '--months', '3'), 10); // Default to 3 months

  const optimizer = new AIStrategyOptimizer();
  await optimizer.optimize(symbol, dataSource, year, monthsToTest);
}

function getArg(args: string[], flag: string, defaultValue: string): string {
  const index = args.indexOf(flag);
  if (index > -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return defaultValue;
}

main().catch(error => {
  logger.error('AI optimization failed:', error);
  process.exit(1);
});

