/**
 * useDataQueries — All React Query data-fetching hooks for AIChatPanel.
 * ADR-119: Extracted from monolithic AIChatPanel.tsx
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useCurrentSpace } from '@/features/spaces/store/spacesStore';
import { useAllTables } from '@/features/tables/hooks/useAllTables';
import { filesApi } from '@/features/files/api/filesApi';
import type { PanelTab, TasksSourceConfig, FilesSourceConfig, ApiResponse, InboxConversation } from '../../AIChatPanel.types';
import { getTaskRowTitle, getTaskRowField } from '../../AIChatPanel.utils';

interface UseDataQueriesParams {
  activePanel: PanelTab;
  effectiveSpaceId: number | undefined;
  showAllContacts: boolean;
  tasksSource: TasksSourceConfig | undefined;
  tasksSearch: string;
  filesSource: FilesSourceConfig | undefined;
  showFilePicker: boolean;
  chatOperatorId: number | null;
  currentAgentOperatorId: number | undefined;
  currentAgentProviderId: number | undefined;
  contextSpaceId: number | undefined;
  // Inbox filters
  inboxSearch: string;
  inboxAgentFilter: string;
  inboxDateFrom: string;
  inboxDateTo: string;
}

export function useDataQueries(params: UseDataQueriesParams) {
  const {
    activePanel,
    effectiveSpaceId,
    showAllContacts,
    tasksSource,
    tasksSearch,
    filesSource,
    showFilePicker,
    chatOperatorId,
    currentAgentOperatorId,
    currentAgentProviderId,
    contextSpaceId,
    inboxSearch,
    inboxAgentFilter,
    inboxDateFrom,
    inboxDateTo,
  } = params;

  const currentSpace = useCurrentSpace();
  const { data: allTablesDataMain } = useAllTables();

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

  // Fetch inbox conversations with filters
  const { data: inboxConversations = [], isLoading: isLoadingInbox, refetch: refetchInbox } = useQuery({
    queryKey: ['inbox-conversations', inboxSearch, inboxAgentFilter, inboxDateFrom, inboxDateTo],
    queryFn: async () => {
      const qp = new URLSearchParams();
      if (inboxSearch) qp.set('search', inboxSearch);
      if (inboxAgentFilter) qp.set('agent_id', inboxAgentFilter);
      if (inboxDateFrom) qp.set('date_from', inboxDateFrom);
      if (inboxDateTo) qp.set('date_to', inboxDateTo);
      const qs = qp.toString();
      const response = await apiClient.get<ApiResponse<InboxConversation[]>>(`/chat/conversations${qs ? `?${qs}` : ''}`);
      return response?.data || [];
    },
    enabled: activePanel === 'inbox'
  });

  // Mark conversation as read (mutation inline — thin wrapper)
  // Note: This is a query-level helper, not a full useMutation, to keep it simple.

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

  // Filter tasks by search query (memoized)
  const filteredTaskRows = useMemo(() => {
    if (!tasksSearch.trim()) return taskRows;
    const query = tasksSearch.toLowerCase().trim();
    return taskRows.filter(row => {
      const title = getTaskRowTitle(row, tasksSource).toLowerCase();
      const desc = (getTaskRowField(row, tasksSource?.descriptionColumn) as string | undefined)?.toLowerCase() || '';
      const idStr = `#${row.id}`;
      return title.includes(query) || desc.includes(query) || idStr.includes(query);
    });
  }, [taskRows, tasksSearch, tasksSource]);

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
    queryKey: ['ai-operators', currentSpace?.id],
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data?: { providers: Array<{
        id: number; name: string; base_url?: string; api_key?: string;
      }> }; providers?: Array<{ id: number; name: string; base_url?: string; api_key?: string }> }>(`/ai/providers?spaceId=${currentSpace?.id || ''}`);
      return response.data?.providers || response.providers || [];
    },
    enabled: activePanel === 'settings' || activePanel === 'ai-agents'
  });

  // Fetch models for selected operator
  const { data: models = [] } = useQuery({
    queryKey: ['ai-models', chatOperatorId || currentAgentOperatorId],
    queryFn: async () => {
      const opId = chatOperatorId || currentAgentOperatorId;
      if (!opId) return [];
      const response = await apiClient.get<{ success: boolean; data?: { models: Array<{
        id: number; name: string; model_id?: string;
      }> }; models?: Array<{ id: number; name: string; model_id?: string }> }>(`/ai/providers/${opId}/models`);
      return response.data?.models || response.models || [];
    },
    enabled: (activePanel === 'settings' || activePanel === 'ai-agents') && !!(chatOperatorId || currentAgentOperatorId)
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
    // User data
    users,
    isLoadingUsers,
    spaceUsers,
    allUsers,
    // Inbox
    totalUnreadCount,
    refetchUnread,
    inboxConversations,
    isLoadingInbox,
    refetchInbox,
    // Tasks
    taskRows,
    filteredTaskRows,
    isLoadingTasks,
    taskStatusDict,
    tasksTableColumns,
    // Files
    projectFiles,
    isLoadingFiles,
    // AI settings
    operators,
    models,
    // Mentions & agents
    usersForMentions,
    aiAgentsData,
    // Tables data
    allTablesDataMain,
  };
}
