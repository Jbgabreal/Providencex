import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

const KEYS = { profile: ['mentor-profile'] as const };

export function useMentorProfile() {
  return useQuery({
    queryKey: KEYS.profile,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; mentor_profile: any }>(
        '/api/user/mentor/profile'
      );
      return res.data.mentor_profile;
    },
  });
}

export function useCreateMentorProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { display_name: string; bio?: string }) => {
      const res = await apiClient.post<{ success: boolean; mentor_profile: any }>(
        '/api/user/mentor/profile', data
      );
      return res.data.mentor_profile;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.profile }),
  });
}
