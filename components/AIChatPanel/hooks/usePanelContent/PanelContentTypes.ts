/**
 * PanelContentDeps — Dependency bag for panel renderers.
 * ADR-119: Extracted from usePanelContent.tsx.
 */
import type React from 'react';
import type { ContextSettings } from '../../types';
import type { AIAgent } from '../../../../types';
import type { PanelTab, InboxConversation, TasksSourceConfig, FilesSourceConfig } from '../../../AIChatPanel.types';

export interface PanelContentDeps {
  activePanel: PanelTab;
  setActivePanel: (panel: PanelTab) => void;

  // Contacts panel
  contactsSearch: string;
  setContactsSearch: (v: string) => void;
  showFavorites: boolean;
  setShowFavorites: (v: boolean | ((p: boolean) => boolean)) => void;
  userTypeFilter: 'all' | 'humans' | 'agents';
  setUserTypeFilter: (v: 'all' | 'humans' | 'agents') => void;
  showAllContacts: boolean;
  setShowAllContacts: (v: boolean | ((p: boolean) => boolean)) => void;
  filteredUsers: Array<{ id: number; name: string; email?: string | null; avatar_url?: string | null; managed_by_agent_table_id?: number | null }>;
  isLoadingUsers: boolean;
  chatParticipants: Array<{ id: number; name: string; type: string }>;
  chatPartner: { type: string; id: number; name: string; icon?: string; avatarUrl?: string; email?: string; participants?: Array<{ id: number; name: string; type: string }> } | null;
  favorites: number[];
  handleUserSelect: (user: { id: number; name: string; email?: string | null; avatar_url?: string | null; managed_by_agent_table_id?: number | null }) => void;
  selectConversation: (id: number) => void;
  toggleFavorite: (userId: number) => void;
  handleAddToGroup: (user: { id: number; name: string }) => void;
  forceNewChatRef: React.MutableRefObject<boolean>;
  createNewConversation: () => void;
  setUserConversationId: (id: number | null) => void;
  setChatPartner: (partner: PanelContentDeps['chatPartner']) => void;
  setChatParticipants: (p: Array<{ id: number; name: string; type: string; email?: string; avatar?: string }>) => void;

  // Agents panel
  agentsSearch: string;
  setAgentsSearch: (v: string) => void;
  showFavoriteAgents: boolean;
  setShowFavoriteAgents: (v: boolean) => void;
  isVectorSearching: boolean;
  vectorSearchResults: number[] | null;
  setVectorSearchResults: (v: number[] | null) => void;
  filteredAgents: AIAgent[];
  isLoadingAgents: boolean;
  currentAgent: AIAgent | null;
  favoriteAgents: number[];
  setFavoriteAgents: (v: number[] | ((p: number[]) => number[])) => void;
  handleVectorSearch: () => void;
  handleAgentSelect: (agent: AIAgent) => void;
  clearMessages: () => void;
  createTablesMutation: { mutate: () => void; isPending: boolean; isError: boolean };
  currentSpace: { id?: number; settings?: unknown } | null;

  // Inbox panel
  inboxSearch: string;
  setInboxSearch: (v: string) => void;
  inboxAgentFilter: string;
  setInboxAgentFilter: (v: string) => void;
  inboxDateFrom: string;
  setInboxDateFrom: (v: string) => void;
  inboxDateTo: string;
  setInboxDateTo: (v: string) => void;
  showInboxFilters: boolean;
  setShowInboxFilters: (v: boolean | ((p: boolean) => boolean)) => void;
  hasActiveInboxFilters: boolean;
  totalUnreadCount: number;
  inboxConversations: InboxConversation[];
  isLoadingInbox: boolean;
  inboxAgentOptions: Array<{ id: number; name: string; icon?: string | null }>;
  safeAgents: AIAgent[];
  markAsReadMutation: { mutate: (id: number) => void };
  setChatMode: (mode: 'ai' | 'people') => void;
  setBoundRows: (rows: Array<{ table_id: number; row_id: number; table_name?: string; table_icon?: string; row_title?: string }>) => void;
  setShowBoundRowsBar: (v: boolean) => void;
  selectAgent: (agent: AIAgent) => void;
  userConversationId: number | null;
  currentConversationId: number | null;
  renameConversation: (id: number, title: string) => void;
  inboxRenamingId: number | null;
  setInboxRenamingId: (v: number | null) => void;
  inboxRenamingTitle: string;
  setInboxRenamingTitle: (v: string) => void;
  inboxRenameInputRef: React.RefObject<HTMLInputElement>;

  // Tasks panel
  tasksSource: TasksSourceConfig | undefined;
  tasksSearch: string;
  setTasksSearch: (v: string) => void;
  filteredTaskRows: Array<{ id: number; data: Record<string, unknown> }>;
  taskRows: Array<{ id: number; data: Record<string, unknown> }>;
  isLoadingTasks: boolean;
  taskStatusDict: Array<{ id: number; name?: string; color?: string }>;
  expandedTaskChats: number | null;
  setExpandedTaskChats: (v: number | null) => void;
  conversations: Array<{ id: number; title: string; updatedAt: string; metadata?: { boundRow?: { row_id: number; table_id: number } } }>;
  updateTasksSource: (config: TasksSourceConfig | undefined) => void;
  effectiveSpaceId: number | undefined;

  // Settings panel
  settingsTab: 'ai' | 'people' | 'widget';
  setSettingsTab: (tab: 'ai' | 'people' | 'widget') => void;
  agents: AIAgent[];
  chatOperatorId: number | null;
  setChatOperatorId: (id: number | null) => void;
  chatModelId: string;
  setChatModelId: (id: string) => void;
  chatSystemPrompt: string;
  setChatSystemPrompt: (prompt: string) => void;
  operators: Array<{ id: number; name: string }>;
  models: Array<{ id: number; name: string; model_id?: string }>;
  isAdminOrOwner: boolean;
  isSavingAgentSettings: boolean;
  saveAgentSettings: () => void;
  messages: unknown[];
  contextSettings: ContextSettings | string | undefined | null;
  isSavingContextSettings: boolean;
  handleContextSettingsChange: (settings: ContextSettings) => void;
  saveContextSettings: (settings: ContextSettings) => void;
  defaultAgentId: number | null;
  isSavingDefaultAgent: boolean;
  saveDefaultAgent: (agentId: number | null) => void;
  quickEmojis: string[];
  setQuickEmojis: (emojis: string[]) => void;
  isSavingEmojis: boolean;
  saveQuickEmojis: (emojis: string[]) => void;
  voiceMode: 'webSpeech' | 'whisper';
  setVoiceMode: (mode: 'webSpeech' | 'whisper') => void;
  voiceError: string | null;
  webSpeechAvailable: boolean;
  tasksTableColumns: Array<{ column_name: string; display_name: string; type: string; config?: string }>;
  filesSource: FilesSourceConfig | undefined;
  updateFilesSource: (config: FilesSourceConfig | undefined) => void;
  refetchInbox: () => void;
}
