/**
 * Simple Backtest Analysis Tool - Send results to OpenAI for improvement suggestions
 * 
 * Usage:
 *   pnpm tsx src/tools/analyzeBacktestWithAI.ts --run-id backtest_1764029615374
 *   OR analyze latest run:
 *   pnpm tsx src/tools/analyzeBacktestWithAI.ts
 */

import dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import OpenAI from 'openai';
import { Logger } from '@providencex/shared-utils';

const logger = new Logger('AnalyzeBacktestWithAI');

// Load .env from multiple possible locations
const envPaths = [
  path.resolve(process.cwd(), '.env'),                    // Current dir
  path.resolve(process.cwd(), '..', '.env'),              // Parent (services/)
  path.resolve(process.cwd(), '..', '..', '.env'),        // Root
  path.resolve(process.cwd(), '..', '..', '..', '.env'),  // Above root (if needed)
];

let envLoaded = false;
for (const envPath of envPaths) {
  try {
    if (fsSync.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
      console.log(`✅ Loaded .env from: ${envPath}`);
      envLoaded = true;
      break;
    }
  } catch (error) {
    // Continue to next path
  }
}

// Also try default location (loads .env from current working directory)
if (!envLoaded) {
  dotenv.config();
  console.log('✅ Loaded .env from default location');
}

// Verify API key is loaded
if (!process.env.OPENAI_API_KEY) {
  console.error('⚠️  WARNING: OPENAI_API_KEY not found after loading .env files');
  console.error('Checked paths:');
  envPaths.forEach(p => console.error(`  - ${p}`));
}

interface BacktestResults {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  winRate: number | string;
  totalPnL: number | string;
  profitFactor: number;
  avgRR: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  totalReturnPercent: number | string;
  averageWin: number;
  averageLoss: number;
  expectancy: number;
}

class BacktestAnalyzer {
  private openai: OpenAI;
  private backtestsDir: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    this.openai = new OpenAI({ apiKey });
    this.backtestsDir = path.join(process.cwd(), 'backtests');
  }

  async findLatestBacktestRun(): Promise<string | null> {
    try {
      const entries = await fs.readdir(this.backtestsDir, { withFileTypes: true });
      const runDirs = entries
        .filter(entry => entry.isDirectory() && entry.name.startsWith('run_'))
        .map(entry => entry.name)
        .sort()
        .reverse(); // Most recent first

      if (runDirs.length === 0) {
        return null;
      }

      return runDirs[0]; // Return most recent
    } catch (error) {
      logger.error('Error finding latest backtest:', error);
      return null;
    }
  }

  async loadBacktestResults(runId: string): Promise<any> {
    const runDir = path.join(this.backtestsDir, runId);
    const summaryPath = path.join(runDir, 'summary.json');

    try {
      // Check if directory exists
      try {
        await fs.access(runDir);
      } catch {
        throw new Error(`Backtest directory not found: ${runDir}`);
      }

      // Check if summary.json exists
      try {
        await fs.access(summaryPath);
      } catch {
        throw new Error(`Summary file not found: ${summaryPath}`);
      }

      const content = await fs.readFile(summaryPath, 'utf-8');
      const parsed = JSON.parse(content);
      logger.info(`✅ Loaded backtest results from ${summaryPath}`);
      return parsed;
    } catch (error) {
      logger.error(`Error loading backtest results from ${summaryPath}:`, error);
      if (error instanceof Error) {
        throw new Error(`Failed to load backtest results: ${error.message}`);
      }
      throw error;
    }
  }

  async readStrategyCode(): Promise<string> {
    const strategyFiles = [
      'src/strategy/v2/SMCStrategyV2.ts',
      'src/services/StrategyService.ts',
      'src/config/executionFilterConfig.ts',
    ];

    let strategyCode = '# Strategy Implementation Files\n\n';

    for (const file of strategyFiles) {
      const filePath = path.join(process.cwd(), file);
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        strategyCode += `## ${file}\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
      } catch (error) {
        logger.warn(`Could not read ${file}:`, error);
        strategyCode += `## ${file}\n[File not found or unreadable]\n\n`;
      }
    }

    return strategyCode;
  }

  async readConfig(): Promise<string> {
    const configFiles = [
      '.env',
      'src/config/index.ts',
      'src/config/executionFilterConfig.ts',
    ];

    let configText = '# Configuration Files\n\n';

    for (const file of configFiles) {
      const filePath = path.join(process.cwd(), file);
      try {
        if (file === '.env') {
          // Read .env but mask sensitive values
          const content = await fs.readFile(filePath, 'utf-8');
          const masked = content
            .split('\n')
            .map(line => {
              if (line.includes('API_KEY') || line.includes('PASSWORD') || line.includes('SECRET')) {
                const [key] = line.split('=');
                return `${key}=***HIDDEN***`;
              }
              return line;
            })
            .join('\n');
          configText += `## ${file}\n\`\`\`\n${masked}\n\`\`\`\n\n`;
        } else {
          const content = await fs.readFile(filePath, 'utf-8');
          configText += `## ${file}\n\`\`\`typescript\n${content}\n\`\`\`\n\n`;
        }
      } catch (error) {
        logger.warn(`Could not read ${file}:`, error);
        configText += `## ${file}\n[File not found or unreadable]\n\n`;
      }
    }

    return configText;
  }

  async analyzeWithAI(results: any, strategyCode: string, config: string): Promise<string> {
    logger.info('🤖 Sending backtest results to OpenAI for analysis...');
    
    // Extract numeric values from results (handle string percentages)
    const winRate = typeof results.winRate === 'string' 
      ? parseFloat(results.winRate.replace('%', '')) 
      : results.winRate || 0;
    
    const totalPnL = typeof results.totalPnL === 'string'
      ? parseFloat(results.totalPnL.replace('$', '').replace(',', ''))
      : results.totalPnL || 0;
    
    const totalReturnPercent = typeof results.totalReturnPercent === 'string'
      ? parseFloat(results.totalReturnPercent.replace('%', ''))
      : results.totalReturnPercent || 0;

    const prompt = `You are analyzing a Smart Money Concepts (SMC) trading strategy backtest that is performing very poorly.

## Backtest Results:
- **Total Trades:** ${results.totalTrades || 0}
  - Won: ${results.winningTrades || 0}
  - Lost: ${results.losingTrades || 0}
  - Break-Even: ${results.breakEvenTrades || 0}
- **Win Rate:** ${winRate.toFixed(2)}% (TARGET: ≥35%)
- **Total PnL:** $${totalPnL.toFixed(2)} (TARGET: Positive)
- **Profit Factor:** ${(results.profitFactor || 0).toFixed(2)} (TARGET: ≥1.3)
- **Average R:R:** ${(results.avgRR || 0).toFixed(2)} (TARGET: 2.5-3.0)
- **Max Drawdown:** ${(results.maxDrawdownPercent || 0).toFixed(2)}% (TARGET: ≤25%)
- **Total Return:** ${totalReturnPercent.toFixed(2)}% (TARGET: 30-35% monthly)
- **Average Win:** $${(results.averageWin || 0).toFixed(2)}
- **Average Loss:** $${(results.averageLoss || 0).toFixed(2)}
- **Expectancy:** $${(results.expectancy || 0).toFixed(2)}

## Strategy Code:
${strategyCode}

## Configuration:
${config}

## Key Issues Identified:
1. **CRITICAL: Win rate is very low (${winRate.toFixed(2)}% vs target 35%+)**
   - Only ${results.winningTrades || 0} winning trades vs ${results.losingTrades || 0} losing trades
   - Loss ratio: ${results.totalTrades > 0 ? ((results.losingTrades / results.totalTrades) * 100).toFixed(1) : 0}% of trades are losses
   - This indicates entry quality is poor - too many false signals
2. Profit factor is below 1.0 (${(results.profitFactor || 0).toFixed(2)}) - losing more than winning
3. Average R:R is too low (${(results.avgRR || 0).toFixed(2)} vs target 2.5-3.0) - TPs not being hit
4. Max drawdown is excessive (${(results.maxDrawdownPercent || 0).toFixed(2)}%) - risk management failing
5. Strategy is losing money overall - ${totalPnL < 0 ? 'LOSING' : 'BREAKING EVEN'} $${Math.abs(totalPnL).toFixed(2)}

## Your Task:
Analyze the strategy logic, configuration, and backtest results. Identify the root causes of poor performance and provide SPECIFIC, ACTIONABLE suggestions to improve:

1. **Entry Quality**: Are entries being taken at the right time? Are filters too loose or too strict?
2. **Stop Loss Placement**: Are SLs being hit too often? Are they placed correctly relative to POIs?
3. **Take Profit Placement**: Is the R:R actually being achieved? Are TPs too far/close?
4. **Risk Management**: Is position sizing appropriate?
5. **Market Conditions**: Is the strategy trading in unfavorable conditions (sideways, low volatility)?

## Required Output Format:
Provide your analysis and suggestions in the following format:

### DIAGNOSIS:
[Brief diagnosis of main issues - 2-3 sentences]

### ROOT CAUSES:
1. [Root cause 1 with explanation]
2. [Root cause 2 with explanation]
3. [Root cause 3 with explanation]

### SUGGESTIONS:
For each suggestion, use this exact format:

**Suggestion 1: [Title]**
- **File:** path/to/file.ts
- **Change:** SET variableName TO newValue OR change code at line X
- **Reason:** explanation of why this will help

**Suggestion 2: [Title]**
- **File:** path/to/file.ts
- **Change:** [specific change]
- **Reason:** explanation

Continue with more suggestions...

## Important:
- Be specific with file paths, variable names, and values
- Focus on the most impactful changes first (win rate improvement is top priority)
- Ensure suggestions are implementable and testable
- Consider SMC/ICT best practices (Order Blocks, FVG, CHoCH, liquidity sweeps, POI-anchored SLs)
- Target improvements: Win rate ≥35%, PF ≥1.3, R:R 2.5-3.0, Max DD ≤25%`;

    try {
      logger.info(`🚀 Sending request to OpenAI (model: ${process.env.OPENAI_MODEL || 'gpt-4o-mini'})...`);
      
      const response = await this.openai.chat.completions.create({
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
        max_tokens: 3000,
      });

      const content = response.choices[0]?.message?.content || 'No response from AI';
      logger.info('✅ Received analysis from OpenAI');
      return content;
    } catch (error) {
      logger.error('OpenAI API error:', error);
      throw error;
    }
  }

  async saveAnalysis(runId: string, analysis: string): Promise<void> {
    const outputDir = path.join(process.cwd(), 'backtests', 'analysis');
    await fs.mkdir(outputDir, { recursive: true });
    
    const outputPath = path.join(outputDir, `ai_analysis_${runId}_${Date.now()}.md`);
    await fs.writeFile(outputPath, analysis, 'utf-8');
    
    logger.info(`📝 Analysis saved to: ${outputPath}`);
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    let runId: string | null = null;

    logger.info(`Arguments received: ${JSON.stringify(args)}`);

    // Check for --run-id argument
    const runIdIndex = args.indexOf('--run-id');
    if (runIdIndex !== -1 && args[runIdIndex + 1]) {
      runId = args[runIdIndex + 1];
      logger.info(`Run ID provided: ${runId}`);
    }

    const analyzer = new BacktestAnalyzer();

    // Find run ID if not provided
    if (!runId) {
      logger.info('🔍 Finding latest backtest run...');
      runId = await analyzer.findLatestBacktestRun();
      
      if (!runId) {
        logger.error('❌ No backtest runs found. Please run a backtest first.');
        logger.error(`Backtests directory: ${analyzer['backtestsDir']}`);
        process.exit(1);
      }
      
      logger.info(`✅ Found latest run: ${runId}`);
    }

    // Load backtest results
    logger.info(`📊 Loading backtest results for ${runId}...`);
    const results = await analyzer.loadBacktestResults(runId);
    
    logger.info(`   Total Trades: ${results.totalTrades || 0}`);
    logger.info(`   Win Rate: ${results.winRate || '0%'}`);
    logger.info(`   Total PnL: ${results.totalPnL || '$0.00'}`);

    // Read strategy code
    logger.info('📖 Reading strategy code...');
    const strategyCode = await analyzer.readStrategyCode();

    // Read configuration
    logger.info('⚙️  Reading configuration...');
    const config = await analyzer.readConfig();

    // Analyze with AI
    logger.info('🤖 Analyzing with OpenAI...');
    const analysis = await analyzer.analyzeWithAI(results, strategyCode, config);

    // Display and save analysis
    console.log('\n' + '='.repeat(80));
    console.log('🤖 AI ANALYSIS RESULTS');
    console.log('='.repeat(80) + '\n');
    console.log(analysis);
    console.log('\n' + '='.repeat(80) + '\n');

    await analyzer.saveAnalysis(runId, analysis);

    logger.info('✅ Analysis complete!');
  } catch (error) {
    logger.error('❌ Error:', error);
    if (error instanceof Error) {
      logger.error(`Error message: ${error.message}`);
      logger.error(`Error stack: ${error.stack}`);
    } else {
      logger.error(`Error details: ${JSON.stringify(error)}`);
    }
    process.exit(1);
  }
}

main();

