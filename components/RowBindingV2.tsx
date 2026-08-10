/**
 * RowBindingV2 Component
 * ADR-024: Chat & Message Architecture
 * 
 * Universal row binding using useAllTables hook:
 * - Project selector with optgroups (Space → Project)
 * - Table selector with IDs
 * - Row search and selection
 * - Auto-mapping to Tasks table if tasksSource is provided
 * - Space files binding if spaceFilesTableId is provided
 * 
 * Simplified from previous 595-line cascading version.
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
  Hash,
  Trash2,
  Check,
  Plus,
  File,
  FolderOpen
} from 'lucide-react';
import { useAllTables } from '@/features/tables/hooks/useAllTables';

interface RowInfo {
  id: number;
  table_id: number;
  data: Record<string, unknown>;
  created_at?: string;
}

export interface BoundRow {
  space_id?: number;
  project_id?: number;
  table_id: number;
  row_id: number;
  table_name?: string;
  table_icon?: string;
  row_title?: string;
  project_name?: string;
}

/** Tasks source config for auto-mapping */
export interface TasksSourceConfig {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  displayColumn?: string;
}

export interface RowBindingV2Props {
  /** Current space ID (defaults to this space) */
  defaultSpaceId?: number;
  defaultTableId?: number;
  boundRows?: BoundRow[];
  maxBindings?: number;
  compact?: boolean;
  /** Allow selecting from other spaces */
  allowCrossSpace?: boolean;
  /** Hide the header toggle button */
  hideHeader?: boolean;
  /** Force expanded state (controlled from outside) */
  forceExpanded?: boolean;
  /** Close handler for external control */
  onClose?: () => void;
  onBind: (binding: BoundRow) => void;
  onUnbind: (tableId: number, rowId: number) => void;
  className?: string;
  /** Auto-mapping: Tasks source config - shows tasks list immediately */
  tasksSource?: TasksSourceConfig;
  /** Auto-mapping: Space files table ID - shows files section */
  spaceFilesTableId?: number;
  /** Allow selecting from other tables when tasksSource is set */
  allowOtherTables?: boolean;
}

export function RowBindingV2({
  defaultSpaceId,
  defaultTableId,
  boundRows = [],
  maxBindings = 10,
  compact = false,
  allowCrossSpace = false,
  hideHeader = false,
  forceExpanded,
  onClose,
  onBind,
  onUnbind,
  className,
  tasksSource,
  spaceFilesTableId,
  allowOtherTables = true
}: RowBindingV2Props) {
  const [isExpandedInternal, setIsExpandedInternal] = useState(false);
  const isExpanded = forceExpanded !== undefined ? forceExpanded : isExpandedInternal;
  const setIsExpanded = (value: boolean) => {
    if (forceExpanded === undefined) setIsExpandedInternal(value);
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [tasksSearchQuery, setTasksSearchQuery] = useState('');
  const [filesSearchQuery, setFilesSearchQuery] = useState('');
  
  // Selection state
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(
    defaultTableId || null
  );
  
  // Section expansion states
  const [showOtherTables, setShowOtherTables] = useState(false);
  const [showFilesSection, setShowFilesSection] = useState(false);

  // Load all tables hierarchy
  const { data: allTablesData, isLoading: isLoadingTables } = useAllTables();

  // Update from defaults
  useEffect(() => {
    if (defaultTableId && allTablesData?.flat) {
      setSelectedTableId(defaultTableId);
      const table = allTablesData.flat.find(t => t.id === String(defaultTableId));
      if (table) {
        setSelectedProjectId(table.projectId);
      }
    }
  }, [defaultTableId, allTablesData]);

  // Filter spaces (if cross-space disabled, show only default space)
  const filteredSpaces = useMemo(() => {
    if (!allTablesData?.spacesWithTables) return [];
    if (allowCrossSpace) return allTablesData.spacesWithTables;
    if (!defaultSpaceId) return allTablesData.spacesWithTables;
    return allTablesData.spacesWithTables.filter(s => s.id === defaultSpaceId);
  }, [allTablesData, allowCrossSpace, defaultSpaceId]);

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

  // Get selected table info
  const selectedTableInfo = useMemo(() => {
    if (!selectedTableId || !allTablesData?.flat) return null;
    return allTablesData.flat.find(t => t.id === String(selectedTableId));
  }, [selectedTableId, allTablesData]);

  // Get selected project name
  const selectedProjectName = useMemo(() => {
    if (!selectedProjectId || !allTablesData?.spacesWithTables) return null;
    for (const space of allTablesData.spacesWithTables) {
      const project = space.projects.find(p => p.id === selectedProjectId);
      if (project) return project.name;
    }
    return null;
  }, [selectedProjectId, allTablesData]);

  // Fetch rows from selected table
  const { data: tableRows = [], isLoading: isLoadingRows } = useQuery({
    queryKey: ['rows-for-binding', selectedTableId, searchQuery],
    queryFn: async () => {
      if (!selectedTableId) return [];
      const params = new URLSearchParams();
      if (searchQuery) params.append('search', searchQuery);
      params.append('limit', '50');
      
      const response = await apiClient.get<{
        success: boolean;
        data: { rows: RowInfo[] };
      }>(`/tables/${selectedTableId}/rows?${params}`);
      return response.success ? response.data.rows : [];
    },
    enabled: !!selectedTableId && isExpanded
  });

  // Fetch tasks from configured tasks table (auto-mapping)
  const { data: tasksRows = [], isLoading: isLoadingTasks } = useQuery({
    queryKey: ['tasks-for-binding', tasksSource?.tableId, tasksSearchQuery],
    queryFn: async () => {
      if (!tasksSource?.tableId) return [];
      const params = new URLSearchParams();
      if (tasksSearchQuery) params.append('search', tasksSearchQuery);
      params.append('limit', '50');
      
      const response = await apiClient.get<{
        success: boolean;
        data: { rows: RowInfo[] };
      }>(`/tables/${tasksSource.tableId}/rows?${params}`);
      return response.success ? response.data.rows : [];
    },
    enabled: !!tasksSource?.tableId && isExpanded
  });

  // Fetch files from space files table
  const { data: filesRows = [], isLoading: isLoadingFiles } = useQuery({
    queryKey: ['files-for-binding', spaceFilesTableId, filesSearchQuery],
    queryFn: async () => {
      if (!spaceFilesTableId) return [];
      const params = new URLSearchParams();
      if (filesSearchQuery) params.append('search', filesSearchQuery);
      params.append('limit', '50');
      
      const response = await apiClient.get<{
        success: boolean;
        data: { rows: RowInfo[] };
      }>(`/tables/${spaceFilesTableId}/rows?${params}`);
      return response.success ? response.data.rows : [];
    },
    enabled: !!spaceFilesTableId && isExpanded && showFilesSection
  });

  // Get display value for a row
  const getRowDisplayValue = (row: RowInfo, displayField?: string) => {
    const data = row.data as Record<string, unknown>;
    return String(
      data[selectedTableInfo?.displayField || 'name'] || 
      data['title'] || 
      data['name'] || 
      data['subject'] || 
      `#${row.id}`
    );
  };
  // Get display value for a task row
  const getTaskDisplayValue = (row: RowInfo) => {
    const data = row.data as Record<string, unknown>;
    return String(
      data[tasksSource?.displayColumn || 'title'] || 
      data['title'] || 
      data['name'] || 
      `#${row.id}`
    );
  };

  // Get display value for a file row
  const getFileDisplayValue = (row: RowInfo) => {
    const data = row.data as Record<string, unknown>;
    return String(
      data['name'] || 
      data['filename'] || 
      data['title'] || 
      `#${row.id}`
    );
  };
  // Check if row is already bound
  const isRowBound = (tableId: number, rowId: number) => {
    return boundRows.some(br => br.table_id === tableId && br.row_id === rowId);
  };

  // Handle project change
  const handleProjectChange = (projectId: string) => {
    const newProjectId = projectId ? Number(projectId) : null;
    setSelectedProjectId(newProjectId);
    setSelectedTableId(null); // Reset table
    setSearchQuery('');
  };

  // Handle table change
  const handleTableChange = (tableId: string) => {
    setSelectedTableId(tableId ? Number(tableId) : null);
    setSearchQuery('');
  };

  // Handle row selection
  const handleRowSelect = (row: RowInfo) => {
    if (isRowBound(row.table_id, row.id)) return;
    if (boundRows.length >= maxBindings) return;

    onBind({
      space_id: selectedTableInfo?.spaceId,
      project_id: selectedProjectId ?? undefined,
      table_id: row.table_id,
      row_id: row.id,
      table_name: selectedTableInfo?.displayName || selectedTableInfo?.name,
      table_icon: selectedTableInfo?.icon,
      row_title: getRowDisplayValue(row),
      project_name: selectedProjectName ?? undefined
    });

    // Reset search for next selection
    setSearchQuery('');
  };

  // Handle "add more from same table" - auto-map to table
  const handleAddMoreFromTable = (tableId: number, projectId?: number) => {
    if (projectId) {
      setSelectedProjectId(projectId);
    }
    setSelectedTableId(tableId);
    setSearchQuery('');
  };

  // Handle task selection (from auto-mapped tasks table)
  const handleTaskSelect = (row: RowInfo) => {
    if (!tasksSource) return;
    if (isRowBound(tasksSource.tableId, row.id)) return;
    if (boundRows.length >= maxBindings) return;

    onBind({
      table_id: tasksSource.tableId,
      row_id: row.id,
      table_name: tasksSource.tableName,
      table_icon: tasksSource.tableIcon || '📋',
      row_title: getTaskDisplayValue(row)
    });

    setTasksSearchQuery('');
  };

  // Handle file selection (from space files table)
  const handleFileSelect = (row: RowInfo) => {
    if (!spaceFilesTableId) return;
    if (isRowBound(spaceFilesTableId, row.id)) return;
    if (boundRows.length >= maxBindings) return;

    onBind({
      table_id: spaceFilesTableId,
      row_id: row.id,
      table_name: 'Файлы пространства',
      table_icon: '📁',
      row_title: getFileDisplayValue(row)
    });

    setFilesSearchQuery('');
  };

  const canAddMore = boundRows.length < maxBindings;

  // Compact mode - just show bound items inline
  if (compact && boundRows.length > 0 && !isExpanded) {
    return (
      <div className={cn("flex items-center gap-1 flex-wrap", className)}>
        {boundRows.map((br, idx) => (
          <div
            key={`${br.table_id}-${br.row_id}-${idx}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-[var(--color-primary-500)]/20 text-[var(--color-primary-400)] border border-[var(--color-primary-500)]/30"
          >
            <Link2 className="w-3 h-3" />
            <span className="max-w-24 truncate">{br.row_title || `#${br.row_id}`}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onUnbind(br.table_id, br.row_id); }}
              className="ml-0.5 hover:text-red-400"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        {canAddMore && (
          <button
            onClick={() => setIsExpanded(true)}
            className="text-xs text-[var(--color-primary-500)] hover:underline"
          >
            + добавить
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)]", className)}>
      {/* Header - Toggle (hidden if hideHeader) */}
      {!hideHeader && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] rounded-t-lg transition-colors"
        >
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4" />
            <span>{isExpanded ? 'Свернуть' : 'Привязать к записи'}</span>
            {boundRows.length > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--color-primary-500)]/20 text-[var(--color-primary-400)]">
                {boundRows.length}
              </span>
            )}
          </div>
          <ChevronDown className={cn("w-4 h-4 transition-transform", isExpanded && "rotate-180")} />
        </button>
      )}

      {/* Expanded Content */}
      {isExpanded && (
        <div className={cn(!hideHeader && "border-t border-[var(--border-secondary)]")}>
          {/* Bound rows list */}
          {boundRows.length > 0 && (
            <div className="p-3 border-b border-[var(--border-secondary)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[var(--text-tertiary)]">
                  Привязанные записи ({boundRows.length}/{maxBindings})
                </span>
                {onClose && (
                  <button
                    onClick={onClose}
                    className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {boundRows.map((br, idx) => (
                  <div
                    key={`${br.table_id}-${br.row_id}-${idx}`}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded bg-[var(--bg-tertiary)] text-xs"
                  >
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="text-base flex-shrink-0">{br.table_icon || '📋'}</span>
                      {/* Breadcrumbs: project → table → row */}
                      <div className="flex items-center gap-1 min-w-0 text-[var(--text-tertiary)]">
                        {br.project_name && (
                          <>
                            <span className="truncate max-w-20">{br.project_name}</span>
                            <ChevronRight className="w-3 h-3 flex-shrink-0" />
                          </>
                        )}
                        {br.table_name && (
                          <>
                            <span className="truncate max-w-20">{br.table_name}</span>
                            <ChevronRight className="w-3 h-3 flex-shrink-0" />
                          </>
                        )}
                        <span className="truncate text-[var(--text-primary)] font-medium">
                          {br.row_title || `#${br.row_id}`}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      {/* Add more from same table */}
                      {canAddMore && (
                        <button
                          onClick={() => handleAddMoreFromTable(br.table_id, br.project_id)}
                          className="p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)]"
                          title="Добавить ещё из этой таблицы"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        onClick={() => onUnbind(br.table_id, br.row_id)}
                        className="p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-red-500"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Selection Section */}
          {canAddMore && (
            <div className="p-3 space-y-3">
              {isLoadingTables ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
                </div>
              ) : (
                <>
                  {/* === Quick Tasks Section (if tasksSource configured) === */}
                  {tasksSource && (
                    <div className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)]">
                      {/* Tasks header */}
                      <div className="px-3 py-2 border-b border-[var(--border-secondary)] flex items-center gap-2">
                        <span className="text-base">{tasksSource.tableIcon || '📋'}</span>
                        <span className="text-sm font-medium text-[var(--text-primary)]">
                          {tasksSource.tableName}
                        </span>
                      </div>

                      {/* Tasks search */}
                      <div className="p-2">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
                          <input
                            type="text"
                            value={tasksSearchQuery}
                            onChange={(e) => setTasksSearchQuery(e.target.value)}
                            placeholder="Поиск задач..."
                            className="w-full pl-8 pr-8 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
                          />
                          {tasksSearchQuery && (
                            <button
                              onClick={() => setTasksSearchQuery('')}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Tasks list */}
                      <div className="max-h-40 overflow-y-auto">
                        {isLoadingTasks ? (
                          <div className="flex items-center justify-center py-4">
                            <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
                          </div>
                        ) : tasksRows.length === 0 ? (
                          <div className="py-4 text-center text-xs text-[var(--text-tertiary)]">
                            {tasksSearchQuery ? 'Не найдено' : 'Нет задач'}
                          </div>
                        ) : (
                          tasksRows.map(row => {
                            const bound = isRowBound(tasksSource.tableId, row.id);
                            return (
                              <button
                                key={row.id}
                                onClick={() => handleTaskSelect(row)}
                                disabled={bound}
                                className={cn(
                                  "w-full flex items-center gap-2 px-3 py-2 text-left border-b border-[var(--border-secondary)] last:border-0",
                                  bound 
                                    ? "opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]"
                                    : "hover:bg-[var(--bg-tertiary)]"
                                )}
                              >
                                <Hash className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
                                <span className="text-sm text-[var(--text-primary)] flex-1 truncate">
                                  {getTaskDisplayValue(row)}
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
                    </div>
                  )}

                  {/* === Space Files Section (if spaceFilesTableId configured) === */}
                  {spaceFilesTableId && (
                    <div className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)]">
                      {/* Files header - clickable to expand */}
                      <button
                        onClick={() => setShowFilesSection(!showFilesSection)}
                        className="w-full px-3 py-2 flex items-center justify-between hover:bg-[var(--bg-tertiary)] transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-base">📁</span>
                          <span className="text-sm font-medium text-[var(--text-primary)]">
                            Файлы пространства
                          </span>
                        </div>
                        <ChevronDown className={cn("w-4 h-4 text-[var(--text-tertiary)] transition-transform", showFilesSection && "rotate-180")} />
                      </button>

                      {/* Files content (expanded) */}
                      {showFilesSection && (
                        <div className="border-t border-[var(--border-secondary)]">
                          {/* Files search */}
                          <div className="p-2">
                            <div className="relative">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
                              <input
                                type="text"
                                value={filesSearchQuery}
                                onChange={(e) => setFilesSearchQuery(e.target.value)}
                                placeholder="Поиск файлов..."
                                className="w-full pl-8 pr-8 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
                              />
                              {filesSearchQuery && (
                                <button
                                  onClick={() => setFilesSearchQuery('')}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Files list */}
                          <div className="max-h-40 overflow-y-auto">
                            {isLoadingFiles ? (
                              <div className="flex items-center justify-center py-4">
                                <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
                              </div>
                            ) : filesRows.length === 0 ? (
                              <div className="py-4 text-center text-xs text-[var(--text-tertiary)]">
                                {filesSearchQuery ? 'Не найдено' : 'Нет файлов'}
                              </div>
                            ) : (
                              filesRows.map(row => {
                                const bound = isRowBound(spaceFilesTableId, row.id);
                                return (
                                  <button
                                    key={row.id}
                                    onClick={() => handleFileSelect(row)}
                                    disabled={bound}
                                    className={cn(
                                      "w-full flex items-center gap-2 px-3 py-2 text-left border-b border-[var(--border-secondary)] last:border-0",
                                      bound 
                                        ? "opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]"
                                        : "hover:bg-[var(--bg-tertiary)]"
                                    )}
                                  >
                                    <File className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
                                    <span className="text-sm text-[var(--text-primary)] flex-1 truncate">
                                      {getFileDisplayValue(row)}
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
                        </div>
                      )}
                    </div>
                  )}

                  {/* === Other Tables Section === */}
                  {(allowOtherTables || (!tasksSource && !spaceFilesTableId)) && (
                    <div className="rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-primary)]">
                      {/* Header - clickable if tasksSource is set */}
                      {tasksSource ? (
                        <button
                          onClick={() => setShowOtherTables(!showOtherTables)}
                          className="w-full px-3 py-2 flex items-center justify-between hover:bg-[var(--bg-tertiary)] transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <FolderOpen className="w-4 h-4 text-[var(--text-tertiary)]" />
                            <span className="text-sm font-medium text-[var(--text-primary)]">
                              Другая таблица
                            </span>
                          </div>
                          <ChevronDown className={cn("w-4 h-4 text-[var(--text-tertiary)] transition-transform", showOtherTables && "rotate-180")} />
                        </button>
                      ) : null}

                      {/* Content - always shown if no tasksSource, or when expanded */}
                      {(!tasksSource || showOtherTables) && (
                        <div className={cn(tasksSource && "border-t border-[var(--border-secondary)]")}>
                          <div className="p-3 space-y-3">
                            {/* Project selector with optgroups by Space */}
                            <div>
                              <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-1">
                                Проект
                              </label>
                              <select
                                value={selectedProjectId ? String(selectedProjectId) : ''}
                                onChange={(e) => handleProjectChange(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
                              >
                                <option value="">— Выберите проект —</option>
                                {filteredSpaces.map((space) => (
                                  <optgroup key={space.id} label={`${space.icon || '⚙️'} ${space.name}`}>
                                    {space.projects.map((project) => (
                                      <option key={project.id} value={String(project.id)}>
                                        {project.icon || '📂'} {project.name} ({project.id})
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            </div>

                            {/* Table selector */}
                            <div>
                              <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-1">
                                Таблица
                              </label>
                              <select
                                value={selectedTableId ? String(selectedTableId) : ''}
                                onChange={(e) => handleTableChange(e.target.value)}
                                disabled={!selectedProjectId}
                                className={cn(
                                  "w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30",
                                  !selectedProjectId && "opacity-50 cursor-not-allowed"
                                )}
                              >
                                <option value="">— Выберите таблицу —</option>
                                {projectTables.map((table) => (
                                  <option key={table.id} value={table.id}>
                                    {table.icon || '📋'} {table.displayName} ({table.id})
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Selected table indicator */}
                            {selectedTableInfo && (
                              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 text-xs text-green-400">
                                <Check className="w-3 h-3" />
                                <span>{selectedTableInfo.icon || '📋'} {selectedTableInfo.displayName} (ID: {selectedTableInfo.id})</span>
                              </div>
                            )}

                            {/* Row search and selection */}
                            {selectedTableId && (
                              <div>
                                <label className="block text-xs font-medium text-[var(--text-tertiary)] mb-1">
                                  Выберите запись
                                </label>
                                
                                {/* Search */}
                                <div className="relative mb-2">
                                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
                                  <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Поиск записей..."
                                    className="w-full pl-8 pr-8 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
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

                                {/* Rows list */}
                                <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)]">
                                  {isLoadingRows ? (
                                    <div className="flex items-center justify-center py-4">
                                      <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
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
                                            "w-full flex items-center gap-2 px-3 py-2.5 text-left border-b border-[var(--border-secondary)] last:border-0",
                                            bound 
                                              ? "opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]"
                                              : "hover:bg-[var(--bg-tertiary)]"
                                          )}
                                        >
                                          <Hash className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
                                          <span className="text-sm text-[var(--text-primary)] flex-1 truncate">
                                            {getRowDisplayValue(row)}
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
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Max bindings reached */}
          {!canAddMore && (
            <div className="p-3 text-xs text-[var(--text-tertiary)] text-center">
              Достигнут лимит привязок ({maxBindings})
            </div>
          )}
        </div>
      )}
    </div>
  );
}
