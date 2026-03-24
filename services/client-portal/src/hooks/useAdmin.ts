import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

const K = {
  overview: ['admin-overview'] as const,
  logs: ['admin-logs'] as const,
  mentors: (s?: string) => ['admin-mentors', s] as const,
  invoices: (s?: string) => ['admin-invoices', s] as const,
  commissions: (s?: string) => ['admin-commissions', s] as const,
  attributions: ['admin-attributions'] as const,
  reviews: (s?: string) => ['admin-reviews', s] as const,
  subs: ['admin-subs'] as const,
  trades: ['admin-trades'] as const,
  blocked: ['admin-blocked'] as const,
  imports: ['admin-imports'] as const,
  shadow: ['admin-shadow'] as const,
};

export function useAdminOverview() {
  return useQuery({ queryKey: K.overview, queryFn: async () => {
    const r = await apiClient.get<{ success: boolean; stats: any }>('/api/admin/ops/overview');
    return r.data.stats;
  }});
}

export function useAdminActionLogs() {
  return useQuery({ queryKey: K.logs, queryFn: async () => {
    const r = await apiClient.get<{ success: boolean; logs: any[] }>('/api/admin/ops/action-logs');
    return r.data.logs || [];
  }});
}

export function useAdminMentors(status?: string) {
  return useQuery({ queryKey: K.mentors(status), queryFn: async () => {
    const p: any = {}; if (status) p.status = status;
    const r = await apiClient.get<{ success: boolean; mentors: any[] }>('/api/admin/ops/mentors', { params: p });
    return r.data.mentors || [];
  }});
}

export function useUpdateMentorStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action, reason, notes }: { id: string; action: string; reason?: string; notes?: string }) => {
      const r = await apiClient.patch(`/api/admin/ops/mentors/${id}/status`, { action, reason, notes });
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-mentors'] }),
  });
}

export function useUpdateMentorFeatured() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, featured, order }: { id: string; featured: boolean; order?: number }) => {
      await apiClient.patch(`/api/admin/ops/mentors/${id}/featured`, { featured, order });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-mentors'] }),
  });
}

export function useUpdateMentorBadges() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, badge_type, action }: { id: string; badge_type: string; action?: string }) => {
      const r = await apiClient.patch(`/api/admin/ops/mentors/${id}/badges`, { badge_type, action });
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-mentors'] }),
  });
}

export function useAdminInvoices(status?: string) {
  return useQuery({ queryKey: K.invoices(status), queryFn: async () => {
    const p: any = {}; if (status) p.status = status;
    const r = await apiClient.get<{ success: boolean; invoices: any[] }>('/api/admin/ops/billing/invoices', { params: p });
    return r.data.invoices || [];
  }});
}

export function useReviewInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: string; notes?: string }) => {
      const r = await apiClient.patch(`/api/admin/ops/billing/invoices/${id}/review`, { status, notes });
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-invoices'] }),
  });
}

export function useAdminCommissions(status?: string) {
  return useQuery({ queryKey: K.commissions(status), queryFn: async () => {
    const p: any = {}; if (status) p.status = status;
    const r = await apiClient.get<{ success: boolean; commissions: any[] }>('/api/admin/ops/referrals/commissions', { params: p });
    return r.data.commissions || [];
  }});
}

export function useUpdateCommissionStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: string; notes?: string }) => {
      await apiClient.patch(`/api/admin/ops/referrals/commissions/${id}/status`, { status, notes });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-commissions'] }),
  });
}

export function useAdminReviews(status?: string) {
  return useQuery({ queryKey: K.reviews(status), queryFn: async () => {
    const p: any = {}; if (status) p.status = status;
    const r = await apiClient.get<{ success: boolean; reviews: any[] }>('/api/admin/ops/reviews', { params: p });
    return r.data.reviews || [];
  }});
}

export function useModerateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiClient.patch(`/api/admin/ops/reviews/${id}/moderation`, { status });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-reviews'] }),
  });
}

export function useAdminSubscriptions() {
  return useQuery({ queryKey: K.subs, queryFn: async () => {
    const r = await apiClient.get<{ success: boolean; subscriptions: any[] }>('/api/admin/ops/support/subscriptions');
    return r.data.subscriptions || [];
  }});
}

export function useAdminCopiedTrades() {
  return useQuery({ queryKey: K.trades, queryFn: async () => {
    const r = await apiClient.get<{ success: boolean; trades: any[] }>('/api/admin/ops/support/copied-trades');
    return r.data.trades || [];
  }});
}

export function useAdminBlockedAttempts() {
  return useQuery({ queryKey: K.blocked, queryFn: async () => {
    const r = await apiClient.get<{ success: boolean; blocked: any[] }>('/api/admin/ops/support/blocked-attempts');
    return r.data.blocked || [];
  }});
}

export function useAdminImports() {
  return useQuery({ queryKey: K.imports, queryFn: async () => {
    const r = await apiClient.get<{ success: boolean; candidates: any[] }>('/api/admin/ops/support/imports');
    return r.data.candidates || [];
  }});
}

export function useAdminShadowTrades() {
  return useQuery({ queryKey: K.shadow, queryFn: async () => {
    const r = await apiClient.get<{ success: boolean; trades: any[] }>('/api/admin/ops/support/shadow');
    return r.data.trades || [];
  }});
}
