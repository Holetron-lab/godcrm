/** All hook wiring for AIChatPanel — extracted to keep the render shell slim. */
import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useAIChat } from '../../../context/AIChatContext';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useCurrentSpace, useSpacesStore } from '@/features/spaces/store/spacesStore';
import type { ContextSettings } from '../types';
import type { MentionUser } from '../../MentionInput';
import type { ChatMessage } from '../../../types';
import { useChatState } from './useChatState';
import { useDataQueries } from './useDataQueries';
import { useChatMutations } from './useChatMutations';
import { useResizeHandlers } from './useResizeHandlers';
import { useDataSourceConfig } from './useDataSourceConfig';
import { useSyncEffects } from './useSyncEffects';
import { useScrollManagement } from './useScrollManagement';
import { useEventHandlers } from './useEventHandlers';
import { useVoiceInput } from '../../../hooks/useVoiceInput';
import { useConversationMessages } from '../../../hooks/useConversationMessages';
import { useConversationSSE } from '../../../hooks/useConversationSSE';
import { useInflightAgents, FEATURE_MULTI_AGENT_PRESENCE_V2 } from '../../../hooks/useInflightAgents';
import { CHAT_CONFIG } from '../../../constants/chatConfig';
import { usePanelContentWiring } from './usePanelContentWiring';
import { useScheduledMessages } from './useScheduledMessages';
import { PILL_INSERT_EVENT } from '../../InvocationPills';

// spaces.settings can arrive as a JSON string (API refetch) or an object
// (optimistic store update) — normalize both to a plain object. (ADR-185)
function parseSpaceSettings(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch { return {}; } }
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
}

export function useAIChatPanelLogic(opts?: { fillContainer?: boolean }) {
  const ctx = useAIChat();
  const {
    isOpen, closeChat, currentAgent, agents, messages, isLoading, isLoadingAgents,
    error, selectAgent, sendMessage, clearMessages, loadAgents,
    conversations, currentConversationId, setCurrentConversationId, loadConversations, selectConversation,
    createNewConversation, deleteConversation, isLoadingConversations,
    spaceId: contextSpaceId, pendingTaskChat, openTaskChat, clearPendingTaskChat,
    rowFilter, clearRowFilter,
    isAgentProcessing, setIsAgentProcessing, processingAgentName, processingStartedAt,
    setProcessingAgentName, setProcessingStartedAt, dismissProcessing, resetProcessing, stopAgent,
    historyAgentFilter, setHistoryAgentFilter, renameConversation,
  } = ctx;

  const { state: chatState, actions: chatActions } = useChatState({ fillContainer: opts?.fillContainer });
  const {
    activePanel, chatMode, chatPartner, inputValue, attachments, previewFile, dragOver,
    mentionedUsers, boundRows, messageBoundRows, chatParticipants, tasksSource, filesSource, favoritesConfig,
    showFilePicker, attachTab, panelHeight, panelMode, isResizing, panelWidth, favoriteWidth, isResizingWidth, isGlued,
    sidebarWidth, isResizingSidebar, isMobile, mobileKeyboardHeight, processingElapsed,
    markdownEnabled, agentMode, thinkingEnabled, settingsTab, localError, showTerminal,
    terminalFocusSessionId, contactsSearch, agentsSearch, historySearch, filesSearch,
    tasksSearch, userTypeFilter, showFavorites, favorites, showRowBinding, showBoundRowsBar,
    showMessageRowPicker, expandedTaskChats, showAllContacts, chatOperatorId, chatModelId,
    chatSystemPrompt, isSavingAgentSettings, sortOption, editingAgentId,
    defaultAgentId, isSavingDefaultAgent, favoriteAgents, showFavoriteAgents, expandedAgentId,
    isVectorSearching, vectorSearchResults, agentChats, quickEmojis, isSavingEmojis,
    messageReactions, voiceMode, showScrollToBottom, newMessageCount, agentWorking,
    userConversationId, replyTo,
  } = chatState;

  const {
    setActivePanel, setChatMode, setChatPartner, setInputValue, setAttachments, setPreviewFile,
    setDragOver, setMentionedUsers, setBoundRows, setMessageBoundRows, setChatParticipants,
    setTasksSource, setFilesSource, setFavoritesConfig, setShowFilePicker, setAttachTab, setPanelHeight, setPanelMode,
    setIsResizing, setPanelWidth, setFavoriteWidth, setIsResizingWidth, setIsGlued, setSidebarWidth, setIsResizingSidebar,
    setProcessingElapsed, setMarkdownEnabled, setAgentMode, setThinkingEnabled, setSettingsTab,
    setLocalError, setShowTerminal, setTerminalFocusSessionId, setContactsSearch, setAgentsSearch,
    setHistorySearch, setFilesSearch, setTasksSearch, setUserTypeFilter, setShowFavorites,
    setFavorites, setShowRowBinding, setShowBoundRowsBar, setShowMessageRowPicker,
    setExpandedTaskChats, setShowAllContacts, setChatOperatorId, setChatModelId, setChatSystemPrompt,
    setIsSavingAgentSettings, setSortOption, setEditingAgentId, setDefaultAgentId,
    setIsSavingDefaultAgent, setFavoriteAgents, setShowFavoriteAgents, setExpandedAgentId,
    setIsVectorSearching, setVectorSearchResults, setAgentChats, setQuickEmojis, setIsSavingEmojis,
    setMessageReactions, setVoiceMode, setShowScrollToBottom, setNewMessageCount, setAgentWorking,
    setUserConversationId, setReplyTo, inboxSortBy, setInboxSortBy, inboxSortDir, setInboxSortDir, inboxUnreadOnly, setInboxUnreadOnly,
    inboxUserFilter, setInboxUserFilter,
    inboxParticipantMode, setInboxParticipantMode,
  } = chatActions;

  const currentUser = useAuthStore((state) => state.user);
  const isAdminOrOwner = currentUser?.role === 'admin' || currentUser?.role === 'owner';
  const currentSpace = useCurrentSpace();
  const effectiveSpaceId = contextSpaceId ?? currentSpace?.id;
  // Bind agent settings to the panel's EFFECTIVE space (contextSpaceId), not the
  // global currentSpace. In a Direct/DM panel currentSpace is null while the panel
  // is still space-scoped — reading currentSpace silently no-op'd both hydrate and
  // save, so the agent dropdowns showed "— Не выбран —" and selects never persisted
  // (no PUT fired). Subscribe to whichever space actually owns the settings. (ADR-185)
  const effectiveSpace = useSpacesStore(state => {
    const sid = contextSpaceId ?? state.currentSpace?.id;
    if (sid == null) return null;
    return state.currentSpace?.id === sid ? state.currentSpace : (state.spaces.find(s => s.id === sid) ?? null);
  });
  const isWideMode = !isMobile && panelWidth >= 600;
  const conversationMode = chatPartner?.type === 'agent' ? 'solo' as const : chatPartner?.type === 'group' ? 'group' as const : chatPartner?.type === 'user' ? 'solo' as const : null;

  const queryClient = useQueryClient();

  const [inboxSearch, setInboxSearch] = useState('');
  const [inboxAgentFilter, setInboxAgentFilter] = useState<string>('');
  const [inboxTypeFilter, setInboxTypeFilter] = useState<'all' | 'ai' | 'group' | 'direct' | 'service'>('all');
  const [inboxDateFrom, setInboxDateFrom] = useState<string>('');
  const [inboxDateTo, setInboxDateTo] = useState<string>('');
  const [showInboxFilters, setShowInboxFilters] = useState(false);
  const [forwardMessage, setForwardMessage] = useState<ChatMessage | null>(null);
  const [forwardMessages, setForwardMessages] = useState<ChatMessage[]>([]);
  // ADR-0031 WP-24 FE follow-up (rev 2): move queue mirrors forward queue.
  // User accumulates chips (in source chat), then navigates to a different
  // chat via the inbox panel and sends — chips become quoted blocks (just
  // like forward), originals get marked moved by backend (planned).
  const [moveMessages, setMoveMessages] = useState<ChatMessage[]>([]);
  // quoteMessage removed — continue now uses forwardMessages mechanism
  const [showSummaryCarousel, setShowSummaryCarousel] = useState(false);
  const [chatSearchActive, setChatSearchActive] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchCurrentMatch, setChatSearchCurrentMatch] = useState(0);
  const [selectModeActive, setSelectModeActive] = useState(false);
  const [scheduledActive, setScheduledActive] = useState(false);
  const [summaryAgentId, setSummaryAgentId] = useState<number | null>(null);
  const [isSavingSummaryAgent, setIsSavingSummaryAgent] = useState(false);
  // ADR-185 — dedicated translation agent, distinct from the default (auto-respond)
  // agent. Persisted space-wide in spaces.settings.translation_agent_id.
  const [translationAgentId, setTranslationAgentId] = useState<number | null>(null);
  const [isSavingTranslationAgent, setIsSavingTranslationAgent] = useState(false);

  const [contextSettings, setContextSettings] = useState<ContextSettings | string | undefined | null>(
    currentAgent ? (currentAgent as unknown as Record<string, unknown>).context_settings as ContextSettings | string | undefined : undefined
  );
  const [isSavingContextSettings, setIsSavingContextSettings] = useState(false);

  // Save summary agent to conversation settings
  const saveSummaryAgent = useCallback(async (agentId: number | null) => {
    const convId = currentConversationId ?? userConversationId;
    if (!convId) return;
    setIsSavingSummaryAgent(true);
    try {
      await apiClient.patch(`/chat/conversations/${convId}/settings`, {
        summary_agent_id: agentId,
      });
      setSummaryAgentId(agentId);
    } catch (err) {
      logger.error('Failed to save summary agent:', err);
    } finally {
      setIsSavingSummaryAgent(false);
    }
  }, [currentConversationId, userConversationId]);

  // Save translation agent to SPACE settings (space-wide, like the default agent —
  // the backend translator resolves spaces.settings.translation_agent_id).
  const saveTranslationAgent = useCallback(async (agentId: number | null) => {
    // Read fresh store state at click time — resolve the effective space even when
    // the global currentSpace is null (DM panel), keyed by contextSpaceId. (ADR-185)
    const store = useSpacesStore.getState();
    const sid = contextSpaceId ?? store.currentSpace?.id;
    if (sid == null) return;
    setIsSavingTranslationAgent(true);
    try {
      const space = store.currentSpace?.id === sid ? store.currentSpace : store.getSpaceById(sid);
      const newSettings = { ...parseSpaceSettings(space?.settings), translation_agent_id: agentId };
      await apiClient.put(`/spaces/${sid}`, { settings: newSettings });
      setTranslationAgentId(agentId);
      if (store.currentSpace?.id === sid) store.setCurrentSpace({ ...store.currentSpace, settings: newSettings });
      store.updateSpace(sid, { settings: newSettings });
    } catch (err) {
      logger.error('Failed to save translation agent:', err);
    } finally {
      setIsSavingTranslationAgent(false);
    }
  }, [contextSpaceId]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const forceNewChatRef = useRef(false);

  const dataQueries = useDataQueries({
    activePanel, effectiveSpaceId, showAllContacts, tasksSource, tasksSearch,
    filesSource, showFilePicker, chatOperatorId,
    currentAgentOperatorId: currentAgent?.operator_id,
    currentAgentProviderId: currentAgent?.provider_id,
    contextSpaceId, inboxSearch, inboxAgentFilter, inboxUserFilter, inboxParticipantMode, inboxDateFrom, inboxDateTo,
    inboxSortBy, inboxSortDir, inboxUnreadOnly,
    isWideMode,
  });
  const {
    users, isLoadingUsers, totalUnreadCount, refetchUnread,
    inboxConversations, isLoadingInbox, refetchInbox,
    fetchNextInboxPage, hasNextInboxPage, isFetchingNextInboxPage,
    taskRows, tasksTotal, filteredTaskRows, isLoadingTasks, taskStatusDict, tasksTableColumns,
    fetchNextTasksPage, hasNextTasksPage, isFetchingNextTasksPage,
    projectFiles, isLoadingFiles, operators, models,
    usersForMentions, aiAgentsData, allTablesDataMain,
  } = dataQueries;

  // Wire up data source config persistence (loads from backend on space change, saves on update)
  const { updateTasksSource, updateFilesSource, updateFavoritesConfig } = useDataSourceConfig({
    effectiveSpaceId,
    currentSpace: currentSpace as any,
    allTablesDataMain,
    setTasksSource,
    setFilesSource,
    setFavoritesConfig,
    setDefaultAgentId,
    setQuickEmojis,
  });

  const {
    messages: userConversationMessages, conversation: userConversationData,
    hasNextPage: hasOlderMessages, fetchNextPage: fetchOlderMessages,
    isFetchingNextPage: isFetchingOlderMessages, refetch: refetchUserMessages,
    markAsRead, pollingError: userPollingError, pollingStopped: userPollingStopped,
    reconnect: userReconnect, isLoading: isLoadingUserMessages,
    activeAgents: userActiveAgents,
    fetchThinkingSteps: userFetchThinkingSteps, fetchToolStepsPreview: userFetchToolStepsPreview,
    fetchFullMessage: userFetchFullMessage, fetchToolSteps: userFetchToolSteps,
  } = useConversationMessages(userConversationId, {
    pageSize: CHAT_CONFIG.MESSAGE_PAGE_SIZE,
    enabled: !!userConversationId && (chatPartner?.type === 'user' || chatPartner?.type === 'group'),
    adaptivePolling: true, chatActivityState: 'active',
    currentUserId: currentUser?.id ? Number(currentUser.id) : undefined,
  });

  const {
    messages: aiConversationMessages, conversation: aiConversationData,
    fetchNextPage: fetchNextAIPage, hasNextPage: hasNextAIPage,
    isFetchingNextPage: isFetchingNextAIPage, isLoading: isLoadingAIMessages,
    pollingError: aiPollingError, pollingStopped: aiPollingStopped,
    reconnect: aiReconnect,
    isProcessing: aiBackendProcessing,
    processingAgentName: aiBackendProcessingAgentName,
    activeAgents: aiActiveAgents,
    fetchThinkingSteps: aiFetchThinkingSteps, fetchToolStepsPreview: aiFetchToolStepsPreview,
    fetchFullMessage: aiFetchFullMessage, fetchToolSteps: aiFetchToolSteps,
    refetch: refetchAIMessages,
    sendMessage: aiSendMessage, isSending: aiIsSending,
  } = useConversationMessages(currentConversationId, {
    pageSize: CHAT_CONFIG.MESSAGE_PAGE_SIZE,
    enabled: !!currentConversationId && chatPartner?.type === 'agent',
    adaptivePolling: true,
    chatActivityState: isAgentProcessing ? 'agent_processing' : 'active',
    currentUserId: currentUser?.id ? Number(currentUser.id) : undefined,
  });

  // ADR-0057-A WP-C — `useInflightAgents` MUST be declared before `useConversationSSE`
  // so its `handleInflightEvent` callback can be passed as `onInflight` (SSE keeps
  // a ref to the callback so identity churn across renders is harmless). The
  // hook's `sseConnected` input is fed from a tracked state below — one-frame
  // lag of `isStale` is acceptable for an indicator.
  const [sseConnectedTracked, setSseConnectedTracked] = useState(false);
  const inflightAgentsHook = useInflightAgents({
    conversationId: chatPartner?.type === 'agent' ? currentConversationId : null,
    seedAgents: aiActiveAgents,
    sseConnected: sseConnectedTracked,
  });

  const {
    isConnected: sseConnected,
    isProcessing: sseIsProcessing,
    processingAgentName: sseProcessingAgentName,
  } = useConversationSSE(currentConversationId, {
    enabled: !!currentConversationId && chatPartner?.type === 'agent',
    onStatusChange: (status) => {
      if (status.is_processing && !isAgentProcessing) {
        setIsAgentProcessing(true);
        if (status.processing_agent_name) {
          setProcessingAgentName(status.processing_agent_name);
        }
      } else if (!status.is_processing && isAgentProcessing) {
        setIsAgentProcessing(false);
      }
    },
    // Only register the inflight callback when the flag is on — otherwise SSE
    // events are still received by the EventSource but the listener stays
    // unbound, preserving the WP-A snapshot-only no-regression contract.
    onInflight: FEATURE_MULTI_AGENT_PRESENCE_V2 ? inflightAgentsHook.handleInflightEvent : undefined,
  });

  // Mirror SSE `isConnected` into a state so `useInflightAgents` can derive
  // `isStale`. Setting state from an effect re-renders us with the updated
  // value next frame — the hook is conversation-scoped so consistency across
  // frames is fine.
  useEffect(() => {
    setSseConnectedTracked(sseConnected);
  }, [sseConnected]);

  // Reset infinite query cache before paint when panel reopens or conversation changes
  const prevIsOpenForResetRef = useRef(isOpen);
  const prevResetConvIdRef = useRef(currentConversationId);
  const prevResetUserConvIdRef = useRef(userConversationId);
  useLayoutEffect(() => {
    const panelJustOpened = isOpen && !prevIsOpenForResetRef.current;
    const convChanged = currentConversationId !== prevResetConvIdRef.current;
    const userConvChanged = userConversationId !== prevResetUserConvIdRef.current;
    prevIsOpenForResetRef.current = isOpen;
    prevResetConvIdRef.current = currentConversationId;
    prevResetUserConvIdRef.current = userConversationId;

    if (panelJustOpened || convChanged || userConvChanged) {
      const trimToFirstPage = (queryKey: unknown[]) => {
        queryClient.setQueryData(queryKey, (old: any) => {
          if (!old?.pages?.length || old.pages.length <= 1) return old;
          return {
            ...old,
            pages: [old.pages[0]],
            pageParams: [old.pageParams[0]],
          };
        });
      };
      if (currentConversationId) {
        trimToFirstPage(['conversation-messages', currentConversationId]);
      }
      if (userConversationId) {
        trimToFirstPage(['conversation-messages', userConversationId]);
      }
    }
  }, [isOpen, currentConversationId, userConversationId, queryClient]);

  // Bidirectional sync: backend is_processing → context isAgentProcessing
  useEffect(() => {
    if (chatPartner?.type !== 'agent') return;
    const backendProcessing = sseConnected ? sseIsProcessing : aiBackendProcessing;
    const agentName = sseConnected ? sseProcessingAgentName : aiBackendProcessingAgentName;
    if (backendProcessing && !isAgentProcessing) {
      setIsAgentProcessing(true);
      if (agentName) {
        setProcessingAgentName(agentName);
      }
    } else if (!backendProcessing && isAgentProcessing) {
      setIsAgentProcessing(false);
    }
  }, [aiBackendProcessing, aiBackendProcessingAgentName, sseIsProcessing, sseProcessingAgentName, sseConnected, chatPartner?.type]); // eslint-disable-line react-hooks/exhaustive-deps

  const activePollingError = chatPartner?.type === 'agent' ? aiPollingError : userPollingError;
  const activePollingStopped = chatPartner?.type === 'agent' ? aiPollingStopped : userPollingStopped;
  const activeReconnect = chatPartner?.type === 'agent' ? aiReconnect : userReconnect;
  // ADR-0057-A WP-A → WP-C — surface per-conversation active_agents to
  // MessagesArea for the multi-agent badge row. Empty array when backend
  // returns nothing (legacy chats / single-agent path); MessagesArea falls
  // back to the existing ProcessingStatusBar in that case.
  //
  // WP-C: for agent chats the projection routes through `useInflightAgents`
  // (merged seed ∪ SSE deltas, last-event-wins per slug). When the feature
  // flag is OFF the hook is a pass-through over `aiActiveAgents` — same
  // shape as WP-A — so legacy callers keep working byte-identical.
  const activeAgents = chatPartner?.type === 'agent'
    ? inflightAgentsHook.agents
    : (userActiveAgents || []);

  // WP-17: Scheduled messages
  const activeConvId = currentConversationId ?? userConversationId;
  const scheduled = useScheduledMessages(activeConvId);

  const mutations = useChatMutations({
    effectiveSpaceId,
    currentAgent, chatOperatorId, chatModelId, chatSystemPrompt,
    setIsSavingAgentSettings, setContextSettings,
    setDefaultAgentId, setIsSavingDefaultAgent,
    setQuickEmojis, setIsSavingEmojis,
    setMessageReactions: setMessageReactions as any,
    loadAgents, refetchUserMessages,
  });

  const resize = useResizeHandlers({
    panelHeight, panelWidth, favoriteWidth, sidebarWidth, panelMode, isGlued, isOpen,
    setPanelHeight: setPanelHeight as any, setPanelMode: setPanelMode as any,
    setIsResizing, setPanelWidth: setPanelWidth as any,
    setFavoriteWidth: setFavoriteWidth as any, setIsResizingWidth,
    setIsGlued, setSidebarWidth: setSidebarWidth as any, setIsResizingSidebar,
    activePanel, setActivePanel,
  });

  const {
    isRecording, isProcessing: isTranscribing, error: voiceError,
    duration: recordingDuration, startRecording, stopRecording, cancelRecording,
    webSpeechAvailable,
  } = useVoiceInput({
    mode: voiceMode, language: 'ru-RU', spaceId: currentSpace?.id,
    onResult: (text) => { setInputValue(prev => { const sep = prev.trim() ? ' ' : ''; return prev + sep + text; }); },
    onError: (error) => { logger.error('[Voice Input] Error:', error); },
  });

  // ADR-078: React Query is the single source of truth for messages.
  const displayMessages = useMemo(() => {
    if (chatPartner?.type === 'user' || chatPartner?.type === 'group') return (userConversationMessages || []) as ChatMessage[];
    if (chatPartner?.type === 'agent') return (aiConversationMessages || []) as ChatMessage[];
    return messages || [];
  }, [chatPartner?.type, userConversationMessages, aiConversationMessages, messages]);

  const availableMentionUsers: MentionUser[] = useMemo(() => {
    // Agent-managed users carry no avatar of their own — they inherit the icon
    // (emoji) and accent color from their AI Agent row. Build a lookup so the
    // @-mention dropdown shows each agent's identity instead of a generic robot.
    // Match by managed_by_agent_row_id (=== agent.id); fall back to name.
    const byId = new Map<number, { icon?: string; color?: string; description?: string }>();
    const byName = new Map<string, { icon?: string; color?: string; description?: string }>();
    for (const a of agents || []) {
      if (!a?.icon && !a?.color && !a?.description) continue;
      const info = { icon: a.icon, color: a.color, description: a.description };
      byId.set(a.id, info);
      if (a.name) byName.set(a.name.trim().toLowerCase(), info);
    }
    return (usersForMentions || []).map(user => {
      const isBot = !!user.managed_by_agent_table_id;
      const agentInfo = isBot
        ? (user.managed_by_agent_row_id != null ? byId.get(user.managed_by_agent_row_id) : undefined)
          ?? byName.get((user.name || '').trim().toLowerCase())
        : undefined;
      return {
        id: user.id, name: user.name, email: user.email, avatar: user.avatar_url,
        icon: agentInfo?.icon,
        color: agentInfo?.color,
        description: agentInfo?.description,
        type: isBot ? 'bot' as const : 'human' as const,
      };
    });
  }, [usersForMentions, agents]);

  const availableSlashAgents: MentionUser[] = useMemo(() => {
    return (aiAgentsData?.data?.agents || [])
      .filter(agent => agent.status !== 'inactive' && agent.name)
      .map(agent => ({ id: agent.id, name: agent.name, icon: agent.icon, email: agent.description, description: agent.description, type: 'agent' as const }));
  }, [aiAgentsData]);

  const resolvedConvTitle = useMemo(() => {
    const convId = currentConversationId || userConversationId;
    if (!convId) return null;
    const conv = conversations.find(c => c.id === convId);
    if (conv?.title) return conv.title;
    const inboxConv = inboxConversations?.find(c => c.id === convId);
    if (inboxConv?.title) return inboxConv.title;
    return null;
  }, [currentConversationId, userConversationId, conversations, inboxConversations]);

  const hasSlashCommand = useMemo(() => /(^|\s)\/[a-z][a-z0-9_-]*(\s|$)/i.test(inputValue), [inputValue]);

  useSyncEffects({
    currentAgent, setChatOperatorId, setChatModelId, setChatSystemPrompt,
    aiBackendProcessing, isAgentProcessing, setIsAgentProcessing, dismissProcessing,
    aiBackendProcessingAgentName, setProcessingAgentName,
    userConversationId, userConversationData, markAsRead, refetchUnread,
    isOpen, agents, defaultAgentId, selectAgent, loadAgents, loadConversations,
    isMobile, chatPartner: chatPartner as any, setChatPartner: setChatPartner as any,
    setUserConversationId,
    pendingTaskChat, clearPendingTaskChat, setChatMode, setBoundRows: setBoundRows as any,
    setShowBoundRowsBar, setActivePanel: setActivePanel as any,
    aiConversationData, currentConversationId: currentConversationId ?? null,
    setChatParticipants: setChatParticipants as any,
    userParticipantsCount: chatParticipants.length,
    aiParticipantsCount: 0,
    processingStartedAt, setProcessingElapsed,
  });

  // Extra effects not in useSyncEffects
  useEffect(() => {
    setContextSettings(currentAgent ? (currentAgent as unknown as Record<string, unknown>).context_settings as ContextSettings | string | undefined : undefined);
  }, [currentAgent]);

  useEffect(() => {
    // Hydrate the agent dropdowns from the EFFECTIVE space's settings (see
    // effectiveSpace above), parsing string-or-object. The old code read
    // currentSpace — null in DM panels — so both dropdowns reset to
    // "— Не выбран —" even when the space had agents saved. (ADR-185)
    const s = parseSpaceSettings(effectiveSpace?.settings);
    setDefaultAgentId(s.default_agent_id ? Number(s.default_agent_id) : null);
    setTranslationAgentId(s.translation_agent_id ? Number(s.translation_agent_id) : null);
    setQuickEmojis(Array.isArray(s.quick_emojis) ? s.quick_emojis as string[] : ['👍','❤️','😂','🔥','💯','🙏','😍','😮']);
  }, [effectiveSpace?.id, effectiveSpace?.settings]);

  // Auto-map summary agent by name "Summary" when agents load
  useEffect(() => {
    if (agents.length > 0 && !summaryAgentId) {
      const summaryAgent = agents.find(a => a.name.toLowerCase().includes('summary'));
      if (summaryAgent) setSummaryAgentId(summaryAgent.id);
    }
  }, [agents, summaryAgentId]);

  // ADR-129 WP-2: Auto-open inbox when panel opens without active conversation.
  // Gated on !pendingTaskChat — opening a chat from docs/tasks calls closePanel()
  // (activePanel='none') and openTaskChat() in the same React batch; chatPartner
  // is set asynchronously by useSyncEffects after pendingTaskChat lands. Without
  // the guard, this effect would re-pop inbox in between.
  useEffect(() => {
    if (isOpen && activePanel === 'none' && !chatPartner && !pendingTaskChat) {
      setActivePanel('inbox');
    } else if (isOpen && activePanel === 'none') {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen, activePanel, chatPartner, pendingTaskChat]);

  // Navigate to message from forwarded quote links
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.chatId) return;
      const chatId = Number(detail.chatId);
      if (!chatId || isNaN(chatId)) return;
      const messageId = detail.messageId ? String(detail.messageId) : null;

      const isSameChat = currentConversationId && chatId === Number(currentConversationId);
      if (isSameChat && messageId) {
        // Same chat — scroll to message
        const el = document.querySelector(`[data-message-id="${messageId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('ring-2', 'ring-[var(--color-primary-500)]', 'ring-opacity-50');
          setTimeout(() => el.classList.remove('ring-2', 'ring-[var(--color-primary-500)]', 'ring-opacity-50'), 2000);
        }
      } else {
        // Different chat — switch conversation, then try scrolling after load
        selectConversation(chatId);
        if (messageId) {
          setTimeout(() => {
            const el = document.querySelector(`[data-message-id="${messageId}"]`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.classList.add('ring-2', 'ring-[var(--color-primary-500)]', 'ring-opacity-50');
              setTimeout(() => el.classList.remove('ring-2', 'ring-[var(--color-primary-500)]', 'ring-opacity-50'), 2000);
            }
          }, 500);
        }
      }
    };
    window.addEventListener('navigate-to-chat-message', handler);
    return () => window.removeEventListener('navigate-to-chat-message', handler);
  }, [selectConversation, currentConversationId]);

  const { scrollToBottom } = useScrollManagement({
    displayMessages, aiConversationMessages,
    currentConversationId: currentConversationId ?? null,
    userConversationId, chatPartnerId: chatPartner?.id,
    chatPartnerType: chatPartner?.type,
    hasOlderMessages, fetchOlderMessages,
    hasNextAIPage, fetchNextAIPage,
    isFetchingOlderMessages: !!isFetchingOlderMessages,
    isFetchingNextAIPage: !!isFetchingNextAIPage,
    isAgentProcessing,
    isOpen,
    messagesEndRef, messagesContainerRef, loadMoreSentinelRef,
    setShowScrollToBottom, setNewMessageCount: setNewMessageCount as any,
    setAgentWorking, fetchReactionsForMessages: mutations.fetchReactionsForMessages,
  });

  const events = useEventHandlers({
    inputValue, setInputValue: setInputValue as any,
    attachments, setAttachments: setAttachments as any,
    mentionedUsers: mentionedUsers as any, setMentionedUsers: setMentionedUsers as any,
    messageBoundRows: messageBoundRows as any, setMessageBoundRows: setMessageBoundRows as any,
    boundRows: boundRows as any,
    setLocalError, setDragOver, chatPartner: chatPartner as any, currentAgent,
    agentMode, thinkingEnabled,
    userConversationId, setUserConversationId,
    currentSpaceId: currentSpace?.id, effectiveSpaceId,
    availableMentionUsers, availableSlashAgents,
    sendMessage, selectAgent,
    aiSendMessage,
    sendUserMessageMutation: mutations.sendUserMessageMutation,
    setChatMode, setChatPartner: setChatPartner as any, setChatParticipants: setChatParticipants as any,
    setBoundRows: setBoundRows as any, setShowBoundRowsBar, setActivePanel: setActivePanel as any,
    setVectorSearchResults, scrollToBottom,
    currentConversationId: currentConversationId ?? null,
    setCurrentConversationId,
    labId: ctx.labId || null,
    setIsAgentProcessing,
    loadConversations,
    forwardMessages,
    setForwardMessages,
    moveMessages,
    setMoveMessages,
    setQuoteMessage: undefined,
    replyTo,
    setReplyTo,
  });

  const { pendingMessageRow, clearPendingMessageRow, pendingBoundRow, clearPendingBoundRow } = ctx;
  useEffect(() => {
    if (pendingMessageRow) {
      setMessageBoundRows((prev: any[]) => {
        if (prev.some((r: any) => r.table_id === pendingMessageRow.table_id && r.row_id === pendingMessageRow.row_id)) return prev;
        return [...prev, pendingMessageRow];
      });
      clearPendingMessageRow();
    }
  }, [pendingMessageRow, clearPendingMessageRow, setMessageBoundRows]);

  useEffect(() => {
    if (pendingBoundRow) {
      setBoundRows([pendingBoundRow] as any);
      setShowBoundRowsBar(true);
      const cid = currentConversationId || userConversationId;
      if (cid) {
        apiClient.patch(`/chat/conversations/${cid}`, { bound_table_id: pendingBoundRow.table_id, bound_row_id: pendingBoundRow.row_id })
          .then(() => logger.info('[AIChatPanel] Pending bound row saved for conv', cid))
          .catch(err => logger.warn('[AIChatPanel] Failed to persist pending bound row:', err));
      } else {
        logger.warn('[AIChatPanel] No conversation ID — pending bound row not saved to backend');
      }
      clearPendingBoundRow();
    }
  }, [pendingBoundRow, clearPendingBoundRow, setBoundRows, setShowBoundRowsBar, currentConversationId, userConversationId]);

  const searchMatchIds = useMemo(() => {
    if (!chatSearchQuery || !chatSearchActive) return [];
    const q = chatSearchQuery.toLowerCase();
    const ids: number[] = [];
    displayMessages.forEach((msg: ChatMessage) => {
      const text = (msg.content || msg.text || '').toLowerCase();
      if (text.includes(q) && msg.id) ids.push(msg.id);
    });
    return ids;
  }, [chatSearchQuery, chatSearchActive, displayMessages]);

  const handleSearchNext = useCallback(() => {
    if (searchMatchIds.length === 0) return;
    setChatSearchCurrentMatch(prev => (prev + 1) % searchMatchIds.length);
  }, [searchMatchIds.length]);

  const handleSearchPrev = useCallback(() => {
    if (searchMatchIds.length === 0) return;
    setChatSearchCurrentMatch(prev => (prev - 1 + searchMatchIds.length) % searchMatchIds.length);
  }, [searchMatchIds.length]);

  // Scroll to current search match
  useEffect(() => {
    if (searchMatchIds.length === 0 || !messagesContainerRef.current) return;
    const msgId = searchMatchIds[chatSearchCurrentMatch];
    const msgEl = messagesContainerRef.current.querySelector(`[data-message-id="${msgId}"]`);
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.add('search-highlight');
      setTimeout(() => msgEl.classList.remove('search-highlight'), 2000);
    }
  }, [chatSearchCurrentMatch, searchMatchIds]);

  useEffect(() => {
    const handler = (e: Event) => {
      const token = (e as CustomEvent).detail?.token;
      if (token && currentConversationId) {
        e.preventDefault();
        setInputValue((prev: string) => prev ? `${prev} ${token} ` : `${token} `);
      }
    };
    window.addEventListener(PILL_INSERT_EVENT, handler);
    return () => window.removeEventListener(PILL_INSERT_EVENT, handler);
  }, [currentConversationId, setInputValue]);

  // MUST be called before the guard — hooks cannot be after conditional returns
  const { renderPanelContent } = usePanelContentWiring({
    activePanel, setActivePanel, contactsSearch, setContactsSearch,
    showFavorites, setShowFavorites: setShowFavorites as any,
    userTypeFilter, setUserTypeFilter, showAllContacts, setShowAllContacts: setShowAllContacts as any,
    users, isLoadingUsers, chatParticipants: chatParticipants as any,
    chatPartner: chatPartner as any, favorites,
    setFavorites: setFavorites as any,
    setUserConversationId, setChatPartner: setChatPartner as any,
    setChatParticipants: setChatParticipants as any, setBoundRows: setBoundRows as any,
    setShowBoundRowsBar, handleAgentSelect: events.handleAgentSelect,
    selectConversation, openTaskChat, createNewConversation, forceNewChatRef,
    setChatMode, clearMessages,
    agentsSearch, setAgentsSearch, agents, isLoadingAgents, currentAgent,
    showFavoriteAgents, setShowFavoriteAgents, favoriteAgents, setFavoriteAgents,
    isVectorSearching, vectorSearchResults, setVectorSearchResults,
    setIsVectorSearching, currentSpaceId: currentSpace?.id,
    createTablesMutation: mutations.createTablesMutation, currentSpace: currentSpace as any,
    inboxConversations: inboxConversations as any, isLoadingInbox, totalUnreadCount, refetchInbox,
    fetchNextInboxPage, hasNextInboxPage: hasNextInboxPage ?? false, isFetchingNextInboxPage,
    inboxSearch, setInboxSearch, inboxAgentFilter, setInboxAgentFilter,
    inboxTypeFilter, setInboxTypeFilter,
    inboxDateFrom, setInboxDateFrom, inboxDateTo, setInboxDateTo,
    showInboxFilters, setShowInboxFilters,
    inboxSortBy, setInboxSortBy, inboxSortDir, setInboxSortDir,
    inboxUnreadOnly, setInboxUnreadOnly,
    inboxUserFilter, setInboxUserFilter, inboxParticipantMode, setInboxParticipantMode, users,
    markAsReadMutation: mutations.markAsReadMutation, selectAgent, renameConversation, deleteConversation,
    userConversationId, currentConversationId, allTablesDataMain: allTablesDataMain as any,
    tasksSource, filteredTaskRows, isLoadingTasks, taskRows, tasksTotal, taskStatusDict,
    tasksTableColumns, tasksSearch, setTasksSearch, setTasksSource,
    fetchNextTasksPage, hasNextTasksPage, isFetchingNextTasksPage,
    expandedTaskChats, setExpandedTaskChats, conversations: conversations as any, effectiveSpaceId,
    settingsTab, setSettingsTab, chatOperatorId, setChatOperatorId,
    chatModelId, setChatModelId, chatSystemPrompt, setChatSystemPrompt,
    operators, models, isAdminOrOwner, isSavingAgentSettings,
    saveAgentSettings: mutations.saveAgentSettings,
    messages, contextSettings: contextSettings as any, setContextSettings,
    saveContextSettings: mutations.saveContextSettings as any, isSavingContextSettings,
    defaultAgentId, saveDefaultAgent: mutations.saveDefaultAgent, isSavingDefaultAgent,
    summaryAgentId, isSavingSummaryAgent, onSummaryAgentChange: saveSummaryAgent,
    translationAgentId, isSavingTranslationAgent, onTranslationAgentChange: saveTranslationAgent,
    quickEmojis, setQuickEmojis, saveQuickEmojis: mutations.saveQuickEmojis, isSavingEmojis,
    voiceMode, setVoiceMode, voiceError: voiceError || null, webSpeechAvailable,
    filesSource, setFilesSource,
    favoritesConfig, updateFavoritesConfig,
    updateTasksSource, updateFilesSource,
    attachRowToMessage: (br) => setMessageBoundRows((prev: any[]) => {
      if (prev.some((p: any) => p.table_id === br.table_id && p.row_id === br.row_id)) return prev;
      return [...prev, br];
    }),
    isWideMode,
    panelMode, togglePanelMode: resize.togglePanelMode,
  });

  return {
    // Context
    isOpen, closeChat, currentAgent, agents, messages, isLoading, error,
    sendMessage, selectAgent, loadAgents,
    conversations, currentConversationId, deleteConversation,
    renameConversation, stopAgent,
    isAgentProcessing, processingAgentName, processingStartedAt,

    // Chat state
    chatMode, setChatMode, chatPartner, setChatPartner,
    activePanel, setActivePanel,
    inputValue, setInputValue,
    attachments, setAttachments,
    previewFile, setPreviewFile,
    dragOver, setDragOver,
    mentionedUsers, setMentionedUsers,
    boundRows, setBoundRows,
    messageBoundRows, setMessageBoundRows,
    chatParticipants, setChatParticipants,
    // ADR-0031 §Z follow-up: navigation primitives needed by ChatLinkCard click
    selectConversation, setUserConversationId,
    tasksSource, filesSource, favoritesConfig,
    showFilePicker, setShowFilePicker,
    attachTab, setAttachTab,
    panelHeight, panelMode,
    panelWidth, isResizingWidth,
    isGlued,
    sidebarWidth, isResizingSidebar,
    isMobile, mobileKeyboardHeight,
    markdownEnabled, setMarkdownEnabled,
    agentMode, setAgentMode,
    thinkingEnabled, setThinkingEnabled,
    showTerminal, setShowTerminal,
    terminalFocusSessionId, setTerminalFocusSessionId,
    showRowBinding, setShowRowBinding,
    showBoundRowsBar, setShowBoundRowsBar,
    editingAgentId, setEditingAgentId,
    voiceMode,
    showScrollToBottom, setShowScrollToBottom,
    newMessageCount, setNewMessageCount,
    agentWorking, setAgentWorking,
    selectModeActive, setSelectModeActive,
    contactsSearch, setContactsSearch,

    // Computed
    isWideMode, conversationMode, resolvedConvTitle, hasSlashCommand,
    displayMessages, availableMentionUsers, availableSlashAgents,
    searchMatchIds,
    userConversationId,
    effectiveSpaceId,

    // Data queries
    users, totalUnreadCount, refetchInbox,
    taskRows,
    projectFiles, isLoadingFiles,
    filesSearch, setFilesSearch,
    createNewConversation,

    // Messages
    isLoadingAIMessages, isLoadingUserMessages,
    hasOlderMessages: !!hasOlderMessages,
    isFetchingOlderMessages: !!isFetchingOlderMessages,
    hasNextAIPage: !!hasNextAIPage,
    isFetchingNextAIPage: !!isFetchingNextAIPage,
    activePollingError, activePollingStopped, activeReconnect,
    // ADR-0057-A WP-A
    activeAgents,
    localError,

    // Fetch functions
    aiFetchThinkingSteps, aiFetchToolStepsPreview, aiFetchFullMessage, aiFetchToolSteps,
    userFetchThinkingSteps, userFetchToolStepsPreview, userFetchFullMessage, userFetchToolSteps,

    // Voice
    isRecording, isTranscribing, voiceError, recordingDuration,
    startRecording, stopRecording, cancelRecording,

    // Forward
    forwardMessages, setForwardMessages,
    // Move queue (mirrors forward queue, persists across conv navigation)
    moveMessages, setMoveMessages,
    showSummaryCarousel, setShowSummaryCarousel,

    // ADR-0031 WP-24: conversation metadata (exposes created_by for ownership gate)
    aiConversationData, userConversationData,

    // Search
    chatSearchActive, setChatSearchActive,
    chatSearchQuery, setChatSearchQuery,
    chatSearchCurrentMatch, setChatSearchCurrentMatch,
    handleSearchNext, handleSearchPrev,

    // Current user
    currentUser,
    messageReactions, quickEmojis,

    // Mutations & handlers
    mutations, resize, events,

    // Panel content
    renderPanelContent,

    // Refs
    messagesEndRef, messagesContainerRef, loadMoreSentinelRef,
    fileInputRef,

    // Update functions
    updateFilesSource,
    updateFavoritesConfig,

    // WP-17: Scheduled messages
    scheduledActive, setScheduledActive,
    scheduled,
  };
}
