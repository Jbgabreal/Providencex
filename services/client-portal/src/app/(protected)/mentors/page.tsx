'use client';

import { useState } from 'react';
import { useMentors } from '@/hooks/useMentors';
import { useFollowerSubscriptions, useSubscribeToMentor } from '@/hooks/useFollowerSubscriptions';
import { useMt5Accounts } from '@/hooks/useMt5Accounts';
import { Users, TrendingUp, ChevronRight } from 'lucide-react';

export default function MentorsPage() {
  const { data: mentors, isLoading } = useMentors();
  const { data: subscriptions } = useFollowerSubscriptions();
  const { data: accounts } = useMt5Accounts();
  const subscribeMutation = useSubscribeToMentor();

  const [subscribingTo, setSubscribingTo] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [riskAmount, setRiskAmount] = useState(1);
  const [selectedTps, setSelectedTps] = useState([1, 2]);

  const connectedAccounts = accounts?.filter((a) => a.status === 'connected') || [];
  const subscribedIds = new Set(subscriptions?.map((s) => s.mentor_profile_id) || []);

  const handleSubscribe = async (mentorId: string) => {
    if (!selectedAccount) return;
    try {
      await subscribeMutation.mutateAsync({
        mentor_profile_id: mentorId,
        mt5_account_id: selectedAccount,
        mode: 'auto_trade',
        risk_mode: 'percentage',
        risk_amount: riskAmount,
        selected_tp_levels: selectedTps,
      });
      setSubscribingTo(null);
      setSelectedAccount('');
    } catch (err) {
      console.error('Subscribe failed:', err);
    }
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Signal Providers</h1>
      <p className="text-sm text-gray-500 mb-6">Subscribe to experienced traders and copy their signals automatically.</p>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
        </div>
      ) : mentors && mentors.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {mentors.map((mentor: any) => (
            <div key={mentor.id} className="bg-white rounded-lg shadow p-6">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{mentor.display_name}</h3>
                  {mentor.bio && <p className="text-sm text-gray-500 mt-1">{mentor.bio}</p>}
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  <Users className="mr-1 h-3 w-3" />
                  {mentor.total_followers}
                </span>
              </div>

              {/* Performance Stats */}
              {mentor.performance && mentor.performance.total_signals > 0 && (
                <div className="mb-3 p-3 bg-gray-50 rounded text-xs">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className="text-gray-500 block">Win Rate</span>
                      <span className={`font-semibold text-sm ${mentor.performance.win_rate >= 50 ? 'text-green-700' : 'text-red-600'}`}>
                        {mentor.performance.win_rate.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Total PnL</span>
                      <span className={`font-semibold text-sm ${mentor.performance.total_pnl >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        ${mentor.performance.total_pnl.toFixed(0)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Profit Factor</span>
                      <span className="font-semibold text-sm">
                        {mentor.performance.profit_factor.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Signals</span>
                      <span className="font-semibold text-sm">{mentor.performance.total_signals}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">W / L</span>
                      <span className="font-semibold text-sm">
                        {mentor.performance.winning_trades} / {mentor.performance.losing_trades}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 block">Avg Trade</span>
                      <span className={`font-semibold text-sm ${mentor.performance.avg_profit_per_trade >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        ${mentor.performance.avg_profit_per_trade.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {subscribedIds.has(mentor.id) ? (
                <div className="flex items-center justify-center px-4 py-2 bg-green-50 text-green-700 rounded-lg text-sm font-medium">
                  <TrendingUp className="mr-2 h-4 w-4" /> Subscribed
                </div>
              ) : subscribingTo === mentor.id ? (
                <div className="space-y-3">
                  <select
                    value={selectedAccount}
                    onChange={(e) => setSelectedAccount(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    <option value="">Select MT5 Account...</option>
                    {connectedAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.label || acc.account_number} ({acc.server})
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-gray-500">Risk %</label>
                    <input
                      type="number" min="0.1" max="5" step="0.1" value={riskAmount}
                      onChange={(e) => setRiskAmount(Number(e.target.value))}
                      className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                    <label className="text-xs text-gray-500 ml-2">TPs</label>
                    {[1, 2, 3, 4].map((tp) => (
                      <label key={tp} className="flex items-center text-xs">
                        <input
                          type="checkbox"
                          checked={selectedTps.includes(tp)}
                          onChange={(e) => {
                            setSelectedTps(e.target.checked
                              ? [...selectedTps, tp].sort()
                              : selectedTps.filter((t) => t !== tp));
                          }}
                          className="mr-1 h-3 w-3"
                        />
                        TP{tp}
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSubscribe(mentor.id)}
                      disabled={!selectedAccount || subscribeMutation.isPending}
                      className="flex-1 px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
                    >
                      {subscribeMutation.isPending ? 'Subscribing...' : 'Confirm'}
                    </button>
                    <button
                      onClick={() => setSubscribingTo(null)}
                      className="px-3 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setSubscribingTo(mentor.id)}
                  disabled={connectedAccounts.length === 0}
                  className="w-full flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                >
                  Copy Trades <ChevronRight className="ml-1 h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500">No signal providers available yet.</p>
        </div>
      )}
    </div>
  );
}
