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
import { useMessageFetchers } from './useMessageFetchers';
import type { ApiResponse, ConversationResponse, UseConversationMessagesOptions } from './conversationMessages.types';
// ADR-0057-A WP-A — slug-aware optimistic placeholders + active_agents wiring.
import { parseInvocations, slugifyAgentName } from '../utils/parseInvocations';

// Backend `active_agents[]` entry (see messageController#GET /messages, ADR-0057 WP-C).
export interface ActiveAgent {
  job_db_id: number | string;
  job_id: string;
  agent_row_id: number | null;
  agent_user_id: number | null;
  agent_name: string;
  status: 'pending' | 'processing' | string;
  started_at: string | null;
  invocation_type: 'mention' | 'command' | null;
  last_status_message_id: number | null;
}

// Extract a slug for placeholder reconciliation from any agent-bearing message.
function statusMessageSlug(msg: ChatMessage): string | null {
  const senderName = (msg as Record<string, unknown>).sender_name as string | undefined
    || (msg.metadata as Record<string, unknown> | undefined)?.agent_name as string | undefined;
  return slugifyAgentName(senderName);
}

// Match a single pending placeholder against a status-row slug. We keep
// legacy placeholders (no `metadata.agent_slug`) — those are auto-respond
// fallbacks where the slug isn't known at send time and the old "strip on
// any agent message" rule still applies.
function placeholderSlug(msg: ChatMessage): string | null {
  const slug = (msg.metadata as Record<string, unknown> | undefined)?.agent_slug as string | undefined;
  return slug || null;
}

// Re-export types and constants for backwards compatibility
export { POLL_INTERVALS, type ChatActivityState, type SendMessageParams } from './conversationMessages.types';
export { useCreateConversation, useConversations } from './useConversationList';

// Local import for mutation typing
import type { SendMessageParams } from './conversationMessages.types';
import { POLL_INTERVALS } from './conversationMessages.types';

// Cheap structural compare for an agent_status / plan message in cache vs.
// the freshly-polled version. Returns true when nothing the renderer can see
// has changed — used to skip cache writes that would otherwise produce new
// page/messages refs every poll tick and trigger a full ChatTurn re-render
// (visible as bottom-of-chat flicker during agent processing).
function isSameStatusRow(a: ChatMessage | undefined, b: ChatMessage | undefined): boolean {
  if (!a || !b) return false;
  if (String(a.id) !== String(b.id)) return false;
  if ((a.content || '') !== (b.content || '')) return false;
  return JSON.stringify(a.metadata ?? null) === JSON.stringify(b.metadata ?? null);
}

function findCachedById(data: { pages?: Array<{ messages: ChatMessage[] }> } | undefined, id: string): ChatMessage | undefined {
  if (!data?.pages) return undefined;
  for (const page of data.pages) {
    const match = page.messages.find(m => String(m.id) === id);
    if (match) return match;
  }
  return undefined;
}

/**
 * Hook for managing conversation messages with React Query
 */
export function useConversationMessages(
  conversationId: number | null,
  options: UseConversationMessagesOptions = {}
) {
  const { pageSize = 50, enabled = true, pollingInterval, adaptivePolling = false, chatActivityState = 'idle', currentUserId } = options;
  // Lazy loading: exclude heavy tool/thinking messages from initial load & pagination.
  // Include 'moved' (ADR-0031 §Z source-side stubs) and 'row_mutation' (ADR-0031 P2)
  // so they render in the chat — they are tiny rows, not heavy steps.
  const LAZY_CONTENT_TYPES = 'text,tool_approval,moved,row_mutation';
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
    staleTime: 30000,
    refetchOnMount: true,
  });

  // BUG FIX: Reset infinite query cache when conversation changes.
  const prevConversationIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (conversationId && conversationId !== prevConversationIdRef.current) {
      if (prevConversationIdRef.current !== null) {
        queryClient.resetQueries({ queryKey: ['conversation-messages', prevConversationIdRef.current] });
      }
      queryClient.setQueryData(
        ['conversation-messages', conversationId],
        (old: any) => {
          if (!old?.pages?.length || old.pages.length <= 1) return old;
          return {
            ...old,
            pages: [old.pages[0]],
            pageParams: [old.pageParams[0]],
          };
        }
      );
      prevConversationIdRef.current = conversationId;
    }
  }, [conversationId, queryClient]);

  // Infinite query for messages — single source of truth for all message data.
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
      if (lastPage.hasMore && lastPage.nextCursor != null) {
        return lastPage.nextCursor;
      }
      return undefined;
    },
    initialPageParam: null as number | null,
    enabled: !!conversationId && enabled,
    // Was Infinity — caused memory bloat on long-lived chat tabs.
    // 10 min keeps recently-active chats hot; idle chats GC after gcTime.
    staleTime: 10 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  // ADR-078: Incremental polling with backoff and adaptive intervals
  const consecutiveFailuresRef = useRef(0);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [pollingStopped, setPollingStopped] = useState(false);

  // BUG FIX #1: Local processing override for instant fast polling
  const localProcessingOverrideRef = useRef(false);

  // Compute effective polling interval
  const effectiveInterval = useMemo(() => {
    if (pollingInterval) return pollingInterval;
    if (!adaptivePolling) return 0;
    if (localProcessingOverrideRef.current && chatActivityState !== 'agent_processing') {
      return POLL_INTERVALS.AGENT_PROCESSING;
    }
    switch (chatActivityState) {
      case 'agent_processing': return POLL_INTERVALS.AGENT_PROCESSING;
      case 'active': return POLL_INTERVALS.ACTIVE_CHAT;
      case 'idle': return POLL_INTERVALS.IDLE_CHAT;
      case 'background': return POLL_INTERVALS.BACKGROUND;
      default: return POLL_INTERVALS.IDLE_CHAT;
    }
  }, [pollingInterval, adaptivePolling, chatActivityState]);

  // Get the newest message ID from cache for incremental polling
  const newestMessageIdRef = useRef<number>(0);
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

  const getNewestMessageId = useCallback((): number => newestMessageIdRef.current, []);

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
  // ADR-0057-A WP-A — surface backend's `active_agents[]` (ADR-0057 WP-C ships
  // it, the frontend never consumed it). When length > 1 MessagesArea renders
  // a multi-badge row keyed by slug.
  const [activeAgents, setActiveAgents] = useState<ActiveAgent[]>([]);
  const isProcessingRef = useRef(false);

  // Grace period: don't clean up optimistic bubbles immediately after sending
  const lastSendTimestampRef = useRef(0);

  // Refs to avoid stale closures in setTimeout chain
  const pollingStoppedRef = useRef(pollingStopped);
  useEffect(() => { pollingStoppedRef.current = pollingStopped; }, [pollingStopped]);
  const effectiveIntervalRef = useRef(effectiveInterval);
  useEffect(() => { effectiveIntervalRef.current = effectiveInterval; }, [effectiveInterval]);

  // Main polling effect — ADR-078
  useEffect(() => {
    if (!conversationId || !enabled || effectiveInterval <= 0 || pollingStopped) return;

    let currentInterval = effectiveInterval;
    let timeoutId: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const poll = async () => {
      try {
        const isInGracePeriodForPoll = (Date.now() - lastSendTimestampRef.current) < 60000;
        const isActive = isProcessingRef.current || isInGracePeriodForPoll;
        const activeContentTypes = isActive
          ? 'text,tool_approval,agent_status,plan,thinking,tool_call,tool_result,moved,row_mutation'
          : LAZY_CONTENT_TYPES;
        const lastId = getNewestMessageId();
        const url = lastId > 0
          ? `/chat/conversations/${conversationId}/messages?after=${lastId}&limit=50&content_types=${activeContentTypes}`
          : `/chat/conversations/${conversationId}/messages?limit=${pageSize}&content_types=${LAZY_CONTENT_TYPES}`;

        const response = await apiClient.get<ApiResponse<{ messages: ChatMessage[]; hasMore: boolean; nextCursor?: number; is_processing?: boolean; processing_agent_name?: string | null; processing_agent_id?: number | null; active_agents?: ActiveAgent[] }>>(url);
        const freshMessages = response?.data?.messages || [];

        // Update processing state from backend response
        const backendProcessing = !!response?.data?.is_processing;
        const currentProcessingAgentId = backendProcessing ? (response?.data?.processing_agent_id ?? null) : null;
        isProcessingRef.current = backendProcessing;
        localProcessingOverrideRef.current = backendProcessing;
        if (backendProcessing) {
          currentInterval = POLL_INTERVALS.AGENT_PROCESSING;
        }
        setIsProcessing(backendProcessing);
        setProcessingAgentName(backendProcessing ? (response?.data?.processing_agent_name ?? null) : null);
        // ADR-0057-A WP-A — drive the multi-agent badge row off `active_agents`
        // when the backend ships it; otherwise leave the array empty so the
        // existing single-bar UI stays in charge.
        setActiveAgents(response?.data?.active_agents ?? []);

        // Clean up optimistic placeholders and agent_status/plan when processing ends
        const isInGracePeriod = (Date.now() - lastSendTimestampRef.current) < 60000;
        if (!backendProcessing && !isInGracePeriod) {
          queryClient.setQueryData(
            ['conversation-messages', conversationId],
            (old: typeof messagesInfiniteQuery.data) => {
              if (!old?.pages?.length) return old;
              const hasRemovable = old.pages.some(p => p.messages.some(m =>
                String(m.id).startsWith('agent-pending-') ||
                m.contentType === 'agent_status' ||
                m.contentType === 'plan'
              ));
              if (!hasRemovable) return old;
              return {
                ...old,
                pages: old.pages.map(page => ({
                  ...page,
                  messages: page.messages.filter(m =>
                    !String(m.id).startsWith('agent-pending-') &&
                    m.contentType !== 'agent_status' &&
                    m.contentType !== 'plan'
                  )
                }))
              };
            }
          );
        }

        // Success — reset failure counter
        if (consecutiveFailuresRef.current > 0) {
          logger.info('[Chat Poll] Connection restored after', consecutiveFailuresRef.current, 'failures');
        }
        consecutiveFailuresRef.current = 0;
        currentInterval = effectiveIntervalRef.current;
        setPollingError(null);

        // Fetch agent_status/plan during processing or grace period
        if (backendProcessing || isInGracePeriod) {
          const isCurrentAgent = (msg: ChatMessage): boolean => {
            if (!currentProcessingAgentId) return true;
            const msgAgentId = (msg as Record<string, unknown>).agent_id as number | undefined;
            if (!msgAgentId) return true;
            return msgAgentId === currentProcessingAgentId;
          };
          const isFresh = (msg: ChatMessage): boolean => {
            if (backendProcessing && isCurrentAgent(msg)) return true;
            const startedAt = (msg.metadata as Record<string, unknown>)?.started_at as string | undefined;
            if (startedAt) {
              return (Date.now() - new Date(startedAt).getTime()) < 86400000;
            }
            const ts = (msg as Record<string, unknown>).timestamp || (msg as Record<string, unknown>).created_at;
            if (ts) {
              return (Date.now() - new Date(ts as string).getTime()) < 86400000;
            }
            return false;
          };

          // Refresh agent_status messages
          try {
            const statusUrl = `/chat/conversations/${conversationId}/messages?content_types=agent_status&limit=5`;
            const statusResp = await apiClient.get<ApiResponse<{ messages: ChatMessage[] }>>(statusUrl);
            const statusMsgs = statusResp?.data?.messages || [];
            // ADR-0057-A WP-A — keep ALL fresh status rows, group by per-agent
            // slug (latest message-id wins). We no longer filter by
            // `currentProcessingAgentId` because two agents can be invoked in
            // one user message and each ships its own status row.
            const fresh = statusMsgs.filter(isFresh);
            const latestPerSlug = new Map<string, ChatMessage>();
            for (const msg of fresh) {
              const slug = statusMessageSlug(msg);
              if (!slug) continue;
              const prev = latestPerSlug.get(slug);
              const currId = Number(msg.id) || 0;
              const prevId = prev ? Number(prev.id) || 0 : -1;
              if (!prev || currId > prevId) latestPerSlug.set(slug, msg);
            }
            // Fallback: if no slug could be derived but we have a candidate
            // (legacy auto-respond case), preserve the old "latest wins"
            // single-status behavior so the generic placeholder still gets
            // replaced.
            const legacyCandidate = latestPerSlug.size === 0 && fresh.length > 0 && isCurrentAgent(fresh[fresh.length - 1])
              ? fresh[fresh.length - 1] : null;

            if (latestPerSlug.size > 0 || legacyCandidate) {
              const cached = queryClient.getQueryData<typeof messagesInfiniteQuery.data>(
                ['conversation-messages', conversationId]
              );
              // Decide whether the cache write is observably different — if
              // every status row is already byte-identical AND there's no
              // pending placeholder to strip for any of these slugs, skip
              // setQueryData to avoid the 1Hz flicker.
              let anyChange = false;
              for (const [slug, msg] of latestPerSlug.entries()) {
                const cachedMatch = findCachedById(cached, String(msg.id));
                if (!cachedMatch || !isSameStatusRow(cachedMatch, msg)) { anyChange = true; break; }
                const hasPendingForSlug = cached?.pages?.some(p =>
                  p.messages.some(m => String(m.id).startsWith('agent-pending-') && placeholderSlug(m) === slug)
                );
                if (hasPendingForSlug) { anyChange = true; break; }
              }
              if (legacyCandidate) {
                const cachedMatch = findCachedById(cached, String(legacyCandidate.id));
                const hasGenericPending = cached?.pages?.some(p =>
                  p.messages.some(m => String(m.id).startsWith('agent-pending-') && placeholderSlug(m) === null)
                );
                if (!cachedMatch || !isSameStatusRow(cachedMatch, legacyCandidate) || hasGenericPending) anyChange = true;
              }

              if (anyChange) {
                queryClient.setQueryData(
                  ['conversation-messages', conversationId],
                  (old: typeof messagesInfiniteQuery.data) => {
                    if (!old?.pages?.length) return old;
                    const updates = new Map<string, ChatMessage>();
                    for (const msg of latestPerSlug.values()) updates.set(String(msg.id), msg);
                    if (legacyCandidate) updates.set(String(legacyCandidate.id), legacyCandidate);

                    const resolvedSlugs = new Set<string>(latestPerSlug.keys());
                    const stripGeneric = !!legacyCandidate;
                    const seen = new Set<string>();
                    const updatedPages = old.pages.map((page) => {
                      const filtered = page.messages.filter(m => {
                        const id = String(m.id);
                        if (!id.startsWith('agent-pending-')) return true;
                        const slug = placeholderSlug(m);
                        if (slug && resolvedSlugs.has(slug)) return false;
                        if (!slug && stripGeneric) return false;
                        return true;
                      });
                      const updatedMessages = filtered.map((m) => {
                        const update = updates.get(String(m.id));
                        if (update) { seen.add(String(m.id)); return { ...m, ...update }; }
                        return m;
                      });
                      return { ...page, messages: updatedMessages };
                    });
                    const appended: ChatMessage[] = [];
                    for (const [id, msg] of updates.entries()) {
                      if (!seen.has(id)) appended.push(msg);
                    }
                    if (appended.length > 0) {
                      updatedPages[0] = { ...updatedPages[0], messages: [...updatedPages[0].messages, ...appended] };
                    }
                    return { ...old, pages: updatedPages };
                  }
                );
              }
            }
          } catch { /* Non-critical */ }

          // Refresh plan messages
          try {
            const planUrl = `/chat/conversations/${conversationId}/messages?content_types=plan&limit=1`;
            const planResp = await apiClient.get<ApiResponse<{ messages: ChatMessage[] }>>(planUrl);
            const planMsgs = planResp?.data?.messages || [];
            if (planMsgs.length > 0) {
              const latestPlan = planMsgs[planMsgs.length - 1];
              if (isFresh(latestPlan) && isCurrentAgent(latestPlan)) {
                const cached = queryClient.getQueryData<typeof messagesInfiniteQuery.data>(
                  ['conversation-messages', conversationId]
                );
                const cachedMatch = findCachedById(cached, String(latestPlan.id));
                if (!cachedMatch || !isSameStatusRow(cachedMatch, latestPlan)) {
                  queryClient.setQueryData(
                    ['conversation-messages', conversationId],
                    (old: typeof messagesInfiniteQuery.data) => {
                      if (!old?.pages?.length) return old;
                      const planId = String(latestPlan.id);
                      let found = false;
                      const updatedPages = old.pages.map((page) => ({
                        ...page,
                        messages: page.messages.map((m) => {
                          if (String(m.id) === planId) { found = true; return { ...m, ...latestPlan }; }
                          return m;
                        })
                      }));
                      if (!found) {
                        updatedPages[0] = { ...updatedPages[0], messages: [...updatedPages[0].messages, latestPlan] };
                      }
                      return { ...old, pages: updatedPages };
                    }
                  );
                }
              }
            }
          } catch { /* Non-critical */ }
        }

        if (freshMessages.length === 0) return;
        logger.debug('[Chat Poll] Received', freshMessages.length, 'new messages via incremental poll');

        // Merge new messages into the first page of infinite query cache
        queryClient.setQueryData(
          ['conversation-messages', conversationId],
          (old: typeof messagesInfiniteQuery.data) => {
            if (!old || !old.pages || old.pages.length === 0) {
              return { pages: [{ messages: freshMessages, hasMore: false }], pageParams: [null] };
            }
            const existingIds = new Set<string>();
            for (const page of old.pages) {
              for (const m of (page.messages ?? [])) { existingIds.add(String(m.id)); }
            }
            const newOnes = freshMessages.filter(m => !existingIds.has(String(m.id)));
            const agentStatusUpdates = freshMessages.filter(
              m => existingIds.has(String(m.id)) && (m.contentType === 'agent_status' || m.contentType === 'plan')
            );
            if (newOnes.length === 0 && agentStatusUpdates.length === 0) return old;

            let updatedPages = [...old.pages];
            if (agentStatusUpdates.length > 0) {
              const updateMap = new Map(agentStatusUpdates.map(m => [String(m.id), m]));
              updatedPages = updatedPages.map(page => ({
                ...page,
                messages: page.messages.map(m => {
                  const update = updateMap.get(String(m.id));
                  return update ? { ...m, ...update } : m;
                })
              }));
            }
            if (newOnes.length > 0) {
              const mergedMessages = [...updatedPages[0].messages, ...newOnes];
              let minId = updatedPages[0].nextCursor;
              for (const m of mergedMessages) {
                const numId = typeof m.id === 'number' ? m.id : parseInt(String(m.id)) || 0;
                if (numId > 0 && (minId == null || numId < minId)) { minId = numId; }
              }
              updatedPages[0] = {
                ...updatedPages[0],
                messages: mergedMessages,
                ...(minId != null && { nextCursor: minId }),
              };
            }
            return { ...old, pages: updatedPages };
          }
        );
      } catch (err) {
        consecutiveFailuresRef.current++;
        const failures = consecutiveFailuresRef.current;
        const errMsg = err instanceof Error ? err.message : String(err);
        const is502 = /502|503|504/.test(errMsg);

        if (is502 && failures <= 3) {
          logger.debug(`[Chat Poll] Gateway error (${failures}), will retry...`);
        } else {
          logger.warn(`[Chat Poll] Failed (attempt ${failures}):`, err);
        }

        if (failures >= 10) {
          setPollingStopped(true);
          setPollingError('Connection lost. Click to reconnect.');
          logger.error('[Chat Poll] Stopped after 10 consecutive failures');
          return;
        }
        if (failures >= 3) {
          setPollingError(is502
            ? 'Server temporarily unavailable. Reconnecting...'
            : 'Connection lost. Messages may be delayed.'
          );
          currentInterval = Math.min(currentInterval * 2, 30000);
        }
      }
    };

    const scheduleNext = () => {
      if (cancelled || pollingStoppedRef.current) return;
      timeoutId = setTimeout(async () => {
        if (cancelled || pollingStoppedRef.current) return;
        await poll();
        scheduleNext();
      }, currentInterval);
    };

    scheduleNext();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [conversationId, enabled, effectiveInterval, pageSize, queryClient, pollingStopped, getNewestMessageId]);

  // Send message mutation with optimistic updates
  const sendMessageMutation = useMutation({
    mutationFn: async (params: SendMessageParams) => {
      const targetConvId = params.overrideConversationId || conversationId;
      if (!targetConvId) throw new Error('No conversation selected');

      const response = await apiClient.post<ApiResponse<ChatMessage>>(
        `/chat/conversations/${targetConvId}/messages`,
        {
          content: params.content,
          content_type: params.contentType || 'text',
          mentions: params.mentions,
          parent_id: params.parentId,
          ...(params.agentMode && { agent_mode: params.agentMode }),
          ...(params.attachments && params.attachments.length > 0 && { attachments: params.attachments }),
          ...(params.replyTo && { reply_to: params.replyTo }),
        }
      );
      return response?.data;
    },

    onMutate: async (newMessage) => {
      const cacheConvId = newMessage.overrideConversationId || conversationId;
      await queryClient.cancelQueries({ queryKey: ['conversation-messages', cacheConvId] });

      const isAgent = !!newMessage.agentMode && newMessage.agentMode !== 'ask';
      if (isAgent) {
        isProcessingRef.current = true;
        localProcessingOverrideRef.current = true;
        setIsProcessing(true);
        lastSendTimestampRef.current = Date.now();
      }

      const previousData = queryClient.getQueryData(['conversation-messages', cacheConvId]);
      const optimisticMessage: ChatMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: newMessage.content,
        timestamp: new Date(),
        isStreaming: true,
        ...(currentUserId != null && { sender_id: currentUserId })
      };

      queryClient.setQueryData(
        ['conversation-messages', cacheConvId],
        (old: typeof messagesInfiniteQuery.data) => {
          if (!old || !old.pages || old.pages.length === 0) {
            return { pages: [{ messages: [optimisticMessage], hasMore: false }], pageParams: [null] };
          }
          const updatedPages = [...old.pages];
          updatedPages[0] = { ...updatedPages[0], messages: [...updatedPages[0].messages, optimisticMessage] };
          return { ...old, pages: updatedPages };
        }
      );
      return { previousData, cacheConvId };
    },

    onError: (_err, newMessage, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(['conversation-messages', context.cacheConvId || conversationId], context.previousData);
      }
      const isAgent = !!newMessage.agentMode && newMessage.agentMode !== 'ask';
      if (isAgent) {
        isProcessingRef.current = false;
        localProcessingOverrideRef.current = false;
        setIsProcessing(false);
      }
    },

    onSuccess: (serverMessage, variables, context) => {
      if (!serverMessage) return;
      const successConvId = context?.cacheConvId || conversationId;
      const isAgent = !!variables.agentMode && variables.agentMode !== 'ask';

      queryClient.setQueryData(
        ['conversation-messages', successConvId],
        (old: typeof messagesInfiniteQuery.data) => {
          if (!old?.pages?.length) return old;
          const updatedPages = old.pages.map((page, i) => {
            if (i !== 0) return page;
            const hasServer = page.messages.some(m => String(m.id) === String(serverMessage.id));
            let messages = page.messages.map(m =>
              String(m.id).startsWith('temp-') ? { ...serverMessage } : m
            );
            if (!page.messages.some(m => String(m.id).startsWith('temp-')) && !hasServer) {
              messages = [...messages, serverMessage];
            }
            if (isAgent) {
              // ADR-0057-A WP-A — one optimistic placeholder per invoked slug.
              // The pre-existing single-placeholder path silently dropped every
              // slug past the first when a user wrote `<<@a>> <<@b>>`. We now
              // parse the content, dedupe by slug, and emit one
              // `agent-pending-${slug}-${ts}` per agent so each can reconcile
              // independently against its own status row.
              const existingPendingSlugs = new Set<string>();
              let hasGenericPending = false;
              for (const m of messages) {
                if (!String(m.id).startsWith('agent-pending-')) continue;
                const slug = placeholderSlug(m);
                if (slug) existingPendingSlugs.add(slug);
                else hasGenericPending = true;
              }
              const invoked = parseInvocations(variables.content);
              const ts = Date.now();
              const startedAtIso = new Date(ts).toISOString();
              const buildPlaceholder = (slug: string | null): ChatMessage => ({
                id: slug ? `agent-pending-${slug}-${ts}` : `agent-pending-${ts}`,
                role: 'assistant',
                content: '',
                contentType: 'agent_status',
                senderType: 'agent',
                timestamp: new Date(ts),
                metadata: {
                  agent_status: 'starting',
                  agent_action: 'Запускается...',
                  placeholder: true,
                  tools_used: 0,
                  tools_completed: 0,
                  started_at: startedAtIso,
                  ...(slug ? { agent_slug: slug } : {}),
                },
              } as ChatMessage);

              const newPlaceholders: ChatMessage[] = [];
              if (invoked.length > 0) {
                for (const { slug } of invoked) {
                  if (existingPendingSlugs.has(slug)) continue;
                  newPlaceholders.push(buildPlaceholder(slug));
                }
              } else if (!hasGenericPending && existingPendingSlugs.size === 0) {
                // Legacy fallback — agent_mode invocation without `<<@slug>>`
                // (auto-respond / default agent). One generic placeholder is
                // enough; backend will reconcile via the latest status row.
                newPlaceholders.push(buildPlaceholder(null));
              }
              if (newPlaceholders.length > 0) {
                messages = [...messages, ...newPlaceholders];
              }
            }
            return { ...page, messages };
          });
          return { ...old, pages: updatedPages };
        }
      );
    }
  });

  // Progressive lazy loading fetchers
  const { fetchThinkingSteps, fetchToolStepsPreview, fetchFullMessage, fetchToolSteps } = useMessageFetchers(conversationId);

  // Mark as read mutation
  const markAsReadMutation = useMutation({
    mutationFn: async () => {
      if (!conversationId) return;
      await apiClient.post(`/chat/conversations/${conversationId}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['inbox-conversations'] });
    }
  });

  // Get all messages flattened from infinite query pages (deduped)
  const allMessages = useMemo(() => {
    const pages = messagesInfiniteQuery.data?.pages;
    if (!pages || pages.length === 0) return [];
    const reversed = [...pages].reverse();
    const flat = reversed.flatMap(page => page.messages ?? []);
    const seen = new Set<string>();
    return flat.filter(m => {
      const key = String(m.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [messagesInfiniteQuery.data]);

  return {
    conversation: conversationQuery.data,
    isLoading: messagesInfiniteQuery.isLoading,
    isError: messagesInfiniteQuery.isError,
    error: messagesInfiniteQuery.error,
    messages: allMessages,
    allMessages,
    hasNextPage: messagesInfiniteQuery.hasNextPage,
    fetchNextPage: messagesInfiniteQuery.fetchNextPage,
    isFetchingNextPage: messagesInfiniteQuery.isFetchingNextPage,
    sendMessage: sendMessageMutation.mutateAsync,
    isSending: sendMessageMutation.isPending,
    sendError: sendMessageMutation.error,
    markAsRead: markAsReadMutation.mutate,
    fetchThinkingSteps,
    fetchToolStepsPreview,
    fetchFullMessage,
    fetchToolSteps,
    isProcessing,
    processingAgentName,
    // ADR-0057-A WP-A — multi-agent presence array (per-slug badges in UI).
    activeAgents,
    pollingError,
    pollingStopped,
    reconnect,
    refetch: () => {
      conversationQuery.refetch();
      queryClient.resetQueries({ queryKey: ['conversation-messages', conversationId] });
    }
  };
}
