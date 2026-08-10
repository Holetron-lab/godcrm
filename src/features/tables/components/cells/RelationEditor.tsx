import { useRef, useEffect, useState, useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, X, ExternalLink, Search } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnRelationConfig } from '../../types/table.types';

interface RelationEditorProps {
  value: string;
  relation: ColumnRelationConfig;
  onChange: (value: string) => void;
  onCommit: (valueOverride?: string) => void;
  onCancel: () => void;
  onNavigateToRow?: (tableId: string, rowId: string, valueColumn?: string) => void;
}

// Цветовая палитра
const defaultColors = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
];

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
};

const getDefaultColor = (str: string, index: number) => 
  defaultColors[(hashString(str) + index) % defaultColors.length];

// Parse stored values
const parseStoredValues = (value: string, storageFormat?: string): string[] => {
  if (!value) return [];
  
  if (value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(v => String(v)).filter(Boolean);
    } catch { /* not JSON */ }
  }
  
  switch (storageFormat) {
    case 'comma': return value.split(',').map(v => v.trim()).filter(Boolean);
    case 'semicolon': return value.split(';').map(v => v.trim()).filter(Boolean);
    case 'newline': return value.split('\n').map(v => v.trim()).filter(Boolean);
    case 'single': return [value];
    default:
      if (value.includes(',')) return value.split(',').map(v => v.trim()).filter(Boolean);
      return [value].filter(Boolean);
  }
};

// Serialize values - default to comma-separated
const serializeValues = (values: string[], storageFormat?: string): string => {
  if (values.length === 0) return '';
  switch (storageFormat) {
    case 'json': return JSON.stringify(values);
    case 'semicolon': return values.join('; ');
    case 'newline': return values.join('\n');
    case 'single': return values[0] || '';
    case 'comma':
    default: return values.join(', '); // Default to comma-separated
  }
};

interface RelatedItem {
  value: string;
  label: string;
  description?: string;
  color?: string;
}

export const RelationEditor = ({
  value,
  relation,
  onChange,
  onCommit,
  onCancel,
  onNavigateToRow
}: RelationEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [showPicker, setShowPicker] = useState(true); // Open picker immediately
  const [search, setSearch] = useState('');
  const [pickerPosition, setPickerPosition] = useState<{ top: number; left: number } | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  
  // Track local value for immediate updates
  const [localValue, setLocalValue] = useState(value);
  
  // Update local value when prop changes
  useEffect(() => {
    setLocalValue(value);
  }, [value]);
  
  // Auto-position picker on mount
  useEffect(() => {
    if (containerRef.current && !pickerPosition) {
      const rect = containerRef.current.getBoundingClientRect();
      const pickerHeight = 400;
      const viewportHeight = window.innerHeight;
      
      let top = rect.bottom + 4;
      if (top + pickerHeight > viewportHeight) {
        top = Math.max(10, rect.top - pickerHeight - 4);
      }
      
      setPickerPosition({
        top: top + window.scrollY,
        left: Math.min(rect.left + window.scrollX, window.innerWidth - 320)
      });
    }
  }, [pickerPosition]);

  // Debounced server search state
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((term: string) => {
    setSearch(term);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearch(term);
    }, 300);
  }, []);

  // Parse row helper
  const parseRow = useCallback((row: Record<string, unknown>, index: number) => {
    const rowData = row.data && typeof row.data === 'object' ? row.data as Record<string, unknown> : row;
    const rowId = (row as { id?: string | number }).id;
    const originalId = (row as { originalId?: string | number }).originalId;

    let val: string;
    if (relation.valueColumn === 'id') {
      val = String(originalId ?? rowData['id'] ?? rowId ?? '');
    } else {
      val = String(rowData[relation.valueColumn] ?? '');
    }

    return {
      value: val,
      label: String(rowData[relation.labelColumn] ?? ''),
      description: relation.descriptionColumn ? String(rowData[relation.descriptionColumn] ?? '') || undefined : undefined,
      color: relation.colorColumn ? String(rowData[relation.colorColumn] ?? '') || getDefaultColor(val, index) : getDefaultColor(val, index),
      rowId: String(rowId ?? originalId ?? val)
    };
  }, [relation]);

  // Initial load — small batch for quick display
  const { data: initialItems = [], isLoading } = useQuery({
    queryKey: ['relation-editor-data', relation.tableId, relation.valueColumn, relation.labelColumn, relation.descriptionColumn],
    queryFn: async () => {
      if (!relation.tableId || !relation.valueColumn || !relation.labelColumn) return [];
      const response = await apiClient.request<{
        data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
      }>(`/tables/${relation.tableId}/rows?limit=50`);
      const rows = Array.isArray(response.data) ? response.data : response.data.rows || [];
      return rows.map((row, index) => parseRow(row, index));
    },
    enabled: Boolean(relation.tableId && relation.valueColumn && relation.labelColumn),
    staleTime: 60000,
  });

  // Server search — fires when debounced search term is set
  const { data: searchItems, isLoading: isSearching } = useQuery({
    queryKey: ['relation-editor-search', relation.tableId, relation.labelColumn, debouncedSearch],
    queryFn: async () => {
      if (!relation.tableId || !debouncedSearch) return [];
      const searchParam = encodeURIComponent(debouncedSearch);
      const searchCol = relation.labelColumn;
      const response = await apiClient.request<{
        data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
      }>(`/tables/${relation.tableId}/rows?limit=50&search=${searchParam}&searchColumns=${searchCol}`);
      const rows = Array.isArray(response.data) ? response.data : response.data.rows || [];
      return rows.map((row, index) => parseRow(row, index));
    },
    enabled: Boolean(relation.tableId && debouncedSearch.length > 0),
    staleTime: 30000,
  });

  // Use search results when searching, otherwise initial data
  const allItems = (debouncedSearch && searchItems) ? searchItems : initialItems;

  // Current selected values - use localValue for immediate updates
  const selectedValues = parseStoredValues(localValue, relation.storageFormat);
  
  // Map values to items
  const selectedItems = selectedValues.map((v, i) => {
    const found = allItems.find(item => item.value === v);
    return found || { value: v, label: v, color: getDefaultColor(v, i), rowId: v };
  });

  // Available items (not selected)
  const availableItems = allItems.filter(item => !selectedValues.includes(item.value));
  
  // When using server search, items are already filtered; otherwise filter client-side
  const filteredItems = debouncedSearch
    ? availableItems
    : availableItems.filter(item =>
        item?.label?.toLowerCase().includes(search.toLowerCase()) ||
        (item?.description?.toLowerCase().includes(search.toLowerCase()))
      );

  // Open picker
  const openPicker = useCallback(() => {
    if (addButtonRef.current) {
      const rect = addButtonRef.current.getBoundingClientRect();
      const pickerHeight = 380; // approximate height of picker
      const viewportHeight = window.innerHeight;
      
      // Check if picker would go below viewport
      let top = rect.bottom + 4;
      if (top + pickerHeight > viewportHeight) {
        // Position above the button instead
        top = Math.max(10, rect.top - pickerHeight - 4);
      }
      
      setPickerPosition({
        top: top + window.scrollY,
        left: Math.min(rect.left + window.scrollX, window.innerWidth - 320)
      });
    }
    setShowPicker(true);
    setSearch('');
  }, []);

  // Add item - only update local state, don't save yet
  const addItem = (item: RelatedItem) => {
    const isMultiple = relation.multiple !== false;
    const newValues = isMultiple ? [...selectedValues, item.value] : [item.value];
    const serialized = serializeValues(newValues, relation.storageFormat);
    logger.debug('[RelationEditor] addItem (local only):', { item: item.value, isMultiple, newValues, serialized });
    setLocalValue(serialized); // Only update local state, don't call onChange
  };

  // Remove item - only update local state, don't save yet
  const removeItem = (itemValue: string) => {
    const newValues = selectedValues.filter(v => v !== itemValue);
    const serialized = serializeValues(newValues, relation.storageFormat);
    logger.debug('[RelationEditor] removeItem (local only):', { itemValue, newValues, serialized });
    setLocalValue(serialized); // Only update local state, don't call onChange
  };

  // Navigate to row
  const handleNavigate = (item: { value: string; rowId?: string }) => {
    if (onNavigateToRow && relation.tableId) {
      // Pass the value and valueColumn so the modal can find the row
      onNavigateToRow(relation.tableId, item.value, relation.valueColumn);
    }
  };

  // Close on outside click - check both container and picker
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideContainer = containerRef.current?.contains(target);
      const isInsidePicker = pickerRef.current?.contains(target);
      
      // If click is outside both container and picker, close and save
      if (!isInsideContainer && !isInsidePicker) {
        logger.debug('[RelationEditor] outside click, committing with localValue:', localValue);
        setShowPicker(false);
        onCommit(localValue);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onCommit, localValue]);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showPicker) {
          setShowPicker(false);
        } else {
          onCancel();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, showPicker]);

  // Picker dropdown - new design with selected on top, available below
  const pickerDropdown = showPicker && pickerPosition ? createPortal(
    <div
      ref={pickerRef}
      className="fixed z-[9999] bg-[var(--bg-primary)] rounded-lg shadow-xl border border-[var(--border-primary)] flex flex-col"
      style={{ 
        top: pickerPosition.top,
        left: pickerPosition.left,
        width: '340px',
        maxHeight: '500px'
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* SELECTED ITEMS - Top Section */}
      <div className="flex-shrink-0">
        <div className="px-3 py-2 text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wide bg-[var(--bg-secondary)]">
          Выбрано ({selectedItems.length})
        </div>
        <div className="max-h-[150px] overflow-y-auto">
          {selectedItems.length === 0 ? (
            <div className="px-3 py-3 text-sm text-[var(--text-tertiary)] italic text-center">
              Ничего не выбрано
            </div>
          ) : (
            selectedItems.map((item, index) => (
              <div
                key={item.value || index}
                className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-secondary)] transition-colors group"
              >
                <div 
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {item.label}
                  </div>
                </div>
                <button
                  onClick={() => removeItem(item.value)}
                  className="flex-shrink-0 p-1 rounded hover:bg-red-500/20 transition-colors"
                  title="Удалить"
                >
                  <X className="w-4 h-4 text-red-400 hover:text-red-500" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      
      {/* DIVIDER */}
      <div className="h-px bg-[var(--border-primary)] mx-2" />
      
      {/* AVAILABLE ITEMS - Bottom Section */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Search */}
        <div className="px-3 py-2 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Поиск..."
              autoFocus
              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent"
            />
          </div>
        </div>
        
        <div className="px-3 py-1 text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wide">
          Доступно ({filteredItems.length})
        </div>
        
        {/* Available items list */}
        <div className="overflow-y-auto flex-1" style={{ maxHeight: '200px' }}>
          {(isLoading || isSearching) ? (
            <div className="px-3 py-4 text-center text-sm text-[var(--text-tertiary)]">
              {isSearching ? 'Поиск...' : 'Загрузка...'}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-[var(--text-tertiary)]">
              {search ? 'Ничего не найдено' : 'Все элементы уже выбраны'}
            </div>
          ) : (
            filteredItems.map((item, index) => (
              <div
                key={item.value || index}
                onClick={() => addItem(item)}
                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--bg-secondary)] transition-colors group"
              >
                <div 
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {item.label}
                  </div>
                  {item.description && (
                    <div className="text-xs text-[var(--text-tertiary)] truncate">
                      {item.description}
                    </div>
                  )}
                </div>
                <Plus className="w-4 h-4 text-green-400 flex-shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
              </div>
            ))
          )}
        </div>
      </div>
      
      {/* OK Button - always visible at bottom */}
      <div className="p-2 border-t border-[var(--border-secondary)] flex-shrink-0 bg-[var(--bg-primary)]">
        <button
          onClick={() => {
            setShowPicker(false);
            onCommit(localValue);
          }}
          className="w-full px-3 py-2 text-sm font-medium rounded-md bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] transition-colors"
        >
          OK — Сохранить
        </button>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div ref={containerRef} className="absolute inset-0 flex items-center gap-1 px-2 py-1 overflow-hidden">
      {/* Selected items as clickable cards */}
      <div className="flex-1 flex flex-wrap gap-1 overflow-auto max-h-full">
        {selectedItems.map((item, index) => (
          <div
            key={item.value || index}
            className="group inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-all hover:shadow-sm"
            style={{
              backgroundColor: `${item.color}15`,
              border: `1px solid ${item.color}40`,
            }}
          >
            {/* Clickable label - link to row */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleNavigate(item);
              }}
              className="flex items-center gap-1 hover:underline"
              style={{ color: item.color }}
              title="Открыть запись"
            >
              {item.label}
              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-60" />
            </button>
            
            {/* Remove button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeItem(item.value);
              }}
              className="ml-0.5 p-0.5 rounded hover:bg-black/10 transition-colors"
              title="Удалить"
            >
              <X className="w-3 h-3" style={{ color: item.color }} />
            </button>
          </div>
        ))}
      </div>
      
      {/* Add button */}
      <button
        ref={addButtonRef}
        onClick={(e) => {
          e.stopPropagation();
          openPicker();
        }}
        className="flex-shrink-0 p-1 rounded hover:bg-[var(--bg-secondary)] transition-colors"
        title="Добавить связь"
      >
        <Plus className="w-4 h-4 text-[var(--text-tertiary)]" />
      </button>
      
      {pickerDropdown}
    </div>
  );
};
