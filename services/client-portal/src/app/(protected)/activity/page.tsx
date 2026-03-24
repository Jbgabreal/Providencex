'use client';

import { useState } from 'react';
import { useTrades, useOpenPositions } from '@/hooks/useAnalytics';
import { useMt5Accounts } from '@/hooks/useMt5Accounts';
import { useStrategyAssignments } from '@/hooks/useStrategyAssignments';

export default function ActivityPage() {
  const [mt5AccountFilter, setMt5AccountFilter] = useState<string>('');
  const [strategyFilter, setStrategyFilter] = useState<string>('');

  const { data: accounts } = useMt5Accounts();
  const { data: assignments } = useStrategyAssignments();
  const { data: tradesData, isLoading: tradesLoading } = useTrades({
    mt5_account_id: mt5AccountFilter || undefined,
    strategy_profile_id: strategyFilter || undefined,
  });
  const { data: openPositions, isLoading: positionsLoading } = useOpenPositions({
    mt5_account_id: mt5AccountFilter || undefined,
    strategy_profile_id: strategyFilter || undefined,
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Activity</h1>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              MT5 Account
            </label>
            <select
              value={mt5AccountFilter}
              onChange={(e) => setMt5AccountFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">All Accounts</option>
              {accounts?.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label || account.account_number}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Strategy
            </label>
            <select
              value={strategyFilter}
              onChange={(e) => setStrategyFilter(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="">All Strategies</option>
              {assignments?.map((assignment) => (
                <option key={assignment.id} value={assignment.strategy_profile_id}>
                  Strategy {assignment.strategy_profile_id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Open Positions */}
      <div className="bg-white rounded-lg shadow mb-6">
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
                    Size
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Opened
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
                      {new Date(position.opened_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-center text-gray-500">No open positions</div>
        )}
      </div>

      {/* Trade History */}
      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Trade History</h2>
        </div>
        {tradesLoading ? (
          <div className="p-6 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
          </div>
        ) : tradesData && tradesData.trades.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Symbol
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Direction
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Size
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Entry
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Exit
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    PnL
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {tradesData.trades.map((trade) => (
                  <tr key={trade.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {trade.closed_at
                        ? new Date(trade.closed_at).toLocaleDateString()
                        : new Date(trade.opened_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {trade.symbol}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          trade.direction === 'BUY'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {trade.direction}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {trade.lot_size}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {Number(trade.entry_price).toFixed(5)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {trade.exit_price != null ? Number(trade.exit_price).toFixed(5) : '-'}
                    </td>
                    <td
                      className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${
                        (trade.profit || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {trade.profit !== null
                        ? `$${Number(trade.profit).toFixed(2)}`
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-center text-gray-500">No trade history</div>
        )}
      </div>
    </div>
  );
}
