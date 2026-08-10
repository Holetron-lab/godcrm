import { useRef, useEffect, useState, useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { CellPortal } from '@/shared/components/ui/CellPortal';
import type { ColumnOption, ColumnRelationConfig } from '../../types/table.types';

interface SelectEditorProps {
  value: string;
  options: ColumnOption[];
  relation?: ColumnRelationConfig;
  onChange: (value: string) => void;
  onCommit: (valueOverride?: string) => void;
  onCancel: () => void;
  multiple?: boolean;
}

// Parse value to array based on storage format
const parseStoredValues = (value: string, storageFormat?: string): string[] => {
  if (!value) return [];
  
  // Try JSON parse first
  if (value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map(v => String(v)).filter(Boolean);
      }
    } catch {
      // Not valid JSON
    }
  }
  
  // Based on storage format
  switch (storageFormat) {
    case 'comma':
      return value.split(',').map(v => v.trim()).filter(Boolean);
    case 'semicolon':
      return value.split(';').map(v => v.trim()).filter(Boolean);
    case 'newline':
      return value.split('\n').map(v => v.trim()).filter(Boolean);
    case 'single':
      return [value];
    case 'json':
    default:
      // Auto-detect for backwards compatibility
      if (value.includes(',')) {
        return value.split(',').map(v => v.trim()).filter(Boolean);
      }
      return [value].filter(Boolean);
  }
};

// Serialize array to string based on storage format - default to comma
const serializeValues = (values: string[], storageFormat?: string): string => {
  switch (storageFormat) {
    case 'json':
      return JSON.stringify(values);
    case 'semicolon':
      return values.join('; ');
    case 'newline':
      return values.join('\n');
    case 'single':
      return values[0] || '';
    case 'comma':
    default:
      return values.join(', '); // Default to comma-separated
  }
};

// Цветовая палитра для опций без цвета
const defaultColors = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
];

const getDefaultColor = (index: number) => defaultColors[index % defaultColors.length];

export const SelectEditor = ({
  value,
  options,
  relation,
  onChange,
  onCommit,
  onCancel,
  multiple = false
}: SelectEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((term: string) => {
    setSearch(term);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(term);
    }, 300);
  }, []);

  // Helper to parse API row
  const parseApiRow = useCallback((row: Record<string, unknown>) => {
    const rowData = row.data && typeof row.data === 'object' ? row.data as Record<string, unknown> : row;
    const rowId = (row as { id?: string | number }).id;
    const originalId = (row as { originalId?: string | number }).originalId;

    let val: string;
    if (relation?.valueColumn === 'id') {
      val = String(originalId ?? rowData['id'] ?? rowId ?? '');
    } else {
      val = String(rowData[relation?.valueColumn ?? 'id'] ?? '');
    }

    return {
      value: val,
      label: String(rowData[relation?.labelColumn ?? 'name'] ?? ''),
      color: relation?.colorColumn ? String(rowData[relation.colorColumn] ?? '') || undefined : undefined,
      originalId: originalId !== undefined && originalId !== null ? String(originalId) : undefined,
      internalId: rowId !== undefined && rowId !== null ? String(rowId) : undefined
    };
  }, [relation]);

  // Initial load — small batch for quick display
  const { data: relationOptions = [], isLoading } = useQuery({
    queryKey: ['relation-options', relation?.tableId, relation?.valueColumn, relation?.labelColumn],
    queryFn: async () => {
      if (!relation?.enabled || !relation.tableId || !relation.valueColumn || !relation.labelColumn) {
        return [];
      }
      const response = await apiClient.request<{
        data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
      }>(`/tables/${relation.tableId}/rows?limit=50`);
      const rows = Array.isArray(response.data) ? response.data : response.data.rows || [];
      const parsed = rows.map(row => parseApiRow(row));
      logger.debug('[SelectEditor] Initial options loaded:', parsed.length);
      return parsed;
    },
    enabled: Boolean(relation?.enabled && relation?.tableId && relation?.valueColumn && relation?.labelColumn),
    staleTime: 60000,
  });

  // Server search — fires when debounced search term is set
  const { data: searchOptions, isLoading: isSearching } = useQuery({
    queryKey: ['select-editor-search', relation?.tableId, relation?.labelColumn, debouncedSearch],
    queryFn: async () => {
      if (!relation?.enabled || !relation.tableId || !debouncedSearch) return [];
      const searchParam = encodeURIComponent(debouncedSearch);
      const searchCol = relation.labelColumn;
      const response = await apiClient.request<{
        data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
      }>(`/tables/${relation.tableId}/rows?limit=50&search=${searchParam}&searchColumns=${searchCol}`);
      const rows = Array.isArray(response.data) ? response.data : response.data.rows || [];
      return rows.map(row => parseApiRow(row));
    },
    enabled: Boolean(relation?.enabled && relation?.tableId && debouncedSearch.length > 0),
    staleTime: 30000,
  });
  
  // Use search results when searching, otherwise initial data
  const activeRelationOptions = (relation?.enabled && debouncedSearch && searchOptions) ? searchOptions : relationOptions;

  // Используем relation опции если включены, иначе ручные
  const effectiveOptions = relation?.enabled ? activeRelationOptions : (options || []);

  // When using server search, items are already filtered; otherwise filter client-side
  const filteredOptions = (relation?.enabled && debouncedSearch)
    ? effectiveOptions
    : effectiveOptions.filter(opt =>
        opt?.label?.toLowerCase().includes(search.toLowerCase())
      );
  
  // Добавляем опцию "Не выбрано"
  const allOptions = [
    { value: '', label: '— Не выбрано —', color: undefined },
    ...filteredOptions
  ];
  
  useEffect(() => {
    searchRef.current?.focus();
  }, []);
  
  // Закрытие при клике вне
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onCommit();
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onCommit]);
  
  // Обработка клавиатуры
  const handleKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setHighlightedIndex(prev => Math.min(prev + 1, allOptions.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setHighlightedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        event.preventDefault();
        if (allOptions[highlightedIndex]) {
          const selectedValue = allOptions[highlightedIndex].value;
          onChange(selectedValue);
          onCommit(selectedValue);
        }
        break;
      case 'Escape':
        event.preventDefault();
        onCancel();
        break;
    }
  };
  
  const handleSelect = (optValue: string) => {
    onChange(optValue);
    onCommit(optValue);
  };
  
  if ((isLoading || isSearching) && relation?.enabled) {
    return (
      <div className="h-full w-full flex items-center px-2 py-1 text-sm text-[var(--text-tertiary)]">
        <div className="animate-pulse flex gap-2 items-center">
          <div className="w-4 h-4 rounded-full bg-[var(--bg-tertiary)]" />
          <span>Загрузка...</span>
        </div>
      </div>
    );
  }
  
  // Dropdown content via CellPortal (viewport-aware positioning)
  
  // Находим label текущего выбранного значения
  const currentOption = effectiveOptions.find(opt => opt.value === value);
  const currentLabel = currentOption?.label || value;
  
  // Для множественного выбора - показываем кол-во
  const selectedCount = multiple ? parseStoredValues(value, relation?.storageFormat).length : 0;
  
  return (
    <>
      {/* Trigger element with current value shown in gray */}
      <div className="absolute inset-0 flex items-center px-4 py-2">
        {value && (
          <span className="text-sm text-[var(--text-tertiary)] opacity-60 truncate">
            {multiple ? `Выбрано: ${selectedCount}` : currentLabel}
          </span>
        )}
      </div>
      {/* Dropdown via CellPortal - viewport-aware positioning */}
      <CellPortal
        ref={containerRef}
        width={280}
        maxHeight={300}
        className="bg-[var(--bg-primary)] rounded-lg shadow-xl border border-[var(--border-primary)] overflow-hidden"
      >
        {/* Поиск */}
        <div className="p-2 border-b border-[var(--border-secondary)]">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => {
              handleSearchChange(e.target.value);
              if (!multiple) setHighlightedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Поиск..."
            className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent"
          />
        </div>

        {/* Multi-select: выбранные теги */}
        {multiple && value && (
          <div className="p-2 border-b border-[var(--border-secondary)] flex flex-wrap gap-1">
            {parseStoredValues(value, relation?.storageFormat).map(sv => {
              const opt = effectiveOptions.find(o => o.value === sv);
              const color = opt?.color || '#6366f1';
              return (
                <span
                  key={sv}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer hover:opacity-80"
                  style={{
                    backgroundColor: `${color}20`,
                    color: color,
                    border: `1px solid ${color}40`
                  }}
                  onClick={() => {
                    const currentValues = parseStoredValues(value, relation?.storageFormat);
                    const newValues = currentValues.filter(v => v !== sv);
                    onChange(serializeValues(newValues, relation?.storageFormat));
                  }}
                >
                  {opt?.label || sv}
                  <span className="text-[10px] opacity-60">✕</span>
                </span>
              );
            })}
          </div>
        )}

        {/* Опции */}
        <div className="overflow-y-auto py-1" style={{ maxHeight: '250px' }}>
          {(multiple ? filteredOptions : allOptions).map((opt, index) => {
            const selectedValues = multiple ? parseStoredValues(value, relation?.storageFormat) : [value];
            const isSelected = multiple ? selectedValues.includes(opt.value) : opt.value === value;
            const isHighlighted = !multiple && index === highlightedIndex;
            const color = opt.color || ((!multiple && index === 0) ? undefined : getDefaultColor(multiple ? index : index - 1));

            return (
              <div
                key={opt.value || `__empty_${index}__`}
                onClick={() => {
                  if (multiple) {
                    if (isSelected) {
                      const newValues = selectedValues.filter(v => v !== opt.value);
                      onChange(serializeValues(newValues, relation?.storageFormat));
                    } else {
                      const newValues = [...selectedValues.filter(Boolean), opt.value];
                      onChange(serializeValues(newValues, relation?.storageFormat));
                    }
                  } else {
                    handleSelect(opt.value);
                  }
                }}
                onMouseEnter={() => !multiple && setHighlightedIndex(index)}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${
                  isHighlighted ? 'bg-[var(--bg-secondary)]' : ''
                } ${isSelected ? 'bg-[var(--color-primary-500)]/10' : 'hover:bg-[var(--bg-secondary)]'}`}
              >
                {/* Чекбокс/чекмарк */}
                <div className="w-4 flex-shrink-0">
                  {multiple ? (
                    <div
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                        isSelected ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]' : 'border-[var(--border-primary)]'
                      }`}
                    >
                      {isSelected && <span className="text-white text-xs">✓</span>}
                    </div>
                  ) : isSelected ? (
                    <span className="text-[var(--color-primary-500)] text-sm">✓</span>
                  ) : null}
                </div>

                {/* Опция */}
                {opt.value === '' ? (
                  <span className="text-sm text-[var(--text-tertiary)]">{opt.label}</span>
                ) : (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-transform hover:scale-105"
                      style={{
                        backgroundColor: color ? `${color}20` : 'var(--bg-tertiary)',
                        color: color || 'var(--text-secondary)',
                        border: `1px solid ${color ? `${color}40` : 'var(--border-primary)'}`
                      }}
                    >
                      {opt.label}
                    </span>
                    {(opt as Record<string, unknown>).originalId && (
                      <span className="text-[10px] text-[var(--text-tertiary)] opacity-60 font-mono truncate">
                        {String((opt as Record<string, unknown>).originalId)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {filteredOptions.length === 0 && search && (
            <div className="px-3 py-4 text-center text-sm text-[var(--text-tertiary)]">
              Ничего не найдено
            </div>
          )}
        </div>

        {/* Кнопка "Готово" для множественного выбора */}
        {multiple && (
          <div className="p-2 border-t border-[var(--border-secondary)]">
            <button
              onClick={() => onCommit()}
              className="w-full px-3 py-1.5 text-sm font-medium rounded-md bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] transition-colors"
            >
              Готово
            </button>
          </div>
        )}
      </CellPortal>
    </>
  );
};
