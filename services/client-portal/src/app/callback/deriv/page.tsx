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
  accountType: string;    // e.g. "trading", "wallet"
  accountCategory: string; // e.g. "trading", "wallet"
  landingCompany: string;  // e.g. "svg", "maltainvest"
  platform: string;        // e.g. "dtrade", "mt5", "dxtrade"
  server: string;          // from linked_to or landing company
  balance: string;
}

const DERIV_APP_ID = '131586';

/**
 * Fetch full account details from Deriv WebSocket API using authorize call.
 * Returns enriched account list with types, platforms, and servers.
 */
function fetchDerivAccountDetails(
  token: string,
  tokenMap: Map<string, string>
): Promise<DerivAccount[]> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
    const timeout = setTimeout(() => { ws.close(); resolve([]); }, 10000);

    ws.onopen = () => {
      ws.send(JSON.stringify({ authorize: token }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.msg_type === 'authorize' && data.authorize) {
        clearTimeout(timeout);
        ws.close();

        const auth = data.authorize;
        const accountList: any[] = auth.account_list || [];

        const accounts: DerivAccount[] = accountList.map((acct: any) => {
          const loginid = acct.loginid || '';
          const isDemo = acct.is_virtual === 1 || loginid.startsWith('VRTC');

          // Determine platform from linked_to or account_type
          let platform = 'Deriv Trader';
          let server = acct.landing_company_name || 'deriv';
          const linkedTo = acct.linked_to || [];
          for (const link of linkedTo) {
            if (link.platform === 'mt5') {
              platform = 'MT5';
              server = link.server || server;
            } else if (link.platform === 'dxtrade') {
              platform = 'Deriv X';
            } else if (link.platform === 'ctrader') {
              platform = 'cTrader';
            }
          }

          // Determine account type label
          let accountType = acct.account_type || 'trading';
          if (accountType === 'trading') accountType = 'Standard';
          else if (accountType === 'wallet') accountType = 'Wallet';
          else if (accountType === 'mt5') accountType = 'MT5';

          // Check for zero spread / specific types from account_category
          const category = acct.account_category || '';

          return {
            loginid,
            token: tokenMap.get(loginid) || '',
            currency: acct.currency || 'USD',
            isDemo,
            accountType,
            accountCategory: category,
            landingCompany: acct.landing_company_name || '',
            platform,
            server,
            balance: loginid === auth.loginid ? String(auth.balance || '0') : '',
          };
        });

        // Only return accounts that have tokens (from OAuth)
        const withTokens = accounts.filter(a => a.token);
        resolve(withTokens);
      } else if (data.error) {
        clearTimeout(timeout);
        ws.close();
        resolve([]);
      }
    };

    ws.onerror = () => { clearTimeout(timeout); resolve([]); };
  });
}

function DerivCallbackContent() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'selecting' | 'saving' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [derivAccounts, setDerivAccounts] = useState<DerivAccount[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Parse tokens from URL and fetch full account details
  useEffect(() => {
    const tokenMap = new Map<string, string>();
    let firstToken = '';

    for (let i = 1; i <= 10; i++) {
      const acct = params.get(`acct${i}`);
      const token = params.get(`token${i}`);
      if (acct && token) {
        tokenMap.set(acct, token);
        if (!firstToken) firstToken = token;
      }
    }

    if (tokenMap.size === 0) {
      setStatus('error');
      setMessage('No accounts received from Deriv. Please try again.');
      return;
    }

    // Fetch full account details from Deriv API
    fetchDerivAccountDetails(firstToken, tokenMap).then((accounts) => {
      if (accounts.length === 0) {
        // Fallback: use basic info from URL params
        const basic: DerivAccount[] = [];
        for (const [loginid, token] of tokenMap) {
          const idx = Array.from(tokenMap.keys()).indexOf(loginid) + 1;
          const cur = params.get(`cur${idx}`) || 'USD';
          basic.push({
            loginid, token, currency: cur,
            isDemo: loginid.startsWith('VRTC') || loginid.startsWith('VR'),
            accountType: 'Standard', accountCategory: 'trading',
            landingCompany: '', platform: 'Deriv', server: 'deriv', balance: '',
          });
        }
        setDerivAccounts(basic);
      } else {
        setDerivAccounts(accounts);
      }

      // Pre-select first real USD standard account
      const accts = accounts.length > 0 ? accounts : [];
      const defaultSelected = new Set<string>();
      const realUsd = accts.find(a => !a.isDemo && a.currency === 'USD');
      if (realUsd) defaultSelected.add(realUsd.loginid);
      else {
        const firstReal = accts.find(a => !a.isDemo);
        if (firstReal) defaultSelected.add(firstReal.loginid);
      }
      setSelected(defaultSelected);
      setStatus('selecting');
    });
  }, [params]);

  const toggleAccount = useCallback((loginid: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(loginid)) next.delete(loginid);
      else next.add(loginid);
      return next;
    });
  }, []);

  const handleConnect = useCallback(async () => {
    if (selected.size === 0) return;
    setStatus('saving');

    const toSave = derivAccounts.filter(a => selected.has(a.loginid));
    let savedCount = 0;
    const errors: string[] = [];

    for (const account of toSave) {
      try {
        await apiClient.post('/api/user/mt5-accounts', {
          label: `Deriv ${account.accountType} ${account.currency} ${account.isDemo ? '(Demo)' : '(Real)'}`,
          account_number: account.loginid,
          server: account.server,
          broker_type: 'deriv',
          is_demo: account.isDemo,
          broker_credentials: {
            apiToken: account.token,
            accountId: account.loginid,
            appId: DERIV_APP_ID,
            currency: account.currency,
            isDemo: account.isDemo,
            platform: account.platform,
            landingCompany: account.landingCompany,
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

        {/* Loading account details */}
        {status === 'loading' && (
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900">Loading your Deriv accounts...</h2>
            <p className="text-sm text-gray-500 mt-2">Fetching account details...</p>
          </div>
        )}

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
                        {account.currency.slice(0, 3)}
                      </div>
                      <div className="text-left">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{account.loginid}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            account.isDemo
                              ? 'bg-gray-100 text-gray-600'
                              : 'bg-green-50 text-green-700'
                          }`}>
                            {account.isDemo ? 'Demo' : 'Real'}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {account.accountType} • {account.currency}
                          {account.landingCompany && ` • ${account.landingCompany.toUpperCase()}`}
                        </div>
                        {account.server && account.server !== 'deriv' && (
                          <div className="text-[10px] text-gray-400 mt-0.5">
                            Server: {account.server}
                          </div>
                        )}
                        {account.balance && (
                          <div className="text-xs font-medium text-gray-700 mt-0.5">
                            Balance: {account.balance} {account.currency}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
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
