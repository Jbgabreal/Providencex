'use client';

import { useState } from 'react';
import {
  useReferralProfile,
  useReferralConversions,
  useReferralCommissions,
  useReferredUsers,
  useRegenerateReferralCode,
} from '@/hooks/useReferrals';
import { Copy, CheckCircle, RefreshCw, Users, DollarSign, TrendingUp, Clock, Gift } from 'lucide-react';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  earned: 'bg-green-100 text-green-800',
  payout_ready: 'bg-blue-100 text-blue-800',
  paid_out: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-800',
};

export default function ReferralsPage() {
  const { data: profileData, isLoading } = useReferralProfile();
  const { data: conversions } = useReferralConversions();
  const { data: commissionsData } = useReferralCommissions();
  const { data: referredUsers } = useReferredUsers();
  const regenerateCode = useRegenerateReferralCode();

  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'conversions' | 'commissions' | 'referrals'>('conversions');

  const copyLink = () => {
    if (!profileData?.referralLink) return;
    const fullLink = `${window.location.origin}${profileData.referralLink}`;
    navigator.clipboard.writeText(fullLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyCode = () => {
    if (!profileData?.profile?.referral_code) return;
    navigator.clipboard.writeText(profileData.profile.referral_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return <div className="p-6"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto" /></div>;
  }

  const profile = profileData?.profile;
  const summary = profileData?.summary;
  const commissions = commissionsData?.commissions || [];
  const commissionSummary = commissionsData?.summary;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Referral Program</h1>

      {/* Referral Link Card */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4">
          <Gift className="h-5 w-5" /> Your Referral Link
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Share your referral link and earn commissions when referred users make purchases.
          {profile?.is_mentor_affiliate && (
            <span className="ml-1 text-purple-600 font-medium">Mentor affiliate rate: 15%</span>
          )}
          {!profile?.is_mentor_affiliate && (
            <span className="ml-1 text-blue-600 font-medium">Commission rate: 10%</span>
          )}
        </p>

        {/* Referral Code */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 bg-gray-50 rounded-lg p-3 flex items-center justify-between">
            <code className="text-lg font-bold text-gray-900 tracking-wider">
              {profile?.referral_code || '...'}
            </code>
            <button onClick={copyCode} className="p-1.5 text-gray-400 hover:text-gray-600" title="Copy code">
              {copied ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <button
            onClick={() => regenerateCode.mutate()}
            disabled={regenerateCode.isPending}
            className="p-2.5 text-gray-400 hover:text-gray-600 rounded-lg border border-gray-200 hover:bg-gray-50"
            title="Generate new code"
          >
            <RefreshCw className={`h-4 w-4 ${regenerateCode.isPending ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Full Link */}
        <div className="bg-gray-50 rounded-lg p-3 flex items-center justify-between">
          <span className="text-sm text-gray-600 truncate">
            {typeof window !== 'undefined' ? window.location.origin : ''}{profileData?.referralLink || ''}
          </span>
          <button onClick={copyLink} className="ml-2 px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 flex-shrink-0">
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 mb-1">
            <Users className="h-4 w-4" />
            <span className="text-xs">Referrals</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{summary?.totalReferrals || 0}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 mb-1">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs">Conversions</span>
          </div>
          <p className="text-2xl font-bold text-gray-900">{summary?.totalConversions || 0}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 mb-1">
            <DollarSign className="h-4 w-4" />
            <span className="text-xs">Total Earned</span>
          </div>
          <p className="text-2xl font-bold text-green-700">${Number(summary?.totalEarned || 0).toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 mb-1">
            <Clock className="h-4 w-4" />
            <span className="text-xs">Pending</span>
          </div>
          <p className="text-2xl font-bold text-yellow-600">${Number(summary?.pending || 0).toFixed(2)}</p>
        </div>
      </div>

      {/* Payout Status Summary */}
      {commissionSummary && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Payout Status</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Pending', value: commissionSummary.pending, color: 'text-yellow-600' },
              { label: 'Earned', value: commissionSummary.earned, color: 'text-green-600' },
              { label: 'Payout Ready', value: commissionSummary.payoutReady, color: 'text-blue-600' },
              { label: 'Paid Out', value: commissionSummary.paidOut, color: 'text-gray-600' },
              { label: 'Cancelled', value: commissionSummary.cancelled, color: 'text-red-600' },
            ].map((item) => (
              <div key={item.label} className="text-center">
                <p className="text-xs text-gray-500">{item.label}</p>
                <p className={`text-lg font-bold ${item.color}`}>${Number(item.value).toFixed(2)}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Payout automation coming soon. Commissions marked &quot;Payout Ready&quot; will be disbursed in a future update.
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
        {[
          { key: 'conversions' as const, label: 'Conversions' },
          { key: 'commissions' as const, label: 'Commissions' },
          { key: 'referrals' as const, label: 'Referred Users' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Conversions Table */}
      {tab === 'conversions' && (
        <div className="bg-white rounded-lg shadow p-6">
          {(!conversions || conversions.length === 0) ? (
            <p className="text-sm text-gray-500">No conversions yet. Share your referral link to start earning.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase">
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Type</th>
                    <th className="pb-2">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {conversions.map((c: any) => (
                    <tr key={c.id}>
                      <td className="py-2">{new Date(c.created_at).toLocaleDateString()}</td>
                      <td className="py-2">
                        <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">
                          {c.conversion_type === 'platform_plan' ? 'Platform' : 'Mentor'}
                        </span>
                      </td>
                      <td className="py-2 font-medium">${Number(c.gross_amount_fiat).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Commissions Table */}
      {tab === 'commissions' && (
        <div className="bg-white rounded-lg shadow p-6">
          {commissions.length === 0 ? (
            <p className="text-sm text-gray-500">No commissions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase">
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Gross</th>
                    <th className="pb-2">Rate</th>
                    <th className="pb-2">Commission</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {commissions.map((c: any) => (
                    <tr key={c.id}>
                      <td className="py-2">{new Date(c.created_at).toLocaleDateString()}</td>
                      <td className="py-2">${Number(c.gross_amount_fiat).toFixed(2)}</td>
                      <td className="py-2">{Number(c.commission_rate_pct).toFixed(0)}%</td>
                      <td className="py-2 font-medium text-green-700">${Number(c.commission_amount_fiat).toFixed(2)}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[c.status] || 'bg-gray-100'}`}>
                          {c.status.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Referred Users Table */}
      {tab === 'referrals' && (
        <div className="bg-white rounded-lg shadow p-6">
          {(!referredUsers || referredUsers.length === 0) ? (
            <p className="text-sm text-gray-500">No referred users yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase">
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Source</th>
                    <th className="pb-2">Code Used</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {referredUsers.map((r: any) => (
                    <tr key={r.id}>
                      <td className="py-2">{new Date(r.created_at).toLocaleDateString()}</td>
                      <td className="py-2">
                        <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{r.attribution_source}</span>
                      </td>
                      <td className="py-2 font-mono text-xs">{r.referral_code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
