/**
 * ChatSettings Component
 * ADR-024: Chat & Message Architecture
 * 
 * Settings panel for configuring chat bindings:
 * - Bind to Space (filter context)
 * - Bind to Table (default for row selection)
 * - Bind to Rows (multiple row bindings like Relations)
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { cn } from '@/shared/utils/cn';
import { 
  X, 
  Loader2, 
  Link2,
  Unlink,
  ChevronDown,
  Database,
  Table2,
  Hash,
  Plus,
  Trash2,
  Settings2
} from 'lucide-react';

interface Space {
  id: number;
  name: string;
  icon?: string;
}

interface TableInfo {
  id: number;
  name: string;
  slug?: string;
  icon?: string;
}

interface RowInfo {
  id: number;
  table_id: number;
  data: Record<string, unknown>;
}

interface BoundRow {
  table_id: number;
  row_id: number;
  table_name?: string;
  row_title?: string;
}

export interface ChatSettingsProps {
  conversationId?: number;
  spaceId?: number | null;
  boundRows?: BoundRow[];
  defaultTableId?: number | null;
  onSpaceChange: (spaceId: number | null) => void;
  onDefaultTableChange: (tableId: number | null) => void;
  onBindRow: (tableId: number, rowId: number) => void;
  onUnbindRow: (tableId: number, rowId: number) => void;
  onClose: () => void;
  className?: string;
}

export function ChatSettings({
  conversationId,
  spaceId,
  boundRows = [],
  defaultTableId,
  onSpaceChange,
  onDefaultTableChange,
  onBindRow,
  onUnbindRow,
  onClose,
  className
}: ChatSettingsProps) {
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(spaceId ?? null);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(defaultTableId ?? null);
  const [showSpaceSelector, setShowSpaceSelector] = useState(false);
  const [showTableSelector, setShowTableSelector] = useState(false);
  const [showRowSelector, setShowRowSelector] = useState(false);
  const [rowSearchQuery, setRowSearchQuery] = useState('');

  // Fetch spaces
  const { data: spaces = [], isLoading: isLoadingSpaces } = useQuery({
    queryKey: ['spaces'],
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data: Space[] }>('/spaces');
      return response.success ? response.data : [];
    }
  });

  // Fetch tables for selected space
  const { data: tables = [], isLoading: isLoadingTables } = useQuery({
    queryKey: ['tables', selectedSpaceId],
    queryFn: async () => {
      if (!selectedSpaceId) return [];
      const response = await apiClient.get<{ success: boolean; data: TableInfo[] }>(
        `/tables?spaceId=${selectedSpaceId}`
      );
      return response.success ? response.data : [];
    },
    enabled: !!selectedSpaceId
  });

  // Fetch rows for row selector
  const { data: tableRows = [], isLoading: isLoadingRows } = useQuery({
    queryKey: ['table-rows-for-binding', selectedTableId, rowSearchQuery],
    queryFn: async () => {
      if (!selectedTableId) return [];
      const params = new URLSearchParams();
      if (rowSearchQuery) params.append('search', rowSearchQuery);
      params.append('limit', '20');
      
      const response = await apiClient.get<{
        success: boolean;
        data: { rows: RowInfo[] };
      }>(`/tables/${selectedTableId}/rows?${params}`);
      return response.success ? response.data.rows : [];
    },
    enabled: !!selectedTableId && showRowSelector
  });

  const selectedSpace = spaces.find(s => s.id === selectedSpaceId);
  const selectedTable = tables.find(t => t.id === selectedTableId);

  const handleSpaceSelect = (space: Space | null) => {
    setSelectedSpaceId(space?.id ?? null);
    setSelectedTableId(null); // Reset table when space changes
    onSpaceChange(space?.id ?? null);
    setShowSpaceSelector(false);
  };

  const handleTableSelect = (table: TableInfo | null) => {
    setSelectedTableId(table?.id ?? null);
    onDefaultTableChange(table?.id ?? null);
    setShowTableSelector(false);
  };

  const handleRowBind = (row: RowInfo) => {
    if (selectedTableId) {
      onBindRow(selectedTableId, row.id);
    }
    setShowRowSelector(false);
    setRowSearchQuery('');
  };

  const getRowDisplayValue = (row: RowInfo) => {
    const data = row.data;
    return String(data['name'] || data['title'] || data['subject'] || `#${row.id}`);
  };

  // Check if row is already bound
  const isRowBound = (tableId: number, rowId: number) => {
    return boundRows.some(br => br.table_id === tableId && br.row_id === rowId);
  };

  return (
    <div className={cn(
      "border-b border-[var(--border-secondary)] bg-[var(--bg-secondary)]",
      className
    )}>
      <div className="p-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-[var(--text-tertiary)]" />
            <span className="text-sm font-medium text-[var(--text-primary)]">Настройки чата</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Space Binding */}
        <div className="mb-4">
          <label className="text-xs text-[var(--text-tertiary)] mb-1.5 block">
            Привязка к Space
          </label>
          <div className="relative">
            <button
              onClick={() => setShowSpaceSelector(!showSpaceSelector)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
            >
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-[var(--text-tertiary)]" />
                <span className={selectedSpace ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}>
                  {selectedSpace ? `${selectedSpace.icon || '📁'} ${selectedSpace.name}` : 'Не выбран'}
                </span>
              </div>
              <ChevronDown className={cn(
                "w-4 h-4 text-[var(--text-tertiary)] transition-transform",
                showSpaceSelector && "rotate-180"
              )} />
            </button>

            {showSpaceSelector && (
              <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                <button
                  onClick={() => handleSpaceSelect(null)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] text-sm text-[var(--text-tertiary)]"
                >
                  <Unlink className="w-4 h-4" />
                  Убрать привязку
                </button>
                {isLoadingSpaces ? (
                  <div className="flex items-center justify-center py-3">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                ) : (
                  spaces.map(space => (
                    <button
                      key={space.id}
                      onClick={() => handleSpaceSelect(space)}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] text-sm",
                        space.id === selectedSpaceId && "bg-[var(--color-primary-50)]"
                      )}
                    >
                      <span>{space.icon || '📁'}</span>
                      <span className="text-[var(--text-primary)]">{space.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Default Table */}
        {selectedSpaceId && (
          <div className="mb-4">
            <label className="text-xs text-[var(--text-tertiary)] mb-1.5 block">
              Таблица по умолчанию
            </label>
            <div className="relative">
              <button
                onClick={() => setShowTableSelector(!showTableSelector)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-sm"
              >
                <div className="flex items-center gap-2">
                  <Table2 className="w-4 h-4 text-[var(--text-tertiary)]" />
                  <span className={selectedTable ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}>
                    {selectedTable ? `${selectedTable.icon || '📋'} ${selectedTable.name}` : 'Не выбрана'}
                  </span>
                </div>
                <ChevronDown className={cn(
                  "w-4 h-4 text-[var(--text-tertiary)] transition-transform",
                  showTableSelector && "rotate-180"
                )} />
              </button>

              {showTableSelector && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  <button
                    onClick={() => handleTableSelect(null)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] text-sm text-[var(--text-tertiary)]"
                  >
                    <Unlink className="w-4 h-4" />
                    Убрать
                  </button>
                  {isLoadingTables ? (
                    <div className="flex items-center justify-center py-3">
                      <Loader2 className="w-4 h-4 animate-spin" />
                    </div>
                  ) : (
                    tables.map(table => (
                      <button
                        key={table.id}
                        onClick={() => handleTableSelect(table)}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] text-sm",
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
          </div>
        )}

        {/* Bound Rows */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-[var(--text-tertiary)]">
              Привязанные строки
            </label>
            {selectedTableId && (
              <button
                onClick={() => setShowRowSelector(!showRowSelector)}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-[var(--bg-tertiary)] text-[var(--color-primary-500)]"
              >
                <Plus className="w-3 h-3" />
                Добавить
              </button>
            )}
          </div>

          {/* Row selector dropdown */}
          {showRowSelector && selectedTableId && (
            <div className="mb-2 p-2 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-primary)]">
              <input
                type="text"
                value={rowSearchQuery}
                onChange={(e) => setRowSearchQuery(e.target.value)}
                placeholder="Поиск..."
                className="w-full px-2 py-1.5 text-sm rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] mb-2"
              />
              <div className="max-h-32 overflow-y-auto">
                {isLoadingRows ? (
                  <div className="flex items-center justify-center py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                ) : tableRows.length === 0 ? (
                  <div className="text-xs text-[var(--text-tertiary)] text-center py-2">
                    Нет строк
                  </div>
                ) : (
                  tableRows.map(row => {
                    const bound = isRowBound(row.table_id, row.id);
                    return (
                      <button
                        key={row.id}
                        onClick={() => !bound && handleRowBind(row)}
                        disabled={bound}
                        className={cn(
                          "w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm rounded",
                          bound 
                            ? "opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]"
                            : "hover:bg-[var(--bg-tertiary)]"
                        )}
                      >
                        <Hash className="w-3 h-3 text-[var(--text-tertiary)]" />
                        <span className="text-[var(--text-primary)] truncate">
                          {getRowDisplayValue(row)}
                        </span>
                        {bound && (
                          <span className="text-xs text-[var(--text-tertiary)] ml-auto">
                            привязано
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* List of bound rows */}
          {boundRows.length === 0 ? (
            <div className="text-xs text-[var(--text-tertiary)] py-2">
              Нет привязанных строк
            </div>
          ) : (
            <div className="space-y-1">
              {boundRows.map((br, idx) => (
                <div
                  key={`${br.table_id}-${br.row_id}-${idx}`}
                  className="flex items-center justify-between px-2 py-1.5 rounded bg-[var(--bg-tertiary)] text-sm"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Link2 className="w-3 h-3 text-[var(--color-primary-500)] flex-shrink-0" />
                    <span className="text-[var(--text-primary)] truncate">
                      {br.row_title || `#${br.row_id}`}
                    </span>
                    {br.table_name && (
                      <span className="text-xs text-[var(--text-tertiary)]">
                        ({br.table_name})
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => onUnbindRow(br.table_id, br.row_id)}
                    className="p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-red-500"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
