/**
 * AIChatPanel Types
 * Extracted from monolithic AIChatPanel.tsx
 */

import type { Dispatch, SetStateAction } from 'react';
import { Participant } from '../../../components/ParticipantSelector';
import { BoundRow as BoundRowType } from '../../../components/RowBindingV2';
import { MentionUser as MentionUserType } from '../../../components/MentionInput';

// Re-export types from other modules
export type { BoundRow } from '../../../components/RowBindingV2';
export type { MentionUser } from '../../../components/MentionInput';

// Re-export types from parent types.ts
export type { ChatMessage, ChatAttachment, ToolResult, AIAgent, MessageContentType } from '../../../types';

// Alias types for backward compatibility
export type { AIAgent as AIAgentType } from '../../../types';

// ─── ADR-110: Context Settings Types ─────────────────────────────────
export interface ContextLevels {
  thinking: boolean;
  thinking_preview_chars: number;
  tool_summaries: boolean;
  tool_preview_chars: number;
  full_tool_results: boolean;
}

export interface AutoSummarySettings {
  enabled: boolean;
  chunk_size: number;
  keep_recent: number;
  inject_in_system: boolean;
}

export interface VectorSearchSettings {
  enabled: boolean;
  top_k: number;
  similarity_threshold: number;
}

export interface ContextSettings {
  max_history?: number;
  context_levels?: ContextLevels;
  auto_summary?: AutoSummarySettings;
  vector_search?: VectorSearchSettings;
}

// Default values for context settings
export const DEFAULT_CONTEXT_SETTINGS: ContextSettings = {
  max_history: 50,
  context_levels: {
    thinking: false,
    thinking_preview_chars: 200,
    tool_summaries: false,
    tool_preview_chars: 300,
    full_tool_results: false,
  },
  auto_summary: {
    enabled: false,
    chunk_size: 10,
    keep_recent: 5,
    inject_in_system: true,
  },
  vector_search: {
    enabled: false,
    top_k: 3,
    similarity_threshold: 0.7,
  },
};

// Agent type (alias for AIAgent from parent types)
export interface Agent {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  model?: string;
  model_id?: number;
  model_name?: string;
  provider?: string;
  provider_id?: number;
  operator_id?: number;
  system_prompt?: string;
  is_active?: boolean;
  context_settings?: ContextSettings | string;
}

// User type for contacts and participants
export interface User {
  id: number;
  name: string;
  email?: string;
  avatar_url?: string;
  managed_by_agent_table_id?: number | null;
}

// Sub-agent entry returned by the backend (enriched from AI Agents table)
export interface SubAgent {
  row_id: number;
  name: string;
  icon?: string | null;
  response_mode?: 'always' | 'mention_only' | 'on_command';
}

// Conversation type for chat history
export interface Conversation {
  id: number;
  title: string | null;
  type: string;
  space_id?: number;
  agent_id?: number;
  agent_table_id?: number;
  lab_id?: string;
  agentIcon?: string;
  agentName?: string;
  messagesCount?: number;
  updatedAt: string;
  created_at?: string;
  participants?: Array<{ user_id: number; name: string }>;
  spaceName?: string;
  sub_agents?: SubAgent[];
  metadata?: {
    boundRow?: BoundRowType;
  };
}

// Chat participant type
export interface ChatParticipant {
  id: number;
  name: string;
  email?: string;
  avatar_url?: string;
  type?: 'human' | 'agent' | 'bot';
}

// Space type
export interface Space {
  id: number;
  name: string;
  description?: string;
  icon?: string;
}

// Files source type
export interface FilesSource {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  projectId?: number;
}

// Project file type
export interface ProjectFile {
  id: number;
  name: string;
  originalName?: string;
  original_name?: string;
  size: number;
  type: string;
  mimeType?: string;
  mime_type?: string;
  url: string;
  created_at: string;
}

// Panel and UI Types
export type PanelTab = 'none' | 'contacts' | 'ai-agents' | 'tasks' | 'settings' | 'inbox';
export type ChatPartnerType = 'agent' | 'user' | 'group';
export type AgentMode = 'ask' | 'read' | 'agent';
export type VoiceInputMode = 'webSpeech' | 'whisper';
export type PanelMode = 'collapsed' | 'default' | 'expanded' | 'fullscreen';
export type SettingsTab = 'ai' | 'people' | 'widget';
export type UserTypeFilter = 'all' | 'humans' | 'agents';
export type SortOption = 'date' | 'name' | 'relevance' | 'alphabet' | 'participants' | 'space';

// TicketsSource type (primary name for task/ticket source)
export interface TicketsSource {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  displayColumn?: string;
}

// Legacy alias for backwards compatibility
export type TasksSource = TicketsSource;

// Operator type (alias for AIOperator)
export interface Operator {
  id: number;
  name: string;
  base_url?: string;
  api_key?: string;
  icon?: string;
}

// Model type (alias for AIModel)
export interface Model {
  id: number;
  name: string;
  model_id?: string;
  context_window?: number;
}

// Inbox conversation type (unified: user-to-user + AI agent chats)
export interface InboxConversation {
  id: number;
  title: string | null;
  type: string;
  unread_count: number;
  updated_at: string;
  participants: Array<{
    user_id: number;
    name: string;
    email?: string;
    avatar_url?: string;
  }>;
  sub_agents?: SubAgent[];
  // AI conversation fields (Ticket #81449)
  agent_id?: number | null;
  agent_name?: string | null;
  agent_icon?: string | null;
  bound_table_id?: number | null;
  bound_row_id?: number | null;
  messages_count?: number;
  last_message?: string | null;
  /** 'inbox' = user chat from GET /chat/conversations, 'ai' = AI chat from GET /ai/conversations */
  _source?: 'inbox' | 'ai';
}

export interface ChatPartner {
  type: ChatPartnerType;
  id: number;
  name: string;
  icon?: string;
  avatarUrl?: string;
  email?: string;
  participants?: Participant[]; // for group chats
}

export interface TicketsSourceConfig {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  displayColumn?: string;
  descriptionColumn?: string;
  statusColumn?: string;
  priorityColumn?: string;
  statusDictTableId?: number;
  priorityDictTableId?: number;
}

// Legacy alias
export type TasksSourceConfig = TicketsSourceConfig;

export interface FilesSourceConfig {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  projectId?: number;
}

export interface AIChatPanelProps {
  className?: string;
  onClose?: () => void;
}

// Toolbar Button Props
export interface ToolbarButtonProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  badge?: number;
  badgeColor?: 'red' | 'green' | 'blue';
}

// User interface for contacts (compatible with ContactUser from AccordionContactItem)
export interface ChatUser {
  id: number;
  name: string;
  email?: string | null;
  avatar_url?: string | null;
  managed_by_agent_table_id?: number | null;
  user_type?: string;
}

// API Response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
}

// AI Operator/Provider
export interface AIOperator {
  id: number;
  name: string;
  base_url?: string;
  api_key?: string;
}

// AI Model
export interface AIModel {
  id: number;
  name: string;
  model_id?: string;
}

// Task Row
export interface TaskRow {
  id: number;
  data: Record<string, unknown>;
}

// Project File
export interface ProjectFile {
  id: number;
  name: string;
  size: number;
  type: string;
  url: string;
  created_at: string;
}

// Agent Chat
export interface AgentChat {
  id: number;
  title: string;
  lastMessage?: string;
  updatedAt: string;
}

// Message Reaction
export interface MessageReaction {
  user_id: number;
  user_name: string;
}

// Chat State Interface - all the useState hooks
export interface ChatState {
  // UI State
  activePanel: PanelTab;
  chatMode: 'ai' | 'people';
  chatPartner: ChatPartner | null;
  inputValue: string;
  attachments: File[];
  previewFile: { url: string; name: string } | null;
  dragOver: boolean;
  mentionedUsers: MentionUserType[];
  boundRows: BoundRowType[];
  /** Message-level row attachments (sent with individual messages, cleared after send) */
  messageBoundRows: BoundRowType[];
  chatParticipants: Participant[];
  tasksSource: TasksSourceConfig | undefined;
  filesSource: FilesSourceConfig | undefined;
  showFilePicker: boolean;
  attachTab: 'files' | 'rows';

  // Panel sizing and layout
  panelHeight: number | 'auto';
  panelMode: PanelMode;
  isResizing: boolean;
  panelWidth: number;
  isResizingWidth: boolean;
  sidebarWidth: number;
  isResizingSidebar: boolean;
  isMobile: boolean;
  mobileKeyboardHeight: number;

  // Processing elapsed time
  processingElapsed: number;

  // Settings and modes
  markdownEnabled: boolean;
  agentMode: AgentMode;
  thinkingEnabled: boolean;
  settingsTab: SettingsTab;
  localError: string | null;
  showTerminal: boolean;
  terminalFocusSessionId: number | undefined;

  // Search states
  contactsSearch: string;
  agentsSearch: string;
  historySearch: string;
  filesSearch: string;
  tasksSearch: string;
  userTypeFilter: UserTypeFilter;
  showFavorites: boolean;
  favorites: number[];
  showRowBinding: boolean;
  showBoundRowsBar: boolean;
  /** Whether the message-level row picker is open (in + button area) */
  showMessageRowPicker: boolean;
  showTasksSelector: boolean;
  expandedTaskChats: number | null;
  showAllContacts: boolean;
  taskProjectId: number | null;
  
  // Chat-specific settings
  chatOperatorId: number | null;
  chatModelId: string;
  chatSystemPrompt: string;
  isSavingAgentSettings: boolean;
  
  // Sorting and sub-agents
  sortOption: SortOption;
  subAgents: number[];
  
  // Agent management
  editingAgentId: number | null;
  defaultAgentId: number | null;
  isSavingDefaultAgent: boolean;
  favoriteAgents: number[];
  showFavoriteAgents: boolean;
  expandedAgentId: number | null;
  
  // Vector search
  isVectorSearching: boolean;
  vectorSearchResults: number[] | null;
  
  // Agent chats cache
  agentChats: Record<number, AgentChat[]>;
  
  // Quick reactions
  quickEmojis: string[];
  isSavingEmojis: boolean;
  
  // Message reactions cache
  messageReactions: Record<number, Record<string, MessageReaction[]>>;
  
  // Voice input
  voiceMode: VoiceInputMode;

  // Scroll-to-bottom arrow visibility
  showScrollToBottom: boolean;
  // New message counter — only human-visible messages (not tool_call/tool_result/thinking)
  newMessageCount: number;
  // Agent working indicator — true when agent tool calls are arriving
  agentWorking: boolean;

  // User/group chat conversation id
  userConversationId: number | null;
}

// Chat Actions Interface — all setters use Dispatch<SetStateAction<T>> to support
// both direct values and functional updates (prev => ...)
export interface ChatActions {
  setActivePanel: Dispatch<SetStateAction<PanelTab>>;
  setChatMode: Dispatch<SetStateAction<'ai' | 'people'>>;
  setChatPartner: Dispatch<SetStateAction<ChatPartner | null>>;
  setInputValue: Dispatch<SetStateAction<string>>;
  setAttachments: Dispatch<SetStateAction<File[]>>;
  setPreviewFile: Dispatch<SetStateAction<{ url: string; name: string } | null>>;
  setDragOver: Dispatch<SetStateAction<boolean>>;
  setMentionedUsers: Dispatch<SetStateAction<MentionUserType[]>>;
  setBoundRows: Dispatch<SetStateAction<BoundRowType[]>>;
  setMessageBoundRows: Dispatch<SetStateAction<BoundRowType[]>>;
  setChatParticipants: Dispatch<SetStateAction<Participant[]>>;
  setTasksSource: Dispatch<SetStateAction<TasksSourceConfig | undefined>>;
  setFilesSource: Dispatch<SetStateAction<FilesSourceConfig | undefined>>;
  setShowFilePicker: Dispatch<SetStateAction<boolean>>;
  setAttachTab: Dispatch<SetStateAction<'files' | 'rows'>>;

  // Panel sizing
  setPanelHeight: Dispatch<SetStateAction<number | 'auto'>>;
  setPanelMode: Dispatch<SetStateAction<PanelMode>>;
  setIsResizing: Dispatch<SetStateAction<boolean>>;
  setPanelWidth: Dispatch<SetStateAction<number>>;
  setIsResizingWidth: Dispatch<SetStateAction<boolean>>;
  setSidebarWidth: Dispatch<SetStateAction<number>>;
  setIsResizingSidebar: Dispatch<SetStateAction<boolean>>;
  setMobileKeyboardHeight: Dispatch<SetStateAction<number>>;
  setProcessingElapsed: Dispatch<SetStateAction<number>>;

  // Settings
  setMarkdownEnabled: Dispatch<SetStateAction<boolean>>;
  setAgentMode: Dispatch<SetStateAction<AgentMode>>;
  setThinkingEnabled: Dispatch<SetStateAction<boolean>>;
  setSettingsTab: Dispatch<SetStateAction<SettingsTab>>;
  setLocalError: Dispatch<SetStateAction<string | null>>;
  setShowTerminal: Dispatch<SetStateAction<boolean>>;
  setTerminalFocusSessionId: Dispatch<SetStateAction<number | undefined>>;

  // Search
  setContactsSearch: Dispatch<SetStateAction<string>>;
  setAgentsSearch: Dispatch<SetStateAction<string>>;
  setHistorySearch: Dispatch<SetStateAction<string>>;
  setFilesSearch: Dispatch<SetStateAction<string>>;
  setTasksSearch: Dispatch<SetStateAction<string>>;
  setUserTypeFilter: Dispatch<SetStateAction<UserTypeFilter>>;
  setShowFavorites: Dispatch<SetStateAction<boolean>>;
  setFavorites: Dispatch<SetStateAction<number[]>>;
  setShowRowBinding: Dispatch<SetStateAction<boolean>>;
  setShowBoundRowsBar: Dispatch<SetStateAction<boolean>>;
  setShowMessageRowPicker: Dispatch<SetStateAction<boolean>>;
  setShowTasksSelector: Dispatch<SetStateAction<boolean>>;
  setExpandedTaskChats: Dispatch<SetStateAction<number | null>>;
  setShowAllContacts: Dispatch<SetStateAction<boolean>>;
  setTaskProjectId: Dispatch<SetStateAction<number | null>>;
  
  // Chat settings
  setChatOperatorId: Dispatch<SetStateAction<number | null>>;
  setChatModelId: Dispatch<SetStateAction<string>>;
  setChatSystemPrompt: Dispatch<SetStateAction<string>>;
  setIsSavingAgentSettings: Dispatch<SetStateAction<boolean>>;
  
  // Sorting and sub-agents
  setSortOption: Dispatch<SetStateAction<SortOption>>;
  setSubAgents: Dispatch<SetStateAction<number[]>>;
  
  // Agent management
  setEditingAgentId: Dispatch<SetStateAction<number | null>>;
  setDefaultAgentId: Dispatch<SetStateAction<number | null>>;
  setIsSavingDefaultAgent: Dispatch<SetStateAction<boolean>>;
  setFavoriteAgents: Dispatch<SetStateAction<number[]>>;
  setShowFavoriteAgents: Dispatch<SetStateAction<boolean>>;
  setExpandedAgentId: Dispatch<SetStateAction<number | null>>;
  
  // Vector search
  setIsVectorSearching: Dispatch<SetStateAction<boolean>>;
  setVectorSearchResults: Dispatch<SetStateAction<number[] | null>>;
  
  // Agent chats
  setAgentChats: Dispatch<SetStateAction<Record<number, AgentChat[]>>>;
  
  // Quick reactions
  setQuickEmojis: Dispatch<SetStateAction<string[]>>;
  setIsSavingEmojis: Dispatch<SetStateAction<boolean>>;
  
  // Message reactions
  setMessageReactions: Dispatch<SetStateAction<Record<number, Record<string, MessageReaction[]>>>>;
  
  // Voice input
  setVoiceMode: Dispatch<SetStateAction<VoiceInputMode>>;

  // Scroll-to-bottom
  setShowScrollToBottom: Dispatch<SetStateAction<boolean>>;
  // New message counter (human-visible only)
  setNewMessageCount: Dispatch<SetStateAction<number>>;
  // Agent working indicator
  setAgentWorking: Dispatch<SetStateAction<boolean>>;

  // User/group chat conversation id
  setUserConversationId: Dispatch<SetStateAction<number | null>>;
}