import { useLanguage } from '@/shared/i18n/LanguageContext';
/**
 * usePanelContentWiring — Builds the dependency bag for usePanelContent.
 * ADR-119: Extracted from AIChatPanel.tsx to reduce orchestrator size.
 */
import { useState, useRef, useMemo } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import { renderPanelContentFromDeps } from './usePanelContent/index';
import { unlockAgent } from '../../../api/unlockAgent';
import { lockedAgentsForManagement } from '../../../utils/agentVisibility';
import type { PanelContentDeps } from './usePanelContent/PanelContentTypes';
import type { ChatActions, ChatState } from '../types';
import type { AIAgent } from '../../../types';

interface PanelContentWiringParams {
  // Panel state
  activePanel: string;
  setActivePanel: (v: any) => void;
  contactsSearch: string;
  setContactsSearch: (v: string) => void;
  showFavorites: boolean;
  setShowFavorites: (v: any) => void;
  userTypeFilter: ChatState['userTypeFilter'];
  setUserTypeFilter: ChatActions['setUserTypeFilter'];
  showAllContacts: boolean;
  setShowAllContacts: (v: any) => void;
  users: any[];
  isLoadingUsers: boolean;
  chatParticipants: any[];
  chatPartner: any;
  favorites: number[];
  setFavorites: ChatActions['setFavorites'];
  setUserConversationId: (v: number | null) => void;
  setChatPartner: (v: any) => void;
  setChatParticipants: (v: any) => void;
  setBoundRows: (v: any) => void;
  setShowBoundRowsBar: (v: boolean) => void;
  handleAgentSelect: (agent: AIAgent) => void;
  selectConversation: (id: number) => void;
  openTaskChat?: (chat: { conversationId: number; tableId: number; rowId: number; rowTitle?: string }) => void;
  createNewConversation: () => void;
  forceNewChatRef: React.MutableRefObject<boolean>;
  setChatMode: ChatActions['setChatMode'];
  clearMessages: () => void;
  // Agents
  agentsSearch: string;
  setAgentsSearch: (v: string) => void;
  agents: AIAgent[];
  /** Every binding incl. locked Tier-B rows (ADR-0079) — the owner list shows them with an unlock action. */
  mentionAgents: AIAgent[];
  loadAgents: () => Promise<void>;
  isLoadingAgents: boolean;
  currentAgent: AIAgent | null;
  showFavoriteAgents: boolean;
  setShowFavoriteAgents: (v: any) => void;
  favoriteAgents: number[];
  setFavoriteAgents: (v: any) => void;
  isVectorSearching: boolean;
  vectorSearchResults: any;
  setVectorSearchResults: (v: any) => void;
  setIsVectorSearching: (v: boolean) => void;
  currentSpaceId: number | undefined;
  createTablesMutation: any;
  currentSpace: any;
  // Inbox
  inboxConversations: any;
  isLoadingInbox: boolean;
  totalUnreadCount: number;
  refetchInbox: () => void;
  fetchNextInboxPage: () => void;
  hasNextInboxPage: boolean;
  isFetchingNextInboxPage: boolean;
  inboxSearch: string;
  setInboxSearch: (v: string) => void;
  inboxAgentFilter: string;
  setInboxAgentFilter: (v: string) => void;
  inboxTypeFilter: 'all' | 'ai' | 'group' | 'direct' | 'service';
  setInboxTypeFilter: (v: 'all' | 'ai' | 'group' | 'direct' | 'service') => void;
  inboxDateFrom: string;
  setInboxDateFrom: (v: string) => void;
  inboxDateTo: string;
  setInboxDateTo: (v: string) => void;
  showInboxFilters: boolean;
  setShowInboxFilters: (v: boolean) => void;
  inboxSortBy: 'created' | 'updated';
  setInboxSortBy: (v: 'created' | 'updated') => void;
  inboxSortDir: 'asc' | 'desc';
  setInboxSortDir: (v: 'asc' | 'desc') => void;
  inboxUnreadOnly: boolean;
  setInboxUnreadOnly: (v: boolean) => void;
  inboxUserFilter: string[];
  setInboxUserFilter: (v: string[]) => void;
  inboxParticipantMode: 'any' | 'all';
  setInboxParticipantMode: (v: 'any' | 'all') => void;
  markAsReadMutation: any;
  selectAgent: (agent: AIAgent) => void;
  renameConversation: (id: number, title: string) => void;
  deleteConversation: (id: number) => void;
  userConversationId: number | null;
  currentConversationId: number | null | undefined;
  allTablesDataMain: any;
  // Tasks
  tasksSource: any;
  filteredTaskRows: any;
  isLoadingTasks: boolean;
  taskRows: any[];
  tasksTotal: number;
  taskStatusDict: any;
  tasksTableColumns: any;
  tasksSearch: string;
  setTasksSearch: (v: string) => void;
  setTasksSource: (v: any) => void;
  fetchNextTasksPage?: () => void;
  hasNextTasksPage?: boolean;
  isFetchingNextTasksPage?: boolean;
  expandedTaskChats: any;
  setExpandedTaskChats: (v: any) => void;
  conversations: any[];
  effectiveSpaceId: number | undefined;
  // Settings
  settingsTab: ChatState['settingsTab'];
  setSettingsTab: ChatActions['setSettingsTab'];
  chatOperatorId: any;
  setChatOperatorId: (v: any) => void;
  chatModelId: string;
  setChatModelId: (v: string) => void;
  chatSystemPrompt: string;
  setChatSystemPrompt: (v: string) => void;
  operators: any;
  models: any;
  isAdminOrOwner: boolean;
  isSavingAgentSettings: boolean;
  saveAgentSettings: () => void;
  messages: any[];
  contextSettings: any;
  setContextSettings: (v: any) => void;
  saveContextSettings: any;
  isSavingContextSettings: boolean;
  defaultAgentId: number | null;
  saveDefaultAgent: any;
  isSavingDefaultAgent: boolean;
  summaryAgentId?: number | null;
  isSavingSummaryAgent?: boolean;
  onSummaryAgentChange?: (agentId: number | null) => void;
  translationAgentId?: number | null;
  isSavingTranslationAgent?: boolean;
  onTranslationAgentChange?: (agentId: number | null) => void;
  quickEmojis: string[];
  setQuickEmojis: (v: string[]) => void;
  saveQuickEmojis: any;
  isSavingEmojis: boolean;
  voiceMode: ChatState['voiceMode'];
  setVoiceMode: ChatActions['setVoiceMode'];
  voiceError: string | null;
  webSpeechAvailable: boolean;
  filesSource: any;
  setFilesSource: (v: any) => void;
  favoritesConfig?: any;
  updateFavoritesConfig?: (config: any) => void;
  updateTasksSource: (config: any) => void;
  updateFilesSource: (config: any) => void;
  attachRowToMessage?: (br: { table_id: number; row_id: number; table_name?: string; table_icon?: string; row_title?: string }) => void;
  isWideMode: boolean;
  panelMode?: 'collapsed' | 'default' | 'expanded' | 'fullscreen';
  togglePanelMode?: () => void;
}

export function usePanelContentWiring(params: PanelContentWiringParams) {
  const { t } = useLanguage();
  const {
    activePanel, setActivePanel, contactsSearch, setContactsSearch,
    showFavorites, setShowFavorites, userTypeFilter, setUserTypeFilter,
    showAllContacts, setShowAllContacts, users, isLoadingUsers,
    chatParticipants, chatPartner, favorites, setFavorites,
    setUserConversationId, setChatPartner, setChatParticipants, setBoundRows,
    setShowBoundRowsBar, handleAgentSelect, selectConversation, openTaskChat, createNewConversation,
    forceNewChatRef, setChatMode, clearMessages,
    agentsSearch, setAgentsSearch, agents, mentionAgents, loadAgents, isLoadingAgents, currentAgent,
    showFavoriteAgents, setShowFavoriteAgents, favoriteAgents, setFavoriteAgents,
    isVectorSearching, vectorSearchResults, setVectorSearchResults, setIsVectorSearching,
    currentSpaceId, createTablesMutation, currentSpace,
    inboxConversations, isLoadingInbox, totalUnreadCount, refetchInbox,
    fetchNextInboxPage, hasNextInboxPage, isFetchingNextInboxPage,
    inboxSearch, setInboxSearch, inboxAgentFilter, setInboxAgentFilter,
    inboxTypeFilter, setInboxTypeFilter,
    inboxDateFrom, setInboxDateFrom, inboxDateTo, setInboxDateTo,
    showInboxFilters, setShowInboxFilters,
    inboxSortBy, setInboxSortBy, inboxSortDir, setInboxSortDir,
    inboxUnreadOnly, setInboxUnreadOnly,
    inboxUserFilter, setInboxUserFilter,
    inboxParticipantMode, setInboxParticipantMode,
    markAsReadMutation, selectAgent, renameConversation, deleteConversation,
    userConversationId, currentConversationId, allTablesDataMain,
    tasksSource, filteredTaskRows, isLoadingTasks, taskRows, tasksTotal, taskStatusDict,
    tasksTableColumns, tasksSearch, setTasksSearch,
    fetchNextTasksPage, hasNextTasksPage, isFetchingNextTasksPage,
    expandedTaskChats, setExpandedTaskChats, conversations, effectiveSpaceId,
    settingsTab, setSettingsTab, chatOperatorId, setChatOperatorId,
    chatModelId, setChatModelId, chatSystemPrompt, setChatSystemPrompt,
    operators, models, isAdminOrOwner, isSavingAgentSettings, saveAgentSettings,
    messages, contextSettings, setContextSettings, saveContextSettings,
    isSavingContextSettings, defaultAgentId, saveDefaultAgent, isSavingDefaultAgent,
    summaryAgentId, isSavingSummaryAgent, onSummaryAgentChange,
    translationAgentId, isSavingTranslationAgent, onTranslationAgentChange,
    quickEmojis, setQuickEmojis, saveQuickEmojis, isSavingEmojis,
    voiceMode, setVoiceMode, voiceError, webSpeechAvailable,
    filesSource,
    favoritesConfig, updateFavoritesConfig,
    updateTasksSource: updateTasksSourcePersist, updateFilesSource: updateFilesSourcePersist,
    attachRowToMessage,
    isWideMode,
    panelMode, togglePanelMode,
  } = params;

  const filteredUsers = users.filter(u => {
    const ms = !contactsSearch || u.name.toLowerCase().includes(contactsSearch.toLowerCase()) || u.email?.toLowerCase().includes(contactsSearch.toLowerCase());
    const isAg = u.managed_by_agent_table_id != null || u.user_type === 'agent' || u.user_type === 'bot';
    const isSvc = u.user_type === 'service';
    const mt = userTypeFilter === 'all' || (userTypeFilter === 'humans' && !isAg && !isSvc) || (userTypeFilter === 'agents' && (isAg || isSvc));
    const mf = !showFavorites || favorites.includes(u.id);
    return ms && mt && mf;
  });

  // ADR-0079 §2: the owner agent list is a management surface, so admins also see the
  // locked Tier-B bindings the invocation list drops — with an unlock action per row.
  const managedAgents = isAdminOrOwner ? [...agents, ...lockedAgentsForManagement(agents, mentionAgents)] : agents;
  const filteredAgents = managedAgents.filter(a => {
    const sl = agentsSearch?.toLowerCase() || '';
    const ms = !agentsSearch || a.name.toLowerCase().includes(sl) || a.description?.toLowerCase().includes(sl);
    const mf = !showFavoriteAgents || favoriteAgents.includes(a.id);
    return ms && mf;
  });

  const hasActiveInboxFilters = !!(inboxSearch || inboxAgentFilter || inboxUserFilter.length > 0 || inboxDateFrom || inboxDateTo);

  // Compute agent options from conversations (agents that have chats)
  const inboxAgentOptions = useMemo(() => {
    const convs = inboxConversations || [];
    const agentMap = new Map<number, { id: number; name: string; icon?: string | null }>();
    for (const conv of convs) {
      if (conv.agent_id) {
        const ag = agents.find(a => a.id === conv.agent_id);
        agentMap.set(conv.agent_id, {
          id: conv.agent_id,
          name: ag?.name || conv.agent_name || t('aiChat.ui.agentNumber', { id: conv.agent_id }),
          icon: ag?.icon || conv.agent_icon || null,
        });
      }
    }
    return Array.from(agentMap.values());
  }, [inboxConversations, agents, t]);

  // Compute user options from conversation participants
  const inboxUserOptions = useMemo(() => {
    const convs = inboxConversations || [];
    const userMap = new Map<number, { id: number; name: string; avatar_url?: string | null }>();
    for (const conv of convs) {
      for (const p of (conv.participants || [])) {
        if (!userMap.has(p.user_id)) {
          userMap.set(p.user_id, { id: p.user_id, name: p.name || t('aiChat.ui.userNumber', { id: p.user_id }), avatar_url: p.avatar_url });
        }
      }
    }
    // Also add from the full users list for broader coverage
    for (const u of users) {
      if (!userMap.has(u.id)) {
        userMap.set(u.id, { id: u.id, name: u.name, avatar_url: u.avatar_url });
      }
    }
    return Array.from(userMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [inboxConversations, users, t]);

  // Inbox rename state (required by InboxPanelContent)
  const [inboxRenamingId, setInboxRenamingId] = useState<number | null>(null);
  const [inboxRenamingTitle, setInboxRenamingTitle] = useState('');
  const inboxRenameInputRef = useRef<HTMLInputElement>(null);

  const deps: PanelContentDeps = ({
    activePanel, setActivePanel,
    contactsSearch, setContactsSearch,
    showFavorites, setShowFavorites,
    userTypeFilter, setUserTypeFilter,
    showAllContacts, setShowAllContacts,
    filteredUsers, usersTotalCount: users.length, isLoadingUsers,
    chatParticipants, chatPartner, favorites,
    handleUserSelect: (user: any) => {
      setUserConversationId(null);
      setChatPartner({ type: 'user', id: user.id, name: user.name, email: user.email ?? undefined, avatarUrl: user.avatar_url ?? undefined });
      setChatParticipants([{ id: user.id, name: user.name, type: 'user' }] as any);
      setBoundRows([]); setShowBoundRowsBar(false); setActivePanel('none');
    },
    handleAddToGroup: (user: { id: number; name: string }) => {
      const isInChat = chatParticipants.some((p: any) => p.id === user.id);
      const activeConvId = userConversationId || currentConversationId;
      if (isInChat) {
        const newP = chatParticipants.filter((p: any) => p.id !== user.id);
        setChatParticipants(newP);
        if (activeConvId) {
          apiClient.delete(`/chat/conversations/${activeConvId}/participants/${user.id}`).catch(() => {});
        }
        if (newP.length === 0 && currentAgent) {
          setChatPartner({ type: 'agent', id: currentAgent.id, name: currentAgent.name, icon: currentAgent.icon });
        } else if (newP.length === 1) {
          setChatPartner({ type: 'user', id: newP[0].id, name: newP[0].name });
        } else if (newP.length > 1) {
          setChatPartner({ type: 'group', id: 0, name: `Группа (${newP.length})`, participants: newP });
        }
      } else {
        const newP = [...chatParticipants, { id: user.id, name: user.name, type: 'user' as const }];
        setChatParticipants(newP);
        if (activeConvId) {
          apiClient.post(`/chat/conversations/${activeConvId}/participants`, { user_id: user.id, role: 'member' }).catch(() => {});
        }
        if (newP.length === 1) {
          setChatPartner({ type: 'user', id: user.id, name: user.name });
        } else {
          setChatPartner({ type: 'group', id: 0, name: `Группа (${newP.length})`, participants: newP });
        }
      }
    },
    toggleFavorite: (userId: number) => setFavorites(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]),
    handleAgentSelect,
    selectConversation, openTaskChat, createNewConversation, forceNewChatRef,
    setChatPartner, setChatMode, setChatParticipants, setBoundRows, setShowBoundRowsBar, clearMessages,
    agentsSearch, setAgentsSearch,
    filteredAgents: filteredAgents as any,
    unlockAgent: async (agent: AIAgent) => {
      await unlockAgent(effectiveSpaceId ?? agent.space_id ?? 0, agent.id);
      await loadAgents();
    },
    isLoadingAgents, currentAgent: currentAgent as any,
    showFavoriteAgents, setShowFavoriteAgents, favoriteAgents, setFavoriteAgents,
    isVectorSearching, vectorSearchResults, setVectorSearchResults,
    handleVectorSearch: async () => {
      if (!agentsSearch || !currentSpaceId) return;
      setIsVectorSearching(true);
      try {
        const r = await apiClient.post<{ success: boolean; agents?: Pick<AIAgent, 'id'>[] }>('/ai/agents/search', { query: agentsSearch, spaceId: currentSpaceId, limit: 10 });
        if (r.success && r.agents) setVectorSearchResults(r.agents.map(a => a.id));
      } catch {
        // Keep the current local results when semantic search is unavailable.
      } finally { setIsVectorSearching(false); }
    },
    createTablesMutation, currentSpace,
    inboxConversations, isLoadingInbox, totalUnreadCount, refetchInbox,
    fetchNextInboxPage, hasNextInboxPage, isFetchingNextInboxPage,
    inboxSearch, setInboxSearch, inboxAgentFilter, setInboxAgentFilter,
    inboxTypeFilter, setInboxTypeFilter,
    inboxDateFrom, setInboxDateFrom, inboxDateTo, setInboxDateTo,
    showInboxFilters, setShowInboxFilters,
    hasActiveInboxFilters, inboxAgentOptions, inboxUserOptions, safeAgents: agents as any,
    inboxSortBy, setInboxSortBy, inboxSortDir, setInboxSortDir,
    inboxUnreadOnly, setInboxUnreadOnly,
    inboxUserFilter, setInboxUserFilter,
    inboxParticipantMode, setInboxParticipantMode,
    markAsReadMutation, selectAgent, renameConversation, deleteConversation,
    inboxRenamingId, setInboxRenamingId,
    inboxRenamingTitle, setInboxRenamingTitle,
    inboxRenameInputRef,
    userConversationId, currentConversationId: currentConversationId ?? null,
    setUserConversationId, allTablesDataMain,
    tasksSource, filteredTaskRows, isLoadingTasks, taskRows, tasksTotal, taskStatusDict,
    tasksTableColumns, tasksSearch, setTasksSearch,
    updateTasksSource: updateTasksSourcePersist,
    fetchNextTasksPage, hasNextTasksPage, isFetchingNextTasksPage,
    expandedTaskChats, setExpandedTaskChats, conversations: conversations as any, effectiveSpaceId,
    settingsTab, setSettingsTab, chatOperatorId, setChatOperatorId,
    chatModelId, setChatModelId, chatSystemPrompt, setChatSystemPrompt,
    operators, models, isAdminOrOwner, isSavingAgentSettings, saveAgentSettings,
    agents: agents as any, messages,
    contextSettings, handleContextSettingsChange: (s: any) => setContextSettings(s),
    saveContextSettings, isSavingContextSettings,
    defaultAgentId, saveDefaultAgent, isSavingDefaultAgent,
    summaryAgentId, isSavingSummaryAgent, onSummaryAgentChange,
    translationAgentId, isSavingTranslationAgent, onTranslationAgentChange,
    quickEmojis, setQuickEmojis, saveQuickEmojis, isSavingEmojis,
    voiceMode, setVoiceMode, voiceError, webSpeechAvailable,
    filesSource, updateFilesSource: updateFilesSourcePersist,
    favoritesConfig, updateFavoritesConfig,
    attachRowToMessage,
    isWideMode,
    panelMode, togglePanelMode,
  } as PanelContentDeps);

  return { renderPanelContent: () => renderPanelContentFromDeps(deps) };
}
