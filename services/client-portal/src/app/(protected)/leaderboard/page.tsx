'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMentorLeaderboard, useFeaturedMentors, useMarketplaceCategories } from '@/hooks/useMarketplace';
import { Trophy, Star, TrendingUp, Users, Shield, Zap, Crown } from 'lucide-react';

const sortOptions = [
  { value: 'performance', label: 'Best Performance', icon: TrendingUp },
  { value: 'win_rate', label: 'Highest Win Rate', icon: Star },
  { value: 'followers', label: 'Most Followers', icon: Users },
  { value: 'low_drawdown', label: 'Lowest Risk', icon: Shield },
  { value: 'rating', label: 'Top Rated', icon: Crown },
  { value: 'newest', label: 'Newest', icon: Zap },
];

const badgeColors: Record<string, string> = {
  verified: 'bg-blue-100 text-blue-700',
  top_performer: 'bg-yellow-100 text-yellow-800',
  high_win_rate: 'bg-green-100 text-green-800',
  low_drawdown: 'bg-teal-100 text-teal-800',
  consistent: 'bg-purple-100 text-purple-800',
  fast_growing: 'bg-orange-100 text-orange-800',
  new_mentor: 'bg-sky-100 text-sky-800',
  featured: 'bg-amber-100 text-amber-800',
};

export default function LeaderboardPage() {
  const [sort, setSort] = useState('performance');
  const { data, isLoading } = useMentorLeaderboard(sort);
  const { data: featured } = useFeaturedMentors();
  const { data: categories } = useMarketplaceCategories();

  const leaderboard = data?.leaderboard || [];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Trophy className="h-6 w-6 text-yellow-500" /> Mentor Leaderboard
        </h1>
        <Link href="/mentors" className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">
          Full Marketplace
        </Link>
      </div>

      {/* Featured Mentors */}
      {featured && featured.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-500" /> Featured Mentors
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {featured.slice(0, 4).map((m: any) => (
              <Link key={m.id} href={`/mentors/${m.id}`}
                className="bg-white rounded-lg shadow p-4 border-2 border-amber-200 hover:border-amber-400 transition-colors">
                <p className="font-semibold text-gray-900 text-sm">{m.display_name}</p>
                <div className="flex items-center gap-1 mt-1">
                  {m.badges?.map((b: any) => (
                    <span key={b.badge_type} className={`px-1.5 py-0.5 rounded text-xs ${badgeColors[b.badge_type] || 'bg-gray-100'}`}>
                      {b.label}
                    </span>
                  ))}
                </div>
                {m.analytics && (
                  <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                    <div>
                      <span className="text-gray-500">Win Rate</span>
                      <p className="font-medium">{m.analytics.win_rate?.toFixed(1)}%</p>
                    </div>
                    <div>
                      <span className="text-gray-500">30d PnL</span>
                      <p className={`font-medium ${(m.analytics.last_30d?.total_pnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        ${(m.analytics.last_30d?.total_pnl || 0).toFixed(0)}
                      </p>
                    </div>
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Sort Tabs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {sortOptions.map((opt) => {
          const Icon = opt.icon;
          return (
            <button key={opt.value} onClick={() => setSort(opt.value)}
              className={`flex items-center px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                sort === opt.value ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              <Icon className="h-3 w-3 mr-1" /> {opt.label}
            </button>
          );
        })}
      </div>

      {/* Categories Quick Links */}
      {categories && categories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {categories.map((cat: any) => (
            <button key={cat.slug} onClick={() => setSort(cat.sort)}
              className="px-2 py-1 text-xs text-blue-600 hover:underline" title={cat.description}>
              {cat.label}
            </button>
          ))}
        </div>
      )}

      {/* Leaderboard Table */}
      {isLoading ? (
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />
      ) : leaderboard.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500">No mentors qualify for this leaderboard yet.</p>
          <p className="text-xs text-gray-400 mt-1">Mentors need at least 10 signals to appear on ranked boards.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">#</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mentor</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Badges</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Win Rate</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">30d PnL</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Signals</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Followers</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Rating</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {leaderboard.map((entry: any) => (
                <tr key={entry.mentor.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-bold text-gray-400">
                    {entry.rank <= 3 ? ['', '🥇', '🥈', '🥉'][entry.rank] : entry.rank}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/mentors/${entry.mentor.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600">
                      {entry.mentor.display_name}
                    </Link>
                    {entry.analytics?.risk_label && (
                      <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${
                        entry.analytics.risk_label === 'low' ? 'bg-green-100 text-green-700' :
                        entry.analytics.risk_label === 'moderate' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>{entry.analytics.risk_label}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {entry.badges?.slice(0, 3).map((b: any) => (
                        <span key={b.badge_type} className={`px-1.5 py-0.5 rounded text-xs ${badgeColors[b.badge_type] || 'bg-gray-100'}`} title={b.description}>
                          {b.label}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${(entry.analytics?.win_rate || 0) >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                    {entry.analytics?.win_rate?.toFixed(1) || '0.0'}%
                  </td>
                  <td className={`px-4 py-3 text-sm text-right font-medium ${(entry.analytics?.last_30d?.total_pnl || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    ${(entry.analytics?.last_30d?.total_pnl || 0).toFixed(0)}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-500">{entry.analytics?.total_signals || 0}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-500">{entry.mentor.total_followers}</td>
                  <td className="px-4 py-3 text-sm text-right">
                    {Number(entry.mentor.avg_rating) > 0 ? (
                      <span className="flex items-center justify-end gap-1">
                        <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                        {Number(entry.mentor.avg_rating).toFixed(1)}
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
