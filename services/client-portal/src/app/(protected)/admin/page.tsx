'use client';

import { useState } from 'react';
import {
  useAdminOverview, useAdminMentors, useUpdateMentorStatus, useUpdateMentorFeatured,
  useAdminInvoices, useReviewInvoice,
  useAdminCommissions, useUpdateCommissionStatus,
  useAdminReviews, useModerateReview,
  useAdminSubscriptions, useAdminCopiedTrades, useAdminBlockedAttempts,
  useAdminImports, useAdminShadowTrades, useAdminActionLogs,
} from '@/hooks/useAdmin';
import {
  LayoutDashboard, Users, CreditCard, Gift, Star, Shield, Activity,
  Check, X, Eye, AlertTriangle, ChevronDown, ChevronUp,
} from 'lucide-react';

type Tab = 'overview' | 'mentors' | 'billing' | 'referrals' | 'reviews' | 'support' | 'logs';

const statusBadge = (status: string) => {
  const colors: Record<string, string> = {
    approved: 'bg-green-100 text-green-800', active: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800', paid: 'bg-green-100 text-green-800',
    earned: 'bg-green-100 text-green-800', manual_review: 'bg-orange-100 text-orange-800',
    suspended: 'bg-red-100 text-red-800', rejected: 'bg-red-100 text-red-800',
    cancelled: 'bg-gray-100 text-gray-600', expired: 'bg-gray-100 text-gray-600',
    flagged: 'bg-orange-100 text-orange-800', payout_ready: 'bg-blue-100 text-blue-800',
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-600'}`}>{status.replace(/_/g, ' ')}</span>;
};

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview');

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'mentors', label: 'Mentors', icon: Users },
    { key: 'billing', label: 'Billing', icon: CreditCard },
    { key: 'referrals', label: 'Referrals', icon: Gift },
    { key: 'reviews', label: 'Reviews', icon: Star },
    { key: 'support', label: 'Support', icon: Shield },
    { key: 'logs', label: 'Audit Log', icon: Activity },
  ];

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Admin Operations</h1>

      <div className="flex flex-wrap gap-1 mb-6 bg-gray-100 rounded-lg p-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              <Icon className="h-4 w-4 mr-1" /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'mentors' && <MentorsTab />}
      {tab === 'billing' && <BillingTab />}
      {tab === 'referrals' && <ReferralsTab />}
      {tab === 'reviews' && <ReviewsTab />}
      {tab === 'support' && <SupportTab />}
      {tab === 'logs' && <LogsTab />}
    </div>
  );
}

function OverviewTab() {
  const { data: stats, isLoading } = useAdminOverview();
  if (isLoading) return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />;
  if (!stats) return null;

  const cards = [
    { label: 'Total Users', value: stats.totalUsers, color: 'text-gray-900' },
    { label: 'Approved Mentors', value: stats.totalMentors, color: 'text-green-600' },
    { label: 'Pending Mentors', value: stats.pendingMentors, color: 'text-yellow-600' },
    { label: 'Active Subscriptions', value: stats.activeSubscriptions, color: 'text-blue-600' },
    { label: 'Shadow Subs', value: stats.shadowSubscriptions, color: 'text-purple-600' },
    { label: 'Open Trades', value: stats.openCopiedTrades, color: 'text-green-600' },
    { label: 'Open Sim Trades', value: stats.openSimTrades, color: 'text-purple-600' },
    { label: 'Manual Review Invoices', value: stats.manualReviewInvoices, color: 'text-orange-600' },
    { label: 'Pending Commissions', value: stats.pendingCommissions, color: 'text-yellow-600' },
    { label: 'Pending Reviews', value: stats.pendingReviews, color: 'text-yellow-600' },
    { label: 'Pending Imports', value: stats.pendingImports, color: 'text-blue-600' },
    { label: 'Blocked (24h)', value: stats.blockedAttempts24h, color: 'text-red-600' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500">{c.label}</p>
          <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

function MentorsTab() {
  const [filter, setFilter] = useState('');
  const { data: mentors } = useAdminMentors(filter || undefined);
  const updateStatus = useUpdateMentorStatus();
  const updateFeatured = useUpdateMentorFeatured();

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex gap-2 mb-4">
        {['', 'pending', 'approved', 'suspended'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-xs ${filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {f || 'All'}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {(mentors || []).map((m: any) => (
          <div key={m.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div>
              <p className="font-medium text-sm">{m.display_name} <span className="text-xs text-gray-400">({m.user_email})</span></p>
              <p className="text-xs text-gray-500">
                {m.total_followers} followers &middot;
                {m.is_approved ? ' Approved' : ' Pending'} &middot;
                {m.is_active ? ' Active' : ' Suspended'} &middot;
                {m.is_featured ? ' Featured' : ''}
              </p>
            </div>
            <div className="flex gap-1">
              {!m.is_approved && (
                <button onClick={() => updateStatus.mutate({ id: m.id, action: 'approve' })}
                  className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200">Approve</button>
              )}
              {m.is_active ? (
                <button onClick={() => { const r = prompt('Reason for suspension:'); if (r) updateStatus.mutate({ id: m.id, action: 'suspend', reason: r }); }}
                  className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200">Suspend</button>
              ) : (
                <button onClick={() => updateStatus.mutate({ id: m.id, action: 'unsuspend' })}
                  className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200">Unsuspend</button>
              )}
              <button onClick={() => updateFeatured.mutate({ id: m.id, featured: !m.is_featured })}
                className="px-2 py-1 text-xs bg-amber-100 text-amber-800 rounded hover:bg-amber-200">
                {m.is_featured ? 'Unfeature' : 'Feature'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BillingTab() {
  const [filter, setFilter] = useState('manual_review');
  const { data: invoices } = useAdminInvoices(filter || undefined);
  const reviewInvoice = useReviewInvoice();

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex gap-2 mb-4">
        {['manual_review', 'awaiting_payment', 'paid', 'expired', ''].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-xs ${filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {f || 'All'}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 uppercase">
            <th className="pb-2">User</th><th className="pb-2">Type</th><th className="pb-2">Amount</th>
            <th className="pb-2">Rail</th><th className="pb-2">Status</th><th className="pb-2">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {(invoices || []).map((inv: any) => (
              <tr key={inv.id}>
                <td className="py-2 text-xs">{inv.user_email}</td>
                <td className="py-2 text-xs">{inv.invoice_type}</td>
                <td className="py-2">${inv.amount_fiat}</td>
                <td className="py-2 text-xs">{inv.payment_rail}</td>
                <td className="py-2">{statusBadge(inv.status)}</td>
                <td className="py-2 flex gap-1">
                  {inv.status === 'manual_review' && (
                    <>
                      <button onClick={() => reviewInvoice.mutate({ id: inv.id, status: 'paid', notes: 'Admin confirmed' })}
                        className="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded">Confirm Paid</button>
                      <button onClick={() => reviewInvoice.mutate({ id: inv.id, status: 'failed', notes: 'Admin rejected' })}
                        className="px-2 py-0.5 text-xs bg-red-100 text-red-800 rounded">Reject</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReferralsTab() {
  const [filter, setFilter] = useState('pending');
  const { data: commissions } = useAdminCommissions(filter || undefined);
  const updateStatus = useUpdateCommissionStatus();

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex gap-2 mb-4">
        {['pending', 'earned', 'payout_ready', 'cancelled', ''].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-xs ${filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {f || 'All'}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 uppercase">
            <th className="pb-2">Referrer</th><th className="pb-2">Gross</th><th className="pb-2">Rate</th>
            <th className="pb-2">Commission</th><th className="pb-2">Status</th><th className="pb-2">Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {(commissions || []).map((c: any) => (
              <tr key={c.id}>
                <td className="py-2 text-xs">{c.referrer_email}</td>
                <td className="py-2">${Number(c.gross_amount_fiat).toFixed(2)}</td>
                <td className="py-2">{Number(c.commission_rate_pct)}%</td>
                <td className="py-2 font-medium text-green-700">${Number(c.commission_amount_fiat).toFixed(2)}</td>
                <td className="py-2">{statusBadge(c.status)}</td>
                <td className="py-2 flex gap-1">
                  {c.status === 'pending' && (
                    <button onClick={() => updateStatus.mutate({ id: c.id, status: 'earned' })}
                      className="px-2 py-0.5 text-xs bg-green-100 text-green-800 rounded">Confirm</button>
                  )}
                  {c.status === 'earned' && (
                    <button onClick={() => updateStatus.mutate({ id: c.id, status: 'payout_ready' })}
                      className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded">Mark Payout Ready</button>
                  )}
                  {!['cancelled', 'paid_out'].includes(c.status) && (
                    <button onClick={() => { const r = prompt('Reason:'); if (r) updateStatus.mutate({ id: c.id, status: 'cancelled', notes: r }); }}
                      className="px-2 py-0.5 text-xs bg-red-100 text-red-800 rounded">Cancel</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReviewsTab() {
  const [filter, setFilter] = useState('');
  const { data: reviews } = useAdminReviews(filter || undefined);
  const moderate = useModerateReview();

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex gap-2 mb-4">
        {['', 'pending', 'approved', 'rejected', 'flagged'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-xs ${filter === f ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {f || 'All'}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {(reviews || []).map((r: any) => (
          <div key={r.id} className="p-3 bg-gray-50 rounded-lg">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm"><span className="font-medium">{r.reviewer_email}</span> → <span className="text-gray-500">{r.mentor_name}</span></p>
                <div className="flex items-center gap-1 mt-0.5">
                  {[1,2,3,4,5].map(s => <Star key={s} className={`h-3 w-3 ${s <= r.rating ? 'text-yellow-500 fill-yellow-500' : 'text-gray-300'}`} />)}
                </div>
                {r.review_text && <p className="text-xs text-gray-600 mt-1">{r.review_text}</p>}
              </div>
              <div className="flex items-center gap-2">
                {statusBadge(r.moderation_status)}
                <div className="flex gap-1">
                  <button onClick={() => moderate.mutate({ id: r.id, status: 'approved' })}
                    className="p-1 text-green-600 hover:bg-green-50 rounded"><Check className="h-4 w-4" /></button>
                  <button onClick={() => moderate.mutate({ id: r.id, status: 'rejected' })}
                    className="p-1 text-red-600 hover:bg-red-50 rounded"><X className="h-4 w-4" /></button>
                  <button onClick={() => moderate.mutate({ id: r.id, status: 'flagged' })}
                    className="p-1 text-orange-600 hover:bg-orange-50 rounded"><AlertTriangle className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SupportTab() {
  const [view, setView] = useState<'subs' | 'trades' | 'blocked' | 'imports' | 'shadow'>('subs');
  const { data: subs } = useAdminSubscriptions();
  const { data: trades } = useAdminCopiedTrades();
  const { data: blocked } = useAdminBlockedAttempts();
  const { data: imports } = useAdminImports();
  const { data: shadow } = useAdminShadowTrades();

  const views = [
    { key: 'subs' as const, label: 'Subscriptions' },
    { key: 'trades' as const, label: 'Copied Trades' },
    { key: 'blocked' as const, label: 'Blocked Attempts' },
    { key: 'imports' as const, label: 'Imports' },
    { key: 'shadow' as const, label: 'Shadow Trades' },
  ];

  const data = view === 'subs' ? subs : view === 'trades' ? trades : view === 'blocked' ? blocked : view === 'imports' ? imports : shadow;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex gap-2 mb-4">
        {views.map(v => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`px-3 py-1 rounded text-xs ${view === v.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {v.label}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <pre className="text-xs text-gray-600 bg-gray-50 p-4 rounded max-h-96 overflow-auto">
          {JSON.stringify(data || [], null, 2)}
        </pre>
      </div>
    </div>
  );
}

function LogsTab() {
  const { data: logs } = useAdminActionLogs();

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-4">Recent Admin Actions</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 uppercase">
            <th className="pb-2">Time</th><th className="pb-2">Action</th><th className="pb-2">Target</th>
            <th className="pb-2">Old → New</th><th className="pb-2">Reason</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {(logs || []).map((l: any) => (
              <tr key={l.id}>
                <td className="py-2 text-xs text-gray-400">{new Date(l.created_at).toLocaleString()}</td>
                <td className="py-2 text-xs font-medium">{l.action_type}</td>
                <td className="py-2 text-xs">{l.target_type} <span className="text-gray-400 font-mono">{l.target_id?.slice(0,8)}</span></td>
                <td className="py-2 text-xs">{l.old_status || '—'} → {l.new_status || '—'}</td>
                <td className="py-2 text-xs text-gray-500">{l.reason || l.notes || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
