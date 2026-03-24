'use client';

import { useState } from 'react';
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/hooks/useNotifications';
import { Bell, Check, CheckCheck, Settings, TrendingUp, Shield, CreditCard, Gift, Info } from 'lucide-react';

const categoryIcons: Record<string, React.ReactNode> = {
  trading: <TrendingUp className="h-4 w-4 text-blue-600" />,
  safety: <Shield className="h-4 w-4 text-orange-600" />,
  billing: <CreditCard className="h-4 w-4 text-green-600" />,
  referrals: <Gift className="h-4 w-4 text-purple-600" />,
  system: <Info className="h-4 w-4 text-gray-600" />,
};

const categoryColors: Record<string, string> = {
  trading: 'bg-blue-50 border-blue-200',
  safety: 'bg-orange-50 border-orange-200',
  billing: 'bg-green-50 border-green-200',
  referrals: 'bg-purple-50 border-purple-200',
  system: 'bg-gray-50 border-gray-200',
};

const categories = ['all', 'trading', 'safety', 'billing', 'referrals', 'system'];

export default function NotificationsPage() {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showPrefs, setShowPrefs] = useState(false);

  const { data: notifications, isLoading } = useNotifications(
    selectedCategory === 'all' ? {} : { category: selectedCategory }
  );
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const { data: prefs } = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Bell className="h-6 w-6" /> Notifications
        </h1>
        <div className="flex gap-2">
          <button
            onClick={() => markAllRead.mutate(selectedCategory === 'all' ? undefined : selectedCategory)}
            disabled={markAllRead.isPending}
            className="flex items-center px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            <CheckCheck className="h-3 w-3 mr-1" /> Mark All Read
          </button>
          <button
            onClick={() => setShowPrefs(!showPrefs)}
            className="flex items-center px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            <Settings className="h-3 w-3 mr-1" /> Preferences
          </button>
        </div>
      </div>

      {/* Preferences Panel */}
      {showPrefs && prefs && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Notification Preferences</h2>
          <div className="space-y-2">
            {[
              { key: 'trading_enabled', label: 'Trading notifications', desc: 'Trade fills, failures, copies' },
              { key: 'safety_enabled', label: 'Safety notifications', desc: 'Blocked trades, auto-disable, guardrails' },
              { key: 'billing_enabled', label: 'Billing notifications', desc: 'Payments, subscriptions, invoices' },
              { key: 'referrals_enabled', label: 'Referral notifications', desc: 'New referrals, commissions' },
              { key: 'system_enabled', label: 'System notifications', desc: 'Platform updates, maintenance' },
            ].map(({ key, label, desc }) => (
              <label key={key} className="flex items-center justify-between p-2 rounded hover:bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-900">{label}</p>
                  <p className="text-xs text-gray-500">{desc}</p>
                </div>
                <input
                  type="checkbox"
                  checked={prefs[key] !== false}
                  onChange={(e) => updatePrefs.mutate({ [key]: e.target.checked })}
                  className="h-4 w-4"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Category Filters */}
      <div className="flex gap-1 mb-4 overflow-x-auto">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              selectedCategory === cat
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      {/* Notifications List */}
      {isLoading ? (
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto" />
      ) : !notifications || notifications.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <Bell className="h-8 w-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No notifications</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((n: any) => (
            <div
              key={n.id}
              className={`bg-white rounded-lg border p-4 transition-colors ${
                n.is_read ? 'border-gray-100' : categoryColors[n.category] || 'border-blue-200'
              } ${n.is_read ? 'opacity-70' : ''}`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{categoryIcons[n.category]}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-medium ${n.is_read ? 'text-gray-500' : 'text-gray-900'}`}>
                      {n.title}
                    </p>
                    {!n.is_read && (
                      <button
                        onClick={() => markRead.mutate(n.id)}
                        className="text-gray-400 hover:text-gray-600 p-1"
                        title="Mark as read"
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-400">
                      {new Date(n.created_at).toLocaleString()}
                    </span>
                    <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">
                      {n.category}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
