'use client';

import { useState, useEffect } from 'react';

const TRADING_ENGINE_BASE_URL = process.env.NEXT_PUBLIC_TRADING_ENGINE_BASE_URL || 'http://localhost:3020';

interface SystemSetting {
  value: any;
  description: string | null;
  updated_at: string;
}

interface SettingsResponse {
  success: boolean;
  settings: Record<string, SystemSetting>;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, SystemSetting>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${TRADING_ENGINE_BASE_URL}/api/v1/admin/settings`, {
        headers: { 'x-user-role': 'admin', 'x-user-id': 'admin-dashboard', 'x-user-email': 'admin@providencex.com' },
      });
      if (!res.ok) {
        throw new Error(`Failed to load settings: ${res.statusText}`);
      }
      const data: SettingsResponse = await res.json();
      setSettings(data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (key: string, currentValue: any) => {
    setEditing({
      ...editing,
      [key]: typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue),
    });
  };

  const handleCancel = (key: string) => {
    const newEditing = { ...editing };
    delete newEditing[key];
    setEditing(newEditing);
  };

  const handleSave = async (key: string) => {
    try {
      setSaving({ ...saving, [key]: true });
      setError(null);

      const valueStr = editing[key];
      let value: any;
      try {
        // Try to parse as JSON first
        value = JSON.parse(valueStr);
      } catch {
        // If not valid JSON, treat as string
        value = valueStr;
      }

      const res = await fetch(`${TRADING_ENGINE_BASE_URL}/api/v1/admin/settings/${key}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': 'admin',
          'x-user-id': 'admin-dashboard',
          'x-user-email': 'admin@providencex.com',
        },
        body: JSON.stringify({
          value,
          description: settings[key]?.description || null,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `Failed to save setting: ${res.statusText}`);
      }

      // Reload settings to get updated values
      await loadSettings();
      
      // Clear editing state
      const newEditing = { ...editing };
      delete newEditing[key];
      setEditing(newEditing);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save setting');
    } finally {
      setSaving({ ...saving, [key]: false });
    }
  };

  if (loading) {
    return (
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-500">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">System Settings</h1>
          <p className="mt-2 text-sm text-gray-700">
            Configure system-wide settings. Changes take effect immediately.
          </p>
        </div>
        <button
          onClick={loadSettings}
          className="mt-4 sm:mt-0 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {Object.keys(settings).length === 0 ? (
            <li className="px-6 py-4 text-center text-gray-500">
              No settings configured
            </li>
          ) : (
            Object.entries(settings).map(([key, setting]) => {
              const isEditing = editing[key] !== undefined;
              const displayValue = isEditing ? editing[key] : (typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value));

              return (
                <li key={key} className="px-6 py-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center">
                        <h3 className="text-sm font-medium text-gray-900">{key}</h3>
                        {setting.description && (
                          <span className="ml-2 text-xs text-gray-500">({setting.description})</span>
                        )}
                      </div>
                      {isEditing ? (
                        <div className="mt-2">
                          <input
                            type="text"
                            value={displayValue}
                            onChange={(e) => setEditing({ ...editing, [key]: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                            placeholder="Enter value"
                          />
                        </div>
                      ) : (
                        <p className="mt-1 text-sm text-gray-500 font-mono">
                          {displayValue}
                        </p>
                      )}
                      {setting.updated_at && (
                        <p className="mt-1 text-xs text-gray-400">
                          Last updated: {new Date(setting.updated_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <div className="ml-4 flex-shrink-0">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSave(key)}
                            disabled={saving[key]}
                            className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            {saving[key] ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={() => handleCancel(key)}
                            disabled={saving[key]}
                            className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEdit(key, setting.value)}
                          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Admin MT5 Account Info */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-green-900 mb-2">🔍 Admin MT5 Account (Analysis)</h3>
          <p className="text-sm text-green-800 mb-2">
            The <code className="bg-green-100 px-1 rounded">admin_mt5_connector_url</code> setting is used for:
          </p>
          <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
            <li>Price feeds and market data</li>
            <li>Strategy detection and analysis</li>
            <li>Trade confirmation signals</li>
            <li>Market structure analysis</li>
          </ul>
          <p className="text-xs text-green-700 mt-2">
            This is the &quot;master&quot; account that runs the trading strategies and decides when to trade.
          </p>
        </div>

        {/* User MT5 Account Info */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-sm font-medium text-blue-900 mb-2">💰 User MT5 Accounts (Execution)</h3>
          <p className="text-sm text-blue-800 mb-2">
            The <code className="bg-blue-100 px-1 rounded">mt5_connector_url</code> setting is used as:
          </p>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>Default URL for user accounts</li>
            <li>Trade execution only</li>
            <li>Position management (trailing stops, closes)</li>
            <li>Open position tracking</li>
          </ul>
          <p className="text-xs text-blue-700 mt-2">
            Users can override this by providing their own baseUrl when connecting accounts.
          </p>
        </div>
      </div>

      <div className="mt-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-900 mb-2">About System Settings</h3>
        <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
          <li>Settings are stored in the database and persist across service restarts</li>
          <li>Changes take effect immediately (services read from database with 1-minute caching)</li>
          <li>Environment variables serve as fallback if database settings are not available</li>
          <li>String values can be entered directly, JSON values should be valid JSON</li>
        </ul>
      </div>
    </div>
  );
}

