/**
 * useChatActions Hook
 * Handles chat message actions extracted from AIChatPanel
 */

import { useCallback } from 'react';
import { useAIChat } from '../../../context/AIChatContext';
import type { AIAgent } from '../../../types';

interface Mention {
  id: number;
  name: string;
  type: 'human' | 'agent' | 'bot' | 'service';
}

interface SendMessageData {
  content: string;
  attachments?: File[];
  modelId?: number;
  mentions?: Mention[];
  agentMode?: boolean;
  systemPromptPrefix?: string;
}

export function useChatActions() {
  const {
    sendMessage,
    clearMessages,
    selectAgent,
    createNewConversation,
    deleteConversation,
    isLoading,
    isStreaming,
    error
  } = useAIChat();

  const handleSendMessage = useCallback(async (data: SendMessageData) => {
    await sendMessage(
      data.content,
      data.attachments,
      data.modelId,
      data.mentions,
      data.agentMode,
      data.systemPromptPrefix
    );
  }, [sendMessage]);

  const handleClearMessages = useCallback(() => {
    clearMessages();
  }, [clearMessages]);

  const handleSelectAgent = useCallback((agent: AIAgent) => {
    selectAgent(agent);
  }, [selectAgent]);

  const handleCreateConversation = useCallback(async () => {
    await createNewConversation();
  }, [createNewConversation]);

  const handleDeleteConversation = useCallback(async (conversationId: number) => {
    await deleteConversation(conversationId);
  }, [deleteConversation]);

  return {
    handleSendMessage,
    handleClearMessages,
    handleSelectAgent,
    handleCreateConversation,
    handleDeleteConversation,
    isLoading,
    isStreaming,
    error
  };
}
