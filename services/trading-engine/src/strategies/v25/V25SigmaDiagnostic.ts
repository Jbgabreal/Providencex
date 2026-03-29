/**
 * V25 Sigma Diagnostic Scanner
 *
 * Research tool — NOT a trading strategy.
 * Scans V25 M5 candles to measure whether mean-reversion setups exist
 * at various sigma levels, how often they trigger, and whether
 * post-signal price action shows any edge.
 *
 * NOTE: This implementation recalculates SMA/stdDev/ATR per candle
 * for diagnostic clarity. This is intentional — it's a research tool,
 * not production execution code. If results justify building a live
 * strategy, the production version should use rolling indicators.
 *
 * Usage:
 *   npx tsx src/strategies/v25/V25SigmaDiagnostic.ts \
 *     --csv data/cache/V25_M1_2025-06-01_2025-06-30.csv \
 *     --label "Jun 2025"
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

type BreachMode = 'close' | 'wick';
type ReversalWindow = 1 | 2 | 3;

interface SetupEvent {
  barIndex: number;
  timestamp: string;
  direction: 'long' | 'short';
  breachMode: BreachMode;
  sigmaLevel: number;
  prevClose: number;
  prevLow: number;
  prevHigh: number;
  mean: number;
  sd: number;
  atr: number;
  atrRatio: number;
  distanceFromMeanPoints: number;
  distanceFromMeanSigma: number;
  // Per reversal window
  reversals: {
    [window: number]: {
      triggered: boolean;
      triggerBarOffset: number | null;  // which bar triggered (1, 2, or 3)
      bodyRatio: number | null;
      maxFavorableExcursion: number;
      maxAdverseExcursion: number;
      favorableExceedsAdverse: boolean;
    };
  };
}

interface BucketResult {
  label: string;
  sigmaLevel: number;
  breachMode: BreachMode;
  totalM5Candles: number;

  // Setup frequency
  setupCountLong: number;
  setupCountShort: number;
  setupCountTotal: number;
  setupsPerDay: number;

  // Per reversal window
  windows: {
    [W in ReversalWindow]: {
      triggerCount: number;
      triggerRate: number;           // triggers / setups %
      avgFavorableExcursion: number;
      avgAdverseExcursion: number;
      medFavorableExcursion: number;
      medAdverseExcursion: number;
      favorableExceedsAdverseRate: number;  // %
      avgRRAtExcursion: number;      // avgFav / avgAdv
    };
  };

  // Context
  avgATR: number;
  avgATRRatio: number;
  avgDistanceFromMeanSigma: number;

  // Rejection reasons (across all windows, for window=1 trigger check)
  rejectedByBodyRatio: number;
  rejectedByTriggerLevel: number;
  rejectedByBearishWhenLong: number;
  rejectedByBullishWhenShort: number;
}

// ── Helpers ──

function loadCSV(csvPath: string): Candle[] {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const lines = raw.trim().split('\n');
  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('timestamp') || header.includes('open');
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map(line => {
    const parts = line.split(',');
    return {
      timestamp: parts[0],
      open: parseFloat(parts[1]),
      high: parseFloat(parts[2]),
      low: parseFloat(parts[3]),
      close: parseFloat(parts[4]),
      volume: parseFloat(parts[5] || '0'),
    };
  }).filter(c => !isNaN(c.open));
}

function aggregateM1ToM5(m1: Candle[]): Candle[] {
  const m5: Candle[] = [];
  for (let i = 0; i + 4 < m1.length; i += 5) {
    const group = m1.slice(i, i + 5);
    m5.push({
      timestamp: group[0].timestamp,
      open: group[0].open,
      high: Math.max(...group.map(c => c.high)),
      low: Math.min(...group.map(c => c.low)),
      close: group[4].close,
      volume: group.reduce((s, c) => s + c.volume, 0),
    });
  }
  return m5;
}

// Diagnostic implementations — clarity over performance
function sma(closes: number[], period: number): number {
  const slice = closes.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

function stdDev(closes: number[], period: number): number {
  const mean = sma(closes, period);
  const slice = closes.slice(-period);
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
  return Math.sqrt(variance);
}

function atr(candles: Candle[], period: number, endIdx: number): number {
  if (endIdx < period + 1) return 0;
  let sum = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
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
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Main Scanner ──

function runDiagnostic(
  m5: Candle[],
  label: string,
  sigmaLevels: number[],
  smaPeriod: number,
  atrPeriod: number,
  atrSlowPeriod: number,
  minBodyRatio: number,
): BucketResult[] {
  const results: BucketResult[] = [];
  const breachModes: BreachMode[] = ['close', 'wick'];
  const reversalWindows: ReversalWindow[] = [1, 2, 3];
  const lookAhead = 5; // bars to measure excursion

  for (const sigma of sigmaLevels) {
    for (const breachMode of breachModes) {
      const bucket: BucketResult = {
        label,
        sigmaLevel: sigma,
        breachMode,
        totalM5Candles: m5.length,
        setupCountLong: 0,
        setupCountShort: 0,
        setupCountTotal: 0,
        setupsPerDay: 0,
        windows: {
          1: { triggerCount: 0, triggerRate: 0, avgFavorableExcursion: 0, avgAdverseExcursion: 0, medFavorableExcursion: 0, medAdverseExcursion: 0, favorableExceedsAdverseRate: 0, avgRRAtExcursion: 0 },
          2: { triggerCount: 0, triggerRate: 0, avgFavorableExcursion: 0, avgAdverseExcursion: 0, medFavorableExcursion: 0, medAdverseExcursion: 0, favorableExceedsAdverseRate: 0, avgRRAtExcursion: 0 },
          3: { triggerCount: 0, triggerRate: 0, avgFavorableExcursion: 0, avgAdverseExcursion: 0, medFavorableExcursion: 0, medAdverseExcursion: 0, favorableExceedsAdverseRate: 0, avgRRAtExcursion: 0 },
        },
        avgATR: 0,
        avgATRRatio: 0,
        avgDistanceFromMeanSigma: 0,
        rejectedByBodyRatio: 0,
        rejectedByTriggerLevel: 0,
        rejectedByBearishWhenLong: 0,
        rejectedByBullishWhenShort: 0,
      };

      // Per-window excursion arrays for median calculation
      const favArrays: { [w: number]: number[] } = { 1: [], 2: [], 3: [] };
      const advArrays: { [w: number]: number[] } = { 1: [], 2: [], 3: [] };
      const favExceedsAdv: { [w: number]: number } = { 1: 0, 2: 0, 3: 0 };
      const windowTriggerCounts: { [w: number]: number } = { 1: 0, 2: 0, 3: 0 };

      const minIdx = Math.max(smaPeriod, atrSlowPeriod) + 1;

      for (let i = minIdx; i < m5.length - lookAhead - 1; i++) {
        const closes = m5.slice(0, i + 1).map(c => c.close);
        if (closes.length < smaPeriod) continue;

        const mean = sma(closes, smaPeriod);
        const sd = stdDev(closes, smaPeriod);
        const currentATR = atr(m5, atrPeriod, i);
        const slowATR = i >= atrSlowPeriod ? atr(m5, atrSlowPeriod, i) : currentATR;

        if (sd === 0 || currentATR === 0) continue;

        const atrRatio = slowATR > 0 ? currentATR / slowATR : 1;
        const prev = m5[i - 1];
        const upperSetup = mean + sigma * sd;
        const lowerSetup = mean - sigma * sd;

        // Check setup based on breach mode
        let setupDir: 'long' | 'short' | null = null;

        if (breachMode === 'close') {
          if (prev.close < lowerSetup) setupDir = 'long';
          else if (prev.close > upperSetup) setupDir = 'short';
        } else {
          // Wick-based: low breached lower band OR high breached upper band
          if (prev.low < lowerSetup) setupDir = 'long';
          else if (prev.high > upperSetup) setupDir = 'short';
        }

        if (!setupDir) continue;

        // Record setup
        if (setupDir === 'long') bucket.setupCountLong++;
        else bucket.setupCountShort++;
        bucket.setupCountTotal++;
        bucket.avgATR += currentATR;
        bucket.avgATRRatio += atrRatio;

        const refPrice = breachMode === 'close'
          ? prev.close
          : (setupDir === 'long' ? prev.low : prev.high);
        bucket.avgDistanceFromMeanSigma += Math.abs(refPrice - mean) / sd;

        // Check reversal within each window
        for (const window of reversalWindows) {
          let triggered = false;
          let triggerBarOffset: number | null = null;
          let triggerPrice = 0;
          let bestBodyRatio = 0;

          for (let w = 0; w < window; w++) {
            const barIdx = i + w;
            if (barIdx >= m5.length) break;
            const bar = m5[barIdx];
            const br = Math.abs(bar.close - bar.open) / (bar.high - bar.low + 0.01);

            if (setupDir === 'long') {
              const isBullish = bar.close > bar.open;
              if (isBullish && br >= minBodyRatio) {
                triggered = true;
                triggerBarOffset = w + 1;
                triggerPrice = bar.close;
                bestBodyRatio = br;
                break;
              }
              // Track rejection reasons (first window only)
              if (window === 1 && w === 0) {
                if (!isBullish) bucket.rejectedByBearishWhenLong++;
                else if (br < minBodyRatio) bucket.rejectedByBodyRatio++;
              }
            } else {
              const isBearish = bar.close < bar.open;
              if (isBearish && br >= minBodyRatio) {
                triggered = true;
                triggerBarOffset = w + 1;
                triggerPrice = bar.close;
                bestBodyRatio = br;
                break;
              }
              if (window === 1 && w === 0) {
                if (!isBearish) bucket.rejectedByBullishWhenShort++;
                else if (br < minBodyRatio) bucket.rejectedByBodyRatio++;
              }
            }
          }

          if (!triggered) continue;

          windowTriggerCounts[window]++;

          // Measure excursion from trigger price over next lookAhead bars
          const startBar = i + (triggerBarOffset || 1);
          let maxFav = 0;
          let maxAdv = 0;

          for (let j = startBar; j <= Math.min(startBar + lookAhead - 1, m5.length - 1); j++) {
            if (setupDir === 'long') {
              maxFav = Math.max(maxFav, m5[j].high - triggerPrice);
              maxAdv = Math.max(maxAdv, triggerPrice - m5[j].low);
            } else {
              maxFav = Math.max(maxFav, triggerPrice - m5[j].low);
              maxAdv = Math.max(maxAdv, m5[j].high - triggerPrice);
            }
          }

          favArrays[window].push(maxFav);
          advArrays[window].push(maxAdv);
          if (maxFav > maxAdv) favExceedsAdv[window]++;
        }
      }

      // Compute averages
      if (bucket.setupCountTotal > 0) {
        bucket.avgATR /= bucket.setupCountTotal;
        bucket.avgATRRatio /= bucket.setupCountTotal;
        bucket.avgDistanceFromMeanSigma /= bucket.setupCountTotal;
        // Estimate days from M5 candle count (288 M5 candles per day)
        const days = m5.length / 288;
        bucket.setupsPerDay = bucket.setupCountTotal / Math.max(days, 1);
      }

      for (const w of reversalWindows) {
        const n = windowTriggerCounts[w];
        bucket.windows[w].triggerCount = n;
        bucket.windows[w].triggerRate = bucket.setupCountTotal > 0
          ? (n / bucket.setupCountTotal) * 100 : 0;
        if (n > 0) {
          bucket.windows[w].avgFavorableExcursion = favArrays[w].reduce((s, v) => s + v, 0) / n;
          bucket.windows[w].avgAdverseExcursion = advArrays[w].reduce((s, v) => s + v, 0) / n;
          bucket.windows[w].medFavorableExcursion = median(favArrays[w]);
          bucket.windows[w].medAdverseExcursion = median(advArrays[w]);
          bucket.windows[w].favorableExceedsAdverseRate = (favExceedsAdv[w] / n) * 100;
          bucket.windows[w].avgRRAtExcursion = bucket.windows[w].avgAdverseExcursion > 0
            ? bucket.windows[w].avgFavorableExcursion / bucket.windows[w].avgAdverseExcursion : 0;
        }
      }

      results.push(bucket);
    }
  }

  return results;
}

// ── Output formatting ──

function formatResults(allResults: BucketResult[][]): string {
  const lines: string[] = [];

  lines.push('# V25 Sigma Diagnostic Results');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Sigma levels: ${[...new Set(allResults.flat().map(r => r.sigmaLevel))].join(', ')}`);
  lines.push(`Breach modes: close, wick`);
  lines.push(`Reversal windows: 1, 2, 3 bars`);
  lines.push('');

  // Summary table per sigma per breach mode
  for (const breachMode of ['close', 'wick'] as BreachMode[]) {
    lines.push(`## Breach Mode: ${breachMode.toUpperCase()}`);
    lines.push('');

    for (const window of [1, 2, 3] as ReversalWindow[]) {
      lines.push(`### Reversal Window: ${window} bar(s)`);
      lines.push('');
      lines.push('| Month | σ | Setups | Setups/Day | Triggers | Trig% | AvgFav | AvgAdv | Fav>Adv% | AvgRR |');
      lines.push('|-------|---|--------|-----------|----------|-------|--------|--------|----------|-------|');

      for (const monthResults of allResults) {
        for (const r of monthResults) {
          if (r.breachMode !== breachMode) continue;
          const w = r.windows[window];
          lines.push(
            `| ${r.label} | ${r.sigmaLevel} | ${r.setupCountTotal} | ${r.setupsPerDay.toFixed(1)} | ` +
            `${w.triggerCount} | ${w.triggerRate.toFixed(0)}% | ` +
            `${w.avgFavorableExcursion.toFixed(0)} | ${w.avgAdverseExcursion.toFixed(0)} | ` +
            `${w.favorableExceedsAdverseRate.toFixed(0)}% | ${w.avgRRAtExcursion.toFixed(2)} |`
          );
        }
        lines.push('|---|---|---|---|---|---|---|---|---|---|');
      }
      lines.push('');
    }
  }

  // Rejection breakdown
  lines.push('## Rejection Reasons (window=1, close breach only)');
  lines.push('');
  lines.push('| Month | σ | Setups | WrongDir | BodyTooSmall | TriggerLevel |');
  lines.push('|-------|---|--------|----------|--------------|--------------|');
  for (const monthResults of allResults) {
    for (const r of monthResults) {
      if (r.breachMode !== 'close') continue;
      lines.push(
        `| ${r.label} | ${r.sigmaLevel} | ${r.setupCountTotal} | ` +
        `${r.rejectedByBearishWhenLong + r.rejectedByBullishWhenShort} | ` +
        `${r.rejectedByBodyRatio} | ${r.rejectedByTriggerLevel} |`
      );
    }
  }

  return lines.join('\n');
}

// ── CLI ──

async function main() {
  const args = process.argv.slice(2);
  const csvPaths: string[] = [];
  const labels: string[] = [];

  // Parse --csv and --label pairs, or --all for batch mode
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--csv' && args[i + 1]) {
      csvPaths.push(args[++i]);
    } else if (args[i] === '--label' && args[i + 1]) {
      labels.push(args[++i]);
    } else if (args[i] === '--all') {
      // Auto-discover all V25 CSVs
      const cacheDir = path.join(__dirname, '../../../data/cache');
      if (fs.existsSync(cacheDir)) {
        const files = fs.readdirSync(cacheDir)
          .filter(f => f.startsWith('V25_M1_') && f.endsWith('.csv'))
          .sort();
        for (const f of files) {
          csvPaths.push(path.join(cacheDir, f));
          // Extract label from filename: V25_M1_2025-06-01_2025-06-30.csv → Jun 2025
          const match = f.match(/V25_M1_(\d{4})-(\d{2})-\d{2}/);
          if (match) {
            const months = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            labels.push(`${months[parseInt(match[2])]} ${match[1]}`);
          } else {
            labels.push(f);
          }
        }
      }
    }
  }

  if (csvPaths.length === 0) {
    console.log('Usage:');
    console.log('  npx tsx src/strategies/v25/V25SigmaDiagnostic.ts --all');
    console.log('  npx tsx src/strategies/v25/V25SigmaDiagnostic.ts --csv path.csv --label "Jun 2025"');
    process.exit(1);
  }

  const sigmaLevels = [0.75, 1.0, 1.25, 1.5, 2.0];
  const smaPeriod = 20;
  const atrPeriod = 14;
  const atrSlowPeriod = 50;
  const minBodyRatio = 0.35;

  const allResults: BucketResult[][] = [];

  for (let i = 0; i < csvPaths.length; i++) {
    const csvPath = csvPaths[i];
    const label = labels[i] || `Dataset ${i + 1}`;

    console.log(`Processing ${label} (${csvPath})...`);

    const m1 = loadCSV(csvPath);
    console.log(`  M1 candles: ${m1.length}`);

    const m5 = aggregateM1ToM5(m1);
    console.log(`  M5 candles: ${m5.length}`);

    const results = runDiagnostic(m5, label, sigmaLevels, smaPeriod, atrPeriod, atrSlowPeriod, minBodyRatio);
    allResults.push(results);

    // Print quick summary for this month
    for (const r of results) {
      if (r.setupCountTotal > 0) {
        console.log(
          `  σ=${r.sigmaLevel} ${r.breachMode}: ${r.setupCountTotal} setups, ` +
          `w1=${r.windows[1].triggerCount} triggers (${r.windows[1].favorableExceedsAdverseRate.toFixed(0)}% fav>adv), ` +
          `w3=${r.windows[3].triggerCount} triggers (${r.windows[3].favorableExceedsAdverseRate.toFixed(0)}% fav>adv)`
        );
      }
    }
    console.log('');
  }

  // Write full results
  const output = formatResults(allResults);
  const outPath = path.join(__dirname, '../../../data/v25_sigma_diagnostic.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output);
  console.log(`Full results written to: ${outPath}`);
}

main().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
