import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

const KEYS = { public: ['public-mentors'] as const };

export function usePublicMentors(params?: {
  limit?: number; search?: string; symbol?: string;
  style?: string; risk?: string; sort_by?: string; sort_dir?: string;
}) {
  return useQuery({
    queryKey: [...KEYS.public, params],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; mentors: any[]; total: number }>(
        '/api/public/mentors', { params }
      );
      return res.data;
    },
  });
}

export function usePublicMentorProfile(mentorId: string) {
  return useQuery({
    queryKey: [...KEYS.public, 'profile', mentorId],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; mentor: any; analytics: any }>(
        `/api/public/mentors/${mentorId}`
      );
      return res.data;
    },
    enabled: !!mentorId,
  });
}

export function usePublicMentorSignals(mentorId: string, limit = 20) {
  return useQuery({
    queryKey: [...KEYS.public, 'signals', mentorId, limit],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; signals: any[]; total: number }>(
        `/api/public/mentors/${mentorId}/signals`, { params: { limit } }
      );
      return res.data;
    },
    enabled: !!mentorId,
  });
}
