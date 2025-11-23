/**
 * Overview Page - Daily Metrics
 * 
 * Displays high-level daily stats, trades by symbol/strategy, and top skip reasons
 */

import { DailyMetricsResponse } from '@/types';

const TRADING_ENGINE_BASE_URL = process.env.NEXT_PUBLIC_TRADING_ENGINE_BASE_URL || 'http://localhost:3020';

async function getDailyMetrics(date?: string): Promise<DailyMetricsResponse> {
  const url = date
    ? `${TRADING_ENGINE_BASE_URL}/api/v1/admin/metrics/daily?date=${date}`
    : `${TRADING_ENGINE_BASE_URL}/api/v1/admin/metrics/daily`;

  try {
    const res = await fetch(url, {
      cache: 'no-store', // Always fetch fresh data
      next: { revalidate: 10 }, // Revalidate every 10 seconds
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch daily metrics: ${res.statusText}`);
    }

    return await res.json();
  } catch (error) {
    console.error('Error fetching daily metrics:', error);
    throw error;
  }
}

export default async function OverviewPage() {
  let metrics: DailyMetricsResponse;
  let error: string | null = null;

  try {
    metrics = await getDailyMetrics();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Unknown error';
    metrics = {
      date: new Date().toISOString().split('T')[0],
      totalDecisions: 0,
      totalTrades: 0,
      totalSkips: 0,
      tradesBySymbol: {},
      tradesByStrategy: {},
      topSkipReasons: [],
      lastUpdated: new Date().toISOString(),
    };
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900">Overview</h1>
          <p className="mt-2 text-sm text-gray-700">
            Daily trading metrics for {metrics.date}
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          Error: {error}
        </div>
      )}

      {/* Summary Cards */}
      <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-4">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Total Decisions</dt>
                  <dd className="text-lg font-medium text-gray-900">{metrics.totalDecisions}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Total Trades</dt>
                  <dd className="text-lg font-medium text-gray-900">{metrics.totalTrades}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Total Skips</dt>
                  <dd className="text-lg font-medium text-gray-900">{metrics.totalSkips}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Date</dt>
                  <dd className="text-lg font-medium text-gray-900">{metrics.date}</dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trades by Symbol */}
      <div className="mt-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Trades by Symbol</h2>
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Symbol
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Trades
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Skips
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {Object.entries(metrics.tradesBySymbol).length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                    No data available
                  </td>
                </tr>
              ) : (
                Object.entries(metrics.tradesBySymbol).map(([symbol, stats]) => (
                  <tr key={symbol}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {symbol}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {stats.trades}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {stats.skips}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Trades by Strategy */}
      <div className="mt-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Trades by Strategy</h2>
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Strategy
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Trades
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Skips
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {Object.entries(metrics.tradesByStrategy).length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                    No data available
                  </td>
                </tr>
              ) : (
                Object.entries(metrics.tradesByStrategy).map(([strategy, stats]) => (
                  <tr key={strategy}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {strategy}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {stats.trades}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {stats.skips}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Skip Reasons */}
      <div className="mt-8">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Top Skip Reasons</h2>
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <ul className="divide-y divide-gray-200">
            {metrics.topSkipReasons.length === 0 ? (
              <li className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                No skip reasons available
              </li>
            ) : (
              metrics.topSkipReasons.map((item, index) => (
                <li key={index} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-900 flex-1">
                      {item.reason}
                    </div>
                    <div className="ml-4 text-sm font-medium text-gray-500">
                      {item.count}
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}


