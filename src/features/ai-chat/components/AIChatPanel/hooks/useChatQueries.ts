/**
 * useChatQueries Hook
 * ADR-097 Phase 2: Extracted ALL React Query / data-fetching logic from AIChatPanel.tsx
 *
 * This hook centralizes:
 * - Space users (contacts) fetching
 * - All users fetching (when "show all" is enabled)
 * - Inbox: total unread count + inbox conversations
 * - Mark-as-read mutation
 * - Task rows, task status dictionary, task table columns
 * - Project files for file picker
 * - AI operators (providers) and models
 * - AI tables creation mutation
 * - Users for @mentions
 * - AI agents for /commands
 * - User conversation message sending mutation
 * - User/group conversation messages (useConversationMessages)
 * - AI agent conversation messages (useConversationMessages)
 */

import { useMemo } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { useCurrentSpace } from '@/features/spaces/store/spacesStore';
import { useAllTables } from '@/features/tables/hooks/useAllTables';
import { useAIChat } from '../../../context/AIChatContext';
import { useConversationMessages } from '../../../hooks/useConversationMessages';
import { CHAT_CONFIG } from '../../../constants/chatConfig';
import { filesApi, type FileModel } from '@/features/files/api/filesApi';
import { MentionUser } from '../../MentionInput';
import type {
  ChatMessage,
  PanelTab,
  TasksSourceConfig,
  FilesSourceConfig,
  ChatPartner,
} from '../types';

// ─── API Response Wrappers ────────────────────────────────────────────────────

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string };
}

// ─── User types from the space API ────────────────────────────────────────────

interface SpaceUser {
  id: number;
  name: string;
  email?: string;
  avatar?: string;
  avatar_url?: string;
  managed_by_agent_table_id?: number;
  managed_by_agent_row_id?: number;
  user_type?: string;
}

// ─── Inbox conversation type ──────────────────────────────────────────────────

interface InboxConversation {
  id: number;
  title: string | null;
  type: string;
  agent_id?: number;
  unread_count: number;
  updated_at: string;
  participants: Array<{
    user_id: number;
    name: string;
    email?: string;
    avatar_url?: string;
  }>;
  sub_agents?: Array<{ row_id: number; name: string; icon?: string | null; response_mode?: string }>;
}

interface PaginatedConversationsResponse {
  conversations: InboxConversation[];
  total_count: number;
  has_more: boolean;
  limit: number;
  offset: number;
}

// ─── Task-related types ───────────────────────────────────────────────────────

interface TaskStatusEntry {
  id: number;
  name?: string;
  color?: string;
}

interface TableColumn {
  column_name: string;
  display_name: string;
  type: string;
  config?: string;
}

// ─── AI Provider / Model types ────────────────────────────────────────────────

interface AIOperator {
  id: number;
  name: string;
  base_url?: string;
  api_key?: string;
  icon?: string;
}

interface AIModel {
  id: number;
  name: string;
  model_id?: string;
  context_window?: number;
}

// ─── Agent for /commands ──────────────────────────────────────────────────────

interface AgentForSlash {
  id: number;
  name: string;
  icon?: string;
  description?: string;
  status?: string;
}

// ─── Hook Parameters ──────────────────────────────────────────────────────────

export interface UseChatQueriesParams {
  /** Effective space ID (contextSpaceId ?? currentSpace?.id) */
  effectiveSpaceId: number | undefined;
  /** Currently active side-panel tab */
  activePanel: PanelTab;
  /** Whether "show all contacts" toggle is on */
  showAllContacts: boolean;
  /** Tasks source configuration */
  tasksSource: TasksSourceConfig | undefined;
  /** Files source configuration */
  filesSource: FilesSourceConfig | undefined;
  /** Whether file picker is open */
  showFilePicker: boolean;
  /** Currently selected operator ID for model queries */
  chatOperatorId: number | null;
  /** Current agent (from AIChatContext) */
  currentAgent: { id: number; operator_id?: number; provider_id?: number } | null;
  /** Current chat partner */
  chatPartner: ChatPartner | null;
  /** User/group conversation ID */
  userConversationId: number | null;
  /** Current AI conversation ID (from AIChatContext) */
  currentConversationId: number | null;
  /** Whether AI agent is currently processing */
  isAgentProcessing: boolean;
  /** Current user ID */
  currentUserId: number | undefined;
  /** Callback to reload agents after table creation */
  onAgentsReload: () => void;
}

// ─── Hook Return Type ─────────────────────────────────────────────────────────

export interface UseChatQueriesResult {
  // ── Contacts ──
  spaceUsers: SpaceUser[];
  isLoadingSpaceUsers: boolean;
  allUsers: SpaceUser[];
  isLoadingAllUsers: boolean;

  // ── Inbox ──
  totalUnreadCount: number;
  refetchUnread: () => void;
  inboxConversations: InboxConversation[];
  isLoadingInbox: boolean;
  refetchInbox: () => void;
  fetchNextInboxPage: () => void;
  hasNextInboxPage: boolean;
  isFetchingNextInboxPage: boolean;
  markAsReadMutation: ReturnType<typeof useMutation<void, Error, number>>;

  // ── Tasks ──
  taskRows: Array<{ id: number; data: Record<string, unknown> }>;
  isLoadingTasks: boolean;
  taskStatusDict: TaskStatusEntry[];
  tasksTableColumns: TableColumn[];

  // ── Files ──
  projectFiles: FileModel[];
  isLoadingFiles: boolean;

  // ── AI Providers & Models ──
  operators: AIOperator[];
  models: AIModel[];

  // ── AI Table Creation ──
  createTablesMutation: ReturnType<typeof useMutation<unknown, Error>>;

  // ── Mentions ──
  usersForMentions: SpaceUser[];
  availableMentionUsers: MentionUser[];

  // ── Slash Commands ──
  availableSlashAgents: MentionUser[];

  // ── User Conversation Messages ──
  userConversationData: unknown;
  userConversationMessages: ChatMessage[];
  hasOlderMessages: boolean;
  fetchOlderMessages: () => void;
  isFetchingOlderMessages: boolean;
  refetchUserMessages: () => void;
  markAsRead: () => void;
  userPollingError: string | null;
  userPollingStopped: boolean;
  userReconnect: () => void;

  // ── AI Agent Conversation Messages ──
  aiConversationMessages: ChatMessage[];
  aiConversationData: unknown;
  isLoadingAIMessages: boolean;
  fetchNextAIPage: () => void;
  hasNextAIPage: boolean;
  isFetchingNextAIPage: boolean;
  aiPollingError: string | null;
  aiPollingStopped: boolean;
  aiReconnect: () => void;

  // ── Send User Message ──
  sendUserMessageMutation: ReturnType<typeof useMutation<
    { id: number; content: string; sender_id: number } | undefined,
    Error,
    { conversationId: number; content: string; agentMode?: 'ask' | 'read' | 'agent'; thinking?: boolean }
  >>;

  // ── All Tables (for auto-mapping) ──
  allTablesData: ReturnType<typeof useAllTables>['data'];
}

// ─── The Hook ─────────────────────────────────────────────────────────────────

export function useChatQueries(params: UseChatQueriesParams): UseChatQueriesResult {
  const {
    effectiveSpaceId,
    activePanel,
    showAllContacts,
    tasksSource,
    filesSource,
    showFilePicker,
    chatOperatorId,
    currentAgent,
    chatPartner,
    userConversationId,
    currentConversationId,
    isAgentProcessing,
    currentUserId,
    onAgentsReload,
  } = params;

  const currentSpace = useCurrentSpace();
  const queryClient = useQueryClient();

  // ── All Tables (for auto-mapping in settings) ──────────────────────────────
  const { data: allTablesData } = useAllTables();

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTACTS
  // ═══════════════════════════════════════════════════════════════════════════

  const { data: spaceUsers = [], isLoading: isLoadingSpaceUsers } = useQuery({
    queryKey: ['chat-space-users', effectiveSpaceId],
    queryFn: async () => {
      if (!effectiveSpaceId) {
        logger.debug('[useChatQueries] spaceUsers query: no spaceId available');
        return [];
      }
      logger.debug('[useChatQueries] Fetching space users for space:', effectiveSpaceId);
      const response = await apiClient.get<{ success: boolean; data: { users: SpaceUser[]; source: string; table_id: number | null } }>(
        `/access/space/${effectiveSpaceId}/available-users`
      );
      logger.debug('[useChatQueries] Space users response:', response.success, response.data?.users?.length);
      const users = response.success && response.data?.users ? response.data.users : [];
      return users.map(u => ({ ...u, avatar_url: u.avatar_url || u.avatar || undefined }));
    },
    enabled: activePanel === 'contacts' && !!effectiveSpaceId,
  });

  const { data: allUsers = [], isLoading: isLoadingAllUsers } = useQuery({
    queryKey: ['chat-all-users'],
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data: SpaceUser[] }>('/users');
      const users = response.success ? response.data : [];
      return users.map(u => ({ ...u, avatar_url: u.avatar_url || u.avatar || undefined }));
    },
    enabled: activePanel === 'contacts' && showAllContacts,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // INBOX: Unread Count + Conversations
  // ═══════════════════════════════════════════════════════════════════════════

  const { data: unreadData, refetch: refetchUnread } = useQuery({
    queryKey: ['chat-unread-total'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<{ total_unread: number }>>('/chat/unread');
      return response?.data || { total_unread: 0 };
    },
    refetchInterval: 30000,
  });

  const totalUnreadCount = unreadData?.total_unread || 0;

  const INBOX_PAGE_SIZE = 50;
  const {
    data: inboxData,
    isLoading: isLoadingInbox,
    refetch: refetchInbox,
    fetchNextPage: fetchNextInboxPage,
    hasNextPage: hasNextInboxPage,
    isFetchingNextPage: isFetchingNextInboxPage,
  } = useInfiniteQuery({
    queryKey: ['inbox-conversations'],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams();
      params.set('limit', String(INBOX_PAGE_SIZE));
      params.set('offset', String(pageParam));
      const response = await apiClient.get<ApiResponse<PaginatedConversationsResponse>>(`/chat/conversations?${params.toString()}`);
      const data = response?.data;
      if (data && 'conversations' in data) {
        return data as PaginatedConversationsResponse;
      }
      const arr = (Array.isArray(data) ? data : []) as InboxConversation[];
      return { conversations: arr, total_count: arr.length, has_more: false, limit: INBOX_PAGE_SIZE, offset: pageParam } as PaginatedConversationsResponse;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (!lastPage.has_more) return undefined;
      return lastPage.offset + lastPage.limit;
    },
    enabled: activePanel === 'inbox',
    maxPages: 10,
  });
  const inboxConversations = useMemo(
    () => inboxData?.pages?.flatMap(page => page.conversations ?? []) ?? [],
    [inboxData]
  );

  const markAsReadMutation = useMutation({
    mutationFn: async (conversationId: number) => {
      await apiClient.post(`/chat/conversations/${conversationId}/read`);
    },
    onSuccess: () => {
      refetchUnread();
      refetchInbox();
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TASKS
  // ═══════════════════════════════════════════════════════════════════════════

  const { data: taskRows = [], isLoading: isLoadingTasks } = useQuery({
    queryKey: ['task-rows', tasksSource?.tableId],
    queryFn: async () => {
      if (!tasksSource?.tableId) return [];
      const response = await apiClient.get<{
        success: boolean;
        data: { rows: Array<{ id: number; data: Record<string, unknown> }> };
      }>(`/tables/${tasksSource.tableId}/rows?limit=100`);
      return response.success ? response.data.rows : [];
    },
    enabled: !!tasksSource?.tableId && activePanel === 'tasks',
    staleTime: 30_000,
  });

  const { data: taskStatusDict = [] } = useQuery<TaskStatusEntry[]>({
    queryKey: ['task-status-dict', tasksSource?.statusDictTableId],
    queryFn: async () => {
      const response = await apiClient.get<{
        success: boolean;
        data: { rows: Array<{ id: number; data: Record<string, unknown> }> };
      }>(`/tables/${tasksSource!.statusDictTableId}/rows`);
      if (!response.success) return [];
      return (response.data.rows || []).map(r => ({
        id: r.id,
        name: String(r.data['name'] || r.data['title'] || ''),
        color: r.data['color'] as string | undefined,
      }));
    },
    enabled: !!tasksSource?.statusDictTableId,
    staleTime: 5 * 60_000,
  });

  const { data: tasksTableColumns = [] } = useQuery<TableColumn[]>({
    queryKey: ['tasks-table-columns', tasksSource?.tableId],
    queryFn: async () => {
      const response = await apiClient.get<{
        success: boolean;
        data: TableColumn[];
      }>(`/tables/${tasksSource!.tableId}/columns`);
      return response.success ? (response.data || []) : [];
    },
    enabled: !!tasksSource?.tableId,
    staleTime: 5 * 60_000,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FILES
  // ═══════════════════════════════════════════════════════════════════════════

  const { data: projectFiles = [], isLoading: isLoadingFiles } = useQuery({
    queryKey: ['project-files', filesSource?.projectId],
    queryFn: async () => {
      if (!filesSource?.projectId) return [];
      const response = await filesApi.list({ projectId: filesSource.projectId, limit: 100 });
      return response.files || [];
    },
    enabled: !!filesSource?.projectId && showFilePicker,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AI PROVIDERS & MODELS
  // ═══════════════════════════════════════════════════════════════════════════

  const { data: operators = [] } = useQuery({
    queryKey: ['ai-operators', currentSpace?.id],
    queryFn: async () => {
      const response = await apiClient.get<{
        success: boolean;
        data?: { providers: AIOperator[] };
        providers?: AIOperator[];
      }>(`/ai/providers?spaceId=${currentSpace?.id || ''}`);
      return response.data?.providers || response.providers || [];
    },
    enabled: activePanel === 'settings' || activePanel === 'ai-agents',
  });

  const { data: models = [] } = useQuery({
    queryKey: ['ai-models', chatOperatorId || currentAgent?.operator_id],
    queryFn: async () => {
      const opId = chatOperatorId || currentAgent?.operator_id;
      if (!opId) return [];
      const response = await apiClient.get<{
        success: boolean;
        data?: { models: AIModel[] };
        models?: AIModel[];
      }>(`/ai/providers/${opId}/models`);
      return response.data?.models || response.models || [];
    },
    enabled:
      (activePanel === 'settings' || activePanel === 'ai-agents') &&
      !!(chatOperatorId || currentAgent?.operator_id),
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AI TABLE CREATION
  // ═══════════════════════════════════════════════════════════════════════════

  const createTablesMutation = useMutation({
    mutationFn: async () => {
      if (!currentSpace?.id) throw new Error('No space selected');
      const response = await apiClient.post<{ success: boolean; tables?: unknown }>('/ai/setup-tables', {
        spaceId: currentSpace.id,
      });
      if (!response.success) throw new Error('Failed to create tables');
      return response;
    },
    onSuccess: () => {
      onAgentsReload();
      queryClient.invalidateQueries({ queryKey: ['ai-agents'] });
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MENTIONS: Users for @mentions
  // ═══════════════════════════════════════════════════════════════════════════

  const { data: usersForMentions = [] } = useQuery({
    queryKey: ['users-for-mentions', effectiveSpaceId],
    queryFn: async () => {
      if (!effectiveSpaceId) return [];
      const response = await apiClient.get<{
        success: boolean;
        data: { users: SpaceUser[]; source: string; table_id: number | null };
      }>(`/access/space/${effectiveSpaceId}/available-users`);
      return response.success && response.data?.users ? response.data.users : [];
    },
    enabled: !!effectiveSpaceId,
    staleTime: 60000,
  });

  const availableMentionUsers: MentionUser[] = useMemo(() => {
    return usersForMentions.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar_url,
      type: user.managed_by_agent_table_id ? ('bot' as const) : ('human' as const),
    }));
  }, [usersForMentions]);

  // ═══════════════════════════════════════════════════════════════════════════
  // SLASH COMMANDS: AI Agents for /commands
  // ═══════════════════════════════════════════════════════════════════════════

  const { data: aiAgentsData } = useQuery({
    queryKey: ['ai-agents-for-slash', effectiveSpaceId],
    queryFn: async () => {
      const response = await apiClient.get<{
        success: boolean;
        data: { agents: AgentForSlash[] };
      }>(`/ai/agents/${effectiveSpaceId}`);
      return response;
    },
    enabled: !!effectiveSpaceId,
    staleTime: 60000,
  });

  const availableSlashAgents: MentionUser[] = useMemo(() => {
    const agentsList = aiAgentsData?.data?.agents || [];
    return agentsList
      .filter(agent => agent.status !== 'inactive' && agent.name)
      .map(agent => ({
        id: agent.id,
        name: agent.name,
        icon: agent.icon,
        email: agent.description,
        type: 'agent' as const,
      }));
  }, [aiAgentsData]);

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVERSATION MESSAGES (User/Group)
  // ═══════════════════════════════════════════════════════════════════════════

  const {
    conversation: userConversationData,
    messages: userConversationMessages,
    hasNextPage: hasOlderMessages,
    fetchNextPage: fetchOlderMessages,
    isFetchingNextPage: isFetchingOlderMessages,
    refetch: refetchUserMessages,
    markAsRead,
    pollingError: userPollingError,
    pollingStopped: userPollingStopped,
    reconnect: userReconnect,
  } = useConversationMessages(userConversationId, {
    pageSize: CHAT_CONFIG.MESSAGE_PAGE_SIZE,
    enabled: !!userConversationId && (chatPartner?.type === 'user' || chatPartner?.type === 'group'),
    adaptivePolling: true,
    chatActivityState: 'active',
    currentUserId,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVERSATION MESSAGES (AI Agent)
  // ═══════════════════════════════════════════════════════════════════════════

  const {
    messages: aiConversationMessages,
    conversation: aiConversationData,
    isLoading: isLoadingAIMessages,
    fetchNextPage: fetchNextAIPage,
    hasNextPage: hasNextAIPage,
    isFetchingNextPage: isFetchingNextAIPage,
    pollingError: aiPollingError,
    pollingStopped: aiPollingStopped,
    reconnect: aiReconnect,
  } = useConversationMessages(currentConversationId, {
    pageSize: CHAT_CONFIG.MESSAGE_PAGE_SIZE,
    enabled: !!currentConversationId && chatPartner?.type === 'agent',
    adaptivePolling: true,
    chatActivityState: isAgentProcessing ? 'agent_processing' : 'idle',
    currentUserId,
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SEND USER MESSAGE
  // ═══════════════════════════════════════════════════════════════════════════

  const sendUserMessageMutation = useMutation({
    mutationFn: async ({
      conversationId,
      content,
      agentMode: mode,
      thinking,
      mentions,
      attachments,
      replyTo,
    }: {
      conversationId: number;
      content: string;
      agentMode?: 'ask' | 'read' | 'agent';
      thinking?: boolean;
      mentions?: Array<{ user_id: number; name?: string; type?: string }>;
      attachments?: Array<{ id: string; name: string; type: string; size: number; url?: string; preview?: string }>;
      replyTo?: { message_id: number; fragment?: string; range?: [number, number] };
    }) => {
      const response = await apiClient.post<
        ApiResponse<{ id: number; content: string; sender_id: number }>
      >(`/chat/conversations/${conversationId}/messages`, {
        content,
        content_type: 'text',
        ...(mode && { agent_mode: mode }),
        ...(thinking !== undefined && { thinking_enabled: thinking }),
        ...(mentions && mentions.length > 0 && { mentions }),
        ...(attachments && attachments.length > 0 && { attachments }),
        ...(replyTo && { reply_to: replyTo }),
      });
      return response?.data;
    },
    onSuccess: () => {
      refetchUserMessages();
    },
  });

  // ─── Return ─────────────────────────────────────────────────────────────────

  return {
    // Contacts
    spaceUsers,
    isLoadingSpaceUsers,
    allUsers,
    isLoadingAllUsers,

    // Inbox
    totalUnreadCount,
    refetchUnread,
    inboxConversations,
    isLoadingInbox,
    refetchInbox,
    fetchNextInboxPage,
    hasNextInboxPage: hasNextInboxPage ?? false,
    isFetchingNextInboxPage,
    markAsReadMutation,

    // Tasks
    taskRows,
    isLoadingTasks,
    taskStatusDict,
    tasksTableColumns,

    // Files
    projectFiles,
    isLoadingFiles,

    // AI Providers & Models
    operators,
    models,

    // AI Table Creation
    createTablesMutation,

    // Mentions
    usersForMentions,
    availableMentionUsers,

    // Slash Commands
    availableSlashAgents,

    // User Conversation Messages
    userConversationData,
    userConversationMessages: (userConversationMessages || []) as ChatMessage[],
    hasOlderMessages: !!hasOlderMessages,
    fetchOlderMessages,
    isFetchingOlderMessages,
    refetchUserMessages,
    markAsRead,
    userPollingError: userPollingError ?? null,
    userPollingStopped: !!userPollingStopped,
    userReconnect,

    // AI Agent Conversation Messages
    aiConversationMessages: (aiConversationMessages || []) as ChatMessage[],
    aiConversationData,
    isLoadingAIMessages,
    fetchNextAIPage,
    hasNextAIPage: !!hasNextAIPage,
    isFetchingNextAIPage,
    aiPollingError: aiPollingError ?? null,
    aiPollingStopped: !!aiPollingStopped,
    aiReconnect,

    // Send User Message
    sendUserMessageMutation,

    // All Tables
    allTablesData,
  };
}
