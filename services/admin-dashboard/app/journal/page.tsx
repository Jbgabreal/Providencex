'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';

interface Trade {
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
  rr: number;
  pips: number;
  dayOfWeek: string;
  hour: number;
  month: string;
}

interface JournalStats {
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

interface PerformanceByGroup {
  group: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgPnl: number;
}

interface StreakInfo {
  type: 'WIN' | 'LOSS';
  count: number;
  startDate: string;
  endDate: string;
  totalPnl: number;
}

interface DailyPnl {
  date: string;
  pnl: number;
  trades: number;
  wins: number;
}

interface JournalData {
  trades: Trade[];
  stats: JournalStats;
  byDayOfWeek: PerformanceByGroup[];
  byHour: PerformanceByGroup[];
  byMonth: PerformanceByGroup[];
  byDirection: PerformanceByGroup[];
  streaks: StreakInfo[];
  equityCurve: Array<{ id: number; date: string; time: string; balance: number; pnl: number; result: string }>;
  dailyPnl: DailyPnl[];
}

interface TradeNote {
  entryAnalysis: string;
  postTradeReview: string;
  tags: string[];
  rating: number | null;
  updatedAt: string;
}

type TradeNotes = Record<string, TradeNote>;

type TabKey = 'trades' | 'analytics' | 'streaks' | 'calendar';

const AVAILABLE_TAGS = [
  'A+ Setup', 'Overtraded', 'News Event', 'Choppy Market', 'Clean Entry',
  'Late Entry', 'Early Exit', 'Perfect Exit', 'Re-entry', 'Session Open',
  'Trend Trade', 'Counter-Trend', 'OB Respected', 'FVG Entry', 'Liquidity Grab',
];

function getSession(hour: number): string {
  if (hour >= 0 && hour < 8) return 'Asian';
  if (hour >= 8 && hour < 13) return 'London';
  if (hour >= 13 && hour < 17) return 'New York';
  return 'Off-hours';
}

function generateAutoAnalysis(trade: Trade, allTrades: Trade[]): string {
  const session = getSession(trade.hour);
  const riskPips = Math.abs(trade.entry - trade.sl);
  const rewardPips = Math.abs(trade.tp - trade.entry);
  const plannedRR = riskPips > 0 ? (rewardPips / riskPips).toFixed(1) : '?';
  const prevBal = trade.id === 1 ? 100 : allTrades[trade.id - 2]?.balance ?? 100;
  const riskPct = ((trade.riskDollar / prevBal) * 100).toFixed(2);

  const idx = allTrades.findIndex(t => t.id === trade.id);
  const prev = idx > 0 ? allTrades[idx - 1] : null;
  const isReentry = prev && prev.date === trade.date && prev.direction === trade.direction && prev.result === 'LOSS';
  const sameSetup = allTrades.filter(t => t.date === trade.date && t.direction === trade.direction && t.tp === trade.tp);
  const entryNum = sameSetup.findIndex(t => t.id === trade.id) + 1;

  // Count consecutive losses before this trade on same day
  let consLossesBefore = 0;
  for (let i = idx - 1; i >= 0; i--) {
    if (allTrades[i].date !== trade.date || allTrades[i].direction !== trade.direction) break;
    if (allTrades[i].result === 'LOSS') consLossesBefore++;
    else break;
  }

  // Determine OB zone type from SL placement
  const slDistance = Math.abs(trade.entry - trade.sl);
  const slTight = slDistance < 3; // Less than $3 for gold
  const obZone = trade.direction === 'BUY'
    ? `OB zone: ${trade.sl.toFixed(2)} - ${trade.entry.toFixed(2)} (${slTight ? 'tight' : 'wide'} SL)`
    : `OB zone: ${trade.entry.toFixed(2)} - ${trade.sl.toFixed(2)} (${slTight ? 'tight' : 'wide'} SL)`;

  const lines: string[] = [];
  lines.push(`STRATEGY: ICT/SMC Automated Entry`);
  lines.push(`SESSION: ${session} (${trade.time} UTC) | ${trade.dayOfWeek}`);
  lines.push(``);
  lines.push(`MULTI-TIMEFRAME ANALYSIS:`);
  lines.push(`  H4 Bias: ${trade.direction === 'BUY' ? 'Bullish' : 'Bearish'} — LuxAlgo swing structure (len=5)`);
  lines.push(`  M15: MSB (Market Structure Break) detected + Order Block identified`);
  lines.push(`  M1: Entry confirmation via engulfing/displacement candle`);
  lines.push(``);
  lines.push(`ENTRY DETAILS:`);
  lines.push(`  ${trade.direction} @ ${trade.entry.toFixed(2)} | Vol: ${trade.volume}`);
  lines.push(`  SL: ${trade.sl.toFixed(2)} | TP: ${trade.tp.toFixed(2)} | Planned R:R: ${plannedRR}x`);
  lines.push(`  ${obZone}`);
  lines.push(`  Risk: $${trade.riskDollar.toFixed(2)} (${riskPct}% of $${prevBal.toFixed(2)} balance)`);

  if (isReentry || entryNum > 1) {
    lines.push(``);
    lines.push(`RE-ENTRY CONTEXT:`);
    if (entryNum > 1) {
      lines.push(`  Entry #${entryNum} of ${sameSetup.length} into this zone (TP: ${trade.tp.toFixed(2)})`);
    }
    if (consLossesBefore > 0) {
      lines.push(`  ${consLossesBefore} consecutive loss(es) before this entry`);
      if (consLossesBefore >= 3) {
        lines.push(`  WARNING: Over-trading — 3+ losses into same zone`);
      }
    }
  }

  return lines.join('\n');
}

function generateAutoReview(trade: Trade, allTrades: Trade[]): string {
  const isWin = trade.result === 'WIN';
  const riskPips = Math.abs(trade.entry - trade.sl);
  const rewardPips = Math.abs(trade.tp - trade.entry);
  const actualPips = Math.abs(trade.exit - trade.entry);
  const idx = allTrades.findIndex(t => t.id === trade.id);

  const lines: string[] = [];
  lines.push(`OUTCOME: ${trade.result}`);
  lines.push(``);

  if (isWin) {
    const hitTP = Math.abs(trade.exit - trade.tp) < 0.5;
    if (hitTP) {
      lines.push(`EXECUTION: TP hit cleanly at ${trade.exit.toFixed(2)}`);
      lines.push(`Full M15 swing target reached — OB held and price displaced to target.`);
    } else {
      const capturedPct = rewardPips > 0 ? ((actualPips / rewardPips) * 100).toFixed(0) : '?';
      lines.push(`EXECUTION: Partial exit at ${trade.exit.toFixed(2)} (captured ${capturedPct}% of move)`);
    }
    lines.push(`Profit: +$${trade.pnl.toFixed(2)} | Actual R:R: ${trade.rr}x`);
  } else {
    const hitSL = Math.abs(trade.exit - trade.sl) < 0.5;
    if (hitSL) {
      lines.push(`EXECUTION: SL hit at ${trade.exit.toFixed(2)}`);
      lines.push(`Price reversed through the Order Block — OB was invalidated.`);
      if (riskPips < 2) {
        lines.push(`Note: SL was very tight (${riskPips.toFixed(2)} pips). Consider wider buffer.`);
      }
    } else {
      lines.push(`EXECUTION: Exited at ${trade.exit.toFixed(2)} (neither SL nor TP hit)`);
    }
    lines.push(`Loss: $${trade.pnl.toFixed(2)}`);
  }

  // What happened after?
  const laterTrades = allTrades.filter(t => t.date === trade.date && t.direction === trade.direction && t.tp === trade.tp && t.id > trade.id);
  const eventualWin = laterTrades.find(t => t.result === 'WIN');

  lines.push(``);
  lines.push(`POST-TRADE CONTEXT:`);

  if (!isWin && eventualWin) {
    lines.push(`Price eventually reached TP via re-entry #${eventualWin.id} — the zone was valid, entry timing was off.`);
  } else if (!isWin && laterTrades.length > 0 && !eventualWin) {
    lines.push(`${laterTrades.length} more re-entries attempted, none reached TP — zone was fully invalidated.`);
  }

  // Check next trade
  if (idx < allTrades.length - 1) {
    const next = allTrades[idx + 1];
    if (next.date === trade.date && next.direction === trade.direction) {
      lines.push(`Next action: Re-entered ${next.direction} at ${next.entry.toFixed(2)} (${next.time}) — ${next.result}`);
    } else if (next.date !== trade.date) {
      lines.push(`No more trades this day.`);
    }
  }

  // Balance impact
  const prevBal = trade.id === 1 ? 100 : allTrades[trade.id - 2]?.balance ?? 100;
  const balChange = ((trade.pnl / prevBal) * 100).toFixed(2);
  lines.push(`Balance impact: ${trade.pnl >= 0 ? '+' : ''}${balChange}% ($${prevBal.toFixed(2)} -> $${trade.balance.toFixed(2)})`);

  return lines.join('\n');
}

// ── Stat Card ──
function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 hover:shadow-md transition-shadow">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color || 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

// ── Trade Card ──
function TradeCard({ trade, note, onClick }: { trade: Trade; note?: TradeNote; onClick: () => void }) {
  const isWin = trade.result === 'WIN';
  const hasNotes = note && (note.entryAnalysis || note.postTradeReview);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left bg-white rounded-xl border-l-4 shadow-sm hover:shadow-md transition-all p-4 ${
        isWin ? 'border-l-emerald-500' : 'border-l-red-400'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            isWin ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
          }`}>
            {trade.result}
          </span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            trade.direction === 'BUY' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'
          }`}>
            {trade.direction}
          </span>
          <span className="text-xs text-gray-400">#{trade.id}</span>
          {hasNotes && (
            <span className="text-xs text-indigo-500" title="Has notes">&#9998;</span>
          )}
          {note?.rating && (
            <span className="text-xs text-amber-500">{'★'.repeat(note.rating)}</span>
          )}
        </div>
        <span className={`text-lg font-bold ${isWin ? 'text-emerald-600' : 'text-red-500'}`}>
          {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
        </span>
      </div>
      {/* Tags */}
      {note?.tags && note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {note.tags.map(tag => (
            <span key={tag} className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 text-xs text-gray-500">
        <div>
          <span className="text-gray-400">Date</span>
          <p className="font-medium text-gray-700">{trade.date}</p>
        </div>
        <div>
          <span className="text-gray-400">Time</span>
          <p className="font-medium text-gray-700">{trade.time}</p>
        </div>
        <div>
          <span className="text-gray-400">R:R</span>
          <p className="font-medium text-gray-700">{trade.rr}x</p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 text-xs text-gray-500 mt-2">
        <div>
          <span className="text-gray-400">Entry</span>
          <p className="font-medium text-gray-700">{trade.entry.toFixed(2)}</p>
        </div>
        <div>
          <span className="text-gray-400">Exit</span>
          <p className="font-medium text-gray-700">{trade.exit.toFixed(2)}</p>
        </div>
        <div>
          <span className="text-gray-400">SL</span>
          <p className="font-medium text-gray-700">{trade.sl.toFixed(2)}</p>
        </div>
        <div>
          <span className="text-gray-400">Vol</span>
          <p className="font-medium text-gray-700">{trade.volume}</p>
        </div>
      </div>
    </button>
  );
}

// ── Screenshot Upload Component ──
function ScreenshotSlot({ tradeId, type, label, existingUrl, onUploaded }: {
  tradeId: number; type: 'setup' | 'result'; label: string;
  existingUrl: string | null; onUploaded: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(existingUrl);
  const [expanded, setExpanded] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('tradeId', String(tradeId));
    formData.append('type', type);
    formData.append('file', file);
    const res = await fetch('/api/journal/screenshots', { method: 'POST', body: formData });
    const result = await res.json();
    if (result.success) {
      setPreview(result.url);
      onUploaded();
    }
    setUploading(false);
  };

  const handleDelete = async () => {
    await fetch('/api/journal/screenshots', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tradeId: String(tradeId), type }),
    });
    setPreview(null);
    onUploaded();
  };

  return (
    <div className="flex-1">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{label}</p>
      {preview ? (
        <div className="relative group">
          <img
            src={preview}
            alt={label}
            className="w-full rounded-lg border border-gray-200 cursor-pointer hover:border-indigo-300 transition-colors"
            onClick={() => setExpanded(true)}
          />
          <button
            onClick={handleDelete}
            className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
          >
            &times;
          </button>
          {expanded && (
            <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 cursor-pointer" onClick={() => setExpanded(false)}>
              <img src={preview} alt={label} className="max-w-full max-h-full rounded-lg" />
            </div>
          )}
        </div>
      ) : (
        <label className={`flex flex-col items-center justify-center h-32 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
          uploading ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300 hover:bg-gray-50'
        }`}>
          {uploading ? (
            <div className="w-5 h-5 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          ) : (
            <>
              <svg className="w-8 h-8 text-gray-300 mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-xs text-gray-400">Click to upload</span>
              <span className="text-[10px] text-gray-300">PNG, JPG, WebP</span>
            </>
          )}
          <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        </label>
      )}
    </div>
  );
}

// ── Trade Detail Modal ──
function TradeModal({ trade, allTrades, note, onClose, onSave }: {
  trade: Trade;
  allTrades: Trade[];
  note?: TradeNote;
  onClose: () => void;
  onSave: (tradeId: number, note: Omit<TradeNote, 'updatedAt'>) => void;
}) {
  const isWin = trade.result === 'WIN';
  const riskPips = Math.abs(trade.entry - trade.sl);
  const rewardPips = Math.abs(trade.tp - trade.entry);
  const plannedRR = riskPips > 0 ? (rewardPips / riskPips).toFixed(2) : 'N/A';

  const autoEntry = generateAutoAnalysis(trade, allTrades);
  const autoReview = generateAutoReview(trade, allTrades);

  const [entryAnalysis, setEntryAnalysis] = useState(note?.entryAnalysis || autoEntry);
  const [postTradeReview, setPostTradeReview] = useState(note?.postTradeReview || autoReview);
  const [tags, setTags] = useState<string[]>(note?.tags || []);
  const [rating, setRating] = useState<number | null>(note?.rating ?? null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [screenshots, setScreenshots] = useState<{ setup: string | null; result: string | null }>({ setup: null, result: null });

  // Load screenshots
  useEffect(() => {
    fetch(`/api/journal/screenshots?tradeId=${trade.id}`)
      .then(r => r.json())
      .then(d => setScreenshots(d.screenshots || { setup: null, result: null }))
      .catch(() => {});
  }, [trade.id]);

  const refreshScreenshots = () => {
    fetch(`/api/journal/screenshots?tradeId=${trade.id}`)
      .then(r => r.json())
      .then(d => setScreenshots(d.screenshots || { setup: null, result: null }))
      .catch(() => {});
  };

  const toggleTag = (tag: string) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(trade.id, { entryAnalysis, postTradeReview, tags, rating });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-bold text-gray-900">Trade #{trade.id}</h3>
            <span className={`text-sm font-bold px-3 py-1 rounded-full ${
              isWin ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
            }`}>
              {trade.result}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              trade.direction === 'BUY' ? 'bg-blue-50 text-blue-700' : 'bg-orange-50 text-orange-700'
            }`}>
              {trade.direction}
            </span>
            <span className="text-xs text-gray-400">{getSession(trade.hour)} Session</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {/* PnL Banner */}
        <div className={`text-center py-3 rounded-xl mb-5 ${isWin ? 'bg-emerald-50' : 'bg-red-50'}`}>
          <p className={`text-3xl font-bold ${isWin ? 'text-emerald-600' : 'text-red-500'}`}>
            {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
          </p>
          <p className="text-xs text-gray-400 mt-1">Balance: ${trade.balance.toFixed(2)} | R:R: {trade.rr}x</p>
        </div>

        {/* Trade Details Grid */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            ['Date', `${trade.date} ${trade.time}`],
            ['Direction', trade.direction],
            ['Day', trade.dayOfWeek],
            ['Session', getSession(trade.hour)],
            ['Entry', trade.entry.toFixed(2)],
            ['Exit', trade.exit.toFixed(2)],
            ['Stop Loss', trade.sl.toFixed(2)],
            ['Take Profit', trade.tp.toFixed(2)],
            ['Volume', trade.volume.toString()],
            ['Risk $', `$${trade.riskDollar.toFixed(2)}`],
            ['Actual R:R', `${trade.rr}x`],
            ['Planned R:R', `${plannedRR}x`],
          ].map(([label, value]) => (
            <div key={label} className="py-1">
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</span>
              <p className="text-sm font-semibold text-gray-700">{value}</p>
            </div>
          ))}
        </div>

        {/* ── SCREENSHOTS ── */}
        <div className="mb-5 p-4 bg-gray-50 rounded-xl">
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Chart Screenshots</h4>
          <div className="flex gap-4">
            <ScreenshotSlot
              tradeId={trade.id}
              type="setup"
              label="Before Trade (Setup)"
              existingUrl={screenshots.setup}
              onUploaded={refreshScreenshots}
            />
            <ScreenshotSlot
              tradeId={trade.id}
              type="result"
              label="After Trade (Result)"
              existingUrl={screenshots.result}
              onUploaded={refreshScreenshots}
            />
          </div>
        </div>

        {/* Quality Rating */}
        <div className="mb-5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-2">Trade Quality</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(star => (
              <button
                key={star}
                onClick={() => setRating(rating === star ? null : star)}
                className={`text-2xl transition-colors ${
                  rating !== null && star <= rating ? 'text-amber-400' : 'text-gray-200 hover:text-amber-200'
                }`}
              >
                ★
              </button>
            ))}
            {rating && <span className="text-xs text-gray-400 self-center ml-2">{
              ['', 'Poor', 'Below Avg', 'Average', 'Good', 'A+ Setup'][rating]
            }</span>}
          </div>
        </div>

        {/* Entry Analysis */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Entry Analysis — Why did we enter?</label>
            <button onClick={() => setEntryAnalysis(autoEntry)} className="text-[10px] text-indigo-500 hover:text-indigo-700">
              Reset to auto
            </button>
          </div>
          <textarea
            value={entryAnalysis}
            onChange={e => setEntryAnalysis(e.target.value)}
            rows={8}
            className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 resize-y text-gray-700 font-mono text-xs leading-relaxed"
          />
        </div>

        {/* Post-Trade Review */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Post-Trade Review — What happened?</label>
            <button onClick={() => setPostTradeReview(autoReview)} className="text-[10px] text-indigo-500 hover:text-indigo-700">
              Reset to auto
            </button>
          </div>
          <textarea
            value={postTradeReview}
            onChange={e => setPostTradeReview(e.target.value)}
            rows={8}
            className="w-full text-sm border border-gray-200 rounded-lg p-3 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 resize-y text-gray-700 font-mono text-xs leading-relaxed"
          />
        </div>

        {/* Tags */}
        <div className="mb-5">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider block mb-2">Tags</label>
          <div className="flex flex-wrap gap-2">
            {AVAILABLE_TAGS.map(tag => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  tags.includes(tag)
                    ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                    : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
          <div className="text-xs text-gray-400">
            {note?.updatedAt && `Last saved: ${new Date(note.updatedAt).toLocaleString()}`}
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className={`px-6 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              saved
                ? 'bg-emerald-500 text-white'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
            } disabled:opacity-50`}
          >
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Notes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Performance Table ──
function PerfTable({ data, groupLabel }: { data: PerformanceByGroup[]; groupLabel: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase">{groupLabel}</th>
            <th className="text-right py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Trades</th>
            <th className="text-right py-3 px-3 text-xs font-semibold text-gray-400 uppercase">W/L</th>
            <th className="text-right py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Win Rate</th>
            <th className="text-right py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Total PnL</th>
            <th className="text-right py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Avg PnL</th>
          </tr>
        </thead>
        <tbody>
          {data.map(row => (
            <tr key={row.group} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
              <td className="py-3 px-3 font-medium text-gray-700">{row.group}</td>
              <td className="py-3 px-3 text-right text-gray-600">{row.trades}</td>
              <td className="py-3 px-3 text-right text-gray-600">{row.wins}/{row.losses}</td>
              <td className="py-3 px-3 text-right">
                <span className={`font-semibold ${row.winRate >= 50 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {row.winRate}%
                </span>
              </td>
              <td className={`py-3 px-3 text-right font-semibold ${row.totalPnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {row.totalPnl >= 0 ? '+' : ''}{row.totalPnl.toFixed(2)}
              </td>
              <td className={`py-3 px-3 text-right ${row.avgPnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {row.avgPnl >= 0 ? '+' : ''}{row.avgPnl.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Custom Tooltip for Charts ──
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg">
      <p className="font-medium">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
        </p>
      ))}
    </div>
  );
}

export default function JournalPage() {
  const [data, setData] = useState<JournalData | null>(null);
  const [notes, setNotes] = useState<TradeNotes>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('trades');
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

  // Filters
  const [filterResult, setFilterResult] = useState<'ALL' | 'WIN' | 'LOSS'>('ALL');
  const [filterDirection, setFilterDirection] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [filterMonth, setFilterMonth] = useState<string>('ALL');
  const [filterTag, setFilterTag] = useState<string>('ALL');
  const [filterRating, setFilterRating] = useState<string>('ALL');
  const [filterNotes, setFilterNotes] = useState<'ALL' | 'WITH' | 'WITHOUT'>('ALL');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
  const [filterPnlMin, setFilterPnlMin] = useState<string>('');
  const [filterPnlMax, setFilterPnlMax] = useState<string>('');
  const [sortBy, setSortBy] = useState<'date' | 'pnl' | 'rr'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Pagination
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  useEffect(() => {
    Promise.all([
      fetch('/api/journal').then(r => r.json()),
      fetch('/api/journal/notes').then(r => r.json()),
    ])
      .then(([journalData, notesData]) => {
        setData(journalData);
        setNotes(notesData.notes || {});
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  const saveNote = async (tradeId: number, note: Omit<TradeNote, 'updatedAt'>) => {
    const res = await fetch('/api/journal/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tradeId, ...note }),
    });
    const result = await res.json();
    if (result.success) {
      setNotes(prev => ({ ...prev, [String(tradeId)]: result.note }));
    }
  };

  const filteredTrades = useMemo(() => {
    if (!data) return [];
    let trades = [...data.trades];
    if (filterResult !== 'ALL') trades = trades.filter(t => t.result === filterResult);
    if (filterDirection !== 'ALL') trades = trades.filter(t => t.direction === filterDirection);
    if (filterMonth !== 'ALL') trades = trades.filter(t => t.month === filterMonth);
    if (filterTag !== 'ALL') trades = trades.filter(t => notes[String(t.id)]?.tags?.includes(filterTag));
    if (filterRating !== 'ALL') trades = trades.filter(t => notes[String(t.id)]?.rating === parseInt(filterRating));
    if (filterNotes === 'WITH') trades = trades.filter(t => notes[String(t.id)]?.entryAnalysis || notes[String(t.id)]?.postTradeReview);
    if (filterNotes === 'WITHOUT') trades = trades.filter(t => !notes[String(t.id)]?.entryAnalysis && !notes[String(t.id)]?.postTradeReview);
    if (filterDateFrom) trades = trades.filter(t => t.date >= filterDateFrom);
    if (filterDateTo) trades = trades.filter(t => t.date <= filterDateTo);
    if (filterPnlMin) trades = trades.filter(t => t.pnl >= parseFloat(filterPnlMin));
    if (filterPnlMax) trades = trades.filter(t => t.pnl <= parseFloat(filterPnlMax));

    trades.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date') cmp = a.id - b.id;
      else if (sortBy === 'pnl') cmp = a.pnl - b.pnl;
      else if (sortBy === 'rr') cmp = a.rr - b.rr;
      return sortDir === 'desc' ? -cmp : cmp;
    });

    return trades;
  }, [data, notes, filterResult, filterDirection, filterMonth, filterTag, filterRating, filterNotes, filterDateFrom, filterDateTo, filterPnlMin, filterPnlMax, sortBy, sortDir]);

  // Reset to page 1 when filters change
  useEffect(() => { setCurrentPage(1); }, [filterResult, filterDirection, filterMonth, filterTag, filterRating, filterNotes, filterDateFrom, filterDateTo, filterPnlMin, filterPnlMax, sortBy, sortDir, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredTrades.length / pageSize));
  const paginatedTrades = filteredTrades.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const months = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.trades.map(t => t.month))];
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading journal data...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-4 py-12 text-center">
        <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl inline-block">
          Failed to load journal: {error || 'Unknown error'}
        </div>
      </div>
    );
  }

  const { stats } = data;

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-12">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Trade Journal</h1>
        <p className="text-sm text-gray-500 mt-1">
          {data.trades[0]?.date} to {data.trades[data.trades.length - 1]?.date} &middot; {stats.totalTrades} trades
        </p>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard
          label="Total P&L"
          value={`$${stats.totalPnl.toLocaleString()}`}
          sub={`${stats.returnPercent.toLocaleString()}% return`}
          color={stats.totalPnl >= 0 ? 'text-emerald-600' : 'text-red-500'}
        />
        <StatCard
          label="Win Rate"
          value={`${stats.winRate}%`}
          sub={`${stats.wins}W / ${stats.losses}L`}
          color={stats.winRate >= 50 ? 'text-emerald-600' : 'text-amber-600'}
        />
        <StatCard
          label="Profit Factor"
          value={stats.profitFactor === Infinity ? 'Inf' : stats.profitFactor.toString()}
          sub={`Avg Win: $${stats.avgWin} | Avg Loss: $${stats.avgLoss}`}
          color={stats.profitFactor >= 1.5 ? 'text-emerald-600' : 'text-amber-600'}
        />
        <StatCard
          label="Avg R:R (wins)"
          value={`${stats.avgRR}x`}
          sub={`Best: $${stats.largestWin.toFixed(0)} | Worst: $${stats.largestLoss.toFixed(0)}`}
        />
        <StatCard
          label="Max Drawdown"
          value={`$${stats.maxDrawdown.toFixed(0)}`}
          sub={`${stats.maxDrawdownPercent.toFixed(1)}% from peak`}
          color="text-red-500"
        />
        <StatCard
          label="Balance"
          value={`$${stats.endBalance.toLocaleString()}`}
          sub={`Started at $${stats.startBalance}`}
          color="text-indigo-600"
        />
      </div>

      {/* Equity Curve */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Equity Curve</h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.equityCurve}>
              <defs>
                <linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="id"
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={v => `$${v}`}
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="balance"
                stroke="#6366f1"
                strokeWidth={2}
                fill="url(#balanceGrad)"
                name="Balance"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-6 w-fit">
        {([
          ['trades', 'Trades'],
          ['analytics', 'Analytics'],
          ['streaks', 'Streaks'],
          ['calendar', 'Daily P&L'],
        ] as [TabKey, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Trades Tab ── */}
      {activeTab === 'trades' && (
        <div>
          {/* Filters Row 1 - Dropdowns */}
          <div className="flex flex-wrap gap-3 mb-3">
            <select value={filterResult} onChange={e => setFilterResult(e.target.value as any)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400">
              <option value="ALL">All Results</option>
              <option value="WIN">Wins Only</option>
              <option value="LOSS">Losses Only</option>
            </select>
            <select value={filterDirection} onChange={e => setFilterDirection(e.target.value as any)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400">
              <option value="ALL">All Directions</option>
              <option value="BUY">Buy Only</option>
              <option value="SELL">Sell Only</option>
            </select>
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400">
              <option value="ALL">All Months</option>
              {months.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={filterTag} onChange={e => setFilterTag(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400">
              <option value="ALL">All Tags</option>
              {AVAILABLE_TAGS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={filterRating} onChange={e => setFilterRating(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400">
              <option value="ALL">All Ratings</option>
              <option value="5">★★★★★ A+ Setup</option>
              <option value="4">★★★★ Good</option>
              <option value="3">★★★ Average</option>
              <option value="2">★★ Below Avg</option>
              <option value="1">★ Poor</option>
            </select>
            <select value={filterNotes} onChange={e => setFilterNotes(e.target.value as any)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400">
              <option value="ALL">All Notes</option>
              <option value="WITH">With Notes</option>
              <option value="WITHOUT">Without Notes</option>
            </select>
            <select value={`${sortBy}-${sortDir}`}
              onChange={e => {
                const [by, dir] = e.target.value.split('-') as [typeof sortBy, typeof sortDir];
                setSortBy(by); setSortDir(dir);
              }}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400">
              <option value="date-desc">Newest First</option>
              <option value="date-asc">Oldest First</option>
              <option value="pnl-desc">Highest P&L</option>
              <option value="pnl-asc">Lowest P&L</option>
              <option value="rr-desc">Highest R:R</option>
              <option value="rr-asc">Lowest R:R</option>
            </select>
          </div>

          {/* Filters Row 2 - Date range + P&L range */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">From</span>
              <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" />
              <span className="text-xs text-gray-400">To</span>
              <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">P&L Min $</span>
              <input type="number" value={filterPnlMin} onChange={e => setFilterPnlMin(e.target.value)} placeholder="-100"
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 w-24 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" />
              <span className="text-xs text-gray-400">Max $</span>
              <input type="number" value={filterPnlMax} onChange={e => setFilterPnlMax(e.target.value)} placeholder="500"
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 w-24 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400" />
            </div>
            {(filterDateFrom || filterDateTo || filterPnlMin || filterPnlMax) && (
              <button onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); setFilterPnlMin(''); setFilterPnlMax(''); }}
                className="text-xs text-red-500 hover:text-red-700 underline">
                Clear range filters
              </button>
            )}
            <div className="ml-auto flex items-center gap-3">
              <select value={pageSize} onChange={e => setPageSize(parseInt(e.target.value))}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400">
                <option value="10">10 per page</option>
                <option value="25">25 per page</option>
                <option value="50">50 per page</option>
                <option value="100">100 per page</option>
              </select>
              <span className="text-sm text-gray-400">{filteredTrades.length} trades</span>
            </div>
          </div>

          {/* Trade Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginatedTrades.map(trade => (
              <TradeCard key={trade.id} trade={trade} note={notes[String(trade.id)]} onClick={() => setSelectedTrade(trade)} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">
                First
              </button>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">
                Prev
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
                .reduce<(number | 'gap')[]>((acc, p, i, arr) => {
                  if (i > 0 && p - (arr[i - 1]) > 1) acc.push('gap');
                  acc.push(p);
                  return acc;
                }, [])
                .map((item, i) =>
                  item === 'gap' ? (
                    <span key={`gap-${i}`} className="px-2 text-gray-300">...</span>
                  ) : (
                    <button key={item} onClick={() => setCurrentPage(item)}
                      className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                        currentPage === item
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                      }`}>
                      {item}
                    </button>
                  )
                )}
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">
                Next
              </button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">
                Last
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Analytics Tab ── */}
      {activeTab === 'analytics' && (
        <div className="space-y-8">
          {/* PnL Distribution */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">P&L Distribution</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.trades.map(t => ({ id: t.id, pnl: t.pnl, result: t.result }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="id" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={0} stroke="#e5e7eb" />
                  <Bar dataKey="pnl" name="P&L" radius={[2, 2, 0, 0]}>
                    {data.trades.map((t, i) => (
                      <Cell key={i} fill={t.result === 'WIN' ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* By Direction */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Performance by Direction</h3>
            <PerfTable data={data.byDirection} groupLabel="Direction" />
          </div>

          {/* By Day of Week */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Performance by Day of Week</h3>
            <PerfTable data={data.byDayOfWeek} groupLabel="Day" />
          </div>

          {/* By Hour */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Performance by Hour (UTC)</h3>
            <div className="h-56 mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byHour}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="group" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} tickFormatter={v => `${v}:00`} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={0} stroke="#e5e7eb" />
                  <Bar dataKey="totalPnl" name="Total P&L" radius={[4, 4, 0, 0]}>
                    {data.byHour.map((h, i) => (
                      <Cell key={i} fill={h.totalPnl >= 0 ? '#6366f1' : '#f97316'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <PerfTable data={data.byHour} groupLabel="Hour" />
          </div>

          {/* By Month */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly Breakdown</h3>
            <div className="h-56 mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="group" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={0} stroke="#e5e7eb" />
                  <Bar dataKey="totalPnl" name="Total P&L" radius={[4, 4, 0, 0]}>
                    {data.byMonth.map((m, i) => (
                      <Cell key={i} fill={m.totalPnl >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <PerfTable data={data.byMonth} groupLabel="Month" />
          </div>
        </div>
      )}

      {/* ── Streaks Tab ── */}
      {activeTab === 'streaks' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 mb-6">
            <StatCard
              label="Max Consecutive Wins"
              value={stats.maxConsecutiveWins.toString()}
              color="text-emerald-600"
            />
            <StatCard
              label="Max Consecutive Losses"
              value={stats.maxConsecutiveLosses.toString()}
              color="text-red-500"
            />
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Notable Streaks (3+ trades)</h3>
            <div className="space-y-3">
              {data.streaks.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-6">No notable streaks found</p>
              ) : (
                data.streaks.map((streak, i) => (
                  <div
                    key={i}
                    className={`flex items-center justify-between p-4 rounded-lg border ${
                      streak.type === 'WIN'
                        ? 'border-emerald-100 bg-emerald-50/50'
                        : 'border-red-100 bg-red-50/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-2xl font-bold ${
                        streak.type === 'WIN' ? 'text-emerald-600' : 'text-red-500'
                      }`}>
                        {streak.count}x
                      </span>
                      <div>
                        <p className={`text-sm font-semibold ${
                          streak.type === 'WIN' ? 'text-emerald-700' : 'text-red-600'
                        }`}>
                          {streak.type === 'WIN' ? 'Winning' : 'Losing'} Streak
                        </p>
                        <p className="text-xs text-gray-400">
                          {streak.startDate} - {streak.endDate}
                        </p>
                      </div>
                    </div>
                    <span className={`text-lg font-bold ${
                      streak.totalPnl >= 0 ? 'text-emerald-600' : 'text-red-500'
                    }`}>
                      {streak.totalPnl >= 0 ? '+' : ''}${streak.totalPnl.toFixed(2)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Streak heatmap - consecutive results visualization */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Trade Result Sequence</h3>
            <div className="flex flex-wrap gap-1">
              {data.trades.map(t => (
                <div
                  key={t.id}
                  className={`w-4 h-4 rounded-sm cursor-pointer transition-transform hover:scale-150 ${
                    t.result === 'WIN' ? 'bg-emerald-500' : 'bg-red-400'
                  }`}
                  title={`#${t.id} ${t.date} ${t.time} | ${t.result} | ${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}`}
                />
              ))}
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-emerald-500" /> Win
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm bg-red-400" /> Loss
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Daily P&L Tab ── */}
      {activeTab === 'calendar' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 mb-6">
            <StatCard
              label="Best Day"
              value={`+$${stats.bestDay.pnl.toFixed(2)}`}
              sub={stats.bestDay.date}
              color="text-emerald-600"
            />
            <StatCard
              label="Worst Day"
              value={`$${stats.worstDay.pnl.toFixed(2)}`}
              sub={stats.worstDay.date}
              color="text-red-500"
            />
          </div>

          {/* Daily P&L Bar Chart */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Daily P&L</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.dailyPnl}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                    tickLine={false}
                    angle={-45}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={0} stroke="#e5e7eb" />
                  <Bar dataKey="pnl" name="P&L" radius={[4, 4, 0, 0]}>
                    {data.dailyPnl.map((d, i) => (
                      <Cell key={i} fill={d.pnl >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Daily Breakdown Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Daily Breakdown</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Date</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Trades</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Wins</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Win Rate</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-gray-400 uppercase">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dailyPnl.map(d => (
                    <tr key={d.date} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-3 font-medium text-gray-700">{d.date}</td>
                      <td className="py-3 px-3 text-right text-gray-600">{d.trades}</td>
                      <td className="py-3 px-3 text-right text-gray-600">{d.wins}</td>
                      <td className="py-3 px-3 text-right">
                        <span className={`font-semibold ${
                          d.trades > 0 && (d.wins / d.trades) >= 0.5 ? 'text-emerald-600' : 'text-red-500'
                        }`}>
                          {d.trades > 0 ? ((d.wins / d.trades) * 100).toFixed(0) : 0}%
                        </span>
                      </td>
                      <td className={`py-3 px-3 text-right font-semibold ${d.pnl >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Trade Detail Modal */}
      {selectedTrade && (
        <TradeModal
          trade={selectedTrade}
          allTrades={data.trades}
          note={notes[String(selectedTrade.id)]}
          onClose={() => setSelectedTrade(null)}
          onSave={saveNote}
        />
      )}
    </div>
  );
}
