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

// ── Trade Journal (DB-backed, multi-strategy) ──

export function useTradeJournal(filters?: {
  strategy?: string; symbol?: string; status?: string; result?: string;
  from?: string; to?: string; limit?: number; offset?: number;
}) {
  return useQuery({
    queryKey: ['journal-trades', filters],
    queryFn: async () => {
      const params: any = {};
      if (filters?.strategy) params.strategy = filters.strategy;
      if (filters?.symbol) params.symbol = filters.symbol;
      if (filters?.status) params.status = filters.status;
      if (filters?.result) params.result = filters.result;
      if (filters?.from) params.from = filters.from;
      if (filters?.to) params.to = filters.to;
      if (filters?.limit) params.limit = filters.limit;
      if (filters?.offset) params.offset = filters.offset;
      const r = await apiClient.get('/api/v1/journal/trades', { params });
      return r.data;
    },
    refetchInterval: 30000,
  });
}

export function useJournalSummary() {
  return useQuery({
    queryKey: ['journal-summary'],
    queryFn: async () => {
      const r = await apiClient.get('/api/v1/journal/summary');
      return r.data.summary;
    },
    refetchInterval: 60000,
  });
}

export function useJournalStrategy(strategyKey: string) {
  return useQuery({
    queryKey: ['journal-strategy', strategyKey],
    queryFn: async () => {
      const r = await apiClient.get(`/api/v1/journal/strategies/${strategyKey}`);
      return r.data.stats;
    },
    enabled: !!strategyKey,
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
