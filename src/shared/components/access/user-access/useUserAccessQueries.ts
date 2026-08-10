/**
 * useUserAccessQueries - Consolidates all react-query loaders used by
 * UserAccessPanel. Extracted to keep the panel component focused on
 * rendering/handlers. Behavior (keys, enabled flags, parsing) preserved 1:1.
 */

import { useQuery } from '@tanstack/react-query';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import type { PermissionEntityType, UserAccessPermissionWithUser } from '@/shared/types/user-access.types';
import type {
  User,
  SpaceTable,
  TableColumn,
  RoleMapping,
  UserTableRow,
  SpaceTableInfo,
  AccessPanelTab,
} from './types';

interface UseUserAccessQueriesArgs {
  entityType: PermissionEntityType;
  entityId: number;
  spaceId: number;
  enabled: boolean;
  activeTab: AccessPanelTab;
  showAddUser: boolean;
  selectedTableId: number | null;
}

export const useUserAccessQueries = ({
  entityType,
  entityId,
  spaceId,
  enabled,
  activeTab,
  showAddUser,
  selectedTableId,
}: UseUserAccessQueriesArgs) => {
  // Fetch all system users for the add user dropdown
  const { data: systemUsersData, isLoading: isLoadingSystemUsers } = useQuery({
    queryKey: ['system-users-all'],
    queryFn: async () => {
      logger.debug('[UserAccessPanel] Fetching system users...');
      const response = await apiClient.request<{ data: User[] }>('/users');
      logger.debug('[UserAccessPanel] System users response:', response);
      return Array.isArray(response.data) ? response.data : [];
    },
    // Load when on Users tab or when add user form is open
    enabled: showAddUser || activeTab === 'users',
  });

  const systemUsers = Array.isArray(systemUsersData) ? systemUsersData : [];

  // Load access control settings on mount
  const { data: accessSettings, isLoading: isLoadingSettings } = useQuery({
    queryKey: ['access-settings', spaceId],
    queryFn: async () => {
      const response = await apiClient.request<{
        data: {
          access_control: {
            enabled: boolean;
            users_table_id: number | null;
            role_column_id: string | null;
            role_mappings: RoleMapping[];
          };
          owner_id: number;
        };
      }>(`/access/space/${spaceId}/settings`);
      return response.data;
    },
    enabled: !!spaceId && entityType === 'space',
  });

  // Fetch available tables in this space
  const { data: tablesData, isLoading: isLoadingTables } = useQuery({
    queryKey: ['space-tables', spaceId],
    queryFn: async () => {
      const response = await apiClient.request<{
        data: {
          tables: SpaceTable[];
          default_table_id: number | null;
        };
      }>(`/access/space/${spaceId}/tables`);
      return response.data || { tables: [], default_table_id: null };
    },
    enabled: !!spaceId && enabled,
  });

  // Fetch columns for selected table (for role column selection)
  const { data: tableColumns = [] } = useQuery({
    queryKey: ['table-columns-for-access', selectedTableId],
    queryFn: async () => {
      if (!selectedTableId) return [];
      const response = await apiClient.request<{ data: TableColumn[] }>(
        `/tables/${selectedTableId}/columns`
      );
      // response.data is the columns array directly
      const cols = Array.isArray(response.data) ? response.data : [];
      // Filter to text/select columns that might contain role values
      // API may return column_type or type
      return cols.filter((col: TableColumn) => {
        const colType = col.column_type || col.type || '';
        return ['text', 'select', 'multi-select'].includes(colType);
      });
    },
    enabled: !!selectedTableId && enabled,
  });

  // Fetch available users for this space (from selected table)
  const { data: usersData } = useQuery({
    queryKey: ['space-users', spaceId, selectedTableId],
    queryFn: async () => {
      const url = selectedTableId
        ? `/access/space/${spaceId}/available-users?tableId=${selectedTableId}`
        : `/access/space/${spaceId}/available-users`;
      const response = await apiClient.request<{
        data: {
          users: User[];
          source: 'system' | 'table';
          table_id?: number;
        };
      }>(url);
      return response.data || { users: [], source: 'system' };
    },
    enabled: !!spaceId,
  });

  const allUsers = Array.isArray(usersData?.users) ? usersData.users : [];

  // Fetch users from the selected users table with their granular access data
  const {
    data: usersTableData,
    refetch: refetchUsersTable,
    isLoading: isLoadingUsersTable,
  } = useQuery({
    queryKey: ['users-table-rows', selectedTableId],
    queryFn: async () => {
      if (!selectedTableId) return { rows: [], columns: [] };

      logger.debug('[UserAccessPanel] Fetching users from table:', selectedTableId);

      // Get table rows - API returns { data: { rows: [...], pagination: {...} } }
      const rowsResponse = await apiClient.request<{
        data: {
          rows: Array<{ id: string; base_id: string; data: Record<string, unknown> }>;
          pagination: unknown;
        };
      }>(`/tables/${selectedTableId}/rows`);

      // Get all columns (including granular access columns)
      const columnsResponse = await apiClient.request<{ data: TableColumn[] }>(
        `/tables/${selectedTableId}/columns`
      );

      // Extract rows from nested structure
      const rowsData = rowsResponse.data;
      const rows = Array.isArray(rowsData?.rows)
        ? rowsData.rows
        : Array.isArray(rowsData)
          ? rowsData
          : [];
      const columns = Array.isArray(columnsResponse.data) ? columnsResponse.data : [];

      logger.debug('[UserAccessPanel] Got', rows.length, 'rows and', columns.length, 'columns');

      // Map column names to IDs for easier access
      // API returns column_name, not name
      const columnMap: Record<string, string> = {};
      columns.forEach((col) => {
        const colName = ((col as unknown as Record<string, unknown>).column_name as string) || col.name;
        if (colName) columnMap[colName] = col.id;
      });

      logger.debug('[UserAccessPanel] Column map:', columnMap);

      // Parse rows into UserTableRow format
      const userRows: UserTableRow[] = rows.map((row) => {
        const data = row.data || {};

        // Helper to get value by column name or ID
        const getValue = (name: string): unknown => {
          const colId = columnMap[name];
          return data[colId] || data[name];
        };

        const getArrayValue = (name: string): string[] => {
          const val = getValue(name);
          if (Array.isArray(val)) return val.map(String);
          if (typeof val === 'string' && val) return [val];
          return [];
        };

        return {
          row_id: row.base_id || String(row.id),
          system_user_id: Number(getValue('system_user_id')) || null,
          email: String(getValue('email') || ''),
          name: String(getValue('name') || 'Unknown'),
          role: String(getValue('role') || ''),
          active: getValue('active') === true || getValue('active') === 'true',
          avatar: null,
          id: Number(getValue('system_user_id')) || null,
          // Granular access by level - space
          space_owner: getArrayValue('space_owner'),
          space_admin: getArrayValue('space_admin'),
          space_editor: getArrayValue('space_editor'),
          space_viewer: getArrayValue('space_viewer'),
          space_denied: getArrayValue('space_denied'),
          // Granular access by level - project
          project_owner: getArrayValue('project_owner'),
          project_admin: getArrayValue('project_admin'),
          project_editor: getArrayValue('project_editor'),
          project_viewer: getArrayValue('project_viewer'),
          project_denied: getArrayValue('project_denied'),
          // Granular access by level - table
          table_owner: getArrayValue('table_owner'),
          table_admin: getArrayValue('table_admin'),
          table_editor: getArrayValue('table_editor'),
          table_viewer: getArrayValue('table_viewer'),
          table_denied: getArrayValue('table_denied'),
          // Granular access by level - column
          column_owner: getArrayValue('column_owner'),
          column_admin: getArrayValue('column_admin'),
          column_editor: getArrayValue('column_editor'),
          column_viewer: getArrayValue('column_viewer'),
          column_denied: getArrayValue('column_denied'),
        };
      });

      logger.debug('[UserAccessPanel] Parsed', userRows.length, 'users');

      return { rows: userRows, columns, columnMap };
    },
    // Load when enabled and we have a table selected - don't wait for tab switch
    enabled: !!selectedTableId && enabled,
  });

  const usersTableRows = Array.isArray(usersTableData?.rows) ? usersTableData.rows : [];
  const usersTableColumns = Array.isArray(usersTableData?.columns) ? usersTableData.columns : [];
  const usersColumnMap = usersTableData?.columnMap || {};

  // Fetch all tables with columns for granular access selection
  const { data: allSpaceTables = [] } = useQuery({
    queryKey: ['all-space-tables-with-columns', spaceId],
    queryFn: async () => {
      if (!spaceId) return [];

      const response = await apiClient.request<{ data: { tables: SpaceTable[] } }>(
        `/access/space/${spaceId}/tables`
      );

      const tables = response.data?.tables || [];

      // Fetch columns for each table
      const tablesWithColumns: SpaceTableInfo[] = await Promise.all(
        tables.map(async (table) => {
          try {
            const colsResponse = await apiClient.request<{ data: TableColumn[] }>(
              `/tables/${table.id}/columns`
            );
            const cols = Array.isArray(colsResponse.data) ? colsResponse.data : [];
            return {
              id: table.id,
              name: table.key,
              display_name: table.display_name,
              project_id: table.project_id,
              project_name: table.project_name,
              columns: cols.map((c) => ({
                id: Number(c.id),
                name: c.name || '',
                display_name: c.display_name || c.name || '',
              })),
            };
          } catch {
            return {
              id: table.id,
              name: table.key,
              display_name: table.display_name,
              project_id: table.project_id,
              project_name: table.project_name,
              columns: [],
            };
          }
        })
      );

      return tablesWithColumns;
    },
    enabled: !!spaceId && enabled && activeTab === 'users',
  });

  // Fetch current permissions for this entity
  const { data: permissions = [], refetch: refetchPermissions } = useQuery({
    queryKey: ['user-access-permissions', entityType, entityId],
    queryFn: async () => {
      const response = await apiClient.request<{ data: UserAccessPermissionWithUser[] }>(
        `/access/${entityType}/${entityId}/permissions`
      );
      return response.data || [];
    },
    enabled: enabled,
  });

  return {
    // system users
    systemUsers,
    isLoadingSystemUsers,
    // settings
    accessSettings,
    isLoadingSettings,
    // space tables
    tablesData,
    isLoadingTables,
    // columns of selected table
    tableColumns,
    // users directory for current space
    allUsers,
    // full users-table data
    usersTableRows,
    usersTableColumns,
    usersColumnMap,
    isLoadingUsersTable,
    refetchUsersTable,
    // all space tables w/ columns (for granular access UI)
    allSpaceTables,
    // permissions list
    permissions,
    refetchPermissions,
  };
};
