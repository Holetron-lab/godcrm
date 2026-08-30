/**
 * PanelContentDeps — Dependency bag for panel renderers.
 * ADR-119: Extracted from usePanelContent.tsx.
 */
import type React from 'react';
import type { ContextSettings } from '../../types';
import type { AIAgent } from '../../../../types';
import type { PanelTab, InboxConversation, TasksSourceConfig, FilesSourceConfig } from '../../../AIChatPanel.types';
import type { FavoritesConfig } from '../../types';

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
  filteredUsers: Array<{ id: number; name: string; email?: string | null; avatar_url?: string | null; managed_by_agent_table_id?: number | null; managed_by_agent_row_id?: number | null; user_type?: string; agent_icon?: string | null; agent_color?: string | null }>;
  usersTotalCount?: number;
  isLoadingUsers: boolean;
  chatParticipants: Array<{ id: number; name: string; type: string }>;
  chatPartner: { type: string; id: number; name: string; icon?: string; avatarUrl?: string; email?: string; participants?: Array<{ id: number; name: string; type: string }> } | null;
  favorites: number[];
  handleUserSelect: (user: { id: number; name: string; email?: string | null; avatar_url?: string | null; managed_by_agent_table_id?: number | null; user_type?: string }) => void;
  selectConversation: (id: number) => void;
  /** Open a row-bound chat with full ticket/document binding (sets chatMode='people',
   *  chatPartner=group, boundRows). Pass when navigating from the Documents/Tasks
   *  panels — using `selectConversation` alone leaves the header stale. */
  openTaskChat?: (chat: { conversationId: number; tableId: number; rowId: number; rowTitle?: string }) => void;
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
  inboxTypeFilter: 'all' | 'ai' | 'group' | 'direct' | 'service';
  setInboxTypeFilter: (v: 'all' | 'ai' | 'group' | 'direct' | 'service') => void;
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
  fetchNextInboxPage: () => void;
  hasNextInboxPage: boolean;
  isFetchingNextInboxPage: boolean;
  inboxAgentOptions: Array<{ id: number; name: string; icon?: string | null }>;
  inboxUserOptions: Array<{ id: number; name: string; avatar_url?: string | null }>;
  inboxUserFilter: string[];
  setInboxUserFilter: (v: string[]) => void;
  inboxParticipantMode: 'any' | 'all';
  setInboxParticipantMode: (v: 'any' | 'all') => void;
  safeAgents: AIAgent[];
  markAsReadMutation: { mutate: (id: number) => void };
  setChatMode: (mode: 'ai' | 'people') => void;
  setBoundRows: (rows: Array<{ table_id: number; row_id: number; table_name?: string; table_icon?: string; row_title?: string }>) => void;
  setShowBoundRowsBar: (v: boolean) => void;
  selectAgent: (agent: AIAgent) => void;
  userConversationId: number | null;
  currentConversationId: number | null;
  renameConversation: (id: number, title: string) => void;
  deleteConversation: (id: number) => void;
  inboxRenamingId: number | null;
  setInboxRenamingId: (v: number | null) => void;
  inboxRenamingTitle: string;
  setInboxRenamingTitle: (v: string) => void;
  inboxRenameInputRef: React.RefObject<HTMLInputElement>;
  inboxSortBy: 'created' | 'updated';
  setInboxSortBy: (v: 'created' | 'updated') => void;
  inboxSortDir: 'asc' | 'desc';
  setInboxSortDir: (v: 'asc' | 'desc') => void;
  inboxUnreadOnly: boolean;
  setInboxUnreadOnly: (v: boolean) => void;

  // Tasks panel
  tasksSource: TasksSourceConfig | undefined;
  tasksSearch: string;
  setTasksSearch: (v: string) => void;
  filteredTaskRows: Array<{ id: number; data: Record<string, unknown> }>;
  taskRows: Array<{ id: number; data: Record<string, unknown> }>;
  /** Server-side total count for the tasks table (unfiltered). */
  tasksTotal: number;
  isLoadingTasks: boolean;
  taskStatusDict: Array<{ id: number; name?: string; color?: string }>;
  expandedTaskChats: number | null;
  setExpandedTaskChats: (v: number | null) => void;
  conversations: Array<{ id: number; title: string; updatedAt: string; metadata?: { boundRow?: { row_id: number; table_id: number } } }>;
  updateTasksSource: (config: TasksSourceConfig | undefined) => void;
  fetchNextTasksPage?: () => void;
  hasNextTasksPage?: boolean;
  isFetchingNextTasksPage?: boolean;
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
  summaryAgentId?: number | null;
  isSavingSummaryAgent?: boolean;
  onSummaryAgentChange?: (agentId: number | null) => void;
  translationAgentId?: number | null;
  isSavingTranslationAgent?: boolean;
  onTranslationAgentChange?: (agentId: number | null) => void;
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
  favoritesConfig?: FavoritesConfig;
  updateFavoritesConfig?: (config: FavoritesConfig | undefined) => void;
  refetchInbox: () => void;

  /** Attach a row reference to the next outgoing message (used by the
   *  selection toolbar in Tickets/Documents/Favourites header panels).
   *  Optional — falls back to "no attach button" if unset. */
  attachRowToMessage?: (br: { table_id: number; row_id: number; table_name?: string; table_icon?: string; row_title?: string }) => void;

  /** Panel is docked to the side (right column) rather than to the bottom.
   *  Lets header panels pre-fetch a bigger first page (100 vs 30/50). */
  isWideMode: boolean;

  /** Current panel mode (collapsed/default/expanded/fullscreen). Threaded down
   *  to BindableRowsList so its footer can render a maximize/restore toggle —
   *  the parent's lower footer is hidden for tasks/documents to avoid the
   *  duplicate statusbar row. */
  panelMode?: 'collapsed' | 'default' | 'expanded' | 'fullscreen';
  togglePanelMode?: () => void;
}
