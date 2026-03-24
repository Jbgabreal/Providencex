'use client';

import Link from 'next/link';
import { useMentorRecommendations, useRiskAssistant, useDismissWarning } from '@/hooks/useIntelligence';
import { Sparkles, Shield, AlertTriangle, Info, X, Star, TrendingUp, Users } from 'lucide-react';

const severityColors: Record<string, string> = {
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  critical: 'bg-red-50 border-red-200 text-red-800',
};

const severityIcons: Record<string, React.ReactNode> = {
  info: <Info className="h-4 w-4" />,
  warning: <AlertTriangle className="h-4 w-4" />,
  critical: <Shield className="h-4 w-4" />,
};

export default function DiscoverPage() {
  const { data: recommendations, isLoading: recLoading } = useMentorRecommendations();
  const { data: warnings } = useRiskAssistant();
  const dismissWarning = useDismissWarning();

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
        <Sparkles className="h-6 w-6 text-yellow-500" /> Discover & Risk Assistant
      </h1>

      {/* Risk Warnings */}
      {warnings && warnings.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Shield className="h-5 w-5 text-orange-500" /> Risk Warnings
          </h2>
          <div className="space-y-2">
            {warnings.map((w: any) => (
              <div key={w.id} className={`rounded-lg border p-4 ${severityColors[w.severity] || severityColors.info}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    {severityIcons[w.severity]}
                    <div>
                      <p className="font-medium text-sm">{w.title}</p>
                      <p className="text-xs mt-0.5">{w.description}</p>
                      {w.reason_codes?.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {w.reason_codes.map((rc: string, i: number) => (
                            <span key={i} className="px-1.5 py-0.5 bg-white/50 rounded text-xs">{rc}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <button onClick={() => dismissWarning.mutate(w.id)} className="p-1 hover:bg-white/30 rounded">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-yellow-500" /> Recommended Mentors
      </h2>

      {recLoading ? (
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />
      ) : !recommendations || recommendations.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <Sparkles className="h-8 w-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No recommendations yet. Subscribe to mentors to get personalized suggestions.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {recommendations.map((rec: any) => (
            <Link key={rec.mentorId} href={`/mentors/${rec.mentorId}`}
              className="bg-white rounded-lg shadow p-5 hover:shadow-md transition-shadow border border-gray-100">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{rec.mentorName}</h3>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium mt-1 inline-block ${
                    rec.matchType === 'full_match' ? 'bg-green-100 text-green-800' :
                    rec.matchType === 'style_match' ? 'bg-blue-100 text-blue-800' :
                    rec.matchType === 'symbol_match' ? 'bg-purple-100 text-purple-800' :
                    'bg-gray-100 text-gray-700'
                  }`}>{rec.matchType.replace(/_/g, ' ')}</span>
                </div>
                <div className="text-right">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    rec.analytics.riskLabel === 'low' ? 'bg-green-100 text-green-700' :
                    rec.analytics.riskLabel === 'moderate' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>{rec.analytics.riskLabel}</span>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-2 mb-3 text-xs">
                <div className="text-center">
                  <p className="text-gray-500">Win Rate</p>
                  <p className={`font-bold ${rec.analytics.winRate >= 50 ? 'text-green-600' : 'text-red-600'}`}>
                    {rec.analytics.winRate.toFixed(0)}%
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-gray-500">PF</p>
                  <p className="font-bold text-gray-900">{rec.analytics.profitFactor.toFixed(1)}</p>
                </div>
                <div className="text-center">
                  <p className="text-gray-500">Followers</p>
                  <p className="font-bold text-gray-900">{rec.analytics.totalFollowers}</p>
                </div>
                <div className="text-center">
                  <p className="text-gray-500">Rating</p>
                  <p className="font-bold text-yellow-600 flex items-center justify-center gap-0.5">
                    {rec.analytics.avgRating > 0 ? <><Star className="h-3 w-3 fill-yellow-500" />{rec.analytics.avgRating.toFixed(1)}</> : '—'}
                  </p>
                </div>
              </div>

              {/* Reasons */}
              <div className="space-y-1">
                {rec.reasons.slice(0, 3).map((reason: string, i: number) => (
                  <p key={i} className="text-xs text-gray-500 flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-yellow-400" /> {reason}
                  </p>
                ))}
              </div>

              <p className="text-xs text-gray-400 mt-2">Match score: {rec.score}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
