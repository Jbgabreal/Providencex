import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

const KEYS = {
  mentorInsights: ['mentor-insights'] as const,
  recommendations: ['mentor-recommendations'] as const,
  riskAssistant: ['risk-assistant'] as const,
  platformIntel: ['platform-intelligence'] as const,
};

export function useMentorInsights() {
  return useQuery({
    queryKey: KEYS.mentorInsights,
    queryFn: async () => {
      const r = await apiClient.get<{ success: boolean; insights: any }>('/api/intelligence/mentor/insights');
      return r.data.insights;
    },
  });
}

export function useMentorRecommendations(limit = 10) {
  return useQuery({
    queryKey: KEYS.recommendations,
    queryFn: async () => {
      const r = await apiClient.get<{ success: boolean; recommendations: any[] }>(
        '/api/intelligence/recommendations/mentors', { params: { limit } }
      );
      return r.data.recommendations || [];
    },
  });
}

export function useRiskAssistant() {
  return useQuery({
    queryKey: KEYS.riskAssistant,
    queryFn: async () => {
      const r = await apiClient.get<{ success: boolean; warnings: any[] }>('/api/intelligence/risk-assistant');
      return r.data.warnings || [];
    },
    refetchInterval: 120000, // Refresh every 2 minutes
  });
}

export function useDismissWarning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (warningId: string) => {
      await apiClient.post(`/api/intelligence/risk-assistant/dismiss/${warningId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.riskAssistant }),
  });
}

export function usePlatformIntelligence() {
  return useQuery({
    queryKey: KEYS.platformIntel,
    queryFn: async () => {
      const r = await apiClient.get<{ success: boolean; intelligence: any }>('/api/intelligence/platform/overview');
      return r.data.intelligence;
    },
  });
}
