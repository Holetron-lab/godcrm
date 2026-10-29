/**
 * UserCard - Individual user row card with header, badges, summary and
 * expanded granular-access editor. Extracted from UserAccessPanel.tsx.
 *
 * Owns no persistent state; parent passes handlers + loading flags.
 */

import React, { useId } from 'react';
import { Avatar } from '@/shared/components/ui/Avatar';
import {
  Trash2,
  ChevronDown,
  Ban,
  Info,
  Loader2,
} from 'lucide-react';
import type {
  UserAccessLevel,
  PermissionEntityType,
} from '@/shared/types/user-access.types';
import {
  ACCESS_LEVEL_COLORS,
} from '@/shared/types/user-access.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { UserTableRow } from './types';
import { ENTITY_LEVEL_ICONS } from './constants';
import { computeEffectiveRoles } from './helpers';
import { PermissionLevelBadge, InheritanceBadge } from './PermissionBadges';

interface UserCardProps {
  user: UserTableRow;
  entityType: PermissionEntityType;
  entityId: number;
  spaceId: number;
  projectId?: number;

  isExpanded: boolean;
  onToggleExpanded: (rowId: string) => void;

  availableLevels: { value: UserAccessLevel; label: string }[];

  updatingRoleRowId: string | null;
  onUpdateUserRole: (rowId: string, newRole: UserAccessLevel) => void;

  isDeletingUser: string | null;
  onDeleteUserFromTable: (rowId: string, userName: string) => void;

  onUpdateGranularAccess: (
    rowId: string,
    entityLevel: 'project' | 'table' | 'column',
    accessLevel: UserAccessLevel,
    entityIds: string[]
  ) => Promise<void>;
}

export const UserCard = ({
  user,
  entityType,
  entityId,
  spaceId,
  projectId,
  isExpanded,
  onToggleExpanded,
  availableLevels,
  updatingRoleRowId,
  onUpdateUserRole,
  isDeletingUser,
  onDeleteUserFromTable,
  onUpdateGranularAccess,
}: UserCardProps) => {
  const { language, t: translate } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const detailsId = useId();
  const roleColor = ACCESS_LEVEL_COLORS[user.role as UserAccessLevel] || '#6b7280';
  const isAgent = user.managed_by_agent_table_id != null || user.user_type === 'agent';
  const isService = user.user_type === 'service';
  const typeLabel = isAgent ? translate('aiChat.ui.agent') : isService ? translate('aiChat.ui.service') : translate('aiChat.ui.person');
  const avatarColor = user.color || (isAgent ? '#a855f7' : isService ? '#fb923c' : '#3b82f6');

  // Count granular access entries
  const projectCount =
    (user.project_owner?.length || 0) +
    (user.project_admin?.length || 0) +
    (user.project_editor?.length || 0) +
    (user.project_viewer?.length || 0);
  const tableCount =
    (user.table_owner?.length || 0) +
    (user.table_admin?.length || 0) +
    (user.table_editor?.length || 0) +
    (user.table_viewer?.length || 0);
  const columnCount =
    (user.column_owner?.length || 0) +
    (user.column_admin?.length || 0) +
    (user.column_editor?.length || 0) +
    (user.column_viewer?.length || 0);
  const deniedCount =
    (user.project_denied?.length || 0) +
    (user.table_denied?.length || 0) +
    (user.column_denied?.length || 0);

  // Compute effective roles at current entity level
  const effectiveRoles = computeEffectiveRoles(
    user,
    entityType,
    entityId,
    spaceId,
    projectId
  );
  // The most specific (direct) role takes precedence; fallback to inherited
  const directRole = effectiveRoles.find((r) => r.isDirect);
  const inheritedRole = effectiveRoles.find((r) => !r.isDirect);
  const effectiveRole = directRole || inheritedRole;

  return (
    <React.Fragment>
      <div
        style={{ boxShadow: user.color ? `inset 3px 0 0 ${user.color}` : undefined }}
        className={`group px-3 py-2 transition-colors ${isExpanded ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-tertiary)]'}`}
      >
        {/* User header */}
        <div className="flex items-center gap-2">
          <Avatar url={user.avatar} emoji={user.agent_icon || (isService ? '🔧' : null)} name={user.name} color={avatarColor} size={40} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-[var(--text-primary)] truncate select-text" title={user.name}>
                {user.name}
              </span>
              <span className="text-[10px] text-[var(--text-secondary)] shrink-0 select-text">(#{user.system_user_id ?? 'N/A'})</span>
              {!user.active && (
                <span className="px-1.5 py-0.5 text-[10px] rounded bg-red-500/20 text-[var(--text-primary)] shrink-0">
                  {t('Неактивен', 'Inactive')}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1 min-w-0 flex-wrap">
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0 text-[var(--text-primary)] ${isAgent ? 'bg-purple-500/20' : isService ? 'bg-orange-500/20' : 'bg-blue-500/20'}`}>
                {typeLabel}
              </span>
              <span className="text-[10px] text-[var(--text-secondary)] truncate flex-[1_1_5rem] min-w-0 select-text" title={user.email || undefined}>
                {user.email}
              </span>
              <div className="ml-auto flex items-center gap-1 shrink-0">
                {/* Role selector */}
                <div className="relative">
                  <select
                    aria-label={`${t('Роль', 'Role')}: ${user.name}`}
                    value={user.role || 'viewer'}
                    onChange={(e) => onUpdateUserRole(user.row_id, e.target.value as UserAccessLevel)}
                    disabled={updatingRoleRowId === user.row_id}
                    className="appearance-none max-w-32 px-2 py-0.5 pr-5 text-[10px] rounded border-0 bg-transparent cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] disabled:opacity-50"
                    style={{
                      backgroundColor: `${roleColor}20`,
                      color: 'var(--text-primary)',
                    }}
                  >
                    {availableLevels.map((level) => (
                      <option
                        key={level.value}
                        value={level.value}
                        style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                      >
                        {level.label}
                      </option>
                    ))}
                  </select>
                  {updatingRoleRowId === user.row_id ? (
                    <Loader2
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin"
                      style={{ color: roleColor }}
                    />
                  ) : (
                    <ChevronDown
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
                      style={{ color: roleColor }}
                    />
                  )}
                </div>
                {/* Action buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onToggleExpanded(user.row_id)}
                    aria-expanded={isExpanded}
                    aria-controls={isExpanded ? detailsId : undefined}
                    aria-label={`${t('Карта доступов', 'Access map')}: ${user.name}`}
                    className={`p-1.5 rounded-md transition-colors ${isExpanded ? 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/10' : 'text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:bg-[var(--bg-tertiary)]'}`}
                    title={t('Карта доступов', 'Access map')}
                  >
                    <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteUserFromTable(user.row_id, user.name)}
                    disabled={isDeletingUser === user.row_id}
                    className="p-1.5 text-[var(--text-secondary)] hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-50"
                    title={t('Удалить пользователя', 'Delete user')}
                    aria-label={`${t('Удалить пользователя', 'Delete user')}: ${user.name}`}
                  >
                    {isDeletingUser === user.row_id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded edit section - full width outside the card */}
      {isExpanded && (
        <div id={detailsId} className="p-3 bg-[var(--bg-tertiary)] border-t border-[var(--border-secondary)] space-y-3">
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
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-500/10 text-[var(--text-primary)] border border-amber-500/30">
              <Info className="w-2.5 h-2.5" />
              {translate(`userAccess.roles.${inheritedRole.level}`)} @ {translate(`userAccess.panel.levels.${inheritedRole.source}`)}
              {' -> '}
              {translate(`userAccess.roles.${directRole.level}`)} @ {translate(`userAccess.panel.levels.${directRole.source}`)}
            </span>
          )}
        </div>

        {/* Granular access summary */}
        <div className="flex flex-wrap gap-1 text-xs">
          {projectCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-[var(--text-primary)]">
              {ENTITY_LEVEL_ICONS.project} {projectCount} {t('проектов', 'projects')}
            </span>
          )}
          {tableCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-primary-500/10 text-[var(--text-primary)]">
              {ENTITY_LEVEL_ICONS.table} {tableCount} {t('таблиц', 'tables')}
            </span>
          )}
          {columnCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-green-500/10 text-[var(--text-primary)]">
              {ENTITY_LEVEL_ICONS.column} {columnCount} {t('колонок', 'columns')}
            </span>
          )}
          {deniedCount > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-[var(--text-primary)]">
              <Ban className="w-3 h-3 inline" /> {deniedCount} {t('запрещено', 'denied')}
            </span>
          )}
          {projectCount === 0 && tableCount === 0 && columnCount === 0 && deniedCount === 0 && (
            <span className="text-[var(--text-secondary)]">{t('Гранулярный доступ не настроен', 'Granular access not configured')}</span>
          )}
        </div>
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
                  aria-label={`${t('Роль в объекте', 'Entity role')}: ${user.name}`}
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
                      const currentArray = (user[`${entityLevel}_${level}` as keyof UserTableRow] as string[]) || [];
                      if (currentArray.includes(entityIdStr)) {
                        await onUpdateGranularAccess(
                          user.row_id,
                          entityLevel,
                          level,
                          currentArray.filter((id) => id !== entityIdStr)
                        );
                      }
                    }

                    // Add to new access array if not empty
                    if (newRole) {
                      const currentArray = (user[`${entityLevel}_${newRole}` as keyof UserTableRow] as string[]) || [];
                      await onUpdateGranularAccess(
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
                  {availableLevels.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.label}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-[var(--text-secondary)]">
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
                <h6 className="text-xs font-medium text-[var(--text-primary)]">{t('📁 Проекты', '📁 Projects')}</h6>
                <div className="grid grid-cols-5 gap-1 text-[10px]">
                  <div className="p-1 rounded bg-yellow-500/10 text-[var(--text-primary)]">
                    <div className="font-medium">Owner</div>
                    <div className="text-[9px] break-all">{user.project_owner?.join(', ') || '—'}</div>
                  </div>
                  <div className="p-1 rounded bg-purple-500/10 text-[var(--text-primary)]">
                    <div className="font-medium">Admin</div>
                    <div className="text-[9px] break-all">{user.project_admin?.join(', ') || '—'}</div>
                  </div>
                  <div className="p-1 rounded bg-primary-500/10 text-[var(--text-primary)]">
                    <div className="font-medium">Editor</div>
                    <div className="text-[9px] break-all">{user.project_editor?.join(', ') || '—'}</div>
                  </div>
                  <div className="p-1 rounded bg-green-500/10 text-[var(--text-primary)]">
                    <div className="font-medium">Viewer</div>
                    <div className="text-[9px] break-all">{user.project_viewer?.join(', ') || '—'}</div>
                  </div>
                  <div className="p-1 rounded bg-red-500/10 text-[var(--text-primary)]">
                    <div className="font-medium">Denied</div>
                    <div className="text-[9px] break-all">{user.project_denied?.join(', ') || '—'}</div>
                  </div>
                </div>
              </div>

              {/* Table access grid */}
              <div className="space-y-2">
                <h6 className="text-xs font-medium text-[var(--text-primary)]">{t('📋 Таблицы', '📋 Tables')}</h6>
                <div className="grid grid-cols-5 gap-1 text-[10px]">
                  <div className="p-1 rounded bg-yellow-500/10 text-[var(--text-primary)]">
                    <div className="font-medium">Owner</div>
                    <div className="text-[9px] break-all">{user.table_owner?.join(', ') || '—'}</div>
                  </div>
                  <div className="p-1 rounded bg-purple-500/10 text-[var(--text-primary)]">
                    <div className="font-medium">Admin</div>
                    <div className="text-[9px] break-all">{user.table_admin?.join(', ') || '—'}</div>
                  </div>
                  <div className="p-1 rounded bg-primary-500/10 text-[var(--text-primary)]">
                    <div className="font-medium">Editor</div>
                    <div className="text-[9px] break-all">{user.table_editor?.join(', ') || '—'}</div>
                  </div>
                  <div className="p-1 rounded bg-green-500/10 text-[var(--text-primary)]">
                    <div className="font-medium">Viewer</div>
                    <div className="text-[9px] break-all">{user.table_viewer?.join(', ') || '—'}</div>
                  </div>
                  <div className="p-1 rounded bg-red-500/10 text-[var(--text-primary)]">
                    <div className="font-medium">Denied</div>
                    <div className="text-[9px] break-all">{user.table_denied?.join(', ') || '—'}</div>
                  </div>
                </div>
              </div>

              {/* Column access grid */}
              <div className="space-y-2">
                <h6 className="text-xs font-medium text-[var(--text-primary)]">{t('📊 Колонки', '📊 Columns')}</h6>
                <div className="grid grid-cols-5 gap-1 text-[10px]">
                  <div className="p-1 rounded bg-yellow-500/10 text-[var(--text-primary)]">
                    <div className="font-medium">Owner</div>
                    <div className="text-[9px] break-all">{user.column_owner?.join(', ') || '—'}</div>
                  </div>
                  <div className="p-1 rounded bg-purple-500/10 text-[var(--text-primary)]">
                    <div className="font-medium">Admin</div>
                    <div className="text-[9px] break-all">{user.column_admin?.join(', ') || '—'}</div>
                  </div>
                  <div className="p-1 rounded bg-primary-500/10 text-[var(--text-primary)]">
                    <div className="font-medium">Editor</div>
                    <div className="text-[9px] break-all">{user.column_editor?.join(', ') || '—'}</div>
                  </div>
                  <div className="p-1 rounded bg-green-500/10 text-[var(--text-primary)]">
                    <div className="font-medium">Viewer</div>
                    <div className="text-[9px] break-all">{user.column_viewer?.join(', ') || '—'}</div>
                  </div>
                  <div className="p-1 rounded bg-red-500/10 text-[var(--text-primary)]">
                    <div className="font-medium">Denied</div>
                    <div className="text-[9px] break-all">{user.column_denied?.join(', ') || '—'}</div>
                  </div>
                </div>
              </div>
            </>
          )}

          <p className="text-xs text-[var(--text-secondary)]">
            {t('💡 Редактируйте доступы напрямую в таблице Users', '💡 Edit permissions directly in the Users table')}
          </p>
        </div>
      )}
    </React.Fragment>
  );
};
