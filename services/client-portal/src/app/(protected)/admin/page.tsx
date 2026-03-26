'use client';

import { useState } from 'react';
import {
  useAdminOverview, useAdminMentors, useUpdateMentorStatus, useUpdateMentorFeatured,
  useAdminInvoices, useReviewInvoice,
  useAdminCommissions, useUpdateCommissionStatus,
  useAdminReviews, useModerateReview,
  useAdminSubscriptions, useAdminCopiedTrades, useAdminBlockedAttempts,
  useAdminImports, useAdminShadowTrades, useAdminActionLogs,
  useEngineStatus,
} from '@/hooks/useAdmin';
import { useDecisions, useExposure, useBacktests, useDailyMetrics, useTradeJournal, useJournalSummary } from '@/hooks/useJournal';
import {
  LayoutDashboard, Users, CreditCard, Gift, Star, Shield, Activity,
  Check, X, Eye, AlertTriangle, ChevronDown, ChevronUp, Radio,
  BookOpen, TrendingUp, BarChart3, Target, FileText,
} from 'lucide-react';

type Tab = 'overview' | 'mentors' | 'billing' | 'referrals' | 'reviews' | 'support' | 'logs' | 'engine' | 'decisions' | 'exposure' | 'backtests' | 'metrics' | 'journal';

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
    { key: 'engine', label: 'Engine Monitor', icon: Radio },
    { key: 'decisions', label: 'Decisions', icon: Target },
    { key: 'exposure', label: 'Exposure', icon: TrendingUp },
    { key: 'backtests', label: 'Backtests', icon: BarChart3 },
    { key: 'metrics', label: 'Daily Metrics', icon: BookOpen },
    { key: 'journal', label: 'Trade Journal', icon: FileText },
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
      {tab === 'engine' && <EngineTab />}
      {tab === 'decisions' && <DecisionsTab />}
      {tab === 'exposure' && <ExposureTab />}
      {tab === 'backtests' && <BacktestsTab />}
      {tab === 'metrics' && <DailyMetricsTab />}
      {tab === 'journal' && <TradeJournalTab />}
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

// ==================== Engine Monitor ====================

function EngineTab() {
  const { data, isLoading } = useEngineStatus();

  if (isLoading) return <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto" />;
  if (!data) return <p className="text-gray-500">Engine status unavailable.</p>;

  const { engine, feedStatus, decisionCounts, recentDecisions } = data;

  const formatAge = (ms: number | null) => {
    if (ms === null) return 'No data';
    if (ms < 1000) return `${ms}ms ago`;
    if (ms < 60000) return `${(ms / 1000).toFixed(0)}s ago`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(0)}m ago`;
    return `${(ms / 3600000).toFixed(1)}h ago`;
  };

  const feedHealthColor = (ageMs: number | null) => {
    if (ageMs === null) return 'bg-gray-100 text-gray-600';
    if (ageMs < 30000) return 'bg-green-100 text-green-800';
    if (ageMs < 120000) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  return (
    <div className="space-y-6">
      {/* Engine Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500">Feed Status</p>
          <p className={`text-lg font-bold ${engine.feedRunning ? 'text-green-700' : 'text-red-600'}`}>
            {engine.feedRunning ? 'Running' : 'Stopped'}
          </p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500">Symbols Tracked</p>
          <p className="text-lg font-bold text-gray-900">{engine.symbolCount}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500">Decisions (last 1h)</p>
          <p className="text-lg font-bold text-gray-900">{decisionCounts.last1h}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500">Trades / Skips (all time)</p>
          <p className="text-lg font-bold text-gray-900">
            <span className="text-green-700">{decisionCounts.trades}</span>
            {' / '}
            <span className="text-gray-500">{decisionCounts.skips}</span>
          </p>
        </div>
      </div>

      {/* Price Feed Per Symbol */}
      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Price Feed Status</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase">
                <th className="pb-2">Symbol</th>
                <th className="pb-2">Last Tick</th>
                <th className="pb-2">Bid / Ask</th>
                <th className="pb-2">Candles</th>
                <th className="pb-2">Last Candle</th>
                <th className="pb-2">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {feedStatus.map((f: any) => (
                <tr key={f.symbol}>
                  <td className="py-2 font-medium">{f.symbol}</td>
                  <td className="py-2 text-gray-500">{formatAge(f.tickAgeMs)}</td>
                  <td className="py-2 font-mono text-xs">
                    {f.lastTickBid ? `${Number(f.lastTickBid).toFixed(5)} / ${Number(f.lastTickAsk).toFixed(5)}` : '—'}
                  </td>
                  <td className="py-2">{f.candleCount}</td>
                  <td className="py-2 text-gray-500 text-xs">
                    {f.lastCandleTime ? new Date(f.lastCandleTime).toLocaleTimeString() : '—'}
                  </td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${feedHealthColor(f.tickAgeMs)}`}>
                      {f.tickAgeMs === null ? 'No Data' : f.tickAgeMs < 30000 ? 'Live' : f.tickAgeMs < 120000 ? 'Stale' : 'Dead'}
                    </span>
                  </td>
                </tr>
              ))}
              {feedStatus.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-gray-500">No symbols being tracked</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Decisions */}
      <div className="bg-white rounded-lg shadow p-5">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Recent Strategy Decisions</h2>
        <p className="text-xs text-gray-400 mb-3">Auto-refreshes every 2 minutes</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase">
                <th className="pb-2">Time</th>
                <th className="pb-2">Symbol</th>
                <th className="pb-2">Decision</th>
                <th className="pb-2">Guardrail</th>
                <th className="pb-2">Reason</th>
                <th className="pb-2">Exec Filter</th>
                <th className="pb-2">Kill Switch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentDecisions.map((d: any) => (
                <tr key={d.id} className={d.decision === 'trade' ? 'bg-green-50/50' : ''}>
                  <td className="py-2 text-xs text-gray-500 whitespace-nowrap">
                    {new Date(d.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="py-2 font-medium">{d.symbol}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      d.decision === 'trade' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                    }`}>
                      {d.decision === 'trade' ? 'TRADE' : 'SKIP'}
                    </span>
                  </td>
                  <td className="py-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                      d.guardrail_mode === 'normal' ? 'bg-green-50 text-green-700' :
                      d.guardrail_mode === 'reduced' ? 'bg-yellow-50 text-yellow-700' :
                      'bg-red-50 text-red-700'
                    }`}>
                      {d.guardrail_mode}
                    </span>
                  </td>
                  <td className="py-2 text-xs text-gray-600 max-w-[200px] truncate" title={d.signal_reason || d.risk_reason || ''}>
                    {d.signal_reason || d.risk_reason || '—'}
                  </td>
                  <td className="py-2 text-xs">
                    {d.execution_filter_action ? (
                      <span className={`px-1.5 py-0.5 rounded ${
                        d.execution_filter_action === 'allow' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                      }`}>
                        {d.execution_filter_action}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-2 text-xs">
                    {d.kill_switch_active != null ? (
                      <span className={`px-1.5 py-0.5 rounded ${d.kill_switch_active ? 'bg-red-100 text-red-700' : 'bg-green-50 text-green-700'}`}>
                        {d.kill_switch_active ? 'ACTIVE' : 'off'}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {recentDecisions.length === 0 && (
                <tr><td colSpan={7} className="py-4 text-center text-gray-500">No decisions recorded yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ==================== Decisions Tab ====================

function DecisionsTab() {
  const { data: decisions, isLoading } = useDecisions(100);

  if (isLoading) return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-4">Trade Decisions</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 uppercase">
            <th className="pb-2">Time</th><th className="pb-2">Symbol</th><th className="pb-2">Decision</th>
            <th className="pb-2">Strategy</th><th className="pb-2">Guardrail</th><th className="pb-2">Signal Reason</th>
            <th className="pb-2">Risk Reason</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {(decisions || []).map((d: any, i: number) => (
              <tr key={d.id || i} className={d.decision === 'trade' ? 'bg-green-50/50' : ''}>
                <td className="py-2 text-xs text-gray-400 whitespace-nowrap">
                  {new Date(d.timestamp).toLocaleString()}
                </td>
                <td className="py-2 font-medium">{d.symbol}</td>
                <td className="py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    d.decision === 'trade' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                  }`}>{d.decision?.toUpperCase()}</span>
                </td>
                <td className="py-2 text-xs">{d.strategy}</td>
                <td className="py-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${
                    d.guardrail_mode === 'normal' ? 'bg-green-50 text-green-700' :
                    d.guardrail_mode === 'reduced' ? 'bg-yellow-50 text-yellow-700' :
                    'bg-red-50 text-red-700'
                  }`}>{d.guardrail_mode}</span>
                </td>
                <td className="py-2 text-xs text-gray-600 max-w-[250px] truncate" title={d.signal_reason || ''}>
                  {d.signal_reason || '—'}
                </td>
                <td className="py-2 text-xs text-gray-600 max-w-[200px] truncate" title={d.risk_reason || ''}>
                  {d.risk_reason || '—'}
                </td>
              </tr>
            ))}
            {(!decisions || decisions.length === 0) && (
              <tr><td colSpan={7} className="py-4 text-center text-gray-500">No decisions recorded</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==================== Exposure Tab ====================

function ExposureTab() {
  const { data: exposure, isLoading } = useExposure();

  if (isLoading) return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />;
  if (!exposure) return <p className="text-gray-500 text-center py-8">No exposure data available</p>;

  const symbols = exposure.bySymbol || {};

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-4">Exposure by Symbol</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 uppercase">
            <th className="pb-2">Symbol</th><th className="pb-2">Open Trades</th><th className="pb-2">Net Volume</th>
            <th className="pb-2">Direction</th><th className="pb-2">Unrealized P&L</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {Object.entries(symbols).map(([sym, data]: [string, any]) => (
              <tr key={sym}>
                <td className="py-2 font-medium">{sym}</td>
                <td className="py-2">{data.count || 0}</td>
                <td className="py-2">{(data.netVolume || 0).toFixed(2)}</td>
                <td className="py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    (data.netVolume || 0) > 0 ? 'bg-blue-100 text-blue-800' :
                    (data.netVolume || 0) < 0 ? 'bg-orange-100 text-orange-800' :
                    'bg-gray-100 text-gray-600'
                  }`}>{(data.netVolume || 0) > 0 ? 'LONG' : (data.netVolume || 0) < 0 ? 'SHORT' : 'FLAT'}</span>
                </td>
                <td className={`py-2 font-medium ${(data.unrealizedPnl || 0) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  ${(data.unrealizedPnl || 0).toFixed(2)}
                </td>
              </tr>
            ))}
            {Object.keys(symbols).length === 0 && (
              <tr><td colSpan={5} className="py-4 text-center text-gray-500">No open exposure</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==================== Backtests Tab ====================

function BacktestsTab() {
  const { data: backtests, isLoading } = useBacktests(50);

  if (isLoading) return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-4">Backtest Runs</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500 uppercase">
            <th className="pb-2">Date</th><th className="pb-2">Symbol</th><th className="pb-2">Strategy</th>
            <th className="pb-2">Period</th><th className="pb-2">Trades</th><th className="pb-2">Win Rate</th>
            <th className="pb-2">PF</th><th className="pb-2">Max DD</th><th className="pb-2">Return</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {(backtests || []).map((bt: any) => (
              <tr key={bt.id}>
                <td className="py-2 text-xs text-gray-400">{new Date(bt.createdAt).toLocaleDateString()}</td>
                <td className="py-2 font-medium">{bt.symbol}</td>
                <td className="py-2 text-xs">{bt.strategy}</td>
                <td className="py-2 text-xs text-gray-500">{bt.fromDate} to {bt.toDate}</td>
                <td className="py-2">{bt.totalTrades}</td>
                <td className="py-2">{bt.winRate?.toFixed(1)}%</td>
                <td className="py-2">{bt.profitFactor?.toFixed(2)}</td>
                <td className="py-2 text-red-500">{bt.maxDrawdownPercent?.toFixed(1)}%</td>
                <td className={`py-2 font-medium ${bt.totalReturnPercent >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {bt.totalReturnPercent >= 0 ? '+' : ''}{bt.totalReturnPercent?.toFixed(1)}%
                </td>
              </tr>
            ))}
            {(!backtests || backtests.length === 0) && (
              <tr><td colSpan={9} className="py-4 text-center text-gray-500">No backtest runs found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==================== Daily Metrics Tab ====================

function DailyMetricsTab() {
  const { data: metrics, isLoading } = useDailyMetrics();

  if (isLoading) return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />;
  if (!metrics) return <p className="text-gray-500 text-center py-8">No metrics available</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500">Date</p>
          <p className="text-lg font-bold text-gray-900">{metrics.date}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500">Total Decisions</p>
          <p className="text-lg font-bold text-gray-900">{metrics.totalDecisions}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500">Total Trades</p>
          <p className="text-lg font-bold text-green-600">{metrics.totalTrades}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-xs text-gray-500">Total Skips</p>
          <p className="text-lg font-bold text-gray-600">{metrics.totalSkips}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Trades by Symbol</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 uppercase">
              <th className="pb-2">Symbol</th><th className="pb-2">Trades</th><th className="pb-2">Skips</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {Object.entries(metrics.tradesBySymbol || {}).map(([sym, stats]: [string, any]) => (
                <tr key={sym}>
                  <td className="py-2 font-medium">{sym}</td>
                  <td className="py-2">{stats.trades}</td>
                  <td className="py-2 text-gray-500">{stats.skips}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Top Skip Reasons</h2>
        <div className="space-y-2">
          {(metrics.topSkipReasons || []).map((item: any, i: number) => (
            <div key={i} className="flex justify-between items-center p-2 bg-gray-50 rounded">
              <span className="text-xs text-gray-700 flex-1">{item.reason}</span>
              <span className="text-sm font-medium text-gray-500 ml-4">{item.count}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== Trade Journal Tab ====================

function TradeJournalTab() {
  const [strategyFilter, setStrategyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { data: journalData, isLoading } = useTradeJournal({
    strategy: strategyFilter || undefined,
    status: statusFilter || undefined,
    limit: 50,
  });
  const { data: summary } = useJournalSummary();

  if (isLoading) return <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />;

  const entries = journalData?.entries || [];
  const total = journalData?.total || 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">Total Signals</p>
            <p className="text-2xl font-bold text-gray-900">{summary.totalSignals}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">Open Trades</p>
            <p className="text-2xl font-bold text-blue-600">{summary.openTrades}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">Closed Trades</p>
            <p className="text-2xl font-bold text-gray-900">{summary.closedTrades}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">Win Rate</p>
            <p className={`text-2xl font-bold ${summary.winRate >= 50 ? 'text-green-600' : 'text-red-500'}`}>
              {summary.winRate}%
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs text-gray-500">Total P&L</p>
            <p className={`text-2xl font-bold ${summary.totalProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
              ${summary.totalProfit.toFixed(2)}
            </p>
          </div>
        </div>
      )}

      {/* Strategy Breakdown */}
      {summary?.byStrategy && Object.keys(summary.byStrategy).length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Performance by Strategy</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs text-gray-500 uppercase">
                <th className="pb-2">Strategy</th><th className="pb-2">Signals</th><th className="pb-2">Trades</th>
                <th className="pb-2">W/L</th><th className="pb-2">Win Rate</th><th className="pb-2">Avg R</th><th className="pb-2">P&L</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {Object.values(summary.byStrategy).map((s: any) => (
                  <tr key={s.strategyKey}>
                    <td className="py-2 font-medium">{s.strategyKey}</td>
                    <td className="py-2">{s.totalSignals}</td>
                    <td className="py-2">{s.totalTrades}</td>
                    <td className="py-2">{s.wins}/{s.losses}</td>
                    <td className="py-2">
                      <span className={`font-semibold ${s.winRate >= 50 ? 'text-green-600' : 'text-red-500'}`}>
                        {s.winRate}%
                      </span>
                    </td>
                    <td className="py-2">{s.avgRMultiple}R</td>
                    <td className={`py-2 font-semibold ${s.totalProfit >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      ${s.totalProfit.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <select value={strategyFilter} onChange={e => setStrategyFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
          <option value="">All Strategies</option>
          <option value="GOD_SMC_V1">GOD Strategy</option>
          <option value="SILVER_BULLET_V1">Silver Bullet</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
          <option value="">All Status</option>
          <option value="signal">Signal (Detected)</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <span className="self-center text-sm text-gray-400">{total} entries</span>
      </div>

      {/* Journal Entries */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Journal Entries</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 uppercase">
              <th className="pb-2">Time</th><th className="pb-2">Strategy</th><th className="pb-2">Symbol</th>
              <th className="pb-2">Dir</th><th className="pb-2">Entry</th><th className="pb-2">SL</th>
              <th className="pb-2">TP</th><th className="pb-2">R:R</th><th className="pb-2">Status</th>
              <th className="pb-2">Result</th><th className="pb-2">P&L</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((e: any) => (
                <tr key={e.id} className={
                  e.status === 'open' ? 'bg-blue-50/50' :
                  e.result === 'win' ? 'bg-green-50/50' :
                  e.result === 'loss' ? 'bg-red-50/30' : ''
                }>
                  <td className="py-2 text-xs text-gray-400 whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2 text-xs font-medium">{e.strategyKey}</td>
                  <td className="py-2 font-medium">{e.symbol}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      e.direction === 'buy' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'
                    }`}>{e.direction?.toUpperCase()}</span>
                  </td>
                  <td className="py-2 font-mono text-xs">{e.entryPrice?.toFixed(5)}</td>
                  <td className="py-2 font-mono text-xs text-red-500">{e.stopLoss?.toFixed(5)}</td>
                  <td className="py-2 font-mono text-xs text-green-600">{e.takeProfit?.toFixed(5)}</td>
                  <td className="py-2">{e.rrTarget ? `1:${e.rrTarget}` : '-'}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      e.status === 'open' ? 'bg-blue-100 text-blue-800' :
                      e.status === 'closed' ? 'bg-gray-100 text-gray-800' :
                      e.status === 'signal' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-600'
                    }`}>{e.status}</span>
                  </td>
                  <td className="py-2">
                    {e.result ? (
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        e.result === 'win' ? 'bg-green-100 text-green-800' :
                        e.result === 'loss' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-600'
                      }`}>{e.result}</span>
                    ) : '-'}
                  </td>
                  <td className={`py-2 font-semibold ${
                    e.profit > 0 ? 'text-green-600' : e.profit < 0 ? 'text-red-500' : 'text-gray-400'
                  }`}>
                    {e.profit != null ? `$${e.profit.toFixed(2)}` : '-'}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr><td colSpan={11} className="py-4 text-center text-gray-500">No journal entries yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
