import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useChatSearch } from './useChatSearch';
import { useChatDeepLink } from './useChatDeepLink';
/** All hook wiring for AIChatPanel — extracted to keep the render shell slim. */
import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useAIChat } from '../../../context/AIChatContext';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useCurrentSpace } from '@/features/spaces/store/spacesStore';
import { useSpaceAccessLevelSync, hasPrivilegedAccess } from '@/features/spaces/hooks/useSpaceAccessLevel';
import type { ContextSettings } from '../types';
import type { MentionUser } from '../../MentionInput';
import type { ChatMessage } from '../../../types';
import { useChatState } from './useChatState';
import { useChatAgentSettings } from './useChatAgentSettings';
import { useDataQueries } from './useDataQueries';
import { useChatMutations } from './useChatMutations';
import { useResizeHandlers } from './useResizeHandlers';
import { useDataSourceConfig } from './useDataSourceConfig';
import { useSyncEffects } from './useSyncEffects';
import { useScrollManagement } from './useScrollManagement';
import { useEventHandlers } from './useEventHandlers';
import { usePanelConversationSpace } from './useConversationSpace';
import { useVoiceNote } from '../../../hooks/useVoiceNote';
import { useConversationMessages } from '../../../hooks/useConversationMessages';
import { useConversationSSE } from '../../../hooks/useConversationSSE';
import { useInflightAgents, FEATURE_MULTI_AGENT_PRESENCE_V2 } from '../../../hooks/useInflightAgents';
import { CHAT_CONFIG } from '../../../constants/chatConfig';
import { usePanelContentWiring } from './usePanelContentWiring';
import { useScheduledMessages } from './useScheduledMessages';
import { PILL_INSERT_EVENT } from '../../InvocationPills';

export function useAIChatPanelLogic(opts?: { fillContainer?: boolean }) {
  const { t } = useLanguage();
  const ctx = useAIChat();
  const {
    isOpen, closeChat, currentAgent, agents, mentionAgents, messages, isLoading, isLoadingAgents,
    error, selectAgent, sendMessage, clearMessages, loadAgents,
    conversations, currentConversationId: storedAgentConversationId, setCurrentConversationId, loadConversations, selectConversation: loadConversation,
    createNewConversation, deleteConversation: removeConversation, isLoadingConversations,
    spaceId: contextSpaceId, pendingTaskChat, openTaskChat, clearPendingTaskChat,
    rowFilter, clearRowFilter,
    isAgentProcessing, setIsAgentProcessing, processingAgentName, processingStartedAt,
    setProcessingAgentName, setProcessingStartedAt, dismissProcessing, resetProcessing,
    historyAgentFilter, setHistoryAgentFilter, renameConversation,
  } = ctx;

  const [pendingConversationId, setPendingConversationId] = useState<number | null>(null);
  const selectConversation = useCallback(async (id: number) => {
    setPendingConversationId(id);
    try {
      return await loadConversation(id);
    } finally {
      setPendingConversationId(pending => pending === id ? null : pending);
    }
  }, [loadConversation]);
  const { state: chatState, actions: chatActions, bindDraftToConversation } = useChatState({
    fillContainer: opts?.fillContainer, currentConversationId: storedAgentConversationId, pendingConversationId,
  });
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
    userConversationId: storedUserConversationId, replyTo,
  } = chatState;
  // Retain inactive selections for drafts; expose only the visible chat's ID to all consumers.
  const currentConversationId = chatPartner?.type === 'agent' ? storedAgentConversationId : null;
  const userConversationId = chatPartner?.type === 'user' || chatPartner?.type === 'group' ? storedUserConversationId : null;
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
  const isGlobalAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner';
  const currentSpace = useCurrentSpace();
  const effectiveSpaceId = contextSpaceId ?? currentSpace?.id;
  const { effectiveSpace, summaryAgentId, isSavingSummaryAgent, saveSummaryAgent, translationAgentId, isSavingTranslationAgent, saveTranslationAgent } = useChatAgentSettings({
    currentConversationId, userConversationId, contextSpaceId, agents, setDefaultAgentId, setQuickEmojis,
  });
  // WP-5 (1552/228713, ADR-203 D3): the agent settings in the settings panel are
  // saved with PUT /spaces/:id, which the backend allows to the space owner
  // regardless of global role. Gate the UI the same way — global admin OR
  // privileged in the effective space — instead of the global role alone.
  const effectiveSpaceAccess = useSpaceAccessLevelSync(effectiveSpace);
  const isAdminOrOwner = isGlobalAdmin || hasPrivilegedAccess(effectiveSpaceAccess);
  const isWideMode = !isMobile && panelWidth >= 600;
  const conversationMode = chatPartner?.type === 'agent' ? 'solo' as const : chatPartner?.type === 'group' ? 'group' as const : chatPartner?.type === 'user' ? 'solo' as const : null;

  // The context only clears the agent-chat id on delete; direct/group chats live
  // in userConversationId, so the panel kept polling the deleted chat until the
  // 404s surfaced as "Connection lost". Drop the open chat (and a group partner
  // whose id IS the deleted chat) so the panel switches to a fresh chat instead.
  const deleteConversation = useCallback(async (id: number): Promise<boolean> => {
    const deleted = await removeConversation(id);
    if (deleted && storedUserConversationId === id) {
      setUserConversationId(null);
      if (chatPartner?.type === 'group' && chatPartner.id === id) {
        setChatPartner(null);
        setChatParticipants([]);
      }
    }
    return deleted;
  }, [removeConversation, storedUserConversationId, chatPartner, setUserConversationId, setChatPartner, setChatParticipants]);

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
  const [selectModeActive, setSelectModeActive] = useState(false);
  const [scheduledActive, setScheduledActive] = useState(false);
  const [contextSettings, setContextSettings] = useState<ContextSettings | string | undefined | null>(
    currentAgent ? (currentAgent as unknown as Record<string, unknown>).context_settings as ContextSettings | string | undefined : undefined
  );
  const [isSavingContextSettings, setIsSavingContextSettings] = useState(false);

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

  // ADR-0057-A WP-C: declare useInflightAgents before SSE to supply onInflight.
  // SSE stores the callback in a ref, so callback identity changes are harmless.
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

  // Mirror SSE connectivity for useInflightAgents.isStale; the conversation-scoped
  // indicator tolerates the one-frame delay from this effect.
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
  // ADR-0057-A WP-A → WP-C: per-conversation agents feed MessagesArea badges;
  // an empty array falls back to ProcessingStatusBar for legacy/single-agent chats.
  // useInflightAgents merges the seed and SSE deltas, last event winning per slug.
  // With the flag off it passes aiActiveAgents through unchanged (WP-A contract).
  const activeAgents = chatPartner?.type === 'agent'
    ? inflightAgentsHook.agents
    : (userActiveAgents || []);

  const stopAgent = useCallback(async () => {
    const conversationId = chatPartner?.type === 'agent' ? currentConversationId : userConversationId;
    if (!conversationId) {
      setLocalError(t('aiChat.ui.stopChatUnknown'));
      return;
    }
    try {
      await apiClient.post(`/chat/conversations/${conversationId}/stop`);
      setLocalError(null);
      // Polling refreshes the authoritative processing state after cancellation.
      await (chatPartner?.type === 'agent' ? refetchAIMessages() : refetchUserMessages());
    } catch (err) {
      logger.warn('[AI Chat] Failed to stop agent:', err);
      setLocalError(t('aiChat.ui.stopAgentFailed'));
    }
  }, [chatPartner?.type, currentConversationId, userConversationId, refetchAIMessages, refetchUserMessages, setLocalError, t]);

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
  const conversationId = chatPartner?.type === 'agent' ? currentConversationId ?? null : userConversationId;
  const conversationSpace = usePanelConversationSpace({
    conversationId: pendingConversationId ?? conversationId,
    partnerKey: `${chatPartner?.type}:${chatPartner?.id}`, userId: currentUser?.id ? Number(currentUser.id) : undefined,
    draft: chatPartner ? {
      spaceId: effectiveSpaceId, title: inputValue || t('aiChat.ui.voiceNote'),
      agentId: chatPartner?.type === 'agent' ? currentAgent?.id : undefined,
      participantIds: chatPartner?.type === 'user' ? [chatPartner.id] : (chatPartner?.participants ?? []).map(participant => participant.id),
      labId: ctx.labId, boundRow: boundRows[0],
    } : null,
    attachments, onAttachmentError: setLocalError, onSaved: loadConversations,
    onCreated: id => {
      bindDraftToConversation(id);
      if (chatPartner?.type === 'agent') setCurrentConversationId(id);
      else setUserConversationId(id);
      void loadConversations();
    },
  });
  const voiceNote = useVoiceNote({
    scopeKey: conversationSpace.scopeKey,
    resolveTarget: conversationSpace.resolveTarget,
    assertTargetActive: conversationSpace.assertActive,
    onSent: () => {
      void loadConversations();
      void refetchInbox();
    },
  });
  const {
    isRecording, isProcessing: isTranscribing, error: voiceError,
    duration: recordingDuration, recordingStream, startRecording, stopRecording, cancelRecording,
  } = voiceNote;
  const webSpeechAvailable = false;

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
    // Include inactive/locked agents already present in the user list; metadata
    // must not depend on whether an agent is selectable. Match by row id, then name.
    const byId = new Map<number, { icon?: string; color?: string; description?: string }>();
    const byName = new Map<string, { icon?: string; color?: string; description?: string }>();
    for (const a of mentionAgents || []) {
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
        id: user.id, name: user.name, handle: user.handle, email: user.email, avatar: user.avatar_url,
        icon: agentInfo?.icon || user.agent_icon,
        color: agentInfo?.color || user.color || undefined,
        description: agentInfo?.description || user.description,
        type: isBot ? 'bot' as const : 'human' as const,
      };
    });
  }, [usersForMentions, mentionAgents]);

  const availableSlashAgents: MentionUser[] = useMemo(() => {
    return (aiAgentsData?.data?.agents || [])
      .filter(agent => agent.status !== 'inactive' && agent.name)
      .map(agent => ({ id: agent.id, name: agent.name, icon: agent.icon, email: agent.description, description: agent.description, type: 'agent' as const }));
  }, [aiAgentsData]);

  const resolvedConvTitle = useMemo(() => {
    const convId = pendingConversationId ?? currentConversationId ?? userConversationId;
    if (!convId) return null;
    const conv = conversations.find(c => c.id === convId);
    if (conv?.title) return conv.title;
    const inboxConv = inboxConversations?.find(c => c.id === convId);
    if (inboxConv?.title) return inboxConv.title;
    return null;
  }, [pendingConversationId, currentConversationId, userConversationId, conversations, inboxConversations]);

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
    processingStartedAt, setProcessingElapsed,
  });

  // Extra effects not in useSyncEffects
  useChatDeepLink(ctx.openChat, selectConversation, setUserConversationId, chatActions);

  useEffect(() => {
    setContextSettings(currentAgent ? (currentAgent as unknown as Record<string, unknown>).context_settings as ContextSettings | string | undefined : undefined);
  }, [currentAgent]);

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

  // The server authorizes the source; switch panel state only after it loads.
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent<{ chatId?: string | number; messageId?: string | number }>).detail;
      const chatId = Number(detail?.chatId);
      if (!Number.isSafeInteger(chatId) || chatId < 1) return;
      const messageId = Number(detail?.messageId);
      const isSameChat = chatId === Number(chatPartner?.type === 'agent' ? currentConversationId : userConversationId ?? currentConversationId);
      if (!isSameChat) {
        try {
          const conversation = await selectConversation(chatId);
          if (!conversation) return;
          setUserConversationId(chatId);
          setChatMode('people');
          setChatPartner({ type: 'group', id: chatId, name: conversation.title || `#${chatId}` });
          setActivePanel('none');
          setLocalError(null);
        } catch (error) {
          setLocalError(error instanceof Error ? error.message : String(error));
          return;
        }
      }
      if (Number.isSafeInteger(messageId) && messageId > 0) {
        setTimeout(() => {
          const el = messagesContainerRef.current?.querySelector(`[data-message-id="${messageId}"]`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('ring-2', 'ring-[var(--color-primary-500)]', 'ring-opacity-50');
            setTimeout(() => el.classList.remove('ring-2', 'ring-[var(--color-primary-500)]', 'ring-opacity-50'), 2000);
          }
        }, isSameChat ? 0 : 500);
      }
    };
    window.addEventListener('navigate-to-chat-message', handler);
    return () => window.removeEventListener('navigate-to-chat-message', handler);
  }, [selectConversation, currentConversationId, userConversationId, chatPartner?.type,
    setUserConversationId, setChatMode, setChatPartner, setActivePanel, setLocalError]);
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
    conversationSpace,
    bindDraftToConversation,
    inputValue, setInputValue: setInputValue as any,
    attachments, setAttachments: setAttachments as any,
    mentionedUsers: mentionedUsers as any, setMentionedUsers: setMentionedUsers as any,
    messageBoundRows: messageBoundRows as any, setMessageBoundRows: setMessageBoundRows as any,
    boundRows: boundRows as any,
    setLocalError, setDragOver, chatPartner: chatPartner as any, currentAgent,
    agentMode, thinkingEnabled, voiceBusy: isRecording || isTranscribing,
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

  const {
    chatSearchActive, setChatSearchActive, chatSearchQuery, setChatSearchQuery,
    chatSearchCurrentMatch, setChatSearchCurrentMatch, searchMatchIds, handleSearchNext, handleSearchPrev,
  } = useChatSearch(displayMessages, messagesContainerRef);

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
    setFavorites,
    setUserConversationId, setChatPartner: setChatPartner as any,
    setChatParticipants: setChatParticipants as any, setBoundRows: setBoundRows as any,
    setShowBoundRowsBar, handleAgentSelect: events.handleAgentSelect,
    selectConversation, openTaskChat, createNewConversation, forceNewChatRef,
    setChatMode, clearMessages,
    agentsSearch, setAgentsSearch, agents, mentionAgents, loadAgents, isLoadingAgents, currentAgent,
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
    inboxUserFilter, setInboxUserFilter, inboxParticipantMode, setInboxParticipantMode,
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
    conversationSpace,
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
    voiceNote,
    isRecording, isTranscribing, voiceError, recordingDuration, recordingStream,
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
