import { useCallback } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import type { ColumnModel } from '../../types/table.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface BulkReplaceColumnMapProps {
  columns: ColumnModel[];
  currentPreviewRow: Record<string, unknown> | null;
  previewRowIndex: number;
  previewRowsLength: number;
  onPrevRow: () => void;
  onNextRow: () => void;
  /** If provided, clicking a column inserts a variable; otherwise copies to clipboard */
  onInsertVariable?: (variable: string) => void;
  /** Show {{value}} and {{row_id}} special variables (for formula mode) */
  showSpecialVariables?: boolean;
  tableInfo?: { name: string; id: string; key: string };
}

/**
 * Reusable column mapping panel used in BulkReplaceModal for replace, addText, and formula modes.
 * Shows a navigable preview of row data with clickable column references.
 */
export const BulkReplaceColumnMap = ({
  columns,
  currentPreviewRow,
  previewRowIndex,
  previewRowsLength,
  onPrevRow,
  onNextRow,
  onInsertVariable,
  showSpecialVariables = false,
  tableInfo,
}: BulkReplaceColumnMapProps) => {
  const { t } = useLanguage();
  const handleColumnClick = useCallback((variable: string) => {
    if (onInsertVariable) {
      onInsertVariable(variable);
    } else {
      navigator.clipboard.writeText(variable);
    }
  }, [onInsertVariable]);

  if (!currentPreviewRow) return null;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-primary)] overflow-hidden">
      {/* Header with navigation */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-[var(--border-primary)] flex-shrink-0">
        <span className="text-xs text-[var(--text-tertiary)]">
          {t('bulkReplace.mapRowOf').replace('{current}', String(previewRowIndex + 1)).replace('{total}', String(previewRowsLength))}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrevRow}
            disabled={previewRowIndex === 0}
            className="p-1 rounded hover:bg-[var(--color-primary-500)]/10 disabled:opacity-30 disabled:cursor-not-allowed"
            title={t('bulkReplace.mapPrevRow')}
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onNextRow}
            disabled={previewRowIndex >= previewRowsLength - 1}
            className="p-1 rounded hover:bg-[var(--color-primary-500)]/10 disabled:opacity-30 disabled:cursor-not-allowed"
            title={t('bulkReplace.mapNextRow')}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Columns list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
        <div className="space-y-0.5 text-xs">
          {/* Special variables for formula mode */}
          {showSpecialVariables && (
            <>
              <button
                type="button"
                onClick={() => handleColumnClick('{{value}}')}
                className="w-full flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[var(--color-primary-500)]/10 cursor-pointer transition-colors text-left border-b border-[var(--border-secondary)] mb-1"
                title="Текущее значение ячейки"
              >
                <span className="text-green-600 dark:text-green-400 w-24 flex-shrink-0 truncate">{'📊'} {t('bulkReplace.mapSpecialCurrent')}</span>
                <code className="text-green-600 dark:text-green-400 font-mono font-semibold flex-shrink-0">{'{{value}}'}</code>
                <span className="text-[var(--text-tertiary)] flex-shrink-0">=</span>
                <span className="text-[var(--text-secondary)] truncate flex-1 text-right italic">{t('bulkReplace.mapSpecialCurrentDesc')}</span>
              </button>
              <button
                type="button"
                onClick={() => handleColumnClick('{{row_id}}')}
                className="w-full flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[var(--color-primary-500)]/10 cursor-pointer transition-colors text-left"
                title={`{{row_id}} = ${currentPreviewRow.id ?? t('bulkReplace.mapSpecialRowId')}`}
              >
                <span className="text-primary-600 dark:text-primary-400 w-24 flex-shrink-0">{'🆔'} {t('bulkReplace.mapSpecialRowId')}</span>
                <code className="text-primary-600 dark:text-primary-400 font-mono font-semibold flex-shrink-0">{'{{row_id}}'}</code>
                <span className="text-[var(--text-tertiary)] flex-shrink-0">=</span>
                <span className="text-[var(--text-secondary)] truncate flex-1 text-right">
                  {String(currentPreviewRow.id ?? '')}
                </span>
              </button>
            </>
          )}

          {/* Table columns */}
          {columns.map(col => {
            const value = currentPreviewRow[col.id] ?? currentPreviewRow[col.name];
            const variable = `{{${col.name}}}`;
            return (
              <button
                key={col.id}
                type="button"
                onClick={() => handleColumnClick(variable)}
                className="w-full flex items-center gap-2 py-1.5 px-2 rounded hover:bg-[var(--color-primary-500)]/10 cursor-pointer transition-colors text-left"
                title={`${variable} = ${String(value)} (${onInsertVariable ? t('bulkReplace.mapContextPaste') : t('bulkReplace.mapContextCopy')})`}
              >
                <span className="text-[var(--text-secondary)] w-24 flex-shrink-0 truncate" title={col.displayName || col.name}>
                  {col.displayName || col.name}
                </span>
                <code className="text-orange-600 dark:text-orange-400 font-mono font-semibold flex-shrink-0">{variable}</code>
                <span className="text-[var(--text-tertiary)] flex-shrink-0">=</span>
                <span className="text-[var(--text-secondary)] truncate flex-1 text-right">
                  {String(value ?? '')}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer with table info */}
      {tableInfo && (
        <div className="px-2.5 py-1.5 border-t border-[var(--border-primary)] flex-shrink-0 text-xs text-[var(--text-tertiary)]">
          {tableInfo.name} &bull; {tableInfo.key} &bull; ID: {tableInfo.id}
        </div>
      )}
    </div>
  );
};
