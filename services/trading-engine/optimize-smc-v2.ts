/**
 * SMC Strategy Optimization Harness v2 - 3.0 R:R, 30-40% Monthly Target
 *
 * Systematically tests parameter combinations targeting:
 * - 1:3 Risk:Reward (TP_R_MULT = 3.0)
 * - 30-40% monthly return (120-160% over 4 months)
 * - Profit Factor >= 1.3
 * - Max Drawdown <= 25%
 *
 * Usage:
 *   tsx optimize-smc-v2.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Optimization configuration
const TEST_WINDOW = {
  symbol: 'XAUUSD',
  from: '2024-03-21',
  to: '2024-07-21',
};

// PASS CRITERIA (Hard Requirements for Production)
const PASS_CRITERIA = {
  minMonthlyReturn: 30, // 30% per month = 120% over 4 months
  maxMonthlyReturn: 50, // Upper bound to detect overfitting
  minProfitFactor: 1.3,
  maxDrawdown: 25,
  minTrades: 30, // Need statistical significance
  maxTrades: 200, // Avoid overtrading
  minWinRate: 35, // With 3R, even 35% WR can be profitable
  targetRR: 3.0, // Hard requirement: 1:3 risk:reward
};

// Parameter grid to test
const PARAM_GRID = {
  // R:R Multiplier (focus on 3.0)
  tpRMult: [3.0],

  // Confluence thresholds (higher = more selective)
  confluence: [60, 70, 80],

  // Position sizing (risk per trade)
  riskPerTrade: [0.25, 0.5, 0.75, 1.0],

  // Filter combinations
  filters: [
    { name: 'All', htf: true, bos: true, sweep: true, disp: true, pd: true, fvg: true },
    { name: 'No_Sweep', htf: true, bos: true, sweep: false, disp: true, pd: true, fvg: true },
    { name: 'Core_Plus', htf: true, bos: true, sweep: false, disp: false, pd: true, fvg: true },
  ],
};

interface TestResult {
  runNumber: number;
  tpRMult: number;
  confluence: number;
  riskPerTrade: number;
  filters: string;
  trades: number;
  winRate: number;
  totalReturn: number;
  monthlyReturn: number;
  profitFactor: number;
  maxDrawdown: number;
  avgRR: number;
  expectancy: number;
  runtime: number;
  status: string;
  passCriteria: {
    monthlyReturn: boolean;
    profitFactor: boolean;
    maxDrawdown: boolean;
    tradeCount: boolean;
    winRate: boolean;
    avgRR: boolean;
  };
  score: number; // Composite score for ranking
}

/**
 * Update .env file with test parameters
 */
async function updateEnvFile(
  tpRMult: number,
  confluence: number,
  filters: any
): Promise<void> {
  const envPath = path.join(__dirname, '.env');
  const envContent = `# SMC Strategy - Optimization Test (3.0 R:R Target)
SMC_MIN_HTF_CANDLES=5
SMC_MIN_ITF_CANDLES=8
SMC_REQUIRE_LTF_BOS=true
SMC_MIN_ITF_BOS_COUNT=1
SMC_DEBUG=false
SMC_DEBUG_FORCE_MINIMAL_ENTRY=false
SMC_AVOID_HTF_SIDEWAYS=true

# Risk:Reward Configuration (1:3 target)
TP_R_MULT=${tpRMult}
SL_POI_BUFFER=0.0002

# Entry Quality Filters - HIGH QUALITY ENTRIES
EXEC_FILTER_REQUIRE_HTF_ALIGNMENT=${filters.htf}
EXEC_FILTER_REQUIRE_BOS=${filters.bos}
EXEC_FILTER_REQUIRE_LIQUIDITY_SWEEP=${filters.sweep}
EXEC_FILTER_REQUIRE_DISPLACEMENT=${filters.disp}
EXEC_FILTER_REQUIRE_PREMIUM_DISCOUNT=${filters.pd}
EXEC_FILTER_REQUIRE_FVG=${filters.fvg}
EXEC_FILTER_MIN_CONFLUENCE_SCORE=${confluence}
EXEC_FILTER_REQUIRE_VOLUME_IMBALANCE_ALIGNMENT=false

# Minimum FVG/OB Quality
SMC_MIN_FVG_SIZE_MULTIPLIER=1.5
SMC_MIN_OB_WICK_RATIO=0.7
`;

  await fs.writeFile(envPath, envContent, 'utf-8');
  console.log(`✓ Updated .env: RR=${tpRMult}, Conf=${confluence}, Filters=${filters.name}`);
}

/**
 * Run backtest with specific risk per trade
 */
async function runBacktest(riskPerTrade: number): Promise<any> {
  const cmd = `pnpm backtest --symbol ${TEST_WINDOW.symbol} --from ${TEST_WINDOW.from} --to ${TEST_WINDOW.to}`;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: __dirname,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
      env: {
        ...process.env,
        BACKTEST_RISK_PER_TRADE: riskPerTrade.toString(),
      },
    });

    const output = stdout + stderr;

    // Extract metrics
    const metrics = {
      trades: parseInt(output.match(/Total Trades:\s*(\d+)/)?.[1] || '0'),
      winRate: parseFloat(output.match(/Win Rate:\s*([\d.]+)%/)?.[1] || '0'),
      totalReturn: parseFloat(output.match(/Total Return:.*\(([-\d.]+)%\)/)?.[1] || '0'),
      profitFactor: parseFloat(output.match(/Profit Factor:\s*([\d.]+)/)?.[1] || '0'),
      maxDrawdown: parseFloat(output.match(/Max Drawdown:.*\(([\d.]+)%\)/)?.[1] || '0'),
      avgRR: parseFloat(output.match(/Average R:R:\s*([\d.]+)/)?.[1] || '0'),
      expectancy: parseFloat(output.match(/Expectancy:\s*\$([-\d.]+)/)?.[1] || '0'),
      runtime: parseFloat(output.match(/completed in\s*([\d.]+)s/)?.[1] || '0'),
    };

    return metrics;
  } catch (error: any) {
    console.error('✗ Backtest failed:', error.message);
    return null;
  }
}

/**
 * Evaluate if result meets pass criteria
 */
function evaluateResult(result: TestResult): void {
  const monthlyReturn = result.totalReturn / 4;
  result.monthlyReturn = monthlyReturn;

  // Check each criterion
  result.passCriteria = {
    monthlyReturn:
      monthlyReturn >= PASS_CRITERIA.minMonthlyReturn &&
      monthlyReturn <= PASS_CRITERIA.maxMonthlyReturn,
    profitFactor: result.profitFactor >= PASS_CRITERIA.minProfitFactor,
    maxDrawdown: result.maxDrawdown <= PASS_CRITERIA.maxDrawdown,
    tradeCount:
      result.trades >= PASS_CRITERIA.minTrades &&
      result.trades <= PASS_CRITERIA.maxTrades,
    winRate: result.winRate >= PASS_CRITERIA.minWinRate,
    avgRR: Math.abs(result.avgRR - PASS_CRITERIA.targetRR) <= 0.5, // Within 0.5 of target
  };

  // Calculate composite score (0-100)
  let score = 0;

  // Monthly return score (0-40 points)
  if (result.passCriteria.monthlyReturn) {
    score += Math.min(40, (monthlyReturn / 40) * 40);
  }

  // Profit factor score (0-20 points)
  if (result.passCriteria.profitFactor) {
    score += Math.min(20, ((result.profitFactor - 1) / 0.5) * 20);
  }

  // Drawdown score (0-20 points)
  if (result.passCriteria.maxDrawdown) {
    score += 20 - (result.maxDrawdown / 25) * 20;
  }

  // Trade count score (0-10 points)
  if (result.passCriteria.tradeCount) {
    score += 10;
  }

  // Win rate score (0-10 points)
  if (result.passCriteria.winRate) {
    score += Math.min(10, ((result.winRate - 35) / 20) * 10);
  }

  result.score = Math.round(score);

  // Overall status
  const passCount = Object.values(result.passCriteria).filter((v) => v).length;
  if (passCount === 6) {
    result.status = '✅ PASS';
  } else if (passCount >= 4) {
    result.status = `⚠️ NEAR (${passCount}/6)`;
  } else if (result.trades === 0) {
    result.status = '❌ NO TRADES';
  } else if (result.profitFactor < 1.0) {
    result.status = '❌ LOSING';
  } else {
    result.status = `❌ FAIL (${passCount}/6)`;
  }
}

/**
 * Append result to optimization log
 */
async function logResult(result: TestResult): Promise<void> {
  const logPath = path.join(__dirname, 'SMC_OPTIMIZATION_LOG.md');

  // Read current log
  let logContent = await fs.readFile(logPath, 'utf-8');

  // Find or create the optimization results section
  const sectionMarker = '## Optimization Results (3.0 R:R Target)';
  let sectionIndex = logContent.indexOf(sectionMarker);

  if (sectionIndex === -1) {
    // Create new section
    logContent += `\n\n---\n\n${sectionMarker}\n\n`;
    logContent += '| Run | RR | Conf | Risk% | Filters | Trades | WR% | PF | DD% | Mon% | Score | Status |\n';
    logContent += '|-----|-------|------|-------|---------|--------|-----|----|----|------|-------|--------|\n';
    sectionIndex = logContent.indexOf(sectionMarker);
  }

  // Find the table
  const tableStart = logContent.indexOf('| Run |', sectionIndex);
  if (tableStart === -1) return;

  // Find end of table (next section or end of file)
  let insertPos = logContent.indexOf('\n\n', tableStart + 100);
  if (insertPos === -1) insertPos = logContent.length;

  // Create new row
  const newRow = `| ${result.runNumber} | ${result.tpRMult} | ${result.confluence} | ${result.riskPerTrade} | ${result.filters} | ${result.trades} | ${result.winRate.toFixed(1)} | ${result.profitFactor.toFixed(2)} | ${result.maxDrawdown.toFixed(1)} | ${result.monthlyReturn.toFixed(1)} | ${result.score} | ${result.status} |`;

  // Insert new row
  logContent = logContent.slice(0, insertPos) + '\n' + newRow + logContent.slice(insertPos);

  await fs.writeFile(logPath, logContent, 'utf-8');
  console.log(`✓ Logged to SMC_OPTIMIZATION_LOG.md`);
}

/**
 * Main optimization loop
 */
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   SMC Optimization v2 - 3.0 R:R, 30-40% Monthly Target      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log(`Test Window: ${TEST_WINDOW.symbol} ${TEST_WINDOW.from} to ${TEST_WINDOW.to}`);
  console.log(`\nPass Criteria:`);
  console.log(`  - Monthly Return: ${PASS_CRITERIA.minMonthlyReturn}-${PASS_CRITERIA.maxMonthlyReturn}%`);
  console.log(`  - Profit Factor: ≥${PASS_CRITERIA.minProfitFactor}`);
  console.log(`  - Max Drawdown: ≤${PASS_CRITERIA.maxDrawdown}%`);
  console.log(`  - Trade Count: ${PASS_CRITERIA.minTrades}-${PASS_CRITERIA.maxTrades}`);
  console.log(`  - Win Rate: ≥${PASS_CRITERIA.minWinRate}%`);
  console.log(`  - Avg R:R: ~${PASS_CRITERIA.targetRR} (±0.5)`);

  const totalTests =
    PARAM_GRID.tpRMult.length *
    PARAM_GRID.confluence.length *
    PARAM_GRID.riskPerTrade.length *
    PARAM_GRID.filters.length;

  console.log(`\nTotal Tests: ${totalTests}\n`);
  console.log('═'.repeat(64) + '\n');

  let runNumber = 1;
  const results: TestResult[] = [];

  // Run all combinations
  for (const tpRMult of PARAM_GRID.tpRMult) {
    for (const confluence of PARAM_GRID.confluence) {
      for (const riskPerTrade of PARAM_GRID.riskPerTrade) {
        for (const filters of PARAM_GRID.filters) {
          console.log(
            `\n[Run #${runNumber}] RR=${tpRMult}, Conf=${confluence}, Risk=${riskPerTrade}%, Filters=${filters.name}`
          );
          console.log('─'.repeat(64));

          // Update .env
          await updateEnvFile(tpRMult, confluence, filters);

          // Run backtest
          console.log('Running backtest...');
          const startTime = Date.now();
          const metrics = await runBacktest(riskPerTrade);
          const endTime = Date.now();
          const runtime = (endTime - startTime) / 1000;

          if (!metrics) {
            console.log('✗ Backtest failed - skipping');
            runNumber++;
            continue;
          }

          // Create result
          const result: TestResult = {
            runNumber,
            tpRMult,
            confluence,
            riskPerTrade,
            filters: filters.name,
            trades: metrics.trades,
            winRate: metrics.winRate,
            totalReturn: metrics.totalReturn,
            monthlyReturn: 0, // Will be calculated
            profitFactor: metrics.profitFactor,
            maxDrawdown: metrics.maxDrawdown,
            avgRR: metrics.avgRR,
            expectancy: metrics.expectancy,
            runtime,
            status: '',
            passCriteria: {
              monthlyReturn: false,
              profitFactor: false,
              maxDrawdown: false,
              tradeCount: false,
              winRate: false,
              avgRR: false,
            },
            score: 0,
          };

          // Evaluate
          evaluateResult(result);
          results.push(result);

          // Log to file
          await logResult(result);

          // Print summary
          console.log('\n📊 Results:');
          console.log(`   Trades: ${metrics.trades}`);
          console.log(`   Win Rate: ${metrics.winRate.toFixed(1)}%`);
          console.log(`   Monthly Return: ${result.monthlyReturn.toFixed(1)}%`);
          console.log(`   Profit Factor: ${metrics.profitFactor.toFixed(2)}`);
          console.log(`   Max Drawdown: ${metrics.maxDrawdown.toFixed(1)}%`);
          console.log(`   Avg R:R: ${metrics.avgRR.toFixed(2)}`);
          console.log(`   Score: ${result.score}/100`);
          console.log(`   Status: ${result.status}`);

          runNumber++;

          // Small delay between runs
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }
  }

  // Print summary
  console.log('\n\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                  Optimization Complete                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log(`Total Runs: ${results.length}`);

  // Find passing configs
  const passing = results.filter((r) => r.status === '✅ PASS');
  const near = results.filter((r) => r.status.includes('NEAR'));

  console.log(`Passing Configs: ${passing.length}`);
  console.log(`Near-Pass Configs: ${near.length}\n`);

  // Sort by score
  results.sort((a, b) => b.score - a.score);

  if (passing.length > 0) {
    console.log('🏆 TOP PASSING CONFIGS:\n');
    passing
      .slice(0, 3)
      .forEach((r, i) => {
        console.log(
          `${i + 1}. Run #${r.runNumber} (Score: ${r.score}/100)`
        );
        console.log(
          `   Config: RR=${r.tpRMult}, Conf=${r.confluence}, Risk=${r.riskPerTrade}%, Filters=${r.filters}`
        );
        console.log(
          `   Results: ${r.trades} trades, ${r.winRate.toFixed(1)}% WR, ${r.monthlyReturn.toFixed(1)}% monthly, PF=${r.profitFactor.toFixed(2)}, DD=${r.maxDrawdown.toFixed(1)}%`
        );
        console.log('');
      });
  } else if (near.length > 0) {
    console.log('⚠️ TOP NEAR-PASS CONFIGS:\n');
    near
      .slice(0, 3)
      .forEach((r, i) => {
        console.log(
          `${i + 1}. Run #${r.runNumber} (Score: ${r.score}/100) - ${r.status}`
        );
        console.log(
          `   Config: RR=${r.tpRMult}, Conf=${r.confluence}, Risk=${r.riskPerTrade}%, Filters=${r.filters}`
        );
        console.log(
          `   Results: ${r.trades} trades, ${r.winRate.toFixed(1)}% WR, ${r.monthlyReturn.toFixed(1)}% monthly, PF=${r.profitFactor.toFixed(2)}, DD=${r.maxDrawdown.toFixed(1)}%`
        );
        console.log('');
      });
  } else {
    console.log(
      '❌ No configs passed or came close. Strategy may need fundamental changes.\n'
    );
    console.log('Top 3 by score:');
    results.slice(0, 3).forEach((r, i) => {
      console.log(
        `${i + 1}. Run #${r.runNumber} (Score: ${r.score}/100) - ${r.status}`
      );
      console.log(
        `   Config: RR=${r.tpRMult}, Conf=${r.confluence}, Risk=${r.riskPerTrade}%, Filters=${r.filters}`
      );
      console.log(
        `   Results: ${r.trades} trades, ${r.winRate.toFixed(1)}% WR, ${r.monthlyReturn.toFixed(1)}% monthly`
      );
    });
  }

  console.log('\n📝 All results logged to SMC_OPTIMIZATION_LOG.md');
}

// Run optimization
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
