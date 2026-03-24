'use client';

import { useState } from 'react';
import { useShadowSummary, useShadowTrades, useShadowTradeTimeline } from '@/hooks/useShadow';
import { Eye, TrendingUp, TrendingDown, Clock, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';

export default function ShadowDashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useShadowSummary();
  const { data: openTrades } = useShadowTrades('open');
  const { data: closedTrades } = useShadowTrades('closed');
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Eye className="h-6 w-6 text-purple-600" /> Shadow Mode
        </h1>
        <Link href="/copy-trading" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">
          Back to Copy Trading
        </Link>
      </div>

      {/* Info Banner */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-purple-600 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-purple-800">Simulation Mode</p>
            <p className="text-xs text-purple-600">
              These trades are simulated and not executed on any real broker. Shadow mode lets you evaluate
              mentor performance under your risk settings before going live. Past simulated trades cannot be
              converted to real trades.
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {summaryLoading ? (
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-8" />
      ) : summary ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">Total Trades</p>
            <p className="text-2xl font-bold text-gray-900">{summary.totalTrades}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">Open</p>
            <p className="text-2xl font-bold text-blue-600">{summary.openTrades}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">Win Rate</p>
            <p className={`text-2xl font-bold ${summary.winRate >= 50 ? 'text-green-600' : 'text-red-600'}`}>
              {summary.winRate.toFixed(1)}%
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">Total PnL</p>
            <p className={`text-2xl font-bold ${summary.totalPnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              ${summary.totalPnl.toFixed(2)}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">W / L</p>
            <p className="text-2xl font-bold text-gray-900">{summary.winningTrades} / {summary.losingTrades}</p>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 bg-white rounded-lg shadow mb-8">
          <Eye className="h-8 w-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No shadow trades yet.</p>
          <p className="text-xs text-gray-400 mt-1">Set a subscription to shadow mode to start simulating.</p>
        </div>
      )}

      {/* CTA to Go Live */}
      {summary && summary.closedTrades >= 5 && summary.winRate > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-green-800">Ready to go live?</p>
            <p className="text-xs text-green-600">
              You have {summary.closedTrades} simulated trades with {summary.winRate.toFixed(0)}% win rate.
              Switch to auto-trade mode on your subscription.
            </p>
          </div>
          <Link href="/copy-trading"
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 flex-shrink-0">
            Switch to Live
          </Link>
        </div>
      )}

      {/* Open Simulated Trades */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">
        Open Simulated Trades ({openTrades?.length || 0})
      </h2>
      {openTrades && openTrades.length > 0 ? (
        <div className="bg-white rounded-lg shadow overflow-hidden mb-8">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dir</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">TP</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entry</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SL</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">TP Target</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lot</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Opened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {openTrades.map((t: any) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{t.symbol}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      t.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>{t.direction}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">TP{t.tp_level}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{t.entry_price}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{t.stop_loss}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{t.take_profit || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{t.lot_size}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{new Date(t.opened_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-6 bg-white rounded-lg shadow mb-8">
          <p className="text-sm text-gray-500">No open simulated trades</p>
        </div>
      )}

      {/* Closed Simulated Trades */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Closed Simulated Trades</h2>
      {closedTrades && closedTrades.length > 0 ? (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dir</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">TP</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entry</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Exit</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">PnL</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timeline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {closedTrades.map((t: any) => (
                <tr key={t.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{t.symbol}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      t.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>{t.direction}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">TP{t.tp_level}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{t.entry_price}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{t.exit_price || '—'}</td>
                  <td className={`px-4 py-3 text-sm font-medium ${
                    Number(t.simulated_pnl) >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>${Number(t.simulated_pnl || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{t.close_reason?.replace(/_/g, ' ') || '—'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => setExpandedTrade(expandedTrade === t.id ? null : t.id)}
                      className="text-blue-600 hover:text-blue-800">
                      {expandedTrade === t.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    {expandedTrade === t.id && <ShadowTradeTimeline tradeId={t.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-6 bg-white rounded-lg shadow">
          <p className="text-sm text-gray-500">No closed simulated trades yet</p>
        </div>
      )}
    </div>
  );
}

function ShadowTradeTimeline({ tradeId }: { tradeId: string }) {
  const { data } = useShadowTradeTimeline(tradeId);
  if (!data?.events?.length) return <p className="text-xs text-gray-400 mt-1">No events</p>;

  return (
    <div className="mt-1 space-y-0.5">
      {data.events.map((e: any) => (
        <div key={e.id} className="flex items-center gap-2 text-xs text-gray-500">
          <Clock className="h-3 w-3 text-gray-400" />
          <span className="font-medium">{e.event_type.replace(/_/g, ' ')}</span>
          <span className="text-gray-400">{new Date(e.created_at).toLocaleTimeString()}</span>
        </div>
      ))}
    </div>
  );
}
