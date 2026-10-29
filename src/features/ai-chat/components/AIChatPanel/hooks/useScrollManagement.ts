/**
 * useScrollManagement — Scroll behavior for chat messages.
 * ADR-096: Scroll Management Architecture.
 * Extracted from AIChatPanel.tsx (lines 1482-1700).
 *
 * BUG FIX: Replaced all scrollIntoView() calls with direct container.scrollTop
 * manipulation. scrollIntoView() scrolls ALL ancestor scrollable containers,
 * which caused the main layout to jump to the top when sending messages or
 * opening conversations.
 *
 * 5 scroll-related effects:
 *   1. Conversation change reset — resets flags when conversation switches
 *   2. isNearBottom tracker — passive scroll listener
 *   3. Main auto-scroll — fires on message changes, respects isNearBottom
 *   4. IntersectionObserver — infinite scroll for loading older messages
 *   5. Fetch reactions when messages change
 */
import { useRef, useEffect, useLayoutEffect, useCallback, type RefObject } from 'react';
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
  /** When true — auto-scroll on ANY new messages (including tool_call / tool_result) */
  isOpen: boolean;
  messagesEndRef: RefObject<HTMLDivElement>;
  messagesContainerRef: RefObject<HTMLDivElement>;
  loadMoreSentinelRef: RefObject<HTMLDivElement>;
  setShowScrollToBottom: (show: boolean) => void;
  setNewMessageCount: (fn: number | ((prev: number) => number)) => void;
  setAgentWorking: (working: boolean) => void;
  fetchReactionsForMessages: (ids: number[]) => void;
}

/** Scroll container to absolute bottom — only affects the chat container, never parent elements. */
function scrollContainerToBottom(container: HTMLElement | null, behavior: ScrollBehavior = 'instant') {
  if (!container) return;
  if (behavior === 'instant') {
    container.scrollTop = container.scrollHeight;
  } else {
    container.scrollTo({ top: container.scrollHeight, behavior });
  }
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
  isAgentProcessing,
  isOpen,
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
  const userJustSentRef = useRef(false);
  // Sticky flag: stays true for a short window after send so that subsequent
  // re-renders (optimistic → server replace) also force scroll to bottom.
  const userSentStickyUntilRef = useRef(0);
  // Track conversation change timestamp — safety net uses this to decide if scroll-to-bottom is warranted
  const conversationChangedAtRef = useRef(0);
  // Upward scrolling detaches following until the reader returns to the bottom.
  const lastScrollTopRef = useRef(0);

  // Conversation identity as last seen by the reset effect below. chatPartnerId
  // can change without a conversation switch (another agent joins a group chat);
  // that must not count as "new conversation" while the user is reading above.
  const prevConversationKeyRef = useRef<string | null>(null);
  const conversationResetPendingRef = useRef(false);

  // LAYOUT EFFECT: Reset isFirstLoad on conversation change BEFORE the scroll layout effect fires.
  // BUG FIX: Previously this was a useEffect, which runs AFTER useLayoutEffect.
  // When switching conversations with cached data, the scroll layout effect checked isFirstLoad
  // before it was reset — causing scroll-to-bottom to be skipped entirely.
  useLayoutEffect(() => {
    const conversationKey = `${currentConversationId ?? ''}:${userConversationId ?? ''}`;
    const conversationChanged = prevConversationKeyRef.current !== conversationKey;
    prevConversationKeyRef.current = conversationKey;
    // WP-3 (bug 228711): a partner-only change while the user is scrolled up
    // used to re-arm the first-load scroll loop (1.5 s of forced scroll-to-bottom).
    // Same conversation + user reading above the threshold → leave them alone.
    if (!conversationChanged && !isNearBottomRef.current) return;
    conversationResetPendingRef.current = true;
    isFirstLoad.current = true;
    isNearBottomRef.current = true;
    isLoadingOlderRef.current = true; // Block IntersectionObserver until first scroll completes
    prevMessageCountRef.current = 0;
    prevHumanVisibleCountRef.current = 0;
    prevScrollTriggerCountRef.current = 0;
    conversationChangedAtRef.current = Date.now();
    // Reset scroll-direction tracker so a switch from a longer conversation
    // to a shorter one isn't misread as the user scrolling up.
    lastScrollTopRef.current = 0;
  }, [currentConversationId, userConversationId, chatPartnerId]);

  // State updates from conversation change (can stay as useEffect — not timing-critical).
  // Mirrors the layout effect above: skipped when that reset was skipped, so the
  // "new messages" badge survives a partner-only change while reading above.
  useEffect(() => {
    if (!conversationResetPendingRef.current) return;
    conversationResetPendingRef.current = false;
    setNewMessageCount(0);
    setAgentWorking(false);
  }, [currentConversationId, userConversationId, chatPartnerId]);

  // LAYOUT EFFECT: Scroll to bottom BEFORE browser paints — prevents flash of wrong scroll position.
  // This runs synchronously after DOM mutations but before the user sees anything.
  // Covers the case where cached messages render instantly and useEffect scroll arrives too late.
  // Depends on isOpen so it also fires when the panel reopens with cached messages.
  useLayoutEffect(() => {
    if (!isOpen || !messagesContainerRef.current) return;
    // A source switch can briefly clear the list after cached messages were
    // shown. The incoming history is an initial load, not a new-message append.
    if (displayMessages.length === 0) {
      isFirstLoad.current = true;
      return;
    }
    const container = messagesContainerRef.current;
    const pinBottom = () => {
      if (!isNearBottomRef.current || (!isFirstLoad.current && isLoadingOlderRef.current)) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.anchorNode && container.contains(selection.anchorNode)) return;
      scrollContainerToBottom(container);
      // A shrinking bubble also moves scrollTop up; that is not a user gesture.
      lastScrollTopRef.current = container.scrollTop;
    };
    pinBottom();

    // Child-local updates (tool previews, images, accordions) can change height
    // without a new displayMessages array. ResizeObserver runs before paint:
    // keep the bottom fixed instead of animating toward it a few frames later.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(pinBottom);
    observer.observe(container);
    const content = container.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [displayMessages, isOpen, isAgentProcessing, currentConversationId, userConversationId, chatPartnerId]);

  // Reset scroll when panel reopens (component returns null when closed,
  // but hooks persist — so isFirstLoad stays false for same conversation).
  // Also explicitly scroll to bottom since displayMessages may not change
  // (cached data is already present), so the main auto-scroll effect won't fire.
  const prevIsOpenRef = useRef(isOpen);

  // LAYOUT EFFECT: Immediate scroll before paint when panel reopens.
  // Also reset isFirstLoad here (not just in useEffect) so that the
  // displayMessages layout effect can fire a proper first-load scroll
  // in the SAME render cycle.
  useLayoutEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      isFirstLoad.current = true;
      isNearBottomRef.current = true;
      isLoadingOlderRef.current = true;
      prevMessageCountRef.current = 0;
      prevHumanVisibleCountRef.current = 0;
      prevScrollTriggerCountRef.current = 0;
      lastScrollTopRef.current = 0;
      scrollContainerToBottom(messagesContainerRef.current);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      // Ref resets already done in the layout effect above; only set state here
      setNewMessageCount(0);

      // rAF-loop scroll-to-bottom for panel reopen (same as first load)
      // Stops early if user scrolls away from bottom
      const startTime = Date.now();
      const scrollLoop = () => {
        const c = messagesContainerRef.current;
        if (!c) return;
        if (!isNearBottomRef.current) {
          isLoadingOlderRef.current = false;
          return;
        }
        const distFromBottom = c.scrollHeight - c.scrollTop - c.clientHeight;
        if (distFromBottom > 5) {
          scrollContainerToBottom(c);
        }
        if (Date.now() - startTime < 1000) {
          requestAnimationFrame(scrollLoop);
        } else {
          isLoadingOlderRef.current = false;
        }
      };
      requestAnimationFrame(scrollLoop);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen]);

  // Update isNearBottom on scroll events (rAF-debounced)
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    let rafId: number | null = null;
    lastScrollTopRef.current = container.scrollTop;
    const handleScroll = () => {
      // Update intent synchronously: an already queued scroll callback can run
      // before a debounced listener, especially during mobile touch scrolling.
      const currentScrollTop = container.scrollTop;
      const distanceFromBottom = container.scrollHeight - currentScrollTop - container.clientHeight;
      const wasNearBottom = isNearBottomRef.current;
      if (distanceFromBottom <= 5) {
        isNearBottomRef.current = true;
      } else if (currentScrollTop < lastScrollTopRef.current - 2 ||
                 distanceFromBottom > CHAT_CONFIG.AUTO_SCROLL_THRESHOLD) {
        isNearBottomRef.current = false;
        userJustSentRef.current = false;
        userSentStickyUntilRef.current = 0;
      }
      lastScrollTopRef.current = currentScrollTop;
      if (!wasNearBottom && isNearBottomRef.current) setNewMessageCount(0);
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
        setShowScrollToBottom(!isNearBottomRef.current || distance > CHAT_CONFIG.SCROLL_BUTTON_THRESHOLD);
      });
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isOpen]);

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
      if (m.contentType === 'agent_status') return true; // Auto-scroll on agent status updates
      if (m.role === 'system') return true;
      return false;
    }).length;
  }, []);

  // Main auto-scroll effect
  useEffect(() => {
    // Hidden panels retain their hooks but have no message DOM to position.
    if (!isOpen || !messagesContainerRef.current) return;
    if (displayMessages.length > 0) {
      const prevCount = prevMessageCountRef.current;
      prevMessageCountRef.current = displayMessages.length;

      const currentSource = (aiConversationMessages && aiConversationMessages.length > 0) ? 'hook' : 'context';
      prevMessageSourceRef.current = currentSource;

      // Only the explicit local send action may override the reading position.
      const isStickyActive = Date.now() < userSentStickyUntilRef.current;
      const userSent = userJustSentRef.current || isStickyActive;

      // If user just sent — always force scroll to bottom, ignore loading state.
      if (userSent) {
        if (userJustSentRef.current) {
          // First trigger — set sticky window (5s) so subsequent re-renders
          // (optimistic update → server message replace → polling) also scroll to bottom.
          userSentStickyUntilRef.current = Date.now() + 5000;
        }
        userJustSentRef.current = false;
        prevHumanVisibleCountRef.current = countHumanVisible(displayMessages);
        prevScrollTriggerCountRef.current = countScrollTrigger(displayMessages);
        isNearBottomRef.current = true;
        // Instant scroll to bottom — 'smooth' caused visible jump to top then back to bottom.
        scrollContainerToBottom(messagesContainerRef.current, 'instant');
        requestAnimationFrame(() => {
          if (isNearBottomRef.current) scrollContainerToBottom(messagesContainerRef.current, 'instant');
        });
        return;
      }

      // FIRST LOAD must run before isLoadingOlderRef check — otherwise deadlock:
      // conversation change sets isLoadingOlderRef=true, which blocks isFirstLoad,
      // but isFirstLoad is the only place that sets isLoadingOlderRef=false.
      if (isFirstLoad.current) {
        isFirstLoad.current = false;
        prevHumanVisibleCountRef.current = countHumanVisible(displayMessages);
        prevScrollTriggerCountRef.current = countScrollTrigger(displayMessages);

        const forceScrollBottom = () => {
          const c = messagesContainerRef.current;
          if (!c) return;
          c.scrollTop = c.scrollHeight;
          isNearBottomRef.current = true;
        };

        // Immediate attempt
        forceScrollBottom();

        // rAF-loop: keeps correcting scroll position for DOM rendering timing issues
        // Stops early if user scrolls away from bottom (isNearBottomRef = false)
        const startTime = Date.now();
        const scrollLoop = () => {
          const c = messagesContainerRef.current;
          if (!c) return;
          // Stop forcing scroll if user manually scrolled up
          if (!isNearBottomRef.current) {
            isLoadingOlderRef.current = false;
            return;
          }
          const distFromBottom = c.scrollHeight - c.scrollTop - c.clientHeight;
          if (distFromBottom > 5) forceScrollBottom();
          // 1.5s is enough for DOM to settle — 5s was too long, fought user scroll
          if (Date.now() - startTime < 1500) {
            requestAnimationFrame(scrollLoop);
          } else {
            isLoadingOlderRef.current = false;
          }
        };
        requestAnimationFrame(scrollLoop);

        // setTimeout fallbacks for mobile — rAF can be throttled/delayed
        // All respect isNearBottomRef to avoid yanking user back to bottom
        const guardedScroll = () => { if (isNearBottomRef.current) forceScrollBottom(); };
        setTimeout(guardedScroll, 100);
        setTimeout(guardedScroll, 300);
        setTimeout(guardedScroll, 800);
        return;
      }

      // Skip auto-scroll while loading older messages at the top
      if (isLoadingOlderRef.current) return;

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

      if (!isNearBottomRef.current) {
        if (newHumanVisible > 0) {
          setNewMessageCount(prev => (typeof prev === 'number' ? prev : 0) + newHumanVisible);
        }
        return;
      }

      // Positioning is handled before paint by the layout effect / resize observer.
    }
  }, [displayMessages, aiConversationMessages, countHumanVisible, countScrollTrigger, isAgentProcessing, isOpen, currentConversationId, userConversationId, chatPartnerId]);

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
            // Wait for React to actually render new messages before restoring scroll.
            // Double-rAF sometimes fires before DOM updates — poll until scrollHeight changes.
            let attempts = 0;
            const restoreScroll = () => {
              const newScrollHeight = container.scrollHeight;
              if (newScrollHeight === prevScrollHeight && attempts < 20) {
                // DOM hasn't updated yet — retry next frame
                attempts++;
                requestAnimationFrame(restoreScroll);
                return;
              }
              const addedHeight = newScrollHeight - prevScrollHeight;
              container.scrollTop = prevScrollTop + addedHeight;
              // Keep isLoadingOlder true briefly to prevent auto-scroll jitter
              setTimeout(() => {
                isLoadingOlderRef.current = false;
              }, 150);
            };
            requestAnimationFrame(restoreScroll);
          });
        }
      },
      {
        root: container,
        rootMargin: '300px 0px 0px 0px',
        threshold: 0
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMessages.length > 0]);

  // Re-scroll to bottom when tab becomes visible (user returns from another tab/app)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isOpen && isNearBottomRef.current) {
        requestAnimationFrame(() => {
          if (isNearBottomRef.current) scrollContainerToBottom(messagesContainerRef.current);
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isOpen]);

  // SAFETY NET: Catch cases where isFirstLoad was consumed before real data arrived.
  // After a conversation change, if messages are loaded but scroll is stuck near the top,
  // force scroll to bottom. Only acts within 8 seconds of conversation change to avoid
  // interfering with intentional scroll-up.
  useEffect(() => {
    if (displayMessages.length === 0) return;
    const timeSinceChange = Date.now() - conversationChangedAtRef.current;
    if (timeSinceChange > 3000) return; // Too late — user may have scrolled intentionally

    const checkAndScroll = () => {
      const c = messagesContainerRef.current;
      if (!c) return;
      // Don't force scroll if user has intentionally scrolled up
      if (!isNearBottomRef.current) return;
      const scrollRange = c.scrollHeight - c.clientHeight;
      if (scrollRange < 50) return; // Not enough content to scroll — no issue
      const distFromBottom = c.scrollHeight - c.scrollTop - c.clientHeight;
      // If we're in the top 70% of scrollable area, we're definitely not at bottom
      if (distFromBottom > scrollRange * 0.3) {
        scrollContainerToBottom(c);
        isNearBottomRef.current = true;
      }
    };

    // Check at multiple intervals to catch late-rendering content
    const t1 = setTimeout(checkAndScroll, 300);
    const t2 = setTimeout(checkAndScroll, 800);
    const t3 = setTimeout(checkAndScroll, 1500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [displayMessages, currentConversationId, userConversationId]);

  // Fetch reactions when messages change
  useEffect(() => {
    const messageIds = displayMessages
      .filter(m => m.id && !isNaN(Number(m.id)))
      .map(m => Number(m.id));
    if (messageIds.length > 0) {
      fetchReactionsForMessages(messageIds);
    }
  }, [displayMessages, fetchReactionsForMessages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'instant') => {
    userJustSentRef.current = true;
    userSentStickyUntilRef.current = Date.now() + 5000; // 5s sticky window for slow server responses
    isNearBottomRef.current = true;
    // Immediate + rAF + delayed fallback — all container-scoped (no scrollIntoView)
    const container = messagesContainerRef.current;
    scrollContainerToBottom(container, behavior);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (isNearBottomRef.current) scrollContainerToBottom(messagesContainerRef.current, behavior);
      });
    });
    setTimeout(() => {
      if (isNearBottomRef.current) scrollContainerToBottom(messagesContainerRef.current);
    }, 150);
  }, []);

  return {
    isLoadingOlderRef,
    isNearBottomRef,
    scrollToBottom,
  };
}
