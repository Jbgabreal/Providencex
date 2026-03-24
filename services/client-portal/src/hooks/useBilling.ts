import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

const KEYS = {
  platformPlans: ['platform-plans'] as const,
  paymentRails: ['payment-rails'] as const,
  billingStatus: ['billing-status'] as const,
  mentorPlans: (id: string) => ['mentor-plans', id] as const,
  myMentorPlans: ['my-mentor-plans'] as const,
  mentorEarnings: ['mentor-earnings'] as const,
  invoice: (id: string) => ['invoice', id] as const,
  invoices: ['invoices'] as const,
  mentorSubscriptions: ['mentor-billing-subscriptions'] as const,
};

// ==================== Platform Plans ====================

export function usePlatformPlans() {
  return useQuery({
    queryKey: KEYS.platformPlans,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; plans: any[] }>('/api/billing/platform-plans');
      return res.data.plans || [];
    },
  });
}

// ==================== Payment Rails ====================

export function useSupportedPaymentRails() {
  return useQuery({
    queryKey: KEYS.paymentRails,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; rails: any[] }>('/api/billing/supported-payment-rails');
      return res.data.rails || [];
    },
  });
}

// ==================== Billing Status ====================

export function useBillingStatus() {
  return useQuery({
    queryKey: KEYS.billingStatus,
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        entitlements: any;
        recentInvoices: any[];
      }>('/api/billing/me');
      return res.data;
    },
  });
}

// ==================== Mentor Plans (public, for followers) ====================

export function useMentorPlans(mentorProfileId: string) {
  return useQuery({
    queryKey: KEYS.mentorPlans(mentorProfileId),
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; plans: any[] }>(
        `/api/billing/mentor-plans?mentor_profile_id=${mentorProfileId}`
      );
      return res.data.plans || [];
    },
    enabled: !!mentorProfileId,
  });
}

// ==================== My Mentor Plans (for mentor dashboard) ====================

export function useMyMentorPlans() {
  return useQuery({
    queryKey: KEYS.myMentorPlans,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; plans: any[] }>('/api/billing/my-mentor-plans');
      return res.data.plans || [];
    },
  });
}

export function useCreateMentorPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      price_usd: number;
      features?: string[];
      is_public?: boolean;
    }) => {
      const res = await apiClient.post<{ success: boolean; plan: any }>('/api/billing/mentor-plans', data);
      return res.data.plan;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.myMentorPlans }),
  });
}

export function useUpdateMentorPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...data }: {
      id: string;
      name?: string;
      description?: string;
      price_usd?: number;
      is_active?: boolean;
      is_public?: boolean;
      features?: string[];
    }) => {
      const res = await apiClient.patch<{ success: boolean; plan: any }>(`/api/billing/mentor-plans/${id}`, data);
      return res.data.plan;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.myMentorPlans }),
  });
}

// ==================== Invoices ====================

export function useCreatePlatformInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { platform_plan_id: string; payment_rail: string }) => {
      const res = await apiClient.post<{ success: boolean; invoice: any }>('/api/billing/platform-invoice', data);
      return res.data.invoice;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.billingStatus });
      qc.invalidateQueries({ queryKey: KEYS.invoices });
    },
  });
}

export function useCreateMentorInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { mentor_plan_id: string; payment_rail: string }) => {
      const res = await apiClient.post<{ success: boolean; invoice: any }>('/api/billing/mentor-invoice', data);
      return res.data.invoice;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.billingStatus });
      qc.invalidateQueries({ queryKey: KEYS.invoices });
    },
  });
}

export function useBillingInvoice(invoiceId: string) {
  return useQuery({
    queryKey: KEYS.invoice(invoiceId),
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        invoice: any;
        events: any[];
        railInfo: any;
      }>(`/api/billing/invoices/${invoiceId}`);
      return res.data;
    },
    enabled: !!invoiceId,
    refetchInterval: 15000, // Poll every 15s for payment status
  });
}

export function useRefreshInvoiceStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiClient.post<{ success: boolean; invoice: any }>(
        `/api/billing/invoices/${invoiceId}/refresh-status`
      );
      return res.data.invoice;
    },
    onSuccess: (_, invoiceId) => {
      qc.invalidateQueries({ queryKey: KEYS.invoice(invoiceId) });
      qc.invalidateQueries({ queryKey: KEYS.billingStatus });
    },
  });
}

export function useInvoices() {
  return useQuery({
    queryKey: KEYS.invoices,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; invoices: any[] }>('/api/billing/invoices');
      return res.data.invoices || [];
    },
  });
}

// ==================== Mentor Earnings ====================

export function useMentorEarnings() {
  return useQuery({
    queryKey: KEYS.mentorEarnings,
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        earnings: {
          totalGross: number;
          totalPlatformFee: number;
          totalNet: number;
          entries: any[];
        };
      }>('/api/billing/mentor-earnings');
      return res.data.earnings;
    },
  });
}

// ==================== Mentor Billing Subscriptions ====================

export function useMentorBillingSubscriptions() {
  return useQuery({
    queryKey: KEYS.mentorSubscriptions,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; subscriptions: any[] }>(
        '/api/billing/mentor-subscriptions'
      );
      return res.data.subscriptions || [];
    },
  });
}
