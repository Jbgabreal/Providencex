import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

const KEYS = {
  summary: ['shadow-summary'] as const,
  trades: (status?: string) => ['shadow-trades', status] as const,
  timeline: (id: string) => ['shadow-timeline', id] as const,
  performance: ['shadow-performance'] as const,
  mode: (id: string) => ['subscription-mode', id] as const,
};

export function useShadowSummary() {
  return useQuery({
    queryKey: KEYS.summary,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; summary: any }>('/api/user/shadow/summary');
      return res.data.summary;
    },
  });
}

export function useShadowTrades(status?: string) {
  return useQuery({
    queryKey: KEYS.trades(status),
    queryFn: async () => {
      const params: any = {};
      if (status) params.status = status;
      const res = await apiClient.get<{ success: boolean; trades: any[] }>(
        '/api/user/shadow/trades', { params }
      );
      return res.data.trades || [];
    },
  });
}

export function useShadowTradeTimeline(tradeId: string) {
  return useQuery({
    queryKey: KEYS.timeline(tradeId),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; trade: any; events: any[] }>(
        `/api/user/shadow/trades/${tradeId}/timeline`
      );
      return res.data;
    },
    enabled: !!tradeId,
  });
}

export function useShadowPerformance() {
  return useQuery({
    queryKey: KEYS.performance,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; performance: any }>(
        '/api/user/shadow/performance'
      );
      return res.data.performance;
    },
  });
}

export function useSubscriptionMode(subscriptionId: string) {
  return useQuery({
    queryKey: KEYS.mode(subscriptionId),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; mode: string; status: string }>(
        `/api/user/shadow/subscriptions/${subscriptionId}/mode`
      );
      return res.data;
    },
    enabled: !!subscriptionId,
  });
}

export function useUpdateSubscriptionMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, mode }: { id: string; mode: string }) => {
      const res = await apiClient.patch<{ success: boolean; subscription: any }>(
        `/api/user/shadow/subscriptions/${id}/mode`, { mode }
      );
      return res.data.subscription;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: KEYS.mode(vars.id) });
      qc.invalidateQueries({ queryKey: ['follower-subscriptions'] });
      qc.invalidateQueries({ queryKey: KEYS.summary });
    },
  });
}
