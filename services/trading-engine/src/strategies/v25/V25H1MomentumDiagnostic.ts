/**
 * V25 H1 Momentum Diagnostic Scanner
 *
 * RESEARCH TOOL — NOT A TRADING STRATEGY.
 *
 * Tests hypothesis: "V25 may occasionally show higher-timeframe directional
 * persistence. When that regime exists, lower-timeframe pullback + continuation
 * entries may have above-random follow-through."
 *
 * Two-phase diagnostic:
 *   Phase 1: Regime detection — does H1 ever show meaningful directional persistence?
 *   Phase 2: Pullback+trigger quality — when regime is valid, do M15 pullback
 *            continuation entries show above-random MFE/MAE?
 *
 * All thresholds are RESEARCH DEFAULTS — starting points, not validated constants.
 * This is signal-quality measurement only. No execution model applied.
 *
 * Usage:
 *   npx tsx src/strategies/v25/V25H1MomentumDiagnostic.ts --all
 *   npx tsx src/strategies/v25/V25H1MomentumDiagnostic.ts --csv path.csv --label "Jun 2025"
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

interface RegimeSnapshot {
  barIndex: number;
  timestamp: string;
  autocorrLag1: number;
  autocorrLag2: number;
  emaSlopeNorm: number;       // EMA20 slope normalized by ATR
  efficiencyRatio: number;
  signPersistence: number;
  regimeScore: number;        // composite
  regimeValid: boolean;
  bias: 'long' | 'short' | 'none';
  ema20: number;
  ema50: number;
  atr: number;
}

interface PullbackEvent {
  h1BarIndex: number;
  ltfBarIndex: number;
  timestamp: string;
  bias: 'long' | 'short';
  impulseSize: number;        // in ATR units
  retraceDepth: number;       // as % of impulse
  pullbackBars: number;
  triggerFound: boolean;
  triggerBodyRatio: number;
  entryPrice: number;
  structuralInvalidation: number;
  // Post-trigger excursion
  mfe1: number; mfe3: number; mfe5: number;
  mae1: number; mae3: number; mae5: number;
  nextBarContinued: boolean;
  twoOfThreeContinued: boolean;
  threeOfFiveContinued: boolean;
  regimeSnapshot: RegimeSnapshot;
}

interface DiagnosticResult {
  label: string;
  totalH1Bars: number;
  totalLTFBars: number;

  // Phase 1: Regime
  regimeValidCount: number;
  regimeValidPct: number;
  regimeBullishCount: number;
  regimeBearishCount: number;
  avgAutocorrLag1WhenValid: number;
  avgEfficiencyWhenValid: number;
  avgSignPersistenceWhenValid: number;

  // Phase 2: Pullback + Trigger
  pullbackCandidates: number;
  triggersFound: number;
  triggerRate: number;

  // Post-trigger quality
  nextBarContRate: number;
  twoOfThreeContRate: number;
  threeOfFiveContRate: number;
  avgMFE3: number; avgMAE3: number;
  avgMFE5: number; avgMAE5: number;
  medMFE3: number; medMAE3: number;
  medMFE5: number; medMAE5: number;
  mfeExceedsMAE3Rate: number;
  mfeExceedsMAE5Rate: number;
  avgRR3: number; avgRR5: number;

  // Rejection breakdown
  rejectedNoRegime: number;
  rejectedNoBias: number;
  rejectedNoPullback: number;
  rejectedNoTrigger: number;
}

// ── Config (research defaults) ──

interface DiagConfig {
  // Regime
  autocorrWindow: number;       // 20 H1 bars
  autocorrLag1Min: number;      // 0.10 — starting heuristic
  emaFastPeriod: number;        // 20
  emaSlowPeriod: number;        // 50
  emaSlopeLookback: number;     // 5 H1 bars
  emaSlopeMin: number;          // 0.1 ATR/bar — starting heuristic
  efficiencyWindow: number;     // 10 H1 bars
  efficiencyMin: number;        // 0.25 — starting heuristic
  signPersistenceWindow: number; // 10 H1 bars
  signPersistenceMin: number;   // 0.60 — starting heuristic
  extensionAtrMax: number;      // 3.0 — max distance from EMA20

  // Pullback (on LTF)
  ltfAtrPeriod: number;         // 14
  minImpulseAtrMult: number;    // 1.5 ATR
  minRetracePct: number;        // 0.30
  maxRetracePct: number;        // 0.80
  minPullbackBars: number;      // 2

  // Trigger
  triggerBodyRatioMin: number;  // 0.35
  microSwingLookback: number;   // 5
}

const DEFAULT_CONFIG: DiagConfig = {
  autocorrWindow: 20,
  autocorrLag1Min: 0.10,
  emaFastPeriod: 20,
  emaSlowPeriod: 50,
  emaSlopeLookback: 5,
  emaSlopeMin: 0.1,
  efficiencyWindow: 10,
  efficiencyMin: 0.25,
  signPersistenceWindow: 10,
  signPersistenceMin: 0.60,
  extensionAtrMax: 3.0,
  ltfAtrPeriod: 14,
  minImpulseAtrMult: 1.5,
  minRetracePct: 0.30,
  maxRetracePct: 0.80,
  minPullbackBars: 2,
  triggerBodyRatioMin: 0.35,
  microSwingLookback: 5,
};

// ── Helpers ──

function loadCSV(csvPath: string): Candle[] {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const lines = raw.trim().split('\n');
  const hasHeader = lines[0].toLowerCase().includes('timestamp') || lines[0].toLowerCase().includes('open');
  return (hasHeader ? lines.slice(1) : lines).map(line => {
    const p = line.split(',');
    return { timestamp: p[0], open: +p[1], high: +p[2], low: +p[3], close: +p[4], volume: +(p[5] || 0) };
  }).filter(c => !isNaN(c.open));
}

function aggregate(m1: Candle[], factor: number): Candle[] {
  const result: Candle[] = [];
  for (let i = 0; i + factor - 1 < m1.length; i += factor) {
    const g = m1.slice(i, i + factor);
    result.push({
      timestamp: g[0].timestamp,
      open: g[0].open,
      high: Math.max(...g.map(c => c.high)),
      low: Math.min(...g.map(c => c.low)),
      close: g[g.length - 1].close,
      volume: g.reduce((s, c) => s + c.volume, 0),
    });
  }
  return result;
}

function calcEMA(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  ema.push(sum / period);
  for (let i = period; i < values.length; i++) {
    ema.push(values[i] * k + ema[ema.length - 1] * (1 - k));
  }
  return ema;
}

function calcATR(candles: Candle[], period: number, endIdx: number): number {
  if (endIdx < period) return 0;
  let sum = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    if (i < 1) continue;
    sum += Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
  }
  return sum / period;
}

function autocorrelation(returns: number[], lag: number): number {
  if (returns.length < lag + 2) return 0;
  const n = returns.length;
  const mean = returns.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    den += (returns[i] - mean) ** 2;
    if (i >= lag) num += (returns[i] - mean) * (returns[i - lag] - mean);
  }
  return den === 0 ? 0 : num / den;
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Phase 1: Regime Detection on H1 ──

function detectRegime(
  h1: Candle[],
  idx: number,
  cfg: DiagConfig,
): RegimeSnapshot | null {
  if (idx < cfg.emaSlowPeriod + cfg.autocorrWindow) return null;

  const closes = h1.slice(0, idx + 1).map(c => c.close);

  // EMA20 and EMA50
  const ema20Arr = calcEMA(closes, cfg.emaFastPeriod);
  const ema50Arr = calcEMA(closes, cfg.emaSlowPeriod);
  if (ema20Arr.length < cfg.emaSlopeLookback + 1 || ema50Arr.length < 1) return null;

  const ema20 = ema20Arr[ema20Arr.length - 1];
  const ema50 = ema50Arr[ema50Arr.length - 1];

  // ATR for normalization
  const atrVal = calcATR(h1, 14, idx);
  if (atrVal === 0) return null;

  // A. Autocorrelation of H1 returns
  const windowStart = Math.max(0, idx - cfg.autocorrWindow);
  const returns: number[] = [];
  for (let i = windowStart + 1; i <= idx; i++) {
    returns.push(h1[i].close - h1[i - 1].close);
  }
  const ac1 = autocorrelation(returns, 1);
  const ac2 = autocorrelation(returns, 2);

  // B. EMA slope (normalized by ATR)
  const slopeWindow = Math.min(cfg.emaSlopeLookback, ema20Arr.length - 1);
  const emaOld = ema20Arr[ema20Arr.length - 1 - slopeWindow];
  const emaSlope = (ema20 - emaOld) / slopeWindow;
  const emaSlopeNorm = emaSlope / atrVal;

  // C. Efficiency ratio
  const effStart = Math.max(0, idx - cfg.efficiencyWindow);
  const netMove = Math.abs(h1[idx].close - h1[effStart].close);
  let pathLength = 0;
  for (let i = effStart + 1; i <= idx; i++) {
    pathLength += Math.abs(h1[i].close - h1[i - 1].close);
  }
  const efficiency = pathLength > 0 ? netMove / pathLength : 0;

  // D. Sign persistence
  const spStart = Math.max(0, idx - cfg.signPersistenceWindow);
  const netDir = h1[idx].close > h1[spStart].close ? 1 : -1;
  let sameSign = 0;
  for (let i = spStart + 1; i <= idx; i++) {
    const dir = h1[i].close > h1[i - 1].close ? 1 : -1;
    if (dir === netDir) sameSign++;
  }
  const signPersistence = (idx - spStart) > 0 ? sameSign / (idx - spStart) : 0;

  // Composite regime score (simple average of normalized components)
  const acScore = Math.max(ac1, 0); // only positive autocorr matters for momentum
  const regimeScore = (acScore + efficiency + signPersistence) / 3;

  // Regime validity
  const regimeValid =
    (ac1 >= cfg.autocorrLag1Min || (efficiency >= cfg.efficiencyMin && signPersistence >= cfg.signPersistenceMin)) &&
    efficiency >= cfg.efficiencyMin * 0.7 &&
    Math.abs(emaSlopeNorm) >= cfg.emaSlopeMin;

  // Bias
  let bias: 'long' | 'short' | 'none' = 'none';
  if (regimeValid) {
    const extension = Math.abs(h1[idx].close - ema20) / atrVal;
    if (extension > cfg.extensionAtrMax) {
      bias = 'none'; // too extended
    } else if (ema20 > ema50 && emaSlopeNorm > 0) {
      bias = 'long';
    } else if (ema20 < ema50 && emaSlopeNorm < 0) {
      bias = 'short';
    }
  }

  return {
    barIndex: idx,
    timestamp: h1[idx].timestamp,
    autocorrLag1: ac1,
    autocorrLag2: ac2,
    emaSlopeNorm,
    efficiencyRatio: efficiency,
    signPersistence,
    regimeScore,
    regimeValid,
    bias,
    ema20, ema50, atr: atrVal,
  };
}

// ── Phase 2: Pullback + Trigger on LTF ──

function findPullbackAndTrigger(
  ltf: Candle[],
  ltfIdx: number,
  bias: 'long' | 'short',
  cfg: DiagConfig,
  regime: RegimeSnapshot,
): PullbackEvent | null {
  const lookAhead = 5;
  if (ltfIdx < 20 || ltfIdx + lookAhead >= ltf.length) return null;

  const ltfATR = calcATR(ltf, cfg.ltfAtrPeriod, ltfIdx);
  if (ltfATR === 0) return null;

  // Find recent impulse
  // Look back up to 20 bars for the start of the impulse
  let impulseStart = -1;
  let impulseEnd = -1;
  let bestImpulse = 0;

  for (let lookback = 5; lookback <= 20 && lookback <= ltfIdx; lookback++) {
    const start = ltfIdx - lookback;
    // Find the extreme in the impulse direction
    if (bias === 'long') {
      let swingLow = Infinity, swingHigh = -Infinity;
      let lowIdx = start, highIdx = start;
      for (let j = start; j <= ltfIdx; j++) {
        if (ltf[j].low < swingLow) { swingLow = ltf[j].low; lowIdx = j; }
        if (ltf[j].high > swingHigh) { swingHigh = ltf[j].high; highIdx = j; }
      }
      // Impulse: low came before high (upward move)
      if (lowIdx < highIdx) {
        const imp = swingHigh - swingLow;
        if (imp > bestImpulse) {
          bestImpulse = imp;
          impulseStart = lowIdx;
          impulseEnd = highIdx;
        }
      }
    } else {
      let swingLow = Infinity, swingHigh = -Infinity;
      let lowIdx = start, highIdx = start;
      for (let j = start; j <= ltfIdx; j++) {
        if (ltf[j].low < swingLow) { swingLow = ltf[j].low; lowIdx = j; }
        if (ltf[j].high > swingHigh) { swingHigh = ltf[j].high; highIdx = j; }
      }
      // Impulse: high came before low (downward move)
      if (highIdx < lowIdx) {
        const imp = swingHigh - swingLow;
        if (imp > bestImpulse) {
          bestImpulse = imp;
          impulseStart = highIdx;
          impulseEnd = lowIdx;
        }
      }
    }
  }

  if (impulseStart < 0 || bestImpulse < cfg.minImpulseAtrMult * ltfATR) return null;

  // Check pullback from impulse end to current bar
  const impulseHigh = bias === 'long'
    ? ltf[impulseEnd].high
    : ltf[impulseStart].high;
  const impulseLow = bias === 'long'
    ? ltf[impulseStart].low
    : ltf[impulseEnd].low;
  const impulseSize = impulseHigh - impulseLow;

  const pullbackBars = ltfIdx - impulseEnd;
  if (pullbackBars < cfg.minPullbackBars) return null;

  // Retrace depth
  let retraceDepth: number;
  if (bias === 'long') {
    const pullbackLow = Math.min(...ltf.slice(impulseEnd, ltfIdx + 1).map(c => c.low));
    retraceDepth = (impulseHigh - pullbackLow) / impulseSize;
  } else {
    const pullbackHigh = Math.max(...ltf.slice(impulseEnd, ltfIdx + 1).map(c => c.high));
    retraceDepth = (pullbackHigh - impulseLow) / impulseSize;
  }

  if (retraceDepth < cfg.minRetracePct || retraceDepth > cfg.maxRetracePct) return null;

  // Check continuation trigger on current bar
  const curr = ltf[ltfIdx];
  const prev = ltf[ltfIdx - 1];
  const bodyRatio = Math.abs(curr.close - curr.open) / (curr.high - curr.low + 0.01);

  let triggerFound = false;
  if (bias === 'long') {
    triggerFound = curr.close > curr.open && curr.close > prev.high && bodyRatio >= cfg.triggerBodyRatioMin;
  } else {
    triggerFound = curr.close < curr.open && curr.close < prev.low && bodyRatio >= cfg.triggerBodyRatioMin;
  }

  if (!triggerFound) return null;

  // Measure post-trigger excursion
  const entry = curr.close;
  const nextBars = ltf.slice(ltfIdx + 1, ltfIdx + 1 + lookAhead);
  let mfe1 = 0, mfe3 = 0, mfe5 = 0, mae1 = 0, mae3 = 0, mae5 = 0;

  for (let j = 0; j < nextBars.length; j++) {
    const fav = bias === 'long' ? nextBars[j].high - entry : entry - nextBars[j].low;
    const adv = bias === 'long' ? entry - nextBars[j].low : nextBars[j].high - entry;
    if (j < 1) { mfe1 = Math.max(mfe1, fav); mae1 = Math.max(mae1, adv); }
    if (j < 3) { mfe3 = Math.max(mfe3, fav); mae3 = Math.max(mae3, adv); }
    mfe5 = Math.max(mfe5, fav); mae5 = Math.max(mae5, adv);
  }

  // Continuation checks
  const nbCont = nextBars.length > 0 && (bias === 'long' ? nextBars[0].close > entry : nextBars[0].close < entry);
  const n3 = nextBars.slice(0, 3);
  const two3 = n3.filter(c => bias === 'long' ? c.close > entry : c.close < entry).length >= 2;
  const n5 = nextBars.slice(0, 5);
  const three5 = n5.filter(c => bias === 'long' ? c.close > entry : c.close < entry).length >= 3;

  // Structural invalidation
  const structInv = bias === 'long'
    ? Math.min(...ltf.slice(Math.max(0, ltfIdx - 3), ltfIdx + 1).map(c => c.low))
    : Math.max(...ltf.slice(Math.max(0, ltfIdx - 3), ltfIdx + 1).map(c => c.high));

  return {
    h1BarIndex: -1, // set by caller
    ltfBarIndex: ltfIdx,
    timestamp: curr.timestamp,
    bias,
    impulseSize: impulseSize / ltfATR,
    retraceDepth,
    pullbackBars,
    triggerFound: true,
    triggerBodyRatio: bodyRatio,
    entryPrice: entry,
    structuralInvalidation: structInv,
    mfe1, mfe3, mfe5, mae1, mae3, mae5,
    nextBarContinued: nbCont,
    twoOfThreeContinued: two3,
    threeOfFiveContinued: three5,
    regimeSnapshot: regime,
  };
}

// ── Main Scanner ──

function runDiagnostic(
  m1: Candle[],
  label: string,
  cfg: DiagConfig,
): DiagnosticResult {
  const m15 = aggregate(m1, 15);
  const h1 = aggregate(m1, 60);

  const result: DiagnosticResult = {
    label,
    totalH1Bars: h1.length,
    totalLTFBars: m15.length,
    regimeValidCount: 0, regimeValidPct: 0,
    regimeBullishCount: 0, regimeBearishCount: 0,
    avgAutocorrLag1WhenValid: 0, avgEfficiencyWhenValid: 0, avgSignPersistenceWhenValid: 0,
    pullbackCandidates: 0, triggersFound: 0, triggerRate: 0,
    nextBarContRate: 0, twoOfThreeContRate: 0, threeOfFiveContRate: 0,
    avgMFE3: 0, avgMAE3: 0, avgMFE5: 0, avgMAE5: 0,
    medMFE3: 0, medMAE3: 0, medMFE5: 0, medMAE5: 0,
    mfeExceedsMAE3Rate: 0, mfeExceedsMAE5Rate: 0,
    avgRR3: 0, avgRR5: 0,
    rejectedNoRegime: 0, rejectedNoBias: 0,
    rejectedNoPullback: 0, rejectedNoTrigger: 0,
  };

  // Phase 1: Scan H1 regime
  const regimes: RegimeSnapshot[] = [];
  let acSum = 0, effSum = 0, spSum = 0;

  for (let i = 0; i < h1.length; i++) {
    const r = detectRegime(h1, i, cfg);
    if (r) {
      regimes.push(r);
      if (r.regimeValid) {
        result.regimeValidCount++;
        acSum += r.autocorrLag1;
        effSum += r.efficiencyRatio;
        spSum += r.signPersistence;
        if (r.bias === 'long') result.regimeBullishCount++;
        else if (r.bias === 'short') result.regimeBearishCount++;
      }
    }
  }

  const evaluatedBars = regimes.length;
  result.regimeValidPct = evaluatedBars > 0 ? (result.regimeValidCount / evaluatedBars) * 100 : 0;
  if (result.regimeValidCount > 0) {
    result.avgAutocorrLag1WhenValid = acSum / result.regimeValidCount;
    result.avgEfficiencyWhenValid = effSum / result.regimeValidCount;
    result.avgSignPersistenceWhenValid = spSum / result.regimeValidCount;
  }

  // Phase 2: For each M15 bar, check if H1 regime is valid and look for pullback triggers
  const events: PullbackEvent[] = [];

  // Map M15 bars to H1 bars by index ratio
  // Each H1 bar = 4 M15 bars. M15 index / 4 = corresponding H1 bar (floored)
  // We use the H1 bar that is fully completed BEFORE the current M15 bar
  for (let ltfIdx = 20; ltfIdx < m15.length - 6; ltfIdx++) {
    // The H1 bar that just completed before this M15 bar
    // M15 index N corresponds to H1 index floor(N/4) - 1 (the previous completed H1)
    const h1Idx = Math.floor(ltfIdx / 4) - 1;
    if (h1Idx < 0 || h1Idx >= regimes.length) {
      result.rejectedNoRegime++;
      continue;
    }

    const regime = regimes[h1Idx];
    if (!regime || !regime.regimeValid) {
      result.rejectedNoRegime++;
      continue;
    }
    if (regime.bias === 'none') {
      result.rejectedNoBias++;
      continue;
    }

    result.pullbackCandidates++;

    const event = findPullbackAndTrigger(m15, ltfIdx, regime.bias, cfg, regime);
    if (!event) {
      result.rejectedNoPullback++;
      continue;
    }

    event.h1BarIndex = h1Idx;
    events.push(event);
    result.triggersFound++;
  }

  // Compute trigger stats
  const n = events.length;
  if (n > 0) {
    result.triggerRate = result.pullbackCandidates > 0 ? (n / result.pullbackCandidates) * 100 : 0;
    result.nextBarContRate = (events.filter(e => e.nextBarContinued).length / n) * 100;
    result.twoOfThreeContRate = (events.filter(e => e.twoOfThreeContinued).length / n) * 100;
    result.threeOfFiveContRate = (events.filter(e => e.threeOfFiveContinued).length / n) * 100;

    const mfe3s = events.map(e => e.mfe3);
    const mae3s = events.map(e => e.mae3);
    const mfe5s = events.map(e => e.mfe5);
    const mae5s = events.map(e => e.mae5);

    result.avgMFE3 = mfe3s.reduce((s, v) => s + v, 0) / n;
    result.avgMAE3 = mae3s.reduce((s, v) => s + v, 0) / n;
    result.avgMFE5 = mfe5s.reduce((s, v) => s + v, 0) / n;
    result.avgMAE5 = mae5s.reduce((s, v) => s + v, 0) / n;
    result.medMFE3 = median(mfe3s);
    result.medMAE3 = median(mae3s);
    result.medMFE5 = median(mfe5s);
    result.medMAE5 = median(mae5s);
    result.mfeExceedsMAE3Rate = (events.filter(e => e.mfe3 > e.mae3).length / n) * 100;
    result.mfeExceedsMAE5Rate = (events.filter(e => e.mfe5 > e.mae5).length / n) * 100;
    result.avgRR3 = result.avgMAE3 > 0 ? result.avgMFE3 / result.avgMAE3 : 0;
    result.avgRR5 = result.avgMAE5 > 0 ? result.avgMFE5 / result.avgMAE5 : 0;
  }

  return result;
}

// ── Output ──

function formatOutput(results: DiagnosticResult[]): string {
  const lines: string[] = [];
  lines.push('# V25 H1 Momentum Diagnostic Results');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('All thresholds are RESEARCH DEFAULTS — starting heuristics only.');
  lines.push('Signal-quality measurement only. No execution model applied.');
  lines.push('');

  // Phase 1 summary
  lines.push('## Phase 1: Regime Detection (H1)');
  lines.push('');
  lines.push('| Month | H1 Bars | Regime Valid | Valid% | Bullish | Bearish | AvgAC1 | AvgEff | AvgSignP |');
  lines.push('|-------|---------|-------------|--------|---------|---------|--------|--------|----------|');
  for (const r of results) {
    lines.push(
      `| ${r.label} | ${r.totalH1Bars} | ${r.regimeValidCount} | ${r.regimeValidPct.toFixed(1)}% | ` +
      `${r.regimeBullishCount} | ${r.regimeBearishCount} | ${r.avgAutocorrLag1WhenValid.toFixed(3)} | ` +
      `${r.avgEfficiencyWhenValid.toFixed(3)} | ${r.avgSignPersistenceWhenValid.toFixed(3)} |`
    );
  }

  // Phase 2 summary
  lines.push('');
  lines.push('## Phase 2: Pullback + Trigger Quality (M15)');
  lines.push('');
  lines.push('| Month | PBCandidates | Triggers | TrigRate% | 1barCont% | 2of3% | 3of5% | MFE>MAE3% | MFE>MAE5% | AvgRR3 | AvgRR5 |');
  lines.push('|-------|-------------|----------|-----------|-----------|-------|-------|-----------|-----------|--------|--------|');
  for (const r of results) {
    lines.push(
      `| ${r.label} | ${r.pullbackCandidates} | ${r.triggersFound} | ${r.triggerRate.toFixed(1)}% | ` +
      `${r.nextBarContRate.toFixed(0)}% | ${r.twoOfThreeContRate.toFixed(0)}% | ${r.threeOfFiveContRate.toFixed(0)}% | ` +
      `${r.mfeExceedsMAE3Rate.toFixed(0)}% | ${r.mfeExceedsMAE5Rate.toFixed(0)}% | ` +
      `${r.avgRR3.toFixed(2)} | ${r.avgRR5.toFixed(2)} |`
    );
  }

  // Excursion detail
  lines.push('');
  lines.push('## Excursion Detail (points)');
  lines.push('');
  lines.push('| Month | Triggers | AvgMFE3 | AvgMAE3 | MedMFE3 | MedMAE3 | AvgMFE5 | AvgMAE5 | MedMFE5 | MedMAE5 |');
  lines.push('|-------|----------|---------|---------|---------|---------|---------|---------|---------|---------|');
  for (const r of results) {
    lines.push(
      `| ${r.label} | ${r.triggersFound} | ${r.avgMFE3.toFixed(0)} | ${r.avgMAE3.toFixed(0)} | ` +
      `${r.medMFE3.toFixed(0)} | ${r.medMAE3.toFixed(0)} | ` +
      `${r.avgMFE5.toFixed(0)} | ${r.avgMAE5.toFixed(0)} | ` +
      `${r.medMFE5.toFixed(0)} | ${r.medMAE5.toFixed(0)} |`
    );
  }

  // Rejection breakdown
  lines.push('');
  lines.push('## Rejection Breakdown');
  lines.push('');
  lines.push('| Month | NoRegime | NoBias | NoPullback | NoTrigger | Triggers |');
  lines.push('|-------|----------|--------|------------|-----------|----------|');
  for (const r of results) {
    lines.push(
      `| ${r.label} | ${r.rejectedNoRegime} | ${r.rejectedNoBias} | ` +
      `${r.rejectedNoPullback} | ${r.rejectedNoTrigger} | ${r.triggersFound} |`
    );
  }

  // Accept/reject framework
  lines.push('');
  lines.push('## Research Criteria (provisional)');
  lines.push('');
  lines.push('Promising evidence:');
  lines.push('- Regime valid >15% of H1 bars across most months');
  lines.push('- Trigger 1-bar continuation >55% consistently');
  lines.push('- MFE>MAE rate >55% at 3 or 5 bar horizon');
  lines.push('- Results not dominated by one month');
  lines.push('');
  lines.push('Weak evidence:');
  lines.push('- Regime rarely valid (<10% of bars)');
  lines.push('- Continuation rates near 50% (random)');
  lines.push('- Highly variable month-to-month');
  lines.push('');
  lines.push('Reject early if:');
  lines.push('- Regime almost never valid across all months');
  lines.push('- Triggers too rare (<3 per month)');
  lines.push('- MFE/MAE ratio <1.0 consistently');
  lines.push('- Continuation rate <50% in largest samples');

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
    console.log('  npx tsx src/strategies/v25/V25H1MomentumDiagnostic.ts --all');
    console.log('  npx tsx src/strategies/v25/V25H1MomentumDiagnostic.ts --csv path.csv --label "Jun 2025"');
    process.exit(1);
  }

  const cfg = DEFAULT_CONFIG;
  const results: DiagnosticResult[] = [];

  for (let i = 0; i < csvPaths.length; i++) {
    const label = labels[i] || `Dataset ${i + 1}`;
    console.log(`Processing ${label}...`);

    const m1 = loadCSV(csvPaths[i]);
    console.log(`  M1: ${m1.length} → M15: ${Math.floor(m1.length / 15)} → H1: ${Math.floor(m1.length / 60)}`);

    const r = runDiagnostic(m1, label, cfg);
    results.push(r);

    console.log(`  Regime valid: ${r.regimeValidCount}/${r.totalH1Bars} H1 bars (${r.regimeValidPct.toFixed(1)}%)`);
    console.log(`  Bias: ${r.regimeBullishCount} bull, ${r.regimeBearishCount} bear`);
    console.log(`  Pullback candidates: ${r.pullbackCandidates}, Triggers: ${r.triggersFound}`);
    if (r.triggersFound > 0) {
      console.log(`  1-bar cont: ${r.nextBarContRate.toFixed(0)}%, MFE>MAE3: ${r.mfeExceedsMAE3Rate.toFixed(0)}%, RR3: ${r.avgRR3.toFixed(2)}`);
    }
    console.log('');
  }

  const output = formatOutput(results);
  const outPath = path.join(__dirname, '../../../data/v25_h1_momentum_diagnostic.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output);
  console.log(`Full results: ${outPath}`);
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
