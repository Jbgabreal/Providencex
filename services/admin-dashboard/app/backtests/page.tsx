/**
 * Backtests Page - Backtest Run History
 * 
 * Table of recent backtest runs with filters
 */

'use client';

import { useState, useEffect } from 'react';
import { BacktestRunsResponse, BacktestRunSummary } from '@/types';

const TRADING_ENGINE_BASE_URL = process.env.NEXT_PUBLIC_TRADING_ENGINE_BASE_URL || 'http://localhost:3020';

export default function BacktestsPage() {
  const [backtests, setBacktests] = useState<BacktestRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    symbol: '',
    strategy: '',
    limit: 20,
  });

  const fetchBacktests = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (filters.symbol) params.append('symbol', filters.symbol);
      if (filters.strategy) params.append('strategy', filters.strategy);
      params.append('limit', filters.limit.toString());

      const url = `${TRADING_ENGINE_BASE_URL}/api/v1/admin/backtests?${params.toString()}`;
      const res = await fetch(url);

      if (!res.ok) {
        throw new Error(`Failed to fetch backtests: ${res.statusText}`);
      }

      const data: BacktestRunsResponse = await res.json();
      setBacktests(data.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBacktests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const handleFilterChange = (key: string, value: string | number) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900">Backtest Runs</h1>
          <p className="mt-2 text-sm text-gray-700">
            View historical backtest results
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-6 bg-white shadow rounded-lg p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="symbol" className="block text-sm font-medium text-gray-700">
              Symbol
            </label>
            <input
              type="text"
              id="symbol"
              value={filters.symbol}
              onChange={(e) => handleFilterChange('symbol', e.target.value)}
              placeholder="e.g., XAUUSD"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
          <div>
            <label htmlFor="strategy" className="block text-sm font-medium text-gray-700">
              Strategy
            </label>
            <select
              id="strategy"
              value={filters.strategy}
              onChange={(e) => handleFilterChange('strategy', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            >
              <option value="">All</option>
              <option value="low">Low Risk</option>
              <option value="high">High Risk</option>
            </select>
          </div>
          <div>
            <label htmlFor="limit" className="block text-sm font-medium text-gray-700">
              Limit
            </label>
            <select
              id="limit"
              value={filters.limit}
              onChange={(e) => handleFilterChange('limit', parseInt(e.target.value))}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          Error: {error}
        </div>
      )}

      {/* Backtests Table */}
      <div className="mt-8 bg-white shadow overflow-hidden sm:rounded-md">
        {loading ? (
          <div className="px-6 py-8 text-center text-gray-500">Loading...</div>
        ) : backtests.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">
            No backtest runs found. Run a backtest using: <code className="bg-gray-100 px-2 py-1 rounded">pnpm backtest --symbol XAUUSD</code>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Created At
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Symbol
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Strategy
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Date Range
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Win Rate
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Profit Factor
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Max Drawdown
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Total Trades
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Return %
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {backtests.map((backtest) => (
                  <tr key={backtest.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(backtest.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {backtest.symbol}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {backtest.strategy}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {backtest.fromDate} to {backtest.toDate}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {backtest.winRate.toFixed(2)}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {backtest.profitFactor.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {backtest.maxDrawdownPercent.toFixed(2)}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {backtest.totalTrades}
                    </td>
                    <td
                      className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${
                        backtest.totalReturnPercent >= 0
                          ? 'text-green-600'
                          : 'text-red-600'
                      }`}
                    >
                      {backtest.totalReturnPercent >= 0 ? '+' : ''}
                      {backtest.totalReturnPercent.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

