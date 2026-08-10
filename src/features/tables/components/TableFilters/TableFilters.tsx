import { useState, useEffect, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { Search, X, Filter, Plus, RefreshCw, Zap, LayoutGrid, Table2, Printer, Settings, Settings2, Replace } from 'lucide-react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnModel, ColumnOption } from '../../types/table.types';
import type { PaginationInfo } from '../UniversalTable/UniversalTable';
import { AutomationModal } from './AutomationModal';

interface DateRange {
  from?: string;
  to?: string;
}

interface TableFiltersProps {
  columns: ColumnModel[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchColumns: string[];
  onSearchColumnsChange: (columnIds: string[])=> void;
  selectFilters: Record<string, string[]>;
  onSelectFiltersChange: (filters: Record<string, string[]>) => void;
  dateFilters: Record<string, DateRange>;
  onDateFiltersChange: (filters: Record<string, DateRange>) => void;
  activeFilterColumns: string[];
  onActiveFilterColumnsChange: (columnIds: string[]) => void;
  groupByColumn?: string | null;
  onGroupByColumnChange?: (columnId: string | null) => void;
  paginationInfo?: PaginationInfo | null;
  rowsLimit?: number;
  onRowsLimitChange?: (limit: number) => void;
  onPageChange?: (page: number) => void;
  onAddRow?: () => void;
  addRowText?: string; // Custom text for add row button
  onRefresh?: () => void;
  isExternal?: boolean;
  compact?: boolean; // Hide automations button, reduce padding
  projectId?: number; // For widget creation link
  rawMode?: boolean; // Whether in raw table mode
  tableIdProp?: number; // Table ID for widget creation with preselected table
  // Bulk replace
  onBulkReplace?: () => void;
  bulkReplaceDisabled?: boolean;
  showBulkReplace?: boolean;
  // Print
  onPrint?: () => void;
  showPrint?: boolean;
  // Table settings (gear icon)
  onTableSettings?: () => void;
  showTableSettings?: boolean;
}

export const TableFilters = ({
  columns,
  searchQuery,
  onSearchChange,
  searchColumns,
  onSearchColumnsChange,
  selectFilters,
  onSelectFiltersChange,
  dateFilters,
  onDateFiltersChange,
  activeFilterColumns,
  onActiveFilterColumnsChange,
  groupByColumn,
  onGroupByColumnChange,
  paginationInfo,
  rowsLimit = 50,
  onRowsLimitChange,
  onPageChange,
  onAddRow,
  addRowText,
  onRefresh,
  isExternal,
  compact = false,
  projectId,
  rawMode = false,
  tableIdProp,
  onBulkReplace,
  bulkReplaceDisabled = false,
  showBulkReplace = false,
  onPrint,
  showPrint = false,
  onTableSettings,
  showTableSettings = false
}: TableFiltersProps) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { tableId } = useParams<{ tableId: string }>();
  const [inputValue, setInputValue] = useState(searchQuery);
  const [showColumnSelector, setShowColumnSelector] = useState(false);
  const [showAddFilter, setShowAddFilter] = useState(false);
  const [showAutomationModal, setShowAutomationModal] = useState(false);
  const [showEditColumnPicker, setShowEditColumnPicker] = useState(false);

  const requestEditColumn = (columnId: string) => {
    const effectiveTableId = String(tableIdProp ?? tableId ?? '');
    if (!effectiveTableId) return;
    window.dispatchEvent(new CustomEvent('crm:open-column-settings', {
      detail: { tableId: effectiveTableId, columnId }
    }));
    setShowEditColumnPicker(false);
  };

  // Sync inputValue with searchQuery prop
  useEffect(() => {
    setInputValue(searchQuery);
  }, [searchQuery]);

  const handleSearch = () => {
    onSearchChange(inputValue);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleClear = () => {
    setInputValue('');
    onSearchChange('');
  };

  // Get searchable columns (text, number, email, url, phone + select/relation for broader search)
  const searchableColumns = (columns || []).filter(col =>
    ['text', 'number', 'email', 'url', 'phone', 'select', 'relation', 'textarea'].includes(col.type || col.column_type || '')
  );

  // Get select/multi-select columns for filtering
  // Note: backend stores type as 'multi_select' (underscore), frontend ColumnType uses 'multi-select' (hyphen)
  // We must check for both variants to handle all columns correctly
  const filterableColumns = (columns || []).filter(col =>
    ['select', 'multi-select', 'multi_select'].includes(col.type) &&
    (col.config?.options?.length || col.config?.relation?.enabled)
  );

  // Get date and select columns that can be added as filters
  const availableFilterColumns = (columns || []).filter(col =>
    ['select', 'multi-select', 'multi_select', 'date', 'datetime'].includes(col.type) &&
    !(activeFilterColumns || []).includes(col.id)
  );

  // Get active filter columns to display
  const activeFilters = (columns || []).filter(col =>
    (activeFilterColumns || []).includes(col.id) &&
    ['select', 'multi-select', 'multi_select', 'date', 'datetime'].includes(col.type)
  );

  // Find columns with relation configs that need data loading
  const relationColumns = useMemo(() => {
    const cols = Array.isArray(columns) ? columns : [];
    return cols.filter(col =>
      ['select', 'multi-select', 'multi_select'].includes(col.type) &&
      col.config?.relation?.enabled &&
      col.config?.relation?.tableId &&
      col.config?.relation?.valueColumn &&
      col.config?.relation?.labelColumn
    );
  }, [columns]);

  // Load relation options for filter dropdowns
  const { data: relationOptionsMap } = useQuery({
    queryKey: ['filter-relation-options', relationColumns.map(c => `${c.id}:${c.config?.relation?.tableId}`).join(',')],
    queryFn: async () => {
      const map = new Map<string, ColumnOption[]>();

      for (const col of relationColumns) {
        const relation = col.config?.relation;
        if (!relation?.tableId || !relation?.valueColumn || !relation?.labelColumn) continue;

        try {
          const response = await apiClient.request<{
            data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
          }>(`/tables/${relation.tableId}/rows?limit=5000`);

          // Handle different response formats
          const responseData = response.data as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
          const rowsData = Array.isArray(responseData)
            ? responseData
            : ((responseData as { rows?: Array<Record<string, unknown>>; data?: { rows: Array<Record<string, unknown>> } })?.rows ||
               (responseData as { data?: { rows: Array<Record<string, unknown>> } })?.data?.rows || []);

          type RowItem = { id?: string | number; data?: Record<string, unknown>; originalId?: string | number };
          const options: ColumnOption[] = rowsData.map((row: RowItem) => {
            const rowData = row.data && typeof row.data === 'object' ? row.data : (row as Record<string, unknown>);
            const rowId = row.id;
            const originalId = row.originalId;

            let val: string;
            if (relation.valueColumn === 'id') {
              val = String(originalId ?? rowData['id'] ?? rowId ?? '');
            } else {
              val = String(rowData[relation.valueColumn] ?? '');
            }

            return {
              value: val,
              label: String(rowData[relation.labelColumn] ?? ''),
              color: relation.colorColumn ? String(rowData[relation.colorColumn] ?? '') || undefined : undefined
            };
          });

          map.set(col.id, options);
        } catch (e) {
          logger.error('Failed to load relation options for filter column', col.id, e);
        }
      }

      return map;
    },
    enabled: relationColumns.length > 0,
    staleTime: 60000,
  });

  // Helper to get options for a column (relation or static)
  const getColumnOptions = (column: ColumnModel): ColumnOption[] => {
    const relationOpts = relationOptionsMap?.get(column.id);
    return relationOpts || column.config?.options || [];
  };

  const addFilterColumn = (columnId: string) => {
    onActiveFilterColumnsChange([...activeFilterColumns, columnId]);
    setShowAddFilter(false);
  };

  const removeFilterColumn = (columnId: string) => {
    onActiveFilterColumnsChange(activeFilterColumns.filter(id => id !== columnId));
    // Clear both select and date filters for this column
    clearSelectFilter(columnId);
    clearDateFilter(columnId);
  };

  const toggleSearchColumn = (columnId: string) => {
    if (searchColumns.includes(columnId)) {
      onSearchColumnsChange(searchColumns.filter(id => id !== columnId));
    } else {
      onSearchColumnsChange([...searchColumns, columnId]);
    }
  };

  const toggleSelectFilter = (columnId: string, optionValue: string) => {
    const currentFilters = selectFilters[columnId] || [];
    const newFilters = currentFilters.includes(optionValue)
      ? currentFilters.filter(v => v !== optionValue)
      : [...currentFilters, optionValue];

    onSelectFiltersChange({
      ...selectFilters,
      [columnId]: newFilters
    });
  };

  const clearSelectFilter = (columnId: string) => {
    const { [columnId]: _, ...rest } = selectFilters;
    onSelectFiltersChange(rest);
  };

  const setDateRange = (columnId: string, field: 'from' | 'to', value: string) => {
    const current = dateFilters[columnId] || {};
    onDateFiltersChange({
      ...dateFilters,
      [columnId]: {
        ...current,
        [field]: value
      }
    });
  };

  const clearDateFilter = (columnId: string) => {
    const { [columnId]: _, ...rest } = dateFilters;
    onDateFiltersChange(rest);
  };

  const hasActiveFilters = Object.values(selectFilters).some(arr => arr.length > 0) ||
                           Object.values(dateFilters).some(range => range.from || range.to);

  const allColumnsActive =
    searchColumns.length === 0 || searchColumns.length === searchableColumns.length;
  const searchScopeBadge = allColumnsActive ? null : searchColumns.length;
  const addRowTitle = addRowText || t('tableToolbar.addRow') || 'Add row';

  return (
    <div className="flex flex-col">
      {/* Toolbar strip — icon-only, no fill, top+side borders merge with table below (kanban-inspired) */}
      <div className="flex flex-wrap items-center gap-1 px-3 py-2 border-t border-x border-[var(--border-primary)] rounded-t-2xl">
        {/* Add Row */}
        {onAddRow && (
          <button
            onClick={onAddRow}
            title={addRowTitle}
            className="p-1.5 rounded-md bg-[var(--color-primary-600)] text-white hover:bg-[var(--color-primary-700)] transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}

        {/* Automations Button - Hide in compact mode, opens modal */}
        {tableId && !compact && (
          <button
            onClick={() => setShowAutomationModal(true)}
            title={t('table.automations') || 'Automations'}
            className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <Zap className="w-4 h-4" />
          </button>
        )}

        {/* Widget Button + Raw Table toggle - Only show when projectId is available */}
        {projectId && !compact && (
          <>
            <Link
              to={`/projects/${projectId}/widgets/create?tableId=${tableIdProp || tableId}`}
              title={t('table.newWidget') || 'New Widget'}
              className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <LayoutGrid className="w-4 h-4" />
            </Link>
            <Link
              to={rawMode ? `/tables/${tableIdProp || tableId}` : `/tables/${tableIdProp || tableId}?mode=raw`}
              title={rawMode ? (t('table.openTableView') || 'Open table view') : (t('table.rawTable') || 'Raw table')}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                rawMode
                  ? "bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)]"
                  : "hover:bg-[var(--bg-tertiary)]"
              )}
            >
              <Table2 className="w-4 h-4" />
            </Link>
          </>
        )}

        <div className="w-px h-4 bg-[var(--border-primary)] mx-1" />

        {/* Search Input */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <Input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={t('table.searchPlaceholder') || 'Search in table...'}
            className="pl-9 pr-9"
          />
          {inputValue && (
            <button
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Search trigger (Enter also triggers in input) */}
        <button
          onClick={handleSearch}
          title={t('common.search') || 'Search'}
          className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Column Selector — icon with optional count badge */}
        <div className="relative">
          <button
            onClick={() => setShowColumnSelector(!showColumnSelector)}
            title={t('table.searchInColumns') || 'Search in columns'}
            className={cn(
              "relative p-1.5 rounded-md transition-colors",
              searchScopeBadge !== null
                ? "bg-[var(--color-primary-500)] text-white"
                : "hover:bg-[var(--bg-tertiary)]"
            )}
          >
            <Filter className="w-4 h-4" />
            {searchScopeBadge !== null && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-primary-700)] text-white text-[10px] font-medium flex items-center justify-center leading-none">
                {searchScopeBadge}
              </span>
            )}
          </button>

              {showColumnSelector && (
                <div className="absolute top-full mt-2 left-0 z-50 min-w-[200px] rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg overflow-hidden">
                  <div className="p-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                    <div className="text-xs font-medium text-[var(--text-secondary)]">{t('table.searchInColumns')}</div>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto p-2 space-y-1">
                    <label className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={searchColumns.length === 0 || searchColumns.length === searchableColumns.length}
                        onChange={() => {
                          if (searchColumns.length === 0 || searchColumns.length === searchableColumns.length) {
                            onSearchColumnsChange([]);
                          } else {
                            onSearchColumnsChange(searchableColumns.map(c => c.id));
                          }
                        }}
                        className="rounded"
                      />
                      <span className="text-sm font-medium">{t('table.allColumns')}</span>
                    </label>
                    <div className="h-px bg-[var(--border-primary)] my-1" />
                    {(searchableColumns.length > 0 ? searchableColumns : (columns || [])).map(column => (
                      <label key={column.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={searchColumns.length === 0 || searchColumns.includes(column.id)}
                          onChange={() => toggleSearchColumn(column.id)}
                          className="rounded"
                        />
                        <span className="text-sm flex items-center gap-1">
                          <span className="flex-shrink-0 leading-none">{column.config?.appearance?.indicator?.value || '📋'}</span>
                          <span className="leading-none">{column.displayName}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
        </div>

        {/* Add Filter Button */}
        {availableFilterColumns.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowAddFilter(!showAddFilter)}
              title={t('table.addFilter') || 'Add filter'}
              className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>

            {showAddFilter && (
              <div className="absolute top-full mt-2 left-0 z-50 min-w-[200px] rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg overflow-hidden">
                <div className="p-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                  <div className="text-xs font-medium text-[var(--text-secondary)]">{t('table.selectColumn')}</div>
                </div>
                <div className="max-h-[300px] overflow-y-auto p-2 space-y-1">
                  {availableFilterColumns.map(column => (
                    <button
                      key={column.id}
                      onClick={() => addFilterColumn(column.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors text-left"
                    >
                      <span className="text-sm flex items-center gap-1">
                        <span className="flex-shrink-0 leading-none">{column.config?.appearance?.indicator?.value || '📋'}</span>
                        <span className="leading-none">{column.displayName}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="w-px h-4 bg-[var(--border-primary)] mx-1" />

        {/* Bulk Replace Button */}
        {showBulkReplace && onBulkReplace && (
          <button
            onClick={onBulkReplace}
            disabled={bulkReplaceDisabled}
            title={t('table.bulkReplace') || 'Замена'}
            className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Replace className="w-4 h-4" />
          </button>
        )}

        {/* Edit column picker — click, then pick a column to open its full settings */}
        {(columns || []).length > 0 && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowEditColumnPicker(v => !v)}
              title={t('table.editColumn') || 'Edit column'}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                showEditColumnPicker
                  ? "bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)]"
                  : "hover:bg-[var(--bg-tertiary)]"
              )}
            >
              <Settings2 className="w-4 h-4" />
            </button>

            {showEditColumnPicker && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowEditColumnPicker(false)}
                />
                <div className="absolute top-full mt-2 left-0 z-50 min-w-[240px] rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg overflow-hidden">
                  <div className="p-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                    <div className="text-xs font-medium text-[var(--text-secondary)]">
                      {t('table.pickColumnToEdit') || 'Выберите колонку'}
                    </div>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto p-1">
                    {(columns || []).map(column => (
                      <button
                        key={column.id}
                        type="button"
                        onClick={() => requestEditColumn(column.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-secondary)] text-left transition-colors"
                      >
                        <span className="flex-shrink-0 leading-none">{column.config?.appearance?.indicator?.value || '📋'}</span>
                        <span className="text-sm text-[var(--text-primary)] truncate">{column.displayName || column.name}</span>
                        <span className="ml-auto text-[10px] font-mono text-[var(--text-tertiary)] truncate max-w-[80px]">{column.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Table Settings Button */}
        {showTableSettings && onTableSettings && (
          <button
            onClick={onTableSettings}
            title={t('table.tableSettings')}
            className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        )}

        {/* Print Button */}
        {showPrint && onPrint && (
          <button
            onClick={onPrint}
            title={t('table.print')}
            className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <Printer className="w-4 h-4" />
          </button>
        )}

        {/* Active Filters - Same row */}
        {activeFilters.length > 0 && (
          <>
            {activeFilters.map(column => {
              const isDateColumn = ['date', 'datetime'].includes(column.type);

              if (isDateColumn) {
                // Date range filter
                const dateRange = dateFilters[column.id] || {};
                const hasDateFilter = dateRange.from || dateRange.to;

                return (
                  <div key={column.id} className="relative group">
                    <div className="flex items-center gap-2 px-4 py-1 rounded-lg text-sm bg-[var(--bg-primary)] h-[38px]">
                      <span className="whitespace-nowrap">{column.displayName}</span>
                      <div className="flex items-center gap-2">
                        <Input
                          type="date"
                          value={dateRange.from || ''}
                          onChange={(e) => setDateRange(column.id, 'from', e.target.value)}
                          placeholder={t('table.fromDate')}
                          className="w-32 text-xs bg-[var(--bg-secondary)] border-[var(--border-primary)]"
                        />
                        <span className="text-xs text-[var(--text-tertiary)]">—</span>
                        <Input
                          type="date"
                          value={dateRange.to || ''}
                          onChange={(e) => setDateRange(column.id, 'to', e.target.value)}
                          placeholder={t('table.toDate')}
                          className="w-32 text-xs bg-[var(--bg-secondary)] border-[var(--border-primary)]"
                        />
                        <button
                          onClick={() => {
                            removeFilterColumn(column.id);
                            clearDateFilter(column.id);
                          }}
                          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              // Select/Multi-select filter
              const activeSelectFilters = selectFilters[column.id] || [];
              const hasFilters = activeSelectFilters.length > 0;
              const isGrouped = groupByColumn === column.id;

              return (
                <div key={column.id} className="relative group">
                  <button
                    className={`px-4 py-2 rounded-lg text-sm transition-colors border whitespace-nowrap ${
                      isGrouped
                        ? 'bg-purple-500 text-white border-purple-500'
                        : hasFilters
                        ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                        : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    {isGrouped && '⊞ '}{column.displayName} {hasFilters && `(${activeSelectFilters.length})`}
                  </button>

                  {/* Dropdown with options */}
                  <div className="absolute top-full mt-2 left-0 z-50 min-w-[200px] rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
                    <div className="p-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-[var(--text-secondary)] flex-1">
                        {t('table.filterBy')} {column.displayName}
                      </div>
                      {hasFilters && (
                        <button
                          onClick={() => clearSelectFilter(column.id)}
                          className="text-xs text-[var(--color-primary)] hover:underline"
                        >
                          {t('table.clearFilter')}
                        </button>
                      )}
                      {/* Remove filter from active filters */}
                      <button
                        onClick={() => {
                          removeFilterColumn(column.id);
                          if (groupByColumn === column.id) {
                            onGroupByColumnChange?.(null);
                          }
                        }}
                        className="p-1 rounded hover:bg-red-500/20 text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                        title={t('table.removeFilter')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* Group by toggle */}
                    {onGroupByColumnChange && (
                      <div className="p-2 border-b border-[var(--border-primary)]">
                        <label className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors">
                          <input
                            type="checkbox"
                            checked={groupByColumn === column.id}
                            onChange={() => {
                              if (groupByColumn === column.id) {
                                onGroupByColumnChange(null);
                              } else {
                                onGroupByColumnChange(column.id);
                              }
                            }}
                            className="rounded"
                          />
                          <span className="text-sm font-medium text-[var(--color-primary)]">
                            {t('table.groupBy')}
                          </span>
                        </label>
                      </div>
                    )}

                    <div className="max-h-[300px] overflow-y-auto p-2 space-y-1">
                      {getColumnOptions(column).map((option: ColumnOption) => {
                        const isActive = activeSelectFilters.includes(option.value);
                        return (
                          <label
                            key={option.value}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={isActive}
                              onChange={() => toggleSelectFilter(column.id, option.value)}
                              className="rounded"
                            />
                            {option.color ? (
                              <span
                                className="text-sm px-2 py-0.5 rounded"
                                style={{
                                  backgroundColor: `${option.color}20`,
                                  color: option.color
                                }}
                              >
                                {option.label}
                              </span>
                            ) : (
                              <span className="text-sm">{option.label}</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}

            {hasActiveFilters && (
              <button
                onClick={() => {
                  onSelectFiltersChange({});
                  onDateFiltersChange({});
                  onActiveFilterColumnsChange([]);
                }}
                title={t('table.clearAllFilters') || 'Clear all filters'}
                className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </>
        )}

        {/* Spacer to push pagination controls to the right */}
        <div className="flex-1" />

        {/* Pagination Controls - Right side */}
        {paginationInfo && (
          <div className="flex items-center gap-3 text-sm whitespace-nowrap">
            {/* Rows per page selector */}
            <div className="flex items-center gap-2">
              <select
                value={rowsLimit}
                onChange={(e) => onRowsLimitChange?.(Number(e.target.value))}
                className="px-2 py-1 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm cursor-pointer hover:border-[var(--color-primary-400)] transition-colors"
              >
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
              <span className="text-[var(--text-tertiary)]">{t('table.rowsLabel')}</span>
            </div>

            {/* Page selector - only show if multiple pages */}
            {paginationInfo.totalPages > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-[var(--text-tertiary)]">·</span>
                <span className="text-[var(--text-tertiary)]">{t('table.pageLabel')}</span>
                <select
                  value={paginationInfo.currentPage}
                  onChange={(e) => onPageChange?.(Number(e.target.value))}
                  className="px-2 py-1 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] text-sm cursor-pointer hover:border-[var(--color-primary-400)] transition-colors"
                >
                  {Array.from({ length: paginationInfo.totalPages }, (_, i) => i + 1).map(page => (
                    <option key={page} value={page}>{page}</option>
                  ))}
                </select>
                <span className="text-[var(--text-tertiary)]">/</span>
                <span className="text-[var(--text-primary)] font-medium">{paginationInfo.totalPages}</span>
              </div>
            )}
          </div>
        )}

        {/* Refresh button for external tables - icon only */}
        {isExternal && onRefresh && (
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
            title={t('common.refresh') || 'Refresh'}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Thin separator between toolbar and table */}
      <div className="h-px bg-[var(--border-primary)] border-x border-[var(--border-primary)]" />

      {/* Automation Modal */}
      <AutomationModal
        open={showAutomationModal}
        onOpenChange={setShowAutomationModal}
        tableId={tableId}
      />
    </div>
  );
};
