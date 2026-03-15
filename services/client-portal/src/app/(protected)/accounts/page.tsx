'use client';

import { useState } from 'react';
import {
  useMt5Accounts,
  useCreateMt5Account,
  usePauseMt5Account,
  useResumeMt5Account,
  useDisconnectMt5Account,
} from '@/hooks/useMt5Accounts';
import type { BrokerType } from '@/types/api';
import { Plus, Pause, Play, X } from 'lucide-react';

export default function AccountsPage() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [brokerType, setBrokerType] = useState<BrokerType>('mt5');
  const [formData, setFormData] = useState({
    label: '',
    account_number: '',
    server: '',
    password: '',
    broker_name: '',
    is_demo: false,
    baseUrl: '',
    // Deriv fields
    deriv_app_id: '',
    deriv_api_token: '',
    deriv_account_id: '',
  });

  const { data: accounts, isLoading, error } = useMt5Accounts();
  const createAccount = useCreateMt5Account();
  const pauseAccount = usePauseMt5Account();
  const resumeAccount = useResumeMt5Account();
  const disconnectAccount = useDisconnectMt5Account();

  const resetForm = () => {
    setFormData({
      label: '', account_number: '', server: '', password: '',
      broker_name: '', is_demo: false, baseUrl: '',
      deriv_app_id: '', deriv_api_token: '', deriv_account_id: '',
    });
    setBrokerType('mt5');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (brokerType === 'deriv') {
        await createAccount.mutateAsync({
          account_number: formData.deriv_account_id || undefined,
          server: 'deriv',
          is_demo: formData.is_demo,
          label: formData.label || 'Deriv Account',
          broker_type: 'deriv',
          broker_credentials: {
            appId: formData.deriv_app_id,
            apiToken: formData.deriv_api_token,
            accountId: formData.deriv_account_id || undefined,
          },
        });
      } else {
        const connectionMeta: any = {};
        if (formData.baseUrl) connectionMeta.baseUrl = formData.baseUrl;
        if (formData.password) connectionMeta.password = formData.password;
        if (formData.broker_name) connectionMeta.broker_name = formData.broker_name;

        await createAccount.mutateAsync({
          account_number: formData.account_number,
          server: formData.server,
          is_demo: formData.is_demo,
          label: formData.label || undefined,
          broker_type: 'mt5',
          connection_meta: Object.keys(connectionMeta).length > 0 ? connectionMeta : undefined,
        });
      }
      setShowAddForm(false);
      resetForm();
    } catch (error) {
      console.error('Failed to create account:', error);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors = {
      connected: 'bg-green-100 text-green-800',
      paused: 'bg-yellow-100 text-yellow-800',
      disconnected: 'bg-gray-100 text-gray-800',
    };
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          colors[status as keyof typeof colors] || colors.disconnected
        }`}
      >
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const getBrokerBadge = (type: string) => {
    const label = type === 'deriv' ? 'Deriv' : 'MT5';
    const color = type === 'deriv' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800';
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
        {label}
      </span>
    );
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Trading Accounts</h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
        >
          <Plus className="mr-2 h-5 w-5" />
          Add Account
        </button>
      </div>

      {showAddForm && (
        <div className="mb-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Connect Trading Account</h2>

          {/* Broker Type Selector */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Broker Type</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setBrokerType('mt5')}
                className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                  brokerType === 'mt5'
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                MetaTrader 5
              </button>
              <button
                type="button"
                onClick={() => setBrokerType('deriv')}
                className={`px-4 py-2 rounded-lg text-sm font-medium border ${
                  brokerType === 'deriv'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Deriv
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Label (Optional)
              </label>
              <input
                type="text"
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder={brokerType === 'deriv' ? 'My Deriv Account' : 'My Trading Account'}
              />
            </div>

            {/* MT5 Fields */}
            {brokerType === 'mt5' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Number *</label>
                  <input
                    type="text" required
                    value={formData.account_number}
                    onChange={(e) => setFormData({ ...formData, account_number: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="12345678"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Server *</label>
                  <input
                    type="text" required
                    value={formData.server}
                    onChange={(e) => setFormData({ ...formData, server: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="YourBroker-Demo"
                  />
                  <p className="mt-1 text-xs text-gray-500">e.g., IC Markets-Demo, FXTM-Demo</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                  <input
                    type="password" required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Your MT5 password"
                  />
                </div>
              </>
            )}

            {/* Deriv Fields */}
            {brokerType === 'deriv' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">App ID *</label>
                  <input
                    type="text" required
                    value={formData.deriv_app_id}
                    onChange={(e) => setFormData({ ...formData, deriv_app_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Your Deriv App ID"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Register an app at deriv.com to get your App ID
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">API Token *</label>
                  <input
                    type="password" required
                    value={formData.deriv_api_token}
                    onChange={(e) => setFormData({ ...formData, deriv_api_token: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Your Deriv API token"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Create an API token with trading scope at deriv.com/account/api-token
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account ID (Optional)</label>
                  <input
                    type="text"
                    value={formData.deriv_account_id}
                    onChange={(e) => setFormData({ ...formData, deriv_account_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="CR1234567"
                  />
                </div>
              </>
            )}

            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_demo"
                checked={formData.is_demo}
                onChange={(e) => setFormData({ ...formData, is_demo: e.target.checked })}
                className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
              />
              <label htmlFor="is_demo" className="ml-2 block text-sm text-gray-700">
                Demo Account
              </label>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={createAccount.isPending}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {createAccount.isPending ? 'Connecting...' : 'Connect Account'}
              </button>
              <button
                type="button"
                onClick={() => { setShowAddForm(false); resetForm(); }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          Error: {error.message}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
        </div>
      ) : accounts && accounts.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <div key={account.id} className="bg-white rounded-lg shadow p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {account.label || 'Unnamed Account'}
                    </h3>
                    {getBrokerBadge(account.broker_type || 'mt5')}
                  </div>
                  <p className="text-sm text-gray-500">{account.account_number}</p>
                  {account.broker_type !== 'deriv' && (
                    <p className="text-xs text-gray-400">{account.server}</p>
                  )}
                </div>
                {getStatusBadge(account.status)}
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                {account.status === 'connected' && (
                  <button
                    onClick={() => pauseAccount.mutate(account.id)}
                    disabled={pauseAccount.isPending}
                    className="flex items-center px-3 py-1.5 text-sm bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200 disabled:opacity-50"
                  >
                    <Pause className="mr-1 h-4 w-4" /> Pause
                  </button>
                )}
                {account.status === 'paused' && (
                  <button
                    onClick={() => resumeAccount.mutate(account.id)}
                    disabled={resumeAccount.isPending}
                    className="flex items-center px-3 py-1.5 text-sm bg-green-100 text-green-800 rounded hover:bg-green-200 disabled:opacity-50"
                  >
                    <Play className="mr-1 h-4 w-4" /> Resume
                  </button>
                )}
                {account.status !== 'disconnected' && (
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to disconnect this account?')) {
                        disconnectAccount.mutate(account.id);
                      }
                    }}
                    disabled={disconnectAccount.isPending}
                    className="flex items-center px-3 py-1.5 text-sm bg-red-100 text-red-800 rounded hover:bg-red-200 disabled:opacity-50"
                  >
                    <X className="mr-1 h-4 w-4" /> Disconnect
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500">No trading accounts connected yet.</p>
          <p className="text-sm text-gray-400 mt-2">
            Click "Add Account" to connect your MT5 or Deriv account.
          </p>
        </div>
      )}
    </div>
  );
}
