import { useState, useEffect, type RefObject } from 'react';
import { Search, X, Filter, Plus, RefreshCw, Zap, LayoutGrid, Table2, Printer, Settings, Settings2, Replace } from 'lucide-react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Input } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { ColumnModel, ColumnOption } from '../../types/table.types';
import type { PaginationInfo } from '../UniversalTable/UniversalTable';
import { AutomationModal } from './AutomationModal';
import { GoToRowInput } from './GoToRowInput';
import { RowPositionBar } from './RowPositionBar';
import { rowCountKey, useRelationOptions } from './utils';

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
  onGoToRow?: (rowNumber: number) => void;
  onAddRow?: () => void;
  addRowText?: string; // Custom text for add row button
  onRefresh?: () => void;
  /** Kept for callers; the refresh button no longer depends on it. */
  isExternal?: boolean;
  /** The element that scrolls the table; enables the position bar under the row count. */
  scrollContainerRef?: RefObject<HTMLElement | null>;
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
  onGoToRow,
  onAddRow,
  addRowText,
  onRefresh,
  scrollContainerRef,
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
  const { t, language } = useLanguage();
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
    ['text', 'number', 'email', 'url', 'phone', 'select', 'relation', 'textarea'].includes(col.type || ('column_type' in col && typeof col.column_type === 'string' ? col.column_type : ''))
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

  // Relation options for filter dropdowns (ADR-205 D4: shared lookup, see ./utils).
  // A lens column's list downloads when its dropdown is first hovered or focused, not on mount (AC6).
  const [openedFilterColumns, setOpenedFilterColumns] = useState<string[]>([]);
  const revealFilterOptions = (columnId: string) =>
    setOpenedFilterColumns((ids) => (ids.includes(columnId) ? ids : [...ids, columnId]));
  const { getColumnOptions } = useRelationOptions(columns, openedFilterColumns);

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
  // Row numbers are positions in the unfiltered table; with a search or filter active they no longer line up.
  const goToRowBlocked = hasActiveFilters || searchQuery.trim() !== '';
  const rowCountLabel = paginationInfo
    ? t(rowCountKey(language, paginationInfo.totalRows), { count: paginationInfo.totalRows.toLocaleString(language) })
    : '';

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
                        <input aria-label={column.displayName}
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
                <button type="button" aria-label="Закрыть выбор колонки"
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

        {/* Refresh — re-fetches rows and columns of any table, not only external ones */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            title={t('common.refresh') || 'Refresh'}
            className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
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
                <div
                  key={column.id}
                  className="relative group"
                  onMouseEnter={() => revealFilterOptions(column.id)}
                  onFocus={() => revealFilterOptions(column.id)}
                >
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

        {/* Row count - right side; on paged tables it opens an inline "go to row" field.
            Under it, the position bar shows where the visible rows sit in the whole table. */}
        {paginationInfo && paginationInfo.totalRows > 0 && (
          <div className="flex flex-col text-sm whitespace-nowrap">
            {onGoToRow && paginationInfo.totalPages > 1 ? (
              <GoToRowInput
                totalRows={paginationInfo.totalRows}
                rowCountLabel={rowCountLabel}
                blocked={goToRowBlocked}
                onGoToRow={onGoToRow}
              />
            ) : (
              <span className="text-[var(--text-secondary)]">{rowCountLabel}</span>
            )}
            {onGoToRow && scrollContainerRef && (
              <RowPositionBar
                pagination={paginationInfo}
                scrollContainerRef={scrollContainerRef}
                blocked={goToRowBlocked}
                onGoToRow={onGoToRow}
              />
            )}
          </div>
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
