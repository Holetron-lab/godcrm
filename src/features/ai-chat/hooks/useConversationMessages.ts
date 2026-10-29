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

import { statusMessageSlug, placeholderSlug, isSameStatusRow, isTerminalStatusRow, findCachedById, withoutStepAnnotations } from './conversationMessages.cache';

// Backend `active_agents[]` entry (see messageController#GET /messages, ADR-0057 WP-C).
export interface ActiveAgent {
  job_db_id: number | string | null;
  job_id: string | null;
  agent_row_id: number | null;
  agent_user_id: number | null;
  agent_name: string;
  status: 'pending' | 'processing' | string;
  started_at: string | null;
  invocation_type: 'mention' | 'command' | null;
  last_status_message_id: number | null;
}

// Re-export types and constants for backwards compatibility
export { POLL_INTERVALS, type ChatActivityState, type SendMessageParams } from './conversationMessages.types';
export { useCreateConversation, useConversations } from './useConversationList';

// Local import for mutation typing
import type { SendMessageParams } from './conversationMessages.types';
import { POLL_INTERVALS } from './conversationMessages.types';

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
    if (enabled && conversationId && maxId > newestMessageIdRef.current) {
      // Invocations and handoffs add participants server-side. Refresh metadata
      // for a new persisted message, not every streaming update to the same row.
      void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId], exact: true });
    }
    newestMessageIdRef.current = maxId;
  }, [messagesInfiniteQuery.data, conversationId, enabled, queryClient]);

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
        if (cancelled) return;
        let freshMessages = response?.data?.messages || [];

        // Update processing state from backend response
        // Long-running jobs can outlive the legacy conversation flag. Keep
        // fetching their steps (including paused runs) until presence clears.
        const backendProcessing = !!response?.data?.is_processing
          || (response?.data?.active_agents?.length ?? 0) > 0;
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

        const isCurrentAgent = (msg: ChatMessage): boolean => {
          if (!currentProcessingAgentId) return true;
          const msgAgentId = 'agent_id' in msg ? msg.agent_id : undefined;
          if (!msgAgentId) return true;
          return msgAgentId === currentProcessingAgentId;
        };
        const isFresh = (msg: ChatMessage): boolean => {
          if (msg.metadata?.agent_status === 'finished' || msg.metadata?.agent_status === 'error') return false;
          const jobs = response?.data?.active_agents;
          if (jobs) {
            return jobs.some(job => {
              if (msg.metadata?.job_id) return msg.metadata.job_id === job.job_id;
              if (msg.metadata?.job_db_id) return String(msg.metadata.job_db_id) === String(job.job_db_id);
              if (job.last_status_message_id != null && String(job.last_status_message_id) === String(msg.id)) return true;
              const rowId = msg.metadata?.agent_row_id || msg.agentId || (msg as ChatMessage & { agent_id?: number }).agent_id;
              const sameAgent = rowId != null
                ? Number(rowId) === job.agent_row_id
                : statusMessageSlug(msg) === slugifyAgentName(job.agent_name);
              const timestamp = msg.metadata?.started_at || msg.timestamp || (msg as ChatMessage & { created_at?: string }).created_at;
              return sameAgent && !!job.started_at && !!timestamp
                && new Date(timestamp as string).getTime() >= new Date(job.started_at).getTime();
            });
          }
          // Legacy servers have no job list: require a known agent and a recent row.
          const timestamp = msg.metadata?.started_at || msg.timestamp || (msg as ChatMessage & { created_at?: string }).created_at;
          return isCurrentAgent(msg) && !!timestamp
            && Date.now() - new Date(timestamp as string).getTime() < 60000;
        };
        if (backendProcessing || isInGracePeriod) {
          const isServiceRow = (msg: ChatMessage) => msg.contentType === 'agent_status' || msg.contentType === 'plan';
          freshMessages = freshMessages.filter(msg => !isServiceRow(msg) || isFresh(msg))
            .map(msg => isServiceRow(msg) ? withoutStepAnnotations(msg) : msg);
          // Evict previous jobs even while another agent continues processing.
          queryClient.setQueryData(['conversation-messages', conversationId], (old: typeof messagesInfiniteQuery.data) => {
            if (!old?.pages.some(page => page.messages.some(msg => isServiceRow(msg) && !isFresh(msg)))) return old;
            return { ...old, pages: old.pages.map(page => ({
              ...page, messages: page.messages.filter(msg => !isServiceRow(msg) || isFresh(msg)),
            })) };
          });
        }

        // Commit the main batch before auxiliary requests can advance the cache
        // cursor or a processing-state render can restart this polling effect.
        if (freshMessages.length > 0) {
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
        }

        // Fetch agent_status/plan during processing or grace period
        if (backendProcessing || isInGracePeriod) {
          // Refresh agent_status messages
          try {
            const statusUrl = `/chat/conversations/${conversationId}/messages?content_types=agent_status&limit=5`;
            const statusResp = await apiClient.get<ApiResponse<{ messages: ChatMessage[] }>>(statusUrl);
            if (cancelled) return;
            const statusMsgs = statusResp?.data?.messages || [];
            // ADR-0057-A WP-A — keep ALL fresh status rows, group by per-agent
            // slug (latest message-id wins). We no longer filter by
            // `currentProcessingAgentId` because two agents can be invoked in
            // one user message and each ships its own status row.
            const fresh = statusMsgs.filter(isFresh).map(withoutStepAnnotations);
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
                // A terminal row missing from the cache is never appended, but it
                // still resolves a pending placeholder for its slug (checked below).
                const wouldAppend = !cachedMatch && !isTerminalStatusRow(msg);
                if (wouldAppend || (cachedMatch && !isSameStatusRow(cachedMatch, msg))) { anyChange = true; break; }
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
                const wouldAppend = !cachedMatch && !isTerminalStatusRow(legacyCandidate);
                if (wouldAppend || (cachedMatch && !isSameStatusRow(cachedMatch, legacyCandidate)) || hasGenericPending) anyChange = true;
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
                        if (update) { seen.add(String(m.id)); return update; }
                        return m;
                      });
                      return { ...page, messages: updatedMessages };
                    });
                    const appended: ChatMessage[] = [];
                    for (const [id, msg] of updates.entries()) {
                      if (!seen.has(id) && !isTerminalStatusRow(msg)) appended.push(msg);
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
            const plans = new Map<string, ChatMessage>();
            let before: number | undefined;
            do {
              const planUrl = `/chat/conversations/${conversationId}/messages?content_types=plan&limit=50${before == null ? '' : `&before=${before}`}`;
              const planResp = await apiClient.get<ApiResponse<{ messages: ChatMessage[]; hasMore?: boolean; nextCursor?: number }>>(planUrl);
              if (cancelled) return;
              for (const msg of planResp?.data?.messages || []) {
                if (isFresh(msg)) plans.set(String(msg.id), withoutStepAnnotations(msg));
              }
              const nextCursor = planResp?.data?.nextCursor;
              if (!planResp?.data?.hasMore || nextCursor == null || (before != null && nextCursor >= before)) break;
              before = nextCursor;
            } while (!cancelled);
            if (cancelled) return;
            queryClient.setQueryData(
              ['conversation-messages', conversationId],
              (old: typeof messagesInfiniteQuery.data) => {
                if (!old?.pages?.length) return old;
                const updates = new Map([...plans].filter(([id, plan]) => !isSameStatusRow(findCachedById(old, id), plan)));
                if (updates.size === 0) return old;
                const updatedPages = old.pages.map(page => ({
                  ...page,
                  messages: page.messages.map(msg => {
                    const plan = updates.get(String(msg.id));
                    if (!plan) return msg;
                    updates.delete(String(msg.id));
                    return plan;
                  }),
                }));
                if (updates.size > 0) {
                  updatedPages[0] = { ...updatedPages[0], messages: [...updatedPages[0].messages, ...updates.values()] };
                }
                return { ...old, pages: updatedPages };
              }
            );
          } catch { /* Non-critical */ }
        }
      } catch (err) {
        if (cancelled) return;
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
    }).sort((a, b) => {
      // Status/plan polling can append an older row before the main poll
      // inserts its triggering message. Match the API's persisted ID order;
      // optimistic messages have local IDs and retain their timestamp order.
      const idOrder = Number(a.id) - Number(b.id);
      return Number.isFinite(idOrder)
        ? idOrder
        : new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
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
