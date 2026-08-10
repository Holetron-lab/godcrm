/**
 * useConversationMessages Hook
 * ADR-024 Phase 2 + ADR-078: React Query-based hook for conversation messages
 *
 * ADR-078 changes:
 * - Single source of truth for ALL message polling (AI + user chats)
 * - Incremental polling with `?after=<lastId>` parameter
 * - Exponential backoff on consecutive failures (3 = warning, 10 = stop)
 * - Adaptive polling intervals based on chat activity
 * - User-visible error state for connection issues
 *
 * Uses TanStack Query for:
 * - Optimistic updates
 * - Automatic cache invalidation
 * - Infinite scrolling support
 */

import { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { ChatMessage } from '../types';
import { logger } from '@/shared/utils/logger';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp?: string;
}

interface ConversationResponse {
  id: number;
  type: string;
  title: string | null;
  messages: ChatMessage[];
  hasMore?: boolean;
  nextCursor?: number;
  sub_agents?: Array<{ row_id: number; name: string; icon?: string | null; response_mode?: string }>;
  participants?: Array<{ user_id: number; name: string; email?: string; avatar_url?: string; role?: string; user_type?: string; joined_at?: string }>;
}

interface SendMessageParams {
  content: string;
  contentType?: 'text' | 'markdown' | 'code';
  mentions?: Array<{ user_id: number; offset?: number; length?: number }>;
  parentId?: number;
}

/**
 * ADR-078: Adaptive polling intervals based on chat activity state
 */
export const POLL_INTERVALS = {
  AGENT_PROCESSING: 1500,  // Agent is thinking → fast polling
  ACTIVE_CHAT: 3000,       // User recently sent message (< 30s ago)
  IDLE_CHAT: 8000,         // No activity for 30s+
  BACKGROUND: 15000,       // Chat panel minimized/hidden
} as const;

/** ADR-078: Chat activity state for adaptive polling */
export type ChatActivityState = 'agent_processing' | 'active' | 'idle' | 'background';

interface UseConversationMessagesOptions {
  pageSize?: number;
  enabled?: boolean;
  /** Polling interval in ms for fetching new messages from other users.
   *  If set, uses fixed interval. If not set but adaptivePolling is true, uses adaptive. */
  pollingInterval?: number;
  /** ADR-078: Enable adaptive polling based on chat activity */
  adaptivePolling?: boolean;
  /** ADR-078: Current chat activity state (drives adaptive interval) */
  chatActivityState?: ChatActivityState;
  /** Current user ID — used to set sender_id on optimistic messages for correct grouping */
  currentUserId?: number;
}

/**
 * Hook for managing conversation messages with React Query
 * 
 * @param conversationId - The ID of the conversation
 * @param options - Options for the hook
 * @returns Query and mutation results
 */
export function useConversationMessages(
  conversationId: number | null,
  options: UseConversationMessagesOptions = {}
) {
  const { pageSize = 50, enabled = true, pollingInterval, adaptivePolling = false, chatActivityState = 'idle', currentUserId } = options;
  // Lazy loading: exclude heavy tool/thinking messages from initial load & pagination
  const LAZY_CONTENT_TYPES = 'text,plan,tool_approval';
  const queryClient = useQueryClient();

  // Fetch conversation metadata (not messages — those come from infinite query)
  const conversationQuery = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: async () => {
      if (!conversationId) return null;
      const response = await apiClient.get<ApiResponse<ConversationResponse>>(
        `/chat/conversations/${conversationId}`
      );
      return response?.data || null;
    },
    enabled: !!conversationId && enabled,
    staleTime: 30000, // Metadata doesn't change often
    refetchOnMount: true,
  });

  // Infinite query for messages — single source of truth for all message data.
  // First page loads latest messages (no cursor), subsequent pages load older via `before` cursor.
  // Polling for new messages handled separately below.
  const messagesInfiniteQuery = useInfiniteQuery({
    queryKey: ['conversation-messages', conversationId],
    queryFn: async ({ pageParam }) => {
      if (!conversationId) return { messages: [], hasMore: false };

      const params = new URLSearchParams();
      params.set('limit', pageSize.toString());
      params.set('content_types', LAZY_CONTENT_TYPES);
      if (pageParam != null) {
        params.set('before', String(pageParam));
      }

      const response = await apiClient.get<ApiResponse<{ messages: ChatMessage[]; hasMore: boolean; nextCursor?: number }>>(
        `/chat/conversations/${conversationId}/messages?${params.toString()}`
      );

      return response?.data || { messages: [], hasMore: false };
    },
    getNextPageParam: (lastPage) => {
      // Return undefined to signal "no more pages" (TanStack Query convention)
      // Return cursor number to signal "more pages available"
      if (lastPage.hasMore && lastPage.nextCursor != null) {
        return lastPage.nextCursor;
      }
      return undefined;
    },
    initialPageParam: null as number | null,
    enabled: !!conversationId && enabled
  });

  // ADR-078: Incremental polling with `?after=<lastId>`, backoff, and adaptive intervals
  // Single polling mechanism — replaces both old AIChatContext polling and old useConversationMessages polling
  const consecutiveFailuresRef = useRef(0);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [pollingStopped, setPollingStopped] = useState(false);

  // Compute effective polling interval
  const effectiveInterval = useMemo(() => {
    if (pollingInterval) return pollingInterval; // Explicit override
    if (!adaptivePolling) return 0; // Disabled
    switch (chatActivityState) {
      case 'agent_processing': return POLL_INTERVALS.AGENT_PROCESSING;
      case 'active': return POLL_INTERVALS.ACTIVE_CHAT;
      case 'idle': return POLL_INTERVALS.IDLE_CHAT;
      case 'background': return POLL_INTERVALS.BACKGROUND;
      default: return POLL_INTERVALS.IDLE_CHAT;
    }
  }, [pollingInterval, adaptivePolling, chatActivityState]);

  // Get the newest message ID from cache for incremental polling.
  // Uses a ref to avoid restarting the polling effect when data changes.
  const newestMessageIdRef = useRef<number>(0);

  // Keep the ref in sync with the latest cache data
  useEffect(() => {
    const pages = messagesInfiniteQuery.data?.pages;
    if (!pages || pages.length === 0) { newestMessageIdRef.current = 0; return; }
    let maxId = 0;
    for (const page of pages) {
      for (const m of page.messages) {
        const numId = typeof m.id === 'number' ? m.id : parseInt(String(m.id)) || 0;
        if (numId > maxId) maxId = numId;
      }
    }
    newestMessageIdRef.current = maxId;
  }, [messagesInfiniteQuery.data]);

  const getNewestMessageId = useCallback((): number => {
    return newestMessageIdRef.current;
  }, []);

  // Reconnect function — reset failures and restart polling
  const reconnect = useCallback(() => {
    consecutiveFailuresRef.current = 0;
    setPollingError(null);
    setPollingStopped(false);
    logger.info('[Chat Poll] Reconnecting — polling restarted');
  }, []);

  // Auto-reconnect after polling stopped — retry after 30s cooldown
  useEffect(() => {
    if (!pollingStopped) return;
    const timer = setTimeout(() => {
      logger.info('[Chat Poll] Auto-reconnecting after 30s cooldown');
      reconnect();
    }, 30000);
    return () => clearTimeout(timer);
  }, [pollingStopped, reconnect]);

  // Track is_processing and processing_agent_name from backend polling response
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingAgentName, setProcessingAgentName] = useState<string | null>(null);

  // Ref to track whether polling should stop (avoids stale closure in setTimeout chain)
  const pollingStoppedRef = useRef(pollingStopped);
  useEffect(() => { pollingStoppedRef.current = pollingStopped; }, [pollingStopped]);

  // Ref to track current effective interval (avoids stale closure)
  const effectiveIntervalRef = useRef(effectiveInterval);
  useEffect(() => { effectiveIntervalRef.current = effectiveInterval; }, [effectiveInterval]);

  useEffect(() => {
    if (!conversationId || !enabled || effectiveInterval <= 0 || pollingStopped) return;

    let currentInterval = effectiveInterval;
    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false; // Local flag to stop scheduling on cleanup

    const poll = async () => {
      try {
        // ADR-078: Use ?after=<lastId> for incremental fetch (only new messages)
        const lastId = getNewestMessageId();
        const url = lastId > 0
          ? `/chat/conversations/${conversationId}/messages?after=${lastId}&limit=50&content_types=${LAZY_CONTENT_TYPES}`
          : `/chat/conversations/${conversationId}/messages?limit=${pageSize}&content_types=${LAZY_CONTENT_TYPES}`;

        const response = await apiClient.get<ApiResponse<{ messages: ChatMessage[]; hasMore: boolean; nextCursor?: number; is_processing?: boolean; processing_agent_name?: string | null }>>(url);
        const freshMessages = response?.data?.messages || [];

        // Update processing state from backend response
        const backendProcessing = !!response?.data?.is_processing;
        setIsProcessing(backendProcessing);
        setProcessingAgentName(backendProcessing ? (response?.data?.processing_agent_name ?? null) : null);

        // Success — reset failure counter and interval
        if (consecutiveFailuresRef.current > 0) {
          logger.info('[Chat Poll] Connection restored after', consecutiveFailuresRef.current, 'failures');
        }
        consecutiveFailuresRef.current = 0;
        currentInterval = effectiveIntervalRef.current; // Reset to latest base interval
        setPollingError(null);

        if (freshMessages.length === 0) return;

        logger.debug('[Chat Poll] Received', freshMessages.length, 'new messages via incremental poll');

        // Merge new messages into the first page of infinite query cache
        queryClient.setQueryData(
          ['conversation-messages', conversationId],
          (old: typeof messagesInfiniteQuery.data) => {
            if (!old || !old.pages || old.pages.length === 0) {
              // No existing data — create first page with the new messages
              return {
                pages: [{ messages: freshMessages, hasMore: false }],
                pageParams: [null]
              };
            }

            // Collect all existing message IDs across all pages
            const existingIds = new Set<string>();
            for (const page of old.pages) {
              for (const m of page.messages) {
                existingIds.add(String(m.id));
              }
            }

            // Find truly new messages (not in any existing page)
            const newOnes = freshMessages.filter(m => !existingIds.has(String(m.id)));
            if (newOnes.length === 0) return old;

            // Append new messages to the FIRST page (latest messages page)
            const updatedPages = [...old.pages];
            updatedPages[0] = {
              ...updatedPages[0],
              messages: [...updatedPages[0].messages, ...newOnes]
            };
            return { ...old, pages: updatedPages };
          }
        );
      } catch (err) {
        // ADR-078: Exponential backoff on failure
        consecutiveFailuresRef.current++;
        const failures = consecutiveFailuresRef.current;
        const errMsg = err instanceof Error ? err.message : String(err);
        const is502 = /502|503|504/.test(errMsg);

        // Only log at debug level for gateway errors (expected during deploys/restarts)
        if (is502 && failures <= 3) {
          logger.debug(`[Chat Poll] Gateway error (${failures}), will retry...`);
        } else {
          logger.warn(`[Chat Poll] Failed (attempt ${failures}):`, err);
        }

        if (failures >= 10) {
          // Stop polling — show reconnect button
          setPollingStopped(true);
          setPollingError('Connection lost. Click to reconnect.');
          logger.error('[Chat Poll] Stopped after 10 consecutive failures');
          return;
        }

        if (failures >= 3) {
          // Show warning, back off: double the interval (max 30s)
          setPollingError(is502
            ? 'Server temporarily unavailable. Reconnecting...'
            : 'Connection lost. Messages may be delayed.'
          );
          currentInterval = Math.min(currentInterval * 2, 30000);
        }
      }
    };

    // Use setTimeout chain instead of setInterval for dynamic interval adjustment.
    // Uses refs to read current pollingStopped state (avoids stale closure).
    const scheduleNext = () => {
      if (cancelled || pollingStoppedRef.current) return;
      timeoutId = setTimeout(async () => {
        if (cancelled || pollingStoppedRef.current) return;
        await poll();
        scheduleNext();
      }, currentInterval);
    };

    scheduleNext();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
    // NOTE: getNewestMessageId is stable (uses ref internally), so it won't cause restarts.
    // effectiveInterval changes are tracked via ref inside poll(), but we still include it
    // in deps to restart the chain when the base interval class changes (e.g., idle → active).
  }, [conversationId, enabled, effectiveInterval, pageSize, queryClient, pollingStopped, getNewestMessageId]);

  // Send message mutation with optimistic updates
  const sendMessageMutation = useMutation({
    mutationFn: async (params: SendMessageParams) => {
      if (!conversationId) throw new Error('No conversation selected');
      
      const response = await apiClient.post<ApiResponse<ChatMessage>>(
        `/chat/conversations/${conversationId}/messages`,
        {
          content: params.content,
          content_type: params.contentType || 'text',
          mentions: params.mentions,
          parent_id: params.parentId
        }
      );
      
      return response?.data;
    },
    
    // Optimistic update — add to infinite query cache
    onMutate: async (newMessage) => {
      await queryClient.cancelQueries({ queryKey: ['conversation-messages', conversationId] });

      // Snapshot current infinite query data
      const previousData = queryClient.getQueryData(['conversation-messages', conversationId]);

      // Optimistically add message to the first (latest) page
      const optimisticMessage: ChatMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: newMessage.content,
        timestamp: new Date(),
        isStreaming: true, // Show as pending
        ...(currentUserId != null && { sender_id: currentUserId })
      };

      queryClient.setQueryData(
        ['conversation-messages', conversationId],
        (old: typeof messagesInfiniteQuery.data) => {
          if (!old || !old.pages || old.pages.length === 0) {
            return { pages: [{ messages: [optimisticMessage], hasMore: false }], pageParams: [null] };
          }
          const updatedPages = [...old.pages];
          updatedPages[0] = {
            ...updatedPages[0],
            messages: [...updatedPages[0].messages, optimisticMessage]
          };
          return { ...old, pages: updatedPages };
        }
      );

      return { previousData };
    },

    // Rollback on error
    onError: (_err, _newMessage, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(['conversation-messages', conversationId], context.previousData);
      }
    },

    // BUG FIX: Do NOT invalidateQueries here — it refetches ALL infinite query pages
    // with stale cursors, causing message duplication when page boundaries shift.
    // Polling picks up the confirmed message automatically (with dedup).
    onSuccess: (serverMessage) => {
      if (!serverMessage) return;
      // Replace the optimistic (temp-*) message with the real server message
      queryClient.setQueryData(
        ['conversation-messages', conversationId],
        (old: typeof messagesInfiniteQuery.data) => {
          if (!old?.pages?.length) return old;
          const updatedPages = old.pages.map((page, i) => {
            if (i !== 0) return page;
            // Remove temp messages and add server message (if not already present)
            const withoutTemp = page.messages.filter(m => !String(m.id).startsWith('temp-'));
            const hasServer = withoutTemp.some(m => String(m.id) === String(serverMessage.id));
            return {
              ...page,
              messages: hasServer ? withoutTemp : [...withoutTemp, serverMessage]
            };
          });
          return { ...old, pages: updatedPages };
        }
      );
    }
  });

  // Fetch hidden tool steps for a specific message range (lazy loading)
  const fetchToolSteps = useCallback(async (afterId: number, beforeId: number): Promise<ChatMessage[]> => {
    if (!conversationId) return [];
    const response = await apiClient.get<ApiResponse<{ messages: ChatMessage[] }>>(
      `/chat/conversations/${conversationId}/messages?after=${afterId}&before=${beforeId}&content_types=thinking,tool_call,tool_result&limit=500`
    );
    return response?.data?.messages || [];
  }, [conversationId]);

  // Mark as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async () => {
      if (!conversationId) return;
      await apiClient.post(`/chat/conversations/${conversationId}/read`);
    },
    onSuccess: () => {
      // Invalidate unread counts
      queryClient.invalidateQueries({ queryKey: ['unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-conversations'] });
    }
  });

  // Get all messages flattened from infinite query pages.
  // Pages are stored in reverse order: page[0] = latest, page[1] = older, etc.
  // We need to reverse pages so older messages come first, then concat.
  // BUG FIX: Deduplicate by message ID — page boundaries can overlap after cache mutations.
  const allMessages = useMemo(() => {
    const pages = messagesInfiniteQuery.data?.pages;
    if (!pages || pages.length === 0) return [];
    // Reverse pages: oldest first, newest last. Messages within each page are already chronological.
    const reversed = [...pages].reverse();
    const flat = reversed.flatMap(page => page.messages);
    // Dedup: keep first occurrence (preserves chronological order)
    const seen = new Set<string>();
    return flat.filter(m => {
      const key = String(m.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [messagesInfiniteQuery.data]);

  return {
    // Conversation data
    conversation: conversationQuery.data,
    isLoading: messagesInfiniteQuery.isLoading,
    isError: messagesInfiniteQuery.isError,
    error: messagesInfiniteQuery.error,

    // Messages — from infinite query (supports pagination)
    messages: allMessages,
    allMessages,

    // Infinite query helpers
    hasNextPage: messagesInfiniteQuery.hasNextPage,
    fetchNextPage: messagesInfiniteQuery.fetchNextPage,
    isFetchingNextPage: messagesInfiniteQuery.isFetchingNextPage,

    // Mutations
    sendMessage: sendMessageMutation.mutateAsync,
    isSending: sendMessageMutation.isPending,
    sendError: sendMessageMutation.error,

    markAsRead: markAsReadMutation.mutate,

    // Lazy tool loading — fetch hidden steps between two message IDs
    fetchToolSteps,

    // Agent processing state (from backend polling)
    isProcessing,
    processingAgentName,

    // ADR-078: Polling health
    pollingError,
    pollingStopped,
    reconnect,

    // Refetch — reset infinite query to avoid stale cursor overlap
    refetch: () => {
      conversationQuery.refetch();
      // Reset drops all pages and re-fetches only page[0] (latest messages).
      // This avoids the stale-cursor overlap bug that refetch() would cause.
      queryClient.resetQueries({ queryKey: ['conversation-messages', conversationId] });
    }
  };
}

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
