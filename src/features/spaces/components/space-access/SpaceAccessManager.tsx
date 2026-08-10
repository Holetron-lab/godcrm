/**
 * SpaceAccessManager - ADR-105 AC6
 * Comprehensive per-user role assignment at space/project/table/view levels.
 *
 * Shows a table of all users with access to the space with columns:
 *   User (avatar + name) | Email | Role (dropdown) | Level | Inheritance | Actions
 *
 * Supports:
 *  - Direct role changes via dropdown
 *  - Inherited role display with badge
 *  - Adding users with search
 *  - Invitation flow link
 *  - Effective role calculation across hierarchy
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { showToast } from '@/shared/hooks/useToast';
import {
  UserPlus,
  Shield,
  Search,
  Loader2,
  Database,
  Info,
  Users
} from 'lucide-react';
import type { UserAccessLevel } from '@/shared/types/user-access.types';
import {
  ACCESS_LEVEL_VALUES,
  canManageAccess
} from '@/shared/types/user-access.types';
import type { SpaceAccessManagerProps, SystemUser, SpaceUserRow, TableColumn } from './types';
import { SELECTABLE_ACCESS_LEVELS } from './constants';
import { AddUserPanel } from './AddUserPanel';
import { UserRow } from './UserRow';

export const SpaceAccessManager = ({ spaceId, currentUserLevel }: SpaceAccessManagerProps) => {
  const queryClient = useQueryClient();

  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddUser, setShowAddUser] = useState(false);
  const [addUserSearch, setAddUserSearch] = useState('');
  const [selectedUsersToAdd, setSelectedUsersToAdd] = useState<Array<{ userId: number; level: UserAccessLevel }>>([]);
  const [defaultAddLevel, setDefaultAddLevel] = useState<UserAccessLevel>('viewer');
  const [isAddingUsers, setIsAddingUsers] = useState(false);
  const [updatingRoleRowId, setUpdatingRoleRowId] = useState<string | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  // ─── Queries ──────────────────────────────────────────────────

  /** Load access settings (includes users_table_id) */
  const { data: accessSettings, isLoading: isLoadingSettings } = useQuery({
    queryKey: ['access-settings', spaceId],
    queryFn: async () => {
      const response = await apiClient.request<{
        data: {
          access_control: {
            enabled: boolean;
            users_table_id: number | null;
            role_column_id: string | null;
            role_mappings: Array<{ columnValue: string; accessLevel: UserAccessLevel }>;
          };
          owner_id: number;
        }
      }>(`/access/space/${spaceId}/settings`);
      return response.data;
    },
    enabled: !!spaceId
  });

  const usersTableId = accessSettings?.access_control?.users_table_id ?? null;
  const isEnabled = accessSettings?.access_control?.enabled ?? false;

  /** Load system users for the add-user dropdown */
  const { data: systemUsersData } = useQuery({
    queryKey: ['system-users-all'],
    queryFn: async () => {
      const response = await apiClient.request<{ data: SystemUser[] }>('/users');
      return Array.isArray(response.data) ? response.data : [];
    },
    enabled: showAddUser
  });
  const systemUsers: SystemUser[] = Array.isArray(systemUsersData) ? systemUsersData : [];

  /** Load rows from the users table */
  const {
    data: usersTableData,
    isLoading: isLoadingUsersTable,
    refetch: refetchUsersTable
  } = useQuery({
    queryKey: ['users-table-rows', usersTableId],
    queryFn: async () => {
      if (!usersTableId) return { rows: [] as SpaceUserRow[], columnMap: {} as Record<string, string> };

      const rowsResponse = await apiClient.request<{
        data: { rows: Array<{ id: string; base_id: string; data: Record<string, unknown> }>; pagination: unknown }
      }>(`/tables/${usersTableId}/rows`);

      const columnsResponse = await apiClient.request<{ data: TableColumn[] }>(
        `/tables/${usersTableId}/columns`
      );

      const rowsData = rowsResponse.data;
      const rows = Array.isArray(rowsData?.rows) ? rowsData.rows : (Array.isArray(rowsData) ? rowsData : []);
      const columns = Array.isArray(columnsResponse.data) ? columnsResponse.data : [];

      // Build column name -> column ID map
      const columnMap: Record<string, string> = {};
      columns.forEach(col => {
        const colName = (col as unknown as Record<string, unknown>).column_name as string || col.name;
        if (colName) columnMap[colName] = col.id;
      });

      // Parse rows
      const userRows: SpaceUserRow[] = rows.map(row => {
        const data = row.data || {};
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
          // Granular access
          space_owner: getArrayValue('space_owner'),
          space_admin: getArrayValue('space_admin'),
          space_editor: getArrayValue('space_editor'),
          space_viewer: getArrayValue('space_viewer'),
          space_denied: getArrayValue('space_denied'),
          project_owner: getArrayValue('project_owner'),
          project_admin: getArrayValue('project_admin'),
          project_editor: getArrayValue('project_editor'),
          project_viewer: getArrayValue('project_viewer'),
          project_denied: getArrayValue('project_denied'),
          table_owner: getArrayValue('table_owner'),
          table_admin: getArrayValue('table_admin'),
          table_editor: getArrayValue('table_editor'),
          table_viewer: getArrayValue('table_viewer'),
          table_denied: getArrayValue('table_denied'),
          column_owner: getArrayValue('column_owner'),
          column_admin: getArrayValue('column_admin'),
          column_editor: getArrayValue('column_editor'),
          column_viewer: getArrayValue('column_viewer'),
          column_denied: getArrayValue('column_denied'),
        };
      });

      return { rows: userRows, columnMap };
    },
    enabled: !!usersTableId && isEnabled
  });

  const usersRows = usersTableData?.rows ?? [];
  const columnMap = usersTableData?.columnMap ?? {};

  // ─── Derived Data ─────────────────────────────────────────────

  const filteredUsers = useMemo(() => {
    if (!searchQuery) return usersRows;
    const q = searchQuery.toLowerCase();
    return usersRows.filter(u =>
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.system_user_id?.toString().includes(q)
    );
  }, [usersRows, searchQuery]);

  const getAvailableLevels = useCallback((): { value: UserAccessLevel; label: string }[] => {
    return SELECTABLE_ACCESS_LEVELS.filter(level =>
      ACCESS_LEVEL_VALUES[currentUserLevel] > ACCESS_LEVEL_VALUES[level.value]
    );
  }, [currentUserLevel]);

  // ─── Mutations / Handlers ─────────────────────────────────────

  /** Update a user's space-level role */
  const handleUpdateRole = async (rowId: string, newRole: UserAccessLevel) => {
    if (!usersTableId) return;
    setUpdatingRoleRowId(rowId);
    try {
      const roleCol = Object.entries(columnMap).find(([name]) => name === 'role');
      if (!roleCol) {
        logger.error('[SpaceAccessManager] Role column not found');
        return;
      }
      await apiClient.request(`/tables/${usersTableId}/rows/${rowId}`, {
        method: 'PUT',
        body: JSON.stringify({ data: { [roleCol[1]]: newRole } })
      });
      await refetchUsersTable();
      showToast('Роль обновлена', 'success');
    } catch (error) {
      logger.error('Failed to update role:', error);
      showToast('Ошибка при обновлении роли', 'error');
    } finally {
      setUpdatingRoleRowId(null);
    }
  };

  /** Delete a user from the users table */
  const handleDeleteUser = async (rowId: string, userName: string) => {
    if (!usersTableId) return;
    const confirmed = confirm(`Удалить пользователя "${userName}" из таблицы доступов?`);
    if (!confirmed) return;

    setIsDeletingUser(rowId);
    try {
      await apiClient.request(`/tables/${usersTableId}/rows/${rowId}`, { method: 'DELETE' });
      await refetchUsersTable();
      if (expandedUserId === rowId) setExpandedUserId(null);
      showToast(`Пользователь ${userName} удалён`, 'success');
    } catch (error) {
      logger.error('Failed to delete user:', error);
      showToast('Ошибка при удалении', 'error');
    } finally {
      setIsDeletingUser(null);
    }
  };

  /** Add selected users to the users table */
  const handleAddUsers = async () => {
    if (selectedUsersToAdd.length === 0 || !usersTableId) return;

    // Guard: columnMap must be loaded before adding users
    if (Object.keys(columnMap).length === 0) {
      showToast('Таблица пользователей ещё загружается. Попробуйте снова.', 'error');
      logger.error('[SpaceAccessManager] handleAddUsers: columnMap is empty — table columns not loaded yet');
      return;
    }

    setIsAddingUsers(true);
    let addedCount = 0;
    try {
      for (const { userId, level } of selectedUsersToAdd) {
        const user = systemUsers.find(u => u.id === userId);
        if (!user) {
          logger.warn('[SpaceAccessManager] handleAddUsers: user not found in systemUsers', { userId });
          continue;
        }

        const rowData: Record<string, unknown> = {};
        const setCol = (name: string, value: unknown) => {
          const col = Object.entries(columnMap).find(([n]) => n === name);
          if (col) rowData[col[1]] = value;
        };

        setCol('system_user_id', user.id);
        setCol('email', user.email);
        setCol('name', user.name);
        setCol('role', level);
        setCol('active', true);

        // Initialize granular access columns to empty arrays
        const accessColumns = [
          'space_owner', 'space_admin', 'space_editor', 'space_viewer', 'space_denied',
          'project_owner', 'project_admin', 'project_editor', 'project_viewer', 'project_denied',
          'table_owner', 'table_admin', 'table_editor', 'table_viewer', 'table_denied',
          'column_owner', 'column_admin', 'column_editor', 'column_viewer', 'column_denied'
        ];
        for (const colName of accessColumns) {
          setCol(colName, []);
        }

        // Validate rowData has required fields before sending
        if (Object.keys(rowData).length === 0) {
          logger.error('[SpaceAccessManager] handleAddUsers: rowData is empty after setCol — columnMap mismatch', { columnMap, userId });
          continue;
        }

        await apiClient.request(`/tables/${usersTableId}/rows`, {
          method: 'POST',
          body: JSON.stringify({ data: rowData })
        });
        addedCount++;
      }

      await refetchUsersTable();
      setShowAddUser(false);
      setSelectedUsersToAdd([]);
      setAddUserSearch('');
      if (addedCount > 0) {
        showToast(`${addedCount} пользователь(ей) добавлено`, 'success');
      } else {
        showToast('Не удалось добавить пользователей — проверьте данные', 'error');
      }
    } catch (error) {
      logger.error('Failed to add users:', error);
      showToast('Ошибка при добавлении', 'error');
    } finally {
      setIsAddingUsers(false);
    }
  };

  const toggleUserSelection = (userId: number) => {
    setSelectedUsersToAdd(prev => {
      const existing = prev.find(u => u.userId === userId);
      if (existing) return prev.filter(u => u.userId !== userId);
      return [...prev, { userId, level: defaultAddLevel }];
    });
  };

  const updateSelectedUserLevel = (userId: number, level: UserAccessLevel) => {
    setSelectedUsersToAdd(prev =>
      prev.map(u => u.userId === userId ? { ...u, level } : u)
    );
  };

  const canManage = (targetLevel: UserAccessLevel): boolean => {
    return canManageAccess(currentUserLevel, targetLevel);
  };

  // ─── Render: Loading / Disabled ───────────────────────────────

  if (isLoadingSettings) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-primary)]" />
      </div>
    );
  }

  if (!isEnabled) {
    return (
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 text-center">
        <Shield className="w-10 h-10 mx-auto mb-3 text-[var(--text-tertiary)] opacity-50" />
        <h4 className="text-sm font-medium text-[var(--text-primary)] mb-1">
          Управление доступом отключено
        </h4>
        <p className="text-xs text-[var(--text-tertiary)]">
          Включите управление доступом на вкладке "Доступ" для настройки прав пользователей.
        </p>
      </div>
    );
  }

  if (!usersTableId) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-center">
        <Database className="w-10 h-10 mx-auto mb-3 text-amber-400 opacity-70" />
        <h4 className="text-sm font-medium text-[var(--text-primary)] mb-1">
          Таблица пользователей не настроена
        </h4>
        <p className="text-xs text-[var(--text-tertiary)]">
          Выберите таблицу пользователей на вкладке "Доступ" в настройках доступа.
        </p>
      </div>
    );
  }

  // ─── Render: Main ─────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-[var(--accent-primary)]" />
          <h4 className="text-sm font-medium text-[var(--text-primary)]">
            Управление доступом
          </h4>
          <span className="px-2 py-0.5 text-xs rounded-full bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
            {usersRows.length} пользователей
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddUser(!showAddUser)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary)]/90 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Добавить
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Поиск по имени, email или ID..."
          className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--accent-primary)]"
        />
      </div>

      {/* Add User Panel */}
      {showAddUser && (
        <AddUserPanel
          systemUsers={systemUsers}
          existingUserIds={usersRows.map(r => r.system_user_id).filter((id): id is number => id !== null)}
          selectedUsers={selectedUsersToAdd}
          defaultLevel={defaultAddLevel}
          availableLevels={getAvailableLevels()}
          searchQuery={addUserSearch}
          onSearchChange={setAddUserSearch}
          onToggleUser={toggleUserSelection}
          onUpdateLevel={updateSelectedUserLevel}
          onDefaultLevelChange={setDefaultAddLevel}
          onSubmit={handleAddUsers}
          onCancel={() => {
            setShowAddUser(false);
            setSelectedUsersToAdd([]);
            setAddUserSearch('');
          }}
          isSubmitting={isAddingUsers}
        />
      )}

      {/* Users Table */}
      {isLoadingUsersTable ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-primary)]" />
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-8 text-center">
          <Users className="w-8 h-8 mx-auto mb-2 text-[var(--text-tertiary)] opacity-50" />
          <p className="text-sm text-[var(--text-tertiary)]">
            {searchQuery ? 'Пользователи не найдены' : 'Нет пользователей'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border-primary)] overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_1.2fr_auto_auto_auto] gap-2 px-4 py-2.5 bg-[var(--bg-tertiary)] border-b border-[var(--border-primary)] text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
            <div>Пользователь</div>
            <div>Email</div>
            <div className="text-center w-28">Роль</div>
            <div className="text-center w-24">Уровень</div>
            <div className="text-center w-20">Действия</div>
          </div>

          {/* Table body */}
          <div className="divide-y divide-[var(--border-secondary)]">
            {filteredUsers.map(user => (
              <UserRow
                key={user.row_id}
                user={user}
                isExpanded={expandedUserId === user.row_id}
                isManageable={canManage(user.role as UserAccessLevel)}
                updatingRoleRowId={updatingRoleRowId}
                isDeletingUser={isDeletingUser}
                availableLevels={getAvailableLevels()}
                onToggleExpand={(rowId) => setExpandedUserId(expandedUserId === rowId ? null : rowId)}
                onUpdateRole={handleUpdateRole}
                onDeleteUser={handleDeleteUser}
              />
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-start gap-3 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-xs text-[var(--text-tertiary)]">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-[var(--accent-primary)]" />
        <div className="space-y-1">
          <p className="font-medium text-[var(--text-secondary)]">Уровни доступа (ADR-105)</p>
          <p>
            <span className="font-medium text-blue-400">Space</span> - базовый уровень, задаётся через роль.{' '}
            <span className="font-medium text-purple-400">Project</span>,{' '}
            <span className="font-medium text-emerald-400">Table</span>,{' '}
            <span className="font-medium text-amber-400">Column</span> - гранулярные переопределения через колонки таблицы.
          </p>
          <p>Наследование: Column {'<-'} Table {'<-'} Project {'<-'} Space. Более конкретный уровень имеет приоритет.</p>
        </div>
      </div>
    </div>
  );
};

export default SpaceAccessManager;
