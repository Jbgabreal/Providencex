import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

export function useDecisions(limit = 50) {
  return useQuery({
    queryKey: ['admin-decisions', limit],
    queryFn: async () => {
      const r = await apiClient.get<{ success: boolean; decisions: any[] }>(
        `/api/v1/admin/decisions?limit=${limit}`
      );
      return r.data.decisions || [];
    },
    refetchInterval: 60000,
  });
}

export function useExposure() {
  return useQuery({
    queryKey: ['admin-exposure'],
    queryFn: async () => {
      const r = await apiClient.get<{ success: boolean; exposure: any }>('/api/v1/admin/exposure');
      return r.data.exposure;
    },
    refetchInterval: 30000,
  });
}

export function useBacktests(limit = 20) {
  return useQuery({
    queryKey: ['admin-backtests', limit],
    queryFn: async () => {
      const r = await apiClient.get<{ success: boolean; data: any[] }>(
        `/api/v1/admin/backtests?limit=${limit}`
      );
      return r.data.data || [];
    },
  });
}

export function useDailyMetrics(date?: string) {
  return useQuery({
    queryKey: ['admin-daily-metrics', date],
    queryFn: async () => {
      const url = date
        ? `/api/v1/admin/metrics/daily?date=${date}`
        : '/api/v1/admin/metrics/daily';
      const r = await apiClient.get(url);
      return r.data;
    },
    refetchInterval: 120000,
  });
}
