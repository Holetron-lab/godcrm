import { useConversationSettings } from './hooks/useConversationSettings';
import { ConversationSpaceDialog } from './components/ConversationSpace';
import { useLanguage } from '@/shared/i18n/LanguageContext';
/** AIChatPanel v2 — Modular Composition (ADR-119) */
import React, { lazy, Suspense, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import type { AIChatPanelProps } from '../AIChatPanel.types';
import type { ChatMessage } from '../../types';
import type { ChatSummary } from '../../hooks/useChatSummary';
import { useAIChat } from '../../context/AIChatContext';
import { useAIChatPanelLogic } from './hooks/useAIChatPanelLogic';
import { usePinMessage } from '../../hooks/usePinMessage';
import { ChatPanelToolbar, ChatInfoBar } from './components/ChatHeader/ChatHeaderFull';
import { ChatToolbar } from './components/ChatToolbar/ChatToolbar';
import { BoundRowsStrip } from './components/BoundRowsStrip';
import { CallBar } from '@/features/chat/call/CallBar';
import { useCallStore } from '@/features/chat/call/callStore';
import { MessagesArea } from './components/MessagesArea';
import { PinnedBanner } from '../PinnedBanner';
import { InputArea } from './components/InputArea';
import { ScheduledMessagesBar } from './components/ScheduledMessagesBar';
import { TerminalPanel } from '@/features/terminal';
import { detectFileType } from '@/features/files/components/FilePreviewModal';
import { ChevronDown, ChevronUp, Maximize2 } from 'lucide-react';
import { logger } from '@/shared/utils/logger';
import { showToast } from '@/shared/hooks/useToast';
import { apiClient } from '@/shared/utils/apiClient';
import { filesApi } from '@/features/files/api/filesApi';
import { ValidSlugsProvider } from '../../context/ValidSlugsContext';
import { MentionUsersProvider } from '../MentionUsersContext';
import { HumanChatPresenceContext, useHumanChatPresence } from '../../hooks/useHumanChatPresence';

const AgentEditModal = lazy(() => import('../AgentEditModal').then(m => ({ default: m.AgentEditModal })));
const FilePreviewModal = lazy(() => import('@/features/files/components/FilePreviewModal').then(m => ({ default: m.FilePreviewModal })));
const SummaryCarousel = lazy(() => import('./components/ChatMessages/SummaryCarousel').then(m => ({ default: m.SummaryCarousel })));
const SpawnTicketModal = lazy(() => import('./components/SpawnTicketModal').then(m => ({ default: m.SpawnTicketModal })));
const DeleteChatModal = lazy(() => import('./components/DeleteChatModal').then(m => ({ default: m.DeleteChatModal })));
// Move stages chips above the input; Send opens the destination picker.

export type { AIChatPanelProps };
export function AIChatPanel({ className, fillContainer = false }: AIChatPanelProps) {
  const { t } = useLanguage();
  const logic = useAIChatPanelLogic({ fillContainer });
  const { mentionAgents } = useAIChat();

  const {
    isOpen, closeChat, currentAgent, agents, messages, isLoading, error,
    sendMessage, loadAgents, stopAgent,
    currentConversationId, deleteConversation, renameConversation,
    isAgentProcessing, processingAgentName, processingStartedAt,

    chatMode, setChatMode, chatPartner, setChatPartner,
    activePanel, setActivePanel,
    inputValue, setInputValue,
    attachments, setAttachments,
    previewFile, setPreviewFile,
    dragOver, setDragOver,
    mentionedUsers, setMentionedUsers,
    messageBoundRows, setMessageBoundRows,
    boundRows, setBoundRows,
    chatParticipants, setChatParticipants, tasksSource, filesSource,
    selectConversation, setUserConversationId, selectAgent,
    showFilePicker, setShowFilePicker,
    attachTab, setAttachTab,
    panelMode, panelWidth, isResizingWidth, isGlued,
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

    isWideMode, conversationMode, resolvedConvTitle, hasSlashCommand,
    displayMessages, availableMentionUsers, availableSlashAgents,
    searchMatchIds,
    userConversationId, effectiveSpaceId,

    users, totalUnreadCount, refetchInbox,
    projectFiles, isLoadingFiles,
    filesSearch, setFilesSearch,
    createNewConversation,

    isLoadingAIMessages, isLoadingUserMessages,
    hasOlderMessages, isFetchingOlderMessages,
    hasNextAIPage, isFetchingNextAIPage,
    activePollingError, activePollingStopped, activeReconnect,
    activeAgents,
    localError,

    aiFetchThinkingSteps, aiFetchToolStepsPreview, aiFetchFullMessage, aiFetchToolSteps,
    userFetchThinkingSteps, userFetchToolStepsPreview, userFetchFullMessage, userFetchToolSteps,

    isRecording, isTranscribing, voiceError, recordingDuration, recordingStream,
    startRecording, stopRecording, cancelRecording,

    forwardMessages, setForwardMessages,
    moveMessages, setMoveMessages,
    showSummaryCarousel, setShowSummaryCarousel,
    aiConversationData, userConversationData,

    chatSearchActive, setChatSearchActive,
    chatSearchQuery, setChatSearchQuery,
    chatSearchCurrentMatch, setChatSearchCurrentMatch,
    handleSearchNext, handleSearchPrev,

    currentUser, messageReactions, quickEmojis,

    mutations, resize, events,
    renderPanelContent,

    messagesEndRef, messagesContainerRef, loadMoreSentinelRef,
    fileInputRef,
    updateFilesSource,

    // WP-17: Scheduled messages
    scheduledActive, setScheduledActive,
    scheduled,
  } = logic;

  const { chatSettings, setChatSettings, selectedConversationId, openChatSettings, conversationSettings } = useConversationSettings(logic);

  // WP-17: Track schedule date when editing a scheduled message
  const [editScheduleDate, setEditScheduleDate] = React.useState<string | null>(null);

  // ADR-0031 P6: Spawn ticket modal
  const [showSpawnTicketModal, setShowSpawnTicketModal] = React.useState(false);

  // Capture the delete target so switching conversations cannot delete the wrong chat.
  const [deleteChatTarget, setDeleteChatTarget] = React.useState<{ convId: number; title?: string | null } | null>(null);
  // ADR-0059 §4.6: paint Call button as active while a call is running.
  const callActive = useCallStore((s) => s.state !== 'idle');

  // Move drafts persist across chats; InputArea prevents sending back to the source.
  const activeConversationData = React.useMemo(() => {
    if (chatPartner?.type === 'agent') return aiConversationData;
    if (chatPartner?.type === 'user' || chatPartner?.type === 'group') return userConversationData;
    return null;
  }, [chatPartner?.type, aiConversationData, userConversationData]);
  const activeConversationId = currentConversationId ?? userConversationId ?? null;
  const isChatOwner = React.useMemo(() => {
    const ownerId = (activeConversationData as any)?.created_by;
    const userId = currentUser?.id;
    if (ownerId == null || userId == null) return false;
    return Number(ownerId) === Number(userId);
  }, [activeConversationData, currentUser?.id]);
  const handleMoveMessage = React.useCallback((msg: ChatMessage) => {
    if (!isChatOwner || !activeConversationId) return;
    setMoveMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
    setSelectModeActive(true);
  }, [isChatOwner, activeConversationId, setMoveMessages, setSelectModeActive]);

  // ADR-0068 WP-E — Pin/Unpin wiring for the production canvas (TurnFooter
  // icon). Banner stays Telegram-only by design; this restores the entrypoint
  // that was added to TurnFooter but never threaded from this host.
  // Permission: any participant for agent/group; owner-only for 1-on-1 DM
  // (chatPartner.type === 'user'). Mirrors backend pinController gate.
  const pinMutation = usePinMessage(activeConversationId);
  const canPin = React.useMemo(() => {
    if (!activeConversationId) return false;
    if (chatPartner?.type === 'user') return isChatOwner;
    return true;
  }, [activeConversationId, chatPartner?.type, isChatOwner]);
  const handlePinMessage = React.useCallback((messageId: number) => {
    pinMutation.pin(messageId);
  }, [pinMutation]);
  const handleUnpinMessage = React.useCallback((messageId: number) => {
    pinMutation.unpin(messageId);
  }, [pinMutation]);
  React.useEffect(() => {
    if (pinMutation.capReached) {
      showToast(t('aiChat.ui.pinnedMessageLimitReached50UnpinAMessageAndTryAgain'), 'error');
      pinMutation.clearCapNotice();
    }
  }, [pinMutation.capReached, pinMutation.clearCapNotice, t]);

  // ADR-0068 WP-E follow-up — PinnedBanner is controlled by a toolbar button
  // (Pin icon next to Scheduled). State lifted into the panel so the badge
  // count + expanded toggle live alongside the rest of the toolbar state.
  const [pinnedListOpen, setPinnedListOpen] = React.useState(false);
  const pinnedCount = React.useMemo(
    () => displayMessages.filter(m => m.pinned_at && !m.is_deleted).length,
    [displayMessages],
  );

  // Perf: stable identity for the currentUser object handed to MessagesArea →
  // ChatTurn. A fresh `{ name, id }` literal per render defeated the React.memo
  // on MessagesArea/ChatTurn, re-rendering every heavy agent bubble on each
  // keystroke (typing lag in long chats). Memoize on the underlying user.
  const messagesCurrentUser = React.useMemo(
    () => (currentUser ? { name: currentUser.name || currentUser.email || t('aiChat.ui.user'), id: Number(currentUser.id) } : undefined),
    [currentUser, t],
  );

  // Stable callbacks for MessagesArea — prevent re-render on every keystroke.
  // setForwardMessages/setSelectModeActive/setInputValue/setShowTerminal/setTerminalFocusSessionId
  // are useState setters (stable identity), so [] deps are safe.
  const handleForwardMessage = useCallback((msg: ChatMessage) => {
    setForwardMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
    setSelectModeActive(true);
  }, [setForwardMessages, setSelectModeActive]);

  const handleMentionClick = useCallback((token: string) => {
    setInputValue(prev => prev ? `${prev} ${token} ` : `${token} `);
  }, [setInputValue]);

  const handleOpenTerminal = useCallback((sessionId?: number) => {
    setShowTerminal(true);
    if (sessionId) {
      setTerminalFocusSessionId(undefined);
      setTimeout(() => setTerminalFocusSessionId(sessionId), 0);
    }
  }, [setShowTerminal, setTerminalFocusSessionId]);

  // ADR-0031 §Z / WP-24: ChatLinkCard click navigation. Fetches a compact
  // conversation summary (reusing the useChatSummary cache), then dispatches
  // to the right setters based on whether the target is an AI-agent chat or
  // a user/group chat. selectConversation alone only handles AI chats — user
  // chats need chatPartner + chatMode + userConversationId to swap the view.
  const queryClient = useQueryClient();
  const handleNavigateToConversation = useCallback(
    async (conversationId: number, _firstMessageId?: number) => {
      try {
        const summary = await queryClient.fetchQuery<ChatSummary>({
          queryKey: ['chat-summary', conversationId],
          queryFn: async () => {
            const r = await apiClient.get<{ data?: ChatSummary } | ChatSummary>(
              `/chat/conversations/${conversationId}/summary`,
            );
            return ((r as { data?: ChatSummary }).data ?? (r as ChatSummary));
          },
          staleTime: 30_000,
        });
        if (!summary || summary.deleted) return;

        if (summary.agent) {
          const agent = agents.find(a => a.id === summary.agent!.id);
          if (agent) selectAgent(agent);
          setChatMode('ai');
          setChatPartner({
            type: 'agent',
            id: summary.agent.id,
            name: summary.title || summary.agent.name,
            icon: summary.agent.icon,
          } as any);
          setChatParticipants([]);
          selectConversation(conversationId);
        } else {
          const isGroup =
            summary.type === 'group' || (summary.participants?.length ?? 0) > 1;
          const partner = isGroup
            ? {
                type: 'group' as const,
                id: conversationId,
                name: summary.title,
                participants: (summary.participants || []).map(p => ({
                  id: p.id,
                  name: p.name,
                  type: 'user' as const,
                })),
              }
            : summary.participants?.[0]
              ? {
                  type: 'user' as const,
                  id: summary.participants[0].id,
                  name: summary.participants[0].name,
                  avatarUrl: summary.participants[0].avatar || undefined,
                }
              : { type: 'user' as const, id: conversationId, name: summary.title };
          setChatMode('people');
          setChatPartner(partner as any);
          setChatParticipants(
            (summary.participants || []).map(p => ({
              id: p.id,
              name: p.name,
              type: 'user' as const,
            })),
          );
          setUserConversationId(conversationId);
        }

        if (summary.bound_row) {
          setBoundRows([
            {
              table_id: summary.bound_row.table_id,
              row_id: summary.bound_row.row_id,
            } as any,
          ]);
        } else {
          setBoundRows([]);
        }

        setActivePanel('none');
      } catch (err) {
        logger.error('navigate to conversation failed:', err);
      }
    },
    [
      queryClient,
      agents,
      selectAgent,
      setChatMode,
      setChatPartner,
      setChatParticipants,
      selectConversation,
      setUserConversationId,
      setBoundRows,
      setActivePanel,
    ],
  );

  const humanPresence = useHumanChatPresence(activeConversationId, isOpen);

  if (!isOpen) return null;
  return (
    <ValidSlugsProvider mentionUsers={availableMentionUsers} slashAgents={availableSlashAgents}>
    <MentionUsersProvider agents={mentionAgents} mentionUsers={availableMentionUsers} spaceId={effectiveSpaceId}>
    <HumanChatPresenceContext.Provider value={humanPresence}>
    <>
      {logic.conversationSpace && <ConversationSpaceDialog binding={logic.conversationSpace} userId={currentUser?.id ? Number(currentUser.id) : undefined} />}
      {isMobile && (
        <button type="button" aria-label={t('aiChat.ui.close')} className="fixed top-14 left-0 right-0 bottom-0 bg-black/50 z-30" onClick={closeChat} />
      )}

      <div data-chat-presence={activeConversationId} className={cn('bg-[var(--bg-primary)] shadow-lg flex',
        isMobile ? 'fixed top-14 left-0 right-0 z-40 flex-col overflow-hidden' : 'relative z-30 flex-shrink-0 h-full border-l border-[var(--border-primary)]', className)}
        style={isMobile ? { bottom: `${mobileKeyboardHeight > 0 ? mobileKeyboardHeight : 0}px` } : { width: fillContainer ? '100%' : panelWidth }}>

        {/* Left resize handle — wider hit-area on touch devices.
            Hidden in fillContainer (embed split): the host shell's divider owns
            resizing; an in-panel handle would un-glue and re-open the gap. */}
        {!isMobile && !fillContainer && (
          <div role="slider" tabIndex={0} aria-label="Ширина чата" aria-orientation="horizontal" aria-valuenow={panelWidth} aria-valuemin={320} aria-valuemax={resize.panelMaxWidth}
            onKeyDown={resize.handleWidthResizeKeyDown}
            className="focus-visible:outline focus-visible:outline-2 w-1 cursor-ew-resize hover:bg-purple-500/50 transition-colors flex-shrink-0 touch-none"
            onMouseDown={resize.handleWidthResizeStart}
            onTouchStart={resize.handleWidthTouchResizeStart}
            style={{ backgroundColor: isResizingWidth ? 'var(--color-purple-500)' : 'transparent' }} />
        )}

        <div className={cn('flex-1 flex min-w-0 min-h-0 overflow-hidden', isWideMode ? 'flex-row' : 'flex-col')}>
          {/* Chat area */}
          <div className="flex flex-col min-w-0 min-h-0 overflow-hidden relative flex-1">
            {/* Panel + Messages Area */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative" data-panel-container>
              {/* 1. Panel Toolbar — tabs (inbox, contacts, agents, tasks, settings, new, close) */}
              <ChatPanelToolbar
                chatMode={chatMode} setChatMode={setChatMode}
                activePanel={activePanel} togglePanel={panel => {
                  setChatSettings(null);
                  if (chatSettings && panel === 'settings') setActivePanel('settings');
                  else resize.togglePanel(panel);
                }}
                agents={agents} users={users}
                totalUnreadCount={totalUnreadCount} refetchInbox={refetchInbox}
                createNewConversation={createNewConversation} closeChat={closeChat}
                chatPartner={chatPartner as any} isWideMode={isWideMode}
                contactsSearch={contactsSearch} setContactsSearch={setContactsSearch}
                cycleWidth={resize.cycleWidth}
                isGlued={isGlued}
                panelWidth={panelWidth}
                tasksSource={tasksSource as any}
                favoritesConfig={logic.favoritesConfig}
              />

              {/* 2. Panel content — below toolbar, above chat info */}
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
                  <div className="flex-1 overflow-y-auto">{conversationSettings ?? renderPanelContent()}</div>
                  {/* Tasks/Documents/Contacts merge their statusbar + maximize toggle into
                   *  their own list footer to avoid a duplicate row. */}
                  {activePanel !== 'tasks' && activePanel !== 'documents' && activePanel !== 'contacts' && (
                    <div className="flex-shrink-0 h-6 px-2 flex items-center justify-between border-t border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
                      <div className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-3">
                        {activePanel === 'ai-agents' && <span>{t('aiChat.ui.agentCount', { count: agents.length })}</span>}
                        {activePanel === 'settings' && <span>{t('aiChat.ui.chatSettings')}</span>}
                      </div>
                      <button type="button" onClick={resize.togglePanelMode}
                        aria-label={t(panelMode === 'fullscreen' || panelMode === 'expanded' ? 'aiChat.ui.collapse' : 'aiChat.ui.expand')}
                        className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors">
                        {panelMode === 'fullscreen' ? <ChevronDown className="w-4 h-4" /> :
                         panelMode === 'collapsed' ? <ChevronUp className="w-4 h-4" /> :
                         <Maximize2 className="w-4 h-4" />}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 3. Chat Info Bar — chat name, avatar, participants */}
              <ChatInfoBar
                chatMode={chatMode} togglePanel={resize.togglePanel}
                chatPartner={chatPartner as any} setChatPartner={setChatPartner as any}
                chatParticipants={chatParticipants as any}
                resolvedConvTitle={resolvedConvTitle}
                currentConversationId={currentConversationId} userConversationId={userConversationId}
                renameConversation={renameConversation}
                conversationMode={conversationMode}
                isAgentProcessing={isAgentProcessing}
                processingAgentName={processingAgentName}
                activeAgents={activeAgents}
              />

              {/* Bound rows strip + row binding picker */}
              <BoundRowsStrip
                boundRows={boundRows as any[]}
                setBoundRows={setBoundRows as any}
                showRowBinding={showRowBinding}
                setShowRowBinding={setShowRowBinding as any}
                setShowBoundRowsBar={setShowBoundRowsBar}
                currentConversationId={currentConversationId}
                userConversationId={userConversationId}
                effectiveSpaceId={effectiveSpaceId}
                tasksSource={tasksSource}
                favoritesConfig={logic.favoritesConfig}
                onAttachToMessage={(br: any) => setMessageBoundRows((prev: any[]) => {
                  if (prev.some((p: any) => p.table_id === br.table_id && p.row_id === br.row_id)) return prev;
                  return [...prev, br];
                })}
              />

              {/* ADR-0059 §4.6: CallBar mounts above the toolbar. Returns null while call state is idle. */}
              <CallBar />

              {/* 4. Chat Toolbar — search, MD, delete, terminal */}
              <ChatToolbar
                chatPartnerType={chatPartner?.type ?? null}
                hasSlashCommand={hasSlashCommand}
                thinkingEnabled={thinkingEnabled}
                setThinkingEnabled={setThinkingEnabled as any}
                agentMode={agentMode}
                setAgentMode={setAgentMode as any}
                markdownEnabled={markdownEnabled}
                setMarkdownEnabled={setMarkdownEnabled as any}
                showTerminal={showTerminal}
                setShowTerminal={setShowTerminal as any}
                onSummaryOpen={async () => {
                  const convId = userConversationId || currentConversationId;
                  if (!convId) return;
                  try {
                    await apiClient.post(`/chat/conversations/${convId}/summaries`);
                    setShowSummaryCarousel(true);
                  } catch (err) { logger.error('Summary error:', err); }
                }}
                showRowBinding={showRowBinding}
                setShowRowBinding={setShowRowBinding as any}
                boundRowsCount={(boundRows as any[]).length}
                currentConversationId={selectedConversationId}
                onSearchToggle={() => { setChatSearchActive(prev => !prev); setChatSearchQuery(''); setChatSearchCurrentMatch(0); }}
                searchActive={chatSearchActive}
                searchQuery={chatSearchQuery}
                onSearchQueryChange={(q: string) => { setChatSearchQuery(q); setChatSearchCurrentMatch(0); }}
                searchMatchCount={searchMatchIds.length}
                searchCurrentMatch={chatSearchCurrentMatch}
                onSearchNext={handleSearchNext}
                onSearchPrev={handleSearchPrev}
                onSelectModeToggle={() => setSelectModeActive(prev => !prev)}
                selectModeActive={selectModeActive}
                onScheduledToggle={() => setScheduledActive(prev => !prev)}
                scheduledActive={scheduledActive}
                scheduledCount={scheduled.scheduledMessages?.length ?? 0}
                onPinnedToggle={() => setPinnedListOpen(v => !v)}
                pinnedListActive={pinnedListOpen}
                pinnedCount={pinnedCount}
                onAttachFile={() => logic.fileInputRef.current?.click()}
                onAttachRow={() => {
                  logic.setShowFilePicker(prev => !prev);
                  const fav = logic.favoritesConfig;
                  const firstFav = (fav?.custom || [])[0];
                  logic.setAttachTab(
                    logic.tasksSource ? 'tickets'
                      : fav?.documents ? 'documents'
                      : firstFav ? `favorite:${firstFav.tableId}`
                      : 'other'
                  );
                }}
                onSettingsOpen={() => openChatSettings('settings')}
                onNotificationsOpen={() => openChatSettings('notifications')}
                onParticipantsOpen={() => openChatSettings('participants')}
                onDeleteChat={() => {
                  const convId = userConversationId || currentConversationId;
                  if (!convId) return;
                  setDeleteChatTarget({ convId, title: resolvedConvTitle });
                }}
                onCallClick={() => {
                  const convId = userConversationId || currentConversationId;
                  if (!convId) return;
                  const store = useCallStore.getState();
                  if (store.state === 'idle') {
                    void store.startCall(convId);
                  }
                  // If a call is already running we keep it going — the CallBar's
                  // own End button is the only way to disconnect (ADR-0059 §4.1).
                }}
                callActive={callActive}
              />

              {/* Pinned messages share the toolbar toggle and existing unpin handler. */}
              <PinnedBanner
                messages={displayMessages as any}
                open={pinnedListOpen}
                onOpenChange={setPinnedListOpen}
                onJump={(messageId) => {
                  const container = messagesContainerRef.current;
                  if (!container) return;
                  const el = container.querySelector(
                    `[data-message-id="${messageId}"]`,
                  ) as HTMLElement | null;
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }}
                activeAgents={activeAgents}
                onForward={(messageId) => {
                  const message = displayMessages.find(item => item.id === messageId);
                  if (message) handleForwardMessage(message);
                }}
                onUnpin={(messageId) => handleUnpinMessage(Number(messageId))}
                capReached={pinMutation.capReached}
                onClearCapNotice={pinMutation.clearCapNotice}
              />

              <MessagesArea
                chatMode={chatMode} chatPartner={chatPartner as any}
                displayMessages={displayMessages} markdownEnabled={markdownEnabled}
                isAgentProcessing={isAgentProcessing}
                processingAgentName={processingAgentName}
                processingStartedAt={processingStartedAt} stopAgent={stopAgent}
                messageReactions={messageReactions} quickEmojis={quickEmojis}
                currentUserId={currentUser?.id ? Number(currentUser.id) : undefined}
                currentUser={messagesCurrentUser}
                onReact={mutations.handleReaction} onCopy={mutations.handleCopyMessage}
                onForward={handleForwardMessage}
                onMove={handleMoveMessage} isChatOwner={isChatOwner}
                onPin={handlePinMessage} onUnpin={handleUnpinMessage} canPin={canPin}
                onDelete={mutations.handleDeleteMessage}
                onCheckboxClick={events.handleCheckboxClick}
                onMentionClick={handleMentionClick}
                onOpenTerminal={handleOpenTerminal}
                sendMessage={sendMessage} currentAgent={currentAgent}
                setInputValue={setInputValue as any}
                messagesEndRef={messagesEndRef} messagesContainerRef={messagesContainerRef}
                loadMoreSentinelRef={loadMoreSentinelRef}
                dragOver={dragOver} setDragOver={setDragOver} onDrop={events.handleDrop}
                isMobile={isMobile} setActivePanel={setActivePanel as any}
                hasOlderMessages={hasOlderMessages} isFetchingOlderMessages={isFetchingOlderMessages}
                hasNextAIPage={hasNextAIPage} isFetchingNextAIPage={isFetchingNextAIPage}
                showScrollToBottom={showScrollToBottom} setShowScrollToBottom={setShowScrollToBottom}
                newMessageCount={newMessageCount} setNewMessageCount={setNewMessageCount as any}
                agentWorking={agentWorking} setAgentWorking={setAgentWorking}
                activePollingError={activePollingError} activePollingStopped={activePollingStopped}
                activeReconnect={activeReconnect}
                activeAgents={activeAgents}
                error={error} localError={localError}
                isLoadingMessages={chatMode === 'ai' ? (isLoadingAIMessages || isLoading) : isLoadingUserMessages}
                fetchThinkingSteps={chatMode === 'ai' ? aiFetchThinkingSteps : userFetchThinkingSteps}
                fetchToolStepsPreview={chatMode === 'ai' ? aiFetchToolStepsPreview : userFetchToolStepsPreview}
                fetchFullMessage={chatMode === 'ai' ? aiFetchFullMessage : userFetchFullMessage}
                fetchToolSteps={chatMode === 'ai' ? aiFetchToolSteps : userFetchToolSteps}
                forwardMessageIds={forwardMessages.length > 0 ? new Set(forwardMessages.map(m => m.id).filter(Boolean)) : undefined}
                moveMessageIds={moveMessages.length > 0 ? new Set(moveMessages.map(m => m.id).filter(Boolean)) : undefined}
                setForwardMessages={setForwardMessages as any}
                onNavigateToConversation={handleNavigateToConversation}
                conversationId={activeConversationId}
              />
            </div>

            {/* WP-17: Scheduled messages bar (shown when toggled from toolbar) */}
            {scheduledActive && scheduled.scheduledMessages.length > 0 && (
              <ScheduledMessagesBar
                messages={scheduled.scheduledMessages}
                onCancel={(id) => scheduled.cancelScheduledMessage(id)}
                onReschedule={(id, newDate) => scheduled.editScheduledMessage({ smId: id, scheduled_at: newDate })}
                onSendNow={async (msg) => {
                  // ADR-0031 WP-17 follow-up: hits backend send-now endpoint that
                  // reuses the cron-poller worker code path — preserves attachments,
                  // mentions, auto-agents. Backend marks status='sent' so we don't
                  // call cancel here (invalidateQueries inside the mutation repaints).
                  try {
                    await scheduled.sendNowScheduledMessage(msg.id);
                  } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    if (/already_processed/i.test(message) || message.includes('409')) {
                      showToast(t('aiChat.ui.messageAlreadyProcessed'), 'info');
                      return;
                    }
                    logger.error('send-now failed:', err);
                    showToast(t('aiChat.ui.sendFailed', { message: message }), 'error');
                  }
                }}
                onEdit={(msg) => {
                  // If input has content, save it as a forward banner
                  if (inputValue.trim()) {
                    setForwardMessages(prev => [...prev, {
                      id: Date.now(),
                      content: inputValue,
                      role: 'user',
                      sender_name: t('aiChat.ui.draft'),
                    } as any]);
                  }
                  // Load scheduled message content into input
                  setInputValue(msg.content);
                  // Pre-fill the schedule date so it's preserved
                  setEditScheduleDate(msg.scheduled_at);
                  // Cancel the scheduled message (it's now in input for editing)
                  scheduled.cancelScheduledMessage(msg.id);
                }}
              />
            )}

            {logic.voiceNote.sendError && (
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <p role="alert" className="w-full text-sm text-[var(--color-error)]">{logic.voiceNote.sendError}</p>
                <Button type="button" size="sm" disabled={isTranscribing} onClick={() => void logic.voiceNote.retry()}>
                  {t('aiChat.ui.retryVoiceNote')}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={isTranscribing} onClick={logic.voiceNote.discard}>
                  {t('aiChat.ui.discardVoiceNote')}
                </Button>
              </div>
            )}

            <InputArea
              inputValue={inputValue} setInputValue={setInputValue as any}
              attachments={attachments} setAttachments={setAttachments as any}
              mentionedUsers={mentionedUsers as any} setMentionedUsers={setMentionedUsers as any}
              messageBoundRows={messageBoundRows as any} setMessageBoundRows={setMessageBoundRows as any}
              showFilePicker={showFilePicker} setShowFilePicker={setShowFilePicker as any}
              attachTab={attachTab} setAttachTab={setAttachTab}
              filesSource={filesSource} updateFilesSource={updateFilesSource}
              projectFiles={projectFiles} isLoadingFiles={isLoadingFiles}
              filesSearch={filesSearch} setFilesSearch={setFilesSearch}
              effectiveSpaceId={effectiveSpaceId} tasksSource={tasksSource as any}
              favoritesConfig={logic.favoritesConfig}
              chatPartner={chatPartner as any} hasSlashCommand={hasSlashCommand}
              thinkingEnabled={thinkingEnabled} setThinkingEnabled={setThinkingEnabled as any}
              agentMode={agentMode} setAgentMode={setAgentMode as any}
              markdownEnabled={markdownEnabled} setMarkdownEnabled={setMarkdownEnabled as any}
              showTerminal={showTerminal} setShowTerminal={setShowTerminal as any}
              isRecording={isRecording} isTranscribing={isTranscribing}
              recordingDisabled={!!logic.voiceNote.pendingFile} isSendingVoiceNote={logic.voiceNote.isSending}
              voiceError={voiceError} recordingDuration={recordingDuration} recordingStream={recordingStream}
              startRecording={startRecording} stopRecording={stopRecording} cancelRecording={cancelRecording}
              voiceMode={voiceMode}
              isLoading={isLoading} isAgentProcessing={isAgentProcessing} stopAgent={stopAgent}
              handleSubmit={events.handleSubmit} handleFileSelect={events.handleFileSelect}
              fileInputRef={fileInputRef as any}
              availableMentionUsers={availableMentionUsers} availableSlashAgents={availableSlashAgents}
              panelMode={panelMode}
              onPasteFiles={(files) => setAttachments(prev => [...prev, ...files])}
              forwardMessages={forwardMessages}
              setForwardMessages={setForwardMessages}
              moveMessages={moveMessages}
              setMoveMessages={setMoveMessages}
              onMoveAttempt={() => setActivePanel('inbox')}
              currentConversationId={currentConversationId ?? userConversationId ?? undefined}
              scheduledActive={scheduledActive}
              setScheduledActive={setScheduledActive}
              scheduledCount={scheduled.scheduledMessages?.length ?? 0}
              isScheduling={scheduled.isScheduling}
              initialScheduleDate={editScheduleDate}
              onScheduleMessage={async (isoDate) => {
                const convId = currentConversationId ?? userConversationId;
                if (!convId || !inputValue.trim()) return;
                // Upload attachments if any
                let uploadedAttachments: Array<{ id: string; name: string; type: string; size: number; url?: string; preview?: string }> | undefined;
                if (attachments.length > 0) {
                  try {
                    const uploadResult = await filesApi.upload([...attachments], { spaceId: effectiveSpaceId });
                    const uploadedFiles = Array.isArray(uploadResult) ? uploadResult : [uploadResult];
                    uploadedAttachments = attachments.map((file, idx) => {
                      const uploaded = uploadedFiles[idx];
                      return { id: uploaded?.id || `att_${Date.now()}_${file.name}`, name: file.name, type: file.type, size: file.size, url: uploaded?.url || '', preview: file.type.startsWith('image/') ? (uploaded?.url || '') : undefined };
                    });
                  } catch {
                    uploadedAttachments = attachments.map(file => ({ id: `att_${Date.now()}_${file.name}`, name: file.name, type: file.type, size: file.size }));
                  }
                }
                await scheduled.scheduleMessage({
                  conversationId: convId,
                  content: inputValue.trim(),
                  scheduled_at: isoDate,
                  ...(uploadedAttachments && uploadedAttachments.length > 0 && { attachments: uploadedAttachments }),
                });
                setInputValue('');
                setAttachments(() => []);
                setEditScheduleDate(null);
              }}
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
              <div role="slider" tabIndex={0} aria-label="Ширина панели чата" aria-orientation="horizontal" aria-valuenow={sidebarWidth} aria-valuemin={300} aria-valuemax={500}
                onKeyDown={resize.handleSidebarResizeKeyDown}
                onMouseDown={resize.handleSidebarResizeStart}
                onTouchStart={resize.handleSidebarTouchResizeStart}
                className={cn("w-1 cursor-col-resize hover:bg-[var(--color-primary-500)]/30 transition-colors flex-shrink-0 touch-none",
                  isResizingSidebar && "bg-[var(--color-primary-500)]/50")} />
              <div className="border-l border-[var(--border-primary)] flex-shrink-0 overflow-hidden flex flex-col bg-[var(--bg-secondary)]"
                style={{ width: sidebarWidth }}>
                <div className="flex-1 overflow-y-auto">{conversationSettings ?? renderPanelContent()}</div>
              </div>
            </>
          )}
        </div>

        {editingAgentId && (
          <Suspense fallback={null}>
            <AgentEditModal isOpen={!!editingAgentId} onClose={() => setEditingAgentId(null)}
              agent={agents.find(a => a.id === editingAgentId) || null}
              onSave={() => { loadAgents(); }} />
          </Suspense>
        )}

        {previewFile && (
          <Suspense fallback={null}>
            <FilePreviewModal isOpen={!!previewFile} onClose={() => setPreviewFile(null)}
              fileUrl={previewFile.url} fileName={previewFile.name} fileType={detectFileType(previewFile.url)} />
          </Suspense>
        )}

        {showSummaryCarousel && (
          <Suspense fallback={null}>
            <SummaryCarousel
              conversationId={currentConversationId ?? userConversationId ?? null}
              isVisible={showSummaryCarousel}
              onClose={() => setShowSummaryCarousel(false)}
            />
          </Suspense>
        )}

        {showSpawnTicketModal && (
          <Suspense fallback={null}>
            <SpawnTicketModal
              open={showSpawnTicketModal}
              conversationId={currentConversationId ?? userConversationId ?? null}
              onClose={() => setShowSpawnTicketModal(false)}
            />
          </Suspense>
        )}

        {deleteChatTarget && (
          <Suspense fallback={null}>
            <DeleteChatModal
              open={!!deleteChatTarget}
              chatTitle={deleteChatTarget.title ?? undefined}
              onCancel={() => setDeleteChatTarget(null)}
              onConfirm={async () => {
                try {
                  await deleteConversation(deleteChatTarget.convId);
                } finally {
                  setDeleteChatTarget(null);
                }
              }}
            />
          </Suspense>
        )}

      </div>
    </>
    </HumanChatPresenceContext.Provider>
    </MentionUsersProvider>
    </ValidSlugsProvider>
  );
}
