import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

const KEYS = { mentors: ['mentors'] as const };

export function useMentors(limit = 20) {
  return useQuery({
    queryKey: [...KEYS.mentors, limit],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; mentors: any[] }>(
        '/api/user/copy-trading/mentors', { params: { limit } }
      );
      return res.data.mentors || [];
    },
  });
}

export function useMentorDetail(mentorProfileId: string) {
  return useQuery({
    queryKey: [...KEYS.mentors, mentorProfileId],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; mentor: any; recent_signals: any[] }>(
        `/api/user/copy-trading/mentors/${mentorProfileId}`
      );
      return res.data;
    },
    enabled: !!mentorProfileId,
  });
}
