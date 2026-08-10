/**
 * ChatBindingSettings Component
 * ADR-024: Chat & Message Architecture Redesign
 * 
 * Settings panel for configuring chat bindings:
 * - Default space/table for task binding
 * - Current row bindings (multiple rows allowed)
 * - Participant management
 */

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { cn } from '@/shared/utils/cn';
import { 
  Settings,
  Link2,
  Unlink,
  Table2,
  FolderOpen,
  Hash,
  Plus,
  X,
  Check,
  ChevronDown,
  Search,
  Loader2
} from 'lucide-react';

interface Space {
  id: number;
  name: string;
  icon?: string;
}

interface Table {
  id: number;
  name: string;
  slug: string;
  icon?: string;
  display_column?: string;
}

interface Row {
  id: number;
  data: Record<string, unknown>;
  table_id: number;
}

interface RowBinding {
  tableId: number;
  tableName: string;
  rowId: number;
  rowDisplay: string;
}

export interface ChatBindingConfig {
  defaultSpaceId?: number;
  defaultTableId?: number;
  bindings: RowBinding[];
}

export interface ChatBindingSettingsProps {
  config: ChatBindingConfig;
  onConfigChange: (config: ChatBindingConfig) => void;
  currentSpaceId?: number;
  className?: string;
}

export function ChatBindingSettings({
  config,
  onConfigChange,
  currentSpaceId,
  className
}: ChatBindingSettingsProps) {
  const [isAddingBinding, setIsAddingBinding] = useState(false);
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(
    config.defaultSpaceId || currentSpaceId || null
  );
  const [selectedTableId, setSelectedTableId] = useState<number | null>(
    config.defaultTableId || null
  );
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch spaces
  const { data: spaces = [], isLoading: isLoadingSpaces } = useQuery({
    queryKey: ['spaces'],
    queryFn: async () => {
      const response = await apiClient.get<{
        success: boolean;
        data: Space[];
      }>('/spaces');
      return response.success ? response.data : [];
    }
  });

  // Fetch tables for selected space
  const { data: tables = [], isLoading: isLoadingTables } = useQuery({
    queryKey: ['tables', selectedSpaceId],
    queryFn: async () => {
      if (!selectedSpaceId) return [];
      const response = await apiClient.get<{
        success: boolean;
        data: Table[];
      }>(`/tables?spaceId=${selectedSpaceId}`);
      return response.success ? response.data : [];
    },
    enabled: !!selectedSpaceId
  });

  // Fetch rows for selected table
  const { data: rows = [], isLoading: isLoadingRows } = useQuery({
    queryKey: ['rows', selectedTableId, searchQuery],
    queryFn: async () => {
      if (!selectedTableId) return [];
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      params.append('limit', '20');
      
      const response = await apiClient.get<{
        success: boolean;
        data: { rows: Row[] };
      }>(`/tables/${selectedTableId}/rows?${params}`);
      return response.success ? response.data.rows : [];
    },
    enabled: !!selectedTableId && isAddingBinding
  });

  // Get display value for a row
  const getRowDisplay = (row: Row, table?: Table): string => {
    const displayColumn = table?.display_column || 'name';
    const data = row.data;
    return String(data[displayColumn] || data['title'] || data['name'] || `#${row.id}`);
  };

  // Handle adding a binding
  const handleAddBinding = (row: Row) => {
    const table = tables.find(t => t.id === selectedTableId);
    if (!table) return;

    const newBinding: RowBinding = {
      tableId: table.id,
      tableName: table.name,
      rowId: row.id,
      rowDisplay: getRowDisplay(row, table)
    };

    // Check if already bound
    const exists = config.bindings.some(
      b => b.tableId === newBinding.tableId && b.rowId === newBinding.rowId
    );
    if (exists) return;

    onConfigChange({
      ...config,
      bindings: [...config.bindings, newBinding]
    });
    setIsAddingBinding(false);
    setSearchQuery('');
  };

  // Handle removing a binding
  const handleRemoveBinding = (binding: RowBinding) => {
    onConfigChange({
      ...config,
      bindings: config.bindings.filter(
        b => !(b.tableId === binding.tableId && b.rowId === binding.rowId)
      )
    });
  };

  // Handle default space change
  const handleDefaultSpaceChange = (spaceId: number) => {
    setSelectedSpaceId(spaceId);
    setSelectedTableId(null);
    onConfigChange({
      ...config,
      defaultSpaceId: spaceId,
      defaultTableId: undefined
    });
  };

  // Handle default table change
  const handleDefaultTableChange = (tableId: number) => {
    setSelectedTableId(tableId);
    onConfigChange({
      ...config,
      defaultTableId: tableId
    });
  };

  return (
    <div className={cn('space-y-4', className)}>
      {/* Default Binding Settings */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Settings className="w-4 h-4" />
          Настройки привязки
        </h4>

        {/* Default Space */}
        <div className="space-y-1">
          <label className="text-xs text-gray-500">Пространство по умолчанию</label>
          <div className="relative">
            <select
              value={selectedSpaceId || ''}
              onChange={(e) => handleDefaultSpaceChange(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg appearance-none cursor-pointer pr-8"
            >
              <option value="">Выберите пространство...</option>
              {spaces.map(space => (
                <option key={space.id} value={space.id}>
                  {space.icon || '📁'} {space.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Default Table */}
        {selectedSpaceId && (
          <div className="space-y-1">
            <label className="text-xs text-gray-500">Таблица задач по умолчанию</label>
            <div className="relative">
              <select
                value={selectedTableId || ''}
                onChange={(e) => handleDefaultTableChange(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg appearance-none cursor-pointer pr-8"
                disabled={isLoadingTables}
              >
                <option value="">Выберите таблицу...</option>
                {tables.map(table => (
                  <option key={table.id} value={table.id}>
                    {table.icon || '📋'} {table.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
        )}
      </div>

      {/* Current Bindings */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Link2 className="w-4 h-4" />
            Привязанные записи
          </h4>
          <button
            onClick={() => setIsAddingBinding(true)}
            className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Добавить
          </button>
        </div>

        {/* Bindings List */}
        {config.bindings.length === 0 ? (
          <p className="text-xs text-gray-400 italic py-2">
            Нет привязанных записей
          </p>
        ) : (
          <div className="space-y-1">
            {config.bindings.map((binding, index) => (
              <div
                key={`${binding.tableId}-${binding.rowId}`}
                className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Table2 className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-500 flex-shrink-0">{binding.tableName}</span>
                  <span className="text-gray-300 dark:text-gray-600">/</span>
                  <span className="truncate font-medium">{binding.rowDisplay}</span>
                </div>
                <button
                  onClick={() => handleRemoveBinding(binding)}
                  className="p-1 text-gray-400 hover:text-red-500 flex-shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Binding Modal */}
      {isAddingBinding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
              <h3 className="font-medium">Привязать запись</h3>
              <button
                onClick={() => {
                  setIsAddingBinding(false);
                  setSearchQuery('');
                }}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {/* Table Selector */}
              <div className="space-y-1">
                <label className="text-xs text-gray-500">Таблица</label>
                <div className="relative">
                  <select
                    value={selectedTableId || ''}
                    onChange={(e) => setSelectedTableId(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg appearance-none cursor-pointer pr-8"
                  >
                    <option value="">Выберите таблицу...</option>
                    {tables.map(table => (
                      <option key={table.id} value={table.id}>
                        {table.icon || '📋'} {table.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {/* Search */}
              {selectedTableId && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Поиск записей..."
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg"
                  />
                </div>
              )}

              {/* Rows List */}
              {selectedTableId && (
                <div className="max-h-64 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
                  {isLoadingRows ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                    </div>
                  ) : rows.length === 0 ? (
                    <p className="text-center py-8 text-sm text-gray-400">
                      Записи не найдены
                    </p>
                  ) : (
                    rows.map(row => {
                      const table = tables.find(t => t.id === selectedTableId);
                      const isAlreadyBound = config.bindings.some(
                        b => b.tableId === selectedTableId && b.rowId === row.id
                      );
                      return (
                        <button
                          key={row.id}
                          onClick={() => !isAlreadyBound && handleAddBinding(row)}
                          disabled={isAlreadyBound}
                          className={cn(
                            'w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2 border-b border-gray-100 dark:border-gray-800 last:border-b-0',
                            isAlreadyBound && 'opacity-50 cursor-not-allowed'
                          )}
                        >
                          <Hash className="w-4 h-4 text-gray-400" />
                          <span className="truncate">{getRowDisplay(row, table)}</span>
                          {isAlreadyBound && (
                            <Check className="w-4 h-4 text-green-500 ml-auto" />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
