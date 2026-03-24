import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { useAuth } from '@/context/AuthContext';

interface MentorProfile {
  id: string;
  is_approved: boolean;
  display_name: string;
}

interface CurrentUser {
  id: string;
  role: 'admin' | 'user';
  email: string | null;
  mentorProfile: MentorProfile | null;
}

export const CURRENT_USER_KEY = ['current-user'] as const;

export function useCurrentUser() {
  const { isAuthenticated } = useAuth();

  const query = useQuery({
    queryKey: CURRENT_USER_KEY,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; user: CurrentUser }>('/api/auth/me');
      return res.data.user;
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  return {
    ...query,
    isAdmin: query.data?.role === 'admin',
    isMentor: query.data?.mentorProfile != null,
    isApprovedMentor: query.data?.mentorProfile?.is_approved === true,
  };
}
