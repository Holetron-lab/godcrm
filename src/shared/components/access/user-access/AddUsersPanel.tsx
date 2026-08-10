/**
 * Expanded "Add users" panel used in the Users tab.
 * Extracted from UserAccessPanel.tsx.
 */

import React from 'react';
import { UserPlus, Users, Search, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { UserAccessLevel } from '@/shared/types/user-access.types';
import { ACCESS_LEVEL_COLORS } from '@/shared/types/user-access.types';
import type { User, UserTableRow } from './types';

interface AddUsersPanelProps {
  systemUsers: User[];
  usersTableRows: UserTableRow[];
  selectedUsersToAdd: Array<{ userId: number; level: UserAccessLevel }>;
  selectedLevel: UserAccessLevel;
  setSelectedLevel: (v: UserAccessLevel) => void;
  addUserSearchQuery: string;
  setAddUserSearchQuery: (v: string) => void;
  availableLevels: { value: UserAccessLevel; label: string }[];
  isAddingUser: boolean;
  onToggleUser: (userId: number) => void;
  onUpdateSelectedLevel: (userId: number, level: UserAccessLevel) => void;
  onRemoveSelected: (userId: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export const AddUsersPanel = ({
  systemUsers,
  usersTableRows,
  selectedUsersToAdd,
  selectedLevel,
  setSelectedLevel,
  addUserSearchQuery,
  setAddUserSearchQuery,
  availableLevels,
  isAddingUser,
  onToggleUser,
  onUpdateSelectedLevel,
  onRemoveSelected,
  onConfirm,
  onCancel,
}: AddUsersPanelProps) => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  return (
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
          onClick={onCancel}
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
          {availableLevels.map((level) => (
            <option key={level.value} value={level.value}>
              {level.label}
            </option>
          ))}
        </select>
      </div>

      {/* Selected users list */}
      {selectedUsersToAdd.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-[var(--text-tertiary)] font-medium">{t('Выбранные пользователи:', 'Selected users:')}</div>
          <div className="flex flex-wrap gap-2">
            {selectedUsersToAdd.map(({ userId, level }) => {
              const user = systemUsers.find((u) => u.id === userId);
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
                    onChange={(e) => onUpdateSelectedLevel(userId, e.target.value as UserAccessLevel)}
                    className="px-1 py-0.5 text-xs rounded border-0 bg-transparent focus:outline-none cursor-pointer"
                    style={{ color: roleColor }}
                  >
                    {availableLevels.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onRemoveSelected(userId)}
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
          .filter((u) => {
            // Exclude users already in the table
            const alreadyAdded = usersTableRows.some((row) => row.system_user_id === u.id);
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
          .map((u) => {
            const isSelected = selectedUsersToAdd.some((s) => s.userId === u.id);
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => onToggleUser(u.id)}
                className={`w-full px-3 py-2.5 text-left hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-3 ${isSelected ? 'bg-[var(--accent-primary)]/10' : ''}`}
              >
                {/* Checkbox */}
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${isSelected ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)]' : 'border-[var(--border-primary)]'}`}
                >
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>
                {/* Mini avatar */}
                <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-xs font-medium text-[var(--text-secondary)] shrink-0">
                  {String(u.name || '?').charAt(0).toUpperCase()}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-sm font-medium truncate ${isSelected ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'}`}
                  >
                    {u.name}
                  </div>
                  <div className="text-xs text-[var(--text-tertiary)] truncate">
                    (ID: {u.id}) {u.email}
                  </div>
                </div>
              </button>
            );
          })}
        {systemUsers.filter((u) => !usersTableRows.some((row) => row.system_user_id === u.id)).length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-[var(--text-tertiary)]">
            <Users className="w-6 h-6 mx-auto mb-2 opacity-50" />
            {t('Все системные пользователи уже добавлены', 'All system users are already added')}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-secondary)]">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isAddingUser}>
          {t('Отмена', 'Cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onConfirm}
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
  );
};
