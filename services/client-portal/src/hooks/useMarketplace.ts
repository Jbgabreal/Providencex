import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

const KEYS = {
  leaderboard: (sort: string) => ['leaderboard', sort] as const,
  featured: ['featured-mentors'] as const,
  categories: ['marketplace-categories'] as const,
  reviews: (id: string) => ['mentor-reviews', id] as const,
  badges: (id: string) => ['mentor-badges', id] as const,
  similar: (id: string) => ['similar-mentors', id] as const,
};

export function useMentorLeaderboard(sort = 'performance', limit = 20) {
  return useQuery({
    queryKey: KEYS.leaderboard(sort),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; leaderboard: any[]; sort: string }>(
        '/api/public/marketplace/leaderboard', { params: { sort, limit } }
      );
      return res.data;
    },
  });
}

export function useFeaturedMentors() {
  return useQuery({
    queryKey: KEYS.featured,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; mentors: any[] }>(
        '/api/public/marketplace/featured'
      );
      return res.data.mentors || [];
    },
  });
}

export function useMarketplaceCategories() {
  return useQuery({
    queryKey: KEYS.categories,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; categories: any[] }>(
        '/api/public/marketplace/categories'
      );
      return res.data.categories || [];
    },
  });
}

export function useMentorReviews(mentorId: string) {
  return useQuery({
    queryKey: KEYS.reviews(mentorId),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean; reviews: any[]; ratingSummary: any;
      }>(`/api/public/marketplace/mentors/${mentorId}/reviews`);
      return res.data;
    },
    enabled: !!mentorId,
  });
}

export function useCreateMentorReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ mentorId, rating, review_text }: {
      mentorId: string; rating: number; review_text?: string;
    }) => {
      const res = await apiClient.post<{ success: boolean; review: any }>(
        `/api/public/marketplace/mentors/${mentorId}/reviews`,
        { rating, review_text }
      );
      return res.data.review;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: KEYS.reviews(vars.mentorId) });
    },
  });
}

export function useMentorBadges(mentorId: string) {
  return useQuery({
    queryKey: KEYS.badges(mentorId),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; badges: any[] }>(
        `/api/public/marketplace/mentors/${mentorId}/badges`
      );
      return res.data.badges || [];
    },
    enabled: !!mentorId,
  });
}

export function useSimilarMentors(mentorId: string) {
  return useQuery({
    queryKey: KEYS.similar(mentorId),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; mentors: any[] }>(
        `/api/public/marketplace/mentors/${mentorId}/similar`
      );
      return res.data.mentors || [];
    },
    enabled: !!mentorId,
  });
}
