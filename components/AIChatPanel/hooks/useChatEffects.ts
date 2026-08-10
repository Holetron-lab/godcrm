/**
 * useChatEffects Hook
 * ADR-097 Phase 4: Organizes ALL 21 useEffect hooks from AIChatPanel.tsx
 * into logical groups with clear documentation of origin lines.
 *
 * Categories:
 *   1. LIFECYCLE — mount/unmount, initialization, open/close
 *   2. DATA SYNC — keep local state in sync with fetched/context data
 *   3. UI        — scroll, focus, resize observers
 *   4. TIMER     — processing timer, stuck detection (delegated to useProcessingTimer)
 *
 * This hook does NOT replace the effects in AIChatPanel.tsx yet —
 * it is a "shadow" extraction so the refactoring can proceed incrementally.
 * When Phase 6 wires everything together, AIChatPanel will call useChatEffects()
 * instead of having inline useEffect blocks.
 */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type {
  ChatState,
  ChatActions,
  ChatPartner,
  ChatMessage,
  TasksSourceConfig,
  FilesSourceConfig,
} from '../types';
import { useProcessingTimer } from './useProcessingTimer';
import { CHAT_CONFIG } from '../../../constants/chatConfig';

// ─── Param interfaces ────────────────────────────────────────────────

/** External dependencies that come from useAIChat() context */
interface AIChatContextDeps {
  isOpen: boolean;
  currentAgent: {
    id: number;
    name: string;
    icon?: string;
    provider_id?: number;
    operator_id?: number;
    model?: string;
    system_prompt?: string;
  } | null;
  currentConversationId: number | null;
  agents: Array<{ id: number; name: string; icon?: string }>;
  messages: ChatMessage[];
  isAgentProcessing: boolean;
  processingStartedAt: number | null | undefined;
  loadAgents: () => void;
  loadConversations: () => void;
  selectAgent: (agent: { id: number; name: string; icon?: string }) => void;
  pendingTaskChat: {
    tableId: number;
    rowId: number;
    rowTitle?: string;
    conversationId: number;
  } | null;
  clearPendingTaskChat: () => void;
}

/** Data from React Query hooks */
interface QueryDeps {
  /** Conversation data returned by useConversationMessages for user/group chats */
  userConversationData: unknown;
  /** Messages from useConversationMessages for AI agent chats */
  aiConversationMessages: ChatMessage[] | undefined;
  /** Display-ready messages (merged from all sources) */
  displayMessages: ChatMessage[];
  /** Whether there are older user/group messages to fetch */
  hasOlderMessages: boolean;
  /** Fetch next page of user/group messages */
  fetchOlderMessages: () => void;
  /** Whether there are older AI messages to fetch */
  hasNextAIPage: boolean;
  /** Fetch next page of AI messages */
  fetchNextAIPage: () => void;
  /** Mark conversation as read */
  markAsRead: () => void;
  /** Refetch unread count */
  refetchUnread: () => void;
  /** All tables data for files auto-mapping */
  allTablesDataMain: {
    spacesWithTables?: Array<{
      projects: Array<{
        id: number;
        name: string;
        tables?: Array<{
          id: number | string;
          name?: string;
          displayName?: string;
          icon?: string;
        }>;
      }>;
    }>;
  } | undefined;
  /** Fetch reactions for a set of message IDs */
  fetchReactionsForMessages: (messageIds: number[]) => void;
}

/** Space-related dependencies */
interface SpaceDeps {
  effectiveSpaceId: number | undefined;
  currentSpace: {
    id?: number;
    settings?: Record<string, unknown> | null;
  } | null;
}

/** DOM Refs used by effects */
interface DomRefs {
  messagesEndRef: RefObject<HTMLDivElement | null>;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  loadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  isLoadingOlderRef: RefObject<boolean>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}

/** API client for direct calls (filesSource, tasksSource loading) */
interface ApiClientDep {
  get: <T>(url: string) => Promise<T>;
  patch: <T = unknown>(url: string, body: Record<string, unknown>) => Promise<T>;
}

interface UseChatEffectsParams {
  state: ChatState;
  actions: ChatActions;
  context: AIChatContextDeps;
  queries: QueryDeps;
  space: SpaceDeps;
  refs: DomRefs;
  apiClient: ApiClientDep;
}

// Default quick emojis (matches AIChatPanel.tsx constant)
const DEFAULT_QUICK_EMOJIS = ['👍', '❤️', '😂', '🔥', '💯', '🙏', '😍', '😮'];

/**
 * Organizes all 21 useEffect hooks from AIChatPanel.tsx.
 *
 * Each effect is annotated with:
 *   - Category (LIFECYCLE / DATA_SYNC / UI / TIMER)
 *   - Original line numbers in AIChatPanel.tsx
 *   - Ticket/ADR references where applicable
 */
export function useChatEffects({
  state,
  actions,
  context,
  queries,
  space,
  refs,
  apiClient,
}: UseChatEffectsParams): void {
  // ════════════════════════════════════════════════════════════
  // CATEGORY 1: TIMER EFFECTS
  // ════════════════════════════════════════════════════════════

  /**
   * Effect #1 — Processing elapsed timer (lines 370–383)
   * Ticket #36708: Stuck agent detection.
   * Delegated to the dedicated useProcessingTimer hook.
   */
  useProcessingTimer({
    isAgentProcessing: context.isAgentProcessing,
    processingStartedAt: context.processingStartedAt,
    setProcessingElapsed: actions.setProcessingElapsed,
  });

  // ════════════════════════════════════════════════════════════
  // CATEGORY 2: LIFECYCLE EFFECTS
  // ════════════════════════════════════════════════════════════

  /**
   * Effect #2 — Mobile virtual keyboard handling (lines 386–417)
   * Adjusts panel height when mobile keyboard opens/closes.
   * Uses VisualViewport API + requestAnimationFrame for smooth transitions.
   * Only scrolls once when keyboard first appears (not on every resize event).
   */
  useEffect(() => {
    if (!state.isMobile || typeof window === 'undefined') return;

    const viewport = window.visualViewport;
    if (!viewport) return;

    let rafId: number;
    let wasKeyboardOpen = false;
    const handleViewportResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const keyboardHeight = window.innerHeight - viewport.height;
        actions.setMobileKeyboardHeight(Math.max(0, keyboardHeight));

        // Scroll only once when keyboard first opens (not on every resize event)
        const isKeyboardOpen = keyboardHeight > 50;
        if (isKeyboardOpen && !wasKeyboardOpen) {
          refs.messagesEndRef.current?.scrollIntoView({ behavior: 'instant', block: 'end' });
        }
        wasKeyboardOpen = isKeyboardOpen;
      });
    };

    viewport.addEventListener('resize', handleViewportResize);

    return () => {
      cancelAnimationFrame(rafId);
      viewport.removeEventListener('resize', handleViewportResize);
    };
  }, [state.isMobile, actions, refs.messagesEndRef]);

  /**
   * Effect #3 — Load agents and conversations on open (lines 1151–1155)
   * Fires when the chat panel opens.
   */
  useEffect(() => {
    if (context.isOpen) {
      context.loadAgents();
      context.loadConversations();
    }
  }, [context.isOpen, context.loadAgents, context.loadConversations]);

  /**
   * Effect #4 — Mobile body scroll lock (lines 1164–1174)
   * Prevents background scrolling when chat is open on mobile.
   */
  useEffect(() => {
    if (!state.isMobile) return;
    if (context.isOpen) {
      document.body.classList.add('chat-open');
    } else {
      document.body.classList.remove('chat-open');
    }
    return () => {
      document.body.classList.remove('chat-open');
    };
  }, [context.isOpen, state.isMobile]);

  /**
   * Effect #5 — Auto-select default agent (lines 1143–1149)
   * When chat opens and no agent is selected, select the space's default.
   */
  useEffect(() => {
    if (
      context.isOpen &&
      state.defaultAgentId &&
      context.agents.length > 0 &&
      !context.currentAgent
    ) {
      const defaultAgent = context.agents.find(a => a.id === state.defaultAgentId);
      if (defaultAgent) {
        context.selectAgent(defaultAgent);
      }
    }
  }, [
    context.isOpen,
    state.defaultAgentId,
    context.agents,
    context.currentAgent,
    context.selectAgent,
  ]);

  /**
   * Effect #6 — Focus input when opening (lines 1498–1502)
   * Gives focus to the text input after the panel opens.
   */
  useEffect(() => {
    if (context.isOpen && state.activePanel === 'none') {
      setTimeout(() => refs.inputRef.current?.focus(), 300);
    }
  }, [context.isOpen, state.activePanel, refs.inputRef]);

  /**
   * Effect #7 — Handle pending task chat (lines 1184–1208, ADR-069)
   * When an external component triggers a task chat, set up the conversation.
   */
  useEffect(() => {
    if (context.pendingTaskChat) {
      actions.setChatMode('people');
      actions.setBoundRows([{
        table_id: context.pendingTaskChat.tableId,
        table_name: '',
        row_id: context.pendingTaskChat.rowId,
        row_title: context.pendingTaskChat.rowTitle || `#${context.pendingTaskChat.rowId}`,
      }]);
      actions.setUserConversationId(context.pendingTaskChat.conversationId);
      actions.setChatPartner({
        type: 'group',
        id: context.pendingTaskChat.conversationId,
        name: context.pendingTaskChat.rowTitle || `Тикет #${context.pendingTaskChat.rowId}`,
      });
      context.clearPendingTaskChat();
    }
  }, [context.pendingTaskChat, context.clearPendingTaskChat, actions]);

  // ════════════════════════════════════════════════════════════
  // CATEGORY 3: DATA SYNC EFFECTS
  // ════════════════════════════════════════════════════════════

  /**
   * Effect #8 — Sync chat settings when agent changes (lines 664–672)
   * Copies agent's operator, model, and system prompt into local state.
   */
  useEffect(() => {
    if (context.currentAgent) {
      actions.setChatOperatorId(
        context.currentAgent.provider_id || context.currentAgent.operator_id || null
      );
      actions.setChatModelId(context.currentAgent.model || '');
      actions.setChatSystemPrompt(context.currentAgent.system_prompt || '');
    }
  }, [context.currentAgent, actions]);

  /**
   * Effect #9 — Sync chatPartner with currentAgent (lines 1176–1183)
   * Keeps chatPartner in sync when the current agent changes.
   */
  useEffect(() => {
    if (
      context.currentAgent &&
      (!state.chatPartner || state.chatPartner.type === 'agent')
    ) {
      actions.setChatPartner({
        type: 'agent',
        id: context.currentAgent.id,
        name: context.currentAgent.name,
        icon: context.currentAgent.icon,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.currentAgent]);

  /**
   * Effect #10 — Reset user conversation when switching to agent (lines 1186–1190)
   * Clears the user conversation ID when switching from people to agent chat.
   */
  useEffect(() => {
    if (state.chatPartner?.type === 'agent') {
      actions.setUserConversationId(null);
    }
  }, [state.chatPartner?.type, actions]);

  /**
   * Effect #11 — Mark as read when user conversation loads (lines 747–751)
   * Marks messages as read when a user/group conversation data arrives.
   */
  useEffect(() => {
    if (state.userConversationId && queries.userConversationData) {
      queries.markAsRead();
      queries.refetchUnread();
    }
  }, [state.userConversationId, queries.userConversationData, queries.markAsRead, queries.refetchUnread]);

  /**
   * Effect #12 — Load tasksSource from space config (lines 1014–1035)
   * Reads tickets_config from space object or fetches from API.
   */
  useEffect(() => {
    const spaceId = space.effectiveSpaceId;
    if (!spaceId) return;

    const ticketsConfig = (
      space.currentSpace as { tickets_config?: TasksSourceConfig | null }
    )?.tickets_config;

    if (ticketsConfig) {
      actions.setTasksSource(ticketsConfig);
    } else {
      apiClient
        .get<{
          success?: boolean;
          data?: { space?: { tickets_config?: TasksSourceConfig | null } };
        }>(`/spaces/${spaceId}`)
        .then((resp) => {
          const config = resp?.data?.space?.tickets_config;
          if (config) {
            actions.setTasksSource(config);
          }
        })
        .catch(() => {
          // Silently fail — logged in original
        });
    }
  }, [space.effectiveSpaceId, space.currentSpace, actions, apiClient]);

  /**
   * Effect #13 — Load filesSource from space.files_config (server-first, same pattern as tickets_config)
   * Priority: server (files_config) > localStorage cache > auto-map from allTables.
   */
  useEffect(() => {
    const spaceId = space.effectiveSpaceId;
    if (!spaceId) return;

    const filesConfig = (
      space.currentSpace as { files_config?: FilesSourceConfig | null }
    )?.files_config;

    if (filesConfig) {
      actions.setFilesSource(filesConfig);
      // Sync to localStorage for fast hydration
      localStorage.setItem(`chat-files-source-${spaceId}`, JSON.stringify(filesConfig));
    } else {
      // Fetch from API (currentSpace may not have files_config populated)
      apiClient
        .get<{
          success?: boolean;
          data?: { space?: { files_config?: FilesSourceConfig | null } };
        }>(`/spaces/${spaceId}`)
        .then((resp) => {
          const config = resp?.data?.space?.files_config;
          if (config) {
            actions.setFilesSource(config);
            localStorage.setItem(`chat-files-source-${spaceId}`, JSON.stringify(config));
          } else {
            // No server config — try localStorage cache
            const saved = localStorage.getItem(`chat-files-source-${spaceId}`);
            if (saved) {
              try {
                actions.setFilesSource(JSON.parse(saved) as FilesSourceConfig);
              } catch {
                // corrupt localStorage — ignore
              }
            } else {
              // Auto-mapping: find Files table in System Data project
              if (queries.allTablesDataMain?.spacesWithTables) {
                for (const spaceData of queries.allTablesDataMain.spacesWithTables) {
                  const systemDataProject = spaceData.projects.find(
                    (p) =>
                      p.name.toLowerCase().includes('system data') ||
                      p.name.toLowerCase().includes('системные')
                  );
                  if (systemDataProject) {
                    const filesTable = systemDataProject.tables?.find(
                      (t) =>
                        t.name?.toLowerCase() === 'files' ||
                        t.displayName?.toLowerCase() === 'files' ||
                        t.name?.toLowerCase().includes('файл') ||
                        t.displayName?.toLowerCase().includes('файл')
                    );
                    if (filesTable) {
                      const autoConfig: FilesSourceConfig = {
                        tableId: Number(filesTable.id),
                        tableName: filesTable.displayName || filesTable.name || 'Files',
                        tableIcon: filesTable.icon || '📁',
                        projectId: systemDataProject.id,
                      };
                      actions.setFilesSource(autoConfig);
                      // Save auto-mapped config to server for persistence
                      apiClient.patch(`/spaces/${spaceId}`, { files_config: autoConfig })
                        .catch(() => { /* logged in original */ });
                      break;
                    }
                  }
                }
              }
            }
          }
        })
        .catch(() => {
          // Silently fail — logged in original
        });
    }
  }, [space.effectiveSpaceId, space.currentSpace, queries.allTablesDataMain, actions, apiClient]);

  /**
   * Effect #15 — Load default agent and quick emojis from space settings (lines 1112–1131)
   * Reads default_agent_id and quick_emojis from space.settings.
   */
  useEffect(() => {
    if (space.currentSpace?.settings && typeof space.currentSpace.settings === 'object') {
      const spaceSettings = space.currentSpace.settings as Record<string, unknown>;
      if (spaceSettings.default_agent_id) {
        actions.setDefaultAgentId(Number(spaceSettings.default_agent_id));
      } else {
        actions.setDefaultAgentId(null);
      }
      if (
        spaceSettings.quick_emojis &&
        Array.isArray(spaceSettings.quick_emojis)
      ) {
        actions.setQuickEmojis(spaceSettings.quick_emojis as string[]);
      } else {
        actions.setQuickEmojis(DEFAULT_QUICK_EMOJIS);
      }
    } else {
      actions.setDefaultAgentId(null);
      actions.setQuickEmojis(DEFAULT_QUICK_EMOJIS);
    }
  }, [space.currentSpace?.id, space.currentSpace?.settings, actions]);

  /**
   * Effect #16 — Fetch reactions when messages change (lines 1487–1495)
   * Batch-fetches reactions for all visible message IDs.
   */
  useEffect(() => {
    const messageIds = queries.displayMessages
      .filter((m) => m.id && !isNaN(Number(m.id)))
      .map((m) => Number(m.id));

    if (messageIds.length > 0) {
      queries.fetchReactionsForMessages(messageIds);
    }
  }, [queries.displayMessages, queries.fetchReactionsForMessages]);

  // ════════════════════════════════════════════════════════════
  // CATEGORY 4: UI / SCROLL EFFECTS
  // (ADR-096: Scroll Management Architecture)
  // Pipeline: #17 resets -> #18 tracks position -> #19 scrolls -> #20 loads older -> #21 observer
  // ════════════════════════════════════════════════════════════

  // Internal refs for scroll management (owned by this hook)
  const isFirstLoad = useRef(true);
  const prevMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const prevMessageSourceRef = useRef<'context' | 'hook' | null>(null);
  const hasMoreRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loadOlderRef = useRef<() => any>(() => {});

  /**
   * Effect #17 — Reset scroll state on conversation change (line 1360–1364)
   * Ensures new conversations always start scrolled to the bottom.
   */
  useEffect(() => {
    isFirstLoad.current = true;
    isNearBottomRef.current = true;
    prevMessageCountRef.current = 0;
  }, [context.currentConversationId, state.userConversationId, state.chatPartner?.id]);

  /**
   * Effect #18 — isNearBottom tracker + scroll-to-bottom arrow (lines 1367–1380)
   * Ticket #37259: Passive scroll listener that tracks user scroll position.
   * Shows/hides the "scroll to bottom" arrow.
   */
  useEffect(() => {
    const container = refs.messagesContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      const wasNearBottom = isNearBottomRef.current;
      isNearBottomRef.current = distanceFromBottom <= CHAT_CONFIG.AUTO_SCROLL_THRESHOLD;
      actions.setShowScrollToBottom(distanceFromBottom > CHAT_CONFIG.SCROLL_BUTTON_THRESHOLD);
      // Reset new message counter when user scrolls back to bottom
      if (!wasNearBottom && isNearBottomRef.current) {
        actions.setNewMessageCount(0);
      }
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [actions, refs.messagesContainerRef]);

  /**
   * Effect #19 — Main auto-scroll on new messages (lines 1384–1418)
   * ADR-096: Scrolls to bottom on first load, source switch, or when near bottom.
   * ADR-103: Only scroll on human-visible messages (user/system/text), not tool_call/tool_result/thinking.
   * Skips scroll when loading older messages (prepend, not append).
   */
  const prevVisibleCountRef = useRef(0);
  const prevScrollTriggerCountRef = useRef(0);
  useEffect(() => {
    if (queries.displayMessages.length > 0) {
      prevMessageCountRef.current = queries.displayMessages.length;

      // Detect message source switch (context -> hook)
      const currentSource: 'context' | 'hook' =
        queries.aiConversationMessages && queries.aiConversationMessages.length > 0
          ? 'hook'
          : 'context';
      const sourceChanged =
        prevMessageSourceRef.current !== null &&
        prevMessageSourceRef.current !== currentSource;
      prevMessageSourceRef.current = currentSource;

      // Skip if loading older (messages prepended, not appended)
      if (refs.isLoadingOlderRef.current) return;

      // Count human-visible messages (for badge — excludes thinking)
      const countVisible = queries.displayMessages.filter(m => {
        if (m.role === 'user') return true;
        if (m.role === 'assistant' && (!m.contentType || m.contentType === 'text')) return true;
        if (m.role === 'system') return true;
        return false;
      }).length;

      // Count scroll-trigger messages (includes thinking/reasoning for auto-scroll)
      const countScroll = queries.displayMessages.filter(m => {
        if (m.role === 'user') return true;
        if (m.role === 'assistant' && (!m.contentType || m.contentType === 'text')) return true;
        if (m.contentType === 'thinking') return true;
        if (m.contentType === 'tool_approval') return true;
        if (m.role === 'system') return true;
        return false;
      }).length;

      // First load or source switch: instant scroll
      if (isFirstLoad.current || sourceChanged) {
        isFirstLoad.current = false;
        prevVisibleCountRef.current = countVisible;
        prevScrollTriggerCountRef.current = countScroll;
        setTimeout(() => {
          refs.messagesEndRef.current?.scrollIntoView({
            behavior: 'instant' as ScrollBehavior,
          });
          isNearBottomRef.current = true;
        }, 50);
        return;
      }

      // Check if new visible/scroll-trigger messages arrived
      const newVisible = countVisible - prevVisibleCountRef.current;
      prevVisibleCountRef.current = countVisible;
      const newScrollTrigger = countScroll - prevScrollTriggerCountRef.current;
      prevScrollTriggerCountRef.current = countScroll;

      // Bug fix: Double-check scroll position from DOM directly (not just ref).
      const container = refs.messagesContainerRef.current;
      if (container) {
        const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceFromBottom > CHAT_CONFIG.AUTO_SCROLL_THRESHOLD) {
          isNearBottomRef.current = false;
        }
      }

      if (!isNearBottomRef.current) {
        // User is scrolled up — don't auto-scroll, only count human-visible messages for badge
        if (newVisible > 0) {
          actions.setNewMessageCount(prev => prev + newVisible);
        }
        return;
      }

      // Auto-scroll when near bottom on human-visible OR thinking messages.
      // tool_call/tool_result still excluded to avoid scroll jumping during tool execution.
      if (newScrollTrigger <= 0) return;

      setTimeout(() => {
        refs.messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' as ScrollBehavior });
      }, 50);
    }
  }, [
    context.messages,
    queries.displayMessages,
    queries.aiConversationMessages,
    refs.messagesEndRef,
    refs.isLoadingOlderRef,
  ]);

  /**
   * Effect #20 — Keep pagination refs in sync (lines 1424–1440)
   * Updates hasMoreRef and loadOlderRef based on chat type.
   * Avoids stale closures in the IntersectionObserver callback.
   */
  useEffect(() => {
    const isUserOrGroup =
      state.chatPartner?.type === 'user' || state.chatPartner?.type === 'group';
    const isAgent = state.chatPartner?.type === 'agent';
    if (isUserOrGroup) {
      hasMoreRef.current = !!queries.hasOlderMessages;
      loadOlderRef.current = () => queries.fetchOlderMessages();
    } else if (isAgent) {
      hasMoreRef.current = !!queries.hasNextAIPage;
      loadOlderRef.current = () => queries.fetchNextAIPage();
    } else {
      hasMoreRef.current = false;
      loadOlderRef.current = () => {};
    }
  }, [
    state.chatPartner?.type,
    queries.hasOlderMessages,
    queries.fetchOlderMessages,
    queries.hasNextAIPage,
    queries.fetchNextAIPage,
  ]);

  /**
   * Effect #21 — IntersectionObserver for infinite scroll (lines 1445–1485)
   * Loads older messages when the sentinel element at the top becomes visible.
   * Preserves scroll position after prepending older messages.
   */
  useEffect(() => {
    const sentinel = refs.loadMoreSentinelRef.current;
    const container = refs.messagesContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (
          entry?.isIntersecting &&
          !refs.isLoadingOlderRef.current &&
          hasMoreRef.current
        ) {
          // Mark the mutable ref (isLoadingOlderRef is a RefObject wrapping a mutable boolean)
          (refs.isLoadingOlderRef as { current: boolean }).current = true;

          const prevScrollHeight = container.scrollHeight;
          const prevScrollTop = container.scrollTop;

          Promise.resolve(loadOlderRef.current()).finally(() => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const newScrollHeight = container.scrollHeight;
                const addedHeight = newScrollHeight - prevScrollHeight;
                container.scrollTop = prevScrollTop + addedHeight;
                (refs.isLoadingOlderRef as { current: boolean }).current = false;
              });
            });
          });
        }
      },
      {
        root: container,
        rootMargin: '800px 0px 0px 0px',
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries.displayMessages.length > 0]);
}
