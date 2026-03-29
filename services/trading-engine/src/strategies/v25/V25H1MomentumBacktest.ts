/**
 * V25 H1 Momentum Backtest — Standalone trade simulator
 *
 * Uses the SAME diagnostic logic that found 35 triggers in Feb 2026.
 * Adds trade simulation (SL/TP/slippage) on top.
 *
 * This bypasses the CandleReplayEngine entirely to avoid integration
 * issues with M1→H1 aggregation. Once results are validated, the
 * strategy can be integrated into the replay engine.
 *
 * Usage:
 *   npx tsx src/strategies/v25/V25H1MomentumBacktest.ts --all --risk 2
 *   npx tsx src/strategies/v25/V25H1MomentumBacktest.ts --csv path.csv --label "Jun 2025" --risk 2
 */

import * as fs from 'fs';
import * as path from 'path';

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Trade {
  timestamp: string;
  direction: 'long' | 'short';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  exitPrice: number;
  exitReason: 'sl' | 'tp' | 'time_stop';
  pnlR: number;          // in R units
  pnlUsd: number;
  barsHeld: number;
  regimeEfficiency: number;
  regimeSignPersistence: number;
  impulseAtr: number;
  retraceDepth: number;
}

// ── Config (same defaults as diagnostic + trade management) ──

interface BacktestConfig {
  // Regime (H1) — same as diagnostic
  autocorrWindow: number;
  autocorrLag1Min: number;
  emaFastPeriod: number;
  emaSlowPeriod: number;
  emaSlopeLookback: number;
  emaSlopeMin: number;
  efficiencyWindow: number;
  efficiencyMin: number;
  signPersistenceWindow: number;
  signPersistenceMin: number;
  extensionAtrMax: number;

  // Pullback (M15) — same as diagnostic
  ltfAtrPeriod: number;
  minImpulseAtrMult: number;
  minRetracePct: number;
  maxRetracePct: number;
  minPullbackBars: number;
  triggerBodyRatioMin: number;

  // Trade management
  slAtrBuffer: number;
  takeProfitR: number;
  timeStopBars: number;
  slippageTicks: number;

  // Risk
  initialBalance: number;
  riskPct: number;

  // Gating
  maxTradesPerDay: number;
  cooldownBars: number;     // M15 bars between trades
}

const DEFAULT_CONFIG: BacktestConfig = {
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
  slAtrBuffer: 0.3,
  takeProfitR: 2.0,
  timeStopBars: 20,
  slippageTicks: 2,
  initialBalance: 500,
  riskPct: 2,
  maxTradesPerDay: 3,
  cooldownBars: 4,   // 4 M15 bars = 1 hour
};

// ── Helpers (same as diagnostic) ──

function loadCSV(p: string): Candle[] {
  const lines = fs.readFileSync(p, 'utf-8').trim().split('\n');
  const hasH = lines[0].toLowerCase().includes('timestamp');
  return (hasH ? lines.slice(1) : lines).map(l => {
    const c = l.split(',');
    return { timestamp: c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +(c[5] || 0) };
  }).filter(c => !isNaN(c.open));
}

function aggregate(m1: Candle[], f: number): Candle[] {
  const r: Candle[] = [];
  for (let i = 0; i + f - 1 < m1.length; i += f) {
    const g = m1.slice(i, i + f);
    r.push({ timestamp: g[0].timestamp, open: g[0].open, high: Math.max(...g.map(c => c.high)), low: Math.min(...g.map(c => c.low)), close: g[g.length - 1].close, volume: g.reduce((s, c) => s + c.volume, 0) });
  }
  return r;
}

function calcEMA(v: number[], p: number): number[] {
  if (v.length < p) return [];
  const k = 2 / (p + 1); const e: number[] = [];
  let s = 0; for (let i = 0; i < p; i++) s += v[i]; e.push(s / p);
  for (let i = p; i < v.length; i++) e.push(v[i] * k + e[e.length - 1] * (1 - k));
  return e;
}

function calcATR(c: Candle[], p: number, end: number): number {
  if (end < p) return 0; let s = 0;
  for (let i = end - p + 1; i <= end; i++) { if (i < 1) continue; s += Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)); }
  return s / p;
}

function autocorr(ret: number[], lag: number): number {
  if (ret.length < lag + 2) return 0;
  const n = ret.length; const m = ret.reduce((s, v) => s + v, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { den += (ret[i] - m) ** 2; if (i >= lag) num += (ret[i] - m) * (ret[i - lag] - m); }
  return den === 0 ? 0 : num / den;
}

// ── Core Logic (identical to diagnostic) ──

function detectRegime(h1: Candle[], idx: number, cfg: BacktestConfig) {
  if (idx < cfg.emaSlowPeriod + cfg.autocorrWindow) return null;
  const closes = h1.slice(0, idx + 1).map(c => c.close);
  const e20 = calcEMA(closes, cfg.emaFastPeriod);
  const e50 = calcEMA(closes, cfg.emaSlowPeriod);
  if (e20.length < cfg.emaSlopeLookback + 1 || e50.length < 1) return null;
  const ema20 = e20[e20.length - 1]; const ema50 = e50[e50.length - 1];
  const atr = calcATR(h1, 14, idx); if (atr === 0) return null;

  const ws = Math.max(0, idx - cfg.autocorrWindow);
  const rets: number[] = []; for (let i = ws + 1; i <= idx; i++) rets.push(h1[i].close - h1[i - 1].close);
  const ac1 = autocorr(rets, 1);

  const sw = Math.min(cfg.emaSlopeLookback, e20.length - 1);
  const esn = ((ema20 - e20[e20.length - 1 - sw]) / sw) / atr;

  const es = Math.max(0, idx - cfg.efficiencyWindow);
  const net = Math.abs(h1[idx].close - h1[es].close);
  let pl = 0; for (let i = es + 1; i <= idx; i++) pl += Math.abs(h1[i].close - h1[i - 1].close);
  const eff = pl > 0 ? net / pl : 0;

  const sps = Math.max(0, idx - cfg.signPersistenceWindow);
  const nd = h1[idx].close > h1[sps].close ? 1 : -1;
  let ss = 0; for (let i = sps + 1; i <= idx; i++) if ((h1[i].close > h1[i - 1].close ? 1 : -1) === nd) ss++;
  const sp = (idx - sps) > 0 ? ss / (idx - sps) : 0;

  const valid = (ac1 >= cfg.autocorrLag1Min || (eff >= cfg.efficiencyMin && sp >= cfg.signPersistenceMin)) && eff >= cfg.efficiencyMin * 0.7 && Math.abs(esn) >= cfg.emaSlopeMin;

  let bias: 'long' | 'short' | 'none' = 'none';
  if (valid) {
    const ext = Math.abs(h1[idx].close - ema20) / atr;
    if (ext > cfg.extensionAtrMax) bias = 'none';
    else if (ema20 > ema50 && esn > 0) bias = 'long';
    else if (ema20 < ema50 && esn < 0) bias = 'short';
  }

  return { valid, bias, ac1, eff, sp, esn, ema20, ema50, atr };
}

function findTrigger(ltf: Candle[], idx: number, bias: 'long' | 'short', cfg: BacktestConfig) {
  if (idx < 20) return null;
  const atr = calcATR(ltf, cfg.ltfAtrPeriod, idx); if (atr === 0) return null;

  let impStart = -1, impEnd = -1, bestImp = 0;
  for (let lb = 5; lb <= 20 && lb <= idx; lb++) {
    const st = idx - lb; let slo = Infinity, shi = -Infinity, li = st, hi = st;
    for (let j = st; j <= idx; j++) { if (ltf[j].low < slo) { slo = ltf[j].low; li = j; } if (ltf[j].high > shi) { shi = ltf[j].high; hi = j; } }
    const ok = bias === 'long' ? li < hi : hi < li;
    if (ok && shi - slo > bestImp) { bestImp = shi - slo; impStart = bias === 'long' ? li : hi; impEnd = bias === 'long' ? hi : li; }
  }
  if (impStart < 0 || bestImp < cfg.minImpulseAtrMult * atr) return null;

  const iH = bias === 'long' ? ltf[impEnd].high : ltf[impStart].high;
  const iL = bias === 'long' ? ltf[impStart].low : ltf[impEnd].low;
  const iSize = iH - iL;
  const pbBars = idx - impEnd; if (pbBars < cfg.minPullbackBars) return null;

  let rd: number;
  if (bias === 'long') { const pbL = Math.min(...ltf.slice(impEnd, idx + 1).map(c => c.low)); rd = (iH - pbL) / iSize; }
  else { const pbH = Math.max(...ltf.slice(impEnd, idx + 1).map(c => c.high)); rd = (pbH - iL) / iSize; }
  if (rd < cfg.minRetracePct || rd > cfg.maxRetracePct) return null;

  const curr = ltf[idx]; const prev = ltf[idx - 1];
  const br = Math.abs(curr.close - curr.open) / (curr.high - curr.low + 0.01);
  let trig = false;
  if (bias === 'long') trig = curr.close > curr.open && curr.close > prev.high && br >= cfg.triggerBodyRatioMin;
  else trig = curr.close < curr.open && curr.close < prev.low && br >= cfg.triggerBodyRatioMin;
  if (!trig) return null;

  const si = bias === 'long'
    ? Math.min(...ltf.slice(Math.max(0, idx - 3), idx + 1).map(c => c.low))
    : Math.max(...ltf.slice(Math.max(0, idx - 3), idx + 1).map(c => c.high));

  return { entry: curr.close, structInv: si, impAtr: iSize / atr, rd, pbBars, br, atr };
}

// ── Backtest Engine ──

function runBacktest(m1: Candle[], label: string, cfg: BacktestConfig) {
  const m15 = aggregate(m1, 15);
  const h1 = aggregate(m1, 60);
  const trades: Trade[] = [];

  let balance = cfg.initialBalance;
  let peakBalance = balance;
  let maxDD = 0;
  let lastTradeBar = -999;
  let tradesToday: number[] = [];
  let consecutiveLosses = 0;

  for (let ltfIdx = 20; ltfIdx < m15.length - cfg.timeStopBars - 1; ltfIdx++) {
    // Map to H1
    const h1Idx = Math.floor(ltfIdx / 4) - 1;
    if (h1Idx < 0 || h1Idx >= h1.length) continue;

    // Regime
    const regime = detectRegime(h1, h1Idx, cfg);
    if (!regime || !regime.valid || regime.bias === 'none') continue;

    // Cooldown
    if (ltfIdx - lastTradeBar < cfg.cooldownBars) continue;

    // Daily trade limit (simple: max per 96 M15 bars = ~24h)
    tradesToday = tradesToday.filter(t => ltfIdx - t < 96);
    if (tradesToday.length >= cfg.maxTradesPerDay) continue;

    // Find trigger
    const sig = findTrigger(m15, ltfIdx, regime.bias, cfg);
    if (!sig) continue;

    // Calculate SL/TP
    const tickSize = sig.atr / 100;
    const slippage = cfg.slippageTicks * tickSize;
    const entry = regime.bias === 'long' ? sig.entry + slippage : sig.entry - slippage;
    const slDist = Math.abs(entry - sig.structInv) + cfg.slAtrBuffer * sig.atr;
    const tpDist = slDist * cfg.takeProfitR;

    const sl = regime.bias === 'long' ? entry - slDist : entry + slDist;
    const tp = regime.bias === 'long' ? entry + tpDist : entry - tpDist;

    if (slDist <= 0) continue;

    // Position size
    const riskUsd = balance * (cfg.riskPct / 100);

    // Simulate trade: walk forward through M15 bars
    let exitPrice = entry;
    let exitReason: 'sl' | 'tp' | 'time_stop' = 'time_stop';
    let barsHeld = 0;

    for (let j = ltfIdx + 1; j < Math.min(ltfIdx + 1 + cfg.timeStopBars, m15.length); j++) {
      barsHeld++;
      const bar = m15[j];

      if (regime.bias === 'long') {
        if (bar.low <= sl) { exitPrice = sl; exitReason = 'sl'; break; }
        if (bar.high >= tp) { exitPrice = tp; exitReason = 'tp'; break; }
      } else {
        if (bar.high >= sl) { exitPrice = sl; exitReason = 'sl'; break; }
        if (bar.low <= tp) { exitPrice = tp; exitReason = 'tp'; break; }
      }
    }

    if (exitReason === 'time_stop') {
      exitPrice = m15[Math.min(ltfIdx + cfg.timeStopBars, m15.length - 1)].close;
    }

    // Calculate PnL
    const pnlPoints = regime.bias === 'long' ? exitPrice - entry : entry - exitPrice;
    const pnlR = pnlPoints / slDist;
    const pnlUsd = pnlR * riskUsd;

    balance += pnlUsd;
    peakBalance = Math.max(peakBalance, balance);
    const dd = (peakBalance - balance) / peakBalance * 100;
    maxDD = Math.max(maxDD, dd);

    if (pnlR < 0) consecutiveLosses++;
    else consecutiveLosses = 0;

    trades.push({
      timestamp: m15[ltfIdx].timestamp,
      direction: regime.bias,
      entry, stopLoss: sl, takeProfit: tp, exitPrice, exitReason,
      pnlR, pnlUsd, barsHeld,
      regimeEfficiency: regime.eff,
      regimeSignPersistence: regime.sp,
      impulseAtr: sig.impAtr,
      retraceDepth: sig.rd,
    });

    lastTradeBar = ltfIdx;
    tradesToday.push(ltfIdx);

    // Skip ahead past the trade
    ltfIdx += barsHeld;
  }

  // Stats
  const n = trades.length;
  const wins = trades.filter(t => t.pnlR > 0);
  const losses = trades.filter(t => t.pnlR <= 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnlUsd, 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlUsd, 0));
  const longs = trades.filter(t => t.direction === 'long');
  const shorts = trades.filter(t => t.direction === 'short');

  return {
    label, trades: n,
    wins: wins.length, losses: losses.length,
    winRate: n > 0 ? (wins.length / n) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    totalPnl, maxDD,
    expectancyR: n > 0 ? trades.reduce((s, t) => s + t.pnlR, 0) / n : 0,
    avgBarsHeld: n > 0 ? trades.reduce((s, t) => s + t.barsHeld, 0) / n : 0,
    finalBalance: balance,
    returnPct: ((balance - cfg.initialBalance) / cfg.initialBalance) * 100,
    longTrades: longs.length,
    longWinRate: longs.length > 0 ? (longs.filter(t => t.pnlR > 0).length / longs.length) * 100 : 0,
    shortTrades: shorts.length,
    shortWinRate: shorts.length > 0 ? (shorts.filter(t => t.pnlR > 0).length / shorts.length) * 100 : 0,
    slExits: trades.filter(t => t.exitReason === 'sl').length,
    tpExits: trades.filter(t => t.exitReason === 'tp').length,
    timeExits: trades.filter(t => t.exitReason === 'time_stop').length,
    tradeDetails: trades,
  };
}

// ── CLI ──

async function main() {
  const args = process.argv.slice(2);
  const csvPaths: string[] = [];
  const labels: string[] = [];
  let riskPct = 2;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--csv' && args[i + 1]) csvPaths.push(args[++i]);
    else if (args[i] === '--label' && args[i + 1]) labels.push(args[++i]);
    else if (args[i] === '--risk' && args[i + 1]) riskPct = +args[++i];
    else if (args[i] === '--all') {
      const dir = path.join(__dirname, '../../../data/cache');
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir).filter(f => f.startsWith('V25_M1_') && f.endsWith('.csv')).sort().forEach(f => {
          csvPaths.push(path.join(dir, f));
          const m = f.match(/V25_M1_(\d{4})-(\d{2})/);
          if (m) { const ms = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; labels.push(`${ms[+m[2]]} ${m[1]}`); }
          else labels.push(f);
        });
      }
    }
  }

  if (!csvPaths.length) {
    console.log('Usage: npx tsx src/strategies/v25/V25H1MomentumBacktest.ts --all --risk 2');
    process.exit(1);
  }

  const cfg = { ...DEFAULT_CONFIG, riskPct };
  console.log(`V25 H1 Momentum Backtest — $${cfg.initialBalance} balance, ${cfg.riskPct}% risk, ${cfg.slippageTicks}-tick slippage, TP=${cfg.takeProfitR}R`);
  console.log('All thresholds are RESEARCH DEFAULTS. Not optimized.\n');

  const allResults: any[] = [];

  for (let i = 0; i < csvPaths.length; i++) {
    const label = labels[i] || `Dataset ${i + 1}`;
    const m1 = loadCSV(csvPaths[i]);
    const result = runBacktest(m1, label, cfg);
    allResults.push(result);

    console.log(`${label}: ${result.trades} trades | WR: ${result.winRate.toFixed(0)}% | PF: ${result.profitFactor.toFixed(2)} | Return: ${result.returnPct >= 0 ? '+' : ''}${result.returnPct.toFixed(1)}% | DD: ${result.maxDD.toFixed(1)}% | Final: $${result.finalBalance.toFixed(2)} | L:${result.longTrades} S:${result.shortTrades} | SL:${result.slExits} TP:${result.tpExits} TS:${result.timeExits}`);
  }

  // Pooled summary
  const totalTrades = allResults.reduce((s, r) => s + r.trades, 0);
  const totalWins = allResults.reduce((s, r) => s + r.wins, 0);
  const totalPnl = allResults.reduce((s, r) => s + r.totalPnl, 0);

  console.log('\n=== POOLED SUMMARY ===');
  console.log(`Total trades: ${totalTrades}`);
  console.log(`Win rate: ${totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : 0}%`);
  console.log(`Total PnL: $${totalPnl.toFixed(2)}`);
  console.log(`Profitable months: ${allResults.filter(r => r.totalPnl > 0).length}/${allResults.length}`);

  // Compounded equity
  let equity = cfg.initialBalance;
  console.log('\n=== COMPOUNDED EQUITY ===');
  for (const r of allResults) {
    const ret = r.returnPct / 100;
    equity *= (1 + ret);
    console.log(`${r.label}: $${equity.toFixed(2)}`);
  }
  console.log(`\n$${cfg.initialBalance} → $${equity.toFixed(2)} (${((equity / cfg.initialBalance - 1) * 100).toFixed(1)}%)`);
}

main().catch(e => { console.error(e); process.exit(1); });
