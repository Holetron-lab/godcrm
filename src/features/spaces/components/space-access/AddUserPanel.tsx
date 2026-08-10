/**
 * Panel for adding users to the space access table.
 */

import React, { useMemo } from 'react';
import {
  UserPlus,
  Search,
  Check,
  X,
  Loader2,
  Users
} from 'lucide-react';
import type { UserAccessLevel } from '@/shared/types/user-access.types';
import { ACCESS_LEVEL_COLORS } from '@/shared/types/user-access.types';
import type { AddUserPanelProps } from './types';

export const AddUserPanel = ({
  systemUsers,
  existingUserIds,
  selectedUsers,
  defaultLevel,
  availableLevels,
  searchQuery,
  onSearchChange,
  onToggleUser,
  onUpdateLevel,
  onDefaultLevelChange,
  onSubmit,
  onCancel,
  isSubmitting
}: AddUserPanelProps) => {
  const filteredSystemUsers = useMemo(() => {
    const available = systemUsers.filter(u => !existingUserIds.includes(u.id));
    if (!searchQuery) return available.slice(0, 20);
    const q = searchQuery.toLowerCase();
    return available
      .filter(u =>
        u.email?.toLowerCase().includes(q) ||
        u.name?.toLowerCase().includes(q) ||
        u.id.toString().includes(q)
      )
      .slice(0, 20);
  }, [systemUsers, existingUserIds, searchQuery]);

  return (
    <div className="rounded-lg border border-[var(--accent-primary)] bg-[var(--bg-secondary)] p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h5 className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-[var(--accent-primary)]" />
          Добавить пользователей
          {selectedUsers.length > 0 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-[var(--accent-primary)] text-white">
              {selectedUsers.length}
            </span>
          )}
        </h5>
        <button
          type="button"
          onClick={onCancel}
          className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Default role */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[var(--text-tertiary)]">Роль по умолчанию:</span>
        <select
          value={defaultLevel}
          onChange={(e) => onDefaultLevelChange(e.target.value as UserAccessLevel)}
          className="px-2 py-1 text-sm rounded border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
        >
          {availableLevels.map(level => (
            <option key={level.value} value={level.value}>{level.label}</option>
          ))}
        </select>
      </div>

      {/* Selected users chips */}
      {selectedUsers.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-[var(--text-tertiary)] font-medium">Выбранные:</div>
          <div className="flex flex-wrap gap-2">
            {selectedUsers.map(({ userId, level }) => {
              const user = systemUsers.find(u => u.id === userId);
              if (!user) return null;
              const roleColor = ACCESS_LEVEL_COLORS[level] || '#6b7280';
              return (
                <div
                  key={userId}
                  className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg border bg-[var(--bg-primary)]"
                  style={{ borderColor: `${roleColor}50` }}
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-medium shrink-0"
                    style={{ backgroundColor: roleColor }}
                  >
                    {String(user.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <span className="text-xs text-[var(--text-primary)]">{user.name}</span>
                  <select
                    value={level}
                    onChange={(e) => onUpdateLevel(userId, e.target.value as UserAccessLevel)}
                    className="px-1 py-0.5 text-[10px] rounded border-0 bg-transparent focus:outline-none cursor-pointer"
                    style={{ color: roleColor }}
                  >
                    {availableLevels.map(l => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onToggleUser(userId)}
                    className="p-0.5 text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Поиск по имени, email или ID..."
          className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20"
        />
      </div>

      {/* Users list */}
      <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] divide-y divide-[var(--border-secondary)]">
        {filteredSystemUsers.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-[var(--text-tertiary)]">
            <Users className="w-6 h-6 mx-auto mb-2 opacity-50" />
            {systemUsers.length === 0 ? 'Загрузка пользователей...' : 'Все пользователи уже добавлены'}
          </div>
        ) : (
          filteredSystemUsers.map(u => {
            const isSelected = selectedUsers.some(s => s.userId === u.id);
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => onToggleUser(u.id)}
                className={`w-full px-3 py-2.5 text-left hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-3 ${isSelected ? 'bg-[var(--accent-primary)]/10' : ''}`}
              >
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${isSelected ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)]' : 'border-[var(--border-primary)]'}`}>
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>
                <div className="w-7 h-7 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-xs font-medium text-[var(--text-secondary)] shrink-0">
                  {String(u.name || '?').charAt(0).toUpperCase()}
                </div>
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
          })
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-secondary)]">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-md hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={selectedUsers.length === 0 || isSubmitting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-[var(--accent-primary)] text-white rounded-md hover:bg-[var(--accent-primary)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Добавление...
            </>
          ) : (
            <>
              <UserPlus className="w-4 h-4" />
              Добавить ({selectedUsers.length})
            </>
          )}
        </button>
      </div>
    </div>
  );
};
