'use client';

import { useState } from 'react';
import { usePublicMentors } from '@/hooks/usePublicMentors';
import { useFollowerSubscriptions, useSubscribeToMentor } from '@/hooks/useFollowerSubscriptions';
import { useMt5Accounts } from '@/hooks/useMt5Accounts';
import Link from 'next/link';
import { Users, TrendingUp, TrendingDown, Search, Shield, ChevronRight, Filter } from 'lucide-react';

const SORT_OPTIONS = [
  { value: 'followers', label: 'Most Followers' },
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name' },
];

const RISK_OPTIONS = [
  { value: '', label: 'All Risk Levels' },
  { value: 'low', label: 'Low Risk' },
  { value: 'moderate', label: 'Moderate Risk' },
  { value: 'high', label: 'High Risk' },
];

const STYLE_OPTIONS = [
  { value: '', label: 'All Styles' },
  { value: 'scalper', label: 'Scalper' },
  { value: 'day_trader', label: 'Day Trader' },
  { value: 'swing', label: 'Swing Trader' },
  { value: 'position', label: 'Position Trader' },
];

export default function MentorsPage() {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('followers');
  const [riskFilter, setRiskFilter] = useState('');
  const [styleFilter, setStyleFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading } = usePublicMentors({
    limit: 20, search: search || undefined, sort_by: sortBy,
    risk: riskFilter || undefined, style: styleFilter || undefined,
  });

  const { data: subscriptions } = useFollowerSubscriptions();
  const subscribedIds = new Set(subscriptions?.map((s: any) => s.mentor_profile_id) || []);

  const getRiskBadge = (label: string, score: number) => {
    const colors = {
      low: 'bg-green-100 text-green-800',
      moderate: 'bg-yellow-100 text-yellow-800',
      high: 'bg-red-100 text-red-800',
    };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[label as keyof typeof colors] || colors.moderate}`}>
        <Shield className="mr-1 h-3 w-3" />
        {label.charAt(0).toUpperCase() + label.slice(1)} Risk
      </span>
    );
  };

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Signal Providers</h1>
        <p className="text-sm text-gray-500 mt-1">
          Discover verified traders. All stats are platform-computed from real trade data.
        </p>
      </div>

      {/* Search & Filters */}
      <div className="mb-6 space-y-3">
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search mentors..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center px-3 py-2 border rounded-lg text-sm ${showFilters ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700'}`}>
            <Filter className="mr-1 h-4 w-4" /> Filters
          </button>
        </div>

        {showFilters && (
          <div className="flex gap-3 p-3 bg-gray-50 rounded-lg">
            <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm">
              {RISK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={styleFilter} onChange={(e) => setStyleFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm">
              {STYLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Mentor Cards */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
        </div>
      ) : data?.mentors && data.mentors.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {data.mentors.map((mentor: any) => {
            const a = mentor.analytics;
            return (
              <div key={mentor.id} className="bg-white rounded-lg shadow hover:shadow-md transition-shadow">
                <div className="p-5">
                  {/* Header */}
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-gray-900">{mentor.display_name}</h3>
                        {mentor.is_verified && (
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">Verified</span>
                        )}
                      </div>
                      {mentor.bio && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{mentor.bio}</p>}
                      {mentor.trading_style?.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          {mentor.trading_style.map((s: string) => (
                            <span key={s} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{s}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="inline-flex items-center text-xs text-gray-500">
                        <Users className="mr-1 h-3 w-3" /> {mentor.total_followers}
                      </span>
                      {a && getRiskBadge(a.risk_label, a.risk_score)}
                    </div>
                  </div>

                  {/* Analytics Grid */}
                  {a && (
                    <div className="grid grid-cols-3 gap-2 mb-4 p-3 bg-gray-50 rounded text-xs">
                      <div>
                        <span className="text-gray-500 block">Win Rate</span>
                        <span className={`font-semibold text-sm ${a.win_rate >= 50 ? 'text-green-700' : 'text-red-600'}`}>
                          {a.win_rate.toFixed(1)}%
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Total PnL</span>
                        <span className={`font-semibold text-sm ${a.total_pnl >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                          ${a.total_pnl.toFixed(0)}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Profit Factor</span>
                        <span className="font-semibold text-sm">{a.profit_factor.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Signals</span>
                        <span className="font-semibold text-sm">{a.total_signals}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Avg R:R</span>
                        <span className="font-semibold text-sm">{a.avg_rr.toFixed(1)}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Max DD</span>
                        <span className="font-semibold text-sm text-red-600">${a.max_drawdown_pct.toFixed(0)}</span>
                      </div>

                      {/* Last 30 days */}
                      {a.last_30d && a.last_30d.total_trades > 0 && (
                        <>
                          <div className="col-span-3 border-t border-gray-200 pt-2 mt-1">
                            <span className="text-gray-400 text-xs">Last 30 days</span>
                          </div>
                          <div>
                            <span className="text-gray-500 block">30d Win</span>
                            <span className="font-semibold text-sm">{a.last_30d.win_rate.toFixed(0)}%</span>
                          </div>
                          <div>
                            <span className="text-gray-500 block">30d PnL</span>
                            <span className={`font-semibold text-sm ${a.last_30d.total_pnl >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                              ${a.last_30d.total_pnl.toFixed(0)}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500 block">30d Trades</span>
                            <span className="font-semibold text-sm">{a.last_30d.total_trades}</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* CTA */}
                  <div className="flex gap-2">
                    <Link href={`/mentors/${mentor.id}`}
                      className="flex-1 flex items-center justify-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium">
                      View Profile
                    </Link>
                    {subscribedIds.has(mentor.id) ? (
                      <span className="flex items-center px-4 py-2 bg-green-50 text-green-700 rounded-lg text-sm font-medium">
                        <TrendingUp className="mr-1 h-4 w-4" /> Subscribed
                      </span>
                    ) : (
                      <Link href={`/mentors/${mentor.id}`}
                        className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
                        Copy Trades <ChevronRight className="ml-1 h-4 w-4" />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500">No mentors found{search ? ` matching "${search}"` : ''}.</p>
        </div>
      )}
    </div>
  );
}
