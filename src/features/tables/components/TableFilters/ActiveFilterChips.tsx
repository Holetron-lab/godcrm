import { X } from 'lucide-react';
import { Input } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { ColumnModel, ColumnOption } from '../../types/table.types';
import type { DateRange } from './types';

interface ActiveFilterChipsProps {
  activeFilters: ColumnModel[];
  selectFilters: Record<string, string[]>;
  dateFilters: Record<string, DateRange>;
  groupByColumn?: string | null;
  onGroupByColumnChange?: (columnId: string | null) => void;
  onToggleSelectFilter: (columnId: string, optionValue: string) => void;
  onClearSelectFilter: (columnId: string) => void;
  onRemoveFilterColumn: (columnId: string) => void;
  onSetDateRange: (columnId: string, field: 'from' | 'to', value: string) => void;
  onClearDateFilter: (columnId: string) => void;
  onClearAllFilters: () => void;
  hasActiveFilters: boolean;
  getColumnOptions: (column: ColumnModel) => ColumnOption[];
}

export const ActiveFilterChips = ({
  activeFilters,
  selectFilters,
  dateFilters,
  groupByColumn,
  onGroupByColumnChange,
  onToggleSelectFilter,
  onClearSelectFilter,
  onRemoveFilterColumn,
  onSetDateRange,
  onClearDateFilter,
  onClearAllFilters,
  hasActiveFilters,
  getColumnOptions,
}: ActiveFilterChipsProps) => {
  const { t } = useLanguage();

  if (activeFilters.length === 0) return null;

  return (
    <>
      {activeFilters.map(column => {
        const isDateColumn = ['date', 'datetime'].includes(column.type);

        if (isDateColumn) {
          // Date range filter
          const dateRange = dateFilters[column.id] || {};

          return (
            <div key={column.id} className="relative group">
              <div className="flex items-center gap-2 px-4 py-1 rounded-lg text-sm bg-[var(--bg-primary)] h-[38px]">
                <span className="whitespace-nowrap">{column.displayName}</span>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={dateRange.from || ''}
                    onChange={(e) => onSetDateRange(column.id, 'from', e.target.value)}
                    placeholder="От"
                    className="w-32 text-xs bg-[var(--bg-secondary)] border-[var(--border-primary)]"
                  />
                  <span className="text-xs text-[var(--text-tertiary)]">—</span>
                  <Input
                    type="date"
                    value={dateRange.to || ''}
                    onChange={(e) => onSetDateRange(column.id, 'to', e.target.value)}
                    placeholder="До"
                    className="w-32 text-xs bg-[var(--bg-secondary)] border-[var(--border-primary)]"
                  />
                  <button
                    onClick={() => {
                      onRemoveFilterColumn(column.id);
                      onClearDateFilter(column.id);
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
                    onClick={() => onClearSelectFilter(column.id)}
                    className="text-xs text-[var(--color-primary)] hover:underline"
                  >
                    {t('table.clearFilter')}
                  </button>
                )}
                {/* Remove filter from active filters */}
                <button
                  onClick={() => {
                    onRemoveFilterColumn(column.id);
                    if (groupByColumn === column.id) {
                      onGroupByColumnChange?.(null);
                    }
                  }}
                  className="p-1 rounded hover:bg-red-500/20 text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                  title="Удалить фильтр"
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
                      Разбить на группы
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
                        onChange={() => onToggleSelectFilter(column.id, option.value)}
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
          onClick={onClearAllFilters}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] transition-colors min-w-[140px]"
        >
          <X className="h-4 w-4" />
          {t('table.clearAllFilters')}
        </button>
      )}
    </>
  );
};
