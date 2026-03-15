/**
 * Strategy Hooks
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import type { Strategy, StrategiesResponse } from '@/types/api';

const QUERY_KEYS = {
  all: ['strategies'] as const,
  lists: () => [...QUERY_KEYS.all, 'list'] as const,
  list: (riskTier?: string) => [...QUERY_KEYS.lists(), riskTier] as const,
  detail: (key: string) => [...QUERY_KEYS.all, 'detail', key] as const,
};

export function useStrategies(riskTier?: 'low' | 'medium' | 'high') {
  return useQuery<Strategy[]>({
    queryKey: QUERY_KEYS.list(riskTier),
    queryFn: async () => {
      const params = riskTier ? { risk_tier: riskTier } : {};
      const response = await apiClient.get<StrategiesResponse>(
        '/api/user/strategies',
        { params }
      );
      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to fetch strategies');
      }
      return response.data.strategies;
    },
  });
}

export function useStrategy(key: string) {
  return useQuery<Strategy>({
    queryKey: QUERY_KEYS.detail(key),
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; strategy: Strategy }>(
        `/api/user/strategies/${key}`
      );
      if (!response.data.success || !response.data.strategy) {
        throw new Error('Failed to fetch strategy');
      }
      return response.data.strategy;
    },
    enabled: !!key,
  });
}

