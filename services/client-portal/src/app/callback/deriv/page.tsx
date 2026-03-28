'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';

/**
 * Deriv OAuth Callback Page
 *
 * After user logs in at Deriv, they're redirected here with account tokens
 * directly in the URL: ?acct1=CR123&token1=abc&cur1=USD&acct2=...
 *
 * We save each account directly to the trading engine via apiClient
 * (which automatically includes the Privy auth token).
 */
function DerivCallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connecting your Deriv account...');

  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_DERIV_APP_ID || '131586';

    // Parse Deriv legacy OAuth response: acct1, token1, cur1, acct2, token2, cur2, ...
    const derivAccounts: { loginid: string; token: string; currency: string }[] = [];
    for (let i = 1; i <= 10; i++) {
      const acct = params.get(`acct${i}`);
      const token = params.get(`token${i}`);
      const cur = params.get(`cur${i}`);
      if (acct && token) {
        derivAccounts.push({ loginid: acct, token, currency: cur || 'USD' });
      }
    }

    if (derivAccounts.length === 0) {
      setStatus('error');
      setMessage('No accounts received from Deriv. Please try again.');
      return;
    }

    // Save each account directly via apiClient (has Privy auth token)
    const saveAccounts = async () => {
      let savedCount = 0;
      const errors: string[] = [];

      for (const account of derivAccounts) {
        const isDemo = account.loginid.startsWith('VRTC') || account.loginid.startsWith('VR');
        try {
          await apiClient.post('/api/user/mt5-accounts', {
            label: `Deriv ${account.currency} ${isDemo ? '(Demo)' : '(Real)'}`,
            account_number: account.loginid,
            server: 'deriv',
            broker_type: 'deriv',
            is_demo: isDemo,
            broker_credentials: {
              apiToken: account.token,
              accountId: account.loginid,
              appId,
              currency: account.currency,
              isDemo,
            },
          });
          savedCount++;
        } catch (err: any) {
          const msg = err?.response?.data?.error || err.message;
          console.error(`[Deriv OAuth] Failed to save ${account.loginid}:`, msg);
          errors.push(`${account.loginid}: ${msg}`);
        }
      }

      if (savedCount > 0) {
        setStatus('success');
        setMessage(`Connected ${savedCount} Deriv account(s)!`);
        setTimeout(() => router.push('/accounts'), 2000);
      } else {
        setStatus('error');
        setMessage(`Failed to save accounts: ${errors.join(', ')}`);
      }
    };

    saveAccounts();
  }, [params, router]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900">{message}</h2>
            <p className="text-sm text-gray-500 mt-2">Please wait while we connect your account...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900">{message}</h2>
            <p className="text-sm text-gray-500 mt-2">Redirecting to your accounts...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900">Connection Failed</h2>
            <p className="text-sm text-red-600 mt-2">{message}</p>
            <button
              onClick={() => router.push('/accounts')}
              className="mt-4 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
            >
              Back to Accounts
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function DerivCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900">Connecting your Deriv account...</h2>
          <p className="text-sm text-gray-500 mt-2">Please wait while we connect your account...</p>
        </div>
      </div>
    }>
      <DerivCallbackContent />
    </Suspense>
  );
}
