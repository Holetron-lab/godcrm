/**
 * RowBinding Component
 * ADR-024: Chat & Message Architecture
 * 
 * Universal row binding - bind chat to ANY row from ANY table
 * Replaces the old TaskSelector that was limited to "task tables"
 * 
 * Features:
 * - Select from any table in space
 * - Support multiple bindings
 * - Inline display of bound items
 * - Quick unbind
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { cn } from '@/shared/utils/cn';
import { 
  Link2, 
  Loader2, 
  Search, 
  X,
  ChevronDown,
  ChevronRight,
  Table2,
  Hash,
  Plus,
  Trash2,
  Unlink
} from 'lucide-react';

interface TableInfo {
  id: number;
  name: string;
  slug?: string;
  icon?: string;
  display_column?: string;
}

interface RowInfo {
  id: number;
  table_id: number;
  data: Record<string, unknown>;
  created_at?: string;
}

export interface BoundRow {
  table_id: number;
  row_id: number;
  table_name?: string;
  table_icon?: string;
  row_title?: string;
}

export interface RowBindingProps {
  spaceId?: number;
  defaultTableId?: number;
  boundRows?: BoundRow[];
  maxBindings?: number;
  compact?: boolean;
  onBind: (tableId: number, rowId: number, meta?: { tableName: string; rowTitle: string }) => void;
  onUnbind: (tableId: number, rowId: number) => void;
  className?: string;
}

export function RowBinding({
  spaceId,
  defaultTableId,
  boundRows = [],
  maxBindings = 10,
  compact = false,
  onBind,
  onUnbind,
  className
}: RowBindingProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTableId, setSelectedTableId] = useState<number | null>(defaultTableId ?? null);
  const [showTableSelector, setShowTableSelector] = useState(false);

  // Update selected table when defaultTableId changes
  useEffect(() => {
    if (defaultTableId && !selectedTableId) {
      setSelectedTableId(defaultTableId);
    }
  }, [defaultTableId]);

  // Fetch tables from space
  const { data: tables = [], isLoading: isLoadingTables } = useQuery({
    queryKey: ['tables-for-binding', spaceId],
    queryFn: async () => {
      if (!spaceId) return [];
      const response = await apiClient.get<{
        success: boolean;
        data: TableInfo[];
      }>(`/tables?spaceId=${spaceId}`);
      return response.success ? response.data : [];
    },
    enabled: !!spaceId && isExpanded
  });

  // Fetch rows from selected table
  const { data: tableRows = [], isLoading: isLoadingRows } = useQuery({
    queryKey: ['rows-for-binding', selectedTableId, searchQuery],
    queryFn: async () => {
      if (!selectedTableId) return [];
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      params.append('limit', '30');
      
      const response = await apiClient.get<{
        success: boolean;
        data: { rows: RowInfo[] };
      }>(`/tables/${selectedTableId}/rows?${params}`);
      return response.success ? response.data.rows : [];
    },
    enabled: !!selectedTableId && isExpanded
  });

  const selectedTable = tables.find(t => t.id === selectedTableId);

  // Get display value for a row
  const getRowDisplayValue = (row: RowInfo, table?: TableInfo) => {
    const displayColumn = table?.display_column || 'name';
    const data = row.data as Record<string, unknown>;
    return String(data[displayColumn] || data['title'] || data['name'] || data['subject'] || `#${row.id}`);
  };

  // Check if row is already bound
  const isRowBound = (tableId: number, rowId: number) => {
    return boundRows.some(br => br.table_id === tableId && br.row_id === rowId);
  };

  // Handle row selection
  const handleRowSelect = (row: RowInfo) => {
    if (isRowBound(row.table_id, row.id)) return;
    if (boundRows.length >= maxBindings) return;

    const table = tables.find(t => t.id === row.table_id);
    onBind(row.table_id, row.id, {
      tableName: table?.name || 'Unknown',
      rowTitle: getRowDisplayValue(row, table)
    });

    // Keep panel open for multi-bind
    setSearchQuery('');
  };

  const handleTableChange = (table: TableInfo) => {
    setSelectedTableId(table.id);
    setShowTableSelector(false);
    setSearchQuery('');
  };

  const canAddMore = boundRows.length < maxBindings;

  // Compact mode - just show bound items inline
  if (compact && boundRows.length > 0 && !isExpanded) {
    return (
      <div className={cn("flex items-center gap-1 flex-wrap", className)}>
        {boundRows.map((br, idx) => (
          <div
            key={`${br.table_id}-${br.row_id}-${idx}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-[var(--color-primary-50)] text-[var(--color-primary-700)] border border-[var(--color-primary-200)]"
          >
            <Link2 className="w-3 h-3" />
            <span className="max-w-24 truncate">{br.row_title || `#${br.row_id}`}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onUnbind(br.table_id, br.row_id);
              }}
              className="p-0.5 rounded-full hover:bg-[var(--color-primary-200)]"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        ))}
        {canAddMore && (
          <button
            onClick={() => setIsExpanded(true)}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)]"
          >
            <Plus className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn('border border-[var(--border-secondary)] rounded-lg overflow-hidden', className)}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors',
          boundRows.length > 0 
            ? 'bg-[var(--color-primary-50)] hover:bg-[var(--color-primary-100)]' 
            : 'hover:bg-[var(--bg-tertiary)]'
        )}
      >
        <Link2 className={cn(
          'w-4 h-4 flex-shrink-0',
          boundRows.length > 0 ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)]'
        )} />
        
        <div className="flex-1 min-w-0">
          {boundRows.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-[var(--color-primary-600)]">
                {boundRows.length} привязка(ок)
              </span>
              {boundRows.slice(0, 2).map((br, idx) => (
                <span 
                  key={`${br.table_id}-${br.row_id}-${idx}`}
                  className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-primary)] text-[var(--text-primary)] truncate max-w-20"
                >
                  {br.row_title || `#${br.row_id}`}
                </span>
              ))}
              {boundRows.length > 2 && (
                <span className="text-xs text-[var(--text-tertiary)]">
                  +{boundRows.length - 2}
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm text-[var(--text-tertiary)]">
              Привязать к записи...
            </span>
          )}
        </div>
        
        <ChevronRight className={cn(
          'w-4 h-4 text-[var(--text-tertiary)] transition-transform flex-shrink-0',
          isExpanded && 'rotate-90'
        )} />
      </button>

      {/* Expanded Panel */}
      {isExpanded && (
        <div className="border-t border-[var(--border-secondary)] p-3 bg-[var(--bg-secondary)]">
          {/* Bound Rows List */}
          {boundRows.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-medium text-[var(--text-tertiary)] mb-1.5">Привязанные записи</div>
              <div className="space-y-1">
                {boundRows.map((br, idx) => (
                  <div
                    key={`${br.table_id}-${br.row_id}-${idx}`}
                    className="flex items-center justify-between px-2 py-1.5 rounded bg-[var(--bg-primary)] text-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Hash className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
                      <span className="text-[var(--text-primary)] truncate">
                        {br.row_title || `#${br.row_id}`}
                      </span>
                      {br.table_name && (
                        <span className="text-[10px] px-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
                          {br.table_name}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => onUnbind(br.table_id, br.row_id)}
                      className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-red-500"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add New Binding */}
          {canAddMore && spaceId && (
            <div>
              <div className="text-xs font-medium text-[var(--text-tertiary)] mb-1.5">Добавить привязку</div>
              
              {/* Table Selector */}
              <div className="relative mb-2">
                <button
                  onClick={() => setShowTableSelector(!showTableSelector)}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)] text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Table2 className="w-4 h-4 text-[var(--text-tertiary)]" />
                    <span className={selectedTable ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}>
                      {selectedTable ? `${selectedTable.icon || '📋'} ${selectedTable.name}` : 'Выберите таблицу'}
                    </span>
                  </div>
                  <ChevronDown className={cn(
                    "w-4 h-4 text-[var(--text-tertiary)] transition-transform",
                    showTableSelector && "rotate-180"
                  )} />
                </button>

                {showTableSelector && (
                  <div className="absolute top-full left-0 right-0 mt-1 z-10 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded shadow-lg max-h-40 overflow-y-auto">
                    {isLoadingTables ? (
                      <div className="flex items-center justify-center py-3">
                        <Loader2 className="w-4 h-4 animate-spin" />
                      </div>
                    ) : tables.length === 0 ? (
                      <div className="py-3 text-center text-xs text-[var(--text-tertiary)]">
                        Нет таблиц
                      </div>
                    ) : (
                      tables.map(table => (
                        <button
                          key={table.id}
                          onClick={() => handleTableChange(table)}
                          className={cn(
                            "w-full flex items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-[var(--bg-tertiary)]",
                            table.id === selectedTableId && "bg-[var(--color-primary-50)]"
                          )}
                        >
                          <span>{table.icon || '📋'}</span>
                          <span className="text-[var(--text-primary)]">{table.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Row Search & List */}
              {selectedTableId && (
                <>
                  <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Поиск записей..."
                      className="w-full pl-8 pr-3 py-2 text-sm rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  <div className="max-h-48 overflow-y-auto rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]">
                    {isLoadingRows ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="w-4 h-4 animate-spin" />
                      </div>
                    ) : tableRows.length === 0 ? (
                      <div className="py-4 text-center text-xs text-[var(--text-tertiary)]">
                        {searchQuery ? 'Не найдено' : 'Нет записей'}
                      </div>
                    ) : (
                      tableRows.map(row => {
                        const bound = isRowBound(row.table_id, row.id);
                        return (
                          <button
                            key={row.id}
                            onClick={() => handleRowSelect(row)}
                            disabled={bound}
                            className={cn(
                              "w-full flex items-center gap-2 px-2.5 py-2 text-left text-sm border-b border-[var(--border-secondary)] last:border-0",
                              bound 
                                ? "opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]"
                                : "hover:bg-[var(--bg-tertiary)]"
                            )}
                          >
                            <Hash className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
                            <span className="text-[var(--text-primary)] flex-1 truncate">
                              {getRowDisplayValue(row, selectedTable)}
                            </span>
                            {bound && (
                              <span className="text-[10px] text-[var(--text-tertiary)]">
                                привязано
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Max bindings reached */}
          {!canAddMore && (
            <div className="text-xs text-[var(--text-tertiary)] text-center py-2">
              Достигнут лимит привязок ({maxBindings})
            </div>
          )}

          {/* No space selected */}
          {!spaceId && (
            <div className="text-xs text-[var(--text-tertiary)] text-center py-2">
              Выберите Space в настройках чата
            </div>
          )}

          {/* Close Button */}
          <button
            onClick={() => setIsExpanded(false)}
            className="w-full mt-3 px-3 py-1.5 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] rounded transition-colors"
          >
            Свернуть
          </button>
        </div>
      )}
    </div>
  );
}
