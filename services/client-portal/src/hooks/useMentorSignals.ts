import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

const KEYS = { signals: ['mentor-signals'] as const };

export function useMentorSignals(status?: string) {
  return useQuery({
    queryKey: [...KEYS.signals, status],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; signals: any[]; total: number }>(
        '/api/user/mentor/signals', { params: { status, limit: 50 } }
      );
      return res.data;
    },
  });
}

export function usePublishSignal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      symbol: string; direction: string; entry_price: number; stop_loss: number;
      tp1?: number; tp2?: number; tp3?: number; tp4?: number;
      order_kind?: string; notes?: string; idempotency_key: string;
    }) => {
      const res = await apiClient.post<{ success: boolean; signal: any; fanout_summary: any }>(
        '/api/user/mentor/signals', data
      );
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.signals }),
  });
}

export function useSignalUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ signalId, ...data }: {
      signalId: string; update_type: string; idempotency_key: string;
      new_sl?: number; close_tp_level?: number; notes?: string;
    }) => {
      const res = await apiClient.post<{ success: boolean; update: any; propagation_summary: any }>(
        `/api/user/mentor/signals/${signalId}/update`, data
      );
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.signals }),
  });
}
