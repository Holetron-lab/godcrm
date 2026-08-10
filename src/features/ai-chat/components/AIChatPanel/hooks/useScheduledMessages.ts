/**
 * useScheduledMessages — React Query hooks for scheduled message CRUD.
 * WP-17: Scheduled messages feature.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { showToast } from '@/shared/hooks/useToast';

export interface ScheduledMessage {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_name?: string;
  sender_avatar?: string;
  content: string;
  content_type: string;
  mentions: unknown[];
  attachments: unknown[];
  metadata: Record<string, unknown>;
  scheduled_at: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ScheduleMessageParams {
  conversationId: number;
  content: string;
  scheduled_at: string;
  content_type?: string;
  mentions?: unknown[];
  attachments?: unknown[];
  metadata?: Record<string, unknown>;
}

export function useScheduledMessages(conversationId: number | null | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['scheduled-messages', conversationId];

  const { data: scheduledMessages = [], isLoading, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!conversationId) return [];
      const res = await apiClient.get<{ success: boolean; data: { scheduled_messages: ScheduledMessage[] } }>(
        `/chat/conversations/${conversationId}/scheduled-messages`
      );
      return res.success ? res.data.scheduled_messages : [];
    },
    enabled: !!conversationId,
    staleTime: 5_000,
    refetchInterval: 10_000,
  });

  const scheduleMutation = useMutation({
    mutationFn: async (params: ScheduleMessageParams) => {
      const { conversationId: convId, ...body } = params;
      const res = await apiClient.post<{ success: boolean; data: ScheduledMessage }>(
        `/chat/conversations/${convId}/scheduled-messages`,
        body
      );
      if (!res.success) throw new Error('Failed to schedule message');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      showToast('Сообщение запланировано', 'success');
    },
    onError: (err: Error) => {
      showToast(`Ошибка: ${err.message}`, 'error');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (smId: number) => {
      const res = await apiClient.delete<{ success: boolean }>(`/chat/scheduled-messages/${smId}`);
      if (!res.success) throw new Error('Failed to cancel');
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      showToast('Запланированное сообщение отменено', 'success');
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ smId, ...body }: { smId: number; content?: string; scheduled_at?: string }) => {
      const res = await apiClient.put<{ success: boolean; data: ScheduledMessage }>(
        `/chat/scheduled-messages/${smId}`,
        body
      );
      if (!res.success) throw new Error('Failed to update');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      showToast('Запланированное сообщение обновлено', 'success');
    },
  });

  const sendNowMutation = useMutation({
    mutationFn: async (smId: number) => {
      const res = await apiClient.post<{ sent: boolean; message_id: number; scheduled_message_id: number }>(
        `/chat/scheduled-messages/${smId}/send-now`
      );
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    },
  });

  return {
    scheduledMessages,
    isLoading,
    refetch,
    scheduleMessage: scheduleMutation.mutateAsync,
    isScheduling: scheduleMutation.isPending,
    cancelScheduledMessage: cancelMutation.mutateAsync,
    editScheduledMessage: editMutation.mutateAsync,
    sendNowScheduledMessage: sendNowMutation.mutateAsync,
  };
}
