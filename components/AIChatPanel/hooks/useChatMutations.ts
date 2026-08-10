/**
 * useChatMutations — API mutation handlers extracted from AIChatPanel.tsx
 * ADR-119: Saves agent settings, context settings, default agent, emojis, reactions.
 */

import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useCurrentSpace, useSpacesStore } from '@/features/spaces/store/spacesStore';
import { useAuthStore } from '@/features/auth/store/authStore';
import { showToast } from '@/shared/hooks/useToast';
import type { AIAgent, ChatMessage } from '../../../types';
import type { ContextSettings } from '../types';
import type { ApiResponse } from '../../AIChatPanel.types';

interface UseChatMutationsParams {
  currentAgent: AIAgent | null;
  chatOperatorId: number | null;
  chatModelId: string;
  chatSystemPrompt: string;
  setIsSavingAgentSettings: (v: boolean) => void;
  setContextSettings: (v: ContextSettings | string | undefined | null) => void;
  setDefaultAgentId: (v: number | null) => void;
  setIsSavingDefaultAgent: (v: boolean) => void;
  setQuickEmojis: (v: string[]) => void;
  setIsSavingEmojis: (v: boolean) => void;
  setMessageReactions: (fn: (prev: Record<number, Record<string, { user_id: number; user_name: string }[]>>) => Record<number, Record<string, { user_id: number; user_name: string }[]>>) => void;
  loadAgents: () => void;
  refetchUserMessages: () => void;
}

export function useChatMutations(params: UseChatMutationsParams) {
  const {
    currentAgent,
    chatOperatorId,
    chatModelId,
    chatSystemPrompt,
    setIsSavingAgentSettings,
    setContextSettings,
    setDefaultAgentId,
    setIsSavingDefaultAgent,
    setQuickEmojis,
    setIsSavingEmojis,
    setMessageReactions,
    loadAgents,
    refetchUserMessages,
  } = params;

  const currentSpace = useCurrentSpace();
  const updateSpaceInStore = useSpacesStore(state => state.updateSpace);
  const setCurrentSpaceInStore = useSpacesStore(state => state.setCurrentSpace);
  const queryClient = useQueryClient();

  // Save agent settings
  const saveAgentSettings = useCallback(async () => {
    if (!currentAgent) return;
    setIsSavingAgentSettings(true);
    try {
      await apiClient.put(`/ai/agents/${currentAgent.id}`, {
        provider_id: chatOperatorId,
        model: chatModelId,
        system_prompt: chatSystemPrompt
      });
      loadAgents();
    } catch (error) {
      logger.error('Failed to save agent settings:', error);
    } finally {
      setIsSavingAgentSettings(false);
    }
  }, [currentAgent, chatOperatorId, chatModelId, chatSystemPrompt, loadAgents, setIsSavingAgentSettings]);

  // Save context settings to agent
  const saveContextSettings = useCallback(async (settings: ContextSettings) => {
    if (!currentAgent) return;
    try {
      await apiClient.put(`/ai/agents/${currentAgent.id}`, {
        context_settings: JSON.stringify(settings),
      });
      setContextSettings(settings);
      loadAgents();
    } catch (error) {
      logger.error('Failed to save context settings:', error);
    }
  }, [currentAgent, loadAgents, setContextSettings]);

  // Save default agent to space settings
  const saveDefaultAgent = useCallback(async (agentId: number | null) => {
    if (!currentSpace?.id) return;
    setIsSavingDefaultAgent(true);
    try {
      const currentSettings = (currentSpace?.settings as Record<string, unknown>) || {};
      const newSettings = { ...currentSettings, default_agent_id: agentId };
      await apiClient.put(`/spaces/${currentSpace.id}`, { settings: newSettings });
      setDefaultAgentId(agentId);
      if (currentSpace) {
        setCurrentSpaceInStore({ ...currentSpace, settings: newSettings } as typeof currentSpace);
        updateSpaceInStore(currentSpace.id, { settings: newSettings } as Partial<typeof currentSpace>);
      }
      queryClient.invalidateQueries({ queryKey: ['spaces', 'detail', currentSpace.id] });
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
    } catch (error) {
      logger.error('Failed to save default agent:', error);
    } finally {
      setIsSavingDefaultAgent(false);
    }
  }, [currentSpace, setDefaultAgentId, setIsSavingDefaultAgent, setCurrentSpaceInStore, updateSpaceInStore, queryClient]);

  // Save quick emojis to space settings
  const saveQuickEmojis = useCallback(async (emojis: string[]) => {
    if (!currentSpace?.id) return;
    setIsSavingEmojis(true);
    try {
      const currentSettings = (currentSpace?.settings as Record<string, unknown>) || {};
      const newSettings = { ...currentSettings, quick_emojis: emojis.slice(0, 6) };
      await apiClient.put(`/spaces/${currentSpace.id}`, { settings: newSettings });
      setQuickEmojis(emojis.slice(0, 6));
      if (currentSpace) {
        setCurrentSpaceInStore({ ...currentSpace, settings: newSettings } as typeof currentSpace);
        updateSpaceInStore(currentSpace.id, { settings: newSettings } as Partial<typeof currentSpace>);
      }
      queryClient.invalidateQueries({ queryKey: ['spaces', 'detail', currentSpace.id] });
      queryClient.invalidateQueries({ queryKey: ['spaces'] });
    } catch (error) {
      logger.error('Failed to save quick emojis:', error);
    } finally {
      setIsSavingEmojis(false);
    }
  }, [currentSpace, setQuickEmojis, setIsSavingEmojis, setCurrentSpaceInStore, updateSpaceInStore, queryClient]);

  // Handle reaction toggle on message
  const handleReaction = useCallback(async (messageId: number, emoji: string) => {
    try {
      const response = await apiClient.post<{ success: boolean; data: { added?: boolean; removed?: boolean; emoji: string } }>(
        `/chat/messages/${messageId}/reactions`,
        { emoji }
      );
      if (response.success) {
        const currentUserIdRaw = useAuthStore.getState().user?.id;
        const userName = useAuthStore.getState().user?.name || 'Вы';
        const currentUserId = currentUserIdRaw ? Number(currentUserIdRaw) : null;
        setMessageReactions(prev => {
          const msgReactions = { ...(prev[messageId] || {}) };
          if (response.data.added) {
            if (!msgReactions[emoji]) msgReactions[emoji] = [];
            if (currentUserId !== null && !msgReactions[emoji].some(u => u.user_id === currentUserId)) {
              msgReactions[emoji] = [...msgReactions[emoji], { user_id: currentUserId, user_name: userName }];
            }
          } else if (response.data.removed) {
            if (msgReactions[emoji] && currentUserId !== null) {
              msgReactions[emoji] = msgReactions[emoji].filter(u => u.user_id !== currentUserId);
              if (msgReactions[emoji].length === 0) delete msgReactions[emoji];
            }
          }
          return { ...prev, [messageId]: msgReactions };
        });
      }
    } catch (error) {
      logger.error('Failed to toggle reaction:', error);
    }
  }, [setMessageReactions]);

  // Handle copy message to clipboard
  const handleCopyMessage = useCallback((message: ChatMessage) => {
    if (message.content) {
      navigator.clipboard.writeText(message.content);
    }
  }, []);

  // Handle forward message
  const handleForwardMessage = useCallback((message: ChatMessage) => {
    if (!message.content) {
      showToast('Сообщение пустое — нечего пересылать', 'error');
      return;
    }
    const senderLabel = message.sender_name || message.agentName || message.role;
    const timestamp = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';
    const forwardedText = [
      `--- Переслано от ${senderLabel}${timestamp ? ` (${timestamp})` : ''} ---`,
      message.content,
      '--- конец пересланного сообщения ---',
    ].join('\n');
    navigator.clipboard.writeText(forwardedText).then(() => {
      showToast('Сообщение скопировано в буфер. Вставьте в нужный чат.', 'success');
    }).catch(() => {
      showToast('Пересылка сообщений скоро будет доступна', 'info');
    });
  }, []);

  // Handle soft delete message
  const handleDeleteMessage = useCallback(async (messageId: number) => {
    try {
      const response = await apiClient.delete<{ success: boolean }>(`/chat/messages/${messageId}`);
      if (response.success) {
        refetchUserMessages();
      }
    } catch (error) {
      logger.error('Failed to delete message:', error);
    }
  }, [refetchUserMessages]);

  // Fetch reactions for visible messages in batch
  const fetchReactionsForMessages = useCallback(async (messageIds: number[]) => {
    if (messageIds.length === 0) return;
    try {
      const response = await apiClient.post<{ success: boolean; data: Record<number, Record<string, { user_id: number; user_name: string }[]>> }>(
        '/chat/messages/reactions/batch',
        { messageIds }
      );
      if (response.success && response.data) {
        setMessageReactions(prev => ({ ...prev, ...response.data }));
      }
    } catch {
      // Ignore batch fetch errors
    }
  }, [setMessageReactions]);

  // Create AI tables mutation
  const createTablesMutation = useMutation({
    mutationFn: async () => {
      if (!currentSpace?.id) throw new Error('No space selected');
      const response = await apiClient.post<{ success: boolean; tables?: unknown }>('/ai/setup-tables', {
        spaceId: currentSpace.id
      });
      if (!response.success) throw new Error('Failed to create tables');
      return response;
    },
    onSuccess: () => {
      loadAgents();
      queryClient.invalidateQueries({ queryKey: ['ai-agents'] });
    }
  });

  // Mark conversation as read
  const markAsReadMutation = useMutation({
    mutationFn: async (conversationId: number) => {
      await apiClient.post(`/chat/conversations/${conversationId}/read`);
    },
  });

  // Send user message mutation
  const sendUserMessageMutation = useMutation({
    mutationFn: async ({ conversationId, content, agentMode: mode, thinking, mentions, attachments: msgAttachments }: {
      conversationId: number;
      content: string;
      agentMode?: 'ask' | 'read' | 'agent';
      thinking?: boolean;
      mentions?: Array<{ user_id: number; name?: string; type?: string }>;
      attachments?: Array<{ id: string; name: string; type: string; size: number; url?: string; preview?: string; rowReference?: { table_id: number; row_id: number; table_name: string; table_icon?: string; row_title?: string } }>;
    }) => {
      const response = await apiClient.post<ApiResponse<{ id: number; content: string; sender_id: number }>>(`/chat/conversations/${conversationId}/messages`, {
        content,
        content_type: 'text',
        ...(mode && { agent_mode: mode }),
        ...(thinking !== undefined && { thinking_enabled: thinking }),
        ...(mentions && mentions.length > 0 && { mentions }),
        ...(msgAttachments && msgAttachments.length > 0 && {
          attachments: msgAttachments.map(a => ({
            name: a.name, type: a.type, size: a.size, url: a.url,
            ...(a.rowReference && { rowReference: a.rowReference }),
          }))
        }),
      });
      return response?.data;
    },
    onSuccess: () => {
      refetchUserMessages();
    }
  });

  return {
    saveAgentSettings,
    saveContextSettings,
    saveDefaultAgent,
    saveQuickEmojis,
    handleReaction,
    handleCopyMessage,
    handleForwardMessage,
    handleDeleteMessage,
    fetchReactionsForMessages,
    createTablesMutation,
    markAsReadMutation,
    sendUserMessageMutation,
  };
}
