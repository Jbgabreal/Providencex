'use client';

import { useState, useEffect } from 'react';
import { useUpdateAssignmentConfig } from '@/hooks/useStrategyAssignments';
import type { StrategyAssignment, UserTradingConfig } from '@/types/api';
import { Settings, Save, Loader2 } from 'lucide-react';

const SESSION_OPTIONS = [
  { value: 'asian' as const, label: 'Asian', time: '23:00-08:00 NY' },
  { value: 'london' as const, label: 'London', time: '03:00-12:00 NY' },
  { value: 'newyork' as const, label: 'New York', time: '08:00-17:00 NY' },
];

const SYMBOL_OPTIONS = [
  { value: 'XAUUSD', label: 'Gold (XAUUSD)' },
  { value: 'EURUSD', label: 'EUR/USD' },
  { value: 'GBPUSD', label: 'GBP/USD' },
  { value: 'USDJPY', label: 'USD/JPY' },
  { value: 'AUDUSD', label: 'AUD/USD' },
  { value: 'USDCAD', label: 'USD/CAD' },
  { value: 'USDCHF', label: 'USD/CHF' },
  { value: 'NZDUSD', label: 'NZD/USD' },
  { value: 'US30', label: 'Dow Jones (US30)' },
  { value: 'US100', label: 'Nasdaq (US100)' },
  { value: 'EURJPY', label: 'EUR/JPY' },
  { value: 'GBPJPY', label: 'GBP/JPY' },
];

interface Props {
  assignment: StrategyAssignment;
}

export function TradingSettings({ assignment }: Props) {
  const updateConfig = useUpdateAssignmentConfig();
  const [isOpen, setIsOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const existingConfig = assignment.user_config || {};

  const [riskMode, setRiskMode] = useState<'percentage' | 'usd'>(
    existingConfig.risk_mode || 'percentage'
  );
  const [riskPct, setRiskPct] = useState(existingConfig.risk_per_trade_pct ?? 0.5);
  const [riskUsd, setRiskUsd] = useState(existingConfig.risk_per_trade_usd ?? 50);
  const [maxLosses, setMaxLosses] = useState(existingConfig.max_consecutive_losses ?? 3);
  const [sessions, setSessions] = useState<Set<string>>(
    new Set(existingConfig.sessions || ['london', 'newyork'])
  );
  const [symbols, setSymbols] = useState<Set<string>>(
    new Set(existingConfig.symbols || ['XAUUSD'])
  );

  // Reset saved indicator
  useEffect(() => {
    if (saved) {
      const t = setTimeout(() => setSaved(false), 2000);
      return () => clearTimeout(t);
    }
  }, [saved]);

  const toggleSession = (session: string) => {
    const next = new Set(sessions);
    if (next.has(session)) {
      if (next.size > 1) next.delete(session);
    } else {
      next.add(session);
    }
    setSessions(next);
  };

  const toggleSymbol = (symbol: string) => {
    const next = new Set(symbols);
    if (next.has(symbol)) {
      if (next.size > 1) next.delete(symbol);
    } else {
      next.add(symbol);
    }
    setSymbols(next);
  };

  const handleSave = async () => {
    const config: UserTradingConfig = {
      risk_mode: riskMode,
      risk_per_trade_pct: riskPct,
      risk_per_trade_usd: riskUsd,
      max_consecutive_losses: maxLosses,
      sessions: Array.from(sessions) as UserTradingConfig['sessions'],
      symbols: Array.from(symbols),
    };

    try {
      await updateConfig.mutateAsync({
        assignmentId: assignment.id,
        config,
      });
      setSaved(true);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center text-sm text-gray-600 hover:text-gray-900"
      >
        <Settings className="mr-1 h-4 w-4" />
        Trading Settings
      </button>
    );
  }

  return (
    <div className="mt-4 border border-gray-200 rounded-lg p-4 bg-gray-50">
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-semibold text-gray-900 flex items-center">
          <Settings className="mr-2 h-4 w-4" />
          Trading Settings
        </h4>
        <button
          onClick={() => setIsOpen(false)}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Close
        </button>
      </div>

      {/* Risk Per Trade */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Risk Per Trade
        </label>
        <div className="flex gap-2 mb-2">
          <button
            onClick={() => setRiskMode('percentage')}
            className={`px-3 py-1.5 text-sm rounded-md ${
              riskMode === 'percentage'
                ? 'bg-green-600 text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            % of Balance
          </button>
          <button
            onClick={() => setRiskMode('usd')}
            className={`px-3 py-1.5 text-sm rounded-md ${
              riskMode === 'usd'
                ? 'bg-green-600 text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Fixed USD
          </button>
        </div>

        {riskMode === 'percentage' ? (
          <div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0.1"
                max="10"
                step="0.1"
                value={riskPct}
                onChange={(e) => setRiskPct(parseFloat(e.target.value))}
                className="flex-1"
              />
              <span className="text-sm font-medium w-14 text-right">{riskPct.toFixed(1)}%</span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Percentage of your account balance risked per trade
            </p>
          </div>
        ) : (
          <div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number"
                min="1"
                max="10000"
                value={riskUsd}
                onChange={(e) => setRiskUsd(Math.max(1, Math.min(10000, Number(e.target.value))))}
                className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Fixed dollar amount risked per trade
            </p>
          </div>
        )}
      </div>

      {/* Max Consecutive Losses */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Max Consecutive Losses (Daily Cool-Off)
        </label>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMaxLosses(Math.max(1, maxLosses - 1))}
            className="w-8 h-8 flex items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100"
          >
            -
          </button>
          <span className="text-lg font-semibold w-8 text-center">{maxLosses}</span>
          <button
            onClick={() => setMaxLosses(Math.min(10, maxLosses + 1))}
            className="w-8 h-8 flex items-center justify-center rounded-md border border-gray-300 text-gray-700 hover:bg-gray-100"
          >
            +
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Trading pauses for the day after {maxLosses} consecutive losing trade{maxLosses > 1 ? 's' : ''}
        </p>
      </div>

      {/* Trading Sessions */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Active Trading Sessions
        </label>
        <div className="space-y-2">
          {SESSION_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex items-center justify-between p-3 rounded-md border cursor-pointer transition-colors ${
                sessions.has(opt.value)
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={sessions.has(opt.value)}
                  onChange={() => toggleSession(opt.value)}
                  className="h-4 w-4 text-green-600 rounded border-gray-300 focus:ring-green-500"
                />
                <span className="ml-3 text-sm font-medium text-gray-900">{opt.label}</span>
              </div>
              <span className="text-xs text-gray-500">{opt.time}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Strategy will only take trades during selected sessions
        </p>
      </div>

      {/* Trading Pairs */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Trading Pairs
        </label>
        <div className="grid grid-cols-2 gap-2">
          {SYMBOL_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex items-center p-2 rounded-md border cursor-pointer transition-colors text-sm ${
                symbols.has(opt.value)
                  ? 'border-green-500 bg-green-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                checked={symbols.has(opt.value)}
                onChange={() => toggleSymbol(opt.value)}
                className="h-3.5 w-3.5 text-green-600 rounded border-gray-300 focus:ring-green-500"
              />
              <span className="ml-2 text-gray-900">{opt.label}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Strategy will only trade selected pairs. At least one required.
        </p>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={updateConfig.isPending}
        className={`w-full flex items-center justify-center px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
          saved
            ? 'bg-green-100 text-green-800'
            : 'bg-green-600 text-white hover:bg-green-700 disabled:opacity-50'
        }`}
      >
        {updateConfig.isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Saving...
          </>
        ) : saved ? (
          'Settings Saved!'
        ) : (
          <>
            <Save className="mr-2 h-4 w-4" />
            Save Settings
          </>
        )}
      </button>
    </div>
  );
}
