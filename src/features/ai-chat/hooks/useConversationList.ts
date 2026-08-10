/**
 * Hooks for conversation creation and listing
 * Extracted from useConversationMessages.ts for file size compliance
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type { ApiResponse, ConversationResponse } from './conversationMessages.types';

/**
 * Hook for creating a new conversation
 */
export function useCreateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      type?: 'chat' | 'task' | 'row';
      title?: string;
      participantIds?: number[];
      spaceId?: number;
      agentId?: number;
      sub_agents?: Array<number | { row_id: number; response_mode?: string }>;
    }) => {
      const response = await apiClient.post<ApiResponse<{ id: number }>>(
        '/chat/conversations',
        {
          type: params.type || 'chat',
          title: params.title,
          participant_ids: params.participantIds,
          space_id: params.spaceId,
          agent_id: params.agentId,
          sub_agents: params.sub_agents
        }
      );
      return response?.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox-conversations'] });
    }
  });
}

/**
 * Hook for fetching conversation list
 */
export function useConversations(options: {
  type?: string;
  spaceId?: number;
  limit?: number;
} = {}) {
  return useQuery({
    queryKey: ['conversations', options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options.type) params.set('type', options.type);
      if (options.spaceId) params.set('space_id', options.spaceId.toString());
      if (options.limit) params.set('limit', options.limit.toString());

      const response = await apiClient.get<ApiResponse<ConversationResponse[]>>(
        `/chat/conversations?${params.toString()}`
      );
      return response?.data || [];
    }
  });
}
