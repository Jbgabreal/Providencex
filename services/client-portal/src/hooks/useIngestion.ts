import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

const KEYS = {
  sources: ['import-sources'] as const,
  messages: ['import-messages'] as const,
  candidates: (status?: string) => ['import-candidates', status] as const,
};

export function useImportSources() {
  return useQuery({
    queryKey: KEYS.sources,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; sources: any[] }>('/api/user/mentor/imports/sources');
      return res.data.sources || [];
    },
  });
}

export function useCreateImportSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { source_type: string; source_name: string; source_identifier: string }) => {
      const res = await apiClient.post<{ success: boolean; source: any }>('/api/user/mentor/imports/sources', data);
      return res.data.source;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.sources }),
  });
}

export function useToggleImportSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.patch<{ success: boolean }>(`/api/user/mentor/imports/sources/${id}/toggle`);
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.sources }),
  });
}

export function useImportedMessages(sourceId?: string) {
  return useQuery({
    queryKey: [...KEYS.messages, sourceId],
    queryFn: async () => {
      const params: any = {};
      if (sourceId) params.source_id = sourceId;
      const res = await apiClient.get<{ success: boolean; messages: any[] }>(
        '/api/user/mentor/imports/messages', { params }
      );
      return res.data.messages || [];
    },
  });
}

export function useIngestMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { source_id: string; raw_text: string; external_message_id?: string }) => {
      const res = await apiClient.post<{ success: boolean; message: any; candidate: any }>(
        '/api/user/mentor/imports/messages/ingest', data
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.messages });
      qc.invalidateQueries({ queryKey: KEYS.candidates() });
    },
  });
}

export function useImportedCandidates(reviewStatus?: string) {
  return useQuery({
    queryKey: KEYS.candidates(reviewStatus),
    queryFn: async () => {
      const params: any = {};
      if (reviewStatus) params.review_status = reviewStatus;
      const res = await apiClient.get<{ success: boolean; candidates: any[] }>(
        '/api/user/mentor/imports/candidates', { params }
      );
      return res.data.candidates || [];
    },
  });
}

export function useUpdateImportedCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: { id: string; [key: string]: any }) => {
      const res = await apiClient.patch<{ success: boolean; candidate: any }>(
        `/api/user/mentor/imports/candidates/${id}`, data
      );
      return res.data.candidate;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.candidates() }),
  });
}

export function useApproveImportedCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<{ success: boolean; signal?: any; fanoutSummary?: any }>(
        `/api/user/mentor/imports/candidates/${id}/approve`
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.candidates() });
      qc.invalidateQueries({ queryKey: ['mentor-signals'] });
    },
  });
}

export function useRejectImportedCandidate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      await apiClient.post(`/api/user/mentor/imports/candidates/${id}/reject`, { notes });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.candidates() }),
  });
}
