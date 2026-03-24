'use client';

import { useMentorInsights } from '@/hooks/useIntelligence';
import { BarChart3, TrendingUp, Users, DollarSign, Target, ArrowUpDown, Radio } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import Link from 'next/link';

export default function MentorInsightsPage() {
  const { isMentor, isLoading: userLoading } = useCurrentUser();
  const { data: insights, isLoading } = useMentorInsights();

  if (userLoading || isLoading) return <div className="p-6"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto" /></div>;
  if (!isMentor) return (
    <div className="p-6 text-center py-16">
      <Radio className="h-10 w-10 text-gray-400 mx-auto mb-3" />
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Mentor access required</h2>
      <p className="text-sm text-gray-500 mb-4">Create a mentor profile to access mentor insights.</p>
      <Link href="/mentor-dashboard" className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
        Become a Mentor
      </Link>
    </div>
  );
  if (!insights) return <div className="p-6"><p className="text-gray-500">Mentor insights not available. You must be an approved mentor.</p></div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
        <BarChart3 className="h-6 w-6" /> Mentor Business Insights
      </h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 mb-1"><Users className="h-4 w-4" /><span className="text-xs">Active Subscribers</span></div>
          <p className="text-2xl font-bold text-gray-900">{insights.activeSubscribers}</p>
          <p className="text-xs text-gray-400">{insights.churnedSubscribers} churned</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 mb-1"><Target className="h-4 w-4" /><span className="text-xs">Plan Conversion</span></div>
          <p className="text-2xl font-bold text-blue-600">{insights.planConversionRate.toFixed(1)}%</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 mb-1"><ArrowUpDown className="h-4 w-4" /><span className="text-xs">Shadow → Live</span></div>
          <p className="text-2xl font-bold text-purple-600">{insights.shadowToLiveRate.toFixed(0)}%</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 mb-1"><DollarSign className="h-4 w-4" /><span className="text-xs">Avg Rating</span></div>
          <p className="text-2xl font-bold text-yellow-600">{insights.recentReviewTrend.toFixed(1)}</p>
        </div>
      </div>

      {/* Earnings Trend */}
      {insights.earningsTrend?.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Earnings Trend</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 uppercase">
                <th className="pb-2">Month</th><th className="pb-2">Gross</th><th className="pb-2">Net</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {insights.earningsTrend.map((e: any) => (
                  <tr key={e.month}>
                    <td className="py-2 font-medium">{e.month}</td>
                    <td className="py-2">${e.gross.toFixed(2)}</td>
                    <td className="py-2 text-green-700">${e.net.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Signal Engagement */}
      {insights.signalEngagement?.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Signal Engagement</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 uppercase">
                <th className="pb-2">Month</th><th className="pb-2">Signals</th><th className="pb-2">Copies</th><th className="pb-2">Avg Copies/Signal</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {insights.signalEngagement.map((e: any) => (
                  <tr key={e.month}>
                    <td className="py-2 font-medium">{e.month}</td>
                    <td className="py-2">{e.signals}</td>
                    <td className="py-2">{e.copies}</td>
                    <td className="py-2">{e.signals > 0 ? (e.copies / e.signals).toFixed(1) : '0'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Top Symbols */}
      {insights.topSymbols?.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Top Symbols</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {insights.topSymbols.map((s: any) => (
              <div key={s.symbol} className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="font-bold text-gray-900">{s.symbol}</p>
                <p className="text-xs text-gray-500">{s.total_signals} signals · {s.win_rate?.toFixed(0)}% WR</p>
                <p className={`text-sm font-medium ${Number(s.pnl) >= 0 ? 'text-green-600' : 'text-red-600'}`}>${Number(s.pnl).toFixed(0)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Follower Growth */}
      {insights.followerGrowth?.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Recent Follower Growth</h2>
          <div className="flex flex-wrap gap-2">
            {insights.followerGrowth.slice(0, 14).map((g: any) => (
              <div key={g.date} className="bg-gray-50 rounded px-3 py-1 text-center">
                <p className="text-xs text-gray-400">{new Date(g.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
                <p className="font-bold text-sm">{g.count}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
