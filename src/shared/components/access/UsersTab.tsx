/**
 * UsersTab - "Пользователи" tab content for UserAccessPanel
 * Contains: User search, add user form, user list with granular access editing
 */

import React from 'react';
import {
  UserPlus,
  Trash2,
  ChevronDown,
  Settings,
  Ban,
  Info,
  Database,
  Users,
  Search,
  Check,
  X,
  Loader2,
} from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { UserAccessLevel, PermissionEntityType } from '@/shared/types/user-access.types';
import {
  ACCESS_LEVEL_LABELS,
  ACCESS_LEVEL_COLORS,
} from '@/shared/types/user-access.types';
import type { User, UserTableRow } from './types';
import { ENTITY_LEVEL_LABELS, ENTITY_LEVEL_ICONS } from './types';
import { computeEffectiveRoles } from './utils';
import { PermissionLevelBadge, InheritanceBadge } from './AccessBadges';

interface UsersTabProps {
  entityType: PermissionEntityType;
  entityId: number;
  spaceId: number;
  projectId?: number;
  // State
  selectedTableId: number | null;
  isLoadingUsersTable: boolean;
  userSearchQuery: string;
  setUserSearchQuery: (q: string) => void;
  showAddUser: boolean;
  setShowAddUser: (show: boolean) => void;
  selectedUsersToAdd: Array<{ userId: number; level: UserAccessLevel }>;
  setSelectedUsersToAdd: (users: Array<{ userId: number; level: UserAccessLevel }>) => void;
  selectedLevel: UserAccessLevel;
  setSelectedLevel: (level: UserAccessLevel) => void;
  addUserSearchQuery: string;
  setAddUserSearchQuery: (q: string) => void;
  editingUserRowId: string | null;
  setEditingUserRowId: (id: string | null) => void;
  isAddingUser: boolean;
  isDeletingUser: string | null;
  updatingRoleRowId: string | null;
  // Data
  systemUsers: User[];
  usersTableRows: UserTableRow[];
  usersColumnMap: Record<string, string>;
  // Actions
  handleAddUsersToTable: () => Promise<void>;
  toggleUserSelection: (userId: number) => void;
  updateSelectedUserLevel: (userId: number, level: UserAccessLevel) => void;
  removeUserFromSelection: (userId: number) => void;
  handleDeleteUserFromTable: (rowId: string, userName: string) => Promise<void>;
  handleUpdateUserRole: (rowId: string, newRole: UserAccessLevel) => Promise<void>;
  handleUpdateGranularAccess: (
    rowId: string,
    entityLevel: 'project' | 'table' | 'column',
    accessLevel: UserAccessLevel,
    entityIds: string[]
  ) => Promise<void>;
  getAvailableLevels: () => { value: UserAccessLevel; label: string }[];
}

export const UsersTab = ({
  entityType,
  entityId,
  spaceId,
  projectId,
  selectedTableId,
  isLoadingUsersTable,
  userSearchQuery,
  setUserSearchQuery,
  showAddUser,
  setShowAddUser,
  selectedUsersToAdd,
  setSelectedUsersToAdd,
  selectedLevel,
  setSelectedLevel,
  addUserSearchQuery,
  setAddUserSearchQuery,
  editingUserRowId,
  setEditingUserRowId,
  isAddingUser,
  isDeletingUser,
  updatingRoleRowId,
  systemUsers,
  usersTableRows,
  usersColumnMap,
  handleAddUsersToTable,
  toggleUserSelection,
  updateSelectedUserLevel,
  removeUserFromSelection,
  handleDeleteUserFromTable,
  handleUpdateUserRole,
  handleUpdateGranularAccess,
  getAvailableLevels,
}: UsersTabProps) => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);

  if (!selectedTableId) {
    return (
      <div className="text-center py-6 text-[var(--text-tertiary)]">
        <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">{t('Таблица пользователей не выбрана', 'No users table selected')}</p>
        <p className="text-xs">{t('Перейдите на вкладку Доступ для выбора таблицы', 'Go to the Access tab to select a table')}</p>
      </div>
    );
  }

  if (isLoadingUsersTable) {
    return (
      <div className="text-center py-6 text-[var(--text-tertiary)]">
        <Loader2 className="w-8 h-8 mx-auto mb-2 animate-spin opacity-50" />
        <p className="text-sm">{t('Загрузка пользователей...', 'Loading users...')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search users */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
        <input
          type="text"
          value={userSearchQuery}
          onChange={(e) => setUserSearchQuery(e.target.value)}
          placeholder={t('Поиск по имени, email или ID...', 'Search by name, email or ID...')}
          className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
        />
      </div>

      {/* Users list from table - grid 2 columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {/* Add user card - first in grid */}
        {!showAddUser ? (
          <button
            type="button"
            onClick={() => setShowAddUser(true)}
            className="h-full min-h-[80px] rounded-lg border-2 border-dashed border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/5 transition-colors flex flex-col items-center justify-center gap-2"
          >
            <UserPlus className="w-6 h-6" />
            <span className="text-sm">{t('Добавить', 'Add')}</span>
          </button>
        ) : (
          <React.Fragment>
            {/* Collapsed placeholder when adding */}
            <div className="h-full min-h-[80px] rounded-lg border-2 border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 flex flex-col items-center justify-center gap-2">
              <UserPlus className="w-6 h-6 text-[var(--accent-primary)]" />
              <span className="text-sm text-[var(--accent-primary)]">{t('Добавление...', 'Adding...')}</span>
            </div>

            {/* Expanded add section - full width */}
            <div className="col-span-full p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--accent-primary)] space-y-4">
              <div className="flex items-center justify-between">
                <h5 className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-[var(--accent-primary)]" />
                  {t('Добавить пользователей', 'Add users')}
                  {selectedUsersToAdd.length > 0 && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-[var(--accent-primary)] text-white">
                      {selectedUsersToAdd.length}
                    </span>
                  )}
                </h5>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddUser(false);
                    setSelectedUsersToAdd([]);
                    setAddUserSearchQuery('');
                  }}
                  className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Default role for new selections */}
              <div className="flex items-center gap-2 text-sm">
                <span className="text-[var(--text-tertiary)]">{t('Роль по умолчанию:', 'Default role:')}</span>
                <select
                  value={selectedLevel}
                  onChange={(e) => setSelectedLevel(e.target.value as UserAccessLevel)}
                  className="px-2 py-1 text-sm rounded border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
                >
                  {getAvailableLevels().map(level => (
                    <option key={level.value} value={level.value}>{level.label}</option>
                  ))}
                </select>
              </div>

              {/* Selected users list */}
              {selectedUsersToAdd.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs text-[var(--text-tertiary)] font-medium">{t('Выбранные пользователи:', 'Selected users:')}</div>
                  <div className="flex flex-wrap gap-2">
                    {selectedUsersToAdd.map(({ userId, level }) => {
                      const user = systemUsers.find(u => u.id === userId);
                      if (!user) return null;
                      const roleColor = ACCESS_LEVEL_COLORS[level] || '#6b7280';
                      return (
                        <div
                          key={userId}
                          className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg border bg-[var(--bg-primary)]"
                          style={{ borderColor: `${roleColor}50` }}
                        >
                          <div
                            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0"
                            style={{ backgroundColor: roleColor }}
                          >
                            {String(user.name || '?').charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm text-[var(--text-primary)]">{user.name}</span>
                          <select
                            value={level}
                            onChange={(e) => updateSelectedUserLevel(userId, e.target.value as UserAccessLevel)}
                            className="px-1 py-0.5 text-xs rounded border-0 bg-transparent focus:outline-none cursor-pointer"
                            style={{ color: roleColor }}
                          >
                            {getAvailableLevels().map(l => (
                              <option key={l.value} value={l.value}>{l.label}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => removeUserFromSelection(userId)}
                            className="p-0.5 text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Search input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
                <input
                  type="text"
                  value={addUserSearchQuery}
                  onChange={(e) => setAddUserSearchQuery(e.target.value)}
                  placeholder={t('Поиск по имени, email или ID...', 'Search by name, email or ID...')}
                  className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
                />
              </div>

              {/* Available users list - click to add/remove from selection */}
              <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] divide-y divide-[var(--border-secondary)]">
                {systemUsers
                  .filter(u => {
                    // Exclude users already in the table
                    const alreadyAdded = usersTableRows.some(row => row.system_user_id === u.id);
                    if (alreadyAdded) return false;

                    if (!addUserSearchQuery) return true;
                    const q = addUserSearchQuery.toLowerCase();
                    return (
                      u.email?.toLowerCase().includes(q) ||
                      u.name?.toLowerCase().includes(q) ||
                      u.id.toString().includes(q)
                    );
                  })
                  .slice(0, 15)
                  .map(u => {
                    const isSelected = selectedUsersToAdd.some(s => s.userId === u.id);
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => toggleUserSelection(u.id)}
                        className={`w-full px-3 py-2.5 text-left hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-3 ${isSelected ? 'bg-[var(--accent-primary)]/10' : ''}`}
                      >
                        {/* Checkbox */}
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${isSelected ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)]' : 'border-[var(--border-primary)]'}`}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        {/* Mini avatar */}
                        <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-xs font-medium text-[var(--text-secondary)] shrink-0">
                          {String(u.name || '?').charAt(0).toUpperCase()}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium truncate ${isSelected ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'}`}>
                            {u.name}
                          </div>
                          <div className="text-xs text-[var(--text-tertiary)] truncate">
                            (ID: {u.id}) {u.email}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                {systemUsers.filter(u => !usersTableRows.some(row => row.system_user_id === u.id)).length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-[var(--text-tertiary)]">
                    <Users className="w-6 h-6 mx-auto mb-2 opacity-50" />
                    {t('Все системные пользователи уже добавлены', 'All system users are already added')}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-secondary)]">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowAddUser(false);
                    setSelectedUsersToAdd([]);
                    setAddUserSearchQuery('');
                  }}
                  disabled={isAddingUser}
                >
                  {t('Отмена', 'Cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAddUsersToTable}
                  disabled={selectedUsersToAdd.length === 0 || isAddingUser}
                >
                  {isAddingUser ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-1" />
                      {t('Добавление...', 'Adding...')}
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-4 h-4 mr-1" />
                      {t('Добавить', 'Add')} ({selectedUsersToAdd.length})
                    </>
                  )}
                </Button>
              </div>
            </div>
          </React.Fragment>
        )}

        {usersTableRows.length === 0 && !showAddUser ? (
          <div className="text-center py-6 text-[var(--text-tertiary)]">
            <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t('Нет пользователей в таблице', 'No users in the table')}</p>
            <p className="text-xs">{t('Нажмите + чтобы добавить', 'Click + to add')}</p>
          </div>
        ) : (
          usersTableRows
            .filter(user => {
              if (!userSearchQuery) return true;
              const q = userSearchQuery.toLowerCase();
              return (
                user.name?.toLowerCase().includes(q) ||
                user.email?.toLowerCase().includes(q) ||
                user.system_user_id?.toString().includes(q)
              );
            })
            .map(user => {
              const roleColor = ACCESS_LEVEL_COLORS[user.role as UserAccessLevel] || '#6b7280';
              const isExpanded = editingUserRowId === user.row_id;

              // Count granular access entries
              const projectCount = (user.project_owner?.length || 0) + (user.project_admin?.length || 0) +
                (user.project_editor?.length || 0) + (user.project_viewer?.length || 0);
              const tableCount = (user.table_owner?.length || 0) + (user.table_admin?.length || 0) +
                (user.table_editor?.length || 0) + (user.table_viewer?.length || 0);
              const columnCount = (user.column_owner?.length || 0) + (user.column_admin?.length || 0) +
                (user.column_editor?.length || 0) + (user.column_viewer?.length || 0);
              const deniedCount = (user.project_denied?.length || 0) + (user.table_denied?.length || 0) +
                (user.column_denied?.length || 0);

              // Compute effective roles at current entity level
              const effectiveRoles = computeEffectiveRoles(
                user, entityType, entityId, spaceId, projectId
              );
              // The most specific (direct) role takes precedence; fallback to inherited
              const directRole = effectiveRoles.find(r => r.isDirect);
              const inheritedRole = effectiveRoles.find(r => !r.isDirect);
              const effectiveRole = directRole || inheritedRole;

              return (
                <React.Fragment key={user.row_id}>
                <div
                  className={`p-3 rounded-lg bg-[var(--bg-secondary)] border ${isExpanded ? 'border-[var(--accent-primary)]' : 'border-[var(--border-primary)]'}`}
                >
                  {/* User header */}
                  <div className="flex items-center gap-3 mb-2">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0"
                      style={{ backgroundColor: roleColor }}
                    >
                      {String(user.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {user.name}
                        </span>
                        {/* Role selector */}
                        <div className="relative">
                          <select
                            value={user.role || 'viewer'}
                            onChange={(e) => handleUpdateUserRole(user.row_id, e.target.value as UserAccessLevel)}
                            disabled={updatingRoleRowId === user.row_id}
                            className="appearance-none px-2 py-0.5 pr-6 text-xs rounded border-0 bg-transparent cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
                            style={{
                              backgroundColor: `${roleColor}20`,
                              color: roleColor
                            }}
                          >
                            {getAvailableLevels().map(level => (
                              <option key={level.value} value={level.value} style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                                {level.label}
                              </option>
                            ))}
                          </select>
                          {updatingRoleRowId === user.row_id ? (
                            <Loader2 className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin" style={{ color: roleColor }} />
                          ) : (
                            <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{ color: roleColor }} />
                          )}
                        </div>
                        {!user.active && (
                          <span className="px-1.5 py-0.5 text-xs rounded bg-red-500/20 text-red-400">
                            {t('Неактивен', 'Inactive')}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-[var(--text-tertiary)]">
                        {user.email} • ID: {user.system_user_id || 'N/A'}
                      </span>
                    </div>
                    {/* Action buttons */}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setEditingUserRowId(isExpanded ? null : user.row_id)}
                        className={`p-1.5 rounded-md transition-colors ${isExpanded ? 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/10' : 'text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:bg-[var(--bg-tertiary)]'}`}
                        title={t('Редактировать доступы', 'Edit permissions')}
                      >
                        <Settings className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteUserFromTable(user.row_id, user.name)}
                        disabled={isDeletingUser === user.row_id}
                        className="p-1.5 text-[var(--text-secondary)] hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-50"
                        title={t('Удалить пользователя', 'Delete user')}
                      >
                        {isDeletingUser === user.row_id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Level + Inheritance indicators (ADR-105 AC6) */}
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    {/* Permission level badge */}
                    <PermissionLevelBadge
                      level={effectiveRole?.source || entityType}
                      inherited={effectiveRole ? !effectiveRole.isDirect : false}
                    />
                    {/* Inherited vs Direct badge */}
                    <InheritanceBadge
                      inherited={effectiveRole ? !effectiveRole.isDirect : true}
                      inheritedFrom={inheritedRole?.source}
                    />
                    {/* If user has both direct and inherited roles, show effective role info */}
                    {directRole && inheritedRole && directRole.level !== inheritedRole.level && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
                        <Info className="w-2.5 h-2.5" />
                        {ACCESS_LEVEL_LABELS[inheritedRole.level]} @ {ENTITY_LEVEL_LABELS[inheritedRole.source]}
                        {' -> '}
                        {ACCESS_LEVEL_LABELS[directRole.level]} @ {ENTITY_LEVEL_LABELS[directRole.source]}
                      </span>
                    )}
                  </div>

                  {/* Granular access summary */}
                  <div className="flex flex-wrap gap-1 text-xs">
                    {projectCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">
                        {ENTITY_LEVEL_ICONS.project} {projectCount} {t('проектов', 'projects')}
                      </span>
                    )}
                    {tableCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-400">
                        {ENTITY_LEVEL_ICONS.table} {tableCount} {t('таблиц', 'tables')}
                      </span>
                    )}
                    {columnCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">
                        {ENTITY_LEVEL_ICONS.column} {columnCount} {t('колонок', 'columns')}
                      </span>
                    )}
                    {deniedCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">
                        <Ban className="w-3 h-3 inline" /> {deniedCount} {t('запрещено', 'denied')}
                      </span>
                    )}
                    {projectCount === 0 && tableCount === 0 && columnCount === 0 && deniedCount === 0 && (
                      <span className="text-[var(--text-tertiary)]">{t('Гранулярный доступ не настроен', 'Granular access not configured')}</span>
                    )}
                  </div>
                </div>

                  {/* Expanded edit section - full width outside the card */}
                  {isExpanded && (
                    <div className="col-span-full p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--accent-primary)]/30 space-y-3">
                      <h5 className="text-xs font-medium text-[var(--text-secondary)]">
                        {t('Гранулярный доступ для', 'Granular access for')} {user.name}
                      </h5>

                      {/* Current entity role selector - shown based on entityType */}
                      {entityType !== 'space' && (
                        <div className="p-3 rounded-lg bg-[var(--accent-primary)]/5 border border-[var(--accent-primary)]/20 space-y-3">
                          <h6 className="text-xs font-semibold text-[var(--accent-primary)]">
                            {entityType === 'project' && t(`📁 Роль в проекте (ID: ${entityId})`, `📁 Role in project (ID: ${entityId})`)}
                            {entityType === 'table' && t(`📋 Роль в таблице (ID: ${entityId})`, `📋 Role in table (ID: ${entityId})`)}
                            {entityType === 'column' && t(`📊 Роль в колонке (ID: ${entityId})`, `📊 Role in column (ID: ${entityId})`)}
                          </h6>

                          {/* Role selector for current entity */}
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-[var(--text-secondary)]">{t('Роль:', 'Role:')}</span>
                            <select
                              value={(() => {
                                // Find current role for this entity
                                const entityIdStr = String(entityId);
                                if (entityType === 'project') {
                                  if (user.project_owner?.includes(entityIdStr)) return 'owner';
                                  if (user.project_admin?.includes(entityIdStr)) return 'admin';
                                  if (user.project_editor?.includes(entityIdStr)) return 'editor';
                                  if (user.project_viewer?.includes(entityIdStr)) return 'viewer';
                                  if (user.project_denied?.includes(entityIdStr)) return 'denied';
                                } else if (entityType === 'table') {
                                  if (user.table_owner?.includes(entityIdStr)) return 'owner';
                                  if (user.table_admin?.includes(entityIdStr)) return 'admin';
                                  if (user.table_editor?.includes(entityIdStr)) return 'editor';
                                  if (user.table_viewer?.includes(entityIdStr)) return 'viewer';
                                  if (user.table_denied?.includes(entityIdStr)) return 'denied';
                                } else if (entityType === 'column') {
                                  if (user.column_owner?.includes(entityIdStr)) return 'owner';
                                  if (user.column_admin?.includes(entityIdStr)) return 'admin';
                                  if (user.column_editor?.includes(entityIdStr)) return 'editor';
                                  if (user.column_viewer?.includes(entityIdStr)) return 'viewer';
                                  if (user.column_denied?.includes(entityIdStr)) return 'denied';
                                }
                                return '';
                              })()}
                              onChange={async (e) => {
                                const newRole = e.target.value as UserAccessLevel | '';
                                const entityIdStr = String(entityId);
                                const entityLevel = entityType as 'project' | 'table' | 'column';

                                // Remove from all access arrays first
                                for (const level of ['owner', 'admin', 'editor', 'viewer', 'denied'] as UserAccessLevel[]) {
                                  const currentArray = user[`${entityLevel}_${level}` as keyof UserTableRow] as string[] || [];
                                  if (currentArray.includes(entityIdStr)) {
                                    await handleUpdateGranularAccess(
                                      user.row_id,
                                      entityLevel,
                                      level,
                                      currentArray.filter(id => id !== entityIdStr)
                                    );
                                  }
                                }

                                // Add to new access array if not empty
                                if (newRole) {
                                  const currentArray = user[`${entityLevel}_${newRole}` as keyof UserTableRow] as string[] || [];
                                  await handleUpdateGranularAccess(
                                    user.row_id,
                                    entityLevel,
                                    newRole,
                                    [...currentArray, entityIdStr]
                                  );
                                }
                              }}
                              className="px-3 py-1.5 text-sm rounded-md border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
                            >
                              <option value="">{t('— Наследуется —', '— Inherited —')}</option>
                              {getAvailableLevels().map(level => (
                                <option key={level.value} value={level.value}>{level.label}</option>
                              ))}
                            </select>
                            <span className="text-[10px] text-[var(--text-tertiary)]">
                              {t('(пустое = наследуется с верхнего уровня)', '(empty = inherited from parent level)')}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Space level - show only for space entityType */}
                      {entityType === 'space' && (
                        <>
                          {/* Project access grid */}
                          <div className="space-y-2">
                            <h6 className="text-xs font-medium text-purple-400">{t('📁 Проекты', '📁 Projects')}</h6>
                            <div className="grid grid-cols-5 gap-1 text-[10px]">
                              <div className="p-1 rounded bg-yellow-500/10 text-yellow-400">
                                <div className="font-medium">Owner</div>
                                <div className="text-[9px] break-all">{user.project_owner?.join(', ') || '—'}</div>
                              </div>
                              <div className="p-1 rounded bg-purple-500/10 text-purple-400">
                                <div className="font-medium">Admin</div>
                                <div className="text-[9px] break-all">{user.project_admin?.join(', ') || '—'}</div>
                              </div>
                              <div className="p-1 rounded bg-primary-500/10 text-primary-400">
                                <div className="font-medium">Editor</div>
                                <div className="text-[9px] break-all">{user.project_editor?.join(', ') || '—'}</div>
                              </div>
                              <div className="p-1 rounded bg-green-500/10 text-green-400">
                                <div className="font-medium">Viewer</div>
                                <div className="text-[9px] break-all">{user.project_viewer?.join(', ') || '—'}</div>
                              </div>
                              <div className="p-1 rounded bg-red-500/10 text-red-400">
                                <div className="font-medium">Denied</div>
                                <div className="text-[9px] break-all">{user.project_denied?.join(', ') || '—'}</div>
                              </div>
                            </div>
                          </div>

                          {/* Table access grid */}
                          <div className="space-y-2">
                            <h6 className="text-xs font-medium text-primary-400">{t('📋 Таблицы', '📋 Tables')}</h6>
                            <div className="grid grid-cols-5 gap-1 text-[10px]">
                              <div className="p-1 rounded bg-yellow-500/10 text-yellow-400">
                                <div className="font-medium">Owner</div>
                                <div className="text-[9px] break-all">{user.table_owner?.join(', ') || '—'}</div>
                              </div>
                              <div className="p-1 rounded bg-purple-500/10 text-purple-400">
                                <div className="font-medium">Admin</div>
                                <div className="text-[9px] break-all">{user.table_admin?.join(', ') || '—'}</div>
                              </div>
                              <div className="p-1 rounded bg-primary-500/10 text-primary-400">
                                <div className="font-medium">Editor</div>
                                <div className="text-[9px] break-all">{user.table_editor?.join(', ') || '—'}</div>
                              </div>
                              <div className="p-1 rounded bg-green-500/10 text-green-400">
                                <div className="font-medium">Viewer</div>
                                <div className="text-[9px] break-all">{user.table_viewer?.join(', ') || '—'}</div>
                              </div>
                              <div className="p-1 rounded bg-red-500/10 text-red-400">
                                <div className="font-medium">Denied</div>
                                <div className="text-[9px] break-all">{user.table_denied?.join(', ') || '—'}</div>
                              </div>
                            </div>
                          </div>

                          {/* Column access grid */}
                          <div className="space-y-2">
                            <h6 className="text-xs font-medium text-green-400">{t('📊 Колонки', '📊 Columns')}</h6>
                            <div className="grid grid-cols-5 gap-1 text-[10px]">
                              <div className="p-1 rounded bg-yellow-500/10 text-yellow-400">
                                <div className="font-medium">Owner</div>
                                <div className="text-[9px] break-all">{user.column_owner?.join(', ') || '—'}</div>
                              </div>
                              <div className="p-1 rounded bg-purple-500/10 text-purple-400">
                                <div className="font-medium">Admin</div>
                                <div className="text-[9px] break-all">{user.column_admin?.join(', ') || '—'}</div>
                              </div>
                              <div className="p-1 rounded bg-primary-500/10 text-primary-400">
                                <div className="font-medium">Editor</div>
                                <div className="text-[9px] break-all">{user.column_editor?.join(', ') || '—'}</div>
                              </div>
                              <div className="p-1 rounded bg-green-500/10 text-green-400">
                                <div className="font-medium">Viewer</div>
                                <div className="text-[9px] break-all">{user.column_viewer?.join(', ') || '—'}</div>
                              </div>
                              <div className="p-1 rounded bg-red-500/10 text-red-400">
                                <div className="font-medium">Denied</div>
                                <div className="text-[9px] break-all">{user.column_denied?.join(', ') || '—'}</div>
                              </div>
                            </div>
                          </div>
                        </>
                      )}

                      <p className="text-xs text-[var(--text-tertiary)]">
                        {t('💡 Редактируйте доступы напрямую в таблице Users', '💡 Edit permissions directly in the Users table')}
                      </p>
                    </div>
                  )}
                </React.Fragment>
              );
            })
        )}
      </div>
    </div>
  );
};
