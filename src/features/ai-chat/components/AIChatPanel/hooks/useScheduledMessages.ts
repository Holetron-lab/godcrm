import { useLanguage } from '@/shared/i18n/LanguageContext';
/**
 * useScheduledMessages — React Query hooks for scheduled message CRUD.
 * WP-17: Scheduled messages feature.
 * ADR-208 D8: series fields (recurrence_cron/timezone/max_runs/runs_done/…) and pause/resume.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { showToast } from '@/shared/hooks/useToast';

export type ScheduledMessageStatus = 'pending' | 'paused' | 'sent' | 'failed' | 'cancelled';

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
  /** Next firing (same instant as `next_run_at`). */
  scheduled_at: string;
  status: ScheduledMessageStatus | string;
  created_at: string;
  updated_at: string;
  // ADR-208 D6 — series fields. Older rows may lack them, hence optional.
  /** 5-field cron; null = one-time message. */
  recurrence_cron?: string | null;
  /** IANA timezone the cron is evaluated in. */
  timezone?: string;
  /** null = infinite series. */
  max_runs?: number | null;
  runs_done?: number;
  last_fired_at?: string | null;
  next_run_at?: string;
  error_message?: string | null;
  sender_type?: 'human' | 'agent';
  agent_id?: number | null;
}

/** Recurrence chosen in the picker (ADR-208 D8). `scheduled_at` null → backend computes the first run. */
export interface ScheduleSeries {
  recurrence_cron: string;
  timezone: string;
  max_runs: number | null;
  scheduled_at: string | null;
}

export interface ScheduleMessageParams {
  conversationId: number;
  content: string;
  /** Required for one-time messages; optional for series (first run defaults to the next cron tick). */
  scheduled_at?: string;
  recurrence_cron?: string;
  timezone?: string;
  max_runs?: number | null;
  content_type?: string;
  mentions?: unknown[];
  attachments?: unknown[];
  metadata?: Record<string, unknown>;
}

export interface EditScheduledMessageParams {
  smId: number;
  content?: string;
  scheduled_at?: string;
  recurrence_cron?: string | null;
  timezone?: string;
  max_runs?: number | null;
}

export function useScheduledMessages(conversationId: number | null | undefined) {
  const { t } = useLanguage();
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
      showToast(t('aiChat.ui.scheduledSuccess'), 'success');
    },
    onError: (err: Error) => {
      showToast(t('aiChat.ui.scheduledError', { message: err.message }), 'error');
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
      showToast(t('aiChat.ui.scheduledCancelled'), 'success');
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ smId, ...body }: EditScheduledMessageParams) => {
      const res = await apiClient.put<{ success: boolean; data: ScheduledMessage }>(
        `/chat/scheduled-messages/${smId}`,
        body
      );
      if (!res.success) throw new Error('Failed to update');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      showToast(t('aiChat.ui.scheduledUpdated'), 'success');
    },
    onError: (err: Error) => {
      showToast(t('aiChat.ui.scheduledError', { message: err.message }), 'error');
    },
  });

  // ADR-208 D6: PATCH /scheduled-messages/:id/status { status: 'paused' | 'pending' }.
  // Resume ('pending') makes the backend recompute scheduled_at from the cron.
  const statusMutation = useMutation({
    mutationFn: async ({ smId, status }: { smId: number; status: 'paused' | 'pending' }) => {
      const res = await apiClient.patch<{ success: boolean; data: ScheduledMessage }>(
        `/chat/scheduled-messages/${smId}/status`,
        { status }
      );
      if (!res.success) throw new Error('Failed to change status');
      return res.data;
    },
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey });
      showToast(t(status === 'paused' ? 'aiChat.ui.seriesPaused' : 'aiChat.ui.seriesResumed'), 'success');
    },
    onError: (err: Error) => {
      showToast(t('aiChat.ui.scheduledError', { message: err.message }), 'error');
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
    pauseScheduledMessage: (smId: number) => statusMutation.mutateAsync({ smId, status: 'paused' }),
    resumeScheduledMessage: (smId: number) => statusMutation.mutateAsync({ smId, status: 'pending' }),
    isChangingStatus: statusMutation.isPending,
  };
}
