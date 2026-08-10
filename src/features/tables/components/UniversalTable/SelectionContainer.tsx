import { useState, useMemo } from 'react';
import { Container, ChevronDown, X, CheckSquare, ArrowUpToLine, ArrowDownToLine, Minus, Copy, Check, Trash2 } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { SelectionSortMode } from '../../types/selection.types';
import type { ColumnModel } from '../../types/table.types';

interface SelectionContainerProps {
  selectedCount: number;
  selectionSort: SelectionSortMode;
  onSortChange: (sort: SelectionSortMode) => void;
  onClearSelection: () => void;
  onSelectAllFiltered: () => void;
  onDeleteSelected?: () => void;
  filteredCount: number;
  totalCount: number;
  columns?: ColumnModel[];
  selectedRowIds?: Set<string>;
  rows?: Array<{ id: string; data: Record<string, unknown> }>;
  readOnly?: boolean;
}

/**
 * Контейнер выделенных строк с dropdown для сортировки
 */
export const SelectionContainer = ({ 
  selectedCount, 
  selectionSort, 
  onSortChange,
  onClearSelection,
  onSelectAllFiltered,
  onDeleteSelected,
  filteredCount,
  totalCount,
  columns = [],
  selectedRowIds,
  rows = [],
  readOnly = false
}: SelectionContainerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedColumnId, setSelectedColumnId] = useState<string>('');
  const [copied, setCopied] = useState(false);
  
  // Don't render if nothing selected
  if (selectedCount === 0) return null;

  // Get selected rows data
  const selectedRows = useMemo(() => {
    if (!selectedRowIds || !rows.length) return [];
    return rows.filter(row => selectedRowIds.has(row.id));
  }, [selectedRowIds, rows]);

  // Copy array of values for selected column
  const handleCopyArray = () => {
    if (!selectedColumnId || !selectedRows.length) return;
    
    const column = columns.find(c => c.id === selectedColumnId);
    if (!column) return;
    
    const values = selectedRows.map(row => {
      const value = row.data[column.name] ?? row.data[column.id];
      return value !== null && value !== undefined ? String(value) : '';
    }).filter(v => v !== '');
    
    const arrayText = JSON.stringify(values);
    navigator.clipboard.writeText(arrayText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  
  const sortOptions: Array<{ value: SelectionSortMode; label: string; icon: React.ReactNode }> = [
    { value: 'default', label: 'По умолчанию', icon: <Minus className="w-4 h-4" /> },
    { value: 'selected-first', label: 'Выделенные сверху', icon: <ArrowUpToLine className="w-4 h-4" /> },
    { value: 'selected-last', label: 'Выделенные снизу', icon: <ArrowDownToLine className="w-4 h-4" /> },
  ];
  
  const currentSortOption = sortOptions.find(opt => opt.value === selectionSort);
  
  return (
    <div className="relative" data-testid="selection-container">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-1.5 min-w-[80px]",
          "bg-[var(--color-primary-500)]/10 border-[var(--color-primary-500)]/30",
          "hover:bg-[var(--color-primary-500)]/20"
        )}
      >
        <Container className="w-4 h-4 text-[var(--color-primary-500)]" />
        <span className="font-semibold text-[var(--color-primary-600)] dark:text-[var(--color-primary-400)]">
          {selectedCount}
        </span>
        <ChevronDown className={cn(
          "w-3 h-3 transition-transform text-[var(--color-primary-500)]",
          isOpen && "rotate-180"
        )} />
      </Button>
      
      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-[9998]" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown content */}
          <div className={cn(
            "absolute top-full left-0 mt-1 z-[9999]",
            "w-72 p-3 rounded-lg shadow-xl",
            "bg-[var(--bg-secondary)] border border-[var(--border-primary)]",
            "animate-in fade-in slide-in-from-top-1 duration-150"
          )}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-[var(--border-primary)]">
              <span className="text-sm font-medium text-[var(--text-primary)]">
                Выбрано: {selectedCount} {selectedCount === 1 ? 'строка' : 
                  selectedCount < 5 ? 'строки' : 'строк'}
              </span>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 rounded hover:bg-[var(--bg-tertiary)] transition"
              >
                <X className="w-4 h-4 text-[var(--text-tertiary)]" />
              </button>
            </div>
            
            {/* Sort options */}
            <div className="mb-3">
              <p className="text-xs text-[var(--text-tertiary)] mb-2 uppercase tracking-wide">
                Сортировка
              </p>
              <div className="space-y-1">
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      onSortChange(option.value);
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition",
                      selectionSort === option.value
                        ? "bg-[var(--color-primary-500)]/15 text-[var(--color-primary-600)] dark:text-[var(--color-primary-400)]"
                        : "hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded-full border-2 flex items-center justify-center",
                      selectionSort === option.value 
                        ? "border-[var(--color-primary-500)] bg-[var(--color-primary-500)]"
                        : "border-[var(--border-primary)]"
                    )}>
                      {selectionSort === option.value && (
                        <div className="w-1.5 h-1.5 rounded-full bg-white" />
                      )}
                    </div>
                    {option.icon}
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
            
            {/* Actions */}
            <div className="space-y-2 pt-2 border-t border-[var(--border-primary)]">
              <button
                onClick={() => {
                  onClearSelection();
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition",
                  "hover:bg-red-500/10 text-red-500"
                )}
              >
                <X className="w-4 h-4" />
                <span>Снять выделение</span>
              </button>
              
              {/* Delete selected rows */}
              {!readOnly && onDeleteSelected && (
                <button
                  onClick={() => {
                    onDeleteSelected();
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition",
                    "hover:bg-red-500/10 text-red-500"
                  )}
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Удалить ({selectedCount})</span>
                </button>
              )}
              
              {filteredCount > selectedCount && (
                <button
                  onClick={() => {
                    onSelectAllFiltered();
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition",
                    "hover:bg-[var(--color-primary-500)]/10 text-[var(--color-primary-600)] dark:text-[var(--color-primary-400)]"
                  )}
                >
                  <CheckSquare className="w-4 h-4" />
                  <span>Выбрать все отфильтрованные ({filteredCount})</span>
                </button>
              )}
            </div>
            
            {/* Copy Array Section */}
            {columns.length > 0 && selectedRows.length > 0 && (
              <div className="space-y-2 pt-3 mt-3 border-t border-[var(--border-primary)]">
                <p className="text-xs text-[var(--text-tertiary)] uppercase tracking-wide">
                  Копировать массив
                </p>
                <select
                  value={selectedColumnId}
                  onChange={(e) => setSelectedColumnId(e.target.value)}
                  className={cn(
                    "w-full px-3 py-2 rounded-md text-sm",
                    "bg-[var(--bg-tertiary)] border border-[var(--border-primary)]",
                    "text-[var(--text-primary)]",
                    "focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/50"
                  )}
                >
                  <option value="">Выберите колонку...</option>
                  {columns.filter(c => c.isVisible !== false).map(col => (
                    <option key={col.id} value={col.id}>
                      {col.config?.appearance?.indicator?.value || '📋'} {col.displayName || col.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleCopyArray}
                  disabled={!selectedColumnId}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition",
                    selectedColumnId
                      ? "bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)]"
                      : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] cursor-not-allowed"
                  )}
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Скопировано!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Копировать массив ({selectedRows.length})</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
