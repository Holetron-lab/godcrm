/**
 * TasksSourceConfig Component
 * ADR-024: Configure source table for Tasks tab
 * 
 * Features:
 * - Select Project → Table
 * - Bind to existing row (for context)
 * - Uses useAllTables hook for hierarchical data
 */

import { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Table2, 
  Check,
  Loader2,
  Link2,
  Unlink,
  ChevronRight,
  Search
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useAllTables } from '@/features/tables/hooks/useAllTables';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { TasksSourceConfig as Config } from './ContactsList.v3';

export interface BoundRowInfo {
  tableId: number;
  rowId: number;
  displayValue: string;
  tableName?: string;
}

export interface TasksSourceConfigProps {
  isOpen: boolean;
  onClose: () => void;
  currentConfig?: Config;
  onSave: (config: Config) => void;
  defaultSpaceId?: number;
  // Row binding
  boundRow?: BoundRowInfo;
  onBindRow?: (row: BoundRowInfo) => void;
  onUnbindRow?: () => void;
}

export function TasksSourceConfigModal({
  isOpen,
  onClose,
  currentConfig,
  onSave,
  defaultSpaceId,
  boundRow,
  onBindRow,
  onUnbindRow
}: TasksSourceConfigProps) {
  const { data: allTablesData, isLoading } = useAllTables();
  
  // Selected project and table
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(
    currentConfig?.tableId ? String(currentConfig.tableId) : null
  );
  
  // Row binding state
  const [showRowBinding, setShowRowBinding] = useState(false);
  const [bindingTableId, setBindingTableId] = useState<string | null>(null);
  const [rowSearchQuery, setRowSearchQuery] = useState('');
  const [selectedRowId, setSelectedRowId] = useState<number | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedTableId(currentConfig?.tableId ? String(currentConfig.tableId) : null);
      setShowRowBinding(false);
      setBindingTableId(null);
      setRowSearchQuery('');
      setSelectedRowId(null);
      // Try to find the project of current table
      if (currentConfig?.tableId && allTablesData?.flat) {
        const currentTable = allTablesData.flat.find(t => t.id === String(currentConfig.tableId));
        if (currentTable) {
          setSelectedProjectId(currentTable.projectId);
        }
      }
    }
  }, [isOpen, currentConfig, allTablesData]);

  // Fetch rows for binding
  const { data: bindingRows = [], isLoading: isLoadingRows } = useQuery({
    queryKey: ['binding-rows', bindingTableId, rowSearchQuery],
    queryFn: async () => {
      if (!bindingTableId) return [];
      const params = new URLSearchParams({ limit: '50' });
      if (rowSearchQuery) params.append('search', rowSearchQuery);
      
      const response = await apiClient.get<{
        success: boolean;
        data: { rows: Array<{ id: number; data: Record<string, unknown> }> };
      }>(`/tables/${bindingTableId}/rows?${params}`);
      return response.success ? response.data.rows : [];
    },
    enabled: !!bindingTableId && showRowBinding
  });

  // Get binding table columns for display
  const bindingTableInfo = useMemo(() => {
    if (!bindingTableId) return null;
    return allTablesData?.flat.find(t => t.id === bindingTableId);
  }, [bindingTableId, allTablesData]);

  // Get tables for selected project
  const projectTables = useMemo(() => {
    if (!selectedProjectId || !allTablesData?.spacesWithTables) return [];
    
    for (const space of allTablesData.spacesWithTables) {
      const project = space.projects.find(p => p.id === selectedProjectId);
      if (project) {
        return project.tables || [];
      }
    }
    return [];
  }, [selectedProjectId, allTablesData]);

  // Handle project change
  const handleProjectChange = (projectId: string) => {
    const newProjectId = projectId ? Number(projectId) : null;
    setSelectedProjectId(newProjectId);
    setSelectedTableId(null); // Reset table when project changes
  };

  // Handle table selection
  const handleTableChange = (tableId: string) => {
    setSelectedTableId(tableId || null);
  };

  // Handle save
  const handleSave = () => {
    if (!selectedTableId) return;
    
    const table = allTablesData?.flat.find(t => t.id === selectedTableId);
    if (table) {
      onSave({
        tableId: Number(table.id),
        tableName: table.displayName || table.name,
        tableIcon: table.icon,
        displayColumn: 'name' // Default, can be made configurable later
      });
      onClose();
    }
  };

  if (!isOpen) return null;

  // Get first display column from row
  const getRowDisplayValue = (row: { id: number; data: Record<string, unknown> }) => {
    const data = row.data;
    return String(data['name'] || data['title'] || data['Название'] || data['Name'] || `#${row.id}`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-secondary)]">
          <h3 className="font-semibold text-[var(--text-primary)]">
            {showRowBinding ? 'Привязать к записи' : 'Источник записей'}
          </h3>
          <button
            onClick={showRowBinding ? () => setShowRowBinding(false) : onClose}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current bound row */}
        {boundRow && !showRowBinding && (
          <div className="px-4 py-2 bg-green-500/10 border-b border-[var(--border-secondary)]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-[var(--text-tertiary)] mb-1">Привязано к записи:</div>
                <div className="flex items-center gap-2 text-sm text-green-400">
                  <Link2 className="w-4 h-4" />
                  <span>{boundRow.displayValue}</span>
                  <span className="text-xs opacity-60">#{boundRow.rowId}</span>
                </div>
              </div>
              {onUnbindRow && (
                <button
                  onClick={onUnbindRow}
                  className="p-1.5 rounded hover:bg-red-500/20 text-red-400"
                  title="Отвязать"
                >
                  <Unlink className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {showRowBinding ? (
            /* Row Binding View */
            <div className="p-4 space-y-3">
              {/* Table selector for binding */}
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                  Таблица
                </label>
                <select
                  value={bindingTableId || ''}
                  onChange={(e) => {
                    setBindingTableId(e.target.value || null);
                    setSelectedRowId(null);
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
                >
                  <option value="">— Выберите таблицу —</option>
                  {(allTablesData?.spacesWithTables || []).map((space) => (
                    <optgroup key={space.id} label={`${space.icon || '⚙️'} ${space.name}`}>
                      {space.projects.flatMap((project) =>
                        (project.tables || []).map((table) => (
                          <option key={table.id} value={table.id}>
                            {table.icon || '📋'} {table.displayName}
                          </option>
                        ))
                      )}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Search */}
              {bindingTableId && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
                  <input
                    type="text"
                    value={rowSearchQuery}
                    onChange={(e) => setRowSearchQuery(e.target.value)}
                    placeholder="Поиск записей..."
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
                  />
                </div>
              )}

              {/* Rows list */}
              {bindingTableId && (
                <div className="border border-[var(--border-secondary)] rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                  {isLoadingRows ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
                    </div>
                  ) : bindingRows.length === 0 ? (
                    <div className="py-6 text-center text-sm text-[var(--text-tertiary)]">
                      {rowSearchQuery ? 'Ничего не найдено' : 'Нет записей'}
                    </div>
                  ) : (
                    bindingRows.map((row) => (
                      <button
                        key={row.id}
                        onClick={() => setSelectedRowId(row.id)}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-[var(--border-secondary)] last:border-b-0 transition-colors",
                          selectedRowId === row.id
                            ? "bg-[var(--color-primary-500)]/20"
                            : "hover:bg-[var(--bg-tertiary)]"
                        )}
                      >
                        <div className="w-6 h-6 rounded bg-[var(--bg-tertiary)] flex items-center justify-center text-xs text-[var(--text-tertiary)]">
                          #{row.id}
                        </div>
                        <span className="flex-1 text-sm text-[var(--text-primary)] truncate">
                          {getRowDisplayValue(row)}
                        </span>
                        {selectedRowId === row.id && (
                          <Check className="w-4 h-4 text-[var(--color-primary-500)]" />
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Main Config View */
            <div className="p-4 space-y-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-[var(--text-tertiary)]" />
                </div>
              ) : (
                <>
                  {/* Bind to Row button */}
                  {onBindRow && (
                    <button
                      onClick={() => setShowRowBinding(true)}
                      className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[var(--color-primary-500)]/20 flex items-center justify-center">
                          <Link2 className="w-4 h-4 text-[var(--color-primary-500)]" />
                        </div>
                        <div className="text-left">
                          <div className="text-sm font-medium text-[var(--text-primary)]">
                            Привязать к записи
                          </div>
                          <div className="text-xs text-[var(--text-tertiary)]">
                            Связать чат с существующей записью
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)]" />
                    </button>
                  )}

                  {/* Divider */}
                  {onBindRow && (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-[var(--border-secondary)]" />
                      <span className="text-xs text-[var(--text-tertiary)]">или</span>
                      <div className="flex-1 h-px bg-[var(--border-secondary)]" />
                    </div>
                  )}

                  {/* Project selector with optgroups by Space */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                      Источник задач — Проект
                    </label>
                    <select
                      value={selectedProjectId ? String(selectedProjectId) : ''}
                      onChange={(e) => handleProjectChange(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
                    >
                      <option value="">— Выберите проект —</option>
                      {(allTablesData?.spacesWithTables || []).map((space) => (
                        <optgroup key={space.id} label={`${space.icon || '⚙️'} ${space.name}`}>
                          {space.projects.map((project) => (
                            <option key={project.id} value={String(project.id)}>
                              {project.icon || '📂'} {project.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  {/* Table selector */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                      Таблица
                    </label>
                    <select
                      value={selectedTableId || ''}
                      onChange={(e) => handleTableChange(e.target.value)}
                      disabled={!selectedProjectId}
                      className={cn(
                        "w-full px-3 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30",
                        !selectedProjectId && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <option value="">— Выберите таблицу —</option>
                      {projectTables.map((table) => (
                        <option key={table.id} value={table.id}>
                          {table.icon || '📋'} {table.displayName}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Selected table preview */}
                  {selectedTableId && (
                    <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                      <div className="flex items-center gap-2 text-sm text-green-400">
                        <Check className="w-4 h-4" />
                        <span>
                          {(() => {
                            const table = allTablesData?.flat.find(t => t.id === selectedTableId);
                            if (!table) return 'Таблица выбрана';
                            return `${table.icon || '📋'} ${table.displayName}`;
                          })()}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)] flex items-center justify-end gap-2">
          <button
            onClick={showRowBinding ? () => setShowRowBinding(false) : onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
          >
            {showRowBinding ? 'Назад' : 'Отмена'}
          </button>
          
          {showRowBinding ? (
            <button
              onClick={() => {
                if (selectedRowId && bindingTableId && onBindRow) {
                  const row = bindingRows.find(r => r.id === selectedRowId);
                  if (row) {
                    onBindRow({
                      tableId: Number(bindingTableId),
                      rowId: selectedRowId,
                      displayValue: getRowDisplayValue(row),
                      tableName: bindingTableInfo?.displayName
                    });
                    setShowRowBinding(false);
                  }
                }
              }}
              disabled={!selectedRowId}
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-primary-500)] text-white",
                selectedRowId
                  ? "hover:bg-[var(--color-primary-600)]"
                  : "opacity-50 cursor-not-allowed"
              )}
            >
              Привязать
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={!selectedTableId}
              className={cn(
                "px-4 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-primary-500)] text-white",
                selectedTableId
                  ? "hover:bg-[var(--color-primary-600)]"
                  : "opacity-50 cursor-not-allowed"
              )}
            >
              Сохранить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
