import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export interface Trade {
  id: number;
  date: string;
  time: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  exit: number;
  sl: number;
  tp: number;
  volume: number;
  riskDollar: number;
  pnl: number;
  result: 'WIN' | 'LOSS';
  balance: number;
  // Computed fields
  rr: number;
  pips: number;
  dayOfWeek: string;
  hour: number;
  month: string;
  holdingTimeMins: number | null;
}

export interface JournalStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  avgRR: number;
  largestWin: number;
  largestLoss: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  startBalance: number;
  endBalance: number;
  returnPercent: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  bestDay: { date: string; pnl: number };
  worstDay: { date: string; pnl: number };
}

export interface PerformanceByGroup {
  group: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
}

export interface StreakInfo {
  type: 'WIN' | 'LOSS';
  count: number;
  startDate: string;
  endDate: string;
  totalPnl: number;
}

function parseCsv(csvContent: string): Trade[] {
  const lines = csvContent.trim().split('\n');
  const trades: Trade[] = [];
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 13) continue;

    const date = cols[1];
    const time = cols[2];
    const entry = parseFloat(cols[4]);
    const exit = parseFloat(cols[5]);
    const sl = parseFloat(cols[6]);
    const direction = cols[3] as 'BUY' | 'SELL';

    // Calculate R:R
    const riskPips = Math.abs(entry - sl);
    const rewardPips = Math.abs(exit - entry);
    const rr = riskPips > 0 ? rewardPips / riskPips : 0;

    // Pips (for gold, 1 pip = 0.01)
    const pips = direction === 'BUY' ? (exit - entry) * 100 : (entry - exit) * 100;

    const dateObj = new Date(`${date}T${time}:00`);
    const dayOfWeek = dayNames[dateObj.getDay()];
    const hour = parseInt(time.split(':')[0], 10);
    const monthStr = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });

    trades.push({
      id: parseInt(cols[0], 10),
      date,
      time,
      direction,
      entry,
      exit,
      sl,
      tp: parseFloat(cols[7]),
      volume: parseFloat(cols[8]),
      riskDollar: parseFloat(cols[9]),
      pnl: parseFloat(cols[10]),
      result: cols[11] as 'WIN' | 'LOSS',
      balance: parseFloat(cols[12]),
      rr: Math.round(rr * 100) / 100,
      pips: Math.round(pips) / 100,
      dayOfWeek,
      hour,
      month: monthStr,
      holdingTimeMins: null,
    });
  }

  return trades;
}

function computeStats(trades: Trade[]): JournalStats {
  const wins = trades.filter(t => t.result === 'WIN');
  const losses = trades.filter(t => t.result === 'LOSS');
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  // Consecutive streaks
  let maxConsWins = 0, maxConsLosses = 0, curWins = 0, curLosses = 0;
  for (const t of trades) {
    if (t.result === 'WIN') { curWins++; curLosses = 0; maxConsWins = Math.max(maxConsWins, curWins); }
    else { curLosses++; curWins = 0; maxConsLosses = Math.max(maxConsLosses, curLosses); }
  }

  // Max drawdown from equity curve
  let peak = trades[0]?.balance ?? 100;
  let maxDD = 0, maxDDPct = 0;
  const startBal = 100;
  for (const t of trades) {
    if (t.balance > peak) peak = t.balance;
    const dd = peak - t.balance;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
    if (ddPct > maxDDPct) maxDDPct = ddPct;
  }

  // Best/worst day
  const dayPnl = new Map<string, number>();
  for (const t of trades) {
    dayPnl.set(t.date, (dayPnl.get(t.date) ?? 0) + t.pnl);
  }
  let bestDay = { date: '', pnl: -Infinity };
  let worstDay = { date: '', pnl: Infinity };
  for (const [date, pnl] of dayPnl) {
    if (pnl > bestDay.pnl) bestDay = { date, pnl: Math.round(pnl * 100) / 100 };
    if (pnl < worstDay.pnl) worstDay = { date, pnl: Math.round(pnl * 100) / 100 };
  }

  const endBal = trades[trades.length - 1]?.balance ?? startBal;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: Math.round((wins.length / trades.length) * 10000) / 100,
    totalPnl: Math.round((endBal - startBal) * 100) / 100,
    profitFactor: grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : Infinity,
    avgWin: wins.length > 0 ? Math.round((grossProfit / wins.length) * 100) / 100 : 0,
    avgLoss: losses.length > 0 ? Math.round((grossLoss / losses.length) * 100) / 100 : 0,
    avgRR: Math.round((wins.length > 0 ? wins.reduce((s, t) => s + t.rr, 0) / wins.length : 0) * 100) / 100,
    largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.pnl)) : 0,
    largestLoss: losses.length > 0 ? Math.min(...losses.map(t => t.pnl)) : 0,
    maxConsecutiveWins: maxConsWins,
    maxConsecutiveLosses: maxConsLosses,
    startBalance: startBal,
    endBalance: Math.round(endBal * 100) / 100,
    returnPercent: Math.round(((endBal - startBal) / startBal) * 10000) / 100,
    maxDrawdown: Math.round(maxDD * 100) / 100,
    maxDrawdownPercent: Math.round(maxDDPct * 100) / 100,
    bestDay,
    worstDay,
  };
}

function groupPerformance(trades: Trade[], key: keyof Trade): PerformanceByGroup[] {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = String(t[key]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(t);
  }

  return Array.from(groups.entries()).map(([group, trades]) => {
    const wins = trades.filter(t => t.result === 'WIN');
    return {
      group,
      trades: trades.length,
      wins: wins.length,
      losses: trades.length - wins.length,
      winRate: Math.round((wins.length / trades.length) * 10000) / 100,
      totalPnl: Math.round(trades.reduce((s, t) => s + t.pnl, 0) * 100) / 100,
      avgPnl: Math.round((trades.reduce((s, t) => s + t.pnl, 0) / trades.length) * 100) / 100,
    };
  });
}

function computeStreaks(trades: Trade[]): StreakInfo[] {
  const streaks: StreakInfo[] = [];
  if (trades.length === 0) return streaks;

  let currentType = trades[0].result;
  let count = 1;
  let startIdx = 0;
  let totalPnl = trades[0].pnl;

  for (let i = 1; i < trades.length; i++) {
    if (trades[i].result === currentType) {
      count++;
      totalPnl += trades[i].pnl;
    } else {
      if (count >= 3) {
        streaks.push({
          type: currentType,
          count,
          startDate: `${trades[startIdx].date} ${trades[startIdx].time}`,
          endDate: `${trades[i - 1].date} ${trades[i - 1].time}`,
          totalPnl: Math.round(totalPnl * 100) / 100,
        });
      }
      currentType = trades[i].result;
      count = 1;
      startIdx = i;
      totalPnl = trades[i].pnl;
    }
  }
  if (count >= 3) {
    streaks.push({
      type: currentType,
      count,
      startDate: `${trades[startIdx].date} ${trades[startIdx].time}`,
      endDate: `${trades[trades.length - 1].date} ${trades[trades.length - 1].time}`,
      totalPnl: Math.round(totalPnl * 100) / 100,
    });
  }

  return streaks.sort((a, b) => b.count - a.count);
}

export async function GET() {
  try {
    const csvPath = path.resolve(
      process.cwd(),
      '../trading-engine/backtests/FULL_JOURNAL_Sep25_Mar26.csv'
    );

    if (!fs.existsSync(csvPath)) {
      return NextResponse.json({ error: 'CSV file not found' }, { status: 404 });
    }

    const csv = fs.readFileSync(csvPath, 'utf-8');
    const trades = parseCsv(csv);
    const stats = computeStats(trades);
    const byDayOfWeek = groupPerformance(trades, 'dayOfWeek');
    const byHour = groupPerformance(trades, 'hour').sort((a, b) => parseInt(a.group) - parseInt(b.group));
    const byMonth = groupPerformance(trades, 'month');
    const byDirection = groupPerformance(trades, 'direction');
    const streaks = computeStreaks(trades);

    // Equity curve (balance after each trade)
    const equityCurve = trades.map(t => ({
      id: t.id,
      date: t.date,
      time: t.time,
      balance: t.balance,
      pnl: t.pnl,
      result: t.result,
    }));

    // Daily PnL for calendar heatmap
    const dailyPnl = new Map<string, { pnl: number; trades: number; wins: number }>();
    for (const t of trades) {
      const existing = dailyPnl.get(t.date) ?? { pnl: 0, trades: 0, wins: 0 };
      existing.pnl += t.pnl;
      existing.trades++;
      if (t.result === 'WIN') existing.wins++;
      dailyPnl.set(t.date, existing);
    }

    return NextResponse.json({
      trades,
      stats,
      byDayOfWeek,
      byHour,
      byMonth,
      byDirection,
      streaks,
      equityCurve,
      dailyPnl: Array.from(dailyPnl.entries()).map(([date, data]) => ({
        date,
        pnl: Math.round(data.pnl * 100) / 100,
        trades: data.trades,
        wins: data.wins,
      })),
    });
  } catch (error) {
    console.error('Journal API error:', error);
    return NextResponse.json({ error: 'Failed to load journal data' }, { status: 500 });
  }
}
