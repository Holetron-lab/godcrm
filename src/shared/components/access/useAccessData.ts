/**
 * Custom hook encapsulating all data fetching, mutations, and state for UserAccessPanel
 */

import { useState, useMemo, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type { UserAccessLevel, UserAccessPermissionWithUser, PermissionEntityType } from '@/shared/types/user-access.types';
import { ACCESS_LEVEL_VALUES, canManageAccess } from '@/shared/types/user-access.types';
import type {
  User,
  SpaceTable,
  TableColumn,
  RoleMapping,
  UserTableRow,
  SpaceTableInfo,
  AccessPanelTab,
} from './types';
import { DEFAULT_ROLE_MAPPINGS, SELECTABLE_ACCESS_LEVELS } from './types';

interface UseAccessDataParams {
  entityType: PermissionEntityType;
  entityId: number;
  spaceId: number;
  currentUserLevel: UserAccessLevel;
  ownerOwnerId?: number;
  onPermissionsChange?: (permissions: UserAccessPermissionWithUser[]) => void;
}

export const useAccessData = ({
  entityType,
  entityId,
  spaceId,
  currentUserLevel,
  ownerOwnerId,
  onPermissionsChange,
}: UseAccessDataParams) => {
  const queryClient = useQueryClient();

  // Active tab state - default to 'access'
  const [activeTab, setActiveTab] = useState<AccessPanelTab>('access');

  const [enabled, setEnabled] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [selectedUsersToAdd, setSelectedUsersToAdd] = useState<Array<{ userId: number; level: UserAccessLevel }>>([]);
  const [selectedLevel, setSelectedLevel] = useState<UserAccessLevel>('viewer');
  const [localPermissions, setLocalPermissions] = useState<UserAccessPermissionWithUser[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [selectedRoleColumnId, setSelectedRoleColumnId] = useState<string | null>(null);
  const [roleMappings, setRoleMappings] = useState<RoleMapping[]>(DEFAULT_ROLE_MAPPINGS);
  const [customMappingValue, setCustomMappingValue] = useState('');
  const [customMappingLevel, setCustomMappingLevel] = useState<UserAccessLevel>('viewer');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState(''); // Search in space users list
  const [addUserSearchQuery, setAddUserSearchQuery] = useState(''); // Search for adding new user

  // State for editing user granular access
  const [editingUserRowId, setEditingUserRowId] = useState<string | null>(null);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState<string | null>(null);
  const [updatingRoleRowId, setUpdatingRoleRowId] = useState<string | null>(null);

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
    enabled: showAddUser || activeTab === 'users'
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
        }
      }>(`/access/space/${spaceId}/settings`);
      return response.data;
    },
    enabled: !!spaceId && entityType === 'space'
  });

  // Apply loaded settings
  useEffect(() => {
    if (accessSettings && !settingsLoaded) {
      const ac = accessSettings.access_control;
      setEnabled(ac.enabled ?? false);
      if (ac.users_table_id) {
        setSelectedTableId(ac.users_table_id);
      }
      if (ac.role_column_id) {
        // Convert to string since column IDs are strings in UI
        setSelectedRoleColumnId(String(ac.role_column_id));
      }
      if (ac.role_mappings && ac.role_mappings.length > 0) {
        setRoleMappings(ac.role_mappings);
      }
      setSettingsLoaded(true);
    }
  }, [accessSettings, settingsLoaded]);

  // Handle enable/disable toggle
  const handleEnableToggle = async (newEnabled: boolean) => {
    if (newEnabled) {
      // Enable - create users table if needed
      setIsEnabling(true);
      try {
        const response = await apiClient.request<{
          data: {
            access_control: {
              enabled: boolean;
              users_table_id: number | null;
              role_column_id: string | null;
              role_mappings: RoleMapping[];
            };
          }
        }>(`/access/space/${spaceId}/enable`, { method: 'POST' });

        const ac = response.data?.access_control;
        if (ac) {
          setEnabled(true);
          if (ac.users_table_id) setSelectedTableId(ac.users_table_id);
          if (ac.role_column_id) setSelectedRoleColumnId(String(ac.role_column_id));
          if (ac.role_mappings) setRoleMappings(ac.role_mappings);
        }
      } catch (error) {
        logger.error('Failed to enable access control:', error);
      } finally {
        setIsEnabling(false);
      }
    } else {
      // Disable
      try {
        await apiClient.request(`/access/space/${spaceId}/disable`, { method: 'POST' });
        setEnabled(false);
      } catch (error) {
        logger.error('Failed to disable access control:', error);
      }
    }
  };

  // Save settings when they change
  const saveSettings = async () => {
    if (!enabled) return;

    try {
      await apiClient.request(`/access/space/${spaceId}/settings`, {
        method: 'PUT',
        body: JSON.stringify({
          users_table_id: selectedTableId,
          role_column_id: selectedRoleColumnId,
          role_mappings: roleMappings
        })
      });
    } catch (error) {
      logger.error('Failed to save access settings:', error);
    }
  };

  // Auto-save when settings change
  useEffect(() => {
    if (settingsLoaded && enabled) {
      const timer = setTimeout(saveSettings, 500);
      return () => clearTimeout(timer);
    }
  }, [selectedTableId, selectedRoleColumnId, roleMappings, enabled, settingsLoaded]);

  // Fetch available tables in this space
  const { data: tablesData, isLoading: isLoadingTables } = useQuery({
    queryKey: ['space-tables', spaceId],
    queryFn: async () => {
      const response = await apiClient.request<{
        data: {
          tables: SpaceTable[];
          default_table_id: number | null;
        }
      }>(`/access/space/${spaceId}/tables`);
      return response.data || { tables: [], default_table_id: null };
    },
    enabled: !!spaceId && enabled
  });

  // Set default table when data loads (only if not already set from saved settings)
  useEffect(() => {
    if (tablesData?.default_table_id && selectedTableId === null) {
      setSelectedTableId(tablesData.default_table_id);
    }
  }, [tablesData?.default_table_id]);

  // Group tables by project
  const tablesByProject = useMemo(() => {
    if (!tablesData?.tables) return {};
    const grouped: Record<string, SpaceTable[]> = {};
    for (const table of tablesData.tables) {
      const key = table.project_name || 'Unknown';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(table);
    }
    return grouped;
  }, [tablesData?.tables]);

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
      return cols.filter(
        (col: TableColumn) => {
          const colType = col.column_type || col.type || '';
          return ['text', 'select', 'multi-select'].includes(colType);
        }
      );
    },
    enabled: !!selectedTableId && enabled
  });

  // Auto-select role column when columns load
  useEffect(() => {
    if (tableColumns.length > 0 && !selectedRoleColumnId) {
      // Find column named 'role' or 'Role'
      const roleCol = tableColumns.find((col: TableColumn) =>
        col.name?.toLowerCase() === 'role' || col.display_name?.toLowerCase() === 'role'
      );
      if (roleCol) {
        setSelectedRoleColumnId(roleCol.id);
      }
    }
  }, [tableColumns, selectedRoleColumnId]);

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
        }
      }>(url);
      return response.data || { users: [], source: 'system' };
    },
    enabled: !!spaceId
  });

  const allUsers = Array.isArray(usersData?.users) ? usersData.users : [];

  // Fetch users from the selected users table with their granular access data
  const { data: usersTableData, refetch: refetchUsersTable, isLoading: isLoadingUsersTable } = useQuery({
    queryKey: ['users-table-rows', selectedTableId],
    queryFn: async () => {
      if (!selectedTableId) return { rows: [], columns: [], columnMap: {} };

      logger.debug('[UserAccessPanel] Fetching users from table:', selectedTableId);

      // Get table rows - API returns { data: { rows: [...], pagination: {...} } }
      const rowsResponse = await apiClient.request<{ data: { rows: Array<{ id: string; base_id: string; data: Record<string, unknown> }>; pagination: unknown } }>(
        `/tables/${selectedTableId}/rows`
      );

      // Get all columns (including granular access columns)
      const columnsResponse = await apiClient.request<{ data: TableColumn[] }>(
        `/tables/${selectedTableId}/columns`
      );

      // Extract rows from nested structure
      const rowsData = rowsResponse.data;
      const rows = Array.isArray(rowsData?.rows) ? rowsData.rows : (Array.isArray(rowsData) ? rowsData : []);
      const columns = Array.isArray(columnsResponse.data) ? columnsResponse.data : [];

      logger.debug('[UserAccessPanel] Got', rows.length, 'rows and', columns.length, 'columns');

      // Map column names to IDs for easier access
      // API returns column_name, not name
      const columnMap: Record<string, string> = {};
      columns.forEach(col => {
        const colName = (col as unknown as Record<string, unknown>).column_name as string || col.name;
        if (colName) columnMap[colName] = col.id;
      });

      logger.debug('[UserAccessPanel] Column map:', columnMap);

      // Parse rows into UserTableRow format
      const userRows: UserTableRow[] = rows.map(row => {
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
    enabled: !!selectedTableId && enabled
  });

  const usersTableRows = Array.isArray(usersTableData?.rows) ? usersTableData.rows : [];
  const usersTableColumns = Array.isArray(usersTableData?.columns) ? usersTableData.columns : [];
  const usersColumnMap = usersTableData?.columnMap || {};

  // Debug log
  logger.debug('[UserAccessPanel] systemUsers:', systemUsers.length, 'usersTableRows:', usersTableRows.length);

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
              columns: cols.map(c => ({
                id: Number(c.id),
                name: c.name || '',
                display_name: c.display_name || c.name || ''
              }))
            };
          } catch {
            return {
              id: table.id,
              name: table.key,
              display_name: table.display_name,
              project_id: table.project_id,
              project_name: table.project_name,
              columns: []
            };
          }
        })
      );

      return tablesWithColumns;
    },
    enabled: !!spaceId && enabled && activeTab === 'users'
  });

  // Find owner_owner user info
  const ownerOwnerUser = useMemo(() => {
    if (!ownerOwnerId) return null;
    const users = Array.isArray(allUsers) ? allUsers : [];
    return users.find(u => u.id === ownerOwnerId) || null;
  }, [allUsers, ownerOwnerId]);

  // Fetch current permissions for this entity
  const { data: permissions = [], refetch: refetchPermissions } = useQuery({
    queryKey: ['user-access-permissions', entityType, entityId],
    queryFn: async () => {
      const response = await apiClient.request<{ data: UserAccessPermissionWithUser[] }>(
        `/access/${entityType}/${entityId}/permissions`
      );
      return response.data || [];
    },
    enabled: enabled
  });

  // Combine permissions with local changes
  const displayPermissions = useMemo(() => {
    const local = Array.isArray(localPermissions) ? localPermissions : [];
    const perms = Array.isArray(permissions) ? permissions : [];
    return local.length > 0 ? local : perms;
  }, [localPermissions, permissions]);

  // Users not yet added (kept for backward compatibility)
  const availableUsers = useMemo(() => {
    const dp = Array.isArray(displayPermissions) ? displayPermissions : [];
    const all = Array.isArray(allUsers) ? allUsers : [];
    const existingUserIds = new Set(dp.map(p => p.user_id));
    return all.filter(u => !existingUserIds.has(u.id));
  }, [allUsers, displayPermissions]);

  // Handle adding multiple users to the Users table
  const handleAddUsersToTable = async () => {
    logger.debug('[UserAccessPanel] handleAddUsersToTable called:', { selectedUsersToAdd, selectedTableId });

    if (selectedUsersToAdd.length === 0 || !selectedTableId) {
      logger.error('[UserAccessPanel] No users selected or no table:', { selectedUsersToAdd, selectedTableId });
      return;
    }

    setIsAddingUser(true);
    try {
      const colMap = usersColumnMap;
      logger.debug('[UserAccessPanel] usersColumnMap:', colMap);

      // Add each user
      for (const { userId, level } of selectedUsersToAdd) {
        const user = systemUsers.find(u => u.id === userId);
        if (!user) continue;

        // Build row data using column IDs
        const rowData: Record<string, unknown> = {};

        // Set system_user_id
        const sysUserIdCol = Object.entries(colMap).find(([name]) => name === 'system_user_id');
        if (sysUserIdCol) rowData[sysUserIdCol[1]] = user.id;

        // Set email
        const emailCol = Object.entries(colMap).find(([name]) => name === 'email');
        if (emailCol) rowData[emailCol[1]] = user.email;

        // Set name
        const nameCol = Object.entries(colMap).find(([name]) => name === 'name');
        if (nameCol) rowData[nameCol[1]] = user.name;

        // Set role from selected level
        const roleCol = Object.entries(colMap).find(([name]) => name === 'role');
        if (roleCol) rowData[roleCol[1]] = level;

        // Set active = true
        const activeCol = Object.entries(colMap).find(([name]) => name === 'active');
        if (activeCol) rowData[activeCol[1]] = true;

        // Initialize all granular access columns to empty arrays
        const accessColumns = [
          'space_owner', 'space_admin', 'space_editor', 'space_viewer', 'space_denied',
          'project_owner', 'project_admin', 'project_editor', 'project_viewer', 'project_denied',
          'table_owner', 'table_admin', 'table_editor', 'table_viewer', 'table_denied',
          'column_owner', 'column_admin', 'column_editor', 'column_viewer', 'column_denied'
        ];

        for (const colName of accessColumns) {
          const col = Object.entries(colMap).find(([name]) => name === colName);
          if (col) rowData[col[1]] = [];
        }

        logger.debug('[UserAccessPanel] Adding user to table:', { userId: user.id, tableId: selectedTableId, data: rowData });

        // Create row in the users table
        await apiClient.request(`/tables/${selectedTableId}/rows`, {
          method: 'POST',
          body: JSON.stringify({ data: rowData })
        });
      }

      // Refresh the users list
      await refetchUsersTable();

      // Reset form
      setShowAddUser(false);
      setSelectedUsersToAdd([]);
      setSelectedLevel('viewer');
      setAddUserSearchQuery('');
    } catch (error) {
      logger.error('Failed to add users to table:', error);
    } finally {
      setIsAddingUser(false);
    }
  };

  // Toggle user in selection list
  const toggleUserSelection = (userId: number) => {
    setSelectedUsersToAdd(prev => {
      const existing = prev.find(u => u.userId === userId);
      if (existing) {
        return prev.filter(u => u.userId !== userId);
      } else {
        return [...prev, { userId, level: selectedLevel }];
      }
    });
  };

  // Update role for a selected user
  const updateSelectedUserLevel = (userId: number, level: UserAccessLevel) => {
    setSelectedUsersToAdd(prev =>
      prev.map(u => u.userId === userId ? { ...u, level } : u)
    );
  };

  // Remove user from selection
  const removeUserFromSelection = (userId: number) => {
    setSelectedUsersToAdd(prev => prev.filter(u => u.userId !== userId));
  };

  // Handle deleting a user from the Users table
  const handleDeleteUserFromTable = async (rowId: string, userName: string) => {
    if (!selectedTableId) return;

    const confirmed = confirm(`Удалить пользователя "${userName}" из таблицы?`);
    if (!confirmed) return;

    setIsDeletingUser(rowId);
    try {
      logger.debug('[UserAccessPanel] Deleting user row:', { rowId, tableId: selectedTableId });

      // Delete row from the users table using base_id
      await apiClient.request(`/tables/${selectedTableId}/rows/${rowId}`, {
        method: 'DELETE'
      });

      // Refresh the users list
      await refetchUsersTable();

      // Close edit panel if this user was being edited
      if (editingUserRowId === rowId) {
        setEditingUserRowId(null);
      }
    } catch (error) {
      logger.error('Failed to delete user from table:', error);
      alert('Ошибка при удалении пользователя');
    } finally {
      setIsDeletingUser(null);
    }
  };

  // Handle changing a user's level
  const handleLevelChange = (userId: number, newLevel: UserAccessLevel) => {
    const updated = displayPermissions.map(p =>
      p.user_id === userId ? { ...p, access_level: newLevel, updated_at: new Date().toISOString() } : p
    );
    setLocalPermissions(updated);
    onPermissionsChange?.(updated);
  };

  // Handle removing a user
  const handleRemoveUser = (userId: number) => {
    const updated = displayPermissions.filter(p => p.user_id !== userId);
    setLocalPermissions(updated);
    onPermissionsChange?.(updated);
  };

  const handleUpdateUserRole = async (rowId: string, newRole: UserAccessLevel) => {
    if (!selectedTableId) return;

    setUpdatingRoleRowId(rowId);
    try {
      const colMap = usersColumnMap;
      const roleCol = Object.entries(colMap).find(([name]) => name === 'role');

      if (!roleCol) {
        logger.error('[UserAccessPanel] Role column not found in columnMap');
        return;
      }

      const updateData: Record<string, unknown> = {
        [roleCol[1]]: newRole
      };

      logger.debug('[UserAccessPanel] Updating user role:', { rowId, newRole, tableId: selectedTableId, data: updateData });

      await apiClient.request(`/tables/${selectedTableId}/rows/${rowId}`, {
        method: 'PUT',
        body: JSON.stringify({ data: updateData })
      });

      // Refresh the users list
      await refetchUsersTable();
    } catch (error) {
      logger.error('Failed to update user role:', error);
      alert('Ошибка при обновлении роли пользователя');
    } finally {
      setUpdatingRoleRowId(null);
    }
  };

  // Handle updating granular access for a specific level
  const handleUpdateGranularAccess = async (
    rowId: string,
    entityLevel: 'project' | 'table' | 'column',
    accessLevel: UserAccessLevel,
    entityIds: string[]
  ) => {
    if (!selectedTableId) return;

    try {
      const colMap = usersColumnMap;
      const columnName = `${entityLevel}_${accessLevel}`;
      const col = Object.entries(colMap).find(([name]) => name === columnName);

      if (!col) {
        logger.error(`[UserAccessPanel] Column ${columnName} not found in columnMap`);
        return;
      }

      const updateData: Record<string, unknown> = {
        [col[1]]: entityIds
      };

      logger.debug('[UserAccessPanel] Updating granular access:', { rowId, columnName, entityIds, tableId: selectedTableId });

      await apiClient.request(`/tables/${selectedTableId}/rows/${rowId}`, {
        method: 'PUT',
        body: JSON.stringify({ data: updateData })
      });

      // Refresh the users list
      await refetchUsersTable();
    } catch (error) {
      logger.error('Failed to update granular access:', error);
    }
  };

  // Check if current user can manage target user
  const canManage = (targetLevel: UserAccessLevel, targetUserId: number): boolean => {
    // Cannot remove owner_owner
    if (targetUserId === ownerOwnerId) return false;
    return canManageAccess(currentUserLevel, targetLevel);
  };

  // Get available levels for dropdown based on current user's level
  const getAvailableLevels = (): { value: UserAccessLevel; label: string }[] => {
    return SELECTABLE_ACCESS_LEVELS.filter(level =>
      ACCESS_LEVEL_VALUES[currentUserLevel] > ACCESS_LEVEL_VALUES[level.value]
    );
  };

  return {
    // State
    activeTab,
    setActiveTab,
    enabled,
    isEnabling,
    showAddUser,
    setShowAddUser,
    selectedUsersToAdd,
    setSelectedUsersToAdd,
    selectedLevel,
    setSelectedLevel,
    selectedTableId,
    setSelectedTableId,
    selectedRoleColumnId,
    setSelectedRoleColumnId,
    roleMappings,
    setRoleMappings,
    customMappingValue,
    setCustomMappingValue,
    customMappingLevel,
    setCustomMappingLevel,
    userSearchQuery,
    setUserSearchQuery,
    addUserSearchQuery,
    setAddUserSearchQuery,
    editingUserRowId,
    setEditingUserRowId,
    isAddingUser,
    isDeletingUser,
    updatingRoleRowId,

    // Data
    systemUsers,
    isLoadingSettings,
    isLoadingTables,
    isLoadingUsersTable,
    tablesData,
    tablesByProject,
    tableColumns,
    allUsers,
    usersTableRows,
    usersTableColumns,
    usersColumnMap,
    allSpaceTables,
    ownerOwnerUser,
    displayPermissions,
    availableUsers,

    // Actions
    handleEnableToggle,
    handleAddUsersToTable,
    toggleUserSelection,
    updateSelectedUserLevel,
    removeUserFromSelection,
    handleDeleteUserFromTable,
    handleLevelChange,
    handleRemoveUser,
    handleUpdateUserRole,
    handleUpdateGranularAccess,
    canManage,
    getAvailableLevels,
  };
};
