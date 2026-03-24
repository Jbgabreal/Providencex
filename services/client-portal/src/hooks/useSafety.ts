import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

const KEYS = {
  safety: (id: string) => ['subscription-safety', id] as const,
  status: (id: string) => ['subscription-status', id] as const,
  timeline: (id: string) => ['trade-timeline', id] as const,
  blocked: ['blocked-copy-attempts'] as const,
};

// ==================== Safety Settings ====================

export function useSubscriptionSafety(subscriptionId: string) {
  return useQuery({
    queryKey: KEYS.safety(subscriptionId),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        safety: any;
        recentBlocked: any[];
        guardrailEvents: any[];
      }>(`/api/user/copy-trading/subscriptions/${subscriptionId}/safety`);
      return res.data;
    },
    enabled: !!subscriptionId,
  });
}

export function useUpdateSubscriptionSafety() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...settings }: { id: string; [key: string]: any }) => {
      const res = await apiClient.patch<{ success: boolean; settings: any }>(
        `/api/user/copy-trading/subscriptions/${id}/safety`,
        settings
      );
      return res.data.settings;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: KEYS.safety(vars.id) });
      qc.invalidateQueries({ queryKey: KEYS.status(vars.id) });
    },
  });
}

// ==================== Subscription Status ====================

export function useSubscriptionStatus(subscriptionId: string) {
  return useQuery({
    queryKey: KEYS.status(subscriptionId),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; status: any }>(
        `/api/user/copy-trading/subscriptions/${subscriptionId}/status`
      );
      return res.data.status;
    },
    enabled: !!subscriptionId,
    refetchInterval: 30000, // Poll every 30s
  });
}

export function useReEnableSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (subscriptionId: string) => {
      const res = await apiClient.post<{ success: boolean }>(
        `/api/user/copy-trading/subscriptions/${subscriptionId}/re-enable`
      );
      return res.data;
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: KEYS.safety(id) });
      qc.invalidateQueries({ queryKey: KEYS.status(id) });
      qc.invalidateQueries({ queryKey: ['follower-subscriptions'] });
    },
  });
}

// ==================== Trade Timeline ====================

export function useCopiedTradeTimeline(tradeId: string) {
  return useQuery({
    queryKey: KEYS.timeline(tradeId),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; trade: any; events: any[] }>(
        `/api/user/copy-trading/copied-trades/${tradeId}/timeline`
      );
      return res.data;
    },
    enabled: !!tradeId,
  });
}

// ==================== Blocked Attempts ====================

export function useBlockedCopyAttempts() {
  return useQuery({
    queryKey: KEYS.blocked,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; blocked: any[] }>(
        '/api/user/copy-trading/blocked-copy-attempts'
      );
      return res.data.blocked || [];
    },
  });
}
