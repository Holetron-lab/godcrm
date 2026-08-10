/**
 * useConversationSSE Hook
 * ADR-077 Task #8: SSE consumer for live message updates in chat UI
 *
 * Connects to GET /chat/conversations/:id/stream (Server-Sent Events)
 * to receive real-time message updates instead of polling.
 *
 * Events handled:
 * - `connected`  — initial connection confirmation
 * - `message`    — new chat message from any participant
 * - `message_updated` — existing message metadata changed (agent_status)
 * - `status`     — processing state changes (agent typing, etc.)
 *
 * Features:
 * - Auto-reconnect with exponential backoff on disconnect
 * - Deduplication via lastMessageId tracking
 * - Auth via cookies (browser sends automatically) + query param fallback
 * - Heartbeat detection (server sends heartbeat every 15s)
 * - Cleanup on unmount / conversation change
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAccessToken, getBaseUrlSync } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import type { ChatMessage } from '../types';
import { slugifyAgentName } from '../utils/parseInvocations';

/** SSE connection states */
export type SSEConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/** Status event payload from backend */
export interface SSEStatusEvent {
  is_processing: boolean;
  processing_agent_name: string | null;
  processing_agent_id: number | null;
  processing_started_at: string | null;
}

/**
 * ADR-0057-A WP-C — inflight delta payload from `pg_notify('chat_inflight', …)`.
 * Mirrors the contract documented in `backend/services/inflight/markPaused.js`:
 * the writer emits this same shape from inside the SQL CTE that mutates
 * `_inflight_runs`, and `streamController.js` fans it out to subscribers
 * filtered by `conversation_id`.
 */
export interface SSEInflightEvent {
  inflight_id: number;
  conversation_id: number;
  agent_slug: string;
  status: 'running' | 'paused' | 'done' | 'failed' | string;
  reason?: string | null;
  resume_at?: string | null;
  started_at?: string | null;
  paused_at?: string | null;
  ticket_id?: number | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Options for the SSE hook */
export interface UseConversationSSEOptions {
  /** Whether SSE should be active (default: true) */
  enabled?: boolean;
  /** Called when processing status changes */
  onStatusChange?: (status: SSEStatusEvent) => void;
  /** ADR-0057-A WP-C — fired on each `event: inflight` delta. Caller is
   *  responsible for merging by `agent_slug`. Stays unset unless the
   *  consumer opts in (no global subscriber). */
  onInflight?: (payload: SSEInflightEvent) => void;
  /** Max reconnect attempts before giving up (default: 10) */
  maxReconnectAttempts?: number;
  /** Base delay for reconnect in ms (default: 1000) */
  baseReconnectDelay?: number;
}

/** Return type for the SSE hook */
export interface UseConversationSSEReturn {
  /** Current SSE connection state */
  connectionState: SSEConnectionState;
  /** Whether the SSE connection is actively receiving data */
  isConnected: boolean;
  /** Last error message, if any */
  error: string | null;
  /** Number of reconnect attempts so far */
  reconnectAttempts: number;
  /** Manually reconnect */
  reconnect: () => void;
  /** Manually disconnect */
  disconnect: () => void;
  /** Processing status from SSE stream */
  isProcessing: boolean;
  /** Agent name currently processing */
  processingAgentName: string | null;
  /** When processing started (ISO timestamp) */
  processingStartedAt: string | null;
}

/**
 * Get the SSE stream URL for a conversation.
 * Auth is via cookies (sent automatically by EventSource in same-origin requests).
 * For cross-origin (desktop app), pass token as query param fallback.
 */
function getStreamUrl(conversationId: number, lastMessageId: number): string {
  const basePath = getBaseUrlSync();
  const params = new URLSearchParams();
  if (lastMessageId > 0) {
    params.set('after', String(lastMessageId));
  }
  // For desktop app or cross-origin, pass token as query param
  const token = getAccessToken();
  if (token) {
    params.set('token', token);
  }
  const queryString = params.toString();
  return `${basePath}/chat/conversations/${conversationId}/stream${queryString ? `?${queryString}` : ''}`;
}

/**
 * Hook to consume SSE stream for a conversation and merge messages
 * into the TanStack Query cache (same cache as useConversationMessages).
 */
export function useConversationSSE(
  conversationId: number | null,
  options: UseConversationSSEOptions = {}
): UseConversationSSEReturn {
  const {
    enabled = true,
    onStatusChange,
    onInflight,
    maxReconnectAttempts = 10,
    baseReconnectDelay = 1000,
  } = options;

  const queryClient = useQueryClient();
  const [connectionState, setConnectionState] = useState<SSEConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingAgentName, setProcessingAgentName] = useState<string | null>(null);
  const [processingStartedAt, setProcessingStartedAt] = useState<string | null>(null);

  // Refs for cleanup and reconnection
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMessageIdRef = useRef<number>(0);
  const reconnectAttemptsRef = useRef(0);
  const onStatusChangeRef = useRef(onStatusChange);
  const onInflightRef = useRef(onInflight);
  const conversationIdRef = useRef(conversationId);

  // Keep refs in sync
  useEffect(() => { onStatusChangeRef.current = onStatusChange; }, [onStatusChange]);
  useEffect(() => { onInflightRef.current = onInflight; }, [onInflight]);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);

  // Sync lastMessageId from query cache
  useEffect(() => {
    if (!conversationId) return;
    const data = queryClient.getQueryData<{
      pages: Array<{ messages: ChatMessage[]; hasMore: boolean }>;
      pageParams: (number | null)[];
    }>(['conversation-messages', conversationId]);

    if (!data?.pages) return;
    let maxId = 0;
    for (const page of data.pages) {
      for (const m of page.messages) {
        const numId = typeof m.id === 'number' ? m.id : parseInt(String(m.id)) || 0;
        if (numId > maxId) maxId = numId;
      }
    }
    lastMessageIdRef.current = maxId;
  }, [conversationId, queryClient]);

  /** Close existing SSE connection */
  const closeConnection = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  /** Merge new messages into TanStack Query cache */
  const mergeMessages = useCallback((newMessages: ChatMessage[]) => {
    const convId = conversationIdRef.current;
    if (!convId || newMessages.length === 0) return;

    queryClient.setQueryData(
      ['conversation-messages', convId],
      (old: {
        pages: Array<{ messages: ChatMessage[]; hasMore: boolean }>;
        pageParams: (number | null)[];
      } | undefined) => {
        if (!old || !old.pages || old.pages.length === 0) {
          return {
            pages: [{ messages: newMessages, hasMore: false }],
            pageParams: [null],
          };
        }

        const existingIds = new Set<string>();
        for (const page of old.pages) {
          for (const m of page.messages) {
            existingIds.add(String(m.id));
          }
        }

        // Filter truly new messages and remove optimistic placeholders they replace
        const genuinelyNew = newMessages.filter(m => !existingIds.has(String(m.id)));
        if (genuinelyNew.length === 0) return old;

        // ADR-0057-A WP-A — slug-aware placeholder strip. Multiple agents can
        // be invoked in one user message; only retire each agent's placeholder
        // when ITS status row arrives, not when ANY agent posts. Legacy
        // generic placeholders (no `metadata.agent_slug`) still strip on any
        // agent message to preserve the auto-respond fallback path.
        const incomingSlugs = new Set<string>();
        let anyAgentMsg = false;
        for (const msg of genuinelyNew) {
          if (msg.contentType !== 'agent_status' && msg.senderType !== 'agent' && msg.role !== 'assistant') continue;
          anyAgentMsg = true;
          const senderName = (msg as Record<string, unknown>).sender_name as string | undefined
            || (msg.metadata as Record<string, unknown> | undefined)?.agent_name as string | undefined;
          const slug = slugifyAgentName(senderName);
          if (slug) incomingSlugs.add(slug);
        }

        let updatedPages = [...old.pages];
        if (anyAgentMsg) {
          updatedPages = updatedPages.map(page => ({
            ...page,
            messages: page.messages.filter(m => {
              const id = String(m.id);
              if (!id.startsWith('agent-pending-')) return true;
              const phSlug = (m.metadata as Record<string, unknown> | undefined)?.agent_slug as string | undefined;
              if (phSlug) return !incomingSlugs.has(phSlug);
              // Legacy placeholder: strip when ANY agent message arrives.
              return false;
            }),
          }));
        }

        updatedPages[0] = {
          ...updatedPages[0],
          messages: [...updatedPages[0].messages, ...genuinelyNew],
        };
        return { ...old, pages: updatedPages };
      }
    );
  }, [queryClient]);

  /** Update an existing message in the TanStack Query cache (for metadata changes) */
  const updateExistingMessage = useCallback((updatedMsg: ChatMessage) => {
    const convId = conversationIdRef.current;
    if (!convId) return;

    queryClient.setQueryData(
      ['conversation-messages', convId],
      (old: {
        pages: Array<{ messages: ChatMessage[]; hasMore: boolean }>;
        pageParams: (number | null)[];
      } | undefined) => {
        if (!old || !old.pages) return old;

        const targetId = String(updatedMsg.id);
        let found = false;

        const updatedPages = old.pages.map(page => ({
          ...page,
          messages: page.messages.map(m => {
            if (String(m.id) === targetId) {
              found = true;
              return { ...m, ...updatedMsg };
            }
            return m;
          }),
        }));

        if (!found) {
          // Message not in cache yet — add it to first page
          updatedPages[0] = {
            ...updatedPages[0],
            messages: [...updatedPages[0].messages, updatedMsg],
          };
        }
        return { ...old, pages: updatedPages };
      }
    );
  }, [queryClient]);

  /** Connect to the SSE stream */
  const connect = useCallback(() => {
    const convId = conversationIdRef.current;
    if (!convId || !enabled) return;

    closeConnection();
    setConnectionState('connecting');
    setError(null);

    const url = getStreamUrl(convId, lastMessageIdRef.current);

    let es: EventSource;
    try {
      es = new EventSource(url, { withCredentials: true });
    } catch (err) {
      logger.error('[SSE] Failed to create EventSource:', err);
      setConnectionState('error');
      setError('Failed to create SSE connection');
      return;
    }

    eventSourceRef.current = es;

    es.addEventListener('connected', (e: MessageEvent) => {
      logger.info('[SSE] Connected to conversation', convId, e.data);
      setConnectionState('connected');
      setError(null);
      reconnectAttemptsRef.current = 0;
      setReconnectAttempts(0);
    });

    es.addEventListener('message', (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data) as ChatMessage;
        const msgId = typeof msg.id === 'number' ? msg.id : parseInt(String(msg.id)) || 0;

        if (msgId > lastMessageIdRef.current) {
          lastMessageIdRef.current = msgId;
        }

        mergeMessages([msg]);
        logger.debug('[SSE] New message received:', msgId);
      } catch (err) {
        logger.warn('[SSE] Failed to parse message event:', err);
      }
    });

    es.addEventListener('message_updated', (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data) as ChatMessage;
        updateExistingMessage(msg);
        logger.debug('[SSE] Message updated:', msg.id);
      } catch (err) {
        logger.warn('[SSE] Failed to parse message_updated event:', err);
      }
    });

    es.addEventListener('status', (e: MessageEvent) => {
      try {
        const status = JSON.parse(e.data) as SSEStatusEvent;
        setIsProcessing(status.is_processing);
        setProcessingAgentName(status.is_processing ? status.processing_agent_name : null);
        setProcessingStartedAt(status.is_processing ? status.processing_started_at : null);
        onStatusChangeRef.current?.(status);
      } catch (err) {
        logger.warn('[SSE] Failed to parse status event:', err);
      }
    });

    // ADR-0057-A WP-C — `event: inflight` carries `_inflight_runs` deltas
    // (running/paused/done/failed). Backend writers (markPaused today, ADR-0042
    // FSM tomorrow) `pg_notify('chat_inflight', …)` inside the same SQL
    // statement as the row mutation; streamController.js filters by
    // conversation_id before fan-out. Caller opts in via `options.onInflight`.
    es.addEventListener('inflight', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as SSEInflightEvent;
        onInflightRef.current?.(payload);
      } catch (err) {
        logger.warn('[SSE] Failed to parse inflight event:', err);
      }
    });

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        logger.warn('[SSE] Connection closed, scheduling reconnect...');
        setConnectionState('reconnecting');
        closeConnection();

        const attempts = reconnectAttemptsRef.current + 1;
        reconnectAttemptsRef.current = attempts;
        setReconnectAttempts(attempts);

        if (attempts > maxReconnectAttempts) {
          logger.error(`[SSE] Max reconnect attempts (${maxReconnectAttempts}) exceeded. Stopping.`);
          setConnectionState('error');
          setError('Connection lost. Click to reconnect.');
          return;
        }

        const delay = Math.min(baseReconnectDelay * Math.pow(2, attempts - 1), 30000);
        logger.info(`[SSE] Reconnecting in ${delay}ms (attempt ${attempts}/${maxReconnectAttempts})`);

        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      }
    };
  }, [enabled, closeConnection, mergeMessages, updateExistingMessage, maxReconnectAttempts, baseReconnectDelay]);

  /** Manual reconnect — reset attempts and connect */
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    setError(null);
    connect();
  }, [connect]);

  /** Manual disconnect */
  const disconnect = useCallback(() => {
    closeConnection();
    setConnectionState('disconnected');
    setError(null);
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
  }, [closeConnection]);

  // Main effect: connect/disconnect when conversationId or enabled changes
  useEffect(() => {
    if (!conversationId || !enabled) {
      closeConnection();
      setConnectionState('disconnected');
      return;
    }

    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    setIsProcessing(false);
    setProcessingAgentName(null);
    setProcessingStartedAt(null);

    connect();

    return () => {
      closeConnection();
    };
  }, [conversationId, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    connectionState,
    isConnected: connectionState === 'connected',
    error,
    reconnectAttempts,
    reconnect,
    disconnect,
    isProcessing,
    processingAgentName,
    processingStartedAt,
  };
}
