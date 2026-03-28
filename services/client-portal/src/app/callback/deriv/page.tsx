'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { Loader2, CheckCircle, XCircle, Check } from 'lucide-react';
import { apiClient } from '@/lib/apiClient';

interface SelectableAccount {
  loginid: string;
  token: string;       // The OAuth token for the parent CR account
  currency: string;
  isDemo: boolean;
  accountType: string;  // "Standard", "Zero Spread", "Deriv Options", etc.
  platform: string;     // "MT5", "Deriv Trader", "Deriv X", "cTrader"
  server: string;
  balance: string;
  group: string;        // Raw group string from Deriv
  parentLoginid: string; // The CR account this belongs to
}

const DERIV_APP_ID = '131586';

/**
 * Parse MT5 account type from the group string.
 * e.g. "real\\p01_ts03\\financial\\svg_standard-hr_usd" → "Standard"
 *      "real\\p02_ts01\\financial\\svg_zero-spread-hr_usd" → "Zero Spread"
 */
function parseMt5Type(group: string): string {
  const lower = group.toLowerCase();
  if (lower.includes('zero-spread') || lower.includes('zero_spread')) return 'Zero Spread';
  if (lower.includes('standard')) return 'Standard';
  if (lower.includes('swap-free') || lower.includes('swap_free')) return 'Swap Free';
  if (lower.includes('micro')) return 'Micro';
  if (lower.includes('gold')) return 'Gold';
  if (lower.includes('financial')) return 'Financial';
  if (lower.includes('synthetic')) return 'Synthetic';
  if (lower.includes('demo')) return 'Demo';
  return 'Standard';
}

/**
 * Fetch all accounts from Deriv: authorize → get account_list + mt5_login_list.
 * Returns both top-level Deriv accounts and MT5 sub-accounts.
 */
function fetchAllDerivAccounts(
  token: string,
  tokenMap: Map<string, string>
): Promise<SelectableAccount[]> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
    const timeout = setTimeout(() => { ws.close(); resolve([]); }, 15000);

    let authData: any = null;
    let mt5List: any[] | null = null;
    let platformAccounts: any[] | null = null;

    const buildResult = () => {
      if (!authData || mt5List === null) return; // Wait for both responses
      clearTimeout(timeout);
      ws.close();

      const auth = authData;
      const accountList: any[] = auth.account_list || [];
      const results: SelectableAccount[] = [];

      // 1) Add MT5 sub-accounts (these are what the user wants to select)
      for (const mt5 of mt5List) {
        const login = String(mt5.login || mt5.account_id || '');
        const isDemo = mt5.account_type === 'demo';
        const group = mt5.group || '';
        const mt5Type = parseMt5Type(group);
        const server = mt5.server_info?.environment || mt5.server || '';

        // Find parent CR account to get the OAuth token
        // MT5 accounts are linked to CR accounts; use the first real token
        let parentToken = '';
        let parentLoginid = '';
        for (const [cr, tok] of tokenMap) {
          if (!cr.startsWith('VRTC') || isDemo) {
            parentToken = tok;
            parentLoginid = cr;
            if (!isDemo && !cr.startsWith('VRTC')) break;
          }
        }

        results.push({
          loginid: login,
          token: parentToken,
          currency: mt5.currency || 'USD',
          isDemo,
          accountType: mt5Type,
          platform: 'MT5',
          server,
          balance: String(mt5.balance || '0'),
          group,
          parentLoginid,
        });
      }

      // 2) Add top-level Deriv accounts (Options/Multipliers)
      for (const acct of accountList) {
        const loginid = acct.loginid || '';
        const tok = tokenMap.get(loginid);
        if (!tok) continue; // Only show accounts we have tokens for

        const isDemo = acct.is_virtual === 1 || loginid.startsWith('VRTC');

        results.push({
          loginid,
          token: tok,
          currency: acct.currency || 'USD',
          isDemo,
          accountType: 'Options/Multipliers',
          platform: 'Deriv Trader',
          server: acct.landing_company_name || 'deriv',
          balance: loginid === auth.loginid ? String(auth.balance || '0') : '',
          group: '',
          parentLoginid: loginid,
        });
      }

      resolve(results);
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({ authorize: token }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      if (data.msg_type === 'authorize' && data.authorize) {
        authData = data.authorize;
        // Now fetch MT5 accounts
        ws.send(JSON.stringify({ mt5_login_list: 1 }));
      } else if (data.msg_type === 'mt5_login_list') {
        mt5List = data.mt5_login_list || [];
        buildResult();
      } else if (data.msg_type === 'authorize' && data.error) {
        clearTimeout(timeout);
        ws.close();
        resolve([]);
      } else if (data.error && data.msg_type === 'mt5_login_list') {
        // mt5_login_list might fail if user has no MT5 accounts
        mt5List = [];
        buildResult();
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
  const [accounts, setAccounts] = useState<SelectableAccount[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

    fetchAllDerivAccounts(firstToken, tokenMap).then((allAccounts) => {
      if (allAccounts.length === 0) {
        // Fallback: basic accounts from URL params
        const basic: SelectableAccount[] = [];
        let idx = 1;
        for (const [loginid, token] of tokenMap) {
          const cur = params.get(`cur${idx}`) || 'USD';
          basic.push({
            loginid, token, currency: cur,
            isDemo: loginid.startsWith('VRTC') || loginid.startsWith('VR'),
            accountType: 'Trading', platform: 'Deriv', server: 'deriv',
            balance: '', group: '', parentLoginid: loginid,
          });
          idx++;
        }
        setAccounts(basic);
      } else {
        setAccounts(allAccounts);
      }

      // Pre-select: first real MT5 Standard USD, or first real account
      const accts = allAccounts.length > 0 ? allAccounts : [];
      const defaultSelected = new Set<string>();
      const mt5Standard = accts.find(a => !a.isDemo && a.platform === 'MT5' && a.accountType === 'Standard' && a.currency === 'USD');
      if (mt5Standard) {
        defaultSelected.add(mt5Standard.loginid);
      } else {
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

    const toSave = accounts.filter(a => selected.has(a.loginid));
    let savedCount = 0;
    const errors: string[] = [];

    for (const account of toSave) {
      try {
        const isMt5 = account.platform === 'MT5';
        await apiClient.post('/api/user/mt5-accounts', {
          label: isMt5
            ? `Deriv MT5 ${account.accountType} ${account.currency} ${account.isDemo ? '(Demo)' : '(Real)'}`
            : `Deriv ${account.currency} ${account.isDemo ? '(Demo)' : '(Real)'}`,
          account_number: account.loginid,
          server: account.server || 'deriv',
          broker_type: 'deriv',
          is_demo: account.isDemo,
          broker_credentials: {
            apiToken: account.token,
            accountId: account.loginid,
            appId: DERIV_APP_ID,
            currency: account.currency,
            isDemo: account.isDemo,
            platform: account.platform,
            accountType: account.accountType,
            group: account.group,
            parentLoginid: account.parentLoginid,
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
      setMessage(`Connected ${savedCount} account(s)!`);
      setTimeout(() => router.push('/accounts'), 2000);
    } else {
      setStatus('error');
      setMessage(`Failed to save accounts: ${errors.join(', ')}`);
    }
  }, [selected, accounts, router]);

  // Group accounts by platform for display
  const mt5Accounts = accounts.filter(a => a.platform === 'MT5');
  const derivAccounts = accounts.filter(a => a.platform !== 'MT5');

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full">

        {/* Loading */}
        {status === 'loading' && (
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900">Loading your Deriv accounts...</h2>
            <p className="text-sm text-gray-500 mt-2">Fetching account details...</p>
          </div>
        )}

        {/* Account Selection */}
        {status === 'selecting' && accounts.length > 0 && (
          <>
            <h2 className="text-lg font-semibold text-gray-900 text-center mb-1">Select Account to Connect</h2>
            <p className="text-sm text-gray-500 text-center mb-5">
              Choose which account(s) to use for trading
            </p>

            {/* MT5 Accounts */}
            {mt5Accounts.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                  MT5 Accounts
                </div>
                <div className="space-y-2">
                  {mt5Accounts.map((account) => (
                    <AccountCard
                      key={account.loginid}
                      account={account}
                      isSelected={selected.has(account.loginid)}
                      onToggle={() => toggleAccount(account.loginid)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Deriv Accounts */}
            {derivAccounts.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                  Deriv Accounts
                </div>
                <div className="space-y-2">
                  {derivAccounts.map((account) => (
                    <AccountCard
                      key={account.loginid}
                      account={account}
                      isSelected={selected.has(account.loginid)}
                      onToggle={() => toggleAccount(account.loginid)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 mt-6">
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

function AccountCard({ account, isSelected, onToggle }: {
  account: SelectableAccount;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const isMt5 = account.platform === 'MT5';

  const typeColor = account.accountType === 'Zero Spread'
    ? 'bg-orange-50 text-orange-700'
    : account.accountType === 'Standard'
    ? 'bg-blue-50 text-blue-700'
    : account.accountType === 'Swap Free'
    ? 'bg-teal-50 text-teal-700'
    : 'bg-gray-50 text-gray-700';

  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all ${
        isSelected
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold ${
          account.isDemo ? 'bg-gray-100 text-gray-500'
          : isMt5 ? 'bg-indigo-100 text-indigo-700'
          : 'bg-green-100 text-green-700'
        }`}>
          {isMt5 ? 'MT5' : account.currency.slice(0, 3)}
        </div>
        <div className="text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900">
              {isMt5 ? `MT5 ${account.accountType}` : `${account.currency} Account`}
            </span>
            {isMt5 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${typeColor}`}>
                {account.accountType}
              </span>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              account.isDemo ? 'bg-gray-100 text-gray-600' : 'bg-green-50 text-green-700'
            }`}>
              {account.isDemo ? 'Demo' : 'Real'}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {account.loginid} • {account.currency}
            {account.server && account.server !== 'deriv' && ` • ${account.server}`}
          </div>
          {account.balance && account.balance !== '0' && (
            <div className="text-xs font-medium text-gray-700 mt-0.5">
              Balance: {account.balance} {account.currency}
            </div>
          )}
        </div>
      </div>
      <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
        isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
      }`}>
        {isSelected && <Check className="w-4 h-4 text-white" />}
      </div>
    </button>
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
