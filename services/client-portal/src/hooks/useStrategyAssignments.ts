/**
 * Strategy Assignment Hooks
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import type {
  StrategyAssignment,
  StrategyAssignmentsResponse,
  CreateStrategyAssignmentRequest,
  UserTradingConfig,
} from '@/types/api';

const QUERY_KEYS = {
  all: ['strategy-assignments'] as const,
  lists: () => [...QUERY_KEYS.all, 'list'] as const,
  list: () => [...QUERY_KEYS.lists()] as const,
};

export function useStrategyAssignments() {
  return useQuery<StrategyAssignment[]>({
    queryKey: QUERY_KEYS.list(),
    queryFn: async () => {
      const response = await apiClient.get<StrategyAssignmentsResponse>(
        '/api/user/strategy-assignments'
      );
      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to fetch strategy assignments');
      }
      return response.data.assignments;
    },
  });
}

export function useCreateStrategyAssignment() {
  const queryClient = useQueryClient();

  return useMutation<StrategyAssignment, Error, CreateStrategyAssignmentRequest>({
    mutationFn: async (data) => {
      const response = await apiClient.post<{
        success: boolean;
        assignment: StrategyAssignment;
      }>('/api/user/strategy-assignments', data);
      if (!response.data.success || !response.data.assignment) {
        throw new Error('Failed to create strategy assignment');
      }
      return response.data.assignment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.list() });
    },
  });
}

export function usePauseAssignment() {
  const queryClient = useQueryClient();

  return useMutation<StrategyAssignment, Error, string>({
    mutationFn: async (assignmentId) => {
      const response = await apiClient.post<{
        success: boolean;
        assignment: StrategyAssignment;
      }>(`/api/user/strategy-assignments/${assignmentId}/pause`);
      if (!response.data.success || !response.data.assignment) {
        throw new Error('Failed to pause assignment');
      }
      return response.data.assignment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.list() });
    },
  });
}

export function useResumeAssignment() {
  const queryClient = useQueryClient();

  return useMutation<StrategyAssignment, Error, string>({
    mutationFn: async (assignmentId) => {
      const response = await apiClient.post<{
        success: boolean;
        assignment: StrategyAssignment;
      }>(`/api/user/strategy-assignments/${assignmentId}/resume`);
      if (!response.data.success || !response.data.assignment) {
        throw new Error('Failed to resume assignment');
      }
      return response.data.assignment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.list() });
    },
  });
}

export function useStopAssignment() {
  const queryClient = useQueryClient();

  return useMutation<StrategyAssignment, Error, string>({
    mutationFn: async (assignmentId) => {
      const response = await apiClient.post<{
        success: boolean;
        assignment: StrategyAssignment;
      }>(`/api/user/strategy-assignments/${assignmentId}/stop`);
      if (!response.data.success || !response.data.assignment) {
        throw new Error('Failed to stop assignment');
      }
      return response.data.assignment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.list() });
    },
  });
}

export function useSwitchStrategy() {
  const queryClient = useQueryClient();

  return useMutation<StrategyAssignment, Error, { assignmentId: string; strategyProfileKey: string }>({
    mutationFn: async ({ assignmentId, strategyProfileKey }) => {
      const response = await apiClient.post<{
        success: boolean;
        assignment: StrategyAssignment;
      }>(`/api/user/strategy-assignments/${assignmentId}/switch`, {
        strategy_profile_key: strategyProfileKey,
      });
      if (!response.data.success || !response.data.assignment) {
        throw new Error('Failed to switch strategy');
      }
      return response.data.assignment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.list() });
    },
  });
}

export function useUpdateAssignmentConfig() {
  const queryClient = useQueryClient();

  return useMutation<StrategyAssignment, Error, { assignmentId: string; config: UserTradingConfig }>({
    mutationFn: async ({ assignmentId, config }) => {
      const response = await apiClient.patch<{
        success: boolean;
        assignment: StrategyAssignment;
      }>(`/api/user/strategy-assignments/${assignmentId}/config`, config);
      if (!response.data.success || !response.data.assignment) {
        throw new Error('Failed to update config');
      }
      return response.data.assignment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.list() });
    },
  });
}

export function useClosePosition() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { ticket: number; reason?: string }>({
    mutationFn: async ({ ticket, reason }) => {
      const response = await apiClient.post<{ success: boolean; error?: string }>(
        `/api/user/positions/${ticket}/close`,
        { reason }
      );
      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to close position');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

