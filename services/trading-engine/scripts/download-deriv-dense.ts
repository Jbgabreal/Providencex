/**
 * Download Deriv data day by day for synthetic indices.
 * These indices have 1440 M1 candles per day but API returns max 1000 per request.
 * So we request 12-hour chunks to get full coverage.
 */
import WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';

const derivSymbol = process.argv[3] || '1HZ25V';
const symbol = process.argv[2] || 'V25';
const fromDate = process.argv[4] || '2026-02-15';
const toDate = process.argv[5] || '2026-03-27';
const appId = '1089';

const outFile = path.join(__dirname, '..', 'data', 'cache', `${symbol}_M1_${fromDate}_${toDate}.csv`);
console.log(`Downloading ${symbol} (${derivSymbol}) day by day`);

function fetchBatch(start: number, end: number): Promise<any[]> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${appId}`);
    let done = false;
    const timeout = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch {} resolve([]); } }, 20000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ ticks_history: derivSymbol, style: 'candles', granularity: 60, start, end }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.error) { console.log(`    ERR: ${msg.error.message}`); if (!done) { done = true; clearTimeout(timeout); ws.close(); resolve([]); } }
      else if (msg.candles) { if (!done) { done = true; clearTimeout(timeout); ws.close(); resolve(msg.candles); } }
    });
    ws.on('error', () => { if (!done) { done = true; clearTimeout(timeout); try { ws.close(); } catch {} resolve([]); } });
  });
}

async function main() {
  const all: any[] = [];
  const start = new Date(fromDate + 'T00:00:00Z');
  const end = new Date(toDate + 'T23:59:59Z');

  let current = new Date(start);
  let dayNum = 0;

  while (current < end) {
    dayNum++;
    // Request in 12-hour chunks (720 candles each, well under 1000 limit)
    for (let half = 0; half < 2; half++) {
      const chunkStart = Math.floor(current.getTime() / 1000) + half * 43200;
      const chunkEnd = chunkStart + 43200;
      if (chunkStart >= end.getTime() / 1000) break;

      const candles = await fetchBatch(chunkStart, Math.min(chunkEnd, Math.floor(end.getTime() / 1000)));
      if (candles.length > 0) {
        all.push(...candles);
        process.stdout.write(`  Day ${dayNum} ${half === 0 ? 'AM' : 'PM'}: ${candles.length} candles (total: ${all.length})\r`);
      } else {
        // Retry once
        await new Promise(r => setTimeout(r, 10000));
        const retry = await fetchBatch(chunkStart, Math.min(chunkEnd, Math.floor(end.getTime() / 1000)));
        if (retry.length > 0) all.push(...retry);
      }
      await new Promise(r => setTimeout(r, 2000)); // 2s between requests
    }
    current.setDate(current.getDate() + 1);
    if (dayNum % 5 === 0) console.log(`  Day ${dayNum}: ${all.length} total candles so far`);
  }

  // Deduplicate by epoch
  const seen = new Set<number>();
  const unique = all.filter(c => { if (seen.has(c.epoch)) return false; seen.add(c.epoch); return true; });
  unique.sort((a, b) => a.epoch - b.epoch);

  const header = 'timestamp,open,high,low,close,volume\n';
  const rows = unique.map(c => `${c.epoch * 1000},${c.open},${c.high},${c.low},${c.close},1`).join('\n');
  fs.writeFileSync(outFile, header + rows);

  console.log(`\nDone! ${unique.length} unique candles saved`);
  console.log(`Coverage: ${(unique.length / 1440).toFixed(1)} days of M1 data`);
  console.log(`File: ${outFile}`);
}

main().catch(console.error);
