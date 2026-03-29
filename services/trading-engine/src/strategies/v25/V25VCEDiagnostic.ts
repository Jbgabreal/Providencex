/**
 * V25 Volatility Compression → Expansion (VCE) Diagnostic Scanner
 *
 * RESEARCH TOOL — NOT A TRADING STRATEGY.
 *
 * Tests two separate hypotheses:
 *   A. Does compression meaningfully precede expansion on V25 M5?
 *   B. After expansion begins, does direction persist enough to be useful?
 *
 * All thresholds are PROVISIONAL RESEARCH HEURISTICS — starting points
 * for exploration, not validated constants.
 *
 * This scanner measures signal quality only. It does NOT model execution.
 * Any future strategy backtest must separately account for:
 *   - signal-to-buy delay (expansion candle close → proposal → buy)
 *   - proposal/buy latency on Deriv WebSocket (~2-3 seconds)
 *   - slippage (price moves during latency window)
 *   - rejected entries (proposal expired, price moved too far)
 *
 * NOTE: ATR and indicator calculations are done per-bar for diagnostic
 * clarity, not for performance. A production strategy would use rolling
 * state. This is intentional.
 *
 * Usage:
 *   npx tsx src/strategies/v25/V25VCEDiagnostic.ts --all
 *   npx tsx src/strategies/v25/V25VCEDiagnostic.ts --csv path.csv --label "Jun 2025"
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ──

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ExpansionEvent {
  barIndex: number;
  timestamp: string;
  direction: 'long' | 'short';
  expansionRange: number;
  bodyRatio: number;
  atrFast: number;
  atrSlow: number;
  compressionRatio: number;        // atrFast/atrSlow at the bar BEFORE expansion
  compressionDurationBars: number; // how many bars compression lasted
  entryPrice: number;              // expansion candle close (signal price, NOT fill price)

  // Continuation metrics (measured from entryPrice)
  nextBar: { continued: boolean; close: number } | null;
  next3Bars: { continuedCount: number; closes: number[] } | null;
  next5Bars: { continuedCount: number; closes: number[] } | null;

  // Excursion metrics
  mfe3: number;  // max favorable excursion over next 3 bars
  mae3: number;  // max adverse excursion over next 3 bars
  mfe5: number;  // max favorable excursion over next 5 bars
  mae5: number;  // max adverse excursion over next 5 bars

  // False expansion
  isFalseExpansion: boolean; // next bar closes beyond expansion candle's open (full reversal)
}

interface QuestionAResult {
  label: string;
  compressionThreshold: number;
  expansionThreshold: number;
  totalM5Candles: number;

  // Compression stats
  compressionPeriodCount: number;
  avgCompressionDuration: number;   // bars
  compressionPeriodsPerDay: number;

  // How often does expansion follow compression?
  expansionsAfterCompression: number;
  expansionRate: number;           // expansions / compression periods %

  // Baseline: how often does expansion happen WITHOUT compression?
  expansionsWithoutCompression: number;
  baselineExpansionRate: number;   // per total non-compressed bars %

  // Lift: does compression actually predict expansion?
  liftRatio: number;               // expansionRate / baselineExpansionRate
}

interface QuestionBResult {
  label: string;
  compressionThreshold: number;
  expansionThreshold: number;

  // Sample size
  totalExpansionEvents: number;
  longEvents: number;
  shortEvents: number;

  // Continuation rates
  nextBarContinuationRate: number;           // % where next bar closes in same direction
  twoOfThreeContinuationRate: number;        // % where 2+ of next 3 bars continue
  threeOfFiveContinuationRate: number;       // % where 3+ of next 5 bars continue

  // Excursion (averages)
  avgMFE3: number;
  avgMAE3: number;
  avgMFE5: number;
  avgMAE5: number;
  medMFE3: number;
  medMAE3: number;
  medMFE5: number;
  medMAE5: number;

  // MFE > MAE rates
  mfeExceedsMAE3Rate: number;  // % where MFE3 > MAE3
  mfeExceedsMAE5Rate: number;  // % where MFE5 > MAE5

  // Avg R:R at excursion
  avgRR3: number;  // avgMFE3 / avgMAE3
  avgRR5: number;  // avgMFE5 / avgMAE5

  // False expansion
  falseExpansionRate: number;    // % where next bar fully reverses the expansion candle

  // Avg compression duration before these events
  avgCompressionDuration: number;
}

// ── Helpers ──

function loadCSV(csvPath: string): Candle[] {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const lines = raw.trim().split('\n');
  const hasHeader = lines[0].toLowerCase().includes('timestamp') || lines[0].toLowerCase().includes('open');
  const dataLines = hasHeader ? lines.slice(1) : lines;
  return dataLines.map(line => {
    const p = line.split(',');
    return {
      timestamp: p[0], open: +p[1], high: +p[2],
      low: +p[3], close: +p[4], volume: +(p[5] || 0),
    };
  }).filter(c => !isNaN(c.open));
}

function aggregateM1ToM5(m1: Candle[]): Candle[] {
  const m5: Candle[] = [];
  for (let i = 0; i + 4 < m1.length; i += 5) {
    const g = m1.slice(i, i + 5);
    m5.push({
      timestamp: g[0].timestamp,
      open: g[0].open,
      high: Math.max(...g.map(c => c.high)),
      low: Math.min(...g.map(c => c.low)),
      close: g[4].close,
      volume: g.reduce((s, c) => s + c.volume, 0),
    });
  }
  return m5;
}

function atr(candles: Candle[], period: number, endIdx: number): number {
  if (endIdx < period) return 0;
  let sum = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    if (i < 1) continue;
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    sum += tr;
  }
  return sum / period;
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Scanner ──

function runDiagnostic(
  m5: Candle[],
  label: string,
  compressionThresholds: number[],
  expansionThresholds: number[],
  atrFastPeriod: number,
  atrSlowPeriod: number,
  minCompressionBars: number,
  minBodyRatio: number,
): { questionA: QuestionAResult[]; questionB: QuestionBResult[] } {

  const questionA: QuestionAResult[] = [];
  const questionB: QuestionBResult[] = [];
  const minIdx = atrSlowPeriod + 1;
  const lookAhead = 5;

  for (const compThresh of compressionThresholds) {
    for (const expThresh of expansionThresholds) {

      // ── Question A: Does compression precede expansion? ──

      const qA: QuestionAResult = {
        label, compressionThreshold: compThresh, expansionThreshold: expThresh,
        totalM5Candles: m5.length,
        compressionPeriodCount: 0, avgCompressionDuration: 0, compressionPeriodsPerDay: 0,
        expansionsAfterCompression: 0, expansionRate: 0,
        expansionsWithoutCompression: 0, baselineExpansionRate: 0, liftRatio: 0,
      };

      // Track compression state
      let inCompression = false;
      let compressionStart = 0;
      let compressionDurations: number[] = [];
      let compressedBars = 0;
      let nonCompressedBars = 0;
      let expansionsAfterComp = 0;
      let expansionsNoComp = 0;

      // Expansion events for Question B
      const events: ExpansionEvent[] = [];

      for (let i = minIdx; i < m5.length - lookAhead; i++) {
        const af = atr(m5, atrFastPeriod, i);
        const as_ = atr(m5, atrSlowPeriod, i);
        if (as_ === 0) continue;

        const ratio = af / as_;
        const candleRange = m5[i].high - m5[i].low;
        const isExpansionCandle = candleRange > expThresh * as_;
        const bodyRatio = Math.abs(m5[i].close - m5[i].open) / (candleRange + 0.01);
        const isQualifiedExpansion = isExpansionCandle && bodyRatio >= minBodyRatio;

        if (ratio < compThresh) {
          if (!inCompression) {
            inCompression = true;
            compressionStart = i;
          }
          compressedBars++;
        } else {
          if (inCompression) {
            const duration = i - compressionStart;
            if (duration >= minCompressionBars) {
              compressionDurations.push(duration);

              // Check if this bar (first non-compressed) is an expansion
              if (isQualifiedExpansion) {
                expansionsAfterComp++;

                // Record event for Question B
                const dir: 'long' | 'short' = m5[i].close > m5[i].open ? 'long' : 'short';
                const entry = m5[i].close;

                // Measure continuation
                const nextBars = m5.slice(i + 1, i + 1 + lookAhead);

                let nextBarCont: { continued: boolean; close: number } | null = null;
                if (nextBars.length >= 1) {
                  const nb = nextBars[0];
                  const cont = dir === 'long' ? nb.close > entry : nb.close < entry;
                  nextBarCont = { continued: cont, close: nb.close };
                }

                let next3: { continuedCount: number; closes: number[] } | null = null;
                if (nextBars.length >= 3) {
                  const closes = nextBars.slice(0, 3).map(c => c.close);
                  const count = closes.filter(c => dir === 'long' ? c > entry : c < entry).length;
                  next3 = { continuedCount: count, closes };
                }

                let next5: { continuedCount: number; closes: number[] } | null = null;
                if (nextBars.length >= 5) {
                  const closes = nextBars.slice(0, 5).map(c => c.close);
                  const count = closes.filter(c => dir === 'long' ? c > entry : c < entry).length;
                  next5 = { continuedCount: count, closes };
                }

                // Excursion
                let mfe3 = 0, mae3 = 0, mfe5 = 0, mae5 = 0;
                for (let j = 0; j < Math.min(lookAhead, nextBars.length); j++) {
                  const fav = dir === 'long'
                    ? nextBars[j].high - entry
                    : entry - nextBars[j].low;
                  const adv = dir === 'long'
                    ? entry - nextBars[j].low
                    : nextBars[j].high - entry;

                  if (j < 3) { mfe3 = Math.max(mfe3, fav); mae3 = Math.max(mae3, adv); }
                  mfe5 = Math.max(mfe5, fav);
                  mae5 = Math.max(mae5, adv);
                }

                // False expansion: next bar closes beyond expansion candle's open
                const isFalse = nextBars.length > 0 && (
                  dir === 'long' ? nextBars[0].close < m5[i].open : nextBars[0].close > m5[i].open
                );

                events.push({
                  barIndex: i, timestamp: m5[i].timestamp,
                  direction: dir, expansionRange: candleRange, bodyRatio,
                  atrFast: af, atrSlow: as_, compressionRatio: ratio,
                  compressionDurationBars: duration, entryPrice: entry,
                  nextBar: nextBarCont, next3Bars: next3, next5Bars: next5,
                  mfe3, mae3, mfe5, mae5, isFalseExpansion: isFalse,
                });
              }
            }
            inCompression = false;
          }
          nonCompressedBars++;

          // Baseline: expansion without prior compression
          if (isQualifiedExpansion && !inCompression) {
            // Only count if not already counted as post-compression
            const lastCompEnd = compressionDurations.length > 0 ? compressionStart + compressionDurations[compressionDurations.length - 1] : -1;
            if (i > lastCompEnd + 1) {
              expansionsNoComp++;
            }
          }
        }
      }

      // Question A results
      qA.compressionPeriodCount = compressionDurations.length;
      qA.avgCompressionDuration = compressionDurations.length > 0
        ? compressionDurations.reduce((s, v) => s + v, 0) / compressionDurations.length : 0;
      const days = m5.length / 288;
      qA.compressionPeriodsPerDay = compressionDurations.length / Math.max(days, 1);
      qA.expansionsAfterCompression = expansionsAfterComp;
      qA.expansionRate = compressionDurations.length > 0
        ? (expansionsAfterComp / compressionDurations.length) * 100 : 0;
      qA.expansionsWithoutCompression = expansionsNoComp;
      qA.baselineExpansionRate = nonCompressedBars > 0
        ? (expansionsNoComp / nonCompressedBars) * 100 : 0;
      qA.liftRatio = qA.baselineExpansionRate > 0
        ? qA.expansionRate / qA.baselineExpansionRate : 0;

      questionA.push(qA);

      // ── Question B: Does expansion direction persist? ──

      if (events.length === 0) {
        questionB.push({
          label, compressionThreshold: compThresh, expansionThreshold: expThresh,
          totalExpansionEvents: 0, longEvents: 0, shortEvents: 0,
          nextBarContinuationRate: 0, twoOfThreeContinuationRate: 0,
          threeOfFiveContinuationRate: 0,
          avgMFE3: 0, avgMAE3: 0, avgMFE5: 0, avgMAE5: 0,
          medMFE3: 0, medMAE3: 0, medMFE5: 0, medMAE5: 0,
          mfeExceedsMAE3Rate: 0, mfeExceedsMAE5Rate: 0,
          avgRR3: 0, avgRR5: 0, falseExpansionRate: 0, avgCompressionDuration: 0,
        });
        continue;
      }

      const n = events.length;
      const longs = events.filter(e => e.direction === 'long').length;
      const shorts = n - longs;

      const nbCont = events.filter(e => e.nextBar?.continued).length;
      const two3 = events.filter(e => e.next3Bars && e.next3Bars.continuedCount >= 2).length;
      const three5 = events.filter(e => e.next5Bars && e.next5Bars.continuedCount >= 3).length;
      const with3 = events.filter(e => e.next3Bars).length;
      const with5 = events.filter(e => e.next5Bars).length;

      const mfe3s = events.map(e => e.mfe3);
      const mae3s = events.map(e => e.mae3);
      const mfe5s = events.map(e => e.mfe5);
      const mae5s = events.map(e => e.mae5);
      const mfeGtMae3 = events.filter(e => e.mfe3 > e.mae3).length;
      const mfeGtMae5 = events.filter(e => e.mfe5 > e.mae5).length;
      const falseCount = events.filter(e => e.isFalseExpansion).length;

      const avgMFE3 = mfe3s.reduce((s, v) => s + v, 0) / n;
      const avgMAE3 = mae3s.reduce((s, v) => s + v, 0) / n;
      const avgMFE5 = mfe5s.reduce((s, v) => s + v, 0) / n;
      const avgMAE5 = mae5s.reduce((s, v) => s + v, 0) / n;

      questionB.push({
        label, compressionThreshold: compThresh, expansionThreshold: expThresh,
        totalExpansionEvents: n,
        longEvents: longs, shortEvents: shorts,
        nextBarContinuationRate: (nbCont / n) * 100,
        twoOfThreeContinuationRate: with3 > 0 ? (two3 / with3) * 100 : 0,
        threeOfFiveContinuationRate: with5 > 0 ? (three5 / with5) * 100 : 0,
        avgMFE3, avgMAE3, avgMFE5, avgMAE5,
        medMFE3: median(mfe3s), medMAE3: median(mae3s),
        medMFE5: median(mfe5s), medMAE5: median(mae5s),
        mfeExceedsMAE3Rate: (mfeGtMae3 / n) * 100,
        mfeExceedsMAE5Rate: (mfeGtMae5 / n) * 100,
        avgRR3: avgMAE3 > 0 ? avgMFE3 / avgMAE3 : 0,
        avgRR5: avgMAE5 > 0 ? avgMFE5 / avgMAE5 : 0,
        falseExpansionRate: (falseCount / n) * 100,
        avgCompressionDuration: events.reduce((s, e) => s + e.compressionDurationBars, 0) / n,
      });
    }
  }

  return { questionA, questionB };
}

// ── Output ──

function formatOutput(
  allA: QuestionAResult[][],
  allB: QuestionBResult[][],
): string {
  const lines: string[] = [];
  lines.push('# V25 VCE Diagnostic Results');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('All thresholds are PROVISIONAL RESEARCH HEURISTICS.');
  lines.push('This scanner measures signal quality only. No execution model applied.');
  lines.push('');

  // ── Question A ──
  lines.push('## Question A: Does Compression Precede Expansion?');
  lines.push('');
  lines.push('Lift ratio > 1.0 means expansion is more likely after compression than at random.');
  lines.push('');
  lines.push('| Month | Comp | Exp | CompPeriods | AvgDur | ExpAfterComp | ExpRate% | BaselineExp% | Lift |');
  lines.push('|-------|------|-----|-------------|--------|--------------|----------|--------------|------|');

  for (const monthResults of allA) {
    for (const r of monthResults) {
      lines.push(
        `| ${r.label} | ${r.compressionThreshold} | ${r.expansionThreshold} | ` +
        `${r.compressionPeriodCount} | ${r.avgCompressionDuration.toFixed(1)} | ` +
        `${r.expansionsAfterCompression} | ${r.expansionRate.toFixed(1)}% | ` +
        `${r.baselineExpansionRate.toFixed(2)}% | ${r.liftRatio.toFixed(2)} |`
      );
    }
    lines.push('|---|---|---|---|---|---|---|---|---|');
  }

  // ── Question B ──
  lines.push('');
  lines.push('## Question B: Does Expansion Direction Persist?');
  lines.push('');
  lines.push('| Month | Comp | Exp | Events | 1barCont% | 2of3Cont% | 3of5Cont% | MFE>MAE3% | MFE>MAE5% | AvgRR3 | AvgRR5 | FalseExp% |');
  lines.push('|-------|------|-----|--------|-----------|-----------|-----------|-----------|-----------|--------|--------|-----------|');

  for (const monthResults of allB) {
    for (const r of monthResults) {
      if (r.totalExpansionEvents === 0) {
        lines.push(
          `| ${r.label} | ${r.compressionThreshold} | ${r.expansionThreshold} | 0 | — | — | — | — | — | — | — | — |`
        );
        continue;
      }
      lines.push(
        `| ${r.label} | ${r.compressionThreshold} | ${r.expansionThreshold} | ` +
        `${r.totalExpansionEvents} | ${r.nextBarContinuationRate.toFixed(0)}% | ` +
        `${r.twoOfThreeContinuationRate.toFixed(0)}% | ${r.threeOfFiveContinuationRate.toFixed(0)}% | ` +
        `${r.mfeExceedsMAE3Rate.toFixed(0)}% | ${r.mfeExceedsMAE5Rate.toFixed(0)}% | ` +
        `${r.avgRR3.toFixed(2)} | ${r.avgRR5.toFixed(2)} | ${r.falseExpansionRate.toFixed(0)}% |`
      );
    }
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  }

  // ── Excursion detail ──
  lines.push('');
  lines.push('## Excursion Detail (points)');
  lines.push('');
  lines.push('| Month | Comp | Exp | Events | AvgMFE3 | AvgMAE3 | MedMFE3 | MedMAE3 | AvgMFE5 | AvgMAE5 | MedMFE5 | MedMAE5 |');
  lines.push('|-------|------|-----|--------|---------|---------|---------|---------|---------|---------|---------|---------|');

  for (const monthResults of allB) {
    for (const r of monthResults) {
      if (r.totalExpansionEvents === 0) continue;
      lines.push(
        `| ${r.label} | ${r.compressionThreshold} | ${r.expansionThreshold} | ` +
        `${r.totalExpansionEvents} | ${r.avgMFE3.toFixed(0)} | ${r.avgMAE3.toFixed(0)} | ` +
        `${r.medMFE3.toFixed(0)} | ${r.medMAE3.toFixed(0)} | ` +
        `${r.avgMFE5.toFixed(0)} | ${r.avgMAE5.toFixed(0)} | ` +
        `${r.medMFE5.toFixed(0)} | ${r.medMAE5.toFixed(0)} |`
      );
    }
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  }

  return lines.join('\n');
}

// ── CLI ──

async function main() {
  const args = process.argv.slice(2);
  const csvPaths: string[] = [];
  const labels: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--csv' && args[i + 1]) csvPaths.push(args[++i]);
    else if (args[i] === '--label' && args[i + 1]) labels.push(args[++i]);
    else if (args[i] === '--all') {
      const cacheDir = path.join(__dirname, '../../../data/cache');
      if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir)
          .filter(f => f.startsWith('V25_M1_') && f.endsWith('.csv'))
          .sort();
        for (const f of files) {
          csvPaths.push(path.join(cacheDir, f));
          const match = f.match(/V25_M1_(\d{4})-(\d{2})-\d{2}/);
          if (match) {
            const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            labels.push(`${months[parseInt(match[2])]} ${match[1]}`);
          } else labels.push(f);
        }
      }
    }
  }

  if (!csvPaths.length) {
    console.log('Usage:');
    console.log('  npx tsx src/strategies/v25/V25VCEDiagnostic.ts --all');
    console.log('  npx tsx src/strategies/v25/V25VCEDiagnostic.ts --csv path.csv --label "Jun 2025"');
    process.exit(1);
  }

  // Provisional research heuristics — starting points only
  const compressionThresholds = [0.5, 0.6, 0.7, 0.8];
  const expansionThresholds = [1.1, 1.3, 1.5, 1.7];
  const atrFastPeriod = 5;
  const atrSlowPeriod = 20;
  const minCompressionBars = 3;
  const minBodyRatio = 0.35;

  const allA: QuestionAResult[][] = [];
  const allB: QuestionBResult[][] = [];

  for (let i = 0; i < csvPaths.length; i++) {
    const csvPath = csvPaths[i];
    const label = labels[i] || `Dataset ${i + 1}`;

    console.log(`Processing ${label}...`);
    const m1 = loadCSV(csvPath);
    const m5 = aggregateM1ToM5(m1);
    console.log(`  M1: ${m1.length} → M5: ${m5.length}`);

    const { questionA, questionB } = runDiagnostic(
      m5, label, compressionThresholds, expansionThresholds,
      atrFastPeriod, atrSlowPeriod, minCompressionBars, minBodyRatio,
    );

    allA.push(questionA);
    allB.push(questionB);

    // Quick summary
    for (const b of questionB) {
      if (b.totalExpansionEvents > 0) {
        console.log(
          `  comp=${b.compressionThreshold} exp=${b.expansionThreshold}: ` +
          `${b.totalExpansionEvents} events, 1bar=${b.nextBarContinuationRate.toFixed(0)}%, ` +
          `MFE>MAE3=${b.mfeExceedsMAE3Rate.toFixed(0)}%, ` +
          `falseExp=${b.falseExpansionRate.toFixed(0)}%`
        );
      }
    }
    console.log('');
  }

  // Write output
  const output = formatOutput(allA, allB);
  const outPath = path.join(__dirname, '../../../data/v25_vce_diagnostic.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output);
  console.log(`Full results: ${outPath}`);

  // Print lift ratio summary
  console.log('\n=== LIFT RATIO SUMMARY (does compression predict expansion?) ===');
  console.log('Lift > 1.5 = compression meaningfully precedes expansion');
  console.log('Lift ~ 1.0 = compression does NOT predict expansion\n');

  for (const monthA of allA) {
    const first = monthA[0];
    console.log(`${first.label}:`);
    for (const r of monthA) {
      if (r.compressionPeriodCount > 0) {
        const liftStr = r.liftRatio > 1.5 ? '✓' : r.liftRatio > 1.2 ? '~' : '✗';
        console.log(
          `  comp=${r.compressionThreshold} exp=${r.expansionThreshold}: ` +
          `lift=${r.liftRatio.toFixed(2)} ${liftStr} ` +
          `(${r.expansionsAfterCompression}/${r.compressionPeriodCount} periods, ` +
          `baseline=${r.baselineExpansionRate.toFixed(2)}%)`
        );
      }
    }
  }
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
