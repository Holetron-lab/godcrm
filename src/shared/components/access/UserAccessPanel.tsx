/**
 * UserAccessPanel - Universal component for managing user access permissions
 * Used in Space, Project, Table, and Column editing modals
 */

import { useState, useMemo, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { useQueryClient } from '@tanstack/react-query';
import { Switch, Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import {
  UserPlus,
  Shield,
  Database,
  Search,
  Loader2,
} from 'lucide-react';
import type {
  UserAccessLevel,
  UserAccessPermissionWithUser,
  PermissionEntityType,
} from '@/shared/types/user-access.types';
import {
  ACCESS_LEVEL_VALUES,
  canManageAccess,
} from '@/shared/types/user-access.types';
import type {
  SpaceTable,
  TableColumn,
  RoleMapping,
  AccessPanelTab,
} from './user-access/types';
import {
  DEFAULT_ROLE_MAPPINGS,
  SELECTABLE_ACCESS_LEVELS,
  ACCESS_PANEL_TABS,
} from './user-access/constants';
import { AccessContextPanel } from './user-access/AccessContextPanel';
import { AddUsersPanel } from './user-access/AddUsersPanel';
import { RoleMappingsEditor } from './user-access/RoleMappingsEditor';
import { TableAndRoleSelectors } from './user-access/TableAndRoleSelectors';
import { UserCard } from './user-access/UserCard';
import { useUserAccessQueries } from './user-access/useUserAccessQueries';

interface UserAccessPanelProps {
  entityType: PermissionEntityType;
  entityId: number;
  spaceId: number; // Required for loading users from System Data
  currentUserLevel: UserAccessLevel;
  ownerOwnerId?: number;
  onPermissionsChange?: (permissions: UserAccessPermissionWithUser[]) => void;
  // Context info for display
  spaceName?: string;
  projectId?: number;
  projectName?: string;
  tableId?: number;
  tableName?: string;
  columnName?: string;
  // Navigation callbacks
  onNavigateToSpace?: () => void;
  onNavigateToProject?: () => void;
  onNavigateToTable?: () => void;
}

export const UserAccessPanel = ({
  entityType,
  entityId,
  spaceId,
  currentUserLevel,
  ownerOwnerId,
  onPermissionsChange,
  // Context info
  spaceName,
  projectId,
  projectName,
  tableId,
  tableName,
  columnName,
  // Navigation
  onNavigateToSpace,
  onNavigateToProject,
  onNavigateToTable,
}: UserAccessPanelProps) => {
  const { language, t: translate } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const queryClient = useQueryClient();
  
  // Space access opens on the member list; configuration remains in the Access subtab.
  const [activeTab, setActiveTab] = useState<AccessPanelTab>(entityType === 'space' ? 'users' : 'access');
  
  const [enabled, setEnabled] = useState(false);
  const [isEnabling, setIsEnabling] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [selectedUsersToAdd, setSelectedUsersToAdd] = useState<Array<{userId: number; level: UserAccessLevel}>>([]);
  const [selectedLevel, setSelectedLevel] = useState<UserAccessLevel>('viewer');
  const [localPermissions, setLocalPermissions] = useState<UserAccessPermissionWithUser[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [selectedRoleColumnId, setSelectedRoleColumnId] = useState<string | null>(null);
  const [roleMappings, setRoleMappings] = useState<RoleMapping[]>(DEFAULT_ROLE_MAPPINGS);
  const [customMappingValue, setCustomMappingValue] = useState('');
  const [customMappingLevel, setCustomMappingLevel] = useState<UserAccessLevel>('viewer');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState(''); // Search in space users list
  const [visibleUserCount, setVisibleUserCount] = useState(50);
  useEffect(() => { setVisibleUserCount(50); }, [userSearchQuery, selectedTableId]);
  const [addUserSearchQuery, setAddUserSearchQuery] = useState(''); // Search for adding new user
  
  // State for editing user granular access
  const [editingUserRowId, setEditingUserRowId] = useState<string | null>(null);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [isDeletingUser, setIsDeletingUser] = useState<string | null>(null);

  // All react-query loaders live in a dedicated hook
  const {
    systemUsers,
    isLoadingSystemUsers,
    isSystemUsersError,
    refetchSystemUsers,
    accessSettings,
    isLoadingSettings,
    tablesData,
    isLoadingTables,
    tableColumns,
    allUsers,
    usersTableRows,
    usersColumnMap,
    isLoadingUsersTable,
    isUsersTableError,
    refetchUsersTable,
    permissions,
  } = useUserAccessQueries({
    entityType,
    entityId,
    spaceId,
    enabled,
    activeTab,
    showAddUser,
    selectedTableId,
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

  // Debug log
  logger.debug('[UserAccessPanel] systemUsers:', systemUsers.length, 'usersTableRows:', usersTableRows.length);

  // Find owner_owner user info
  const ownerOwnerUser = useMemo(() => {
    if (!ownerOwnerId) return null;
    const users = Array.isArray(allUsers) ? allUsers : [];
    return users.find(u => u.id === ownerOwnerId) || null;
  }, [allUsers, ownerOwnerId]);

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

  // Handle adding a new user to the Users table
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
      await queryClient.invalidateQueries({ queryKey: ['users-for-mentions', spaceId] });
      await queryClient.invalidateQueries({ queryKey: ['space-users', spaceId] });
      
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
    
    const confirmed = confirm(t(`Удалить пользователя "${userName}" из таблицы?`, `Delete user "${userName}" from the table?`));
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
      await queryClient.invalidateQueries({ queryKey: ['users-for-mentions', spaceId] });
      await queryClient.invalidateQueries({ queryKey: ['space-users', spaceId] });
      
      // Close edit panel if this user was being edited
      if (editingUserRowId === rowId) {
        setEditingUserRowId(null);
      }
    } catch (error) {
      logger.error('Failed to delete user from table:', error);
      alert(t('Ошибка при удалении пользователя', 'Failed to delete user'));
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

  // Handle updating user's role in the Users table
  const [updatingRoleRowId, setUpdatingRoleRowId] = useState<string | null>(null);
  
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
      alert(t('Ошибка при обновлении роли пользователя', 'Failed to update user role'));
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
    ).map(level => ({ ...level, label: translate(`userAccess.roles.${level.value}`) }));
  };

  const filteredUsers = usersTableRows.filter(user => {
    const query = userSearchQuery.trim().toLowerCase();
    return !query || user.name.toLowerCase().includes(query)
      || user.email?.toLowerCase().includes(query) || user.system_user_id?.toString().includes(query);
  });

  // Show loading state while loading settings
  if (isLoadingSettings) {
    return (
      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
          <Shield className="w-5 h-5 animate-pulse" />
          <span className="text-sm">{t('Загрузка настроек доступа...', 'Loading access settings...')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Enable toggle */}
      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[var(--accent-primary)]" />
            <h4 className="text-sm font-medium text-[var(--text-primary)]">
              {t('Управление доступом пользователей', 'User access management')}
            </h4>
            {isEnabling && (
              <span className="text-xs text-[var(--text-secondary)]">{t('(создание таблицы пользователей...)', '(creating users table...)')}</span>
            )}
          </div>
          <Switch
            aria-label={t('Управление доступом пользователей', 'User access management')}
            checked={enabled}
            onCheckedChange={handleEnableToggle}
            disabled={isEnabling}
          />
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          {t('Настройте индивидуальные права доступа для каждого пользователя', 'Configure individual access permissions for each user')}
        </p>
      </div>

      {enabled && (
        <div className="space-y-3">
          {/* Tabs navigation */}
          <div className="flex gap-1 p-1 bg-[var(--bg-tertiary)] rounded-lg">
            {ACCESS_PANEL_TABS.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-all
                  ${activeTab === tab.id 
                    ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'}
                `}
              >
                {tab.icon}
                <span>{translate(`userAccess.tabs.${tab.id}`)}</span>
              </button>
            ))}
          </div>

          {/* TAB: Access - God badge, hierarchy, users table, role column, mappings */}
          {activeTab === 'access' && (
            <div className="space-y-4">
              <AccessContextPanel
                ownerOwnerUser={ownerOwnerUser}
                entityType={entityType}
                spaceName={spaceName}
                projectName={projectName}
                tableName={tableName}
                columnName={columnName}
                onNavigateToSpace={onNavigateToSpace}
                onNavigateToProject={onNavigateToProject}
                onNavigateToTable={onNavigateToTable}
              />
              {/* Users table and Role column - combined in one row */}
              <TableAndRoleSelectors
                isLoadingTables={isLoadingTables}
                tablesByProject={tablesByProject}
                selectedTableId={selectedTableId}
                setSelectedTableId={setSelectedTableId}
                defaultTableId={tablesData?.default_table_id}
                tableColumns={tableColumns}
                selectedRoleColumnId={selectedRoleColumnId}
                setSelectedRoleColumnId={setSelectedRoleColumnId}
              />

          {/* Role mappings */}
          {selectedRoleColumnId && (
            <RoleMappingsEditor
              roleMappings={roleMappings}
              setRoleMappings={setRoleMappings}
              customMappingValue={customMappingValue}
              setCustomMappingValue={setCustomMappingValue}
              customMappingLevel={customMappingLevel}
              setCustomMappingLevel={setCustomMappingLevel}
              availableLevels={getAvailableLevels()}
            />
          )}
            </div>
          )}

          {/* TAB: Users - список пользователей с их доступами */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              {!selectedTableId ? (
                <div className="text-center py-6 text-[var(--text-secondary)]">
                  <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{t('Таблица пользователей не выбрана', 'No users table selected')}</p>
                  <p className="text-xs">{t('Перейдите на вкладку Доступ для выбора таблицы', 'Go to the Access tab to select a table')}</p>
                </div>
              ) : isUsersTableError ? (
                <div role="alert" className="py-6 text-sm text-[var(--text-secondary)]">
                  {t('Не удалось загрузить пользователей', 'Unable to load users')}
                  <button type="button" onClick={() => void refetchUsersTable()} className="ml-3 underline">
                    {t('Повторить', 'Retry')}
                  </button>
                </div>
              ) : isLoadingUsersTable ? (
                <div className="text-center py-6 text-[var(--text-secondary)]">
                  <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin opacity-50" />
                  <p className="text-sm">{t('Загрузка пользователей...', 'Loading users...')}</p>
                </div>
              ) : (
                <>
                  {!showAddUser ? (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setShowAddUser(true)}>
                      <UserPlus className="w-4 h-4 mr-2" />{t('Добавить', 'Add')}
                    </Button>
                  ) : (
                    <AddUsersPanel
                      systemUsers={systemUsers}
                      isLoading={isLoadingSystemUsers}
                      isError={isSystemUsersError}
                      onRetry={() => void refetchSystemUsers()}
                      usersTableRows={usersTableRows}
                      selectedUsersToAdd={selectedUsersToAdd}
                      selectedLevel={selectedLevel}
                      setSelectedLevel={setSelectedLevel}
                      addUserSearchQuery={addUserSearchQuery}
                      setAddUserSearchQuery={setAddUserSearchQuery}
                      availableLevels={getAvailableLevels()}
                      isAddingUser={isAddingUser}
                      onToggleUser={toggleUserSelection}
                      onUpdateSelectedLevel={updateSelectedUserLevel}
                      onRemoveSelected={removeUserFromSelection}
                      onConfirm={handleAddUsersToTable}
                      onCancel={() => {
                        setShowAddUser(false);
                        setSelectedUsersToAdd([]);
                        setAddUserSearchQuery('');
                      }}
                    />
                  )}

                  {/* Search users */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
                    <input
                      type="text"
                      value={userSearchQuery}
                      onChange={(e) => setUserSearchQuery(e.target.value)}
                      aria-label={t('Поиск по имени, email или ID...', 'Search by name, email or ID...')}
                      placeholder={t('Поиск по имени, email или ID...', 'Search by name, email or ID...')}
                      className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
                    />
                  </div>

                  {filteredUsers.length === 0 ? (
                    <p className="py-6 text-center text-sm text-[var(--text-secondary)]">
                      {userSearchQuery.trim()
                        ? t('Пользователи не найдены', 'No matching users')
                        : t('Нет пользователей в таблице', 'No users in the table')}
                    </p>
                  ) : (
                    <ul aria-label={translate('userAccess.tabs.users')} className="divide-y divide-[var(--border-secondary)]">
                      {filteredUsers.slice(0, visibleUserCount).map(user => (
                        <li key={user.row_id}>
                          <UserCard
                            user={user}
                            entityType={entityType}
                            entityId={entityId}
                            spaceId={spaceId}
                            projectId={projectId}
                            isExpanded={editingUserRowId === user.row_id}
                            onToggleExpanded={(rowId) =>
                              setEditingUserRowId(editingUserRowId === rowId ? null : rowId)
                            }
                            availableLevels={getAvailableLevels()}
                            updatingRoleRowId={updatingRoleRowId}
                            onUpdateUserRole={handleUpdateUserRole}
                            isDeletingUser={isDeletingUser}
                            onDeleteUserFromTable={handleDeleteUserFromTable}
                            onUpdateGranularAccess={handleUpdateGranularAccess}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                  {visibleUserCount < filteredUsers.length && (
                    <Button type="button" variant="secondary" size="sm" onClick={() => setVisibleUserCount(count => count + 50)}>
                      {t('Загрузить ещё 50', 'Load 50 more')}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
};

export default UserAccessPanel;
