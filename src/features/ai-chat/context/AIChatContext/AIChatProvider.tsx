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

  // External row attachment state
  const [pendingBoundRow, setPendingBoundRow] = useState<{ table_id: number; row_id: number; table_name?: string; table_icon?: string; row_title?: string } | null>(null);
  const [pendingMessageRow, setPendingMessageRow] = useState<{ table_id: number; row_id: number; table_name?: string; table_icon?: string; row_title?: string } | null>(null);

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

  // External row attachment methods — called from UniversalTable etc.
  const attachRowToChat = useCallback((row: { table_id: number; row_id: number; table_name?: string; table_icon?: string; row_title?: string }) => {
    setPendingBoundRow(row);
    if (!isOpen) setIsOpen(true);
  }, [isOpen]);

  const attachRowToMessage = useCallback((row: { table_id: number; row_id: number; table_name?: string; table_icon?: string; row_title?: string }) => {
    setPendingMessageRow(row);
    if (!isOpen) setIsOpen(true);
  }, [isOpen]);

  const clearPendingBoundRow = useCallback(() => setPendingBoundRow(null), []);
  const clearPendingMessageRow = useCallback(() => setPendingMessageRow(null), []);

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
        // ADR-0079 §2: hide locked Tier-B bindings from the invocation surface.
        // Settings → Add Agent uses a separate fetch that intentionally shows
        // locked bindings to enable unlock.
        const activeAgents = response.data.agents.filter(
          (a) => a.is_active && a.visibility !== 'locked'
        );
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
    setIsAgentProcessing,
    processingAgentName,
    processingStartedAt,
    setProcessingAgentName,
    setProcessingStartedAt,
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
    setCurrentConversationId,
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
    // External row attachment
    attachRowToChat,
    attachRowToMessage,
    pendingBoundRow,
    pendingMessageRow,
    clearPendingBoundRow,
    clearPendingMessageRow,
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

/**
 * AIChatStubProvider — read-only no-op provider for unauthenticated public surfaces.
 *
 * ADR-0060-A: the public surface mounts the same internal `<DashboardGrid readOnly>` as
 * the authed app. Widgets in the documents preset call `useAIChat()` for "open chat for
 * this row / attach row to message" affordances. Visitors never see those affordances
 * (read-only gating hides the buttons), but the hook still needs *some* context value
 * for the components to mount without throwing. This provider returns a frozen no-op
 * shape — no API calls, no state, no event handlers that do anything.
 *
 * Authed code paths still throw on missing provider — only public mount uses this.
 */
const STUB_NOOP_ASYNC = async () => undefined;
const STUB_NOOP = () => undefined;

const stubValue: AIChatContextValue = {
  isOpen: false,
  currentAgent: null,
  agents: [],
  messages: [],
  isLoading: false,
  isLoadingAgents: false,
  isStreaming: false,
  error: null,
  openChat: STUB_NOOP,
  closeChat: STUB_NOOP,
  toggleChat: STUB_NOOP,
  selectAgent: STUB_NOOP,
  sendMessage: STUB_NOOP_ASYNC,
  clearMessages: STUB_NOOP,
  loadAgents: STUB_NOOP_ASYNC,
  agentMode: false,
  setAgentMode: STUB_NOOP,
  isAgentProcessing: false,
  setIsAgentProcessing: STUB_NOOP,
  processingAgentName: null,
  processingStartedAt: null,
  setProcessingAgentName: STUB_NOOP,
  setProcessingStartedAt: STUB_NOOP,
  dismissProcessing: STUB_NOOP,
  resetProcessing: STUB_NOOP_ASYNC,
  stopAgent: STUB_NOOP_ASYNC,
  hasMoreAIMessages: false,
  isFetchingOlderAIMessages: false,
  fetchOlderAIMessages: STUB_NOOP_ASYNC,
  conversations: [],
  currentConversationId: null,
  setCurrentConversationId: STUB_NOOP,
  loadConversations: STUB_NOOP_ASYNC,
  selectConversation: STUB_NOOP_ASYNC,
  createNewConversation: STUB_NOOP_ASYNC,
  deleteConversation: STUB_NOOP_ASYNC,
  renameConversation: STUB_NOOP_ASYNC,
  isLoadingConversations: false,
  historyAgentFilter: null,
  setHistoryAgentFilter: STUB_NOOP,
  labId: null,
  setLabId: STUB_NOOP,
  spaceId: undefined,
  pendingTaskChat: null,
  openTaskChat: STUB_NOOP,
  clearPendingTaskChat: STUB_NOOP,
  attachRowToChat: STUB_NOOP,
  attachRowToMessage: STUB_NOOP,
  pendingBoundRow: null,
  pendingMessageRow: null,
  clearPendingBoundRow: STUB_NOOP,
  clearPendingMessageRow: STUB_NOOP,
  rowFilter: null,
  clearRowFilter: STUB_NOOP,
};

export function AIChatStubProvider({ children }: { children: React.ReactNode }) {
  return <AIChatContext.Provider value={stubValue}>{children}</AIChatContext.Provider>;
}
