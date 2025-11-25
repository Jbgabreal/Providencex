/**
 * SMC Strategy Optimization Harness
 *
 * Systematically tests parameter combinations and logs results to SMC_OPTIMIZATION_LOG.md
 *
 * Usage:
 *   tsx optimize-smc.ts
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

// Parameter grid to test (Phase 2: Focus on confluence & selectivity)
const PARAM_GRID = {
  // Confluence thresholds - TEST HIGHER VALUES TO INCREASE SELECTIVITY
  confluence: [60, 70, 80],

  // Filter combinations - Start with all enabled, then test selective disabling
  filters: [
    { name: 'All', htf: true, bos: true, sweep: true, disp: true, pd: true, fvg: true },
    { name: 'No_Sweep', htf: true, bos: true, sweep: false, disp: true, pd: true, fvg: true },
    { name: 'No_Disp', htf: true, bos: true, sweep: true, disp: false, pd: true, fvg: true },
    { name: 'Core_Only', htf: true, bos: true, sweep: false, disp: false, pd: true, fvg: true },
  ],
};

interface TestResult {
  runNumber: number;
  confluence: number;
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
}

/**
 * Update .env file with test parameters
 */
async function updateEnvFile(confluence: number, filters: any): Promise<void> {
  const envPath = path.join(__dirname, '.env');
  const envContent = `# SMC Strategy - Optimization Test
SMC_MIN_HTF_CANDLES=3
SMC_MIN_ITF_CANDLES=5
SMC_REQUIRE_LTF_BOS=false
SMC_MIN_ITF_BOS_COUNT=0
SMC_DEBUG=true
SMC_DEBUG_FORCE_MINIMAL_ENTRY=false

# Execution Filter - Testing Configuration
EXEC_FILTER_REQUIRE_HTF_ALIGNMENT=${filters.htf}
EXEC_FILTER_REQUIRE_BOS=${filters.bos}
EXEC_FILTER_REQUIRE_LIQUIDITY_SWEEP=${filters.sweep}
EXEC_FILTER_REQUIRE_DISPLACEMENT=${filters.disp}
EXEC_FILTER_REQUIRE_PREMIUM_DISCOUNT=${filters.pd}
EXEC_FILTER_REQUIRE_FVG=${filters.fvg}
EXEC_FILTER_MIN_CONFLUENCE_SCORE=${confluence}
EXEC_FILTER_REQUIRE_VOLUME_IMBALANCE_ALIGNMENT=false
`;

  await fs.writeFile(envPath, envContent, 'utf-8');
  console.log(`✓ Updated .env: confluence=${confluence}, filters=${filters.name}`);
}

/**
 * Run backtest and parse results
 */
async function runBacktest(): Promise<any> {
  const cmd = `pnpm backtest --symbol ${TEST_WINDOW.symbol} --from ${TEST_WINDOW.from} --to ${TEST_WINDOW.to}`;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: __dirname,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      timeout: 15 * 60 * 1000, // 15 minute timeout
    });

    // Parse output for key metrics
    const output = stdout + stderr;

    // Extract metrics using regex
    const metrics = {
      trades: parseInt(output.match(/Total Trades:\s*(\d+)/)?.[1] || '0'),
      winRate: parseFloat(output.match(/Win Rate:\s*([\d.]+)%/)?.[1] || '0'),
      totalReturn: parseFloat(output.match(/Total Return:\s*([-\d.]+)%/)?.[1] || '0'),
      profitFactor: parseFloat(output.match(/Profit Factor:\s*([\d.]+)/)?.[1] || '0'),
      maxDrawdown: parseFloat(output.match(/Max Drawdown:\s*([\d.]+)%/)?.[1] || '0'),
      avgRR: parseFloat(output.match(/Avg R:R:\s*([\d.]+)/)?.[1] || '0'),
      expectancy: parseFloat(output.match(/Expectancy:\s*\$([-\d.]+)/)?.[1] || '0'),
      runtime: parseFloat(output.match(/Backtest completed in\s*([\d.]+)s/)?.[1] || '0'),
    };

    return metrics;
  } catch (error: any) {
    console.error('✗ Backtest failed:', error.message);
    return null;
  }
}

/**
 * Append result to optimization log
 */
async function logResult(result: TestResult): Promise<void> {
  const logPath = path.join(__dirname, 'SMC_OPTIMIZATION_LOG.md');

  // Read current log
  let logContent = await fs.readFile(logPath, 'utf-8');

  // Find the run log table and append new row
  const tableMarker = '| Run# | Date | HTF_Align | BOS | Sweep | Disp | PD | FVG | Conf | Trades | WinRate | PF | MaxDD | Return | Monthly | Notes |';
  const tableIndex = logContent.indexOf(tableMarker);

  if (tableIndex === -1) {
    console.error('✗ Could not find run log table in SMC_OPTIMIZATION_LOG.md');
    return;
  }

  // Parse filter flags
  const filters = PARAM_GRID.filters.find(f => f.name === result.filters)!;
  const date = new Date().toISOString().split('T')[0];
  const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

  // Calculate monthly return (4 months)
  const monthlyReturn = (result.totalReturn / 4).toFixed(1);

  // Create new row
  const newRow = `| ${result.runNumber} | ${date} ${time} | ${filters.htf ? 'T' : 'F'} | ${filters.bos ? 'T' : 'F'} | ${filters.sweep ? 'T' : 'F'} | ${filters.disp ? 'T' : 'F'} | ${filters.pd ? 'T' : 'F'} | ${filters.fvg ? 'T' : 'F'} | ${result.confluence} | ${result.trades} | ${result.winRate.toFixed(1)}% | ${result.profitFactor.toFixed(2)} | ${result.maxDrawdown.toFixed(1)}% | ${result.totalReturn.toFixed(1)}% | ${monthlyReturn}% | ${result.status} |`;

  // Find the end of the table (next section marker or end of content)
  const nextSectionIndex = logContent.indexOf('\n---\n', tableIndex);
  const insertPosition = nextSectionIndex > tableIndex ? nextSectionIndex : logContent.length;

  // Insert new row before the next section
  logContent = logContent.slice(0, insertPosition) + '\n' + newRow + logContent.slice(insertPosition);

  await fs.writeFile(logPath, logContent, 'utf-8');
  console.log(`✓ Logged result to SMC_OPTIMIZATION_LOG.md`);
}

/**
 * Main optimization loop
 */
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        SMC Strategy Optimization Harness - Phase 2          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log(`Test Window: ${TEST_WINDOW.symbol} from ${TEST_WINDOW.from} to ${TEST_WINDOW.to}`);
  console.log(`Confluence Levels: ${PARAM_GRID.confluence.join(', ')}`);
  console.log(`Filter Combinations: ${PARAM_GRID.filters.length} sets`);

  const totalTests = PARAM_GRID.confluence.length * PARAM_GRID.filters.length;
  console.log(`\nTotal Tests: ${totalTests}\n`);
  console.log('═'.repeat(64) + '\n');

  let runNumber = 2; // Start at 2 (baseline was #1)
  const results: TestResult[] = [];

  // Run all combinations
  for (const confluence of PARAM_GRID.confluence) {
    for (const filters of PARAM_GRID.filters) {
      console.log(`\n[Run #${runNumber}] Testing: Confluence=${confluence}, Filters=${filters.name}`);
      console.log('─'.repeat(64));

      // Update .env
      await updateEnvFile(confluence, filters);

      // Run backtest
      console.log('Running backtest... (may take 10-15 minutes)');
      const startTime = Date.now();
      const metrics = await runBacktest();
      const endTime = Date.now();
      const runtime = (endTime - startTime) / 1000;

      if (!metrics) {
        console.log('✗ Backtest failed - skipping');
        runNumber++;
        continue;
      }

      // Calculate monthly return
      const monthlyReturn = metrics.totalReturn / 4;

      // Evaluate status
      let status = '';
      if (metrics.trades < 50) status = '⚠️ TOO FEW';
      else if (metrics.trades > 400) status = '⚠️ TOO MANY';
      else if (metrics.winRate < 40) status = '❌ LOW WR';
      else if (metrics.profitFactor < 1.3) status = '❌ LOW PF';
      else if (metrics.maxDrawdown > 25) status = '❌ HIGH DD';
      else if (monthlyReturn < 30) status = '❌ LOW RETURN';
      else status = '✅ PASS';

      // Store result
      const result: TestResult = {
        runNumber,
        confluence,
        filters: filters.name,
        trades: metrics.trades,
        winRate: metrics.winRate,
        totalReturn: metrics.totalReturn,
        monthlyReturn,
        profitFactor: metrics.profitFactor,
        maxDrawdown: metrics.maxDrawdown,
        avgRR: metrics.avgRR,
        expectancy: metrics.expectancy,
        runtime,
        status,
      };

      results.push(result);

      // Log to file
      await logResult(result);

      // Print summary
      console.log('\n📊 Results:');
      console.log(`   Trades: ${metrics.trades}`);
      console.log(`   Win Rate: ${metrics.winRate.toFixed(1)}%`);
      console.log(`   Total Return: ${metrics.totalReturn.toFixed(1)}%`);
      console.log(`   Monthly Return: ${monthlyReturn.toFixed(1)}%`);
      console.log(`   Profit Factor: ${metrics.profitFactor.toFixed(2)}`);
      console.log(`   Max Drawdown: ${metrics.maxDrawdown.toFixed(1)}%`);
      console.log(`   Avg R:R: ${metrics.avgRR.toFixed(2)}`);
      console.log(`   Expectancy: $${metrics.expectancy.toFixed(2)}`);
      console.log(`   Runtime: ${runtime.toFixed(1)}s`);
      console.log(`   Status: ${status}`);

      runNumber++;
    }
  }

  // Print summary
  console.log('\n\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                  Optimization Complete                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log(`Total Runs: ${results.length}`);

  // Find best configs by different criteria
  const passing = results.filter(r => r.status === '✅ PASS');
  console.log(`Passing Configs: ${passing.length}\n`);

  if (passing.length > 0) {
    const bestReturn = passing.sort((a, b) => b.monthlyReturn - a.monthlyReturn)[0];
    const bestPF = passing.sort((a, b) => b.profitFactor - a.profitFactor)[0];
    const lowestDD = passing.sort((a, b) => a.maxDrawdown - b.maxDrawdown)[0];

    console.log('🏆 Best Configs:');
    console.log(`   Highest Monthly Return: Run #${bestReturn.runNumber} - ${bestReturn.monthlyReturn.toFixed(1)}% (Conf=${bestReturn.confluence}, Filters=${bestReturn.filters})`);
    console.log(`   Highest Profit Factor: Run #${bestPF.runNumber} - PF=${bestPF.profitFactor.toFixed(2)} (Conf=${bestPF.confluence}, Filters=${bestPF.filters})`);
    console.log(`   Lowest Drawdown: Run #${lowestDD.runNumber} - DD=${lowestDD.maxDrawdown.toFixed(1)}% (Conf=${lowestDD.confluence}, Filters=${lowestDD.filters})`);
  } else {
    console.log('❌ No configs passed all criteria. Need to adjust parameters or logic.');
  }

  console.log('\n📝 All results logged to SMC_OPTIMIZATION_LOG.md');
}

// Run optimization
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
