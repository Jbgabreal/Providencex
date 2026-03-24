'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useBillingInvoice, useRefreshInvoiceStatus } from '@/hooks/useBilling';
import { Copy, CheckCircle, Clock, AlertTriangle, XCircle, ArrowLeft, RefreshCw, ExternalLink } from 'lucide-react';

const statusConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  awaiting_payment: { color: 'bg-yellow-100 text-yellow-800', icon: <Clock className="h-5 w-5" />, label: 'Awaiting Payment' },
  detected: { color: 'bg-blue-100 text-blue-800', icon: <Clock className="h-5 w-5" />, label: 'Payment Detected' },
  confirming: { color: 'bg-blue-100 text-blue-800', icon: <RefreshCw className="h-5 w-5 animate-spin" />, label: 'Confirming' },
  paid: { color: 'bg-green-100 text-green-800', icon: <CheckCircle className="h-5 w-5" />, label: 'Paid' },
  underpaid: { color: 'bg-orange-100 text-orange-800', icon: <AlertTriangle className="h-5 w-5" />, label: 'Underpaid' },
  overpaid: { color: 'bg-purple-100 text-purple-800', icon: <CheckCircle className="h-5 w-5" />, label: 'Overpaid (Paid)' },
  expired: { color: 'bg-gray-100 text-gray-600', icon: <XCircle className="h-5 w-5" />, label: 'Expired' },
  failed: { color: 'bg-red-100 text-red-800', icon: <XCircle className="h-5 w-5" />, label: 'Failed' },
  manual_review: { color: 'bg-orange-100 text-orange-800', icon: <AlertTriangle className="h-5 w-5" />, label: 'Manual Review' },
  pending: { color: 'bg-gray-100 text-gray-600', icon: <Clock className="h-5 w-5" />, label: 'Pending' },
};

export default function InvoicePage() {
  const { id } = useParams() as { id: string };
  const { data, isLoading } = useBillingInvoice(id);
  const refreshStatus = useRefreshInvoiceStatus();
  const [copied, setCopied] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState('');

  const invoice = data?.invoice;
  const events = data?.events || [];
  const railInfo = data?.railInfo;

  // Countdown timer
  useEffect(() => {
    if (!invoice?.expires_at) return;
    const update = () => {
      const diff = new Date(invoice.expires_at).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft('Expired');
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [invoice?.expires_at]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  if (isLoading) {
    return <div className="p-6"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto" /></div>;
  }

  if (!invoice) {
    return <div className="p-6"><p className="text-gray-500">Invoice not found.</p></div>;
  }

  const status = statusConfig[invoice.status] || statusConfig.pending;
  const isActive = ['awaiting_payment', 'detected', 'confirming'].includes(invoice.status);

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <Link href="/billing" className="flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="mr-1 h-4 w-4" /> Back to Billing
      </Link>

      {/* Status Banner */}
      <div className={`rounded-lg p-4 mb-6 flex items-center gap-3 ${status.color}`}>
        {status.icon}
        <div>
          <p className="font-semibold">{status.label}</p>
          {invoice.status === 'confirming' && (
            <p className="text-sm">Confirmations: {invoice.confirmation_count} / {invoice.confirmations_required}</p>
          )}
          {invoice.status === 'paid' && invoice.paid_at && (
            <p className="text-sm">Confirmed at {new Date(invoice.paid_at).toLocaleString()}</p>
          )}
          {invoice.status === 'underpaid' && (
            <p className="text-sm">
              Received {invoice.amount_crypto_received} {invoice.token}, expected {invoice.amount_crypto_expected} {invoice.token}.
              Contact support for assistance.
            </p>
          )}
        </div>
      </div>

      {/* Payment Details */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Payment Details</h2>

        <div className="space-y-4">
          {/* Amount */}
          <div className="flex justify-between items-center py-2 border-b border-gray-100">
            <span className="text-sm text-gray-500">Amount (USD)</span>
            <span className="font-bold text-lg text-gray-900">${invoice.amount_fiat}</span>
          </div>

          {/* Crypto Amount */}
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-1">Send exactly</p>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold text-gray-900">
                {invoice.amount_crypto_expected} {invoice.token}
              </span>
              <button
                onClick={() => copyToClipboard(String(invoice.amount_crypto_expected), 'amount')}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded"
                title="Copy amount"
              >
                {copied === 'amount' ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              on {railInfo?.displayName || `${invoice.chain} network`}
            </p>
          </div>

          {/* Deposit Address */}
          <div>
            <p className="text-xs text-gray-500 mb-1">Deposit Address</p>
            <div className="flex items-center gap-2 bg-gray-50 rounded-lg p-3">
              <code className="text-sm font-mono text-gray-900 break-all flex-1">
                {invoice.deposit_address}
              </code>
              <button
                onClick={() => copyToClipboard(invoice.deposit_address, 'address')}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded flex-shrink-0"
                title="Copy address"
              >
                {copied === 'address' ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Network Info */}
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Network</span>
            <span className="font-medium">{railInfo?.displayName || invoice.payment_rail}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Exchange Rate</span>
            <span className="font-medium">1 USD = {invoice.exchange_rate_used} {invoice.token}</span>
          </div>

          {/* Expiry Countdown */}
          {isActive && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Time Remaining</span>
              <span className={`font-bold ${timeLeft === 'Expired' ? 'text-red-600' : 'text-orange-600'}`}>
                {timeLeft}
              </span>
            </div>
          )}

          {/* Transaction Hash */}
          {invoice.tx_hash && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Transaction</span>
              <span className="font-mono text-xs text-blue-600 flex items-center gap-1">
                {invoice.tx_hash.slice(0, 12)}...{invoice.tx_hash.slice(-8)}
                <ExternalLink className="h-3 w-3" />
              </span>
            </div>
          )}
        </div>

        {/* Warning */}
        {isActive && railInfo && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs text-amber-800 font-medium flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Important
            </p>
            <p className="text-xs text-amber-700 mt-1">{railInfo.networkWarning}</p>
          </div>
        )}

        {/* Refresh Button */}
        {isActive && (
          <button
            onClick={() => refreshStatus.mutate(id)}
            disabled={refreshStatus.isPending}
            className="w-full mt-4 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 text-sm flex items-center justify-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${refreshStatus.isPending ? 'animate-spin' : ''}`} />
            {refreshStatus.isPending ? 'Checking...' : 'Check Payment Status'}
          </button>
        )}
      </div>

      {/* Event History */}
      {events.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Event Log</h3>
          <div className="space-y-2">
            {events.map((event: any) => (
              <div key={event.id} className="flex items-start gap-3 text-xs">
                <span className="text-gray-400 whitespace-nowrap">
                  {new Date(event.created_at).toLocaleTimeString()}
                </span>
                <span className="text-gray-700">
                  {event.event_type}
                  {event.old_status && event.new_status && ` (${event.old_status} → ${event.new_status})`}
                  {event.amount_received && ` · ${event.amount_received} received`}
                  {event.confirmation_count !== null && ` · ${event.confirmation_count} confirmations`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
