/** AIChatPanel v2 — Modular Composition (ADR-119) */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { useAIChat } from '../../context/AIChatContext';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useCurrentSpace } from '@/features/spaces/store/spacesStore';
import { cn } from '@/shared/utils/cn';
import type { ContextSettings } from './types';
import type { AIChatPanelProps } from '../AIChatPanel.types';
import type { MentionUser } from '../MentionInput';
import type { ChatMessage } from '../../types';
import { useChatState } from './hooks/useChatState';
import { useChatActions } from './hooks/useChatActions';
import { useDataQueries } from './hooks/useDataQueries';
import { useChatMutations } from './hooks/useChatMutations';
import { useResizeHandlers } from './hooks/useResizeHandlers';
import { useSyncEffects } from './hooks/useSyncEffects';
import { useScrollManagement } from './hooks/useScrollManagement';
import { useEventHandlers } from './hooks/useEventHandlers';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useConversationMessages } from '../../hooks/useConversationMessages';
import { CHAT_CONFIG } from '../../constants/chatConfig';
import { usePanelContentWiring } from './hooks/usePanelContentWiring';
import { ChatHeaderFull } from './components/ChatHeader/ChatHeaderFull';
import { MessagesArea } from './components/MessagesArea';
import { InputArea } from './components/InputArea';
import { TerminalPanel } from '@/features/terminal';
import { AgentEditModal } from '../AgentEditModal';
import { FilePreviewModal, detectFileType } from '@/features/files/components/FilePreviewModal';
import { ChevronDown, ChevronUp, Maximize2 } from 'lucide-react';

// Re-export for barrel pattern compatibility
export type { AIChatPanelProps };

// ─── Main Component ─────────────────────────────────────────────────
export function AIChatPanel({ className }: AIChatPanelProps) {
  const ctx = useAIChat();
  const {
    isOpen, closeChat, currentAgent, agents, messages, isLoading, isLoadingAgents,
    error, selectAgent, sendMessage, clearMessages, loadAgents,
    conversations, currentConversationId, loadConversations, selectConversation,
    createNewConversation, deleteConversation, isLoadingConversations,
    spaceId: contextSpaceId, pendingTaskChat, clearPendingTaskChat,
    rowFilter, clearRowFilter,
    isAgentProcessing, processingAgentName, processingStartedAt,
    setProcessingAgentName, dismissProcessing, resetProcessing, stopAgent,
    historyAgentFilter, setHistoryAgentFilter, renameConversation,
  } = ctx;

  const { state: chatState, actions: chatActions } = useChatState();
  const {
    activePanel, chatMode, chatPartner, inputValue, attachments, previewFile, dragOver,
    mentionedUsers, boundRows, messageBoundRows, chatParticipants, tasksSource, filesSource,
    showFilePicker, attachTab, panelHeight, panelMode, isResizing, panelWidth, isResizingWidth,
    sidebarWidth, isResizingSidebar, isMobile, mobileKeyboardHeight, processingElapsed,
    markdownEnabled, agentMode, thinkingEnabled, settingsTab, localError, showTerminal,
    terminalFocusSessionId, contactsSearch, agentsSearch, historySearch, filesSearch,
    tasksSearch, userTypeFilter, showFavorites, favorites, showRowBinding, showBoundRowsBar,
    showMessageRowPicker, expandedTaskChats, showAllContacts, chatOperatorId, chatModelId,
    chatSystemPrompt, isSavingAgentSettings, sortOption, subAgents, editingAgentId,
    defaultAgentId, isSavingDefaultAgent, favoriteAgents, showFavoriteAgents, expandedAgentId,
    isVectorSearching, vectorSearchResults, agentChats, quickEmojis, isSavingEmojis,
    messageReactions, voiceMode, showScrollToBottom, newMessageCount, agentWorking,
    userConversationId,
  } = chatState;

  const {
    setActivePanel, setChatMode, setChatPartner, setInputValue, setAttachments, setPreviewFile,
    setDragOver, setMentionedUsers, setBoundRows, setMessageBoundRows, setChatParticipants,
    setTasksSource, setFilesSource, setShowFilePicker, setAttachTab, setPanelHeight, setPanelMode,
    setIsResizing, setPanelWidth, setIsResizingWidth, setSidebarWidth, setIsResizingSidebar,
    setProcessingElapsed, setMarkdownEnabled, setAgentMode, setThinkingEnabled, setSettingsTab,
    setLocalError, setShowTerminal, setTerminalFocusSessionId, setContactsSearch, setAgentsSearch,
    setHistorySearch, setFilesSearch, setTasksSearch, setUserTypeFilter, setShowFavorites,
    setFavorites, setShowRowBinding, setShowBoundRowsBar, setShowMessageRowPicker,
    setExpandedTaskChats, setShowAllContacts, setChatOperatorId, setChatModelId, setChatSystemPrompt,
    setIsSavingAgentSettings, setSortOption, setSubAgents, setEditingAgentId, setDefaultAgentId,
    setIsSavingDefaultAgent, setFavoriteAgents, setShowFavoriteAgents, setExpandedAgentId,
    setIsVectorSearching, setVectorSearchResults, setAgentChats, setQuickEmojis, setIsSavingEmojis,
    setMessageReactions, setVoiceMode, setShowScrollToBottom, setNewMessageCount, setAgentWorking,
    setUserConversationId,
  } = chatActions;

  const _chatActionHandlers = useChatActions();

  const currentUser = useAuthStore((state) => state.user);
  const isAdminOrOwner = currentUser?.role === 'admin' || currentUser?.role === 'owner';
  const currentSpace = useCurrentSpace();
  const effectiveSpaceId = contextSpaceId ?? currentSpace?.id;
  const isWideMode = !isMobile && panelWidth >= 600;
  const conversationMode = chatPartner?.type === 'agent' ? 'solo' as const : chatPartner?.type === 'group' ? 'group' as const : chatPartner?.type === 'user' ? 'solo' as const : null;

  const [inboxSearch, setInboxSearch] = useState('');
  const [inboxAgentFilter, setInboxAgentFilter] = useState<string>('');
  const [inboxDateFrom, setInboxDateFrom] = useState<string>('');
  const [inboxDateTo, setInboxDateTo] = useState<string>('');
  const [showInboxFilters, setShowInboxFilters] = useState(false);

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
    contextSpaceId, inboxSearch, inboxAgentFilter, inboxDateFrom, inboxDateTo,
  });
  const {
    users, isLoadingUsers, totalUnreadCount, refetchUnread,
    inboxConversations, isLoadingInbox, refetchInbox,
    taskRows, filteredTaskRows, isLoadingTasks, taskStatusDict, tasksTableColumns,
    projectFiles, isLoadingFiles, operators, models,
    usersForMentions, aiAgentsData, allTablesDataMain,
  } = dataQueries;

  const {
    messages: userConversationMessages, conversation: userConversationData,
    hasNextPage: hasOlderMessages, fetchNextPage: fetchOlderMessages,
    isFetchingNextPage: isFetchingOlderMessages, refetch: refetchUserMessages,
    markAsRead, pollingError: userPollingError, pollingStopped: userPollingStopped,
    reconnect: userReconnect, fetchToolSteps: userFetchToolSteps,
  } = useConversationMessages(userConversationId, {
    pageSize: CHAT_CONFIG.MESSAGE_PAGE_SIZE,
    enabled: !!userConversationId && (chatPartner?.type === 'user' || chatPartner?.type === 'group'),
    adaptivePolling: true, chatActivityState: 'active',
    currentUserId: currentUser?.id ? Number(currentUser.id) : undefined,
  });

  const {
    messages: aiConversationMessages, conversation: aiConversationData,
    fetchNextPage: fetchNextAIPage, hasNextPage: hasNextAIPage,
    isFetchingNextPage: isFetchingNextAIPage,
    pollingError: aiPollingError, pollingStopped: aiPollingStopped,
    reconnect: aiReconnect,
    isProcessing: aiBackendProcessing,
    processingAgentName: aiBackendProcessingAgentName,
    fetchToolSteps: aiFetchToolSteps,
  } = useConversationMessages(currentConversationId, {
    pageSize: CHAT_CONFIG.MESSAGE_PAGE_SIZE,
    enabled: !!currentConversationId && chatPartner?.type === 'agent',
    adaptivePolling: true,
    chatActivityState: isAgentProcessing ? 'agent_processing' : 'idle',
    currentUserId: currentUser?.id ? Number(currentUser.id) : undefined,
  });

  const activePollingError = chatPartner?.type === 'agent' ? aiPollingError : userPollingError;
  const activePollingStopped = chatPartner?.type === 'agent' ? aiPollingStopped : userPollingStopped;
  const activeReconnect = chatPartner?.type === 'agent' ? aiReconnect : userReconnect;

  const mutations = useChatMutations({
    currentAgent, chatOperatorId, chatModelId, chatSystemPrompt,
    setIsSavingAgentSettings, setContextSettings,
    setDefaultAgentId, setIsSavingDefaultAgent,
    setQuickEmojis, setIsSavingEmojis,
    setMessageReactions: setMessageReactions as any,
    loadAgents, refetchUserMessages,
  });

  // ========== Resize ==========
  const resize = useResizeHandlers({
    panelHeight, panelWidth, sidebarWidth, panelMode,
    setPanelHeight: setPanelHeight as any, setPanelMode: setPanelMode as any,
    setIsResizing, setPanelWidth: setPanelWidth as any, setIsResizingWidth,
    setSidebarWidth: setSidebarWidth as any, setIsResizingSidebar,
    activePanel, setActivePanel,
  });

  // ========== Voice Input ==========
  const {
    isRecording, isProcessing: isTranscribing, error: voiceError,
    duration: recordingDuration, startRecording, stopRecording, cancelRecording,
    webSpeechAvailable,
  } = useVoiceInput({
    mode: voiceMode, language: 'ru-RU', spaceId: currentSpace?.id,
    onResult: (text) => { setInputValue(prev => { const sep = prev.trim() ? ' ' : ''; return prev + sep + text; }); },
    onError: (error) => { logger.error('[Voice Input] Error:', error); },
  });

  // ========== Display Messages ==========
  const displayMessages = useMemo(() => {
    if (chatPartner?.type === 'user' || chatPartner?.type === 'group') return (userConversationMessages || []) as ChatMessage[];
    if (chatPartner?.type === 'agent') {
      if (aiConversationMessages && aiConversationMessages.length > 0) return aiConversationMessages as ChatMessage[];
      if (messages && messages.length > 0) return messages;
      return [];
    }
    return messages;
  }, [chatPartner?.type, userConversationMessages, aiConversationMessages, messages]);

  // ========== Mention/Agent data ==========
  const availableMentionUsers: MentionUser[] = useMemo(() => {
    return (usersForMentions || []).map(user => ({
      id: user.id, name: user.name, email: user.email, avatar: user.avatar_url,
      type: user.managed_by_agent_table_id ? 'bot' as const : 'human' as const
    }));
  }, [usersForMentions]);

  const availableSlashAgents: MentionUser[] = useMemo(() => {
    return (aiAgentsData?.data?.agents || [])
      .filter(agent => agent.status !== 'inactive' && agent.name)
      .map(agent => ({ id: agent.id, name: agent.name, icon: agent.icon, email: agent.description, type: 'agent' as const }));
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

  // ========== Sync Effects (delegated to hook) ==========
  useSyncEffects({
    currentAgent, setChatOperatorId, setChatModelId, setChatSystemPrompt,
    aiBackendProcessing, isAgentProcessing, dismissProcessing,
    aiBackendProcessingAgentName, setProcessingAgentName,
    userConversationId, userConversationData, markAsRead, refetchUnread,
    isOpen, agents, defaultAgentId, selectAgent, loadAgents, loadConversations,
    isMobile, chatPartner: chatPartner as any, setChatPartner: setChatPartner as any,
    setUserConversationId,
    pendingTaskChat, clearPendingTaskChat, setChatMode, setBoundRows: setBoundRows as any,
    setShowBoundRowsBar, setActivePanel: setActivePanel as any,
    aiConversationData, setSubAgents, subAgents, currentConversationId: currentConversationId ?? null,
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
    if (currentSpace?.settings && typeof currentSpace.settings === 'object') {
      const s = currentSpace.settings as Record<string, unknown>;
      setDefaultAgentId(s.default_agent_id ? Number(s.default_agent_id) : null);
      setQuickEmojis(Array.isArray(s.quick_emojis) ? s.quick_emojis as string[] : ['👍','❤️','😂','🔥','💯','🙏','😍','😮']);
    } else { setDefaultAgentId(null); setQuickEmojis(['👍','❤️','😂','🔥','💯','🙏','😍','😮']); }
  }, [currentSpace?.id, currentSpace?.settings]);

  useEffect(() => { if (isOpen && activePanel === 'none') setTimeout(() => inputRef.current?.focus(), 300); }, [isOpen, activePanel]);

  // ========== Scroll Management (delegated to hook) ==========
  useScrollManagement({
    displayMessages, aiConversationMessages,
    currentConversationId: currentConversationId ?? null,
    userConversationId, chatPartnerId: chatPartner?.id,
    chatPartnerType: chatPartner?.type,
    hasOlderMessages, fetchOlderMessages,
    hasNextAIPage, fetchNextAIPage,
    isFetchingOlderMessages: !!isFetchingOlderMessages,
    isFetchingNextAIPage: !!isFetchingNextAIPage,
    isAgentProcessing,
    messagesEndRef, messagesContainerRef, loadMoreSentinelRef,
    setShowScrollToBottom, setNewMessageCount: setNewMessageCount as any,
    setAgentWorking, fetchReactionsForMessages: mutations.fetchReactionsForMessages,
  });

  // ========== Event Handlers (delegated to hook) ==========
  const events = useEventHandlers({
    inputValue, setInputValue: setInputValue as any,
    attachments, setAttachments: setAttachments as any,
    mentionedUsers: mentionedUsers as any, setMentionedUsers: setMentionedUsers as any,
    messageBoundRows: messageBoundRows as any, setMessageBoundRows: setMessageBoundRows as any,
    setLocalError, setDragOver, chatPartner: chatPartner as any, currentAgent,
    agentMode, thinkingEnabled, subAgents,
    userConversationId, setUserConversationId,
    currentSpaceId: currentSpace?.id, effectiveSpaceId,
    availableMentionUsers, availableSlashAgents,
    sendMessage, selectAgent,
    sendUserMessageMutation: mutations.sendUserMessageMutation,
    setChatMode, setChatPartner: setChatPartner as any, setChatParticipants: setChatParticipants as any,
    setBoundRows: setBoundRows as any, setShowBoundRowsBar, setActivePanel: setActivePanel as any,
    setVectorSearchResults,
  });

  // ========== Guard ==========
  if (!isOpen) return null;

  // ========== Panel content (delegated to wiring hook) ==========
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
    selectConversation, createNewConversation, forceNewChatRef,
    setChatMode, clearMessages,
    agentsSearch, setAgentsSearch, agents, isLoadingAgents, currentAgent,
    showFavoriteAgents, setShowFavoriteAgents, favoriteAgents, setFavoriteAgents,
    isVectorSearching, vectorSearchResults, setVectorSearchResults,
    setIsVectorSearching, currentSpaceId: currentSpace?.id,
    createTablesMutation: mutations.createTablesMutation, currentSpace: currentSpace as any,
    inboxConversations: inboxConversations as any, isLoadingInbox, totalUnreadCount, refetchInbox,
    inboxSearch, setInboxSearch, inboxAgentFilter, setInboxAgentFilter,
    inboxDateFrom, setInboxDateFrom, inboxDateTo, setInboxDateTo,
    showInboxFilters, setShowInboxFilters,
    markAsReadMutation: mutations.markAsReadMutation, selectAgent, renameConversation,
    userConversationId, currentConversationId, allTablesDataMain: allTablesDataMain as any,
    tasksSource, filteredTaskRows, isLoadingTasks, taskRows, taskStatusDict,
    tasksTableColumns, tasksSearch, setTasksSearch, setTasksSource,
    expandedTaskChats, setExpandedTaskChats, conversations: conversations as any, effectiveSpaceId,
    settingsTab, setSettingsTab, chatOperatorId, setChatOperatorId,
    chatModelId, setChatModelId, chatSystemPrompt, setChatSystemPrompt,
    operators, models, isAdminOrOwner, isSavingAgentSettings,
    saveAgentSettings: mutations.saveAgentSettings,
    messages, contextSettings: contextSettings as any, setContextSettings,
    saveContextSettings: mutations.saveContextSettings as any, isSavingContextSettings,
    defaultAgentId, saveDefaultAgent: mutations.saveDefaultAgent, isSavingDefaultAgent,
    quickEmojis, setQuickEmojis, saveQuickEmojis: mutations.saveQuickEmojis, isSavingEmojis,
    voiceMode, setVoiceMode, voiceError: voiceError || null, webSpeechAvailable,
    filesSource, setFilesSource,
  });

  // ========== JSX Render ==========
  return (
    <>
      {isMobile && (
        <div role="button" tabIndex={0} className="fixed top-14 left-0 right-0 bottom-0 bg-black/50 z-30"
          onClick={closeChat} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') closeChat(); }} />
      )}

      <div className={cn('bg-[var(--bg-primary)] shadow-lg flex',
        isMobile ? 'fixed top-14 left-0 right-0 z-40 flex-col' : 'relative z-30 flex-shrink-0 h-full border-l border-[var(--border-primary)]', className)}
        style={isMobile ? { bottom: `${mobileKeyboardHeight > 0 ? mobileKeyboardHeight : 0}px` } : { width: panelWidth }}>

        {/* Left resize handle */}
        {!isMobile && (
          <div className="w-1 cursor-ew-resize hover:bg-purple-500/50 transition-colors flex-shrink-0"
            onMouseDown={resize.handleWidthResizeStart}
            style={{ backgroundColor: isResizingWidth ? 'var(--color-purple-500)' : 'transparent' }} />
        )}

        <div className={cn('flex-1 flex min-w-0 min-h-0 overflow-hidden', isWideMode ? 'flex-row' : 'flex-col')}>
          {/* Chat area */}
          <div className="flex flex-col min-w-0 min-h-0 overflow-hidden relative flex-1">
            <ChatHeaderFull
              chatMode={chatMode} setChatMode={setChatMode}
              activePanel={activePanel} togglePanel={resize.togglePanel}
              agents={agents} users={users}
              totalUnreadCount={totalUnreadCount} refetchInbox={refetchInbox}
              createNewConversation={createNewConversation} closeChat={closeChat}
              chatPartner={chatPartner as any} setChatPartner={setChatPartner as any}
              chatParticipants={chatParticipants as any}
              resolvedConvTitle={resolvedConvTitle}
              currentConversationId={currentConversationId} userConversationId={userConversationId}
              renameConversation={renameConversation} deleteConversation={deleteConversation}
              conversationMode={conversationMode}
              showRowBinding={showRowBinding} setShowRowBinding={setShowRowBinding as any}
              boundRows={boundRows as any} setBoundRows={setBoundRows as any}
              setShowBoundRowsBar={setShowBoundRowsBar}
              effectiveSpaceId={effectiveSpaceId} tasksSource={tasksSource as any}
              currentAgent={currentAgent as any} isWideMode={isWideMode}
              contactsSearch={contactsSearch} setContactsSearch={setContactsSearch}
              isMobile={isMobile}
            />

            {/* Panel + Messages Area */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative" data-panel-container>
              {/* Panel overlay */}
              {!isWideMode && activePanel !== 'none' && (
                <div className={cn(
                  "border-b border-[var(--border-secondary)] bg-[var(--bg-secondary)] overflow-hidden flex flex-col z-30",
                  (panelMode === 'collapsed' || (isMobile && panelMode === 'default')) ? "relative min-h-0" :
                  panelMode === 'expanded' ? "absolute left-0 right-0 top-0 bottom-[400px]" :
                  panelMode === 'fullscreen' ? "absolute inset-0" : "relative flex-1 min-h-0"
                )} style={
                  (panelMode === 'collapsed' || (isMobile && panelMode === 'default')) ? { height: 'min(400px, 40vh)' } :
                  panelMode === 'default' && !isMobile ? { maxHeight: '50%' } : undefined
                }>
                  <div className="flex-1 overflow-y-auto">{renderPanelContent()}</div>
                  <div className="flex-shrink-0 h-6 px-2 flex items-center justify-between border-t border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
                    <div className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-3">
                      {activePanel === 'contacts' && <span>{users.length} контактов</span>}
                      {activePanel === 'ai-agents' && <span>{agents.length} агентов</span>}
                      {activePanel === 'tasks' && <span>{taskRows.length} задач</span>}
                      {activePanel === 'settings' && <span>Настройки чата</span>}
                    </div>
                    <button onClick={resize.togglePanelMode}
                      className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors">
                      {panelMode === 'fullscreen' ? <ChevronDown className="w-4 h-4" /> :
                       panelMode === 'collapsed' ? <ChevronUp className="w-4 h-4" /> :
                       <Maximize2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              <MessagesArea
                chatMode={chatMode} chatPartner={chatPartner as any}
                displayMessages={displayMessages} markdownEnabled={markdownEnabled}
                isAgentProcessing={isAgentProcessing}
                processingAgentName={processingAgentName}
                processingElapsed={processingElapsed} stopAgent={stopAgent}
                messageReactions={messageReactions} quickEmojis={quickEmojis}
                currentUserId={currentUser?.id ? Number(currentUser.id) : undefined}
                currentUser={currentUser ? { name: currentUser.name, id: Number(currentUser.id) } : undefined}
                onReact={mutations.handleReaction} onCopy={mutations.handleCopyMessage}
                onForward={mutations.handleForwardMessage} onDelete={mutations.handleDeleteMessage}
                onCheckboxClick={events.handleCheckboxClick}
                onMentionClick={(token) => setInputValue(prev => prev ? `${prev} ${token} ` : `${token} `)}
                onOpenTerminal={(sessionId) => { setShowTerminal(true); if (sessionId) setTerminalFocusSessionId(sessionId); }}
                sendMessage={sendMessage} currentAgent={currentAgent}
                messagesEndRef={messagesEndRef} messagesContainerRef={messagesContainerRef}
                loadMoreSentinelRef={loadMoreSentinelRef}
                dragOver={dragOver} setDragOver={setDragOver} onDrop={events.handleDrop}
                isMobile={isMobile} setActivePanel={setActivePanel as any}
                hasOlderMessages={!!hasOlderMessages} isFetchingOlderMessages={!!isFetchingOlderMessages}
                hasNextAIPage={!!hasNextAIPage} isFetchingNextAIPage={!!isFetchingNextAIPage}
                showScrollToBottom={showScrollToBottom} setShowScrollToBottom={setShowScrollToBottom}
                newMessageCount={newMessageCount} setNewMessageCount={setNewMessageCount as any}
                agentWorking={agentWorking} setAgentWorking={setAgentWorking}
                activePollingError={activePollingError} activePollingStopped={activePollingStopped}
                activeReconnect={activeReconnect}
                error={error} localError={localError}
                fetchToolSteps={chatMode === 'ai' ? aiFetchToolSteps : userFetchToolSteps}
              />
            </div>

            <InputArea
              inputValue={inputValue} setInputValue={setInputValue as any}
              attachments={attachments} setAttachments={setAttachments as any}
              mentionedUsers={mentionedUsers as any} setMentionedUsers={setMentionedUsers as any}
              messageBoundRows={messageBoundRows as any} setMessageBoundRows={setMessageBoundRows as any}
              showFilePicker={showFilePicker} setShowFilePicker={setShowFilePicker as any}
              attachTab={attachTab} setAttachTab={setAttachTab}
              filesSource={filesSource} updateFilesSource={(config) => setFilesSource(config)}
              projectFiles={projectFiles} isLoadingFiles={isLoadingFiles}
              filesSearch={filesSearch} setFilesSearch={setFilesSearch}
              effectiveSpaceId={effectiveSpaceId} tasksSource={tasksSource as any}
              chatPartner={chatPartner as any} hasSlashCommand={hasSlashCommand}
              thinkingEnabled={thinkingEnabled} setThinkingEnabled={setThinkingEnabled as any}
              agentMode={agentMode} setAgentMode={setAgentMode as any}
              markdownEnabled={markdownEnabled} setMarkdownEnabled={setMarkdownEnabled as any}
              showTerminal={showTerminal} setShowTerminal={setShowTerminal as any}
              isRecording={isRecording} isTranscribing={isTranscribing}
              voiceError={voiceError} recordingDuration={recordingDuration}
              startRecording={startRecording} stopRecording={stopRecording} cancelRecording={cancelRecording}
              voiceMode={voiceMode}
              isLoading={isLoading} isAgentProcessing={isAgentProcessing} stopAgent={stopAgent}
              handleSubmit={events.handleSubmit} handleFileSelect={events.handleFileSelect}
              fileInputRef={fileInputRef as any}
              availableMentionUsers={availableMentionUsers} availableSlashAgents={availableSlashAgents}
              panelMode={panelMode}
            />

            {showTerminal && (
              <div className="flex-shrink-0 border-t border-[var(--border-primary)]" style={{ height: 260 }}>
                <TerminalPanel className="h-full rounded-none border-0" compact={false}
                  focusSessionId={terminalFocusSessionId} onCollapse={() => setShowTerminal(false)} />
              </div>
            )}
          </div>

          {/* Sidebar for wide mode */}
          {isWideMode && activePanel !== 'none' && (
            <>
              <div role="separator" onMouseDown={resize.handleSidebarResizeStart}
                className={cn("w-1 cursor-col-resize hover:bg-[var(--color-primary-500)]/30 transition-colors flex-shrink-0",
                  isResizingSidebar && "bg-[var(--color-primary-500)]/50")} />
              <div className="border-l border-[var(--border-primary)] flex-shrink-0 overflow-hidden flex flex-col bg-[var(--bg-secondary)]"
                style={{ width: sidebarWidth }}>
                <div className="flex-1 overflow-y-auto">{renderPanelContent()}</div>
              </div>
            </>
          )}
        </div>

        {editingAgentId && (
          <AgentEditModal isOpen={!!editingAgentId} onClose={() => setEditingAgentId(null)}
            agent={agents.find(a => a.id === editingAgentId) || null}
            onSave={() => { loadAgents(); }} />
        )}

        {previewFile && (
          <FilePreviewModal isOpen={!!previewFile} onClose={() => setPreviewFile(null)}
            fileUrl={previewFile.url} fileName={previewFile.name} fileType={detectFileType(previewFile.url)} />
        )}
      </div>
    </>
  );
}
