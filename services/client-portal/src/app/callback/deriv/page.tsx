'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { Loader2, CheckCircle, XCircle, Check } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';

interface DerivAccount {
  loginid: string;
  token: string;
  currency: string;
  isDemo: boolean;
}

/**
 * Deriv OAuth Callback Page
 *
 * After user logs in at Deriv, they're redirected here with account tokens
 * directly in the URL: ?acct1=CR123&token1=abc&cur1=USD&acct2=...
 *
 * Shows a selection screen so the user can pick which account(s) to connect.
 */
function DerivCallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'selecting' | 'saving' | 'success' | 'error'>('selecting');
  const [message, setMessage] = useState('');
  const [derivAccounts, setDerivAccounts] = useState<DerivAccount[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Parse accounts from URL on mount
  useEffect(() => {
    const accounts: DerivAccount[] = [];
    for (let i = 1; i <= 10; i++) {
      const acct = params.get(`acct${i}`);
      const token = params.get(`token${i}`);
      const cur = params.get(`cur${i}`);
      if (acct && token) {
        const isDemo = acct.startsWith('VRTC') || acct.startsWith('VR');
        accounts.push({ loginid: acct, token, currency: cur || 'USD', isDemo });
      }
    }

    if (accounts.length === 0) {
      setStatus('error');
      setMessage('No accounts received from Deriv. Please try again.');
      return;
    }

    setDerivAccounts(accounts);
    // Pre-select real USD accounts by default
    const defaultSelected = new Set<string>();
    accounts.forEach(a => {
      if (!a.isDemo && a.currency === 'USD') defaultSelected.add(a.loginid);
    });
    // If no real USD, select first real account
    if (defaultSelected.size === 0) {
      const firstReal = accounts.find(a => !a.isDemo);
      if (firstReal) defaultSelected.add(firstReal.loginid);
    }
    setSelected(defaultSelected);
  }, [params]);

  const toggleAccount = useCallback((loginid: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(loginid)) {
        next.delete(loginid);
      } else {
        next.add(loginid);
      }
      return next;
    });
  }, []);

  const handleConnect = useCallback(async () => {
    if (selected.size === 0) return;

    setStatus('saving');
    const appId = process.env.NEXT_PUBLIC_DERIV_APP_ID || '131586';
    const toSave = derivAccounts.filter(a => selected.has(a.loginid));
    let savedCount = 0;
    const errors: string[] = [];

    for (const account of toSave) {
      try {
        await apiClient.post('/api/user/mt5-accounts', {
          label: `Deriv ${account.currency} ${account.isDemo ? '(Demo)' : '(Real)'}`,
          account_number: account.loginid,
          server: 'deriv',
          broker_type: 'deriv',
          is_demo: account.isDemo,
          broker_credentials: {
            apiToken: account.token,
            accountId: account.loginid,
            appId,
            currency: account.currency,
            isDemo: account.isDemo,
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
  }, [selected, derivAccounts, router]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full">

        {/* Account Selection */}
        {status === 'selecting' && derivAccounts.length > 0 && (
          <>
            <h2 className="text-lg font-semibold text-gray-900 text-center mb-1">Select Deriv Account</h2>
            <p className="text-sm text-gray-500 text-center mb-5">
              Choose which account(s) to connect for trading
            </p>

            <div className="space-y-3 mb-6">
              {derivAccounts.map((account) => {
                const isSelected = selected.has(account.loginid);
                return (
                  <button
                    key={account.loginid}
                    onClick={() => toggleAccount(account.loginid)}
                    className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
                        account.isDemo
                          ? 'bg-gray-100 text-gray-600'
                          : 'bg-green-100 text-green-700'
                      }`}>
                        {account.currency.slice(0, 2)}
                      </div>
                      <div className="text-left">
                        <div className="font-medium text-gray-900">{account.loginid}</div>
                        <div className="text-xs text-gray-500">
                          {account.currency} {account.isDemo ? '• Demo' : '• Real'}
                        </div>
                      </div>
                    </div>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                      isSelected
                        ? 'border-blue-500 bg-blue-500'
                        : 'border-gray-300'
                    }`}>
                      {isSelected && <Check className="w-4 h-4 text-white" />}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleConnect}
                disabled={selected.size === 0}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Connect {selected.size > 0 ? `${selected.size} Account${selected.size > 1 ? 's' : ''}` : 'Account'}
              </button>
              <button
                onClick={() => router.push('/accounts')}
                className="px-4 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {/* Saving */}
        {status === 'saving' && (
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900">Connecting your accounts...</h2>
            <p className="text-sm text-gray-500 mt-2">Please wait...</p>
          </div>
        )}

        {/* Success */}
        {status === 'success' && (
          <div className="text-center">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900">{message}</h2>
            <p className="text-sm text-gray-500 mt-2">Redirecting to your accounts...</p>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="text-center">
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900">Connection Failed</h2>
            <p className="text-sm text-red-600 mt-2">{message}</p>
            <button
              onClick={() => router.push('/accounts')}
              className="mt-4 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200"
            >
              Back to Accounts
            </button>
          </div>
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
          <h2 className="text-lg font-semibold text-gray-900">Loading your Deriv accounts...</h2>
          <p className="text-sm text-gray-500 mt-2">Please wait...</p>
        </div>
      </div>
    }>
      <DerivCallbackContent />
    </Suspense>
  );
}
