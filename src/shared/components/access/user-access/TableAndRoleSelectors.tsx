/**
 * TableAndRoleSelectors - Users table + role column selector row,
 * extracted from UserAccessPanel.tsx.
 *
 * Pure presentational controls: delegates state to parent.
 */

import React from 'react';
import { Database, Settings } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { SpaceTable, TableColumn } from './types';

interface TableAndRoleSelectorsProps {
  isLoadingTables: boolean;
  tablesByProject: Record<string, SpaceTable[]>;
  selectedTableId: number | null;
  setSelectedTableId: (id: number | null) => void;
  defaultTableId: number | null | undefined;

  tableColumns: TableColumn[];
  selectedRoleColumnId: string | null;
  setSelectedRoleColumnId: (id: string | null) => void;
}

export const TableAndRoleSelectors = ({
  isLoadingTables,
  tablesByProject,
  selectedTableId,
  setSelectedTableId,
  defaultTableId,
  tableColumns,
  selectedRoleColumnId,
  setSelectedRoleColumnId,
}: TableAndRoleSelectorsProps) => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* Users table selector */}
      <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
        <div className="flex items-center gap-2 mb-2">
          <Database className="w-4 h-4 text-[var(--accent-primary)]" />
          <label className="text-sm font-medium text-[var(--text-primary)]">
            {t('Таблица пользователей', 'Users table')}
          </label>
        </div>
        {isLoadingTables ? (
          <div className="text-sm text-[var(--text-tertiary)]">{t('Загрузка...', 'Loading...')}</div>
        ) : (
          <select
            value={selectedTableId?.toString() || ''}
            onChange={(e) => setSelectedTableId(e.target.value ? parseInt(e.target.value) : null)}
            className="w-full px-3 py-2 text-sm rounded-md border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
          >
            <option value="">{t('— Выберите таблицу —', '— Select a table —')}</option>
            {Object.entries(tablesByProject).map(([projectName, tables]) => (
              <optgroup key={projectName} label={projectName}>
                {tables.map((table) => (
                  <option key={table.id} value={table.id.toString()}>
                    {table.display_name} (ID: {table.id})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        {selectedTableId && defaultTableId === selectedTableId && (
          <p className="mt-1 text-xs text-green-400">
            {t('✓ Таблица "Users" из System Data', '✓ "Users" table from System Data')}
          </p>
        )}
      </div>

      {/* Role column selector */}
      <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
        <div className="flex items-center gap-2 mb-2">
          <Settings className="w-4 h-4 text-[var(--accent-primary)]" />
          <label className="text-sm font-medium text-[var(--text-primary)]">
            {t('Колонка ролей', 'Role column')}
          </label>
        </div>
        {selectedTableId && tableColumns.length > 0 ? (
          <>
            <select
              value={selectedRoleColumnId || ''}
              onChange={(e) => setSelectedRoleColumnId(e.target.value || null)}
              className="w-full px-3 py-2 text-sm rounded-md border bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/50"
            >
              <option value="">{t('— Не выбрано —', '— Not selected —')}</option>
              {tableColumns.map((col: TableColumn) => (
                <option key={col.id} value={col.id}>
                  {col.display_name || col.name} ({col.column_type || col.type})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[var(--text-tertiary)]">
              {t('Колонка с ролями: owner, admin, editor, viewer', 'Column with roles: owner, admin, editor, viewer')}
            </p>
          </>
        ) : (
          <div className="text-sm text-[var(--text-tertiary)] py-2">
            {selectedTableId ? t('Загрузка колонок...', 'Loading columns...') : t('Сначала выберите таблицу', 'Select a table first')}
          </div>
        )}
      </div>
    </div>
  );
};
