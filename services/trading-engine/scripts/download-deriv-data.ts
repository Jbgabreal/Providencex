/**
 * Download Deriv historical data in batches with cooldowns.
 * Saves to CSV for backtest use.
 *
 * Usage: npx tsx scripts/download-deriv-data.ts --symbol V25 --from 2026-02-15 --to 2026-03-27
 */

import WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';

const SYMBOL_MAP: Record<string, string> = {
  V25: '1HZ25V', V50: '1HZ50V', V75: '1HZ75V', V100: '1HZ100V', V10: '1HZ10V',
  XAUUSD: 'frxXAUUSD', EURUSD: 'frxEURUSD', GBPUSD: 'frxGBPUSD',
};

const args = process.argv.slice(2);
const symbol = args[args.indexOf('--symbol') + 1] || 'V25';
const fromDate = args[args.indexOf('--from') + 1] || '2026-02-15';
const toDate = args[args.indexOf('--to') + 1] || '2026-03-27';
const granularity = 60; // M1
const appId = process.env.DERIV_APP_ID || '1089';
const batchSize = 5000;
const cooldownMs = 5000; // 5 seconds between batches

const derivSymbol = SYMBOL_MAP[symbol.toUpperCase()];
if (!derivSymbol) { console.error(`Unknown symbol: ${symbol}`); process.exit(1); }

const startEpoch = Math.floor(new Date(fromDate + 'T00:00:00Z').getTime() / 1000);
const endEpoch = Math.floor(new Date(toDate + 'T23:59:59Z').getTime() / 1000);
const outFile = path.join(__dirname, '..', 'data', 'cache', `${symbol}_M1_${fromDate}_${toDate}.csv`);

console.log(`Downloading ${symbol} (${derivSymbol}) M1 data`);
console.log(`Range: ${fromDate} → ${toDate}`);
console.log(`Output: ${outFile}`);

interface Candle { epoch: number; open: string; high: string; low: string; close: string; }

function fetchBatch(start: number, end: number): Promise<Candle[]> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${appId}`);
    let done = false;
    const timeout = setTimeout(() => { if (!done) { done = true; ws.close(); resolve([]); } }, 30000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        ticks_history: derivSymbol,
        style: 'candles',
        granularity,
        start,
        end: Math.min(end, start + granularity * batchSize),
        adjust_start_time: 1,
      }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.error) {
        console.error(`  API error: ${msg.error.message}`);
        if (!done) { done = true; clearTimeout(timeout); ws.close(); resolve([]); }
        return;
      }
      if (msg.candles) {
        if (!done) { done = true; clearTimeout(timeout); ws.close(); resolve(msg.candles); }
      }
    });

    ws.on('error', () => { if (!done) { done = true; clearTimeout(timeout); ws.close(); resolve([]); } });
  });
}

async function main() {
  const allCandles: Candle[] = [];
  let currentStart = startEpoch;
  let batchNum = 0;

  while (currentStart < endEpoch) {
    batchNum++;
    const batchEnd = Math.min(endEpoch, currentStart + granularity * batchSize);
    process.stdout.write(`  Batch ${batchNum}: ${new Date(currentStart * 1000).toISOString().slice(0, 16)} → `);

    const candles = await fetchBatch(currentStart, batchEnd);
    if (candles.length === 0) {
      console.log('EMPTY (retrying after 15s...)');
      await new Promise(r => setTimeout(r, 15000));
      const retry = await fetchBatch(currentStart, batchEnd);
      if (retry.length === 0) {
        console.log('  Still empty, skipping ahead...');
        currentStart += granularity * batchSize;
        continue;
      }
      allCandles.push(...retry);
      const lastEpoch = retry[retry.length - 1].epoch;
      console.log(`${retry.length} candles (retry OK) → ${new Date(lastEpoch * 1000).toISOString().slice(0, 16)}`);
      currentStart = lastEpoch + granularity;
    } else {
      allCandles.push(...candles);
      const lastEpoch = candles[candles.length - 1].epoch;
      console.log(`${candles.length} candles → ${new Date(lastEpoch * 1000).toISOString().slice(0, 16)}`);
      currentStart = lastEpoch + granularity;
    }

    // Cooldown between batches
    await new Promise(r => setTimeout(r, cooldownMs));
  }

  // Write CSV
  const header = 'timestamp,open,high,low,close,volume\n';
  const rows = allCandles.map(c =>
    `${c.epoch * 1000},${c.open},${c.high},${c.low},${c.close},1`
  ).join('\n');
  fs.writeFileSync(outFile, header + rows);

  console.log(`\nDone! ${allCandles.length} candles saved to ${outFile}`);
  const days = (allCandles.length / 1440).toFixed(1);
  console.log(`Coverage: ~${days} days of M1 data`);
}

main().catch(console.error);
