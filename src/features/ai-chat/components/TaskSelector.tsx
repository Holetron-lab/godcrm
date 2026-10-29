import { useLanguage } from '@/shared/i18n/LanguageContext';
/**
 * TaskSelector Component
 * ADR-023: Agent-as-User & Infinite Chat Architecture
 * 
 * A panel for selecting and binding tasks to chat conversations
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { cn } from '@/shared/utils/cn';
import { 
  Link2, 
  Loader2, 
  Search, 
  CheckCircle2, 
  X,
  ChevronDown,
  Table2,
  Hash
} from 'lucide-react';

interface TaskRow {
  id: number;
  data: Record<string, unknown>;
  table_id: number;
  created_at: string;
}

interface TaskTable {
  id: number;
  name: string;
  slug: string;
  display_column?: string;
}

export interface TaskSelectorProps {
  spaceId?: number;
  boundTaskId?: number;
  boundTableId?: number;
  onBind: (tableId: number, rowId: number) => void;
  onUnbind: () => void;
  className?: string;
}

export function TaskSelector({
  spaceId,
  boundTaskId,
  boundTableId,
  onBind,
  onUnbind,
  className
}: TaskSelectorProps) {
  const { t } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTableId, setSelectedTableId] = useState<number | null>(boundTableId || null);

  // Fetch tables that can have tasks (configured as task tables)
  const { data: taskTables = [], isLoading: isLoadingTables } = useQuery({
    queryKey: ['task-tables', spaceId],
    queryFn: async () => {
      if (!spaceId) return [];
      const response = await apiClient.get<{
        success: boolean;
        data: TaskTable[];
      }>(`/tables?spaceId=${spaceId}`);
      return response.success ? response.data : [];
    },
    enabled: !!spaceId && isExpanded
  });

  // Fetch rows from selected table
  const { data: tableRows = [], isLoading: isLoadingRows } = useQuery({
    queryKey: ['task-rows', selectedTableId, searchQuery],
    queryFn: async () => {
      if (!selectedTableId) return [];
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      params.append('limit', '20');
      
      const response = await apiClient.get<{
        success: boolean;
        data: { rows: TaskRow[] };
      }>(`/tables/${selectedTableId}/rows?${params}`);
      return response.success ? response.data.rows : [];
    },
    enabled: !!selectedTableId && isExpanded
  });

  // Get the display value for a row
  const getRowDisplayValue = (row: TaskRow, table?: TaskTable) => {
    const displayColumn = table?.display_column || 'name';
    const data = row.data as Record<string, unknown>;
    return String(data[displayColumn] || data['title'] || data['name'] || `#${row.id}`);
  };

  // Find bound task display
  const boundTaskDisplay = useMemo(() => {
    if (!boundTaskId || !boundTableId) return null;
    const table = taskTables.find(t => t.id === boundTableId);
    const row = tableRows.find(r => r.id === boundTaskId);
    if (row && table) {
      return {
        tableName: table.name,
        taskName: getRowDisplayValue(row, table)
      };
    }
    return {
      tableName: table?.name || t('aiChat.ui.unknownTable'),
      taskName: `Task #${boundTaskId}`
    };
  }, [boundTaskId, boundTableId, taskTables, tableRows, t]);

  return (
    <div className={cn('border-t border-[var(--border-secondary)]', className)}>
      {/* Header - Bound Task or Toggle */}
      <div
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors',
          boundTaskId
            ? 'bg-[var(--color-primary-500)]/10 hover:bg-[var(--color-primary-500)]/15'
            : 'hover:bg-[var(--bg-tertiary)]'
        )}
      >
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex flex-1 min-w-0 items-center gap-2 text-left rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-500)]"
        >
          <Link2 className={cn(
            'w-4 h-4 shrink-0',
            boundTaskId ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)]'
          )} />
          <span className="flex-1 min-w-0">
            {boundTaskId && boundTaskDisplay ? (
              <>
                <span className="block text-xs text-[var(--text-tertiary)]">{boundTaskDisplay.tableName}</span>
                <span className="block text-sm font-medium text-[var(--text-primary)] truncate">
                  {boundTaskDisplay.taskName}
                </span>
              </>
            ) : (
              <span className="text-sm text-[var(--text-tertiary)]">
                {t('aiChat.ui.linkToTask')}
              </span>
            )}
          </span>
          {!boundTaskId && (
            <ChevronDown className={cn(
              'w-4 h-4 shrink-0 text-[var(--text-tertiary)] transition-transform',
              isExpanded && 'rotate-180'
            )} />
          )}
        </button>
        {boundTaskId && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUnbind();
            }}
            className="p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--color-error)]"
            title={t('aiChat.ui.unlink')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Expanded Panel */}
      {isExpanded && (
        <div className="border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
          {/* Table Selector */}
          <div className="p-2 border-b border-[var(--border-secondary)]">
            <div className="text-xs font-medium text-[var(--text-tertiary)] mb-1 px-1">
              {t('columnSettings.relation.table')}</div>
            {isLoadingTables ? (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {taskTables.slice(0, 5).map((table) => (
                  <button
                    key={table.id}
                    onClick={() => setSelectedTableId(table.id)}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
                      selectedTableId === table.id
                        ? 'bg-[var(--color-primary-500)] text-white'
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]'
                    )}
                  >
                    <Table2 className="w-3 h-3" />
                    {table.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Search */}
          {selectedTableId && (
            <div className="p-2 border-b border-[var(--border-secondary)]">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-tertiary)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('aiChat.ui.search')}
                  className="w-full pl-7 pr-2 py-1.5 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
                />
              </div>
            </div>
          )}

          {/* Rows List */}
          {selectedTableId && (
            <div className="max-h-48 overflow-y-auto">
              {isLoadingRows ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
                </div>
              ) : tableRows.length === 0 ? (
                <div className="text-xs text-[var(--text-tertiary)] text-center py-4">
                  {t('kanban.noRecords')}</div>
              ) : (
                <div className="p-1">
                  {tableRows.map((row) => {
                    const isSelected = boundTaskId === row.id && boundTableId === selectedTableId;
                    const table = taskTables.find(t => t.id === selectedTableId);
                    return (
                      <button
                        key={row.id}
                        onClick={() => {
                          if (isSelected) {
                            onUnbind();
                          } else {
                            onBind(selectedTableId, row.id);
                            setIsExpanded(false);
                          }
                        }}
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors',
                          isSelected
                            ? 'bg-[var(--color-primary-500)]/15 text-[var(--color-primary-500)]'
                            : 'hover:bg-[var(--bg-tertiary)]'
                        )}
                      >
                        <Hash className="w-3 h-3 text-[var(--text-tertiary)]" />
                        <span className="flex-1 text-xs truncate">
                          {getRowDisplayValue(row, table)}
                        </span>
                        {isSelected && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-[var(--color-primary-500)]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TaskSelector;
