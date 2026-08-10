import React, { useState, useMemo } from 'react';
import { Loader2, X } from 'lucide-react';
import { useAllTables } from '@/features/tables/hooks/useAllTables';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';

interface TicketsSourceConfig {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  displayColumn?: string;
  descriptionColumn?: string;
  statusColumn?: string;
  priorityColumn?: string;
  statusDictTableId?: number;
  priorityDictTableId?: number;
}

// Column name aliases for auto-mapping
const TITLE_ALIASES = ['title', 'what', 'name', 'subject'];
const DESC_ALIASES = ['description', 'why', 'details', 'body'];
const STATUS_ALIASES = ['state', 'status', 'task_status'];
const PRIORITY_ALIASES = ['priority', 'urgency'];

function findColumn(
  columns: Array<{ column_name: string; type: string; config?: string }>,
  aliases: string[]
): string | undefined {
  for (const alias of aliases) {
    const col = columns.find(c => c.column_name === alias);
    if (col) return col.column_name;
  }
  return undefined;
}

function parseDictTableId(config: string | undefined | null): number | undefined {
  if (!config) return undefined;
  try {
    const parsed: unknown = JSON.parse(config);
    if (parsed && typeof parsed === 'object' && 'relationTableId' in parsed) {
      return (parsed as { relationTableId: number }).relationTableId;
    }
  } catch { /* ignore */ }
  return undefined;
}

interface TicketsSourceInlineSelectorProps {
  defaultSpaceId?: number;
  onSelect: (config: TicketsSourceConfig) => void;
  onCancel: () => void;
  showHeader?: boolean;
}

/**
 * Inline selector for ticket/task source table
 * @deprecated Use TicketsSourceInlineSelector - this export kept for backwards compatibility
 */
export const TasksSourceInlineSelector = TicketsSourceInlineSelector;

export function TicketsSourceInlineSelector({
  defaultSpaceId,
  onSelect,
  onCancel,
  showHeader = true
}: TicketsSourceInlineSelectorProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);

  const { data: allTablesData, isLoading } = useAllTables();

  // Fetch columns for the selected table (for auto-mapping)
  const { data: tableColumns = [] } = useQuery<Array<{ column_name: string; display_name: string; type: string; config?: string }>>({
    queryKey: ['inline-selector-columns', selectedTableId],
    queryFn: async () => {
      const response = await apiClient.get<{
        success: boolean;
        data: Array<{ column_name: string; display_name: string; type: string; config?: string }>;
      }>(`/tables/${selectedTableId}/columns`);
      return response.success ? (response.data || []) : [];
    },
    enabled: !!selectedTableId,
    staleTime: 5 * 60_000
  });

  // Filter spaces
  const filteredSpaces = useMemo(() => {
    if (!allTablesData?.spacesWithTables) return [];
    if (!defaultSpaceId) return allTablesData.spacesWithTables;
    return allTablesData.spacesWithTables.filter(s => s.id === defaultSpaceId);
  }, [allTablesData, defaultSpaceId]);

  // Get tables for selected project
  const projectTables = useMemo(() => {
    if (!selectedProjectId || !allTablesData?.spacesWithTables) return [];
    for (const space of allTablesData.spacesWithTables) {
      const project = space.projects.find(p => p.id === selectedProjectId);
      if (project) return project.tables || [];
    }
    return [];
  }, [selectedProjectId, allTablesData]);

  // Get selected table info
  const selectedTable = useMemo(() => {
    if (!selectedTableId) return null;
    return allTablesData?.flat?.find(t => t.id === String(selectedTableId));
  }, [selectedTableId, allTablesData]);

  // Auto-mapped column info (shown as preview)
  const autoMapped = useMemo(() => {
    if (!tableColumns.length) return null;
    const titleCol = findColumn(tableColumns, TITLE_ALIASES);
    const descCol = findColumn(tableColumns, DESC_ALIASES);
    const statusCol = findColumn(tableColumns, STATUS_ALIASES);
    const priorityCol = findColumn(tableColumns, PRIORITY_ALIASES);
    if (!titleCol && !descCol && !statusCol && !priorityCol) return null;

    const statusColInfo = statusCol ? tableColumns.find(c => c.column_name === statusCol) : undefined;
    const priorityColInfo = priorityCol ? tableColumns.find(c => c.column_name === priorityCol) : undefined;

    return {
      displayColumn: titleCol,
      descriptionColumn: descCol,
      statusColumn: statusCol,
      priorityColumn: priorityCol,
      statusDictTableId: parseDictTableId(statusColInfo?.config),
      priorityDictTableId: parseDictTableId(priorityColInfo?.config),
    };
  }, [tableColumns]);

  const handleSave = () => {
    if (!selectedTable) return;
    onSelect({
      tableId: Number(selectedTable.id),
      tableName: selectedTable.displayName || selectedTable.name,
      tableIcon: selectedTable.icon,
      displayColumn: autoMapped?.displayColumn || selectedTable.displayField,
      descriptionColumn: autoMapped?.descriptionColumn,
      statusColumn: autoMapped?.statusColumn,
      priorityColumn: autoMapped?.priorityColumn,
      statusDictTableId: autoMapped?.statusDictTableId,
      priorityDictTableId: autoMapped?.priorityDictTableId,
    });
  };

  if (isLoading) {
    return (
      <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  return (
    <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] space-y-3">
      {/* Header with close button */}
      {showHeader && (
        <div className="flex items-center justify-between">
          <label className="text-xs text-[var(--text-tertiary)]">Проект</label>
          <button
            onClick={onCancel}
            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Project selector with label if no header */}
      {!showHeader && <label className="block text-xs text-[var(--text-tertiary)]">Проект</label>}
      {/* Project selector */}
      <select
        value={selectedProjectId || ''}
        onChange={(e) => {
          setSelectedProjectId(e.target.value ? Number(e.target.value) : null);
          setSelectedTableId(null);
        }}
        className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
      >
        <option value="">— Выберите проект —</option>
        {filteredSpaces.map(space => (
          <optgroup key={space.id} label={`${space.icon || '📁'} ${space.name}`}>
            {space.projects.map(project => (
              <option key={project.id} value={project.id}>
                {project.icon || '📂'} {project.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* Table selector */}
      <div>
        <label className="block text-xs text-[var(--text-tertiary)] mb-1">Таблица</label>
        <select
          value={selectedTableId || ''}
          onChange={(e) => setSelectedTableId(e.target.value ? Number(e.target.value) : null)}
          disabled={!selectedProjectId}
          className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-50"
        >
          <option value="">— Выберите таблицу —</option>
          {projectTables.map(table => (
            <option key={table.id} value={table.id}>
              {table.icon || '📋'} {table.displayName || table.name}
            </option>
          ))}
        </select>
      </div>

      {/* Auto-mapped columns preview */}
      {autoMapped && (
        <div className="text-[10px] text-[var(--text-tertiary)] space-y-0.5">
          <p className="font-medium">Автомаппинг:</p>
          {autoMapped.displayColumn && <p>Название: <span className="text-green-400">{autoMapped.displayColumn}</span></p>}
          {autoMapped.descriptionColumn && <p>Описание: <span className="text-green-400">{autoMapped.descriptionColumn}</span></p>}
          {autoMapped.statusColumn && <p>Статус: <span className="text-green-400">{autoMapped.statusColumn}</span></p>}
          {autoMapped.priorityColumn && <p>Приоритет: <span className="text-green-400">{autoMapped.priorityColumn}</span></p>}
        </div>
      )}

      {/* Save button only */}
      <div className="flex justify-end pt-1">
        <button
          onClick={handleSave}
          disabled={!selectedTableId}
          className="px-3 py-1.5 text-xs bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}
