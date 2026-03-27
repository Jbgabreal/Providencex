'use client';

import { useState, useEffect } from 'react';

const TRADING_ENGINE_URL = process.env.NEXT_PUBLIC_TRADING_ENGINE_BASE_URL || 'http://localhost:3020';

interface JournalEntry {
  id: string;
  strategyKey: string;
  strategyProfileKey?: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  rrTarget?: number;
  status: string;
  result?: string;
  profit?: number;
  rMultiple?: number;
  closeReason?: string;
  executedTradeId?: string;
  entryContext: Record<string, any>;
  setupContext: Record<string, any>;
  createdAt: string;
}

/** Determine if a journal entry is a real MT5 trade, simulated, or skipped */
function getTradeType(e: JournalEntry): 'live' | 'simulated' | 'skipped' {
  if (e.status === 'skipped') return 'skipped';
  if (e.executedTradeId) return 'live';
  if (e.closeReason?.includes('_simulated')) return 'simulated';
  // signal/open/closed without executed_trade_id = simulated
  if (['signal', 'open', 'closed'].includes(e.status) && !e.executedTradeId) return 'simulated';
  return 'simulated';
}

interface JournalSummary {
  totalSignals: number;
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgRMultiple: number;
  totalProfit: number;
  byStrategy: Record<string, any>;
}

export default function TradeJournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [summary, setSummary] = useState<JournalSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [strategyFilter, setStrategyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showSkipped, setShowSkipped] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);

  const fetchData = async () => {
    try {
      const params = new URLSearchParams();
      if (strategyFilter) params.append('strategy', strategyFilter);
      if (statusFilter) params.append('status', statusFilter);
      else if (!showSkipped) params.append('exclude_status', 'skipped');
      params.append('limit', '100');

      const [tradesRes, summaryRes] = await Promise.all([
        fetch(`${TRADING_ENGINE_URL}/api/v1/journal/trades?${params}`, { cache: 'no-store' }),
        fetch(`${TRADING_ENGINE_URL}/api/v1/journal/summary`, { cache: 'no-store' }),
      ]);

      const tradesData = await tradesRes.json();
      const summaryData = await summaryRes.json();

      setEntries(tradesData.entries || []);
      setTotal(tradesData.total || 0);
      setSummary(summaryData.summary || null);
    } catch (err) {
      console.error('Failed to fetch journal data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [strategyFilter, statusFilter, showSkipped]);
  useEffect(() => { const interval = setInterval(fetchData, 30000); return () => clearInterval(interval); }, [strategyFilter, statusFilter, showSkipped]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 pb-12">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Live Trade Journal</h1>
        <p className="text-sm text-gray-500 mt-1">Multi-strategy signal tracking and trade lifecycle</p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
          {[
            { label: 'Total Signals', value: summary.totalSignals, color: 'text-gray-900' },
            { label: 'Open Trades', value: summary.openTrades, color: 'text-blue-600' },
            { label: 'Closed Trades', value: summary.closedTrades, color: 'text-gray-900' },
            { label: 'Win Rate', value: `${summary.winRate}%`, color: summary.winRate >= 50 ? 'text-emerald-600' : 'text-red-500' },
            { label: 'Total P&L', value: `$${summary.totalProfit.toFixed(2)}`, color: summary.totalProfit >= 0 ? 'text-emerald-600' : 'text-red-500' },
          ].map(card => (
            <div key={card.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <p className="text-xs font-medium text-gray-400 uppercase">{card.label}</p>
              <p className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Strategy Breakdown */}
      {summary?.byStrategy && Object.keys(summary.byStrategy).length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Performance by Strategy</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-400 uppercase">Strategy</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-gray-400 uppercase">Signals</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-gray-400 uppercase">Trades</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-gray-400 uppercase">W/L</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-gray-400 uppercase">Win Rate</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-gray-400 uppercase">Avg R</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-gray-400 uppercase">P&L</th>
              </tr>
            </thead>
            <tbody>
              {Object.values(summary.byStrategy).map((s: any) => (
                <tr key={s.strategyKey} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 px-3 font-medium text-gray-700">{s.strategyKey}</td>
                  <td className="py-2 px-3 text-right">{s.totalSignals}</td>
                  <td className="py-2 px-3 text-right">{s.totalTrades}</td>
                  <td className="py-2 px-3 text-right">{s.wins}/{s.losses}</td>
                  <td className="py-2 px-3 text-right">
                    <span className={`font-semibold ${s.winRate >= 50 ? 'text-emerald-600' : 'text-red-500'}`}>{s.winRate}%</span>
                  </td>
                  <td className="py-2 px-3 text-right">{s.avgRMultiple}R</td>
                  <td className={`py-2 px-3 text-right font-semibold ${s.totalProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    ${s.totalProfit.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select value={strategyFilter} onChange={e => { setStrategyFilter(e.target.value); setLoading(true); }}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700">
          <option value="">All Strategies</option>
          <option value="GOD_SMC_V1">GOD Strategy</option>
          <option value="SILVER_BULLET_V1">Silver Bullet</option>
        </select>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setLoading(true); }}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700">
          <option value="">All Status</option>
          <option value="signal">Signal</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="skipped">Skipped (No Setup)</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <label className="flex items-center gap-2 self-center cursor-pointer">
          <input type="checkbox" checked={showSkipped} onChange={e => { setShowSkipped(e.target.checked); setLoading(true); }}
            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
          <span className="text-sm text-gray-500">Show skipped</span>
        </label>
        <span className="self-center text-sm text-gray-400">{total} entries</span>
      </div>

      {/* Entries Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Time</th>
                <th className="text-center py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Type</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Strategy</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Symbol</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Dir</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Entry</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-gray-400 uppercase">SL</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-gray-400 uppercase">TP</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-gray-400 uppercase">R:R</th>
                <th className="text-center py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Status</th>
                <th className="text-center py-3 px-3 text-xs font-semibold text-gray-400 uppercase">Result</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-gray-400 uppercase">P&L</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => {
                const tradeType = getTradeType(e);
                const isSimulated = tradeType === 'simulated';
                const isSkipped = tradeType === 'skipped';
                return (
                <tr key={e.id}
                  onClick={() => setSelectedEntry(e)}
                  className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors ${
                    isSkipped ? 'opacity-40' :
                    isSimulated ? 'bg-amber-50/20' :
                    e.status === 'open' ? 'bg-blue-50/30' :
                    e.result === 'win' ? 'bg-emerald-50/30' :
                    e.result === 'loss' ? 'bg-red-50/20' : ''
                  }`}>
                  <td className="py-2 px-3 text-xs text-gray-400 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="py-2 px-3 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      tradeType === 'live' ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300' :
                      tradeType === 'simulated' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-400'
                    }`}>{tradeType === 'live' ? 'LIVE' : tradeType === 'simulated' ? 'SIM' : 'SKIP'}</span>
                  </td>
                  <td className="py-2 px-3 text-xs font-medium">{e.strategyKey}</td>
                  <td className="py-2 px-3 font-medium">{e.symbol}</td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      e.direction === 'buy' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
                    }`}>{e.direction.toUpperCase()}</span>
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-xs">{e.entryPrice?.toFixed(5)}</td>
                  <td className="py-2 px-3 text-right font-mono text-xs text-red-500">{e.stopLoss?.toFixed(5)}</td>
                  <td className="py-2 px-3 text-right font-mono text-xs text-emerald-600">{e.takeProfit?.toFixed(5)}</td>
                  <td className="py-2 px-3 text-right">{e.rrTarget ? `1:${e.rrTarget}` : '-'}</td>
                  <td className="py-2 px-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      e.status === 'open' ? 'bg-blue-100 text-blue-800' :
                      e.status === 'closed' ? 'bg-gray-100 text-gray-800' :
                      e.status === 'signal' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-600'
                    }`}>{e.status}</span>
                  </td>
                  <td className="py-2 px-3 text-center">
                    {e.result ? (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        e.result === 'win' ? 'bg-emerald-100 text-emerald-800' :
                        e.result === 'loss' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-600'
                      }`}>{e.result}{isSimulated ? ' (sim)' : ''}</span>
                    ) : '-'}
                  </td>
                  <td className={`py-2 px-3 text-right font-semibold ${
                    (e.profit || 0) > 0 ? 'text-emerald-600' : (e.profit || 0) < 0 ? 'text-red-500' : 'text-gray-400'
                  }`}>
                    {e.profit != null ? `$${e.profit.toFixed(2)}` : '-'}
                  </td>
                </tr>
                );
              })}
              {entries.length === 0 && (
                <tr><td colSpan={12} className="py-8 text-center text-gray-400">No journal entries yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Entry Detail Modal */}
      {selectedEntry && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setSelectedEntry(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-gray-900">
                {selectedEntry.strategyKey} - {selectedEntry.symbol} {selectedEntry.direction.toUpperCase()}
              </h3>
              <button onClick={() => setSelectedEntry(null)} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
            </div>

            {/* Trade Type Banner */}
            {(() => {
              const type = getTradeType(selectedEntry);
              if (type === 'live') return (
                <div className="mb-4 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                  LIVE TRADE — Executed on MT5 (ticket: {selectedEntry.executedTradeId || 'N/A'})
                </div>
              );
              if (type === 'simulated') return (
                <div className="mb-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
                  SIMULATED — Signal generated but not sent to MT5. {selectedEntry.closeReason?.includes('_simulated') ? 'SL/TP outcome simulated from price data.' : 'Blocked by execution filter.'}
                </div>
              );
              return (
                <div className="mb-4 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-500 text-xs font-semibold">
                  SKIPPED — No valid setup found
                </div>
              );
            })()}

            <div className="grid grid-cols-2 gap-3 mb-4">
              {[
                ['Status', selectedEntry.status],
                ['Result', selectedEntry.result || '-'],
                ['Entry', selectedEntry.entryPrice?.toFixed(5)],
                ['Stop Loss', selectedEntry.stopLoss?.toFixed(5)],
                ['Take Profit', selectedEntry.takeProfit?.toFixed(5)],
                ['R:R Target', selectedEntry.rrTarget ? `1:${selectedEntry.rrTarget}` : '-'],
                ['R Achieved', selectedEntry.rMultiple?.toFixed(2) || '-'],
                ['P&L', selectedEntry.profit != null ? `$${selectedEntry.profit.toFixed(2)}` : '-'],
                ['Close Reason', selectedEntry.closeReason || '-'],
                ['Created', new Date(selectedEntry.createdAt).toLocaleString()],
              ].map(([label, value]) => (
                <div key={label as string} className="py-1">
                  <span className="text-[10px] text-gray-400 uppercase">{label}</span>
                  <p className="text-sm font-semibold text-gray-700">{value}</p>
                </div>
              ))}
            </div>

            {selectedEntry.entryContext?.reason && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Entry Reason</p>
                <p className="text-xs text-gray-600 bg-gray-50 rounded p-3 font-mono leading-relaxed">
                  {selectedEntry.entryContext.reason}
                </p>
              </div>
            )}

            {Object.keys(selectedEntry.setupContext || {}).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Setup Context</p>
                <pre className="text-xs text-gray-600 bg-gray-50 rounded p-3 overflow-auto max-h-40">
                  {JSON.stringify(selectedEntry.setupContext, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
