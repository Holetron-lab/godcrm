/**
 * useChatState Hook
 * Centralized state management for all 47+ useState hooks from AIChatPanel
 */

import { useChatInputMode } from '@/shared/hooks/useChatInputMode';
import { useState, useEffect, useCallback, type SetStateAction } from 'react';
import { ChatState, ChatActions, PanelTab, ChatPartner, TasksSourceConfig, FilesSourceConfig, FavoritesConfig, AttachTabId, PanelMode, AgentMode, SettingsTab, UserTypeFilter, SortOption, VoiceInputMode, AgentChat, MessageReaction, ReplyTo } from '../types';
import { MentionUser } from '../../../components/MentionInput';
import { BoundRow } from '../../../components/RowBindingV2';
import { Participant } from '../../../components/ParticipantSelector';

const EMPTY_DRAFT = { text: '', attachments: [] as File[], mentionedUsers: [] as MentionUser[], messageBoundRows: [] as BoundRow[], replyTo: null as ReplyTo | null };

const DEFAULT_QUICK_EMOJIS = ['👍', '❤️', '😂', '🔥', '💯', '🙏', '😍', '😮'];

/**
 * @param opts.fillContainer — embed-only (ADR-176 split): make the panel fill its
 * host frame using the panel's *own* glue logic instead of a fixed panelWidth.
 * Initialises glued=true + panelWidth=viewport width so `sync()` keeps the panel
 * pinned to the (resizable) iframe width, and isWideMode (panelWidth≥600) flips
 * to the two-column desktop layout — identical expansion behaviour to the in-app
 * panel. Glued/width are NOT persisted in this mode (the embed shares its origin's
 * localStorage with the edit app — persisting would bleed into it).
 */
export function useChatState(opts?: {
  fillContainer?: boolean;
  currentConversationId?: number | null;
  pendingConversationId?: number | null;
}) {
  const fillContainer = opts?.fillContainer ?? false;
  // UI State
  const [activePanel, setActivePanel] = useState<PanelTab>('none');
  const [chatMode, setChatMode] = useState<'ai' | 'people'>('ai');
  const [chatPartner, setChatPartner] = useState<ChatPartner | null>(null);
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [boundRows, setBoundRows] = useState<BoundRow[]>([]);
  const [chatParticipants, setChatParticipants] = useState<Participant[]>([]);
  const [tasksSource, setTasksSource] = useState<TasksSourceConfig | undefined>();
  const [filesSource, setFilesSource] = useState<FilesSourceConfig | undefined>();
  const [favoritesConfig, setFavoritesConfig] = useState<FavoritesConfig | undefined>();
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [attachTab, setAttachTab] = useState<AttachTabId>('files');

  // Panel sizing and layout — width/sidebarWidth persist per-device via localStorage
  // so user's preferred size is restored on reopen (no server-side setting).
  const [panelHeight, setPanelHeight] = useState<number | 'auto'>('auto');
  const [panelMode, setPanelMode] = useState<PanelMode>('default');
  const [isResizing, setIsResizing] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    // Embed fill: start at the frame width so the first paint already fills (no
    // gap flash before sync() re-glues to the live viewport).
    if (fillContainer && typeof window !== 'undefined') return window.innerWidth;
    try {
      const v = localStorage.getItem('chat-panel-width');
      const n = v ? parseInt(v, 10) : NaN;
      if (Number.isFinite(n) && n >= 320 && n <= 1170) return n;
    } catch { /* Use the default panel width when browser storage is unavailable. */ }
    return 420;
  });
  // favoriteWidth = the user's preferred mid-range width, used as a cycle stop
  // by the toolbar width-cycle button (min → favorite → max). Updated only on
  // drag-commit (so toggling to min via the button doesn't clobber it).
  const [favoriteWidth, setFavoriteWidth] = useState<number>(() => {
    try {
      const v = localStorage.getItem('chat-panel-favorite-width');
      const n = v ? parseInt(v, 10) : NaN;
      if (Number.isFinite(n) && n >= 320 && n <= 1170) return n;
    } catch { /* Use the default favorite width when browser storage is unavailable. */ }
    return 420;
  });
  const [isResizingWidth, setIsResizingWidth] = useState(false);
  // isGlued = user dragged panel past freeMax → fill remaining viewport. Persisted
  // separately from panelWidth so sync() can re-glue to the new gluedMax whenever
  // the viewport or sidebar layout changes (without losing the user's preferred
  // free-mode width).
  const [isGlued, setIsGlued] = useState<boolean>(() => {
    if (fillContainer) return true; // embed fill: glued to the frame from the start
    try { return localStorage.getItem('chat-panel-glued') === '1'; } catch { return false; }
  });
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const v = localStorage.getItem('chat-panel-sidebar-width');
      const n = v ? parseInt(v, 10) : NaN;
      if (Number.isFinite(n) && n >= 180 && n <= 500) return n;
    } catch { /* Use the default sidebar width when browser storage is unavailable. */ }
    return 256;
  });
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  useEffect(() => {
    // Only persist the user's free-mode width — don't overwrite it with the
    // viewport-derived glued width (which is recomputed on every sync).
    if (isGlued) return;
    try { localStorage.setItem('chat-panel-width', String(panelWidth)); } catch { /* Keep the in-memory width when browser storage cannot persist it. */ }
  }, [panelWidth, isGlued]);
  useEffect(() => {
    if (fillContainer) return; // don't bleed the forced-glue state into the edit app's localStorage
    try { localStorage.setItem('chat-panel-glued', isGlued ? '1' : '0'); } catch { /* Keep the in-memory docking mode when browser storage cannot persist it. */ }
  }, [isGlued, fillContainer]);
  useEffect(() => {
    try { localStorage.setItem('chat-panel-favorite-width', String(favoriteWidth)); } catch { /* Keep the in-memory favorite width when browser storage cannot persist it. */ }
  }, [favoriteWidth]);
  useEffect(() => {
    try { localStorage.setItem('chat-panel-sidebar-width', String(sidebarWidth)); } catch { /* Keep the in-memory sidebar width when browser storage cannot persist it. */ }
  }, [sidebarWidth]);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [mobileKeyboardHeight, setMobileKeyboardHeight] = useState(0);

  // Processing elapsed time (for stuck state detection)
  const [processingElapsed, setProcessingElapsed] = useState(0);

  // Settings and modes
  const [markdownEnabled, setMarkdownEnabled] = useState(true);
  const [agentMode, setAgentMode] = useState<AgentMode>('agent');
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('ai');
  const [localError, setLocalError] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const [terminalFocusSessionId, setTerminalFocusSessionId] = useState<number | undefined>();

  // Search states
  const [contactsSearch, setContactsSearch] = useState('');
  const [agentsSearch, setAgentsSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [filesSearch, setFilesSearch] = useState('');
  const [tasksSearch, setTasksSearch] = useState('');
  const [userTypeFilter, setUserTypeFilter] = useState<UserTypeFilter>('all');
  const [showFavorites, setShowFavorites] = useState(false);
  const [favorites, setFavorites] = useState<number[]>(() => {
    try { const v = localStorage.getItem('chat-favorites'); return v ? JSON.parse(v) : []; } catch { return []; }
  });
  // Persist favorites to localStorage
  useEffect(() => { try { localStorage.setItem('chat-favorites', JSON.stringify(favorites)); } catch { /* Keep favorites usable in memory when browser storage cannot persist them. */ } }, [favorites]);

  // Inbox sort & unread filter
  const [inboxSortBy, setInboxSortBy] = useState<'created' | 'updated'>('updated');
  const [inboxSortDir, setInboxSortDir] = useState<'asc' | 'desc'>('desc');
  const [inboxUnreadOnly, setInboxUnreadOnly] = useState(false);
  const [inboxUserFilter, setInboxUserFilter] = useState<string[]>([]);
  const [inboxParticipantMode, setInboxParticipantMode] = useState<'any' | 'all'>('any');

  const [showRowBinding, setShowRowBinding] = useState(false);
  const [showBoundRowsBar, setShowBoundRowsBar] = useState(false);
  const [showMessageRowPicker, setShowMessageRowPicker] = useState(false);
  const [showTasksSelector, setShowTasksSelector] = useState(false);
  const [expandedTaskChats, setExpandedTaskChats] = useState<number | null>(null);
  const [showAllContacts, setShowAllContacts] = useState(false);
  const [taskProjectId, setTaskProjectId] = useState<number | null>(null);
  
  // Chat-specific settings
  const [chatOperatorId, setChatOperatorId] = useState<number | null>(null);
  const [chatModelId, setChatModelId] = useState<string>('');
  const [chatSystemPrompt, setChatSystemPrompt] = useState<string>('');
  const [isSavingAgentSettings, setIsSavingAgentSettings] = useState(false);
  
  // Sorting
  const [sortOption, setSortOption] = useState<SortOption>('date');
  
  // Agent management
  const [editingAgentId, setEditingAgentId] = useState<number | null>(null);
  const [defaultAgentId, setDefaultAgentId] = useState<number | null>(null);
  const [isSavingDefaultAgent, setIsSavingDefaultAgent] = useState(false);
  const [favoriteAgents, setFavoriteAgents] = useState<number[]>([]);
  const [showFavoriteAgents, setShowFavoriteAgents] = useState(false);
  const [expandedAgentId, setExpandedAgentId] = useState<number | null>(null);
  
  // Vector search
  const [isVectorSearching, setIsVectorSearching] = useState(false);
  const [vectorSearchResults, setVectorSearchResults] = useState<number[] | null>(null);
  
  // Agent chats cache
  const [agentChats, setAgentChats] = useState<Record<number, AgentChat[]>>({});
  
  // Quick reactions
  const [quickEmojis, setQuickEmojis] = useState<string[]>(DEFAULT_QUICK_EMOJIS);
  const [isSavingEmojis, setIsSavingEmojis] = useState(false);
  
  // Message reactions cache
  const [messageReactions, setMessageReactions] = useState<Record<number, Record<string, MessageReaction[]>>>({});
  
  // Voice input
  const [voiceMode, setVoiceMode] = useState<VoiceInputMode>('webSpeech');

  // Scroll-to-bottom arrow visibility (Ticket #37259)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  // New message counter — tracks only human-visible messages (not tool_call/tool_result/thinking)
  const [newMessageCount, setNewMessageCount] = useState(0);
  // Agent working indicator — shown when agent is processing (tool calls arriving, no final text yet)
  const [agentWorking, setAgentWorking] = useState(false);

  // User/group chat conversation id (ADR-024)
  const [userConversationId, setUserConversationId] = useState<number | null>(null);

  const conversationId = chatPartner?.type === 'agent'
    ? opts?.pendingConversationId ?? opts?.currentConversationId ?? null : userConversationId;
  const partnerKey = chatPartner ? `${chatPartner.type}:${chatPartner.id}` : 'none';
  const { mode: inputMode } = useChatInputMode();
  const [sharedText, setSharedText] = useState('');
  const [previousInputMode, setPreviousInputMode] = useState(inputMode);
  const [drafts, setDrafts] = useState([{ conversationId, partnerKey, ...EMPTY_DRAFT }]);
  let draftIndex = drafts.findIndex(draft => conversationId !== null
    ? draft.conversationId === conversationId
    : draft.conversationId === null && draft.partnerKey === partnerKey);

  // Allocate before commit: no frame may show another conversation's text.
  if (draftIndex === -1) {
    draftIndex = drafts.length;
    setDrafts([...drafts, { conversationId, partnerKey, ...EMPTY_DRAFT }]);
  }

  const draft = drafts[draftIndex] ?? EMPTY_DRAFT;
  // Keep existing per-chat drafts when changing modes; seed only an empty slot.
  if (previousInputMode !== inputMode) {
    setPreviousInputMode(inputMode);
    if (inputMode === 'shared') {
      if (!sharedText) setSharedText(draft.text);
    } else if (!draft.text) setDrafts(previous => previous.map((item, index) =>
      index === draftIndex ? { ...item, text: sharedText } : item));
  }
  const updateDraft = useCallback(<K extends keyof typeof EMPTY_DRAFT>(key: K, value: SetStateAction<(typeof EMPTY_DRAFT)[K]>) => {
    setDrafts(previous => previous.map((item, index) => index === draftIndex
      ? { ...item, [key]: typeof value === 'function' ? value(item[key]) : value }
      : item));
  }, [draftIndex]);
  const setInputValue = useCallback((value: SetStateAction<string>) => {
    if (inputMode === 'shared') setSharedText(value);
    else updateDraft('text', value);
  }, [inputMode, updateDraft]);
  const setAttachments = useCallback((value: SetStateAction<File[]>) => updateDraft('attachments', value), [updateDraft]);
  const setMentionedUsers = useCallback((value: SetStateAction<MentionUser[]>) => updateDraft('mentionedUsers', value), [updateDraft]);
  const setMessageBoundRows = useCallback((value: SetStateAction<BoundRow[]>) => updateDraft('messageBoundRows', value), [updateDraft]);
  const setReplyTo = useCallback((value: SetStateAction<ReplyTo | null>) => updateDraft('replyTo', value), [updateDraft]);
  const { attachments, mentionedUsers, messageBoundRows, replyTo } = draft;
  // Only creation can promote a draft. Navigation to an existing chat must not.
  // Preserve the slot so pending sends/transcriptions still address their draft.
  const bindDraftToConversation = useCallback((id: number) => {
    setDrafts(previous => previous.map((draft, index) => index === draftIndex
      ? { ...draft, conversationId: id } : draft));
  }, [draftIndex]);
  const inputValue = inputMode === 'shared' ? sharedText : draft.text;

  // Mobile detection effect
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Combine all state into a single object
  const state: ChatState = {
    activePanel,
    chatMode,
    chatPartner,
    inputValue,
    attachments,
    previewFile,
    dragOver,
    mentionedUsers,
    boundRows,
    messageBoundRows,
    chatParticipants,
    tasksSource,
    filesSource,
    favoritesConfig,
    showFilePicker,
    attachTab,
    panelHeight,
    panelMode,
    isResizing,
    panelWidth,
    favoriteWidth,
    isResizingWidth,
    isGlued,
    sidebarWidth,
    isResizingSidebar,
    isMobile,
    mobileKeyboardHeight,
    processingElapsed,
    markdownEnabled,
    agentMode,
    thinkingEnabled,
    settingsTab,
    localError,
    showTerminal,
    terminalFocusSessionId,
    contactsSearch,
    agentsSearch,
    historySearch,
    filesSearch,
    tasksSearch,
    userTypeFilter,
    showFavorites,
    favorites,
    showRowBinding,
    showBoundRowsBar,
    showMessageRowPicker,
    showTasksSelector,
    expandedTaskChats,
    showAllContacts,
    taskProjectId,
    chatOperatorId,
    chatModelId,
    chatSystemPrompt,
    isSavingAgentSettings,
    sortOption,
    editingAgentId,
    defaultAgentId,
    isSavingDefaultAgent,
    favoriteAgents,
    showFavoriteAgents,
    expandedAgentId,
    isVectorSearching,
    vectorSearchResults,
    agentChats,
    quickEmojis,
    isSavingEmojis,
    messageReactions,
    voiceMode,
    showScrollToBottom,
    newMessageCount,
    agentWorking,
    userConversationId,
    replyTo
  };

  // Combine all actions into a single object
  const actions: ChatActions = {
    setActivePanel,
    setChatMode,
    setChatPartner,
    setInputValue,
    setAttachments,
    setPreviewFile,
    setDragOver,
    setMentionedUsers,
    setBoundRows,
    setMessageBoundRows,
    setChatParticipants,
    setTasksSource,
    setFilesSource,
    setFavoritesConfig,
    setShowFilePicker,
    setAttachTab,
    setPanelHeight,
    setPanelMode,
    setIsResizing,
    setPanelWidth,
    setFavoriteWidth,
    setIsResizingWidth,
    setIsGlued,
    setSidebarWidth,
    setIsResizingSidebar,
    setMobileKeyboardHeight,
    setProcessingElapsed,
    setMarkdownEnabled,
    setAgentMode,
    setThinkingEnabled,
    setSettingsTab,
    setLocalError,
    setShowTerminal,
    setTerminalFocusSessionId,
    setContactsSearch,
    setAgentsSearch,
    setHistorySearch,
    setFilesSearch,
    setTasksSearch,
    setUserTypeFilter,
    setShowFavorites,
    setFavorites,
    inboxSortBy, setInboxSortBy,
    inboxSortDir, setInboxSortDir,
    inboxUnreadOnly, setInboxUnreadOnly,
    inboxUserFilter, setInboxUserFilter,
    inboxParticipantMode, setInboxParticipantMode,
    setShowRowBinding,
    setShowBoundRowsBar,
    setShowMessageRowPicker,
    setShowTasksSelector,
    setExpandedTaskChats,
    setShowAllContacts,
    setTaskProjectId,
    setChatOperatorId,
    setChatModelId,
    setChatSystemPrompt,
    setIsSavingAgentSettings,
    setSortOption,
    setEditingAgentId,
    setDefaultAgentId,
    setIsSavingDefaultAgent,
    setFavoriteAgents,
    setShowFavoriteAgents,
    setExpandedAgentId,
    setIsVectorSearching,
    setVectorSearchResults,
    setAgentChats,
    setQuickEmojis,
    setIsSavingEmojis,
    setMessageReactions,
    setVoiceMode,
    setShowScrollToBottom,
    setNewMessageCount,
    setAgentWorking,
    setUserConversationId,
    setReplyTo
  };

  return { state, actions, bindDraftToConversation };
}
