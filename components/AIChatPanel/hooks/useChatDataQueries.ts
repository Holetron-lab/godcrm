/**
 * useChatDataQueries — React Query hooks for AIChatPanel data fetching.
 * Extracted from AIChatPanel.tsx (lines 317-566).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { filesApi } from '@/features/files/api/filesApi';
import { logger } from '@/shared/utils/logger';
import type { PanelTab, TasksSourceConfig, FilesSourceConfig, ApiResponse, InboxConversation } from '../../AIChatPanel.types';

interface UseChatDataQueriesParams {
  activePanel: PanelTab;
  effectiveSpaceId: number | string | undefined;
  showAllContacts: boolean;
  tasksSource: TasksSourceConfig | undefined;
  filesSource: FilesSourceConfig | undefined;
  showFilePicker: boolean;
  chatOperatorId: number | null;
  currentAgent: { id: number; operator_id?: number; provider_id?: number } | null;
  currentSpaceId: number | string | undefined;
  inboxSearch: string;
  inboxAgentFilter: string;
  inboxDateFrom: string;
  inboxDateTo: string;
  contextSpaceId: number | string | undefined;
}

export function useChatDataQueries({
  activePanel,
  effectiveSpaceId,
  showAllContacts,
  tasksSource,
  filesSource,
  showFilePicker,
  chatOperatorId,
  currentAgent,
  currentSpaceId,
  inboxSearch,
  inboxAgentFilter,
  inboxDateFrom,
  inboxDateTo,
  contextSpaceId,
}: UseChatDataQueriesParams) {
  const queryClient = useQueryClient();

  // Fetch users for contacts - space members or all
  const { data: spaceUsers = [], isLoading: isLoadingSpaceUsers } = useQuery({
    queryKey: ['chat-space-users', effectiveSpaceId],
    queryFn: async () => {
      if (!effectiveSpaceId) {
        logger.debug('[AIChatPanel] spaceUsers query: no spaceId available');
        return [];
      }
      logger.debug('[AIChatPanel] Fetching space users for space:', effectiveSpaceId);
      const response = await apiClient.get<{ success: boolean; data: { users: Array<{
        id: number;
        name: string;
        email?: string;
        avatar_url?: string;
        managed_by_agent_table_id?: number;
      }>; source: string; table_id: number | null } }>(`/access/space/${effectiveSpaceId}/available-users`);
      logger.debug('[AIChatPanel] Space users response:', response.success, response.data?.users?.length);
      return response.success && response.data?.users ? response.data.users : [];
    },
    enabled: activePanel === 'contacts' && !!effectiveSpaceId
  });

  // Fetch all users (when "show all" is enabled)
  const { data: allUsers = [], isLoading: isLoadingAllUsers } = useQuery({
    queryKey: ['chat-all-users'],
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data: Array<{
        id: number;
        name: string;
        email?: string;
        avatar_url?: string;
        managed_by_agent_table_id?: number;
      }> }>('/users');
      return response.success ? response.data : [];
    },
    enabled: activePanel === 'contacts' && showAllContacts
  });

  // Combined users based on toggle
  const users = showAllContacts ? allUsers : spaceUsers;
  const isLoadingUsers = showAllContacts ? isLoadingAllUsers : isLoadingSpaceUsers;

  // ========== Inbox: Total Unread Count ==========
  const { data: unreadData, refetch: refetchUnread } = useQuery({
    queryKey: ['chat-unread-total'],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<{ total_unread: number }>>('/chat/unread');
      return response?.data || { total_unread: 0 };
    },
    refetchInterval: 30000,
  });

  const totalUnreadCount = unreadData?.total_unread || 0;

  // Ticket #81443/#81444: Fetch inbox conversations with filters
  const { data: inboxConversations = [], isLoading: isLoadingInbox, refetch: refetchInbox } = useQuery({
    queryKey: ['inbox-conversations', inboxSearch, inboxAgentFilter, inboxDateFrom, inboxDateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (inboxSearch) params.set('search', inboxSearch);
      if (inboxAgentFilter) params.set('agent_id', inboxAgentFilter);
      if (inboxDateFrom) params.set('date_from', inboxDateFrom);
      if (inboxDateTo) params.set('date_to', inboxDateTo);
      const qs = params.toString();
      const response = await apiClient.get<ApiResponse<InboxConversation[]>>(`/chat/conversations${qs ? `?${qs}` : ''}`);
      return response?.data || [];
    },
    enabled: activePanel === 'inbox'
  });

  // Mark conversation as read
  const markAsReadMutation = useMutation({
    mutationFn: async (conversationId: number) => {
      await apiClient.post(`/chat/conversations/${conversationId}/read`);
    },
    onSuccess: () => {
      refetchUnread();
      refetchInbox();
    }
  });

  // Fetch tasks
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
    staleTime: 30_000
  });

  // Fetch status dictionary for tasks
  const { data: taskStatusDict = [] } = useQuery<Array<{ id: number; name?: string; color?: string }>>({
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
        color: r.data['color'] as string | undefined
      }));
    },
    enabled: !!tasksSource?.statusDictTableId,
    staleTime: 5 * 60_000
  });

  // Fetch columns for tasks source table
  const { data: tasksTableColumns = [] } = useQuery<Array<{ column_name: string; display_name: string; type: string; config?: string }>>({
    queryKey: ['tasks-table-columns', tasksSource?.tableId],
    queryFn: async () => {
      const response = await apiClient.get<{
        success: boolean;
        data: Array<{ column_name: string; display_name: string; type: string; config?: string }>;
      }>(`/tables/${tasksSource!.tableId}/columns`);
      return response.success ? (response.data || []) : [];
    },
    enabled: !!tasksSource?.tableId,
    staleTime: 5 * 60_000
  });

  // Fetch project files for file picker
  const { data: projectFiles = [], isLoading: isLoadingFiles } = useQuery({
    queryKey: ['project-files', filesSource?.tableId, filesSource?.projectId, effectiveSpaceId],
    queryFn: async () => {
      if (filesSource?.tableId) {
        const response = await filesApi.list({ tableId: filesSource.tableId, limit: 100 });
        if (response.files?.length) return response.files;
      }
      if (filesSource?.projectId) {
        const response = await filesApi.list({ projectId: filesSource.projectId, limit: 100 });
        if (response.files?.length) return response.files;
      }
      if (effectiveSpaceId) {
        const response = await filesApi.list({ spaceId: effectiveSpaceId, limit: 100 });
        return response.files || [];
      }
      return [];
    },
    enabled: showFilePicker && (!!filesSource?.tableId || !!filesSource?.projectId || !!effectiveSpaceId)
  });

  // Fetch AI operators (providers)
  const { data: operators = [] } = useQuery({
    queryKey: ['ai-operators', currentSpaceId],
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data?: { providers: Array<{
        id: number; name: string; base_url?: string; api_key?: string;
      }> }; providers?: Array<{ id: number; name: string; base_url?: string; api_key?: string }> }>(`/ai/providers?spaceId=${currentSpaceId || ''}`);
      return response.data?.providers || response.providers || [];
    },
    enabled: activePanel === 'settings' || activePanel === 'ai-agents'
  });

  // Fetch models for selected operator
  const { data: models = [] } = useQuery({
    queryKey: ['ai-models', chatOperatorId || currentAgent?.operator_id],
    queryFn: async () => {
      const opId = chatOperatorId || currentAgent?.operator_id;
      if (!opId) return [];
      const response = await apiClient.get<{ success: boolean; data?: { models: Array<{
        id: number; name: string; model_id?: string;
      }> }; models?: Array<{ id: number; name: string; model_id?: string }> }>(`/ai/providers/${opId}/models`);
      return response.data?.models || response.models || [];
    },
    enabled: (activePanel === 'settings' || activePanel === 'ai-agents') && !!(chatOperatorId || currentAgent?.operator_id)
  });

  // Create AI tables mutation
  const createTablesMutation = useMutation({
    mutationFn: async (spaceId: number | string) => {
      const response = await apiClient.post<{ success: boolean; tables?: unknown }>('/ai/setup-tables', { spaceId });
      if (!response.success) throw new Error('Failed to create tables');
      return response;
    },
  });

  // Fetch users for @mentions
  const { data: usersForMentions } = useQuery({
    queryKey: ['users-for-mentions', effectiveSpaceId],
    queryFn: async () => {
      if (!effectiveSpaceId) return [];
      const response = await apiClient.get<{ success: boolean; data: { users: Array<{
        id: number; name: string; email?: string; avatar_url?: string; managed_by_agent_table_id?: number;
      }>; source: string; table_id: number | null } }>(`/access/space/${effectiveSpaceId}/available-users`);
      return response.success && response.data?.users ? response.data.users : [];
    },
    enabled: !!effectiveSpaceId,
    staleTime: 60000
  });

  // Fetch AI Agents for /commands
  const { data: aiAgentsData } = useQuery({
    queryKey: ['ai-agents-for-slash', contextSpaceId],
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data: { agents: Array<{ id: number; name: string; icon?: string; description?: string; status?: string }> } }>(
        `/ai/agents/${contextSpaceId}`
      );
      return response;
    },
    enabled: !!contextSpaceId,
    staleTime: 60000
  });

  return {
    // Users
    users, isLoadingUsers, spaceUsers, allUsers,
    // Inbox
    totalUnreadCount, refetchUnread,
    inboxConversations, isLoadingInbox, refetchInbox,
    markAsReadMutation,
    // Tasks
    taskRows, isLoadingTasks, taskStatusDict, tasksTableColumns,
    // Files
    projectFiles, isLoadingFiles,
    // AI
    operators, models, createTablesMutation,
    // Mentions
    usersForMentions, aiAgentsData,
    // Query client
    queryClient,
  };
}
