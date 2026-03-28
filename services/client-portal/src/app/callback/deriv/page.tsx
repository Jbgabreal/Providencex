'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

/**
 * Deriv OAuth Callback Page
 *
 * After user logs in at Deriv, they're redirected here with account tokens
 * directly in the URL: ?acct1=CR123&token1=abc&cur1=USD&acct2=...
 */
function DerivCallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connecting your Deriv account...');

  useEffect(() => {
    // Parse Deriv legacy OAuth response: acct1, token1, cur1, acct2, token2, cur2, ...
    const accounts: { loginid: string; token: string; currency: string }[] = [];
    for (let i = 1; i <= 10; i++) {
      const acct = params.get(`acct${i}`);
      const token = params.get(`token${i}`);
      const cur = params.get(`cur${i}`);
      if (acct && token) {
        accounts.push({ loginid: acct, token, currency: cur || 'USD' });
      }
    }

    if (accounts.length === 0) {
      setStatus('error');
      setMessage('No accounts received from Deriv. Please try again.');
      return;
    }

    // Send accounts to our backend to save
    fetch('/api/auth/deriv/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accounts }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setStatus('success');
          setMessage(`Connected ${data.accountCount || accounts.length} Deriv account(s)!`);
          setTimeout(() => router.push('/accounts'), 2000);
        } else {
          setStatus('error');
          setMessage(data.error || 'Failed to connect Deriv account');
        }
      })
      .catch(err => {
        setStatus('error');
        setMessage('Connection error: ' + err.message);
      });
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
