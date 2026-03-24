'use client';

import { useState } from 'react';
import { useFollowerSubscriptions, usePauseSubscription, useResumeSubscription, useStopSubscription } from '@/hooks/useFollowerSubscriptions';
import { useCopyTrades, useCloseCopyTrade } from '@/hooks/useCopyTrades';
import { useSubscriptionSafety, useUpdateSubscriptionSafety, useReEnableSubscription, useBlockedCopyAttempts, useCopiedTradeTimeline } from '@/hooks/useSafety';
import { Pause, Play, Square, X, TrendingUp, TrendingDown, Shield, AlertTriangle, Settings, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';

function SafetyPanel({ subscriptionId }: { subscriptionId: string }) {
  const { data, isLoading } = useSubscriptionSafety(subscriptionId);
  const updateSafety = useUpdateSubscriptionSafety();
  const reEnable = useReEnableSubscription();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>({});

  if (isLoading || !data) return null;

  const s = data.safety?.settings || {};
  const isAutoDisabled = !!data.safety?.autoDisabledAt;

  const startEdit = () => {
    setForm({
      max_daily_loss_usd: s.max_daily_loss_usd || '',
      max_concurrent_trades: s.max_concurrent_trades || '',
      late_entry_seconds: s.late_entry_seconds || '',
      max_lot_size: s.max_lot_size || '',
      copy_market_orders: s.copy_market_orders !== false,
      copy_pending_orders: s.copy_pending_orders !== false,
      sync_breakeven: s.sync_breakeven !== false,
      sync_close_all: s.sync_close_all !== false,
      auto_disable_on_daily_loss: s.auto_disable_on_daily_loss || false,
    });
    setEditing(true);
  };

  const saveSettings = () => {
    const payload: any = { id: subscriptionId };
    if (form.max_daily_loss_usd !== '') payload.max_daily_loss_usd = Number(form.max_daily_loss_usd) || undefined;
    else payload.max_daily_loss_usd = null;
    if (form.max_concurrent_trades !== '') payload.max_concurrent_trades = Number(form.max_concurrent_trades) || undefined;
    else payload.max_concurrent_trades = null;
    if (form.late_entry_seconds !== '') payload.late_entry_seconds = Number(form.late_entry_seconds) || undefined;
    else payload.late_entry_seconds = null;
    if (form.max_lot_size !== '') payload.max_lot_size = Number(form.max_lot_size) || undefined;
    else payload.max_lot_size = null;
    payload.copy_market_orders = form.copy_market_orders;
    payload.copy_pending_orders = form.copy_pending_orders;
    payload.sync_breakeven = form.sync_breakeven;
    payload.sync_close_all = form.sync_close_all;
    payload.auto_disable_on_daily_loss = form.auto_disable_on_daily_loss;
    updateSafety.mutate(payload);
    setEditing(false);
  };

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      {/* Auto-Disabled Banner */}
      {isAutoDisabled && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <div>
              <p className="text-xs font-medium text-red-800">Auto-Disabled</p>
              <p className="text-xs text-red-600">{data.safety.autoDisabledReason?.replace(/_/g, ' ')}</p>
            </div>
          </div>
          <button onClick={() => reEnable.mutate(subscriptionId)}
            className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">
            Re-Enable
          </button>
        </div>
      )}

      {/* Status Summary */}
      <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
        <Shield className="h-3 w-3" />
        <span>Daily loss: ${data.safety.currentDailyLoss?.toFixed(2) || '0.00'}{s.max_daily_loss_usd ? ` / $${s.max_daily_loss_usd}` : ''}</span>
        <span>Open: {data.safety.currentOpenTrades || 0}{s.max_concurrent_trades ? ` / ${s.max_concurrent_trades}` : ''}</span>
      </div>

      {/* Settings Toggle */}
      {!editing ? (
        <button onClick={startEdit}
          className="flex items-center text-xs text-blue-600 hover:underline">
          <Settings className="h-3 w-3 mr-1" /> Safety Settings
        </button>
      ) : (
        <div className="space-y-2 p-3 bg-gray-50 rounded-lg text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-gray-500 mb-0.5">Max Daily Loss ($)</label>
              <input type="number" min="0" step="1" value={form.max_daily_loss_usd}
                onChange={e => setForm({ ...form, max_daily_loss_usd: e.target.value })}
                className="w-full px-2 py-1 border border-gray-300 rounded text-xs" placeholder="No limit" />
            </div>
            <div>
              <label className="block text-gray-500 mb-0.5">Max Concurrent Trades</label>
              <input type="number" min="0" step="1" value={form.max_concurrent_trades}
                onChange={e => setForm({ ...form, max_concurrent_trades: e.target.value })}
                className="w-full px-2 py-1 border border-gray-300 rounded text-xs" placeholder="No limit" />
            </div>
            <div>
              <label className="block text-gray-500 mb-0.5">Late Entry (seconds)</label>
              <input type="number" min="0" step="30" value={form.late_entry_seconds}
                onChange={e => setForm({ ...form, late_entry_seconds: e.target.value })}
                className="w-full px-2 py-1 border border-gray-300 rounded text-xs" placeholder="No limit" />
            </div>
            <div>
              <label className="block text-gray-500 mb-0.5">Max Lot Size</label>
              <input type="number" min="0.01" step="0.01" value={form.max_lot_size}
                onChange={e => setForm({ ...form, max_lot_size: e.target.value })}
                className="w-full px-2 py-1 border border-gray-300 rounded text-xs" placeholder="No limit" />
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {[
              { key: 'copy_market_orders', label: 'Market Orders' },
              { key: 'copy_pending_orders', label: 'Pending Orders' },
              { key: 'sync_breakeven', label: 'Sync Breakeven' },
              { key: 'sync_close_all', label: 'Sync Close All' },
              { key: 'auto_disable_on_daily_loss', label: 'Auto-Disable on Loss' },
            ].map(opt => (
              <label key={opt.key} className="flex items-center gap-1 text-gray-600">
                <input type="checkbox" checked={form[opt.key]}
                  onChange={e => setForm({ ...form, [opt.key]: e.target.checked })}
                  className="h-3 w-3" />
                {opt.label}
              </label>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={saveSettings} className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
            <button onClick={() => setEditing(false)} className="px-3 py-1 bg-gray-200 text-gray-700 rounded">Cancel</button>
          </div>
        </div>
      )}

      {/* Recent Blocked */}
      {data.recentBlocked?.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-gray-500 font-medium mb-1">Recently Blocked</p>
          {data.recentBlocked.slice(0, 3).map((b: any) => (
            <div key={b.id} className="flex items-center gap-2 text-xs text-red-600 py-0.5">
              <X className="h-3 w-3" />
              <span>{b.signal_symbol} — {b.block_reason.replace(/_/g, ' ')}</span>
              <span className="text-gray-400">{new Date(b.created_at).toLocaleTimeString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TradeTimeline({ tradeId }: { tradeId: string }) {
  const { data } = useCopiedTradeTimeline(tradeId);
  if (!data?.events?.length) return null;

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

export default function CopyTradingPage() {
  const { data: subscriptions, isLoading: subsLoading } = useFollowerSubscriptions();
  const { data: tradesData, isLoading: tradesLoading } = useCopyTrades();
  const { data: blocked } = useBlockedCopyAttempts();
  const pauseSub = usePauseSubscription();
  const resumeSub = useResumeSubscription();
  const stopSub = useStopSubscription();
  const closeTrade = useCloseCopyTrade();
  const reEnable = useReEnableSubscription();

  const [expandedSub, setExpandedSub] = useState<string | null>(null);
  const [expandedTrade, setExpandedTrade] = useState<string | null>(null);

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
            <div key={sub.id} className={`bg-white rounded-lg shadow p-4 ${sub.auto_disabled_at ? 'ring-2 ring-red-200' : ''}`}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-semibold text-gray-900">Mentor Subscription</p>
                  <p className="text-xs text-gray-500">
                    {sub.mode === 'auto_trade' ? 'Auto-Trade' : 'View Only'} &middot; {sub.risk_amount}% risk &middot;
                    TP{sub.selected_tp_levels?.join(', TP') || '1'}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  sub.status === 'active' ? 'bg-green-100 text-green-800' :
                  sub.auto_disabled_at ? 'bg-red-100 text-red-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {sub.auto_disabled_at ? 'auto-disabled' : sub.status}
                </span>
              </div>
              <div className="flex gap-2 mt-3">
                {sub.status === 'active' && (
                  <button onClick={() => pauseSub.mutate(sub.id)}
                    className="flex items-center px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200">
                    <Pause className="mr-1 h-3 w-3" /> Pause
                  </button>
                )}
                {sub.status === 'paused' && !sub.auto_disabled_at && (
                  <button onClick={() => resumeSub.mutate(sub.id)}
                    className="flex items-center px-2 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200">
                    <Play className="mr-1 h-3 w-3" /> Resume
                  </button>
                )}
                <button onClick={() => setExpandedSub(expandedSub === sub.id ? null : sub.id)}
                  className="flex items-center px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200">
                  <Shield className="mr-1 h-3 w-3" /> Safety
                  {expandedSub === sub.id ? <ChevronUp className="ml-1 h-3 w-3" /> : <ChevronDown className="ml-1 h-3 w-3" />}
                </button>
                <button onClick={() => { if (confirm('Stop this subscription?')) stopSub.mutate(sub.id); }}
                  className="flex items-center px-2 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200">
                  <Square className="mr-1 h-3 w-3" /> Stop
                </button>
              </div>
              {expandedSub === sub.id && <SafetyPanel subscriptionId={sub.id} />}
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
                <tr key={t.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setExpandedTrade(expandedTrade === t.id ? null : t.id)}>
                  <td className="px-4 py-3 text-sm">
                    TP{t.tp_level}
                    {expandedTrade === t.id && <TradeTimeline tradeId={t.id} />}
                  </td>
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

      {/* Blocked Copy Attempts */}
      {blocked && blocked.length > 0 && (
        <>
          <h2 className="text-lg font-semibold text-gray-900 mb-3 mt-8 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" /> Blocked Copy Attempts
          </h2>
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Limit</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {blocked.slice(0, 20).map((b: any) => (
                  <tr key={b.id}>
                    <td className="px-4 py-3 text-xs text-gray-500">{new Date(b.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{b.signal_symbol} {b.signal_direction}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-orange-100 text-orange-800 rounded text-xs font-medium">
                        {b.block_reason?.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{b.threshold_value || '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{b.actual_value || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
