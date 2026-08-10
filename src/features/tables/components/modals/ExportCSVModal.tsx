import { Modal, Button } from '@/shared/components/ui';
import { Download, FileSpreadsheet } from 'lucide-react';
import { useState, useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import type { ColumnModel, RowModel } from '../../types/table.types';

export interface ExportSettings {
  useColumnKeys: boolean;  // true = column.name (key), false = column.displayName (label)
  useRawFormat: boolean;   // true = raw data, false = formatted for display
}

type ExportScope = 'selected' | 'filtered' | 'all';

interface ExportCSVModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  columns: ColumnModel[];
  filteredRows: RowModel[];
  allRows: RowModel[];
  selectedRowIds?: Set<string>;
  onExportFiltered: (settings: ExportSettings) => void;
  onExportAll: (settings: ExportSettings) => void;
  onExportSelected?: (settings: ExportSettings) => void;
}

export const ExportCSVModal = ({
  isOpen,
  onClose,
  tableName,
  columns,
  filteredRows,
  allRows,
  selectedRowIds,
  onExportFiltered,
  onExportAll,
  onExportSelected
}: ExportCSVModalProps) => {
  const selectedCount = selectedRowIds?.size || 0;
  const hasSelection = selectedCount > 0;
  const hasFilters = filteredRows.length !== allRows.length;
  
  // Export settings state
  const [scope, setScope] = useState<ExportScope>(hasSelection ? 'selected' : 'all');
  const [useColumnKeys, setUseColumnKeys] = useState(false);
  const [useRawFormat, setUseRawFormat] = useState(false);
  
  // Calculate rows count based on scope
  const rowsCount = useMemo(() => {
    switch (scope) {
      case 'selected': return selectedCount;
      case 'filtered': return filteredRows.length;
      case 'all': return allRows.length;
    }
  }, [scope, selectedCount, filteredRows.length, allRows.length]);
  
  // Scope options - always show all 3, disable if count is 0
  const scopeOptions = useMemo(() => {
    return [
      { value: 'selected' as ExportScope, label: 'Выделенным строкам', count: selectedCount },
      { value: 'filtered' as ExportScope, label: hasFilters ? 'Отфильтрованным строкам' : 'Видимым строкам', count: filteredRows.length },
      { value: 'all' as ExportScope, label: 'Всем строкам', count: allRows.length },
    ];
  }, [hasFilters, selectedCount, filteredRows.length, allRows.length]);

  const handleExport = () => {
    const settings: ExportSettings = { useColumnKeys, useRawFormat };
    
    switch (scope) {
      case 'selected':
        onExportSelected?.(settings);
        break;
      case 'filtered':
        onExportFiltered(settings);
        break;
      case 'all':
        onExportAll(settings);
        break;
    }
    onClose();
  };

  return (
    <Modal open={isOpen} onOpenChange={(open) => !open && onClose()} title="Экспорт в CSV" size="md">
      <div className="space-y-6">
        {/* Scope selector - radio buttons like BulkReplaceModal */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
            Применить к:
          </label>
          <div className="space-y-2">
            {scopeOptions.map(option => (
              <label 
                key={option.value} 
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg cursor-pointer transition",
                  scope === option.value 
                    ? "bg-[var(--color-primary-500)]/10 border border-[var(--color-primary-500)]/30"
                    : "hover:bg-[var(--bg-tertiary)] border border-transparent",
                  option.count === 0 && "opacity-50 cursor-not-allowed"
                )}
              >
                <input
                  type="radio"
                  name="exportScope"
                  value={option.value}
                  checked={scope === option.value}
                  onChange={() => option.count > 0 && setScope(option.value)}
                  disabled={option.count === 0}
                  className="w-4 h-4 text-[var(--color-primary-500)]"
                />
                <span className="text-sm text-[var(--text-primary)]">
                  {option.label}
                </span>
                <span className={cn(
                  "ml-auto px-2 py-0.5 rounded-full text-xs font-medium",
                  scope === option.value
                    ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-600)] dark:text-[var(--color-primary-400)]"
                    : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
                )}>
                  {option.count}
                </span>
              </label>
            ))}
          </div>
        </div>
        
        <hr className="border-[var(--border-primary)]" />
        
        {/* Column Headers Format - radio buttons in grid */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
            Заголовки колонок:
          </label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: false, label: 'Названия', hint: 'Имя, Email, Статус' },
              { value: true, label: 'Ключи', hint: 'name, email, status' },
            ].map(option => (
              <label 
                key={String(option.value)} 
                className={cn(
                  "flex items-center gap-2 p-3 rounded-lg cursor-pointer transition border",
                  useColumnKeys === option.value 
                    ? "bg-[var(--color-primary-500)]/10 border-[var(--color-primary-500)]/30"
                    : "hover:bg-[var(--bg-tertiary)] border-transparent"
                )}
              >
                <input
                  type="radio"
                  name="columnHeaders"
                  checked={useColumnKeys === option.value}
                  onChange={() => setUseColumnKeys(option.value)}
                  className="w-4 h-4 text-[var(--color-primary-500)]"
                />
                <div>
                  <span className="text-sm text-[var(--text-primary)]">{option.label}</span>
                  <span className="block text-xs text-[var(--text-tertiary)]">{option.hint}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Data Format - radio buttons in grid */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
            Формат данных:
          </label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: false, label: 'Форматированный', hint: 'Да/Нет, 01.01.2026' },
              { value: true, label: 'Raw', hint: '1/0, 2026-01-01' },
            ].map(option => (
              <label 
                key={String(option.value)} 
                className={cn(
                  "flex items-center gap-2 p-3 rounded-lg cursor-pointer transition border",
                  useRawFormat === option.value 
                    ? "bg-[var(--color-primary-500)]/10 border-[var(--color-primary-500)]/30"
                    : "hover:bg-[var(--bg-tertiary)] border-transparent"
                )}
              >
                <input
                  type="radio"
                  name="dataFormat"
                  checked={useRawFormat === option.value}
                  onChange={() => setUseRawFormat(option.value)}
                  className="w-4 h-4 text-[var(--color-primary-500)]"
                />
                <div>
                  <span className="text-sm text-[var(--text-primary)]">{option.label}</span>
                  <span className="block text-xs text-[var(--text-tertiary)]">{option.hint}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <hr className="border-[var(--border-primary)]" />

        {/* Footer with buttons */}
        <div className="flex justify-end gap-3">
          <Button
            onClick={onClose}
            variant="secondary"
          >
            Отмена
          </Button>
          <Button
            onClick={handleExport}
            variant="primary"
            className="gap-2"
          >
            <Download className="w-4 h-4" />
            Экспортировать ({rowsCount})
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// Helper function to format a cell value for display
const formatCellValue = (
  value: unknown,
  column: ColumnModel,
  useRawFormat: boolean
): string => {
  if (value === null || value === undefined) return '';
  
  // Raw format - return as-is with minimal processing
  if (useRawFormat) {
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (Array.isArray(value)) return JSON.stringify(value);
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
  
  // Formatted mode - transform values for readability
  switch (column.type) {
    case 'checkbox':
      return value ? 'Да' : 'Нет';
      
    case 'date':
    case 'datetime':
      if (typeof value === 'string' && value) {
        try {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            return column.type === 'datetime' 
              ? date.toLocaleString('ru-RU')
              : date.toLocaleDateString('ru-RU');
          }
        } catch {
          return String(value);
        }
      }
      return String(value);
      
    case 'select':
    case 'multi-select':
      if (column.config?.options && Array.isArray(column.config.options)) {
        const options = column.config.options as Array<{ value: string; label: string }>;
        if (Array.isArray(value)) {
          return value.map(v => {
            const opt = options.find(o => o.value === v);
            return opt?.label || v;
          }).join(', ');
        } else {
          const opt = options.find(o => o.value === value);
          return opt?.label || String(value);
        }
      }
      if (Array.isArray(value)) return value.join(', ');
      return String(value);
      
    case 'number':
    case 'integer':
    case 'float':
    case 'decimal':
      if (typeof value === 'number') {
        return value.toLocaleString('ru-RU');
      }
      return String(value);
      
    default:
      if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
      if (Array.isArray(value)) return value.join(', ');
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
  }
};

// Helper function to export rows to CSV with settings support
export const exportToCSV = (
  rows: RowModel[],
  columns: ColumnModel[],
  filename: string,
  settings?: ExportSettings
) => {
  const useColumnKeys = settings?.useColumnKeys ?? false;
  const useRawFormat = settings?.useRawFormat ?? false;
  
  // Build header row - use keys or display names
  const headers = columns.map(col => 
    useColumnKeys ? col.name : (col.displayName || col.name)
  );
  
  // Build data rows
  const dataRows = rows.map(row => {
    return columns.map(col => {
      const value = row.data[col.name] ?? row.data[col.id] ?? '';
      
      // Format the value based on settings
      const formatted = formatCellValue(value, col, useRawFormat);
      
      // Escape quotes and wrap in quotes if contains delimiter
      let str = formatted;
      if (str.includes(';') || str.includes('"') || str.includes('\n')) {
        str = '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    });
  });

  // Combine header and data
  const csvContent = [
    headers.join(';'),
    ...dataRows.map(row => row.join(';'))
  ].join('\n');

  // Add BOM for Excel UTF-8 support
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' });
  
  // Download
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
