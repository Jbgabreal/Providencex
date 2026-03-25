'use client';

import { useState, useEffect, useCallback } from 'react';

const BASE_URL = process.env.NEXT_PUBLIC_TRADING_ENGINE_BASE_URL || 'http://localhost:3020';
const OPS_URL = `${BASE_URL}/api/admin/ops`;

type Tab = 'overview' | 'mentors' | 'billing' | 'referrals' | 'reviews' | 'support' | 'logs';

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${OPS_URL}${path}`, {
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-role': 'admin',
      'x-user-id': 'admin-dashboard',
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

// ==================== Overview Tab ====================
function OverviewTab() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/overview').then(setData).catch(e => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Loading />;

  const stats = data.data || data;
  const cards = [
    { label: 'Total Users', value: stats.totalUsers ?? 0 },
    { label: 'Approved Mentors', value: stats.approvedMentors ?? 0 },
    { label: 'Pending Mentors', value: stats.pendingMentors ?? 0 },
    { label: 'Active Subscriptions', value: stats.activeSubscriptions ?? 0 },
    { label: 'Shadow Subs', value: stats.shadowSubscriptions ?? 0 },
    { label: 'Open Trades', value: stats.openTrades ?? 0 },
    { label: 'Open Sim Trades', value: stats.openSimTrades ?? 0 },
    { label: 'Manual Review Invoices', value: stats.manualReviewInvoices ?? 0 },
    { label: 'Pending Commissions', value: stats.pendingCommissions ?? 0 },
    { label: 'Pending Reviews', value: stats.pendingReviews ?? 0 },
    { label: 'Pending Imports', value: stats.pendingImports ?? 0 },
    { label: 'Blocked (24h)', value: stats.blockedAttempts24h ?? 0 },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(c => (
        <div key={c.label} className="bg-white shadow rounded-lg p-5">
          <p className="text-sm text-gray-500">{c.label}</p>
          <p className="text-2xl font-semibold text-gray-900">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

// ==================== Mentors Tab ====================
function MentorsTab() {
  const [mentors, setMentors] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const q = filter ? `?status=${filter}` : '';
    apiFetch(`/mentors${q}`).then(r => { setMentors(r.data || []); setError(null); }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: string, action: string, reason?: string) => {
    try {
      await apiFetch(`/mentors/${id}/status`, { method: 'PATCH', body: JSON.stringify({ action, reason }) });
      load();
    } catch (e: any) { alert(e.message); }
  };

  if (error) return <ErrorBox message={error} />;

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {['', 'pending', 'approved', 'suspended'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 text-sm rounded-full ${filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {f || 'All'}
          </button>
        ))}
      </div>
      {loading ? <Loading /> : (
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Followers</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {mentors.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-4 text-sm text-gray-500 text-center">No mentors found</td></tr>
              ) : mentors.map((m: any) => (
                <tr key={m.id}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{m.display_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{m.user_email || m.email}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{m.total_followers ?? 0}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${m.is_approved ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {m.is_approved ? 'Approved' : 'Pending'}
                    </span>
                    {!m.is_active && <span className="ml-1 px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">Suspended</span>}
                  </td>
                  <td className="px-4 py-3 text-sm space-x-2">
                    {!m.is_approved && <button onClick={() => updateStatus(m.id, 'approve')} className="text-green-600 hover:underline">Approve</button>}
                    {m.is_active && m.is_approved && <button onClick={() => { const r = prompt('Reason?'); if (r) updateStatus(m.id, 'suspend', r); }} className="text-red-600 hover:underline">Suspend</button>}
                    {!m.is_active && <button onClick={() => updateStatus(m.id, 'unsuspend')} className="text-blue-600 hover:underline">Unsuspend</button>}
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

// ==================== Billing Tab ====================
function BillingTab() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const q = filter ? `?status=${filter}` : '';
    apiFetch(`/billing/invoices${q}`).then(r => { setInvoices(r.data || []); setError(null); }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const reviewInvoice = async (id: string, action: string) => {
    try {
      await apiFetch(`/billing/invoices/${id}/review`, { method: 'PATCH', body: JSON.stringify({ action }) });
      load();
    } catch (e: any) { alert(e.message); }
  };

  if (error) return <ErrorBox message={error} />;

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {['', 'manual_review', 'awaiting_payment', 'paid', 'expired'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 text-sm rounded-full ${filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {f || 'All'}
          </button>
        ))}
      </div>
      {loading ? <Loading /> : (
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rail</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {invoices.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-4 text-sm text-gray-500 text-center">No invoices found</td></tr>
              ) : invoices.map((inv: any) => (
                <tr key={inv.id}>
                  <td className="px-4 py-3 text-sm text-gray-900">{inv.user_email || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{inv.invoice_type}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">${inv.amount_fiat}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{inv.payment_rail}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="px-4 py-3 text-sm space-x-2">
                    {inv.status === 'manual_review' && (
                      <>
                        <button onClick={() => reviewInvoice(inv.id, 'confirm_paid')} className="text-green-600 hover:underline">Confirm Paid</button>
                        <button onClick={() => reviewInvoice(inv.id, 'reject')} className="text-red-600 hover:underline">Reject</button>
                      </>
                    )}
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

// ==================== Referrals Tab ====================
function ReferralsTab() {
  const [commissions, setCommissions] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const q = filter ? `?status=${filter}` : '';
    apiFetch(`/referrals/commissions${q}`).then(r => { setCommissions(r.data || []); setError(null); }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: string, status: string, reason?: string) => {
    try {
      await apiFetch(`/referrals/commissions/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) });
      load();
    } catch (e: any) { alert(e.message); }
  };

  if (error) return <ErrorBox message={error} />;

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {['', 'pending', 'earned', 'payout_ready', 'cancelled'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 text-sm rounded-full ${filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {f || 'All'}
          </button>
        ))}
      </div>
      {loading ? <Loading /> : (
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Referrer</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Gross</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Commission</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {commissions.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-4 text-sm text-gray-500 text-center">No commissions found</td></tr>
              ) : commissions.map((c: any) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 text-sm text-gray-900">{c.referrer_email || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">${c.gross_amount_fiat}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{c.commission_rate_pct}%</td>
                  <td className="px-4 py-3 text-sm font-medium text-green-600">${c.commission_amount_fiat}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-sm space-x-2">
                    {c.status === 'pending' && <button onClick={() => updateStatus(c.id, 'earned')} className="text-green-600 hover:underline">Confirm</button>}
                    {c.status === 'earned' && <button onClick={() => updateStatus(c.id, 'payout_ready')} className="text-blue-600 hover:underline">Mark Payout Ready</button>}
                    {!['cancelled', 'paid_out'].includes(c.status) && (
                      <button onClick={() => { const r = prompt('Reason?'); if (r) updateStatus(c.id, 'cancelled', r); }} className="text-red-600 hover:underline">Cancel</button>
                    )}
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

// ==================== Reviews Tab ====================
function ReviewsTab() {
  const [reviews, setReviews] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const q = filter ? `?status=${filter}` : '';
    apiFetch(`/reviews${q}`).then(r => { setReviews(r.data || []); setError(null); }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const moderate = async (id: string, status: string) => {
    try {
      await apiFetch(`/reviews/${id}/moderation`, { method: 'PATCH', body: JSON.stringify({ moderation_status: status }) });
      load();
    } catch (e: any) { alert(e.message); }
  };

  if (error) return <ErrorBox message={error} />;

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {['', 'pending', 'approved', 'rejected', 'flagged'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 text-sm rounded-full ${filter === f ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {f || 'All'}
          </button>
        ))}
      </div>
      {loading ? <Loading /> : (
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reviewer</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mentor</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rating</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Review</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {reviews.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-4 text-sm text-gray-500 text-center">No reviews found</td></tr>
              ) : reviews.map((r: any) => (
                <tr key={r.id}>
                  <td className="px-4 py-3 text-sm text-gray-900">{r.reviewer_email || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{r.mentor_name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-yellow-500">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{r.review_text || '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.moderation_status} /></td>
                  <td className="px-4 py-3 text-sm space-x-2">
                    <button onClick={() => moderate(r.id, 'approved')} className="text-green-600 hover:underline">Approve</button>
                    <button onClick={() => moderate(r.id, 'rejected')} className="text-red-600 hover:underline">Reject</button>
                    <button onClick={() => moderate(r.id, 'flagged')} className="text-orange-600 hover:underline">Flag</button>
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

// ==================== Support Tab ====================
function SupportTab() {
  const [view, setView] = useState<'subscriptions' | 'copied-trades' | 'blocked-attempts' | 'imports' | 'shadow'>('subscriptions');
  const [data, setData] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/support/${view}`).then(r => { setData(r.data || []); setError(null); }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, [view]);

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {(['subscriptions', 'copied-trades', 'blocked-attempts', 'imports', 'shadow'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-3 py-1 text-sm rounded-full ${view === v ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {v.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
          </button>
        ))}
      </div>
      {error && <ErrorBox message={error} />}
      {loading ? <Loading /> : (
        <div className="bg-white shadow rounded-lg p-4 overflow-x-auto">
          {data.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No data found</p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {Object.keys(data[0]).slice(0, 6).map(k => (
                    <th key={k} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {data.map((row: any, i: number) => (
                  <tr key={i}>
                    {Object.values(row).slice(0, 6).map((val: any, j: number) => (
                      <td key={j} className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
                        {typeof val === 'object' ? JSON.stringify(val) : String(val ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ==================== Audit Log Tab ====================
function AuditLogTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/action-logs?limit=50').then(r => { setLogs(r.data || []); setError(null); }).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (loading) return <Loading />;

  return (
    <div className="bg-white shadow overflow-hidden sm:rounded-lg">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Target</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status Change</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {logs.length === 0 ? (
            <tr><td colSpan={6} className="px-4 py-4 text-sm text-gray-500 text-center">No logs found</td></tr>
          ) : logs.map((log: any, i: number) => (
            <tr key={i}>
              <td className="px-4 py-3 text-sm text-gray-500">{new Date(log.created_at).toLocaleString()}</td>
              <td className="px-4 py-3 text-sm font-medium text-gray-900">{log.action_type}</td>
              <td className="px-4 py-3 text-sm text-gray-500">{log.target_type}</td>
              <td className="px-4 py-3 text-sm text-gray-500 font-mono">{(log.target_id || '').slice(0, 8)}</td>
              <td className="px-4 py-3 text-sm text-gray-500">
                {log.old_status && log.new_status ? `${log.old_status} → ${log.new_status}` : '—'}
              </td>
              <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{log.reason || log.notes || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ==================== Shared Components ====================
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    paid: 'bg-green-100 text-green-800',
    approved: 'bg-green-100 text-green-800',
    earned: 'bg-green-100 text-green-800',
    active: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    manual_review: 'bg-yellow-100 text-yellow-800',
    awaiting_payment: 'bg-blue-100 text-blue-800',
    payout_ready: 'bg-blue-100 text-blue-800',
    expired: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-red-100 text-red-800',
    rejected: 'bg-red-100 text-red-800',
    flagged: 'bg-orange-100 text-orange-800',
    suspended: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`px-2 py-1 text-xs rounded-full ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

function ErrorBox({ message }: { message: string }) {
  return <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{message}</div>;
}

function Loading() {
  return <div className="py-8 text-center text-gray-500">Loading...</div>;
}

// ==================== Main Page ====================
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'mentors', label: 'Mentors' },
  { key: 'billing', label: 'Billing' },
  { key: 'referrals', label: 'Referrals' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'support', label: 'Support' },
  { key: 'logs', label: 'Audit Log' },
];

export default function OpsPage() {
  const [tab, setTab] = useState<Tab>('overview');

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-gray-900">Admin Operations</h1>
      <p className="mt-1 text-sm text-gray-500">Manage mentors, billing, referrals, reviews, and more</p>

      <div className="mt-6 border-b border-gray-200">
        <nav className="-mb-px flex space-x-6">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`pb-3 text-sm font-medium border-b-2 ${
                tab === t.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'mentors' && <MentorsTab />}
        {tab === 'billing' && <BillingTab />}
        {tab === 'referrals' && <ReferralsTab />}
        {tab === 'reviews' && <ReviewsTab />}
        {tab === 'support' && <SupportTab />}
        {tab === 'logs' && <AuditLogTab />}
      </div>
    </div>
  );
}
