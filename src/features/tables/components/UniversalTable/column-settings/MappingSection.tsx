/**
 * MappingSection — Column mapping reference panel
 * Shows available template variables from row data
 * Extracted from TypeTab for modularity
 */
import React from 'react';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { showToast } from '@/shared/hooks/useToast';
import type { TFunction } from './shared';

interface MappingSectionProps {
  draft: ColumnModel;
  t: TFunction;
  allColumns: ColumnModel[];
  currentMappingRow: Record<string, unknown>;
  mappingRowIndex: number;
  mappingRows: Array<{ id: string; data: Record<string, unknown> }>;
  goToPrevMappingRow: () => void;
  goToNextMappingRow: () => void;
}

export const MappingSection = ({
  draft,
  t,
  allColumns,
  currentMappingRow,
  mappingRowIndex,
  mappingRows,
  goToPrevMappingRow,
  goToNextMappingRow,
}: MappingSectionProps) => {
  return (
    <div className="space-y-2 pt-3 border-t border-[var(--border-primary)]">
      {/* Заголовок с навигацией */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-2">
          🗺️ {t('columnSettings.mapping.title')}
        </div>
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={goToPrevMappingRow}
            disabled={mappingRowIndex === 0}
            className="p-1 rounded hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:cursor-not-allowed"
            title={t('columnSettings.mapping.prevRow')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <span className="text-[var(--text-secondary)] min-w-[60px] text-center">
            {mappingRowIndex + 1} / {mappingRows.length}
          </span>
          <button
            type="button"
            onClick={goToNextMappingRow}
            disabled={mappingRowIndex >= mappingRows.length - 1}
            className="p-1 rounded hover:bg-[var(--bg-secondary)] disabled:opacity-30 disabled:cursor-not-allowed"
            title={t('columnSettings.mapping.nextRow')}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>
      <div className="bg-white/50 dark:bg-black/20 rounded-lg border border-[var(--border-primary)] overflow-hidden">
        <div className="p-2 text-xs space-y-0.5">
          {/* Системные переменные */}
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText('{{row_id}}');
              showToast(t('columnSettings.mapping.copied', { value: '{{row_id}}' }), 'success');
            }}
            className="w-full flex items-center gap-2 py-1.5 px-2 rounded hover:bg-primary-100 dark:hover:bg-primary-200 cursor-pointer transition-colors text-left border-b border-[var(--border-primary)] mb-1"
            title={`{{row_id}} = ${currentMappingRow.id ?? t('columnSettings.mapping.rowId')}`}
          >
            <span className="text-primary-600 dark:text-primary-400 w-28 flex-shrink-0">🆔 {t('columnSettings.mapping.rowId')}</span>
            <code className="text-primary-600 dark:text-primary-400 font-mono font-semibold flex-shrink-0">{'{{row_id}}'}</code>
            <span className="text-[var(--text-secondary)] flex-shrink-0">=</span>
            <span className="text-[var(--text-secondary)] truncate flex-1 text-right">
              {String(currentMappingRow.id ?? '')}
            </span>
          </button>
          {/* Колонки таблицы */}
          {Object.entries(currentMappingRow).filter(([key]) => key !== 'id').map(([key, value]) => {
            const columnInfo = allColumns.find(c => c.name === key || c.id === key);
            const displayName = columnInfo?.displayName || key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(`{{${key}}}`);
                  showToast(t('columnSettings.mapping.copied', { value: `{{${key}}}` }), 'success');
                }}
                className="w-full flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors text-left"
                title={`{{${key}}} = ${String(value)}`}
              >
                <span className="text-[var(--text-secondary)] w-28 flex-shrink-0 truncate" title={displayName}>{displayName}</span>
                <code className="text-orange-700 dark:text-orange-400 font-mono font-semibold flex-shrink-0">{`{{${key}}}`}</code>
                <span className="text-[var(--text-secondary)] flex-shrink-0">=</span>
                <span className="text-[var(--text-secondary)] truncate flex-1 text-right">
                  {String(value)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
