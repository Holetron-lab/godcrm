/**
 * Lazy-loading fetch helpers for conversation messages
 * Extracted from useConversationMessages.ts — progressive 4-tier loading
 */

import { useCallback } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import { ChatMessage } from '../types';
import type { ApiResponse } from './conversationMessages.types';

export function useMessageFetchers(conversationId: number | null) {
  // L2: Fetch only thinking/reasoning steps for a message range
  const fetchThinkingSteps = useCallback(async (afterId: number, beforeId: number): Promise<ChatMessage[]> => {
    if (!conversationId) return [];
    const response = await apiClient.get<ApiResponse<{ messages: ChatMessage[] }>>(
      `/chat/conversations/${conversationId}/messages?after=${afterId}&before=${beforeId}&content_types=thinking&limit=500`
    );
    return response?.data?.messages || [];
  }, [conversationId]);

  // L3: Fetch tool_call + tool_result with truncated results (first 100 chars)
  const fetchToolStepsPreview = useCallback(async (afterId: number, beforeId: number): Promise<ChatMessage[]> => {
    if (!conversationId) return [];
    const response = await apiClient.get<ApiResponse<{ messages: ChatMessage[] }>>(
      `/chat/conversations/${conversationId}/messages?after=${afterId}&before=${beforeId}&content_types=tool_call,tool_result&truncate_content=100&limit=500`
    );
    return response?.data?.messages || [];
  }, [conversationId]);

  // L4: Fetch full content of a single message (for expanding truncated tool results)
  const fetchFullMessage = useCallback(async (messageId: number): Promise<{ id: number; content: string; content_type: string } | null> => {
    if (!conversationId) return null;
    const response = await apiClient.get<ApiResponse<{ id: number; content: string; content_type: string }>>(
      `/chat/messages/${messageId}/full`
    );
    return response?.data || null;
  }, [conversationId]);

  // Legacy: fetch all hidden steps at once (kept for backwards compat)
  const fetchToolSteps = useCallback(async (afterId: number, beforeId: number): Promise<ChatMessage[]> => {
    if (!conversationId) return [];
    const response = await apiClient.get<ApiResponse<{ messages: ChatMessage[] }>>(
      `/chat/conversations/${conversationId}/messages?after=${afterId}&before=${beforeId}&content_types=thinking,tool_call,tool_result&limit=500`
    );
    return response?.data?.messages || [];
  }, [conversationId]);

  return { fetchThinkingSteps, fetchToolStepsPreview, fetchFullMessage, fetchToolSteps };
}
