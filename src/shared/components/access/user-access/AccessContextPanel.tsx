/**
 * Top section of the Access tab: God badge, permission hierarchy legend,
 * and current-entity breadcrumb/inheritance context.
 * Extracted from UserAccessPanel.tsx.
 */

import React from 'react';
import {
  Info,
  Crown,
  Settings,
  Edit3,
  Eye,
  Ban,
  Shield,
} from 'lucide-react';
import type { PermissionEntityType } from '@/shared/types/user-access.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { User } from './types';

interface AccessContextPanelProps {
  ownerOwnerUser: User | null;
  entityType: PermissionEntityType;
  spaceName?: string;
  projectName?: string;
  tableName?: string;
  columnName?: string;
  onNavigateToSpace?: () => void;
  onNavigateToProject?: () => void;
  onNavigateToTable?: () => void;
}

export const AccessContextPanel = ({
  ownerOwnerUser,
  entityType,
  spaceName,
  projectName,
  tableName,
  columnName,
  onNavigateToSpace,
  onNavigateToProject,
  onNavigateToTable,
}: AccessContextPanelProps) => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  return (
    <>
      {/* God badge - creator with full access */}
      {ownerOwnerUser && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary-500/10 border border-primary-500/30 text-sm">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center">
              <span className="text-white font-bold text-xs">G</span>
            </div>
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-primary-400 rounded-full flex items-center justify-center animate-pulse">
              <Crown className="w-2.5 h-2.5 text-white" />
            </div>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-primary-400 font-bold">God:</span>
              <span className="text-[var(--text-primary)] font-medium">{ownerOwnerUser.email}</span>
              <span className="text-[var(--text-tertiary)] text-xs">(id{ownerOwnerUser.id})</span>
            </div>
            <span className="text-xs text-primary-300/70">{t('Создатель • Полный доступ • Неограничен', 'Creator • Full access • Unlimited')}</span>
          </div>
        </div>
      )}

      {/* Info panel with hierarchy and context - two columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Left: Permission hierarchy */}
        <div className="flex items-start gap-2 p-3 rounded-lg bg-primary-500/10 border border-primary-500/30 text-sm text-primary-400">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <strong>{t('Иерархия прав:', 'Permission hierarchy:')}</strong>
            <div className="mt-2 space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <Crown className="w-3 h-3 text-yellow-400" />
                <span className="w-16 text-[var(--text-tertiary)]">Owner:</span>
                <span>{t('Полный доступ (нельзя ограничить)', 'Full access (cannot be restricted)')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Settings className="w-3 h-3 text-purple-400" />
                <span className="w-16 text-[var(--text-tertiary)]">Admin:</span>
                <span>{t('Настройки + редактирование', 'Settings + editing')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Edit3 className="w-3 h-3 text-primary-400" />
                <span className="w-16 text-[var(--text-tertiary)]">Editor:</span>
                <span>{t('Только редактирование', 'Editing only')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Eye className="w-3 h-3 text-green-400" />
                <span className="w-16 text-[var(--text-tertiary)]">Viewer:</span>
                <span>{t('Только просмотр', 'View only')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Ban className="w-3 h-3 text-red-400" />
                <span className="w-16 text-[var(--text-tertiary)]">Denied:</span>
                <span>{t('Нет доступа (скрыт)', 'No access (hidden)')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Current context and navigation */}
        <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-[var(--accent-primary)]" />
            <span className="text-sm font-medium text-[var(--text-primary)]">{t('Контекст', 'Context')}</span>
          </div>

          {/* What we're editing */}
          <div className="text-xs space-y-2">
            <div className="flex items-center gap-2 p-2 rounded bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/30">
              <span className="text-[var(--accent-primary)] font-medium">
                {entityType === 'space' && t('🌐 Доступ к пространству', '🌐 Space access')}
                {entityType === 'project' && t('📁 Доступ к проекту', '📁 Project access')}
                {entityType === 'table' && t('📋 Доступ к таблице', '📋 Table access')}
                {entityType === 'column' && t('📊 Доступ к колонке', '📊 Column access')}
              </span>
            </div>

            {/* Breadcrumb path */}
            <div className="space-y-1.5 text-[var(--text-tertiary)]">
              {spaceName && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider opacity-60">{t('Пространство:', 'Space:')}</span>
                  {onNavigateToSpace && entityType !== 'space' ? (
                    <button
                      onClick={onNavigateToSpace}
                      className="text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:underline transition-colors"
                    >
                      🌐 {spaceName}
                    </button>
                  ) : (
                    <span className="text-[var(--text-secondary)]">🌐 {spaceName}</span>
                  )}
                </div>
              )}

              {projectName && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider opacity-60">{t('Проект:', 'Project:')}</span>
                  {onNavigateToProject && entityType !== 'project' ? (
                    <button
                      onClick={onNavigateToProject}
                      className="text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:underline transition-colors"
                    >
                      📁 {projectName}
                    </button>
                  ) : (
                    <span className="text-[var(--text-secondary)]">📁 {projectName}</span>
                  )}
                </div>
              )}

              {tableName && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider opacity-60">{t('Таблица:', 'Table:')}</span>
                  {onNavigateToTable && entityType !== 'table' ? (
                    <button
                      onClick={onNavigateToTable}
                      className="text-[var(--text-secondary)] hover:text-[var(--accent-primary)] hover:underline transition-colors"
                    >
                      📋 {tableName}
                    </button>
                  ) : (
                    <span className="text-[var(--text-secondary)]">📋 {tableName}</span>
                  )}
                </div>
              )}

              {columnName && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider opacity-60">{t('Колонка:', 'Column:')}</span>
                  <span className="text-[var(--text-primary)] font-medium">📊 {columnName}</span>
                </div>
              )}
            </div>

            {/* Inheritance direction */}
            <div className="pt-2 mt-2 border-t border-[var(--border-secondary)]">
              <span className="text-[10px] uppercase tracking-wider opacity-60">{t('Наследование:', 'Inheritance:')}</span>
              <div className="mt-1 text-[var(--text-secondary)]">
                {entityType === 'column' && t('📊 Колонка → 📋 Таблица → 📁 Проект → 🌐 Пространство', '📊 Column → 📋 Table → 📁 Project → 🌐 Space')}
                {entityType === 'table' && t('📋 Таблица → 📁 Проект → 🌐 Пространство', '📋 Table → 📁 Project → 🌐 Space')}
                {entityType === 'project' && t('📁 Проект → 🌐 Пространство', '📁 Project → 🌐 Space')}
                {entityType === 'space' && t('🌐 Пространство (верхний уровень)', '🌐 Space (top level)')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
