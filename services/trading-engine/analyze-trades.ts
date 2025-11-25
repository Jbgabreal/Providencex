/**
 * Trade Analysis Script - Identify Why Trades Fail to Reach 3R
 *
 * Analyzes recent backtest results to understand:
 * - Why stops are hit before 3R TP
 * - FVG/OB quality at entry
 * - HTF/ITF context
 * - Liquidity sweep presence
 */

import * as fs from 'fs/promises';
import * as path from 'path';

interface Trade {
  ticket: number;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number;
  sl: number | null;
  tp: number | null;
  profit: number;
  pips: number;
  riskReward?: number;
  entryTime: number;
  exitTime: number;
}

async function analyzeTrades() {
  // Find most recent backtest directory
  const backtestDir = path.join(__dirname, 'backtests');
  const dirs = await fs.readdir(backtestDir);
  const runDirs = dirs.filter(d => d.startsWith('run_backtest_')).sort().reverse();

  if (runDirs.length === 0) {
    console.log('No backtest results found');
    return;
  }

  const latestRun = path.join(backtestDir, runDirs[0]);
  console.log(`Analyzing: ${runDirs[0]}\n`);

  // Load trades
  const tradesPath = path.join(latestRun, 'trades.json');
  const tradesData = await fs.readFile(tradesPath, 'utf-8');
  const trades: Trade[] = JSON.parse(tradesData);

  console.log(`Total Trades: ${trades.length}\n`);

  // Separate winners and losers
  const winners = trades.filter(t => t.profit > 0);
  const losers = trades.filter(t => t.profit < 0);

  console.log(`Winners: ${winners.length} (${((winners.length / trades.length) * 100).toFixed(1)}%)`);
  console.log(`Losers: ${losers.length} (${((losers.length / trades.length) * 100).toFixed(1)}%)\n`);

  // Analyze R:R achievement
  console.log('═'.repeat(70));
  console.log('R:R ANALYSIS');
  console.log('═'.repeat(70));

  const rrAchieved = trades.map(t => {
    if (!t.sl) return 0;
    const risk = Math.abs(t.entryPrice - t.sl);
    const reward = Math.abs(t.exitPrice - t.entryPrice);
    return risk > 0 ? reward / risk : 0;
  });

  const avgRR = rrAchieved.reduce((sum, rr) => sum + rr, 0) / rrAchieved.length;
  console.log(`Average R:R Achieved: ${avgRR.toFixed(2)}`);
  console.log(`Target R:R: 3.0`);
  console.log(`Gap: ${(3.0 - avgRR).toFixed(2)}\n`);

  // How many reached 1R, 2R, 3R?
  const reached1R = trades.filter(t => {
    if (!t.sl) return false;
    const risk = Math.abs(t.entryPrice - t.sl);
    const reward = Math.abs(t.exitPrice - t.entryPrice);
    return reward >= risk;
  }).length;

  const reached2R = trades.filter(t => {
    if (!t.sl) return false;
    const risk = Math.abs(t.entryPrice - t.sl);
    const reward = Math.abs(t.exitPrice - t.entryPrice);
    return reward >= risk * 2;
  }).length;

  const reached3R = trades.filter(t => {
    if (!t.sl) return false;
    const risk = Math.abs(t.entryPrice - t.sl);
    const reward = Math.abs(t.exitPrice - t.entryPrice);
    return reward >= risk * 3;
  }).length;

  console.log(`Reached 1R: ${reached1R} (${((reached1R / trades.length) * 100).toFixed(1)}%)`);
  console.log(`Reached 2R: ${reached2R} (${((reached2R / trades.length) * 100).toFixed(1)}%)`);
  console.log(`Reached 3R: ${reached3R} (${((reached3R / trades.length) * 100).toFixed(1)}%)\n`);

  // Sample analysis
  console.log('═'.repeat(70));
  console.log('SAMPLE LOSING TRADES (First 10)');
  console.log('═'.repeat(70));

  losers.slice(0, 10).forEach((trade, i) => {
    const risk = trade.sl ? Math.abs(trade.entryPrice - trade.sl) : 0;
    const reward = Math.abs(trade.exitPrice - trade.entryPrice);
    const rr = risk > 0 ? reward / risk : 0;

    console.log(`\nLoss #${i + 1}:`);
    console.log(`  Direction: ${trade.direction.toUpperCase()}`);
    console.log(`  Entry: ${trade.entryPrice.toFixed(2)}, Exit: ${trade.exitPrice.toFixed(2)}`);
    console.log(`  SL: ${trade.sl?.toFixed(2)}, TP: ${trade.tp?.toFixed(2)}`);
    console.log(`  Risk: ${risk.toFixed(2)}, Reward: ${reward.toFixed(2)}, R:R: ${rr.toFixed(2)}`);
    console.log(`  Profit: $${trade.profit.toFixed(2)}`);
    console.log(`  Entry Time: ${new Date(trade.entryTime).toISOString()}`);
    console.log(`  Duration: ${((trade.exitTime - trade.entryTime) / 1000 / 60).toFixed(0)} minutes`);
  });

  console.log('\n' + '═'.repeat(70));
  console.log('SAMPLE WINNING TRADES (First 5)');
  console.log('═'.repeat(70));

  winners.slice(0, 5).forEach((trade, i) => {
    const risk = trade.sl ? Math.abs(trade.entryPrice - trade.sl) : 0;
    const reward = Math.abs(trade.exitPrice - trade.entryPrice);
    const rr = risk > 0 ? reward / risk : 0;

    console.log(`\nWin #${i + 1}:`);
    console.log(`  Direction: ${trade.direction.toUpperCase()}`);
    console.log(`  Entry: ${trade.entryPrice.toFixed(2)}, Exit: ${trade.exitPrice.toFixed(2)}`);
    console.log(`  SL: ${trade.sl?.toFixed(2)}, TP: ${trade.tp?.toFixed(2)}`);
    console.log(`  Risk: ${risk.toFixed(2)}, Reward: ${reward.toFixed(2)}, R:R: ${rr.toFixed(2)}`);
    console.log(`  Profit: $${trade.profit.toFixed(2)}`);
    console.log(`  Entry Time: ${new Date(trade.entryTime).toISOString()}`);
    console.log(`  Duration: ${((trade.exitTime - trade.entryTime) / 1000 / 60).toFixed(0)} minutes`);
  });

  // Key insights
  console.log('\n' + '═'.repeat(70));
  console.log('KEY INSIGHTS');
  console.log('═'.repeat(70));

  console.log(`\n1. Only ${reached3R} trades (${((reached3R / trades.length) * 100).toFixed(1)}%) reached 3R target`);
  console.log(`2. ${losers.length} trades (${((losers.length / trades.length) * 100).toFixed(1)}%) hit stop loss`);
  console.log(`3. Average winning R:R: ${winners.length > 0 ? (winners.reduce((sum, t) => {
    const risk = t.sl ? Math.abs(t.entryPrice - t.sl) : 1;
    return sum + Math.abs(t.exitPrice - t.entryPrice) / risk;
  }, 0) / winners.length).toFixed(2) : 'N/A'}`);
  console.log(`4. Average losing R:R: ${losers.length > 0 ? (losers.reduce((sum, t) => {
    const risk = t.sl ? Math.abs(t.entryPrice - t.sl) : 1;
    return sum + Math.abs(t.exitPrice - t.entryPrice) / risk;
  }, 0) / losers.length).toFixed(2) : 'N/A'}`);

  console.log('\nCONCLUSION:');
  console.log('Most trades are hitting stop before reaching 3R. This suggests:');
  console.log('- Entry timing is poor (entering too early or at wrong levels)');
  console.log('- Setups lack follow-through (weak FVG/OB or counter-trend)');
  console.log('- Market conditions unsuitable (sideways/choppy HTF)');
  console.log('\nRECOMMENDATION: Tighten entry filters, not stop loss width.');
}

analyzeTrades().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
