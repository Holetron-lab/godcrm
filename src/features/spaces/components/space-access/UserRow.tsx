/**
 * A single user row in the SpaceAccessManager table.
 */

import React from 'react';
import {
  Trash2,
  ChevronDown,
  Loader2,
  ArrowDown,
  Layers
} from 'lucide-react';
import type { UserAccessLevel } from '@/shared/types/user-access.types';
import {
  ACCESS_LEVEL_LABELS,
  ACCESS_LEVEL_COLORS
} from '@/shared/types/user-access.types';
import type { SpaceUserRow } from './types';
import { LEVEL_LABELS, LEVEL_COLORS, LEVEL_ICONS } from './constants';
import { getLevelIcon, getGranularCounts, getPermissionLevel } from './utils';
import { GranularAccessDetails } from './GranularAccessDetails';

interface UserRowProps {
  user: SpaceUserRow;
  isExpanded: boolean;
  isManageable: boolean;
  updatingRoleRowId: string | null;
  isDeletingUser: string | null;
  availableLevels: { value: UserAccessLevel; label: string }[];
  onToggleExpand: (rowId: string) => void;
  onUpdateRole: (rowId: string, newRole: UserAccessLevel) => void;
  onDeleteUser: (rowId: string, userName: string) => void;
}

export const UserRow = ({
  user,
  isExpanded,
  isManageable,
  updatingRoleRowId,
  isDeletingUser,
  availableLevels,
  onToggleExpand,
  onUpdateRole,
  onDeleteUser
}: UserRowProps) => {
  const roleValue = user.role as UserAccessLevel;
  const roleColor = ACCESS_LEVEL_COLORS[roleValue] || '#6b7280';
  const permLevel = getPermissionLevel(user);
  const counts = getGranularCounts(user);

  return (
    <React.Fragment>
      {/* Main row */}
      <div
        className={`grid grid-cols-[1fr_1.2fr_auto_auto_auto] gap-2 px-4 py-3 items-center bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)] transition-colors ${isExpanded ? 'bg-[var(--bg-secondary)]' : ''}`}
      >
        {/* User cell: avatar + name */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0"
            style={{ backgroundColor: roleColor }}
          >
            {String(user.name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-[var(--text-primary)] truncate">
              {user.name}
            </div>
            {user.system_user_id && (
              <div className="text-[10px] text-[var(--text-tertiary)]">
                ID: {user.system_user_id}
              </div>
            )}
          </div>
          {!user.active && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-red-500/20 text-red-400 shrink-0">
              Неактивен
            </span>
          )}
        </div>

        {/* Email cell */}
        <div className="text-sm text-[var(--text-secondary)] truncate min-w-0">
          {user.email || '-'}
        </div>

        {/* Role cell: dropdown */}
        <div className="w-28">
          {isManageable ? (
            <div className="relative">
              <select
                value={roleValue || 'viewer'}
                onChange={(e) => onUpdateRole(user.row_id, e.target.value as UserAccessLevel)}
                disabled={updatingRoleRowId === user.row_id}
                className="appearance-none w-full px-2 py-1.5 pr-7 text-xs font-medium rounded-md border-0 bg-transparent cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
                style={{
                  backgroundColor: `${roleColor}20`,
                  color: roleColor
                }}
              >
                {availableLevels.map(level => (
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
                <Loader2 className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin" style={{ color: roleColor }} />
              ) : (
                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: roleColor }} />
              )}
            </div>
          ) : (
            <div
              className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md"
              style={{ backgroundColor: `${roleColor}20`, color: roleColor }}
            >
              {getLevelIcon(roleValue)}
              <span>{ACCESS_LEVEL_LABELS[roleValue] || roleValue}</span>
            </div>
          )}
        </div>

        {/* Level cell: badge showing permission source */}
        <div className="w-24 flex justify-center">
          <span className={`inline-flex items-center gap-1 px-1.5 py-1 text-[10px] font-medium rounded border ${LEVEL_COLORS[permLevel.level]}`}>
            {LEVEL_ICONS[permLevel.level]}
            {LEVEL_LABELS[permLevel.level]}
            {!permLevel.isDirect && (
              <ArrowDown className="w-2.5 h-2.5" />
            )}
          </span>
        </div>

        {/* Actions cell */}
        <div className="w-20 flex items-center justify-center gap-1">
          {/* Expand to see granular overrides */}
          {counts.total > 0 && (
            <button
              type="button"
              onClick={() => onToggleExpand(user.row_id)}
              className={`p-1.5 rounded-md transition-colors ${
                isExpanded
                  ? 'text-[var(--accent-primary)] bg-[var(--accent-primary)]/10'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--accent-primary)] hover:bg-[var(--bg-tertiary)]'
              }`}
              title={`${counts.total} гранулярных правил`}
            >
              <Layers className="w-4 h-4" />
            </button>
          )}
          {isManageable ? (
            <button
              type="button"
              onClick={() => onDeleteUser(user.row_id, user.name)}
              disabled={isDeletingUser === user.row_id}
              className="p-1.5 text-[var(--text-tertiary)] hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-50"
              title="Удалить"
            >
              {isDeletingUser === user.row_id ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
          ) : (
            <span className="text-[var(--text-tertiary)] text-xs">--</span>
          )}
        </div>
      </div>

      {/* Expanded: granular access details */}
      {isExpanded && (
        <GranularAccessDetails user={user} />
      )}
    </React.Fragment>
  );
};
