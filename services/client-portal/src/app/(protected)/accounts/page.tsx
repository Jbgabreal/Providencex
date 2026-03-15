'use client';

import { useState } from 'react';
import {
  useMt5Accounts,
  useCreateMt5Account,
  usePauseMt5Account,
  useResumeMt5Account,
  useDisconnectMt5Account,
} from '@/hooks/useMt5Accounts';
import { Plus, Pause, Play, X } from 'lucide-react';

export default function AccountsPage() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    label: '',
    account_number: '',
    server: '',
    password: '',
    broker_name: '',
    is_demo: false,
    baseUrl: '',
  });

  const { data: accounts, isLoading, error } = useMt5Accounts();
  const createAccount = useCreateMt5Account();
  const pauseAccount = usePauseMt5Account();
  const resumeAccount = useResumeMt5Account();
  const disconnectAccount = useDisconnectMt5Account();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Build connection_meta with broker-specific information
      const connectionMeta: any = {};
      if (formData.baseUrl) {
        connectionMeta.baseUrl = formData.baseUrl;
      }
      if (formData.password) {
        connectionMeta.password = formData.password; // Store password securely (will be encrypted in production)
      }
      if (formData.broker_name) {
        connectionMeta.broker_name = formData.broker_name;
      }

      await createAccount.mutateAsync({
        account_number: formData.account_number,
        server: formData.server,
        is_demo: formData.is_demo,
        label: formData.label || undefined,
        connection_meta: Object.keys(connectionMeta).length > 0 ? connectionMeta : undefined,
      });
      setShowAddForm(false);
      setFormData({
        label: '',
        account_number: '',
        server: '',
        password: '',
        broker_name: '',
        is_demo: false,
        baseUrl: '',
      });
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

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">MT5 Accounts</h1>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
        >
          <Plus className="mr-2 h-5 w-5" />
          Add MT5 Account
        </button>
      </div>

      {showAddForm && (
        <div className="mb-6 bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Connect MT5 Account</h2>
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
                Your broker's MT5 server name (e.g., IC Markets-Demo, FXTM-Demo)
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
                placeholder="Your MT5 account password"
              />
              <p className="mt-1 text-xs text-gray-500">
                Your MT5 account password (stored securely)
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Broker Name (Optional)
              </label>
              <input
                type="text"
                value={formData.broker_name}
                onChange={(e) => setFormData({ ...formData, broker_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="IC Markets, FXTM, Pepperstone, etc."
              />
              <p className="mt-1 text-xs text-gray-500">
                Your broker's name (for reference)
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                MT5 Connector Base URL (Optional)
              </label>
              <input
                type="text"
                value={formData.baseUrl}
                onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                placeholder="http://localhost:3030"
              />
              <p className="mt-1 text-xs text-gray-500">
                Custom MT5 Connector URL (leave empty to use default)
              </p>
            </div>
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
                onClick={() => setShowAddForm(false)}
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
                  <h3 className="text-lg font-semibold text-gray-900">
                    {account.label || 'Unnamed Account'}
                  </h3>
                  <p className="text-sm text-gray-500">{account.account_number}</p>
                  <p className="text-xs text-gray-400">{account.server}</p>
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
                    <Pause className="mr-1 h-4 w-4" />
                    Pause
                  </button>
                )}
                {account.status === 'paused' && (
                  <button
                    onClick={() => resumeAccount.mutate(account.id)}
                    disabled={resumeAccount.isPending}
                    className="flex items-center px-3 py-1.5 text-sm bg-green-100 text-green-800 rounded hover:bg-green-200 disabled:opacity-50"
                  >
                    <Play className="mr-1 h-4 w-4" />
                    Resume
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
                    <X className="mr-1 h-4 w-4" />
                    Disconnect
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <p className="text-gray-500">No MT5 accounts connected yet.</p>
          <p className="text-sm text-gray-400 mt-2">
            Click "Add MT5 Account" to get started.
          </p>
        </div>
      )}
    </div>
  );
}
