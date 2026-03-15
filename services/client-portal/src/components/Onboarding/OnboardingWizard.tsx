'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMt5Accounts, useCreateMt5Account } from '@/hooks/useMt5Accounts';
import { useStrategies } from '@/hooks/useStrategies';
import {
  useStrategyAssignments,
  useCreateStrategyAssignment,
} from '@/hooks/useStrategyAssignments';
import { CheckCircle, ArrowRight, ArrowLeft, Loader2 } from 'lucide-react';

type Step = 'welcome' | 'connect-mt5' | 'select-strategy' | 'live';

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('welcome');
  const [error, setError] = useState<string | null>(null);
  const [createdAccountId, setCreatedAccountId] = useState<string | null>(null);
  const [selectedStrategyKey, setSelectedStrategyKey] = useState<string | null>(null);

  // MT5 form state
  const [formData, setFormData] = useState({
    label: '',
    account_number: '',
    server: '',
    password: '',
    broker_name: '',
    is_demo: false,
    baseUrl: '',
  });

  const { data: accounts } = useMt5Accounts();
  const { data: strategies } = useStrategies();
  const { data: assignments } = useStrategyAssignments();
  const createAccount = useCreateMt5Account();
  const createAssignment = useCreateStrategyAssignment();

  const handleConnectMt5 = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const connectionMeta: Record<string, string> = {};
      if (formData.baseUrl) connectionMeta.baseUrl = formData.baseUrl;
      if (formData.password) connectionMeta.password = formData.password;
      if (formData.broker_name) connectionMeta.broker_name = formData.broker_name;

      const account = await createAccount.mutateAsync({
        account_number: formData.account_number,
        server: formData.server,
        is_demo: formData.is_demo,
        label: formData.label || undefined,
        connection_meta: Object.keys(connectionMeta).length > 0 ? connectionMeta : undefined,
      });
      setCreatedAccountId(account.id);
      setStep('select-strategy');
    } catch (err: any) {
      setError(err.message || 'Failed to connect account');
    }
  };

  const handleSelectStrategy = async (strategyKey: string) => {
    setError(null);
    setSelectedStrategyKey(strategyKey);
    const accountId = createdAccountId || accounts?.[0]?.id;
    if (!accountId) {
      setError('No MT5 account found');
      return;
    }
    try {
      await createAssignment.mutateAsync({
        mt5_account_id: accountId,
        strategy_profile_key: strategyKey,
      });
      setStep('live');
    } catch (err: any) {
      setError(err.message || 'Failed to assign strategy');
    }
  };

  const selectedStrategy = strategies?.find((s) => s.key === selectedStrategyKey);
  const connectedAccount = createdAccountId
    ? accounts?.find((a) => a.id === createdAccountId)
    : accounts?.[0];

  const stepIndex = ['welcome', 'connect-mt5', 'select-strategy', 'live'].indexOf(step);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
      <div className="max-w-xl w-full">
        {/* Progress bar */}
        <div className="flex items-center justify-center mb-8 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  i < stepIndex
                    ? 'bg-green-600 text-white'
                    : i === stepIndex
                    ? 'bg-green-600 text-white ring-4 ring-green-100'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {i < stepIndex ? <CheckCircle className="h-5 w-5" /> : i + 1}
              </div>
              {i < 3 && (
                <div
                  className={`w-12 h-0.5 mx-1 ${
                    i < stepIndex ? 'bg-green-600' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8">
          {/* Step 1: Welcome */}
          {step === 'welcome' && (
            <div className="text-center">
              <h1 className="text-3xl font-bold text-gray-900 mb-3">
                Welcome to ProvidenceX
              </h1>
              <p className="text-gray-600 mb-2">
                Automated trading powered by institutional-grade strategies.
              </p>
              <p className="text-sm text-gray-500 mb-8">
                Connect your MT5 account, select a proven strategy, and let the system trade for you.
                You stay in full control — pause or stop anytime.
              </p>
              <button
                onClick={() => setStep('connect-mt5')}
                className="px-8 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium text-lg"
              >
                Get Started
                <ArrowRight className="inline ml-2 h-5 w-5" />
              </button>
            </div>
          )}

          {/* Step 2: Connect MT5 */}
          {step === 'connect-mt5' && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">Connect Your MT5 Account</h2>
              <p className="text-sm text-gray-500 mb-6">
                Enter your MetaTrader 5 credentials. We&apos;ll connect securely to execute trades on your behalf.
              </p>

              {error && (
                <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleConnectMt5} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Account Label (Optional)
                  </label>
                  <input
                    type="text"
                    value={formData.label}
                    onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="My Trading Account"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Account Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.account_number}
                    onChange={(e) => setFormData({ ...formData, account_number: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="12345678"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Server *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.server}
                    onChange={(e) => setFormData({ ...formData, server: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="YourBroker-Demo"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    e.g., IC Markets-Demo, FXTM-Demo
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Password *
                  </label>
                  <input
                    type="password"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Your MT5 password"
                  />
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="onboard_is_demo"
                    checked={formData.is_demo}
                    onChange={(e) => setFormData({ ...formData, is_demo: e.target.checked })}
                    className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                  />
                  <label htmlFor="onboard_is_demo" className="ml-2 block text-sm text-gray-700">
                    This is a demo account
                  </label>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setStep('welcome')}
                    className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                  >
                    <ArrowLeft className="inline mr-1 h-4 w-4" />
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={createAccount.isPending}
                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
                  >
                    {createAccount.isPending ? (
                      <>
                        <Loader2 className="inline mr-2 h-4 w-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        Connect Account
                        <ArrowRight className="inline ml-2 h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Step 3: Select Strategy */}
          {step === 'select-strategy' && (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-1">Choose Your Strategy</h2>
              <p className="text-sm text-gray-500 mb-6">
                Select a trading strategy. It will start monitoring the markets and trading automatically.
              </p>

              {error && (
                <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                {strategies?.filter((s) => s.is_available).map((strategy) => (
                  <button
                    key={strategy.key}
                    onClick={() => handleSelectStrategy(strategy.key)}
                    disabled={createAssignment.isPending}
                    className="w-full text-left p-4 border-2 border-gray-200 rounded-xl hover:border-green-500 hover:bg-green-50 transition-colors disabled:opacity-50"
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-semibold text-gray-900">{strategy.name}</h3>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        {strategy.risk_tier.charAt(0).toUpperCase() + strategy.risk_tier.slice(1)} Risk
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mb-3">{strategy.description}</p>
                    {strategy.performance && (
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="bg-gray-50 rounded p-2 text-center">
                          <span className="text-gray-500 block">Win Rate</span>
                          <span className="font-semibold text-green-700">{strategy.performance.win_rate.toFixed(1)}%</span>
                        </div>
                        <div className="bg-gray-50 rounded p-2 text-center">
                          <span className="text-gray-500 block">Profit Factor</span>
                          <span className="font-semibold">{strategy.performance.profit_factor.toFixed(2)}</span>
                        </div>
                        <div className="bg-gray-50 rounded p-2 text-center">
                          <span className="text-gray-500 block">PnL</span>
                          <span className="font-semibold text-green-700">${strategy.performance.total_pnl.toFixed(0)}</span>
                        </div>
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {createAssignment.isPending && (
                <div className="mt-4 text-center text-sm text-gray-500">
                  <Loader2 className="inline mr-2 h-4 w-4 animate-spin" />
                  Assigning strategy...
                </div>
              )}

              <button
                type="button"
                onClick={() => setStep('connect-mt5')}
                className="mt-4 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                <ArrowLeft className="inline mr-1 h-4 w-4" />
                Back
              </button>
            </div>
          )}

          {/* Step 4: You're Live */}
          {step === 'live' && (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="h-10 w-10 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">You&apos;re Live!</h2>
              <p className="text-gray-600 mb-6">
                Your strategy is now active and monitoring the markets.
              </p>

              <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left text-sm">
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-gray-500">MT5 Account</span>
                  <span className="font-medium">
                    {connectedAccount?.label || connectedAccount?.account_number || '-'}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-gray-500">Strategy</span>
                  <span className="font-medium">{selectedStrategy?.name || '-'}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-gray-500">Status</span>
                  <span className="inline-flex items-center font-medium text-green-700">
                    <span className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse" />
                    Active — Monitoring Markets
                  </span>
                </div>
              </div>

              <button
                onClick={() => router.push('/dashboard')}
                className="px-8 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium text-lg"
              >
                Go to Dashboard
                <ArrowRight className="inline ml-2 h-5 w-5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
