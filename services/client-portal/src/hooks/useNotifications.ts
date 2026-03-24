import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

const KEYS = {
  notifications: ['notifications'] as const,
  unreadCount: ['notification-unread-count'] as const,
  preferences: ['notification-preferences'] as const,
};

// ==================== Notifications List ====================

export function useNotifications(opts?: { category?: string; unread?: boolean; limit?: number }) {
  return useQuery({
    queryKey: [...KEYS.notifications, opts?.category, opts?.unread],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (opts?.category) params.set('category', opts.category);
      if (opts?.unread) params.set('unread', 'true');
      if (opts?.limit) params.set('limit', String(opts.limit));
      const res = await apiClient.get<{ success: boolean; notifications: any[] }>(
        `/api/notifications?${params.toString()}`
      );
      return res.data.notifications || [];
    },
  });
}

// ==================== Unread Count ====================

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: KEYS.unreadCount,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; count: number }>(
        '/api/notifications/unread-count'
      );
      return res.data.count || 0;
    },
    refetchInterval: 30000, // Poll every 30s
  });
}

// ==================== Mark Read ====================

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notificationId: string) => {
      await apiClient.patch(`/api/notifications/${notificationId}/read`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.notifications });
      qc.invalidateQueries({ queryKey: KEYS.unreadCount });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (category?: string) => {
      await apiClient.post('/api/notifications/mark-all-read', { category });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.notifications });
      qc.invalidateQueries({ queryKey: KEYS.unreadCount });
    },
  });
}

// ==================== Preferences ====================

export function useNotificationPreferences() {
  return useQuery({
    queryKey: KEYS.preferences,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; preferences: any }>(
        '/api/notifications/preferences'
      );
      return res.data.preferences;
    },
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const res = await apiClient.patch<{ success: boolean; preferences: any }>(
        '/api/notifications/preferences',
        updates
      );
      return res.data.preferences;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.preferences });
    },
  });
}
