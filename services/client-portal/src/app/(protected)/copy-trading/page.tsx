'use client';

import { useFollowerSubscriptions, usePauseSubscription, useResumeSubscription, useStopSubscription } from '@/hooks/useFollowerSubscriptions';
import { useCopyTrades, useCloseCopyTrade } from '@/hooks/useCopyTrades';
import { Pause, Play, Square, X, TrendingUp, TrendingDown } from 'lucide-react';
import Link from 'next/link';

export default function CopyTradingPage() {
  const { data: subscriptions, isLoading: subsLoading } = useFollowerSubscriptions();
  const { data: tradesData, isLoading: tradesLoading } = useCopyTrades();
  const pauseSub = usePauseSubscription();
  const resumeSub = useResumeSubscription();
  const stopSub = useStopSubscription();
  const closeTrade = useCloseCopyTrade();

  const activeSubs = subscriptions?.filter((s) => s.status !== 'stopped') || [];
  const openTrades = tradesData?.trades?.filter((t: any) => t.status === 'open') || [];
  const recentTrades = tradesData?.trades?.slice(0, 20) || [];

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Copy Trading</h1>
        <Link
          href="/mentors"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          Browse Mentors
        </Link>
      </div>

      {/* Active Subscriptions */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Active Subscriptions</h2>
      {subsLoading ? (
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-8"></div>
      ) : activeSubs.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mb-8">
          {activeSubs.map((sub: any) => (
            <div key={sub.id} className="bg-white rounded-lg shadow p-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-semibold text-gray-900">Mentor Subscription</p>
                  <p className="text-xs text-gray-500">
                    {sub.mode === 'auto_trade' ? 'Auto-Trade' : 'View Only'} &middot; {sub.risk_amount}% risk &middot;
                    TP{sub.selected_tp_levels?.join(', TP') || '1'}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  sub.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {sub.status}
                </span>
              </div>
              <div className="flex gap-2 mt-3">
                {sub.status === 'active' && (
                  <button onClick={() => pauseSub.mutate(sub.id)}
                    className="flex items-center px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200">
                    <Pause className="mr-1 h-3 w-3" /> Pause
                  </button>
                )}
                {sub.status === 'paused' && (
                  <button onClick={() => resumeSub.mutate(sub.id)}
                    className="flex items-center px-2 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200">
                    <Play className="mr-1 h-3 w-3" /> Resume
                  </button>
                )}
                <button onClick={() => { if (confirm('Stop this subscription?')) stopSub.mutate(sub.id); }}
                  className="flex items-center px-2 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200">
                  <Square className="mr-1 h-3 w-3" /> Stop
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 bg-white rounded-lg shadow mb-8">
          <p className="text-gray-500">No active subscriptions.</p>
          <Link href="/mentors" className="text-blue-600 text-sm hover:underline">Browse mentors to get started</Link>
        </div>
      )}

      {/* Open Copied Trades */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">
        Open Copied Trades ({openTrades.length})
      </h2>
      {openTrades.length > 0 ? (
        <div className="bg-white rounded-lg shadow overflow-hidden mb-8">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Direction</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">TP Level</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lot Size</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entry</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SL</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">TP</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {openTrades.map((trade: any) => (
                <tr key={trade.id}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{trade.symbol || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      trade.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>{trade.direction || '-'}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">TP{trade.tp_level}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{trade.lot_size}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{trade.entry_price || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{trade.stop_loss}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{trade.take_profit || '-'}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => { if (confirm('Close this trade?')) closeTrade.mutate({ id: trade.id }); }}
                      className="flex items-center px-2 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200"
                    >
                      <X className="mr-1 h-3 w-3" /> Close
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-6 bg-white rounded-lg shadow mb-8">
          <p className="text-sm text-gray-500">No open copied trades</p>
        </div>
      )}

      {/* Recent Trade History */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent Copied Trades</h2>
      {recentTrades.length > 0 ? (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">TP</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lots</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Profit</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Close Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {recentTrades.map((t: any) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 text-sm">TP{t.tp_level}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      t.status === 'open' ? 'bg-green-100 text-green-800' :
                      t.status === 'closed' ? 'bg-gray-100 text-gray-800' :
                      t.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                    }`}>{t.status}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{t.lot_size}</td>
                  <td className={`px-4 py-3 text-sm font-medium ${
                    t.profit > 0 ? 'text-green-600' : t.profit < 0 ? 'text-red-600' : 'text-gray-500'
                  }`}>{t.profit != null ? `$${Number(t.profit).toFixed(2)}` : '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{t.close_reason || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-6 bg-white rounded-lg shadow">
          <p className="text-sm text-gray-500">No copied trade history yet</p>
        </div>
      )}
    </div>
  );
}
