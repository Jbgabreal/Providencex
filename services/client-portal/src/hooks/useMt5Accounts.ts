/**
 * MT5 Accounts Hooks
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import type {
  Mt5Account,
  Mt5AccountsResponse,
  CreateMt5AccountRequest,
} from '@/types/api';

const QUERY_KEYS = {
  all: ['mt5-accounts'] as const,
  lists: () => [...QUERY_KEYS.all, 'list'] as const,
  list: () => [...QUERY_KEYS.lists()] as const,
};

export function useMt5Accounts() {
  return useQuery<Mt5Account[]>({
    queryKey: QUERY_KEYS.list(),
    queryFn: async () => {
      const response = await apiClient.get<Mt5AccountsResponse>(
        '/api/user/mt5-accounts'
      );
      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to fetch MT5 accounts');
      }
      return response.data.accounts;
    },
  });
}

export function useCreateMt5Account() {
  const queryClient = useQueryClient();

  return useMutation<Mt5Account, Error, CreateMt5AccountRequest>({
    mutationFn: async (data) => {
      const response = await apiClient.post<{ success: boolean; account: Mt5Account }>(
        '/api/user/mt5-accounts',
        data
      );
      if (!response.data.success || !response.data.account) {
        throw new Error('Failed to create MT5 account');
      }
      return response.data.account;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.list() });
    },
  });
}

export function usePauseMt5Account() {
  const queryClient = useQueryClient();

  return useMutation<Mt5Account, Error, string>({
    mutationFn: async (accountId) => {
      const response = await apiClient.post<{ success: boolean; account: Mt5Account }>(
        `/api/user/mt5-accounts/${accountId}/pause`
      );
      if (!response.data.success || !response.data.account) {
        throw new Error('Failed to pause MT5 account');
      }
      return response.data.account;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.list() });
    },
  });
}

export function useResumeMt5Account() {
  const queryClient = useQueryClient();

  return useMutation<Mt5Account, Error, string>({
    mutationFn: async (accountId) => {
      const response = await apiClient.post<{ success: boolean; account: Mt5Account }>(
        `/api/user/mt5-accounts/${accountId}/resume`
      );
      if (!response.data.success || !response.data.account) {
        throw new Error('Failed to resume MT5 account');
      }
      return response.data.account;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.list() });
    },
  });
}

export function useDisconnectMt5Account() {
  const queryClient = useQueryClient();

  return useMutation<Mt5Account, Error, string>({
    mutationFn: async (accountId) => {
      const response = await apiClient.post<{ success: boolean; account: Mt5Account }>(
        `/api/user/mt5-accounts/${accountId}/disconnect`
      );
      if (!response.data.success || !response.data.account) {
        throw new Error('Failed to disconnect MT5 account');
      }
      return response.data.account;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.list() });
    },
  });
}

