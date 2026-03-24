import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';

const KEYS = {
  profile: ['referral-profile'] as const,
  summary: ['referral-summary'] as const,
  conversions: ['referral-conversions'] as const,
  commissions: ['referral-commissions'] as const,
  referredUsers: ['referral-referred-users'] as const,
  attribution: ['referral-attribution'] as const,
};

// ==================== Profile & Summary ====================

export function useReferralProfile() {
  return useQuery({
    queryKey: KEYS.profile,
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        profile: any;
        referralLink: string;
        summary: any;
      }>('/api/referrals/me');
      return res.data;
    },
  });
}

export function useReferralSummary() {
  return useQuery({
    queryKey: KEYS.summary,
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        hasProfile: boolean;
        summary: any;
      }>('/api/referrals/summary');
      return res.data;
    },
  });
}

// ==================== Code Management ====================

export function useRegenerateReferralCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ success: boolean; profile: any }>(
        '/api/referrals/code/regenerate'
      );
      return res.data.profile;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.profile });
      qc.invalidateQueries({ queryKey: KEYS.summary });
    },
  });
}

// ==================== Attribution ====================

export function useApplyReferralCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (referralCode: string) => {
      const res = await apiClient.post<{ success: boolean; attribution: any }>(
        '/api/referrals/apply-code',
        { referral_code: referralCode }
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.attribution });
    },
  });
}

export function useReferralAttribution() {
  return useQuery({
    queryKey: KEYS.attribution,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; attribution: any }>(
        '/api/referrals/attribution'
      );
      return res.data.attribution;
    },
  });
}

// ==================== Conversions ====================

export function useReferralConversions() {
  return useQuery({
    queryKey: KEYS.conversions,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; conversions: any[] }>(
        '/api/referrals/conversions'
      );
      return res.data.conversions || [];
    },
  });
}

// ==================== Commissions ====================

export function useReferralCommissions() {
  return useQuery({
    queryKey: KEYS.commissions,
    queryFn: async () => {
      const res = await apiClient.get<{
        success: boolean;
        commissions: any[];
        summary: any;
      }>('/api/referrals/commissions');
      return res.data;
    },
  });
}

// ==================== Referred Users ====================

export function useReferredUsers() {
  return useQuery({
    queryKey: KEYS.referredUsers,
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; referrals: any[] }>(
        '/api/referrals/referred-users'
      );
      return res.data.referrals || [];
    },
  });
}
