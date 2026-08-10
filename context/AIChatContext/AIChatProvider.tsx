import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import type { AIAgent, ChatMessage, AIChatContextValue, AIChatProviderProps, PendingTaskChat } from './types';
import { useProcessingState } from './useProcessingState';
import { useConversationActions } from './useConversationActions';
import { useSendMessage } from './useSendMessage';

const AIChatContext = createContext<AIChatContextValue | null>(null);

export function AIChatProvider({ children, spaceId }: AIChatProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<AIAgent | null>(null);
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true); // Start true — agents not yet loaded
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Agent mode - passed as agent_mode to backend (backend handles agent execution)
  const [agentMode, setAgentMode] = useState(false);

  // ADR-043: Labs integration - filter conversations by lab_id
  const [labId, setLabId] = useState<string | null>(null);

  // History agent filter — null = show all agents
  const [historyAgentFilter, setHistoryAgentFilter] = useState<number | null>(null);

  // ADR-069: Pending task chat - for opening ticket chats from external components
  const [pendingTaskChat, setPendingTaskChat] = useState<PendingTaskChat | null>(null);

  // Multi-conversation row filter — filters history panel to show only conversations for a specific row
  const [rowFilter, setRowFilter] = useState<{ tableId: number; rowId: number; rowTitle: string; conversations: PendingTaskChat['conversations'] } | null>(null);

  // Ref for current conversation ID to avoid stale closure issues
  const currentConversationIdRef = useRef<number | null>(null);

  // Ref for currentAgent to avoid stale closure in loadAgents (Bug fix: race condition)
  const currentAgentRef = useRef<AIAgent | null>(null);

  useEffect(() => {
    currentAgentRef.current = currentAgent;
  }, [currentAgent]);

  // --- Processing state hook ---
  const {
    isAgentProcessing,
    setIsAgentProcessing,
    processingAgentName,
    setProcessingAgentName,
    processingStartedAt,
    setProcessingStartedAt,
    dismissProcessing,
    resetProcessing,
    stopAgent,
  } = useProcessingState(currentConversationIdRef);

  // --- Conversation actions hook ---
  const {
    conversations,
    currentConversationId,
    setCurrentConversationId,
    isLoadingConversations,
    hasMoreAIMessages,
    isFetchingOlderAIMessages,
    loadConversations,
    selectConversation,
    fetchOlderAIMessages,
    createNewConversation,
    deleteConversation,
    renameConversation,
  } = useConversationActions({
    spaceId,
    historyAgentFilter,
    labId,
    agents,
    currentAgent,
    setCurrentAgent,
    setMessages,
    setError,
    setIsLoading,
    setIsAgentProcessing,
    setProcessingAgentName,
    setProcessingStartedAt,
    currentConversationIdRef,
  });

  // --- Chat panel controls ---
  const openChat = useCallback(() => setIsOpen(true), []);
  const closeChat = useCallback(() => setIsOpen(false), []);
  const toggleChat = useCallback(() => setIsOpen((prev) => !prev), []);

  // ADR-069: Open task/ticket chat from external components
  const openTaskChat = useCallback((chat: PendingTaskChat) => {
    // If multi-conversation mode, set row filter to show only this row's conversations
    if (chat.multi && chat.conversations && chat.conversations.length > 1) {
      setRowFilter({
        tableId: chat.tableId,
        rowId: chat.rowId,
        rowTitle: chat.rowTitle || `#${chat.rowId}`,
        conversations: chat.conversations
      });
    } else {
      setRowFilter(null);
    }
    setPendingTaskChat(chat);
    setIsOpen(true);
  }, []);

  const clearPendingTaskChat = useCallback(() => {
    setPendingTaskChat(null);
  }, []);

  const clearRowFilter = useCallback(() => {
    setRowFilter(null);
  }, []);

  const selectAgent = useCallback((agent: AIAgent) => {
    setCurrentAgent(agent);
    // Clear messages when changing agent but keep conversation
    setMessages([]);
    setError(null);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setCurrentConversationId(null);
    currentConversationIdRef.current = null;
  }, [setCurrentConversationId]);

  // --- Load agents ---
  const loadAgents = useCallback(async () => {
    if (!spaceId) {
      // If no spaceId, try to get agents from all AI spaces
      setIsLoading(true);
      setIsLoadingAgents(true);
      setError(null);

      try {
        const response = await apiClient.get<{ success: boolean; data: { agents: AIAgent[] } }>(
          '/ai/agents'
        );

        if (response.success && response.data?.agents) {
          const activeAgents = response.data.agents.filter((a) => a.is_active);
          setAgents(activeAgents);

          // Do NOT auto-select agent here — let AIChatPanel Effect #5 handle it.
          // It checks defaultAgentId from space settings first, then falls back to agents[0].
          // Selecting here causes a race condition: loadAgents() runs before defaultAgentId
          // is loaded from currentSpace.settings → always picks agents[0] instead of default.
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load agents');
      } finally {
        setIsLoading(false);
        setIsLoadingAgents(false);
      }
      return;
    }

    setIsLoading(true);
    setIsLoadingAgents(true);
    setError(null);

    try {
      const response = await apiClient.get<{ success: boolean; data: { agents: AIAgent[] } }>(
        `/ai/agents/${spaceId}`
      );

      if (response.success && response.data?.agents) {
        const activeAgents = response.data.agents.filter((a) => a.is_active);
        setAgents(activeAgents);

        // Do NOT auto-select agent here — let AIChatPanel Effect #5 handle it.
        // See comment above for explanation of the race condition.
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setIsLoading(false);
      setIsLoadingAgents(false);
    }
  }, [spaceId]); // Removed currentAgent dep — use ref to prevent infinite re-creation

  // Reload agents when spaceId changes
  useEffect(() => {
    if (spaceId) {
      // Reset current agent when space changes
      setCurrentAgent(null);
      setMessages([]);
      setError(null);
      // Load agents for new space
      loadAgents();
    }
  }, [spaceId]); // Only depend on spaceId, not loadAgents to avoid infinite loop

  // Load conversations when panel opens or history filter changes
  useEffect(() => {
    if (isOpen) {
      loadConversations();
    }
  }, [isOpen, loadConversations]);

  // ADR-078: Polling REMOVED from AIChatContext.
  // All message polling now goes through useConversationMessages hook (React Query)
  // as the single source of truth. This eliminates the dual-polling split-brain bug
  // where AIChatContext.setMessages() and React Query cache diverged.
  //
  // What remains here: mutations (sendMessage, create/delete conversation),
  // agent processing state, and conversation management.

  // --- Send message hook ---
  const sendMessage = useSendMessage({
    currentAgent,
    spaceId,
    messages,
    agentMode,
    labId,
    setMessages,
    setIsLoading,
    setIsStreaming,
    setError,
    setIsAgentProcessing,
    setCurrentConversationId,
    currentConversationIdRef,
    loadConversations,
  });

  const value: AIChatContextValue = {
    isOpen,
    currentAgent,
    agents,
    messages,
    isLoading,
    isLoadingAgents,
    isStreaming,
    error,
    openChat,
    closeChat,
    toggleChat,
    selectAgent,
    sendMessage,
    clearMessages,
    loadAgents,
    // Agent mode
    agentMode,
    setAgentMode,
    // Agent processing state (async agent execution via /chat/conversations/:id/messages)
    isAgentProcessing,
    processingAgentName,
    processingStartedAt,
    setProcessingAgentName,
    dismissProcessing,
    resetProcessing,
    stopAgent,
    // Pagination for AI conversations
    hasMoreAIMessages,
    isFetchingOlderAIMessages,
    fetchOlderAIMessages,
    // Conversation
    conversations,
    currentConversationId,
    loadConversations,
    selectConversation,
    createNewConversation,
    deleteConversation,
    renameConversation,
    isLoadingConversations,
    // History agent filter
    historyAgentFilter,
    setHistoryAgentFilter,
    // ADR-043: Labs integration
    labId,
    setLabId,
    // Space context
    spaceId,
    // ADR-069: Task/ticket chat from external components
    pendingTaskChat,
    openTaskChat,
    clearPendingTaskChat,
    // Multi-conversation row filter
    rowFilter,
    clearRowFilter
  };

  return <AIChatContext.Provider value={value}>{children}</AIChatContext.Provider>;
}

export function useAIChat() {
  const context = useContext(AIChatContext);
  if (!context) {
    throw new Error('useAIChat must be used within AIChatProvider');
  }
  return context;
}
