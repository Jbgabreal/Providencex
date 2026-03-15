import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

const KEYS = { subs: ['follower-subscriptions'] as const };

export function useFollowerSubscriptions() {
  return useQuery({
    queryKey: KEYS.subs,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; subscriptions: any[] }>(
        '/api/user/copy-trading/subscriptions'
      );
      return res.data.subscriptions || [];
    },
  });
}

export function useSubscribeToMentor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      mentor_profile_id: string; mt5_account_id: string;
      mode?: string; risk_mode?: string; risk_amount?: number; selected_tp_levels?: number[];
    }) => {
      const res = await apiClient.post<{ success: boolean; subscription: any }>(
        '/api/user/copy-trading/subscriptions', data
      );
      return res.data.subscription;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.subs }),
  });
}

export function useUpdateSubscriptionConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...config }: {
      id: string; mode?: string; risk_mode?: string; risk_amount?: number; selected_tp_levels?: number[];
    }) => {
      const res = await apiClient.patch<{ success: boolean; subscription: any }>(
        `/api/user/copy-trading/subscriptions/${id}/config`, config
      );
      return res.data.subscription;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.subs }),
  });
}

export function usePauseSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ success: boolean }>(`/api/user/copy-trading/subscriptions/${id}/pause`);
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.subs }),
  });
}

export function useResumeSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ success: boolean }>(`/api/user/copy-trading/subscriptions/${id}/resume`);
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.subs }),
  });
}

export function useStopSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ success: boolean }>(`/api/user/copy-trading/subscriptions/${id}/stop`);
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.subs }),
  });
}
