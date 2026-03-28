'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

/**
 * Deriv OAuth Callback Page
 *
 * After user logs in at Deriv, they're redirected here with an auth code.
 * We exchange the code for an access token and save their accounts.
 */
export default function DerivCallbackPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connecting your Deriv account...');

  useEffect(() => {
    const code = params.get('code');
    const error = params.get('error');
    const errorDesc = params.get('error_description');

    if (error) {
      setStatus('error');
      setMessage(errorDesc || `Deriv login failed: ${error}`);
      return;
    }

    if (!code) {
      setStatus('error');
      setMessage('No authorization code received from Deriv');
      return;
    }

    // Exchange the auth code for access token via our backend
    const codeVerifier = sessionStorage.getItem('deriv_code_verifier');
    if (!codeVerifier) {
      setStatus('error');
      setMessage('Session expired. Please try connecting again.');
      return;
    }

    fetch('/api/auth/deriv/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, codeVerifier }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setStatus('success');
          setMessage(`Connected ${data.accounts?.length || 1} Deriv account(s)!`);
          sessionStorage.removeItem('deriv_code_verifier');
          sessionStorage.removeItem('deriv_state');
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
