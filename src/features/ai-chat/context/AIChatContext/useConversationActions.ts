import { useState, useCallback, useRef, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import type { AIAgent, ChatMessage, Conversation } from './types';

interface UseConversationActionsOptions {
  spaceId?: number;
  historyAgentFilter: number | null;
  labId: string | null;
  agents: AIAgent[];
  currentAgent: AIAgent | null;
  setCurrentAgent: (agent: AIAgent | null) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setError: (error: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setIsAgentProcessing: (processing: boolean) => void;
  setProcessingAgentName: (name: string | null) => void;
  setProcessingStartedAt: (ts: number | null) => void;
  currentConversationIdRef: React.MutableRefObject<number | null>;
}

export function useConversationActions({
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
}: UseConversationActionsOptions) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<number | null>(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [hasMoreAIMessages, setHasMoreAIMessages] = useState(false);
  const [isFetchingOlderAIMessages, setIsFetchingOlderAIMessages] = useState(false);

  // Pending agent_id from selectConversation (Bug fix: agents may not be loaded yet)
  const [pendingAgentId, setPendingAgentId] = useState<number | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
  }, [currentConversationId, currentConversationIdRef]);

  // Bug fix: Retry agent lookup when agents finally load (selectConversation may have fired before loadAgents)
  useEffect(() => {
    if (pendingAgentId && agents.length > 0 && !currentAgent) {
      const agent = agents.find(a => a.id === pendingAgentId);
      if (agent) {
        setCurrentAgent(agent);
        setPendingAgentId(null);
      }
    }
  }, [agents, pendingAgentId, currentAgent, setCurrentAgent]);

  // Load conversations
  const loadConversations = useCallback(async () => {
    setIsLoadingConversations(true);
    try {
      const params = new URLSearchParams();
      if (spaceId) params.append('spaceId', String(spaceId));
      // Only filter by agent when historyAgentFilter is set (user picked an agent in dropdown)
      if (historyAgentFilter) params.append('agentId', String(historyAgentFilter));
      // ADR-043: Filter by lab_id for Labs integration
      if (labId) params.append('labId', labId);

      const queryString = params.toString() ? `?${params.toString()}` : '';
      const response = await apiClient.get<{ success: boolean; data: { conversations: Conversation[] } }>(
        `/ai/conversations${queryString}`
      );

      if (response.success && response.data?.conversations) {
        setConversations(response.data.conversations);
      }
    } catch (err) {
      logger.error('Failed to load conversations:', err);
    } finally {
      setIsLoadingConversations(false);
    }
  }, [spaceId, historyAgentFilter, labId]);

  // Select and load a conversation
  const selectConversation = useCallback(async (id: number) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiClient.get<{
        success: boolean;
        data: {
          id: number;
          title: string;
          agent_id: number;
          agentName: string;
          messages: ChatMessage[];
          isProcessing?: boolean;
          processingAgentName?: string | null;
          processingStartedAt?: string | null;
          hasMore?: boolean;
          nextCursor?: number;
          // Ticket #77792: Bound row data from backend
          bound_table_id?: number | null;
          bound_row_id?: number | null;
          settings?: string | Record<string, unknown> | null;
        };
      }>(`/ai/conversations/${id}?limit=100`);

      if (response.success && response.data) {
        setCurrentConversationId(id);
        currentConversationIdRef.current = id; // Keep ref in sync

        // Restore messages
        const restoredMessages = (response.data.messages || []).map((m, idx) => ({
          ...m,
          id: m.id || `restored_${idx}_${Date.now()}`,
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date()
        }));
        setMessages(restoredMessages);

        // Update pagination state
        setHasMoreAIMessages(!!response.data.hasMore);

        // Update agent processing state from server (Ticket #36708: include started timestamp)
        setIsAgentProcessing(!!response.data.isProcessing);
        setProcessingAgentName(response.data.isProcessing ? (response.data.processingAgentName ?? null) : null);
        if (response.data.isProcessing && response.data.processingStartedAt) {
          setProcessingStartedAt(new Date(response.data.processingStartedAt).getTime());
        }

        // Try to set the agent (Bug fix: store pendingAgentId if agents not loaded yet)
        if (response.data.agent_id) {
          const agent = agents.find(a => a.id === response.data.agent_id);
          if (agent) {
            setCurrentAgent(agent);
            setPendingAgentId(null);
          } else {
            // Agents may not be loaded yet — store for deferred lookup
            setPendingAgentId(response.data.agent_id);
          }
        }

        // Ticket #77792: Return bound data + title so callers can restore boundRows and display title
        return {
          title: response.data.title ?? null,
          bound_table_id: response.data.bound_table_id ?? null,
          bound_row_id: response.data.bound_row_id ?? null,
        };
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation');
    } finally {
      setIsLoading(false);
    }
  }, [agents, setCurrentAgent, setMessages, setError, setIsLoading, setIsAgentProcessing, setProcessingAgentName, setProcessingStartedAt, currentConversationIdRef]);

  // Fetch older AI messages (pagination: load earlier messages)
  const fetchOlderAIMessages = useCallback(async () => {
    if (!currentConversationId || !hasMoreAIMessages || isFetchingOlderAIMessages) return;

    setIsFetchingOlderAIMessages(true);
    try {
      // Use a function to get current messages to avoid stale closure
      let currentMessages: ChatMessage[] = [];
      setMessages(prev => { currentMessages = prev; return prev; });

      // Get the oldest numeric message ID as cursor (skip synthetic IDs like "msg_xxx" or "restored_xxx")
      const numericIds = currentMessages
        .map(m => typeof m.id === 'number' ? m.id : parseInt(String(m.id)))
        .filter(id => Number.isFinite(id) && id > 0);
      const oldestId = numericIds.length > 0 ? Math.min(...numericIds) : null;
      if (!oldestId) return;

      const response = await apiClient.get<{
        success: boolean;
        data: {
          messages: ChatMessage[];
          hasMore?: boolean;
          nextCursor?: number;
        };
      }>(`/ai/conversations/${currentConversationId}?limit=100&before=${oldestId}`);

      if (response.success && response.data) {
        const olderMessages = (response.data.messages || []).map((m, idx) => ({
          ...m,
          id: m.id || `older_${idx}_${Date.now()}`,
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date()
        }));

        // Prepend older messages to the beginning (with dedup)
        setMessages(current => {
          const existingIds = new Set(current.map(m => String(m.id)));
          const unique = olderMessages.filter(m => !existingIds.has(String(m.id)));
          return [...unique, ...current];
        });
        setHasMoreAIMessages(!!response.data.hasMore);
      }
    } catch (err) {
      logger.error('Failed to fetch older messages:', err);
    } finally {
      setIsFetchingOlderAIMessages(false);
    }
  }, [currentConversationId, hasMoreAIMessages, isFetchingOlderAIMessages, setMessages]);

  // Create new conversation
  const createNewConversation = useCallback(async () => {
    setMessages([]);
    setCurrentConversationId(null);
    currentConversationIdRef.current = null; // Also reset ref
    setError(null);
    // Don't create in DB yet - will be created on first message
  }, [setMessages, setError, currentConversationIdRef]);

  // Delete conversation
  const deleteConversation = useCallback(async (id: number) => {
    try {
      await apiClient.delete(`/chat/conversations/${id}`);
      setConversations(prev => prev.filter(c => c.id !== id));

      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setMessages([]);
      }
    } catch (err) {
      logger.error('Failed to delete conversation:', err);
    }
  }, [currentConversationId, setMessages]);

  // Rename conversation
  const renameConversation = useCallback(async (id: number, title: string) => {
    try {
      await apiClient.patch(`/chat/conversations/${id}`, { title });
      setConversations(prev =>
        prev.map(c => c.id === id ? { ...c, title } : c)
      );
    } catch (err) {
      logger.error('Failed to rename conversation:', err);
    }
  }, []);

  return {
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
  };
}
