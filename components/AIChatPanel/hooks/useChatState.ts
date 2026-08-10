/**
 * useChatState Hook
 * Centralized state management for all 47+ useState hooks from AIChatPanel
 */

import { useState, useEffect } from 'react';
import { ChatState, ChatActions, PanelTab, ChatPartner, TasksSourceConfig, FilesSourceConfig, PanelMode, AgentMode, SettingsTab, UserTypeFilter, SortOption, VoiceInputMode, AgentChat, MessageReaction } from '../types';
import { MentionUser } from '../../../components/MentionInput';
import { BoundRow } from '../../../components/RowBindingV2';
import { Participant } from '../../../components/ParticipantSelector';

const DEFAULT_QUICK_EMOJIS = ['👍', '❤️', '😂', '🔥', '💯', '🙏', '😍', '😮'];

export function useChatState() {
  // UI State
  const [activePanel, setActivePanel] = useState<PanelTab>('none');
  const [chatMode, setChatMode] = useState<'ai' | 'people'>('ai');
  const [chatPartner, setChatPartner] = useState<ChatPartner | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mentionedUsers, setMentionedUsers] = useState<MentionUser[]>([]);
  const [boundRows, setBoundRows] = useState<BoundRow[]>([]);
  const [messageBoundRows, setMessageBoundRows] = useState<BoundRow[]>([]);
  const [chatParticipants, setChatParticipants] = useState<Participant[]>([]);
  const [tasksSource, setTasksSource] = useState<TasksSourceConfig | undefined>();
  const [filesSource, setFilesSource] = useState<FilesSourceConfig | undefined>();
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [attachTab, setAttachTab] = useState<'files' | 'rows'>('files');

  // Panel sizing and layout
  const [panelHeight, setPanelHeight] = useState<number | 'auto'>('auto');
  const [panelMode, setPanelMode] = useState<PanelMode>('default');
  const [isResizing, setIsResizing] = useState(false);
  const [panelWidth, setPanelWidth] = useState(420);
  const [isResizingWidth, setIsResizingWidth] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
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
  const [favorites, setFavorites] = useState<number[]>([]);
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
  
  // Sorting and sub-agents
  const [sortOption, setSortOption] = useState<SortOption>('date');
  const [subAgents, setSubAgents] = useState<number[]>([]);
  
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
    showFilePicker,
    attachTab,
    panelHeight,
    panelMode,
    isResizing,
    panelWidth,
    isResizingWidth,
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
    subAgents,
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
    userConversationId
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
    setShowFilePicker,
    setAttachTab,
    setPanelHeight,
    setPanelMode,
    setIsResizing,
    setPanelWidth,
    setIsResizingWidth,
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
    setSubAgents,
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
    setUserConversationId
  };

  return { state, actions };
}