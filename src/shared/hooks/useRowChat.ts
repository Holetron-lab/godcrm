/**
 * useRowChat - Hook for chat integration with table rows
 * @see ADR-069-MODULE-INTEGRATION.md
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: { message: string; code?: string };
}

export interface ChatMessage {
  id: number;
  conversation_id: number;
  user_id: number;
  content: string;
  content_type: string;
  created_at: string;
  sender_type?: 'human' | 'agent';
  role?: 'user' | 'assistant' | 'system' | 'tool';
  agent_id?: number;
  tool_results?: Array<{ tool: string; args?: Record<string, unknown>; result?: unknown }>;
  user?: {
    id: number;
    name: string;
    avatar?: string;
    user_type?: 'user' | 'agent';
  };
}

interface ChatParticipant {
  user_id: number;
  role: string;
  joined_at: string;
  user?: {
    id: number;
    name: string;
    avatar?: string;
  };
}

interface ChatConversation {
  conversationId: number;
  bound_table_id: number;
  bound_row_id: number;
  messages: ChatMessage[];
  participants: ChatParticipant[];
}

interface UseRowChatOptions {
  tableId: number;
  rowId: number;
  autoCreate?: boolean;
}

interface UseRowChatResult {
  conversationId: number | null;
  messages: ChatMessage[];
  participants: ChatParticipant[];
  isLoading: boolean;
  error: Error | null;
  sendMessage: (text: string) => void;
  isSending: boolean;
  refetch: () => void;
}

export function useRowChat({ 
  tableId, 
  rowId, 
  autoCreate = true 
}: UseRowChatOptions): UseRowChatResult {
  const queryClient = useQueryClient();
  
  // Fetch or create conversation
  const { 
    data: conversation, 
    isLoading, 
    error,
    refetch 
  } = useQuery<ChatConversation>({
    queryKey: ['rowChat', tableId, rowId],
    queryFn: async () => {
      const url = `/chat/tasks/${tableId}/${rowId}${autoCreate ? '?create=true' : ''}`;
      logger.debug({ tableId, rowId, url }, '[useRowChat] Fetching conversation');
      
      const response = await apiClient.get<ApiResponse<ChatConversation>>(url);
      
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch conversation');
      }
      
      return response.data;
    },
    enabled: !!tableId && !!rowId && tableId > 0 && rowId > 0,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: false,
  });
  
  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!conversation?.conversationId) {
        throw new Error('No conversation available');
      }
      
      logger.debug({ conversationId: conversation.conversationId, text }, '[useRowChat] Sending message');
      
      const response = await apiClient.post<ApiResponse<ChatMessage>>(
        `/chat/conversations/${conversation.conversationId}/messages`,
        {
          content: text,
          content_type: 'text'
        }
      );
      
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to send message');
      }
      
      return response.data;
    },
    onSuccess: () => {
      // Invalidate and refetch conversation to get new messages
      queryClient.invalidateQueries({ queryKey: ['rowChat', tableId, rowId] });
    },
    onError: (error) => {
      logger.error({ error }, '[useRowChat] Failed to send message');
    }
  });
  
  return {
    conversationId: conversation?.conversationId ?? null,
    messages: conversation?.messages ?? [],
    participants: conversation?.participants ?? [],
    isLoading,
    error: error as Error | null,
    sendMessage: sendMessageMutation.mutate,
    isSending: sendMessageMutation.isPending,
    refetch,
  };
}
