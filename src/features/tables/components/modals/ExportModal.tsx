/**
 * ExportModal - Unified export modal with JSON/CSV tabs
 * Combines ExportJSONModal and ExportCSVModal functionality
 */

import { logger } from '@/shared/utils/logger';
import { Modal, Button } from '@/shared/components/ui';
import { Download, FileJson2, FileSpreadsheet, AlertTriangle, Check, Shield, FileCode } from 'lucide-react';
import { useState, useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import { useQuery } from '@tanstack/react-query';
import type { ColumnModel, RowModel } from '../../types/table.types';

// Export types
export type ExportFormat = 'json' | 'csv';
export type ExportMode = 'full' | 'schema_only' | 'sanitized';
export type ExportScope = 'selected' | 'filtered' | 'all';

export interface ExportSettings {
  useColumnKeys: boolean;
  useRawFormat: boolean;
}

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableId: string;
  tableName: string;
  // For JSON export
  rowsCount: number;
  // For CSV export
  columns?: ColumnModel[];
  filteredRows?: RowModel[];
  allRows?: RowModel[];
  selectedRowIds?: Set<string>;
  onExportCSV?: (scope: ExportScope, settings: ExportSettings) => void;
  // Initial tab
  initialFormat?: ExportFormat;
}

export const ExportModal = ({
  isOpen,
  onClose,
  tableId,
  tableName,
  rowsCount,
  columns = [],
  filteredRows = [],
  allRows = [],
  selectedRowIds,
  onExportCSV,
  initialFormat = 'json',
}: ExportModalProps) => {
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const [isExporting, setIsExporting] = useState(false);

  // JSON export state
  const [jsonMode, setJsonMode] = useState<ExportMode>('full');

  // CSV export state
  const [csvScope, setCsvScope] = useState<ExportScope>('all');
  const [useColumnKeys, setUseColumnKeys] = useState(false);
  const [useRawFormat, setUseRawFormat] = useState(false);

  const selectedCount = selectedRowIds?.size || 0;
  const hasFilters = filteredRows.length !== allRows.length;

  // Fetch sensitive columns for JSON
  const { data: sensitiveInfo, isLoading: sensitiveLoading } = useQuery({
    queryKey: ['sensitiveColumns', tableId],
    queryFn: async () => {
      const res = await fetch(`/api/v3/tables/${tableId}/sensitive-columns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch sensitive columns');
      const json = await res.json();
      return json.data as {
        sensitiveColumns: string[];
        hasCredentials: boolean;
        recommendation: string;
      };
    },
    enabled: isOpen && !!tableId && format === 'json',
  });

  const hasSensitiveData = sensitiveInfo?.sensitiveColumns && sensitiveInfo.sensitiveColumns.length > 0;

  // JSON mode options
  const jsonModeOptions = useMemo(() => [
    {
      value: 'full' as ExportMode,
      label: 'Полный экспорт',
      description: 'Все данные включая конфиденциальные',
      icon: FileJson2,
      color: 'text-green-500',
      warning: hasSensitiveData,
    },
    {
      value: 'sanitized' as ExportMode,
      label: 'Без паролей/токенов',
      description: 'Скрывает конфиденциальные поля',
      icon: Shield,
      color: 'text-blue-500',
      warning: false,
    },
    {
      value: 'schema_only' as ExportMode,
      label: 'Только схема',
      description: 'Структура таблицы без данных',
      icon: FileCode,
      color: 'text-purple-500',
      warning: false,
    },
  ], [hasSensitiveData]);

  // CSV scope options
  const csvScopeOptions = useMemo(() => [
    { value: 'selected' as ExportScope, label: 'Выделенные строки', count: selectedCount },
    { value: 'filtered' as ExportScope, label: hasFilters ? 'Отфильтрованные' : 'Видимые', count: filteredRows.length },
    { value: 'all' as ExportScope, label: 'Все строки', count: allRows.length },
  ], [hasFilters, selectedCount, filteredRows.length, allRows.length]);

  // Handle JSON export
  const handleJSONExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch(`/api/v3/tables/${tableId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode: jsonMode }),
      });

      if (!res.ok) throw new Error('Export failed');

      const data = await res.json();
      const date = new Date().toISOString().slice(0, 10);
      const modeSuffix = jsonMode === 'full' ? '' : `_${jsonMode}`;
      const filename = `${tableName}${modeSuffix}_${date}.json`;

      const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      onClose();
    } catch (error) {
      logger.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  // Handle CSV export
  const handleCSVExport = () => {
    if (onExportCSV) {
      onExportCSV(csvScope, { useColumnKeys, useRawFormat });
      onClose();
    }
  };

  const handleExport = () => {
    if (format === 'json') {
      handleJSONExport();
    } else {
      handleCSVExport();
    }
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      title="Экспорт таблицы"
      size="md"
    >
      <div className="space-y-6">
        {/* Format tabs */}
        <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-lg">
          <button
            type="button"
            onClick={() => setFormat('json')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors",
              format === 'json'
                ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            )}
          >
            <FileJson2 className="w-4 h-4" />
            JSON
          </button>
          <button
            type="button"
            onClick={() => setFormat('csv')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors",
              format === 'csv'
                ? "bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            )}
          >
            <FileSpreadsheet className="w-4 h-4" />
            CSV
          </button>
        </div>

        {/* Table info */}
        <div className="flex items-center gap-3 p-3 bg-[var(--bg-secondary)] rounded-lg">
          {format === 'json' ? (
            <FileJson2 className="w-8 h-8 text-[var(--color-primary-500)]" />
          ) : (
            <FileSpreadsheet className="w-8 h-8 text-emerald-500" />
          )}
          <div>
            <div className="font-medium text-[var(--text-primary)]">{tableName}</div>
            <div className="text-sm text-[var(--text-tertiary)]">{rowsCount} строк</div>
          </div>
        </div>

        {/* JSON Options */}
        {format === 'json' && (
          <>
            {/* Sensitive data warning */}
            {hasSensitiveData && (
              <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium text-amber-600 dark:text-amber-400">
                    Обнаружены конфиденциальные данные
                  </div>
                  <div className="text-sm text-[var(--text-secondary)] mt-1">
                    Колонки: {sensitiveInfo!.sensitiveColumns.join(', ')}
                  </div>
                </div>
              </div>
            )}

            {/* Mode selector */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                Режим экспорта:
              </label>
              <div className="space-y-2">
                {jsonModeOptions.map(option => {
                  const Icon = option.icon;
                  return (
                    <label
                      key={option.value}
                      className={cn(
                        "flex items-center gap-3 p-3 rounded-lg cursor-pointer transition border",
                        jsonMode === option.value
                          ? "bg-[var(--color-primary-500)]/10 border-[var(--color-primary-500)]/30"
                          : "hover:bg-[var(--bg-tertiary)] border-transparent"
                      )}
                    >
                      <input
                        type="radio"
                        name="jsonMode"
                        value={option.value}
                        checked={jsonMode === option.value}
                        onChange={() => setJsonMode(option.value)}
                        className="w-4 h-4 text-[var(--color-primary-500)]"
                      />
                      <Icon className={cn("w-5 h-5", option.color)} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-[var(--text-primary)]">{option.label}</span>
                          {option.warning && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                        </div>
                        <span className="block text-xs text-[var(--text-tertiary)]">
                          {option.description}
                        </span>
                      </div>
                      {jsonMode === option.value && (
                        <Check className="w-5 h-5 text-[var(--color-primary-500)]" />
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* CSV Options */}
        {format === 'csv' && (
          <>
            {/* Scope selector */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                Экспортировать:
              </label>
              <div className="space-y-2">
                {csvScopeOptions.map(option => (
                  <label
                    key={option.value}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg cursor-pointer transition border",
                      csvScope === option.value
                        ? "bg-[var(--color-primary-500)]/10 border-[var(--color-primary-500)]/30"
                        : "hover:bg-[var(--bg-tertiary)] border-transparent",
                      option.count === 0 && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <input
                      type="radio"
                      name="csvScope"
                      value={option.value}
                      checked={csvScope === option.value}
                      onChange={() => option.count > 0 && setCsvScope(option.value)}
                      disabled={option.count === 0}
                      className="w-4 h-4 text-[var(--color-primary-500)]"
                    />
                    <span className="text-sm text-[var(--text-primary)]">{option.label}</span>
                    <span className={cn(
                      "ml-auto px-2 py-0.5 rounded-full text-xs font-medium",
                      csvScope === option.value
                        ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)]"
                        : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
                    )}>
                      {option.count}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Column headers format */}
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                Заголовки колонок:
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: false, label: 'Названия', hint: 'Имя, Email' },
                  { value: true, label: 'Ключи', hint: 'name, email' },
                ].map(option => (
                  <label
                    key={String(option.value)}
                    className={cn(
                      "flex flex-col p-3 rounded-lg cursor-pointer transition border",
                      useColumnKeys === option.value
                        ? "bg-[var(--color-primary-500)]/10 border-[var(--color-primary-500)]/30"
                        : "hover:bg-[var(--bg-tertiary)] border-transparent"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="columnKeys"
                        checked={useColumnKeys === option.value}
                        onChange={() => setUseColumnKeys(option.value)}
                        className="w-4 h-4 text-[var(--color-primary-500)]"
                      />
                      <span className="text-sm text-[var(--text-primary)]">{option.label}</span>
                    </div>
                    <span className="text-xs text-[var(--text-tertiary)] mt-1 ml-6">{option.hint}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        <hr className="border-[var(--border-primary)]" />

        {/* Footer */}
        <div className="flex justify-end gap-3">
          <Button onClick={onClose} variant="secondary">
            Отмена
          </Button>
          <Button
            onClick={handleExport}
            variant="primary"
            className="gap-2"
            disabled={isExporting || (format === 'json' && sensitiveLoading)}
          >
            <Download className="w-4 h-4" />
            {isExporting ? 'Экспорт...' : 'Экспортировать'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ExportModal;
