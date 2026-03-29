'use client';

import { useAnalyticsSummary, useEquityCurve, useOpenPositions, useTrades } from '@/hooks/useAnalytics';
import { useState } from 'react';
import { useStrategyAssignments, usePauseAssignment, useResumeAssignment, useClosePosition, useSwitchStrategy } from '@/hooks/useStrategyAssignments';
import { useStrategies } from '@/hooks/useStrategies';
import { useMt5Accounts } from '@/hooks/useMt5Accounts';
import { TradingSettings } from '@/components/TradingSettings';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, DollarSign, Target, Play, Pause, ArrowRight, X, RefreshCw } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useAnalyticsSummary();
  const { data: equityCurve, isLoading: curveLoading } = useEquityCurve();
  const { data: openPositions, isLoading: positionsLoading } = useOpenPositions();
  const { data: assignments } = useStrategyAssignments();
  const { data: strategies } = useStrategies();
  const { data: accounts } = useMt5Accounts();
  const { data: recentTrades } = useTrades({ limit: 1 });
  const pauseAssignment = usePauseAssignment();
  const resumeAssignment = useResumeAssignment();
  const closePosition = useClosePosition();
  const switchStrategy = useSwitchStrategy();
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const activeAssignments = assignments?.filter((a) => a.status === 'active' || a.status === 'paused') || [];
  const hasAccounts = accounts && accounts.length > 0;
  const hasActiveStrategy = activeAssignments.length > 0;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      {/* Quick-start banner: has accounts but no active strategy */}
      {hasAccounts && !hasActiveStrategy && (
        <div className="mb-6 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="font-semibold text-green-900">Ready to trade?</p>
            <p className="text-sm text-green-700">Your MT5 account is connected. Assign a strategy to start automated trading.</p>
          </div>
          <Link
            href="/strategies"
            className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium text-sm whitespace-nowrap"
          >
            Assign a strategy
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      )}

      {/* Active Strategy Status */}
      {hasActiveStrategy && (
        <div className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {activeAssignments.map((assignment) => {
            const strategyName = assignment.strategy_name
              || strategies?.find((s) => s.key === (assignment.strategy_key || assignment.strategy_profile_id))?.name
              || 'Strategy';
            const account = accounts?.find((a) => a.id === assignment.mt5_account_id);
            const lastTrade = recentTrades?.trades?.[0];

            return (
              <div key={assignment.id} className="bg-white rounded-lg shadow p-5 border-l-4 border-green-500">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2">
                    {switchingId === assignment.id ? (
                      <select
                        className="text-sm font-semibold text-gray-900 border border-gray-300 rounded-md px-2 py-1 bg-white focus:ring-2 focus:ring-green-500 focus:border-green-500"
                        defaultValue={assignment.strategy_key || ''}
                        onChange={(e) => {
                          const newKey = e.target.value;
                          if (newKey && newKey !== assignment.strategy_key) {
                            switchStrategy.mutate(
                              { assignmentId: assignment.id, strategyProfileKey: newKey },
                              { onSettled: () => setSwitchingId(null) }
                            );
                          } else {
                            setSwitchingId(null);
                          }
                        }}
                        onBlur={() => setSwitchingId(null)}
                        autoFocus
                      >
                        {strategies?.map((s) => (
                          <option key={s.key} value={s.key}>{s.name}</option>
                        ))}
                      </select>
                    ) : (
                      <>
                        <h3 className="font-semibold text-gray-900">{strategyName}</h3>
                        <button
                          onClick={() => setSwitchingId(assignment.id)}
                          className="text-gray-400 hover:text-gray-600 transition-colors"
                          title="Switch strategy"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    assignment.status === 'active'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {assignment.status === 'active' && (
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5 animate-pulse" />
                    )}
                    {assignment.status === 'active' ? 'Active — Monitoring Markets' : 'Paused'}
                  </span>
                </div>
                <div className="text-sm text-gray-500 space-y-1 mb-3">
                  <p>MT5: {account?.label || account?.account_number || '-'}</p>
                  {assignment.started_at && (
                    <p>Started: {new Date(assignment.started_at).toLocaleDateString()}</p>
                  )}
                  <p>
                    Last trade:{' '}
                    {lastTrade?.opened_at
                      ? getTimeAgo(lastTrade.opened_at)
                      : 'Waiting for first trade'}
                  </p>
                </div>
                <div className="flex gap-2">
                  {assignment.status === 'active' && (
                    <button
                      onClick={() => pauseAssignment.mutate(assignment.id)}
                      disabled={pauseAssignment.isPending}
                      className="flex items-center px-3 py-1.5 text-sm bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200 disabled:opacity-50"
                    >
                      <Pause className="mr-1 h-3.5 w-3.5" />
                      Pause
                    </button>
                  )}
                  {assignment.status === 'paused' && (
                    <button
                      onClick={() => resumeAssignment.mutate(assignment.id)}
                      disabled={resumeAssignment.isPending}
                      className="flex items-center px-3 py-1.5 text-sm bg-green-100 text-green-800 rounded hover:bg-green-200 disabled:opacity-50"
                    >
                      <Play className="mr-1 h-3.5 w-3.5" />
                      Resume
                    </button>
                  )}
                </div>

                <TradingSettings assignment={assignment} />
              </div>
            );
          })}
        </div>
      )}

      {/* Summary Cards */}
      {summaryLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-lg shadow p-6 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div className="h-8 bg-gray-200 rounded w-3/4"></div>
            </div>
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Total PnL</span>
              <DollarSign className="h-5 w-5 text-gray-400" />
            </div>
            <p
              className={`text-2xl font-bold ${
                summary.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'
              }`}
            >
              {formatCurrency(summary.totalPnL)}
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Win Rate</span>
              <Target className="h-5 w-5 text-gray-400" />
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {summary.winRate.toFixed(1)}%
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {summary.totalWins}W / {summary.totalLosses}L
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Profit Factor</span>
              <TrendingUp className="h-5 w-5 text-gray-400" />
            </div>
            <p className="text-2xl font-bold text-gray-900">
              {summary.profitFactor.toFixed(2)}
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Max Drawdown</span>
              <TrendingDown className="h-5 w-5 text-gray-400" />
            </div>
            <p className="text-2xl font-bold text-red-600">
              {summary.maxDrawdownPercent.toFixed(1)}%
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {formatCurrency(summary.maxDrawdown)}
            </p>
          </div>
        </div>
      ) : null}

      {/* Equity Curve Chart */}
      <div className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Equity Curve</h2>
        {curveLoading ? (
          <div className="h-64 flex items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
          </div>
        ) : equityCurve && equityCurve.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={equityCurve}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={(value) => new Date(value).toLocaleDateString()}
              />
              <YAxis tickFormatter={(value) => `$${value.toFixed(0)}`} />
              <Tooltip
                formatter={(value: number) => formatCurrency(value)}
                labelFormatter={(label) => new Date(label).toLocaleDateString()}
              />
              <Line
                type="monotone"
                dataKey="equity"
                stroke="#22c55e"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-64 flex items-center justify-center text-gray-500">
            No equity curve data available
          </div>
        )}
      </div>

      {/* Open Positions */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Open Positions</h2>
        </div>
        {positionsLoading ? (
          <div className="p-6 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
          </div>
        ) : openPositions && openPositions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Symbol
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Direction
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Entry
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Lot Size
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Stop Loss
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Take Profit
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {openPositions.map((position) => (
                  <tr key={position.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {position.symbol}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          position.direction === 'BUY'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {position.direction}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {Number(position.entry_price).toFixed(5)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {position.lot_size}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {position.stop_loss_price != null ? Number(position.stop_loss_price).toFixed(5) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {position.take_profit_price != null ? Number(position.take_profit_price).toFixed(5) : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <button
                        onClick={() => {
                          if (confirm(`Close ${position.symbol} ${position.direction} position?`)) {
                            closePosition.mutate({
                              ticket: position.mt5_ticket,
                              reason: 'User manual close',
                            });
                          }
                        }}
                        disabled={closePosition.isPending}
                        className="flex items-center px-2.5 py-1 text-xs bg-red-100 text-red-800 rounded hover:bg-red-200 disabled:opacity-50 font-medium"
                      >
                        <X className="mr-1 h-3 w-3" />
                        Close
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-center text-gray-500">
            No open positions
          </div>
        )}
      </div>
    </div>
  );
}
