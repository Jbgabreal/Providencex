'use client';

import { useState } from 'react';
import {
  useStrategies,
  useStrategy,
} from '@/hooks/useStrategies';
import {
  useStrategyAssignments,
  useCreateStrategyAssignment,
  usePauseAssignment,
  useResumeAssignment,
  useStopAssignment,
} from '@/hooks/useStrategyAssignments';
import { useMt5Accounts } from '@/hooks/useMt5Accounts';
import { Play, Pause, Square, ChevronRight, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import Link from 'next/link';

export default function StrategiesPage() {
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assigningTo, setAssigningTo] = useState<string>('');
  const [expandedHowItWorks, setExpandedHowItWorks] = useState<string | null>(null);

  const { data: strategies, isLoading: strategiesLoading } = useStrategies();
  const { data: accounts } = useMt5Accounts();
  const { data: assignments, isLoading: assignmentsLoading } = useStrategyAssignments();
  const createAssignment = useCreateStrategyAssignment();
  const pauseAssignment = usePauseAssignment();
  const resumeAssignment = useResumeAssignment();
  const stopAssignment = useStopAssignment();

  const connectedAccounts = accounts?.filter((acc) => acc.status === 'connected') || [];

  const handleAssign = async () => {
    if (!selectedStrategy || !assigningTo) return;
    try {
      await createAssignment.mutateAsync({
        mt5_account_id: assigningTo,
        strategy_profile_key: selectedStrategy,
      });
      setShowAssignModal(false);
      setAssigningTo('');
      setSelectedStrategy(null);
    } catch (error) {
      console.error('Failed to assign strategy:', error);
    }
  };

  const getRiskBadge = (risk: string) => {
    const colors = {
      low: 'bg-green-100 text-green-800',
      medium: 'bg-yellow-100 text-yellow-800',
      high: 'bg-red-100 text-red-800',
    };
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          colors[risk as keyof typeof colors] || colors.low
        }`}
      >
        {risk.charAt(0).toUpperCase() + risk.slice(1)} Risk
      </span>
    );
  };

  const getAssignmentStatusBadge = (status: string) => {
    const colors = {
      active: 'bg-green-100 text-green-800',
      paused: 'bg-yellow-100 text-yellow-800',
      stopped: 'bg-gray-100 text-gray-800',
    };
    return (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          colors[status as keyof typeof colors] || colors.stopped
        }`}
      >
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Strategies</h1>

      {/* Strategy Catalog */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Available Strategies</h2>
        {strategiesLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          </div>
        ) : strategies && strategies.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {strategies.map((strategy) => (
              <div key={strategy.key} className="bg-white rounded-lg shadow p-6">
                <div className="flex justify-between items-start mb-3">
                  <h3 className="text-lg font-semibold text-gray-900">{strategy.name}</h3>
                  {getRiskBadge(strategy.risk_tier)}
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  {strategy.description || 'No description available'}
                </p>

                {strategy.performance && (
                  <div className="mb-4 p-3 bg-gray-50 rounded text-xs">
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <span className="text-gray-500">Win Rate</span>
                        <p className="font-semibold text-sm text-green-700">
                          {strategy.performance.win_rate.toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Profit Factor</span>
                        <p className="font-semibold text-sm">
                          {strategy.performance.profit_factor.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Avg R:R</span>
                        <p className="font-semibold text-sm">
                          {strategy.performance.average_r?.toFixed(2) || '-'}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Total PnL</span>
                        <p className="font-semibold text-sm text-green-700">
                          ${strategy.performance.total_pnl.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Max DD</span>
                        <p className="font-semibold text-sm text-red-600">
                          {strategy.performance.max_drawdown_percent?.toFixed(1) || '-'}%
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-500">Trades</span>
                        <p className="font-semibold text-sm">
                          {strategy.performance.closed_trades || strategy.performance.total_trades || 0}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* How It Works - collapsible */}
                {strategy.key === 'ict_sweep_shift_v1' && (
                  <div className="mb-4">
                    <button
                      onClick={() => setExpandedHowItWorks(
                        expandedHowItWorks === strategy.key ? null : strategy.key
                      )}
                      className="flex items-center text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                      How It Works
                      {expandedHowItWorks === strategy.key
                        ? <ChevronUp className="ml-1 h-4 w-4" />
                        : <ChevronDown className="ml-1 h-4 w-4" />}
                    </button>
                    {expandedHowItWorks === strategy.key && (
                      <div className="mt-2 p-3 bg-blue-50 rounded text-sm text-gray-700 space-y-2">
                        <p><strong>1. Identify Liquidity</strong> — Finds key highs/lows where stop losses cluster (liquidity pools).</p>
                        <p><strong>2. Wait for the Sweep</strong> — Price runs past a key level, triggering stops and trapping retail traders.</p>
                        <p><strong>3. Confirm the Shift</strong> — A Break of Structure (BOS) or Change of Character (CHoCH) confirms smart money has reversed direction.</p>
                        <p><strong>4. Enter at OTE</strong> — Enters on an opposing candle within the 62-79% Fibonacci retracement zone, with stop loss beyond the sweep and take profit at the opposing liquidity pool.</p>
                      </div>
                    )}
                  </div>
                )}

                {connectedAccounts.length === 0 ? (
                  <Link
                    href="/accounts"
                    className="w-full flex items-center justify-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
                  >
                    <AlertCircle className="mr-2 h-4 w-4" />
                    Connect an MT5 account first
                  </Link>
                ) : (
                  <button
                    onClick={() => {
                      setSelectedStrategy(strategy.key);
                      setShowAssignModal(true);
                    }}
                    disabled={!strategy.is_available}
                    className="w-full flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                  >
                    Start Trading
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-gray-500">No strategies available.</p>
          </div>
        )}
      </div>

      {/* Active Assignments */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Active Strategy Assignments</h2>
        {assignmentsLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          </div>
        ) : assignments && assignments.length > 0 ? (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    MT5 Account
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Strategy
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Started At
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {assignments.map((assignment) => {
                  const account = accounts?.find((acc) => acc.id === assignment.mt5_account_id);
                  const strategy = strategies?.find(
                    (s) => assignment.strategy_profile_id === s.key
                  );
                  return (
                    <tr key={assignment.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {account?.label || account?.account_number || 'Unknown'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {strategy?.name || 'Unknown Strategy'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getAssignmentStatusBadge(assignment.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {assignment.started_at
                          ? new Date(assignment.started_at).toLocaleDateString()
                          : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        <div className="flex gap-2">
                          {assignment.status === 'active' && (
                            <button
                              onClick={() => pauseAssignment.mutate(assignment.id)}
                              disabled={pauseAssignment.isPending}
                              className="text-yellow-600 hover:text-yellow-900 disabled:opacity-50"
                              title="Pause"
                            >
                              <Pause className="h-4 w-4" />
                            </button>
                          )}
                          {assignment.status === 'paused' && (
                            <button
                              onClick={() => resumeAssignment.mutate(assignment.id)}
                              disabled={resumeAssignment.isPending}
                              className="text-green-600 hover:text-green-900 disabled:opacity-50"
                              title="Resume"
                            >
                              <Play className="h-4 w-4" />
                            </button>
                          )}
                          {assignment.status !== 'stopped' && (
                            <button
                              onClick={() => {
                                if (confirm('Stop this strategy assignment?')) {
                                  stopAssignment.mutate(assignment.id);
                                }
                              }}
                              disabled={stopAssignment.isPending}
                              className="text-red-600 hover:text-red-900 disabled:opacity-50"
                              title="Stop"
                            >
                              <Square className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 bg-white rounded-lg shadow">
            <p className="text-gray-500">No active strategy assignments.</p>
            <p className="text-sm text-gray-400 mt-2">
              Assign a strategy to an MT5 account to get started.
            </p>
          </div>
        )}
      </div>

      {/* Assign Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">Assign Strategy</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select MT5 Account
              </label>
              <select
                value={assigningTo}
                onChange={(e) => setAssigningTo(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">Choose an account...</option>
                {connectedAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label || account.account_number} ({account.server})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleAssign}
                disabled={!assigningTo || createAssignment.isPending}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {createAssignment.isPending ? 'Assigning...' : 'Assign'}
              </button>
              <button
                onClick={() => {
                  setShowAssignModal(false);
                  setAssigningTo('');
                  setSelectedStrategy(null);
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
