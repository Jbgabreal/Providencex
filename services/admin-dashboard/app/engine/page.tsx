'use client';

import { useState, useEffect, useCallback } from 'react';

const BASE_URL = process.env.NEXT_PUBLIC_TRADING_ENGINE_BASE_URL || 'http://localhost:3020';

interface FeedStatus {
  symbol: string;
  tickAgeMs: number | null;
  lastTickBid: number | null;
  lastTickAsk: number | null;
  candleCount: number;
  lastCandleTime: string | null;
  lastCandleClose: number | null;
}

interface Decision {
  id: string;
  timestamp: string;
  symbol: string;
  strategy: string;
  decision: string;
  guardrail_mode: string;
  signal_reason?: string;
  risk_reason?: string;
  execution_filter_action?: string;
  kill_switch_active?: boolean;
}

interface POI {
  symbol: string;
  direction: 'buy' | 'sell';
  type: string;
  h4Bias: string;
  msbType: string;
  obHigh: number;
  obLow: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  currentPrice: number;
  distanceToEntry: number;
  distancePct: string;
  equilibrium: number;
  updatedAt: string;
  status: 'watching' | 'approaching' | 'in_zone' | 'invalidated';
}

interface EngineStatus {
  success: boolean;
  engine: { feedRunning: boolean; symbolCount: number; uptime: number };
  feedStatus: FeedStatus[];
  decisionCounts: { total: number; trades: number; skips: number; last1h: number };
  recentDecisions: Decision[];
  pointsOfInterest?: POI[];
}

function formatAge(ms: number | null): string {
  if (ms === null) return 'No data';
  if (ms < 1000) return `${ms}ms ago`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  return `${Math.round(ms / 3600000)}h ago`;
}

function healthBadge(ms: number | null) {
  if (ms === null) return <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-600">No Data</span>;
  if (ms < 30000) return <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">Live</span>;
  if (ms < 120000) return <span className="px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800">Stale</span>;
  return <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">Dead</span>;
}

export default function EnginePage() {
  const [data, setData] = useState<EngineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/admin/engine-status`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fetch failed');
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (error) return <div className="px-4"><div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mt-4">Error: {error}</div></div>;
  if (!data) return <div className="px-4 py-8 text-gray-500">Loading engine status...</div>;

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-gray-900">Engine Monitor</h1>
      <p className="mt-1 text-sm text-gray-500">Auto-refreshes every 10 seconds</p>

      {/* Summary Cards */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="bg-white shadow rounded-lg p-5">
          <p className="text-sm text-gray-500">Feed Status</p>
          <p className={`text-lg font-semibold ${data.engine.feedRunning ? 'text-green-600' : 'text-red-600'}`}>
            {data.engine.feedRunning ? 'Running' : 'Stopped'}
          </p>
        </div>
        <div className="bg-white shadow rounded-lg p-5">
          <p className="text-sm text-gray-500">Symbols Tracked</p>
          <p className="text-lg font-semibold text-gray-900">{data.engine.symbolCount}</p>
        </div>
        <div className="bg-white shadow rounded-lg p-5">
          <p className="text-sm text-gray-500">Decisions (last 1h)</p>
          <p className="text-lg font-semibold text-gray-900">{data.decisionCounts.last1h}</p>
        </div>
        <div className="bg-white shadow rounded-lg p-5">
          <p className="text-sm text-gray-500">Trades / Skips (all time)</p>
          <p className="text-lg font-semibold">
            <span className="text-green-600">{data.decisionCounts.trades}</span>
            {' / '}
            <span className="text-gray-500">{data.decisionCounts.skips}</span>
          </p>
        </div>
      </div>

      {/* Points of Interest */}
      {data.pointsOfInterest && data.pointsOfInterest.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-medium text-gray-900 mb-3">Points of Interest (Pending Setups)</h2>
          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">OB Zone</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entry</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SL</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">TP</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">R:R</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Price</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Distance</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {data.pointsOfInterest.map((poi) => (
                  <tr key={poi.symbol} className={poi.status === 'in_zone' ? 'bg-green-50' : poi.status === 'approaching' ? 'bg-yellow-50' : ''}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{poi.symbol}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded-full font-medium ${poi.direction === 'buy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {poi.direction.toUpperCase()} LIMIT
                      </span>
                      <span className="ml-1 text-xs text-gray-400">{poi.h4Bias}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">{poi.obLow.toFixed(5)} - {poi.obHigh.toFixed(5)}</td>
                    <td className="px-4 py-3 text-sm font-medium text-blue-600">{poi.entryPrice.toFixed(5)}</td>
                    <td className="px-4 py-3 text-sm text-red-500">{poi.stopLoss.toFixed(5)}</td>
                    <td className="px-4 py-3 text-sm text-green-600">{poi.takeProfit.toFixed(5)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">1:{poi.riskRewardRatio}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{poi.currentPrice.toFixed(5)}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{poi.distancePct}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        poi.status === 'in_zone' ? 'bg-green-100 text-green-800' :
                        poi.status === 'approaching' ? 'bg-yellow-100 text-yellow-800' :
                        poi.status === 'invalidated' ? 'bg-red-100 text-red-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>{poi.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Price Feed Status */}
      <div className="mt-8">
        <h2 className="text-lg font-medium text-gray-900 mb-3">Price Feed Status</h2>
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Tick</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bid / Ask</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Candles</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Candle</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.feedStatus.map((f) => (
                <tr key={f.symbol}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{f.symbol}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{formatAge(f.tickAgeMs)}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {f.lastTickBid?.toFixed(5)} / {f.lastTickAsk?.toFixed(5)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{f.candleCount}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {f.lastCandleTime ? new Date(f.lastCandleTime).toLocaleTimeString() : '—'}
                  </td>
                  <td className="px-4 py-3">{healthBadge(f.tickAgeMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Decisions */}
      <div className="mt-8">
        <h2 className="text-lg font-medium text-gray-900 mb-3">Recent Strategy Decisions</h2>
        <div className="bg-white shadow overflow-hidden sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Strategy</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Symbol</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Decision</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Guardrail</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Exec Filter</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Kill Switch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.recentDecisions.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(d.timestamp).toLocaleTimeString()}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      d.strategy?.includes('GOD') ? 'bg-purple-100 text-purple-800' :
                      d.strategy?.includes('Silver') ? 'bg-cyan-100 text-cyan-800' :
                      'bg-indigo-100 text-indigo-800'
                    }`}>{d.strategy}</span>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{d.symbol}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${d.decision === 'trade' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                      {d.decision.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      d.guardrail_mode === 'strict' ? 'bg-red-100 text-red-800' :
                      d.guardrail_mode === 'reduced' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-600'
                    }`}>{d.guardrail_mode}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
                    {d.signal_reason || d.risk_reason || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {d.execution_filter_action || '—'}
                  </td>
                  <td className="px-4 py-3">
                    {d.kill_switch_active
                      ? <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">ACTIVE</span>
                      : <span className="text-sm text-gray-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
