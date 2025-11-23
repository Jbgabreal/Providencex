/**
 * Decisions Page - Recent Trade Decisions
 * 
 * Table of recent decisions with filters and pagination
 */

'use client';

import { useState, useEffect } from 'react';
import { AdminDecisionsResponse, AdminDecision } from '@/types';

const TRADING_ENGINE_BASE_URL = process.env.NEXT_PUBLIC_TRADING_ENGINE_BASE_URL || 'http://localhost:3020';

export default function DecisionsPage() {
  const [decisions, setDecisions] = useState<AdminDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    symbol: '',
    strategy: '',
    decision: '',
    limit: 50,
    offset: 0,
  });
  const [pagination, setPagination] = useState({
    limit: 50,
    offset: 0,
    total: 0,
  });

  const fetchDecisions = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (filters.symbol) params.append('symbol', filters.symbol);
      if (filters.strategy) params.append('strategy', filters.strategy);
      if (filters.decision) params.append('decision', filters.decision);
      params.append('limit', filters.limit.toString());
      params.append('offset', filters.offset.toString());

      const url = `${TRADING_ENGINE_BASE_URL}/api/v1/admin/decisions?${params.toString()}`;
      const res = await fetch(url);

      if (!res.ok) {
        throw new Error(`Failed to fetch decisions: ${res.statusText}`);
      }

      const data: AdminDecisionsResponse = await res.json();
      setDecisions(data.data);
      setPagination(data.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDecisions();
  }, [filters]);

  const handleFilterChange = (key: string, value: string | number) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
      offset: 0, // Reset offset when filters change
    }));
  };

  const handlePageChange = (newOffset: number) => {
    setFilters((prev) => ({
      ...prev,
      offset: newOffset,
    }));
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900">Recent Decisions</h1>
          <p className="mt-2 text-sm text-gray-700">
            View and filter recent trade decisions
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-6 bg-white shadow rounded-lg p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
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
            <label htmlFor="decision" className="block text-sm font-medium text-gray-700">
              Decision
            </label>
            <select
              id="decision"
              value={filters.decision}
              onChange={(e) => handleFilterChange('decision', e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            >
              <option value="">All</option>
              <option value="trade">Trade</option>
              <option value="skip">Skip</option>
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
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          Error: {error}
        </div>
      )}

      {/* Decisions Table */}
      <div className="mt-8 bg-white shadow overflow-hidden sm:rounded-md">
        {loading ? (
          <div className="px-6 py-8 text-center text-gray-500">Loading...</div>
        ) : decisions.length === 0 ? (
          <div className="px-6 py-8 text-center text-gray-500">No decisions found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Symbol
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Strategy
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Decision
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Direction
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reasons
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {decisions.map((decision) => (
                  <tr key={decision.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(decision.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {decision.symbol}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {decision.strategy}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          decision.decision === 'trade'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {decision.decision.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {decision.direction || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      <div className="space-y-1">
                        {decision.guardrailReason && (
                          <div>Guardrail: {decision.guardrailReason}</div>
                        )}
                        {decision.riskReason && <div>Risk: {decision.riskReason}</div>}
                        {decision.signalReason && (
                          <div>Signal: {decision.signalReason}</div>
                        )}
                        {decision.executionFilterReasons &&
                          decision.executionFilterReasons.length > 0 && (
                            <div>
                              Filter:{' '}
                              {decision.executionFilterReasons.join('; ')}
                            </div>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && decisions.length > 0 && (
          <div className="bg-white px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => handlePageChange(Math.max(0, pagination.offset - pagination.limit))}
                disabled={pagination.offset === 0}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                onClick={() => handlePageChange(pagination.offset + pagination.limit)}
                disabled={
                  pagination.total !== undefined &&
                  pagination.offset + pagination.limit >= pagination.total
                }
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Showing{' '}
                  <span className="font-medium">{pagination.offset + 1}</span> to{' '}
                  <span className="font-medium">
                    {Math.min(pagination.offset + pagination.limit, pagination.total || 0)}
                  </span>{' '}
                  of <span className="font-medium">{pagination.total || 0}</span> results
                </p>
              </div>
              <div>
                <nav
                  className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px"
                  aria-label="Pagination"
                >
                  <button
                    onClick={() => handlePageChange(Math.max(0, pagination.offset - pagination.limit))}
                    disabled={pagination.offset === 0}
                    className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => handlePageChange(pagination.offset + pagination.limit)}
                    disabled={
                      pagination.total !== undefined &&
                      pagination.offset + pagination.limit >= pagination.total
                    }
                    className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </nav>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


