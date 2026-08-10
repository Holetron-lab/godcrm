/**
 * usePanelContentWiring — Builds the dependency bag for usePanelContent.
 * ADR-119: Extracted from AIChatPanel.tsx to reduce orchestrator size.
 */
import { useState } from 'react';
import { apiClient } from '@/shared/utils/apiClient';
import { renderPanelContentFromDeps } from './usePanelContent/index';
import type { ContextSettings } from '../types';
import type { AIAgent } from '../../../types';

interface PanelContentWiringParams {
  // Panel state
  activePanel: string;
  setActivePanel: (v: any) => void;
  contactsSearch: string;
  setContactsSearch: (v: string) => void;
  showFavorites: boolean;
  setShowFavorites: (v: any) => void;
  userTypeFilter: string;
  setUserTypeFilter: (v: string) => void;
  showAllContacts: boolean;
  setShowAllContacts: (v: any) => void;
  users: any[];
  isLoadingUsers: boolean;
  chatParticipants: any[];
  chatPartner: any;
  favorites: number[];
  setFavorites: (v: any) => void;
  setUserConversationId: (v: number | null) => void;
  setChatPartner: (v: any) => void;
  setChatParticipants: (v: any) => void;
  setBoundRows: (v: any) => void;
  setShowBoundRowsBar: (v: boolean) => void;
  handleAgentSelect: (agent: AIAgent) => void;
  selectConversation: (id: number) => void;
  createNewConversation: () => void;
  forceNewChatRef: React.MutableRefObject<boolean>;
  setChatMode: (v: string) => void;
  clearMessages: () => void;
  // Agents
  agentsSearch: string;
  setAgentsSearch: (v: string) => void;
  agents: AIAgent[];
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
  inboxSearch: string;
  setInboxSearch: (v: string) => void;
  inboxAgentFilter: string;
  setInboxAgentFilter: (v: string) => void;
  inboxDateFrom: string;
  setInboxDateFrom: (v: string) => void;
  inboxDateTo: string;
  setInboxDateTo: (v: string) => void;
  showInboxFilters: boolean;
  setShowInboxFilters: (v: boolean) => void;
  markAsReadMutation: any;
  selectAgent: (agent: AIAgent) => void;
  renameConversation: (id: number, title: string) => void;
  userConversationId: number | null;
  currentConversationId: number | null | undefined;
  allTablesDataMain: any;
  // Tasks
  tasksSource: any;
  filteredTaskRows: any;
  isLoadingTasks: boolean;
  taskRows: any[];
  taskStatusDict: any;
  tasksTableColumns: any;
  tasksSearch: string;
  setTasksSearch: (v: string) => void;
  setTasksSource: (v: any) => void;
  expandedTaskChats: any;
  setExpandedTaskChats: (v: any) => void;
  conversations: any[];
  effectiveSpaceId: number | undefined;
  // Settings
  settingsTab: string;
  setSettingsTab: (v: string) => void;
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
  quickEmojis: string[];
  setQuickEmojis: (v: string[]) => void;
  saveQuickEmojis: any;
  isSavingEmojis: boolean;
  voiceMode: string;
  setVoiceMode: (v: string) => void;
  voiceError: string | null;
  webSpeechAvailable: boolean;
  filesSource: any;
  setFilesSource: (v: any) => void;
}

export function usePanelContentWiring(params: PanelContentWiringParams) {
  const {
    activePanel, setActivePanel, contactsSearch, setContactsSearch,
    showFavorites, setShowFavorites, userTypeFilter, setUserTypeFilter,
    showAllContacts, setShowAllContacts, users, isLoadingUsers,
    chatParticipants, chatPartner, favorites, setFavorites,
    setUserConversationId, setChatPartner, setChatParticipants, setBoundRows,
    setShowBoundRowsBar, handleAgentSelect, selectConversation, createNewConversation,
    forceNewChatRef, setChatMode, clearMessages,
    agentsSearch, setAgentsSearch, agents, isLoadingAgents, currentAgent,
    showFavoriteAgents, setShowFavoriteAgents, favoriteAgents, setFavoriteAgents,
    isVectorSearching, vectorSearchResults, setVectorSearchResults, setIsVectorSearching,
    currentSpaceId, createTablesMutation, currentSpace,
    inboxConversations, isLoadingInbox, totalUnreadCount, refetchInbox,
    inboxSearch, setInboxSearch, inboxAgentFilter, setInboxAgentFilter,
    inboxDateFrom, setInboxDateFrom, inboxDateTo, setInboxDateTo,
    showInboxFilters, setShowInboxFilters,
    markAsReadMutation, selectAgent, renameConversation,
    userConversationId, currentConversationId, allTablesDataMain,
    tasksSource, filteredTaskRows, isLoadingTasks, taskRows, taskStatusDict,
    tasksTableColumns, tasksSearch, setTasksSearch, setTasksSource,
    expandedTaskChats, setExpandedTaskChats, conversations, effectiveSpaceId,
    settingsTab, setSettingsTab, chatOperatorId, setChatOperatorId,
    chatModelId, setChatModelId, chatSystemPrompt, setChatSystemPrompt,
    operators, models, isAdminOrOwner, isSavingAgentSettings, saveAgentSettings,
    messages, contextSettings, setContextSettings, saveContextSettings,
    isSavingContextSettings, defaultAgentId, saveDefaultAgent, isSavingDefaultAgent,
    quickEmojis, setQuickEmojis, saveQuickEmojis, isSavingEmojis,
    voiceMode, setVoiceMode, voiceError, webSpeechAvailable,
    filesSource, setFilesSource,
  } = params;

  const filteredUsers = users.filter(u => {
    const ms = !contactsSearch || u.name.toLowerCase().includes(contactsSearch.toLowerCase()) || u.email?.toLowerCase().includes(contactsSearch.toLowerCase());
    const isAg = u.managed_by_agent_table_id != null;
    const mt = userTypeFilter === 'all' || (userTypeFilter === 'humans' && !isAg) || (userTypeFilter === 'agents' && isAg);
    const mf = !showFavorites || favorites.includes(u.id);
    return ms && mt && mf;
  });

  const filteredAgents = agents.filter(a => {
    const sl = agentsSearch?.toLowerCase() || '';
    const ms = !agentsSearch || a.name.toLowerCase().includes(sl) || a.description?.toLowerCase().includes(sl);
    const mf = !showFavoriteAgents || favoriteAgents.includes(a.id);
    return ms && mf;
  });

  const hasActiveInboxFilters = !!(inboxSearch || inboxAgentFilter || inboxDateFrom || inboxDateTo);

  const deps = ({
    activePanel, setActivePanel,
    contactsSearch, setContactsSearch,
    showFavorites, setShowFavorites,
    userTypeFilter, setUserTypeFilter,
    showAllContacts, setShowAllContacts,
    filteredUsers, isLoadingUsers,
    chatParticipants, chatPartner, favorites,
    handleUserSelect: (user: any) => {
      setUserConversationId(null);
      setChatPartner({ type: 'user', id: user.id, name: user.name, email: user.email ?? undefined, avatarUrl: user.avatar_url ?? undefined });
      setChatParticipants([{ id: user.id, name: user.name, type: 'user' }] as any);
      setBoundRows([]); setShowBoundRowsBar(false); setActivePanel('none');
    },
    handleAddToGroup: () => {},
    toggleFavorite: (userId: number) => setFavorites(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]),
    handleAgentSelect,
    selectConversation, createNewConversation, forceNewChatRef,
    setChatPartner, setChatMode, setChatParticipants, setBoundRows, setShowBoundRowsBar, clearMessages,
    agentsSearch, setAgentsSearch,
    filteredAgents: filteredAgents as any,
    isLoadingAgents, currentAgent: currentAgent as any,
    showFavoriteAgents, setShowFavoriteAgents, favoriteAgents, setFavoriteAgents,
    isVectorSearching, vectorSearchResults, setVectorSearchResults,
    handleVectorSearch: async () => {
      if (!agentsSearch || !currentSpaceId) return;
      setIsVectorSearching(true);
      try {
        const r = await apiClient.post<any>('/ai/agents/search', { query: agentsSearch, spaceId: currentSpaceId, limit: 10 });
        if (r.success && r.agents) setVectorSearchResults(r.agents.map((a: any) => a.id));
      } catch {} finally { setIsVectorSearching(false); }
    },
    createTablesMutation, currentSpace,
    inboxConversations, isLoadingInbox, totalUnreadCount, refetchInbox,
    inboxSearch, setInboxSearch, inboxAgentFilter, setInboxAgentFilter,
    inboxDateFrom, setInboxDateFrom, inboxDateTo, setInboxDateTo,
    showInboxFilters, setShowInboxFilters,
    hasActiveInboxFilters, inboxAgentOptions: [], safeAgents: agents as any,
    markAsReadMutation, selectAgent, renameConversation,
    userConversationId, currentConversationId: currentConversationId ?? null,
    setUserConversationId, allTablesDataMain,
    tasksSource, filteredTaskRows, isLoadingTasks, taskRows, taskStatusDict,
    tasksTableColumns, tasksSearch, setTasksSearch,
    updateTasksSource: (config: any) => { setTasksSource(config); },
    expandedTaskChats, setExpandedTaskChats, conversations: conversations as any, effectiveSpaceId,
    settingsTab, setSettingsTab, chatOperatorId, setChatOperatorId,
    chatModelId, setChatModelId, chatSystemPrompt, setChatSystemPrompt,
    operators, models, isAdminOrOwner, isSavingAgentSettings, saveAgentSettings,
    agents: agents as any, messages,
    contextSettings, handleContextSettingsChange: (s: any) => setContextSettings(s),
    saveContextSettings, isSavingContextSettings,
    defaultAgentId, saveDefaultAgent, isSavingDefaultAgent,
    quickEmojis, setQuickEmojis, saveQuickEmojis, isSavingEmojis,
    voiceMode, setVoiceMode, voiceError, webSpeechAvailable,
    filesSource, updateFilesSource: (config: any) => { setFilesSource(config); },
  } as any);

  return { renderPanelContent: () => renderPanelContentFromDeps(deps) };
}
