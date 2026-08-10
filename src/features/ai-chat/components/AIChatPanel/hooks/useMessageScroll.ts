/**
 * useMessageScroll Hook
 * ADR-097 Phase 3: Extracted scroll-related logic from AIChatPanel.tsx
 *
 * ADR-096 Scroll Management Architecture (5 concerns):
 *   1. Mobile keyboard scroll — viewport resize → scroll to bottom (handled externally)
 *   2. Conversation change reset — resets flags when conversation switches
 *   3. isNearBottom tracker — passive scroll listener, never re-created
 *   4. Main auto-scroll — fires on message changes, respects isNearBottom
 *   5. IntersectionObserver — infinite scroll for loading older messages
 *
 * These are NOT competing — they form a pipeline:
 *   #2 resets → #3 tracks position → #4 scrolls if near bottom → #5 loads older at top
 */

import { useRef, useEffect, useCallback, type RefObject, type Dispatch, type SetStateAction } from 'react';
import type { ChatMessage, ChatPartner } from '../types';
import { CHAT_CONFIG } from '../../../constants/chatConfig';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseMessageScrollParams {
  /** The display messages array (merged from user/AI sources) */
  displayMessages: ChatMessage[];
  /** AI conversation messages from React Query hook (used for source detection) */
  aiConversationMessages: ChatMessage[];
  /** Messages from AIChatContext (fallback source) */
  contextMessages: ChatMessage[];
  /** Current conversation ID (AI agent) */
  currentConversationId: number | null;
  /** User/group conversation ID */
  userConversationId: number | null;
  /** Current chat partner */
  chatPartner: ChatPartner | null;
  /** Whether user/group chat has more older messages */
  hasOlderMessages: boolean;
  /** Fetch older user/group messages */
  fetchOlderMessages: () => void;
  /** Whether AI agent chat has more older messages */
  hasNextAIPage: boolean;
  /** Fetch older AI agent messages */
  fetchNextAIPage: () => void;
  /** Setter for showScrollToBottom state (Ticket #37259) */
  setShowScrollToBottom: Dispatch<SetStateAction<boolean>>;
}

export interface UseMessageScrollResult {
  /** Ref to attach to the messages container div (overflow-y) */
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  /** Ref to attach to a sentinel div at the bottom of messages */
  messagesEndRef: RefObject<HTMLDivElement | null>;
  /** Ref to attach to a sentinel div at the top of messages (for infinite scroll) */
  loadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  /** Ref to the text input (for focus management) */
  inputRef: RefObject<HTMLTextAreaElement | null>;
  /** Ref to the hidden file input */
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** Programmatically scroll to the bottom of the messages container */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  /** Whether the user is currently near the bottom (for conditional auto-scroll) */
  isNearBottom: () => boolean;
}

// ─── The Hook ─────────────────────────────────────────────────────────────────

export function useMessageScroll(params: UseMessageScrollParams): UseMessageScrollResult {
  const {
    displayMessages,
    aiConversationMessages,
    contextMessages,
    currentConversationId,
    userConversationId,
    chatPartner,
    hasOlderMessages,
    fetchOlderMessages,
    hasNextAIPage,
    fetchNextAIPage,
    setShowScrollToBottom,
  } = params;

  // ── Refs ───────────────────────────────────────────────────────────────────
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Internal tracking refs
  const isFirstLoad = useRef(true);
  const prevMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const isLoadingOlderRef = useRef(false);

  // Keep refs for IntersectionObserver callback to avoid stale closures
  const hasMoreRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loadOlderRef = useRef<() => any>(() => {});

  // ── Public API ─────────────────────────────────────────────────────────────

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  const isNearBottom = useCallback(() => {
    return isNearBottomRef.current;
  }, []);

  // ── Effect #2: Reset scroll state when conversation changes ────────────────

  useEffect(() => {
    isFirstLoad.current = true;
    isNearBottomRef.current = true;
    prevMessageCountRef.current = 0;
  }, [currentConversationId, userConversationId, chatPartner?.id]);

  // ── Effect #3: Track isNearBottom on scroll + show/hide scroll-to-bottom ──

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      isNearBottomRef.current = distanceFromBottom <= CHAT_CONFIG.AUTO_SCROLL_THRESHOLD;
      // Show scroll-to-bottom arrow when user scrolls up beyond threshold
      setShowScrollToBottom(distanceFromBottom > CHAT_CONFIG.SCROLL_BUTTON_THRESHOLD);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [setShowScrollToBottom]);

  // ── Effect #4: Auto-scroll on new messages ────────────────────────────────
  // ADR-103: Only scroll on human-visible messages (user text + agent text),
  // NOT on tool_call/tool_result/thinking to avoid scroll jumping during agent processing
  // Ticket #74079: tool_approval messages are also "visible" since they require user action

  // Helper: count only human-visible messages (includes tool_approval — user-actionable)
  const countVisible = useCallback((msgs: typeof displayMessages) => {
    return msgs.filter(m => {
      if (m.role === 'user') return true;
      if (m.role === 'assistant' && (!m.contentType || m.contentType === 'text')) return true;
      if (m.contentType === 'tool_approval') return true;
      if (m.role === 'system') return true;
      return false;
    }).length;
  }, []);

  const prevVisibleCountRef = useRef(0);

  useEffect(() => {
    if (displayMessages.length > 0) {
      prevMessageCountRef.current = displayMessages.length;

      // Skip scroll if loading older messages (prepend, not append)
      if (isLoadingOlderRef.current) return;

      // On first load only, scroll to bottom instantly (conversation just opened)
      if (isFirstLoad.current) {
        isFirstLoad.current = false;
        prevVisibleCountRef.current = countVisible(displayMessages);
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
          isNearBottomRef.current = true;
        }, 50);
        return;
      }

      // Check if there are NEW human-visible messages (not just tool_call/thinking)
      const currentVisible = countVisible(displayMessages);
      const newVisible = currentVisible - prevVisibleCountRef.current;
      prevVisibleCountRef.current = currentVisible;

      if (newVisible <= 0) return;

      // Ticket #74079: tool_approval messages require user action (Allow/Deny buttons).
      // However, do NOT force-scroll if the user has manually scrolled up to read history.
      // Respect the same isNearBottom check as normal messages — the user will see
      // the scroll-to-bottom button and can navigate down when ready.

      // Bug fix: Double-check scroll position from DOM directly (not just ref).
      // The ref might be stale if scroll events haven't fired yet after DOM update.
      // This prevents auto-scroll from pulling user back to bottom when they're reading old messages.
      const container = messagesContainerRef.current;
      if (container) {
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceFromBottom > CHAT_CONFIG.AUTO_SCROLL_THRESHOLD) {
          // User is scrolled up more than 500px — do NOT auto-scroll
          isNearBottomRef.current = false;
          return;
        }
      }

      // Also check the ref (belt + suspenders)
      if (!isNearBottomRef.current) return;

      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' as ScrollBehavior });
      }, 50);
    }
  }, [displayMessages, countVisible]);

  // ── Keep pagination refs in sync ──────────────────────────────────────────

  useEffect(() => {
    const isUserOrGroup = chatPartner?.type === 'user' || chatPartner?.type === 'group';
    const isAgent = chatPartner?.type === 'agent';

    if (isUserOrGroup) {
      hasMoreRef.current = !!hasOlderMessages;
      loadOlderRef.current = () => fetchOlderMessages();
    } else if (isAgent) {
      // ADR-078: Always use React Query hook for AI agent pagination.
      hasMoreRef.current = !!hasNextAIPage;
      loadOlderRef.current = () => fetchNextAIPage();
    } else {
      hasMoreRef.current = false;
      loadOlderRef.current = () => {};
    }
  }, [chatPartner?.type, hasOlderMessages, fetchOlderMessages, hasNextAIPage, fetchNextAIPage]);

  // ── Effect #5: IntersectionObserver for infinite scroll ───────────────────

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const container = messagesContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        if (entry?.isIntersecting && !isLoadingOlderRef.current && hasMoreRef.current) {
          isLoadingOlderRef.current = true;

          // Save scroll position before prepending older messages
          const prevScrollHeight = container.scrollHeight;
          const prevScrollTop = container.scrollTop;

          Promise.resolve(loadOlderRef.current()).finally(() => {
            // Restore scroll position after DOM update via double-rAF
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const newScrollHeight = container.scrollHeight;
                const addedHeight = newScrollHeight - prevScrollHeight;
                container.scrollTop = prevScrollTop + addedHeight;
                isLoadingOlderRef.current = false;
              });
            });
          });
        }
      },
      {
        root: container,
        rootMargin: '800px 0px 0px 0px', // Trigger 800px before reaching top
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
    // Re-create observer when messages first appear (sentinel enters DOM)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMessages.length > 0]);

  // ── Return ─────────────────────────────────────────────────────────────────

  return {
    messagesContainerRef,
    messagesEndRef,
    loadMoreSentinelRef,
    inputRef,
    fileInputRef,
    scrollToBottom,
    isNearBottom,
  };
}
