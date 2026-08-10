/**
 * useScrollManagement — Scroll behavior for chat messages.
 * ADR-096: Scroll Management Architecture.
 * Extracted from AIChatPanel.tsx (lines 1482-1700).
 *
 * 5 scroll-related effects:
 *   1. Conversation change reset — resets flags when conversation switches
 *   2. isNearBottom tracker — passive scroll listener
 *   3. Main auto-scroll — fires on message changes, respects isNearBottom
 *   4. IntersectionObserver — infinite scroll for loading older messages
 *   5. Fetch reactions when messages change
 */
import { useRef, useEffect, useCallback, type RefObject } from 'react';
import { CHAT_CONFIG } from '../../../constants/chatConfig';
import type { ChatMessage } from '../../../types';

interface UseScrollManagementParams {
  displayMessages: ChatMessage[];
  aiConversationMessages: unknown[] | null;
  currentConversationId: number | null;
  userConversationId: number | null;
  chatPartnerId: number | string | undefined;
  chatPartnerType: string | undefined;
  hasOlderMessages: boolean | undefined;
  fetchOlderMessages: () => void;
  hasNextAIPage: boolean | undefined;
  fetchNextAIPage: () => void;
  isFetchingOlderMessages: boolean;
  isFetchingNextAIPage: boolean;
  isAgentProcessing: boolean;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  loadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  setShowScrollToBottom: (show: boolean) => void;
  setNewMessageCount: (fn: number | ((prev: number) => number)) => void;
  setAgentWorking: (working: boolean) => void;
  fetchReactionsForMessages: (ids: number[]) => void;
}

export function useScrollManagement({
  displayMessages,
  aiConversationMessages,
  currentConversationId,
  userConversationId,
  chatPartnerId,
  chatPartnerType,
  hasOlderMessages,
  fetchOlderMessages,
  hasNextAIPage,
  fetchNextAIPage,
  isFetchingOlderMessages,
  isFetchingNextAIPage,
  messagesEndRef,
  messagesContainerRef,
  loadMoreSentinelRef,
  setShowScrollToBottom,
  setNewMessageCount,
  setAgentWorking,
  fetchReactionsForMessages,
}: UseScrollManagementParams) {
  const isFirstLoad = useRef(true);
  const prevMessageCountRef = useRef(0);
  const prevHumanVisibleCountRef = useRef(0);
  const prevScrollTriggerCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const isLoadingOlderRef = useRef(false);
  const prevMessageSourceRef = useRef<'context' | 'hook' | null>(null);

  // Reset scroll state when conversation changes
  useEffect(() => {
    isFirstLoad.current = true;
    isNearBottomRef.current = true;
    prevMessageCountRef.current = 0;
    prevHumanVisibleCountRef.current = 0;
    prevScrollTriggerCountRef.current = 0;
    setNewMessageCount(0);
    setAgentWorking(false);
  }, [currentConversationId, userConversationId, chatPartnerId]);

  // Update isNearBottom on scroll events
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      const wasNearBottom = isNearBottomRef.current;
      isNearBottomRef.current = distanceFromBottom <= CHAT_CONFIG.AUTO_SCROLL_THRESHOLD;
      const shouldShow = distanceFromBottom > CHAT_CONFIG.SCROLL_BUTTON_THRESHOLD;
      setShowScrollToBottom(shouldShow);
      if (!wasNearBottom && isNearBottomRef.current) {
        setNewMessageCount(0);
      }
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Count only human-visible messages
  const countHumanVisible = useCallback((msgs: ChatMessage[]) => {
    return msgs.filter(m => {
      if (m.role === 'user') return true;
      if (m.role === 'assistant' && (!m.contentType || m.contentType === 'text')) return true;
      if (m.contentType === 'tool_approval') return true;
      if (m.role === 'system') return true;
      return false;
    }).length;
  }, []);

  // Count messages that should trigger auto-scroll
  const countScrollTrigger = useCallback((msgs: ChatMessage[]) => {
    return msgs.filter(m => {
      if (m.role === 'user') return true;
      if (m.role === 'assistant' && (!m.contentType || m.contentType === 'text')) return true;
      if (m.contentType === 'tool_approval') return true;
      if (m.contentType === 'thinking') return true;
      if (m.role === 'system') return true;
      return false;
    }).length;
  }, []);

  // Main auto-scroll effect
  useEffect(() => {
    if (displayMessages.length > 0) {
      const prevCount = prevMessageCountRef.current;
      prevMessageCountRef.current = displayMessages.length;

      const currentSource = (aiConversationMessages && aiConversationMessages.length > 0) ? 'hook' : 'context';
      prevMessageSourceRef.current = currentSource;

      if (isLoadingOlderRef.current) return;

      if (isFirstLoad.current) {
        isFirstLoad.current = false;
        prevHumanVisibleCountRef.current = countHumanVisible(displayMessages);
        prevScrollTriggerCountRef.current = countScrollTrigger(displayMessages);
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
          isNearBottomRef.current = true;
        }, 50);
        return;
      }

      const totalNewCount = displayMessages.length - prevCount;
      if (totalNewCount <= 0) return;

      const currentHumanVisible = countHumanVisible(displayMessages);
      const newHumanVisible = currentHumanVisible - prevHumanVisibleCountRef.current;
      prevHumanVisibleCountRef.current = currentHumanVisible;

      const currentScrollTrigger = countScrollTrigger(displayMessages);
      const newScrollTrigger = currentScrollTrigger - prevScrollTriggerCountRef.current;
      prevScrollTriggerCountRef.current = currentScrollTrigger;

      const hasAgentInternalMessages = totalNewCount > 0 && newScrollTrigger === 0;
      setAgentWorking(hasAgentInternalMessages);

      const container = messagesContainerRef.current;
      if (container) {
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceFromBottom > CHAT_CONFIG.AUTO_SCROLL_THRESHOLD) {
          isNearBottomRef.current = false;
        }
      }

      if (!isNearBottomRef.current) {
        if (newHumanVisible > 0) {
          setNewMessageCount(prev => (typeof prev === 'number' ? prev : 0) + newHumanVisible);
        }
        return;
      }

      if (newScrollTrigger > 0) {
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' as ScrollBehavior });
        }, 50);
      }
    }
  }, [displayMessages, aiConversationMessages, countHumanVisible, countScrollTrigger]);

  // Keep refs for IntersectionObserver
  const hasMoreRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loadOlderRef = useRef<() => any>(() => {});

  useEffect(() => {
    const isUserOrGroup = chatPartnerType === 'user' || chatPartnerType === 'group';
    const isAgent = chatPartnerType === 'agent';
    if (isUserOrGroup) {
      hasMoreRef.current = !!hasOlderMessages;
      loadOlderRef.current = () => fetchOlderMessages();
    } else if (isAgent) {
      hasMoreRef.current = !!hasNextAIPage;
      loadOlderRef.current = () => fetchNextAIPage();
    } else {
      hasMoreRef.current = false;
      loadOlderRef.current = () => {};
    }
  }, [chatPartnerType, hasOlderMessages, fetchOlderMessages, hasNextAIPage, fetchNextAIPage]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const container = messagesContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !isLoadingOlderRef.current && hasMoreRef.current) {
          isLoadingOlderRef.current = true;
          const prevScrollHeight = container.scrollHeight;
          const prevScrollTop = container.scrollTop;

          Promise.resolve(loadOlderRef.current()).finally(() => {
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
        rootMargin: '800px 0px 0px 0px',
        threshold: 0
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMessages.length > 0]);

  // Fetch reactions when messages change
  useEffect(() => {
    const messageIds = displayMessages
      .filter(m => m.id && !isNaN(Number(m.id)))
      .map(m => Number(m.id));
    if (messageIds.length > 0) {
      fetchReactionsForMessages(messageIds);
    }
  }, [displayMessages, fetchReactionsForMessages]);

  return {
    isLoadingOlderRef,
    isNearBottomRef,
  };
}
