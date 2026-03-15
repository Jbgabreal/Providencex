/**
 * Analytics Hooks
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { useAuth } from '@/context/AuthContext';
import type {
  Trade,
  OpenPosition,
  AnalyticsSummary,
  EquityCurvePoint,
  TradesResponse,
  OpenPositionsResponse,
  AnalyticsSummaryResponse,
  EquityCurveResponse,
} from '@/types/api';

const QUERY_KEYS = {
  all: ['analytics'] as const,
  trades: (params?: any) => [...QUERY_KEYS.all, 'trades', params] as const,
  openPositions: (params?: any) => [...QUERY_KEYS.all, 'open-positions', params] as const,
  summary: (params?: any) => [...QUERY_KEYS.all, 'summary', params] as const,
  equityCurve: (params?: any) => [...QUERY_KEYS.all, 'equity-curve', params] as const,
};

interface TradesParams {
  mt5_account_id?: string;
  strategy_profile_id?: string;
  limit?: number;
  offset?: number;
}

export function useTrades(params?: TradesParams) {
  const { isAuthenticated } = useAuth();
  
  return useQuery<{ trades: Trade[]; total: number }>({
    queryKey: QUERY_KEYS.trades(params),
    queryFn: async () => {
      const response = await apiClient.get<{
        success: boolean;
        trades: Trade[];
        pagination?: { total: number };
        total?: number;
      }>('/api/user/analytics/trades', { params });
      if (!response.data.success) {
        throw new Error('Failed to fetch trades');
      }
      return {
        trades: response.data.trades || [],
        total: response.data.pagination?.total || response.data.total || 0,
      };
    },
    enabled: isAuthenticated, // Only fetch when authenticated
  });
}

export function useOpenPositions(params?: {
  mt5_account_id?: string;
  strategy_profile_id?: string;
}) {
  const { isAuthenticated } = useAuth();
  
  return useQuery<OpenPosition[]>({
    queryKey: QUERY_KEYS.openPositions(params),
    queryFn: async () => {
      const response = await apiClient.get<OpenPositionsResponse>(
        '/api/user/analytics/open-positions',
        { params }
      );
      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to fetch open positions');
      }
      return response.data.positions || [];
    },
    enabled: isAuthenticated, // Only fetch when authenticated
  });
}

export function useAnalyticsSummary(params?: {
  mt5_account_id?: string;
  strategy_profile_id?: string;
}) {
  const { isAuthenticated } = useAuth();
  
  return useQuery<AnalyticsSummary>({
    queryKey: QUERY_KEYS.summary(params),
    queryFn: async () => {
      const response = await apiClient.get<AnalyticsSummaryResponse>(
        '/api/user/analytics/summary',
        { params }
      );
      if (!response.data.success || !response.data.summary) {
        throw new Error('Failed to fetch analytics summary');
      }
      return response.data.summary;
    },
    enabled: isAuthenticated, // Only fetch when authenticated
  });
}

export function useEquityCurve(params?: {
  mt5_account_id?: string;
  strategy_profile_id?: string;
  fromDate?: string;
  toDate?: string;
}) {
  const { isAuthenticated } = useAuth();
  
  return useQuery<EquityCurvePoint[]>({
    queryKey: QUERY_KEYS.equityCurve(params),
    queryFn: async () => {
      const response = await apiClient.get<EquityCurveResponse>(
        '/api/user/analytics/equity-curve',
        { params }
      );
      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to fetch equity curve');
      }
      return response.data.curve || [];
    },
    enabled: isAuthenticated, // Only fetch when authenticated
  });
}

