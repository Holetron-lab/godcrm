import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X, Layers } from 'lucide-react';
import type { ColumnOption, ColumnInfo, KanbanFilterState } from './kanban-types';

interface FilterPillProps {
  col: { id: string; name: string; displayName?: string; type: string; config?: Record<string, unknown> };
  filterState: KanbanFilterState;
  groupByColumn: string;
  defaultGroupBy: string;
  divisionColumns: ColumnInfo[];
  setGroupByOverride: (val: string | null) => void;
  setColumnOrder: (val: string[] | null) => void;
  getFilterOptions: (col: { id: string; name: string; type: string; config?: Record<string, unknown> }) => ColumnOption[];
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  registerRef: (el: HTMLButtonElement | null) => void;
  getRect: () => DOMRect | undefined;
}

export function FilterPill({
  col, filterState, groupByColumn, defaultGroupBy, divisionColumns,
  setGroupByOverride, setColumnOrder, getFilterOptions,
  isOpen, onToggle, onClose, registerRef, getRect,
}: FilterPillProps) {
  const colType = col.type || (col as any).column_type || '';
  const isDateCol = ['date', 'datetime'].includes(colType);
  const activeValues = filterState.selectFilters[col.id] || [];
  const dateRange = filterState.dateFilters[col.id] || {};
  const hasFilter = isDateCol ? !!(dateRange.from || dateRange.to) : activeValues.length > 0;
  const isGroupedBy = groupByColumn === col.name;
  const options = getFilterOptions(col);

  return (
    <div className="relative">
      <button
        ref={registerRef}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
          isGroupedBy
            ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
            : hasFilter
            ? 'bg-[var(--color-primary-500)]/15 text-[var(--color-primary-500)] border border-[var(--color-primary-500)]/30'
            : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
        }`}
      >
        {isGroupedBy && <Layers className="w-3 h-3" />}
        {col.displayName || col.name}
        {!isDateCol && hasFilter && <span className="text-[10px] opacity-70">({activeValues.length})</span>}
        <ChevronDown className="w-3 h-3 opacity-50" />
      </button>
      {isOpen && createPortal(
        <div className="fixed inset-0 z-[9998]" onClick={onClose}>
          <div
            className="fixed z-[9999]"
            style={{
              top: (getRect()?.bottom || 0) + 4,
              left: getRect()?.left || 0,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl min-w-[220px]">
              {/* Header */}
              <div className="px-3 py-2 border-b border-[var(--border-primary)] flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--text-secondary)]">{col.displayName || col.name}</span>
                <div className="flex items-center gap-1">
                  {hasFilter && (
                    <button
                      onClick={() => {
                        if (isDateCol) {
                          const { [col.id]: _, ...rest } = filterState.dateFilters;
                          filterState.onDateFiltersChange(rest);
                        } else {
                          const { [col.id]: _, ...rest } = filterState.selectFilters;
                          filterState.onSelectFiltersChange(rest);
                        }
                      }}
                      className="text-[10px] text-[var(--color-primary-500)] hover:underline"
                    >
                      Сброс
                    </button>
                  )}
                  <button
                    onClick={() => {
                      filterState.onActiveFilterColumnsChange(filterState.activeFilterColumns.filter(id => id !== col.id));
                      if (isDateCol) {
                        const { [col.id]: _, ...rest } = filterState.dateFilters;
                        filterState.onDateFiltersChange(rest);
                      } else {
                        const { [col.id]: _, ...rest } = filterState.selectFilters;
                        filterState.onSelectFiltersChange(rest);
                      }
                      onClose();
                    }}
                    className="p-0.5 rounded hover:bg-red-500/20 text-[var(--text-tertiary)] hover:text-red-500 transition"
                    title="Убрать фильтр"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Group-by toggle for select columns */}
              {!isDateCol && divisionColumns.some(d => d.name === col.name) && (
                <div className="px-3 py-1.5 border-b border-[var(--border-primary)]">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={groupByColumn === col.name}
                      onChange={() => {
                        if (groupByColumn === col.name) {
                          setGroupByOverride(null);
                        } else {
                          setGroupByOverride(col.name === defaultGroupBy ? null : col.name);
                        }
                        setColumnOrder(null);
                      }}
                      className="rounded"
                    />
                    <span className="text-xs font-medium text-purple-400">Группировать</span>
                  </label>
                </div>
              )}

              {/* Options / Date range */}
              {isDateCol ? (
                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--text-tertiary)] w-6">От</span>
                    <input
                      type="date"
                      value={dateRange.from || ''}
                      onChange={(e) => {
                        filterState.onDateFiltersChange({
                          ...filterState.dateFilters,
                          [col.id]: { ...dateRange, from: e.target.value }
                        });
                      }}
                      className="flex-1 px-2 py-1 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--text-tertiary)] w-6">До</span>
                    <input
                      type="date"
                      value={dateRange.to || ''}
                      onChange={(e) => {
                        filterState.onDateFiltersChange({
                          ...filterState.dateFilters,
                          [col.id]: { ...dateRange, to: e.target.value }
                        });
                      }}
                      className="flex-1 px-2 py-1 text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
                    />
                  </div>
                </div>
              ) : (
                <div className="max-h-[250px] overflow-y-auto p-1.5">
                  {options.map(opt => {
                    const isActive = activeValues.includes(opt.value);
                    return (
                      <label key={opt.value} className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[var(--bg-tertiary)] cursor-pointer transition">
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={() => {
                            const current = filterState.selectFilters[col.id] || [];
                            const next = isActive ? current.filter(v => v !== opt.value) : [...current, opt.value];
                            filterState.onSelectFiltersChange({ ...filterState.selectFilters, [col.id]: next });
                          }}
                          className="rounded"
                        />
                        {opt.color ? (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: `${opt.color}20`, color: opt.color }}>
                            {opt.label}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--text-primary)]">{opt.label}</span>
                        )}
                      </label>
                    );
                  })}
                  {options.length === 0 && (
                    <div className="text-xs text-[var(--text-tertiary)] text-center py-3">Нет опций</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
