'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { usePublicMentorProfile } from '@/hooks/usePublicMentors';
import { useFollowerSubscriptions, useSubscribeToMentor } from '@/hooks/useFollowerSubscriptions';
import { useMt5Accounts } from '@/hooks/useMt5Accounts';
import { Users, Shield, TrendingUp, TrendingDown, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function MentorProfilePage() {
  const { id } = useParams() as { id: string };
  const { data, isLoading } = usePublicMentorProfile(id);
  const { data: subscriptions } = useFollowerSubscriptions();
  const { data: accounts } = useMt5Accounts();
  const subscribeMutation = useSubscribeToMentor();

  const [showSubscribe, setShowSubscribe] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [riskAmount, setRiskAmount] = useState(1);
  const [selectedTps, setSelectedTps] = useState([1, 2]);
  const [showMonthly, setShowMonthly] = useState(false);

  const connectedAccounts = accounts?.filter((a) => a.status === 'connected') || [];
  const isSubscribed = subscriptions?.some((s: any) => s.mentor_profile_id === id);

  const handleSubscribe = async () => {
    if (!selectedAccount) return;
    try {
      await subscribeMutation.mutateAsync({
        mentor_profile_id: id,
        mt5_account_id: selectedAccount,
        mode: 'auto_trade',
        risk_mode: 'percentage',
        risk_amount: riskAmount,
        selected_tp_levels: selectedTps,
      });
      setShowSubscribe(false);
    } catch (err) {
      console.error('Subscribe failed:', err);
    }
  };

  if (isLoading) {
    return <div className="p-6"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div></div>;
  }

  if (!data?.mentor) {
    return <div className="p-6"><p className="text-gray-500">Mentor not found.</p></div>;
  }

  const { mentor, analytics: a } = data;

  const riskColors = { low: 'bg-green-100 text-green-800', moderate: 'bg-yellow-100 text-yellow-800', high: 'bg-red-100 text-red-800' };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link href="/mentors" className="flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to Mentors
      </Link>

      {/* Profile Header */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{mentor.display_name}</h1>
              {mentor.is_verified && (
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">Verified</span>
              )}
              {a && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${riskColors[a.risk_label as keyof typeof riskColors]}`}>
                  <Shield className="mr-1 h-3 w-3" /> {a.risk_label.charAt(0).toUpperCase() + a.risk_label.slice(1)} Risk
                </span>
              )}
            </div>
            {mentor.bio && <p className="text-gray-600 mt-2">{mentor.bio}</p>}
            <div className="flex gap-2 mt-3">
              {mentor.trading_style?.map((s: string) => (
                <span key={s} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{s}</span>
              ))}
              {mentor.markets_traded?.map((m: string) => (
                <span key={m} className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs">{m}</span>
              ))}
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center text-gray-500 text-sm mb-2">
              <Users className="mr-1 h-4 w-4" /> {mentor.total_followers} followers
            </div>
            {a && <p className="text-xs text-gray-400">{a.active_subscribers} active subscribers</p>}
          </div>
        </div>

        {/* Subscribe CTA */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          {isSubscribed ? (
            <div className="flex items-center text-green-700 bg-green-50 rounded-lg px-4 py-2 text-sm font-medium">
              <TrendingUp className="mr-2 h-4 w-4" /> You&apos;re subscribed to this mentor
            </div>
          ) : showSubscribe ? (
            <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
              <select value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                <option value="">Select trading account...</option>
                {connectedAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>{acc.label || acc.account_number} ({acc.server})</option>
                ))}
              </select>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">Risk %</label>
                  <input type="number" min="0.1" max="5" step="0.1" value={riskAmount}
                    onChange={(e) => setRiskAmount(Number(e.target.value))}
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-sm" />
                </div>
                <div className="flex items-center gap-1">
                  <label className="text-xs text-gray-500">TPs:</label>
                  {[1, 2, 3, 4].map((tp) => (
                    <label key={tp} className="flex items-center text-xs">
                      <input type="checkbox" checked={selectedTps.includes(tp)}
                        onChange={(e) => setSelectedTps(e.target.checked ? [...selectedTps, tp].sort() : selectedTps.filter(t => t !== tp))}
                        className="mr-0.5 h-3 w-3" /> TP{tp}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={handleSubscribe} disabled={!selectedAccount || subscribeMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {subscribeMutation.isPending ? 'Subscribing...' : 'Start Copying'}
                </button>
                <button onClick={() => setShowSubscribe(false)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowSubscribe(true)} disabled={connectedAccounts.length === 0}
              className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50">
              {connectedAccounts.length === 0 ? 'Connect an account first' : 'Copy This Trader'}
            </button>
          )}
        </div>
      </div>

      {a && (
        <>
          {/* Performance Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Win Rate', value: `${a.win_rate.toFixed(1)}%`, color: a.win_rate >= 50 ? 'text-green-700' : 'text-red-600' },
              { label: 'Total PnL', value: `$${a.total_pnl.toFixed(0)}`, color: a.total_pnl >= 0 ? 'text-green-700' : 'text-red-600' },
              { label: 'Profit Factor', value: a.profit_factor.toFixed(2), color: 'text-gray-900' },
              { label: 'Avg R:R', value: a.avg_rr.toFixed(1), color: 'text-gray-900' },
              { label: 'Signals', value: a.total_signals, color: 'text-gray-900' },
              { label: 'W / L', value: `${a.winning_trades} / ${a.losing_trades}`, color: 'text-gray-900' },
              { label: 'Max Drawdown', value: `$${a.max_drawdown_pct.toFixed(0)}`, color: 'text-red-600' },
              { label: 'Avg Hold', value: `${a.avg_hold_time_hours.toFixed(1)}h`, color: 'text-gray-900' },
            ].map((item) => (
              <div key={item.label} className="bg-white rounded-lg shadow p-4">
                <p className="text-xs text-gray-500">{item.label}</p>
                <p className={`text-xl font-bold ${item.color}`}>{item.value}</p>
              </div>
            ))}
          </div>

          {/* Period Performance */}
          <div className="bg-white rounded-lg shadow p-5 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Performance by Period</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase">
                    <th className="pb-2">Period</th><th className="pb-2">Signals</th><th className="pb-2">Trades</th>
                    <th className="pb-2">Win Rate</th><th className="pb-2">PnL</th><th className="pb-2">PF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[
                    { label: 'Last 30 days', d: a.last_30d },
                    { label: 'Last 90 days', d: a.last_90d },
                    { label: 'Last 180 days', d: a.last_180d },
                  ].map((row) => (
                    <tr key={row.label}>
                      <td className="py-2 font-medium">{row.label}</td>
                      <td className="py-2">{row.d.total_signals}</td>
                      <td className="py-2">{row.d.total_trades}</td>
                      <td className="py-2">{row.d.win_rate.toFixed(1)}%</td>
                      <td className={`py-2 font-medium ${row.d.total_pnl >= 0 ? 'text-green-700' : 'text-red-600'}`}>${row.d.total_pnl.toFixed(0)}</td>
                      <td className="py-2">{row.d.profit_factor.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Symbol Breakdown */}
          {a.symbol_breakdown?.length > 0 && (
            <div className="bg-white rounded-lg shadow p-5 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">By Symbol</h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase">
                      <th className="pb-2">Symbol</th><th className="pb-2">Signals</th><th className="pb-2">Trades</th>
                      <th className="pb-2">W / L</th><th className="pb-2">Win Rate</th><th className="pb-2">PnL</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {a.symbol_breakdown.map((s: any) => (
                      <tr key={s.symbol}>
                        <td className="py-2 font-medium">{s.symbol}</td>
                        <td className="py-2">{s.total_signals}</td>
                        <td className="py-2">{s.total_trades}</td>
                        <td className="py-2">{s.winning} / {s.losing}</td>
                        <td className="py-2">{s.win_rate.toFixed(1)}%</td>
                        <td className={`py-2 font-medium ${s.pnl >= 0 ? 'text-green-700' : 'text-red-600'}`}>${s.pnl.toFixed(0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Monthly Performance */}
          {a.monthly_performance?.length > 0 && (
            <div className="bg-white rounded-lg shadow p-5 mb-6">
              <button onClick={() => setShowMonthly(!showMonthly)}
                className="flex items-center justify-between w-full text-lg font-semibold text-gray-900">
                Monthly Performance
                {showMonthly ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </button>
              {showMonthly && (
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 uppercase">
                        <th className="pb-2">Month</th><th className="pb-2">Signals</th><th className="pb-2">Trades</th>
                        <th className="pb-2">Win Rate</th><th className="pb-2">PnL</th><th className="pb-2">PF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {a.monthly_performance.map((m: any) => (
                        <tr key={m.month}>
                          <td className="py-2 font-medium">{m.month}</td>
                          <td className="py-2">{m.signals}</td>
                          <td className="py-2">{m.trades}</td>
                          <td className="py-2">{m.win_rate.toFixed(1)}%</td>
                          <td className={`py-2 font-medium ${m.pnl >= 0 ? 'text-green-700' : 'text-red-600'}`}>${m.pnl.toFixed(0)}</td>
                          <td className="py-2">{m.profit_factor.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Recent Signals */}
          {a.recent_signals?.length > 0 && (
            <div className="bg-white rounded-lg shadow p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent Signals</h2>
              <div className="space-y-2">
                {a.recent_signals.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${s.direction === 'BUY' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {s.direction}
                      </span>
                      <span className="font-medium text-sm">{s.symbol}</span>
                      <span className="text-xs text-gray-500">@ {s.entry_price}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs ${s.status === 'active' ? 'bg-green-50 text-green-700' : s.status === 'closed' ? 'bg-gray-100 text-gray-600' : 'bg-red-50 text-red-600'}`}>
                        {s.status}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className={`text-sm font-medium ${s.pnl >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        ${s.pnl.toFixed(2)}
                      </span>
                      <span className="text-xs text-gray-400 ml-2">{s.total_copies} copies</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
