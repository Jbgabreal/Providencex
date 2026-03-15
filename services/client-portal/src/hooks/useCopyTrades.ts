import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

const KEYS = { trades: ['copy-trades'] as const };

export function useCopyTrades(limit = 50) {
  return useQuery({
    queryKey: [...KEYS.trades, limit],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; trades: any[]; total: number }>(
        '/api/user/copy-trading/trades', { params: { limit } }
      );
      return res.data;
    },
  });
}

export function useCloseCopyTrade() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const res = await apiClient.post<{ success: boolean }>(`/api/user/copy-trading/trades/${id}/close`, { reason });
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.trades }),
  });
}
