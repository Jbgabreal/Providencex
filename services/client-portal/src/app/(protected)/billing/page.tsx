'use client';

import Link from 'next/link';
import { useBillingStatus, useInvoices, useMentorBillingSubscriptions } from '@/hooks/useBilling';
import { CreditCard, Clock, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

const statusColors: Record<string, string> = {
  paid: 'bg-green-100 text-green-800',
  active: 'bg-green-100 text-green-800',
  awaiting_payment: 'bg-yellow-100 text-yellow-800',
  detected: 'bg-blue-100 text-blue-800',
  confirming: 'bg-blue-100 text-blue-800',
  expired: 'bg-gray-100 text-gray-600',
  failed: 'bg-red-100 text-red-800',
  underpaid: 'bg-orange-100 text-orange-800',
  overpaid: 'bg-purple-100 text-purple-800',
  manual_review: 'bg-orange-100 text-orange-800',
  cancelled: 'bg-gray-100 text-gray-600',
};

export default function BillingPage() {
  const { data: billing, isLoading } = useBillingStatus();
  const { data: invoices } = useInvoices();
  const { data: mentorSubs } = useMentorBillingSubscriptions();

  if (isLoading) {
    return <div className="p-6"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto" /></div>;
  }

  const entitlements = billing?.entitlements;
  const plan = entitlements?.platformPlan;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Billing & Subscriptions</h1>

      {/* Current Platform Plan */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <CreditCard className="h-5 w-5" /> Platform Plan
            </h2>
            <div className="mt-2">
              <span className="text-2xl font-bold text-gray-900">
                {plan?.name || 'Free'}
              </span>
              {plan && Number(plan.price_usd) > 0 && (
                <span className="text-gray-500 ml-2">${plan.price_usd}/month</span>
              )}
            </div>
            {entitlements?.platformSubscription?.expires_at && (
              <p className="text-sm text-gray-500 mt-1">
                Expires: {new Date(entitlements.platformSubscription.expires_at).toLocaleDateString()}
              </p>
            )}
          </div>
          <Link
            href="/pricing"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            {plan && plan.slug !== 'free' ? 'Change Plan' : 'Upgrade'}
          </Link>
        </div>

        {/* Entitlement Summary */}
        <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-xs text-gray-500">Auto-Trade</p>
            <p className="text-sm font-medium">{entitlements?.canAutoTrade ? 'Enabled' : 'Disabled'}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500">Mentor Subs</p>
            <p className="text-sm font-medium">{entitlements?.canSubscribeToMentors ? 'Enabled' : 'Disabled'}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500">Max Mentors</p>
            <p className="text-sm font-medium">{entitlements?.maxMentorSubscriptions || 0}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-gray-500">API Access</p>
            <p className="text-sm font-medium">{entitlements?.hasApiAccess ? 'Yes' : 'No'}</p>
          </div>
        </div>
      </div>

      {/* Active Mentor Subscriptions */}
      {mentorSubs && mentorSubs.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Mentor Subscriptions</h2>
          <div className="space-y-3">
            {mentorSubs.map((sub: any) => (
              <div key={sub.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-sm text-gray-900">{sub.plan?.name || 'Plan'}</p>
                  <p className="text-xs text-gray-500">
                    ${sub.plan?.price_usd}/month
                    {sub.expires_at && ` · Expires ${new Date(sub.expires_at).toLocaleDateString()}`}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[sub.status] || 'bg-gray-100'}`}>
                  {sub.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invoice History */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Payment History</h2>
        {(!invoices || invoices.length === 0) ? (
          <p className="text-sm text-gray-500">No invoices yet.</p>
        ) : (
          <div className="space-y-2">
            {invoices.map((inv: any) => (
              <Link
                key={inv.id}
                href={`/billing/invoice/${inv.id}`}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {inv.status === 'paid' ? <CheckCircle className="h-4 w-4 text-green-600" /> :
                   inv.status === 'expired' || inv.status === 'failed' ? <XCircle className="h-4 w-4 text-red-500" /> :
                   inv.status === 'manual_review' ? <AlertTriangle className="h-4 w-4 text-orange-500" /> :
                   <Clock className="h-4 w-4 text-yellow-500" />}
                  <div>
                    <p className="font-medium text-sm text-gray-900">
                      {inv.invoice_type === 'platform_plan' ? 'Platform Plan' : 'Mentor Plan'} · ${inv.amount_fiat}
                    </p>
                    <p className="text-xs text-gray-500">
                      {inv.amount_crypto_expected} {inv.token} on {inv.chain} · {new Date(inv.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[inv.status] || 'bg-gray-100'}`}>
                  {inv.status.replace('_', ' ')}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
