import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, Check, Calendar, Search, Filter, RefreshCw, Printer, Settings, Table2, ArrowUpDown, Columns as ColumnsIcon, Layers, Tag, ListPlus } from 'lucide-react';
import type { KanbanToolbarProps, ColumnOption } from './kanban-types';
import { FilterPill } from './KanbanFilterPill';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export function KanbanToolbar({
  data, columnsInfo, relationData, widget, tableId,
  filterState,
  onAddRow, onAddCard, onAddColumn, onAddStatusRow, groupRelationTableId, onRefresh, onPrint, onSettings,
  groupByColumn, defaultGroupBy, divisionColumns, groupByOverride, setGroupByOverride, setColumnOrder,
  sortColumn, setSortColumn, sortDirection, setSortDirection,
  dateSortColumn, setDateSortColumn, dateSortDirection, setDateSortDirection,
  dateFilterFrom, setDateFilterFrom, dateFilterTo, setDateFilterTo,
  subGroupColumn, setSubGroupColumn,
}: KanbanToolbarProps) {
  const { t } = useLanguage();

  // Local UI state
  const [localSearchInput, setLocalSearchInput] = useState(filterState?.searchQuery || '');
  const [showAddFilter, setShowAddFilter] = useState(false);
  const [openFilterDropdown, setOpenFilterDropdown] = useState<string | null>(null);
  const addFilterBtnRef = useRef<HTMLButtonElement>(null);
  const filterDropdownRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [showSearchColumnSelect, setShowSearchColumnSelect] = useState(false);
  const searchColBtnRef = useRef<HTMLButtonElement>(null);
  const [showSortSelect, setShowSortSelect] = useState(false);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const [showDateSort, setShowDateSort] = useState(false);
  const dateSortBtnRef = useRef<HTMLButtonElement>(null);
  const [showSubGroupSelect, setShowSubGroupSelect] = useState(false);
  const subGroupBtnRef = useRef<HTMLButtonElement>(null);
  const [showDivisionSelect, setShowDivisionSelect] = useState(false);
  const divisionButtonRef = useRef<HTMLButtonElement>(null);

  // Sync local search input with parent
  useEffect(() => {
    if (filterState) setLocalSearchInput(filterState.searchQuery);
  }, [filterState?.searchQuery]);

  // Filter columns available for adding
  const filterStateTableColumns = filterState?.tableColumns;
  const filterStateActiveFilterColumns = filterState?.activeFilterColumns;
  const availableFilterColumns = useMemo(() => {
    if (!filterStateTableColumns || !filterStateActiveFilterColumns) return [];
    return filterStateTableColumns.filter(col => {
      if (filterStateActiveFilterColumns.includes(col.id)) return false;
      const colType = col.type || (col as any).column_type || '';
      const isFilterable = ['select', 'multi-select', 'multi_select', 'relation', 'date', 'datetime'].includes(colType) ||
        (col.config as Record<string, unknown>)?.relation?.enabled ||
        (col.config as Record<string, unknown>)?.relatedTableId;
      return isFilterable;
    });
  }, [filterStateTableColumns, filterStateActiveFilterColumns]);

  // Get options for a filter column — only registered options (config or relation table)
  const getFilterOptions = useCallback((col: { id: string; name: string; type: string; config?: Record<string, unknown> }): ColumnOption[] => {
    const cfg = col.config as { relation?: { enabled?: boolean; tableId?: string | number }; relatedTableId?: string | number; options?: ColumnOption[] } | undefined;
    const opts: ColumnOption[] = [];
    const relTableId = cfg?.relation?.tableId || cfg?.relatedTableId;
    if (relTableId && relationData) {
      const tableMap = relationData.get(String(relTableId));
      if (tableMap) {
        tableMap.forEach((opt, key) => opts.push({ value: key, label: opt.label, color: opt.color }));
      }
    }
    if (opts.length === 0 && cfg?.options) {
      (cfg.options as ColumnOption[]).forEach(opt => opts.push(opt));
    }
    return opts;
  }, [relationData]);

  // Active filter columns resolved
  const activeFilters = useMemo(() => {
    if (!filterStateActiveFilterColumns || !filterStateTableColumns) return [];
    return filterStateActiveFilterColumns
      .map(id => filterStateTableColumns.find(c => c.id === id))
      .filter(Boolean) as typeof filterStateTableColumns;
  }, [filterStateActiveFilterColumns, filterStateTableColumns]);

  const hasActiveFilters = filterState ? (
    Object.values(filterState.selectFilters).some(arr => arr.length > 0) ||
    Object.values(filterState.dateFilters).some(r => r.from || r.to)
  ) : false;

  // Sortable columns (text, number, select types — NOT date)
  const sortableColumns = useMemo(() => {
    return columnsInfo.filter(c => {
      const t = c.type || (c as any).column_type || '';
      if (['date', 'datetime', 'time'].includes(t)) return false;
      return ['text', 'number', 'select', 'multi-select', 'multi_select'].includes(t);
    });
  }, [columnsInfo]);

  // Date columns
  const dateColumns = useMemo(() => {
    const cols = columnsInfo.filter(c => {
      const colType = c.type || (c as any).column_type || '';
      return ['date', 'datetime', 'time'].includes(colType);
    });
    if (!cols.find(c => c.name === 'created_at')) {
      cols.push({ name: 'created_at', displayName: t('kanban.createdAt'), type: 'datetime' });
    }
    if (!cols.find(c => c.name === 'updated_at')) {
      cols.push({ name: 'updated_at', displayName: t('kanban.updatedAt'), type: 'datetime' });
    }
    return cols;
  }, [columnsInfo, t]);

  // Searchable columns
  const searchableColumns = useMemo(() => {
    if (!filterState?.tableColumns) return [];
    return filterState.tableColumns.filter(col =>
      ['text', 'number', 'email', 'url', 'phone', 'select', 'relation', 'textarea'].includes(col.type || (col as any).column_type || '')
    );
  }, [filterState?.tableColumns]);

  // Sub-groupable columns
  const subGroupableColumns = useMemo(() => {
    return columnsInfo.filter(c =>
      c.name !== groupByColumn && (
        c.type === 'select' || c.type === 'multi-select' ||
        c.config?.relation?.enabled || c.config?.relatedTableId
      )
    );
  }, [columnsInfo, groupByColumn]);

  const activeDivisionLabel = divisionColumns.find(c => c.name === groupByColumn)?.displayName || groupByColumn;

  const handleSearchSubmit = () => {
    if (filterState) filterState.onSearchChange(localSearchInput);
  };

  const handleSearchClear = () => {
    setLocalSearchInput('');
    if (filterState) filterState.onSearchChange('');
  };

  return (
    <div className="flex flex-col flex-shrink-0">
    <div className="flex flex-wrap items-center gap-1 px-3 py-2 border-t border-x border-[var(--border-primary)] rounded-t-2xl">
      {/* Add Ticket Button */}
      {(onAddRow || onAddCard) && (
        <button
          onClick={() => onAddRow ? onAddRow() : onAddCard?.('')}
          title={t('kanban.addTicket')}
          className="p-1.5 rounded-md bg-[var(--color-primary-600)] text-white hover:bg-[var(--color-primary-700)] transition-colors flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
        </button>
      )}

      {/* Open Table link */}
      {(tableId || widget.config?.table_id) && (
        <a
          href={`/tables/${tableId || widget.config?.table_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-md text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          title={t('kanban.openTable')}
        >
          <Table2 className="w-4 h-4" />
        </a>
      )}

      {/* Divider — between table link group and search/filter group */}
      <div className="w-px h-4 bg-[var(--border-primary)] mx-1" />

      {/* Search bar */}
      <div className="relative flex-1 max-w-md min-w-[200px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <input
          type="text"
          value={localSearchInput}
          onChange={(e) => setLocalSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearchSubmit(); if (e.key === 'Escape') handleSearchClear(); }}
          placeholder={t('common.searchPlaceholder')}
          className="w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] pl-9 pr-9 py-1.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)] outline-none focus:border-[var(--color-primary-500)] focus:ring-1 focus:ring-[var(--color-primary-500)] transition"
        />
        {localSearchInput && (
          <button
            onClick={handleSearchClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Search-by-column selector */}
      <div className="relative">
        <button
          ref={searchColBtnRef}
          onClick={(e) => { e.stopPropagation(); setShowSearchColumnSelect(!showSearchColumnSelect); }}
          className={`relative p-1.5 rounded-md transition-colors ${
            (filterState?.searchColumns?.length || 0) > 0
              ? 'bg-[var(--color-primary-500)] text-white'
              : 'hover:bg-[var(--bg-tertiary)]'
          }`}
          title={t('table.searchInColumns')}
        >
          <Filter className="w-4 h-4" />
          {(filterState?.searchColumns?.length || 0) > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-primary-700)] text-white text-[10px] font-medium flex items-center justify-center leading-none">
              {filterState!.searchColumns.length}
            </span>
          )}
        </button>
        {showSearchColumnSelect && createPortal(
          <div className="fixed inset-0 z-[9998]" onClick={() => setShowSearchColumnSelect(false)}>
            <div
              className="fixed z-[9999]"
              style={{
                top: (searchColBtnRef.current?.getBoundingClientRect().bottom || 0) + 4,
                left: searchColBtnRef.current?.getBoundingClientRect().left || 0,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl min-w-[220px] max-h-[300px] overflow-y-auto">
                <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium border-b border-[var(--border-primary)]">{t('table.searchInColumns')}</div>
                <div className="p-1.5">
                  <label className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[var(--bg-tertiary)] cursor-pointer transition border-b border-[var(--border-primary)] mb-1 pb-2">
                    <input
                      type="checkbox"
                      checked={!filterState?.searchColumns?.length}
                      onChange={() => filterState?.onSearchColumnsChange([])}
                      className="rounded"
                    />
                    <span className="text-xs font-medium text-[var(--text-primary)]">{t('table.allColumns')}</span>
                  </label>
                  {(searchableColumns.length > 0 ? searchableColumns : (filterState?.tableColumns || columnsInfo || [])).map(col => {
                    const isChecked = (filterState?.searchColumns || []).includes(col.id);
                    return (
                      <label key={col.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[var(--bg-tertiary)] cursor-pointer transition">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (!filterState) return;
                            const next = isChecked
                              ? filterState.searchColumns.filter(id => id !== col.id)
                              : [...filterState.searchColumns, col.id];
                            filterState.onSearchColumnsChange(next);
                          }}
                          className="rounded"
                        />
                        <span className="text-xs text-[var(--text-primary)]">{col.displayName || col.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>

      {/* Search button */}
      <button
        onClick={handleSearchSubmit}
        title={t('common.search')}
        className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        <Search className="w-4 h-4" />
      </button>

      {/* Add Filter Button */}
      {filterState && (
        <div className="relative">
          <button
            ref={addFilterBtnRef}
            onClick={(e) => { e.stopPropagation(); setShowAddFilter(!showAddFilter); }}
            title={t('table.addFilter')}
            className={`relative p-1.5 rounded-md transition-colors ${
              activeFilters.length > 0
                ? 'bg-[var(--color-primary-500)] text-white'
                : 'hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            <Plus className="w-4 h-4" />
            {activeFilters.length > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--color-primary-700)] text-white text-[10px] font-medium flex items-center justify-center leading-none">
                {activeFilters.length}
              </span>
            )}
          </button>
          {showAddFilter && createPortal(
            <div className="fixed inset-0 z-[9998]" onClick={() => setShowAddFilter(false)}>
              <div
                className="fixed z-[9999]"
                style={{
                  top: (addFilterBtnRef.current?.getBoundingClientRect().bottom || 0) + 4,
                  left: addFilterBtnRef.current?.getBoundingClientRect().left || 0,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl min-w-[200px] max-h-[300px] overflow-y-auto">
                  <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium border-b border-[var(--border-primary)]">{t('table.addFilter')}</div>
                  <div className="p-1">
                    {availableFilterColumns.length > 0 ? availableFilterColumns.map(col => (
                      <button
                        key={col.id}
                        onClick={() => {
                          filterState.onActiveFilterColumnsChange([...filterState.activeFilterColumns, col.id]);
                          setShowAddFilter(false);
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--bg-tertiary)] rounded transition flex items-center gap-2 text-[var(--text-secondary)]"
                      >
                        <Filter className="w-3 h-3 opacity-50" />
                        {col.displayName || col.name}
                      </button>
                    )) : (
                      <div className="px-3 py-2 text-xs text-[var(--text-tertiary)]">{t('kanban.allFiltersAdded')}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      )}

      {/* Active filter pills */}
      {filterState && activeFilters.map(col => (
        <FilterPill
          key={col.id}
          col={col}
          filterState={filterState}
          groupByColumn={groupByColumn}
          defaultGroupBy={defaultGroupBy}
          divisionColumns={divisionColumns}
          setGroupByOverride={setGroupByOverride}
          setColumnOrder={setColumnOrder}
          getFilterOptions={getFilterOptions}
          isOpen={openFilterDropdown === col.id}
          onToggle={() => setOpenFilterDropdown(openFilterDropdown === col.id ? null : col.id)}
          onClose={() => setOpenFilterDropdown(null)}
          registerRef={(el) => { if (el) filterDropdownRefs.current.set(col.id, el); }}
          getRect={() => filterDropdownRefs.current.get(col.id)?.getBoundingClientRect()}
        />
      ))}

      {/* Clear all filters */}
      {(hasActiveFilters || (filterState && activeFilters.length > 0) || sortColumn || subGroupColumn || dateSortColumn) && (
        <button
          onClick={() => {
            if (filterState) {
              filterState.onSelectFiltersChange({});
              filterState.onDateFiltersChange({});
              filterState.onActiveFilterColumnsChange([]);
            }
            setSortColumn(null);
            setSubGroupColumn(null);
            setGroupByOverride(null);
            setColumnOrder(null);
            setDateSortColumn(null);
            setDateFilterFrom('');
            setDateFilterTo('');
          }}
          className="p-1.5 rounded-md text-red-400 hover:bg-red-500/10 transition-colors"
          title={t('table.clearAllFilters')}
        >
          <X className="w-4 h-4" />
        </button>
      )}

      {/* Division/Grouping selector */}
      {divisionColumns.length > 0 && (
        <div className="relative">
          <button
            ref={divisionButtonRef}
            onClick={(e) => { e.stopPropagation(); setShowDivisionSelect(!showDivisionSelect); }}
            className={`p-1.5 rounded-md transition-colors ${
              groupByOverride
                ? 'bg-purple-500 text-white hover:bg-purple-600'
                : 'hover:bg-[var(--bg-tertiary)]'
            }`}
            title={`${t('kanban.division')}: ${activeDivisionLabel}`}
          >
            <Layers className="w-4 h-4" />
          </button>
          {showDivisionSelect && createPortal(
            <div className="fixed inset-0 z-[9998]" onClick={() => setShowDivisionSelect(false)}>
              <div
                className="fixed z-[9999]"
                style={{
                  top: (divisionButtonRef.current?.getBoundingClientRect().bottom || 0) + 4,
                  left: divisionButtonRef.current?.getBoundingClientRect().left || 0,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl p-1 min-w-[180px]">
                  <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">{t('kanban.divisionBy')}</div>
                  {divisionColumns.map(col => (
                    <button
                      key={col.name}
                      onClick={() => {
                        setGroupByOverride(col.name === defaultGroupBy ? null : col.name);
                        setColumnOrder(null);
                        setShowDivisionSelect(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-[var(--bg-tertiary)] rounded transition flex items-center gap-2 ${
                        groupByColumn === col.name ? 'font-medium text-[var(--color-primary-500)]' : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      {groupByColumn === col.name && <Check className="w-3 h-3" />}
                      {groupByColumn !== col.name && <div className="w-3 h-3" />}
                      {col.displayName || col.name}
                    </button>
                  ))}
                  {groupByOverride && (
                    <>
                      <div className="h-px bg-[var(--border-primary)] my-1" />
                      <button
                        onClick={() => { setGroupByOverride(null); setColumnOrder(null); setShowDivisionSelect(false); }}
                        className="w-full text-left px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded transition flex items-center gap-2"
                      >
                        <X className="w-3 h-3" />
                        {t('kanban.reset')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      )}

      {/* Sub-grouping inside columns */}
      {subGroupableColumns.length > 0 && (
        <div className="relative">
          <button
            ref={subGroupBtnRef}
            onClick={(e) => { e.stopPropagation(); setShowSubGroupSelect(!showSubGroupSelect); }}
            className={`p-1.5 rounded-md transition-colors ${
              subGroupColumn
                ? 'bg-green-500 text-white hover:bg-green-600'
                : 'hover:bg-[var(--bg-tertiary)]'
            }`}
            title={subGroupColumn
              ? `${t('kanban.subGroupActive')}: ${columnsInfo.find(c => c.name === subGroupColumn)?.displayName || subGroupColumn}`
              : t('kanban.subGroup')}
          >
            <ColumnsIcon className="w-4 h-4" />
          </button>
          {showSubGroupSelect && createPortal(
            <div className="fixed inset-0 z-[9998]" onClick={() => setShowSubGroupSelect(false)}>
              <div
                className="fixed z-[9999]"
                style={{
                  top: (subGroupBtnRef.current?.getBoundingClientRect().bottom || 0) + 4,
                  left: subGroupBtnRef.current?.getBoundingClientRect().left || 0,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl p-1 min-w-[180px]">
                  <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">{t('kanban.subGroupBy')}</div>
                  {subGroupableColumns.map(col => (
                    <button
                      key={col.name}
                      onClick={() => {
                        setSubGroupColumn(subGroupColumn === col.name ? null : col.name);
                        setShowSubGroupSelect(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-[var(--bg-tertiary)] rounded transition flex items-center gap-2 ${
                        subGroupColumn === col.name ? 'font-medium text-green-400' : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      {subGroupColumn === col.name && <Check className="w-3 h-3" />}
                      {subGroupColumn !== col.name && <div className="w-3 h-3" />}
                      {col.displayName || col.name}
                    </button>
                  ))}
                  {subGroupColumn && (
                    <>
                      <div className="h-px bg-[var(--border-primary)] my-1" />
                      <button
                        onClick={() => { setSubGroupColumn(null); setShowSubGroupSelect(false); }}
                        className="w-full text-left px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded transition flex items-center gap-2"
                      >
                        <X className="w-3 h-3" />
                        {t('kanban.reset')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      )}

      {/* Sorting selector */}
      {sortableColumns.length > 0 && (
        <div className="relative">
          <button
            ref={sortBtnRef}
            onClick={(e) => { e.stopPropagation(); setShowSortSelect(!showSortSelect); }}
            className={`p-1.5 rounded-md transition-colors ${
              sortColumn
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'hover:bg-[var(--bg-tertiary)]'
            }`}
            title={sortColumn
              ? `${t('kanban.sortActive')}: ${columnsInfo.find(c => c.name === sortColumn)?.displayName || sortColumn} ${sortDirection === 'asc' ? '↑' : '↓'}`
              : t('kanban.sort')}
          >
            <ArrowUpDown className="w-4 h-4" />
          </button>
          {showSortSelect && createPortal(
            <div className="fixed inset-0 z-[9998]" onClick={() => setShowSortSelect(false)}>
              <div
                className="fixed z-[9999]"
                style={{
                  top: (sortBtnRef.current?.getBoundingClientRect().bottom || 0) + 4,
                  left: sortBtnRef.current?.getBoundingClientRect().left || 0,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl p-1 min-w-[200px]">
                  <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">{t('kanban.sortBy')}</div>
                  {sortableColumns.map(col => {
                    const isActive = sortColumn === col.name;
                    return (
                      <button
                        key={col.name}
                        onClick={() => {
                          if (isActive) {
                            setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
                          } else {
                            setSortColumn(col.name);
                            setSortDirection('asc');
                          }
                        }}
                        className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-[var(--bg-tertiary)] rounded transition flex items-center gap-2 ${
                          isActive ? 'font-medium text-amber-400' : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        {isActive ? (
                          <span className="text-[10px] w-3 text-center">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                        ) : (
                          <div className="w-3 h-3" />
                        )}
                        {col.displayName || col.name}
                      </button>
                    );
                  })}
                  {sortColumn && (
                    <>
                      <div className="h-px bg-[var(--border-primary)] my-1" />
                      <button
                        onClick={() => { setSortColumn(null); setShowSortSelect(false); }}
                        className="w-full text-left px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded transition flex items-center gap-2"
                      >
                        <X className="w-3 h-3" />
                        {t('kanban.reset')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      )}

      {/* Date sort/filter */}
      {dateColumns.length > 0 && (
        <div className="relative">
          <button
            ref={dateSortBtnRef}
            onClick={(e) => { e.stopPropagation(); setShowDateSort(!showDateSort); }}
            className={`p-1.5 rounded-md transition-colors ${
              dateSortColumn
                ? 'bg-blue-500 text-white hover:bg-blue-600'
                : 'hover:bg-[var(--bg-tertiary)]'
            }`}
            title={dateSortColumn
              ? `${t('kanban.dateActive')}: ${columnsInfo.find(c => c.name === dateSortColumn)?.displayName || dateSortColumn}${
                  dateFilterFrom || dateFilterTo
                    ? ` (${dateFilterFrom && dateFilterTo ? `${dateFilterFrom} — ${dateFilterTo}` : dateFilterFrom ? `${t('table.fromDate')} ${dateFilterFrom}` : `${t('table.toDate')} ${dateFilterTo}`})`
                    : ''
                }`
              : t('kanban.dateFilter')}
          >
            <Calendar className="w-4 h-4" />
          </button>
          {showDateSort && createPortal(
            <div className="fixed inset-0 z-[9998]" onClick={() => setShowDateSort(false)}>
              <div
                className="fixed z-[9999]"
                style={{
                  top: (dateSortBtnRef.current?.getBoundingClientRect().bottom || 0) + 4,
                  left: dateSortBtnRef.current?.getBoundingClientRect().left || 0,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl p-1 min-w-[260px]">
                  <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">{t('kanban.dateColumn')}</div>
                  {dateColumns.map(col => {
                    const isActive = dateSortColumn === col.name;
                    return (
                      <button
                        key={col.name}
                        onClick={() => {
                          if (isActive) {
                            setDateSortDirection(d => d === 'asc' ? 'desc' : 'asc');
                          } else {
                            setDateSortColumn(col.name);
                            setDateSortDirection('desc');
                            setDateFilterFrom('');
                            setDateFilterTo('');
                          }
                        }}
                        className={`w-full text-left px-2.5 py-1.5 text-xs hover:bg-[var(--bg-tertiary)] rounded transition flex items-center gap-2 ${
                          isActive ? 'font-medium text-blue-400' : 'text-[var(--text-secondary)]'
                        }`}
                      >
                        {isActive ? (
                          <span className="text-[10px] w-3 text-center">{dateSortDirection === 'asc' ? '↑' : '↓'}</span>
                        ) : (
                          <Calendar className="w-3 h-3 opacity-40" />
                        )}
                        {col.displayName || col.name}
                      </button>
                    );
                  })}
                  {dateSortColumn && (
                    <>
                      <div className="h-px bg-[var(--border-primary)] my-1" />
                      <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-medium">{t('kanban.dateRange')}</div>
                      <div className="px-2.5 py-1 flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-[var(--text-tertiary)] w-6">{t('table.fromDate')}:</span>
                          <input
                            type="date"
                            value={dateFilterFrom}
                            onChange={(e) => setDateFilterFrom(e.target.value)}
                            className="flex-1 px-2 py-1 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-[var(--text-tertiary)] w-6">{t('table.toDate')}:</span>
                          <input
                            type="date"
                            value={dateFilterTo}
                            onChange={(e) => setDateFilterTo(e.target.value)}
                            className="flex-1 px-2 py-1 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                      <div className="h-px bg-[var(--border-primary)] my-1" />
                      <button
                        onClick={() => { setDateSortColumn(null); setDateFilterFrom(''); setDateFilterTo(''); setShowDateSort(false); }}
                        className="w-full text-left px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded transition flex items-center gap-2"
                      >
                        <X className="w-3 h-3" />
                        {t('kanban.reset')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      )}

      {/* Settings button */}
      {onSettings && (
        <button
          onClick={onSettings}
          className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
          title={t('table.tableSettings')}
        >
          <Settings className="w-4 h-4" />
        </button>
      )}

      {/* Print */}
      {onPrint && (
        <button
          onClick={onPrint}
          className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
          title={t('table.print')}
        >
          <Printer className="w-4 h-4" />
        </button>
      )}

      <div className="flex-1" />

      {/* Status admin buttons — appear depending on group column type */}
      {(onAddColumn || (onAddStatusRow && groupRelationTableId)) && (
        <>
          <div className="w-px h-4 bg-[var(--border-primary)] mx-1" />
          {/* Static-select: add option to column config */}
          {onAddColumn && !groupRelationTableId && (
            <button
              onClick={onAddColumn}
              title={t('kanban.addStatusOption') || 'Добавить статус (опцию)'}
              className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <Tag className="w-4 h-4" />
            </button>
          )}
          {/* Relation-select: add row in the linked statuses table */}
          {onAddStatusRow && groupRelationTableId && (
            <button
              onClick={onAddStatusRow}
              title={t('kanban.addStatusRow') || 'Добавить строку в таблицу статусов'}
              className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <ListPlus className="w-4 h-4" />
            </button>
          )}
        </>
      )}

      {/* Ticket count + Refresh */}
      <div className="flex items-center gap-2 text-sm whitespace-nowrap">
        <span className="text-[var(--text-tertiary)]">{(data || []).length} {t('kanban.tickets')}</span>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)] transition-colors"
            title={t('common.refresh')}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
    {/* Thin separator between toolbar and kanban board (matches TableFilters) */}
    <div className="h-px bg-[var(--border-primary)] border-x border-[var(--border-primary)]" />
    </div>
  );
}
