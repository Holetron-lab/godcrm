import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { cn } from '@/shared/utils/cn';
import { Link2, Loader2, Search, X, ChevronDown, Hash, Check } from 'lucide-react';
import { useAllTables } from '@/features/tables/hooks/useAllTables';
import { RowBindingTabBar } from './RowBindingV2.TabBar';
import { RowList } from './RowBindingV2.RowList';

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

/** Tasks source config for auto-mapping. Mirrors TicketsSourceConfig in
 *  AIChatPanel/types — kept here as a structural subset so RowBindingV2 can
 *  forward per-row mapping (iconColumn, status/priority/category) into the
 *  shared <RowList /> renderer. */
export interface TasksSourceConfig {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  iconColumn?: string;
  displayColumn?: string;
  descriptionColumn?: string;
  statusColumn?: string;
  priorityColumn?: string;
  categoryColumn?: string;
  statusDictTableId?: number;
  priorityDictTableId?: number;
  categoryDictTableId?: number;
}

/** Favorite-table config (documents slot or one of custom[]). Mirrors FavoriteTable in AIChatPanel/types. */
export interface FavoriteTable {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  iconColumn?: string;
  displayColumn?: string;
  descriptionColumn?: string;
  statusColumn?: string;
  priorityColumn?: string;
  categoryColumn?: string;
  statusDictTableId?: number;
  priorityDictTableId?: number;
  categoryDictTableId?: number;
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
  /** Hide the inner horizontal tab bar (caller provides its own tabs) */
  hideTabBar?: boolean;
  /** Force expanded state (controlled from outside) */
  forceExpanded?: boolean;
  /** Close handler for external control */
  onClose?: () => void;
  onBind: (binding: BoundRow) => void;
  onUnbind: (tableId: number, rowId: number) => void;
  className?: string;
  /** Auto-mapping: Tasks source config - shows tasks list immediately */
  tasksSource?: TasksSourceConfig;
  /** Allow selecting from other tables when tasksSource is set */
  allowOtherTables?: boolean;
  /** Favorites: Documents slot — shown as a tab if set */
  documentsSource?: FavoriteTable;
  /** Favorites: Custom tabs — one per entry */
  customSources?: FavoriteTable[];
  /** When false, hide the inline "+" inside RowList (caller renders its own). */
  showAddButton?: boolean;
}

export function RowBindingV2({
  defaultSpaceId,
  defaultTableId,
  boundRows = [],
  maxBindings = 10,
  compact = false,
  allowCrossSpace = false,
  hideHeader = false,
  hideTabBar = false,
  forceExpanded,
  onClose,
  onBind,
  onUnbind,
  className,
  tasksSource,
  allowOtherTables = true,
  documentsSource,
  customSources,
  showAddButton = true
}: RowBindingV2Props) {
  const [isExpandedInternal, setIsExpandedInternal] = useState(false);
  const isExpanded = forceExpanded !== undefined ? forceExpanded : isExpandedInternal;
  const setIsExpanded = (value: boolean) => {
    if (forceExpanded === undefined) setIsExpandedInternal(value);
  };
  const [searchQuery, setSearchQuery] = useState('');

  // Selection state
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(
    defaultTableId || null
  );
  
  // Active tab for horizontal navigation
  // 'tasks' = Tickets (tasksSource), 'other' = pick any table,
  // 'documents' = favorites_config.documents, `favorite:<tableId>` = favorites_config.custom[i]
  type BindingTab = 'tasks' | 'other' | 'documents' | `favorite:${number}`;
  // Auto-pick first available tab (caller may pass only one source — e.g. only documentsSource).
  const initialTab: BindingTab = useMemo(() => {
    if (tasksSource) return 'tasks';
    if (documentsSource) return 'documents';
    if (customSources && customSources.length > 0) return `favorite:${customSources[0].tableId}` as BindingTab;
    return 'other';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [activeTab, setActiveTab] = useState<BindingTab>(initialTab);

  // Resolve the currently-active favorite (documents or custom by id)
  const activeFavorite: FavoriteTable | undefined = useMemo(() => {
    if (activeTab === 'documents') return documentsSource;
    if (typeof activeTab === 'string' && activeTab.startsWith('favorite:')) {
      const id = Number(activeTab.slice('favorite:'.length));
      return (customSources || []).find(c => c.tableId === id);
    }
    return undefined;
  }, [activeTab, documentsSource, customSources]);

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

  // Column name aliases for auto-detection (same as AIChatPanel.utils)
  const TITLE_ALIASES = ['title', 'what', 'name', 'subject', 'Название'];

  // Get display value for a row
  const getRowDisplayValue = (row: RowInfo, displayField?: string) => {
    const data = row.data as Record<string, unknown>;
    // Try configured display field first
    if (selectedTableInfo?.displayField && data[selectedTableInfo.displayField]) {
      return String(data[selectedTableInfo.displayField]);
    }
    // Try aliases
    for (const alias of TITLE_ALIASES) {
      if (data[alias]) return String(data[alias]);
    }
    return `#${row.id}`;
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

  // (Tasks/Documents/Favorite selection now handled inside <RowList /> shared component.)

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

  // In popup mode (whenever the caller hides the header) the parent already
  // provides a card border/background — skip our own to avoid the
  // frames-within-frames look.
  const isInPopup = hideHeader;
  return (
    <div className={cn(!isInPopup && "rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)]", className)}>
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
          {/* Selection Section — Horizontal tabs */}
          {canAddMore && (
            <div>
              {isLoadingTables ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
                </div>
              ) : (
                <>
                  {!hideTabBar && (
                    <RowBindingTabBar
                      activeTab={activeTab}
                      setActiveTab={setActiveTab}
                      resetFavoriteSearch={() => { /* RowList owns its search state */ }}
                      tasksSource={tasksSource}
                      documentsSource={documentsSource}
                      customSources={customSources}
                      showOtherTab={allowOtherTables || !tasksSource}
                      onClose={onClose}
                    />
                  )}

                  {/* Tab content */}
                  <div className={cn(isInPopup ? "space-y-3" : "p-3 space-y-3")}>
                    {/* === Tasks Tab === */}
                    {activeTab === 'tasks' && tasksSource && (
                      <RowList
                        source={tasksSource as unknown as import('./RowBindingV2.RowList').RowListSource}
                        enabled={isExpanded}
                        boundRows={boundRows}
                        maxBindings={maxBindings}
                        onBind={onBind}
                        searchPlaceholder="Поиск задач..."
                        showAddButton={showAddButton}
                      />
                    )}

                    {/* === Favorite (Documents or Custom) Tab === */}
                    {activeFavorite && (activeTab === 'documents' || (typeof activeTab === 'string' && activeTab.startsWith('favorite:'))) && (
                      <RowList
                        source={activeFavorite as unknown as import('./RowBindingV2.RowList').RowListSource}
                        enabled={isExpanded}
                        boundRows={boundRows}
                        maxBindings={maxBindings}
                        onBind={onBind}
                        showAddButton={showAddButton}
                      />
                    )}

                    {/* === Other Tables Tab === */}
                    {activeTab === 'other' && (
                      <>
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
                                        <span className="text-[10px] text-[var(--text-tertiary)]">привязано</span>
                                      )}
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      )}

    </div>
  );
}
