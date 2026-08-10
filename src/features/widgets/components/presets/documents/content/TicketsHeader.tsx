/**
 * TicketsHeader — header + stats bar for tickets list view.
 * Extracted from TicketsListView per ADR-0012 §Phase 2.
 * `visibility` prop lets the future `tickets-list` preset render a stripped-down inline header.
 */

import { Ticket, BarChart3, ArrowUp, ArrowDown, X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { ViewModeToggle } from '@/shared/components/ui/ViewModeToggle';
import { getStateColor, type TicketDictItem } from './ticketUtils';

export type TicketsSortBy = 'created' | 'updated' | 'state' | 'priority';
export type TicketsSortOrder = 'asc' | 'desc';
export type TicketsDisplayMode = 'list' | 'cards';

export interface TicketsHeaderVisibility {
  title?: boolean;
  viewMode?: boolean;
  stats?: boolean;
  sort?: boolean;
}

export interface TicketsHeaderProps {
  title: string;
  subtitle: string;
  source?: string | null;
  displayMode: TicketsDisplayMode;
  onDisplayModeChange: (mode: TicketsDisplayMode) => void;

  totalCount: number;
  stats: Record<number, number>;
  stateOptions: Array<{ value: number; label: string }>;
  states: TicketDictItem[];
  stateFilter: number[];
  onStateFilterChange: (filter: number[]) => void;

  sortBy: TicketsSortBy;
  onSortByChange: (sort: TicketsSortBy) => void;
  sortOrder: TicketsSortOrder;
  onSortOrderChange: (order: TicketsSortOrder) => void;

  visibility?: TicketsHeaderVisibility;
}

export function TicketsHeader({
  title,
  subtitle,
  source,
  displayMode,
  onDisplayModeChange,
  totalCount,
  stats,
  stateOptions,
  states,
  stateFilter,
  onStateFilterChange,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderChange,
  visibility,
}: TicketsHeaderProps) {
  const showTitle = visibility?.title ?? true;
  const showViewMode = visibility?.viewMode ?? true;
  const showStats = visibility?.stats ?? true;
  const showSort = visibility?.sort ?? true;

  const statsBarVisible = showStats && totalCount > 0 && stateOptions.length > 1;

  return (
    <>
      {showTitle && (
        <div className="flex items-center gap-2 mb-3 pb-3 border-b border-[var(--border-primary)]">
          <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
            <Ticket className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate">{title}</h1>
            <p className="text-[10px] text-[var(--text-tertiary)] truncate">
              {subtitle}
              {source && source !== 'configured' && (
                <span className="ml-1.5 text-blue-400">({source})</span>
              )}
            </p>
          </div>
          {showViewMode && (
            <ViewModeToggle
              value={displayMode}
              onChange={onDisplayModeChange}
              size="sm"
            />
          )}
        </div>
      )}

      {statsBarVisible && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <BarChart3 className="w-3 h-3 text-[var(--text-tertiary)]" />
          {stateOptions.slice(1).map(opt => {
            const count = stats[opt.value] || 0;
            if (count === 0) return null;
            return (
              <button
                key={opt.value}
                onClick={() =>
                  onStateFilterChange(
                    stateFilter.includes(opt.value)
                      ? stateFilter.filter(s => s !== opt.value)
                      : [...stateFilter, opt.value]
                  )
                }
                className={cn(
                  'px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-all',
                  getStateColor(opt.value, states),
                  stateFilter.includes(opt.value) && 'ring-2 ring-current'
                )}
              >
                {opt.label}: {count}
              </button>
            );
          })}
          {stateFilter.length > 0 && (
            <button
              onClick={() => onStateFilterChange([])}
              className="px-1.5 py-0.5 rounded-md text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors flex items-center gap-0.5"
            >
              <X className="w-2.5 h-2.5" />
              Сбросить
            </button>
          )}

          {showSort && (
            <div className="ml-auto flex items-center gap-1">
              <select
                value={sortBy}
                onChange={e => onSortByChange(e.target.value as TicketsSortBy)}
                className="px-1.5 py-0.5 rounded-md text-[10px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-secondary)]"
              >
                <option value="created">По дате создания</option>
                <option value="updated">По дате обновления</option>
                <option value="state">По статусу</option>
                <option value="priority">По приоритету</option>
              </select>
              <button
                onClick={() => onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="p-0.5 rounded hover:bg-[var(--bg-secondary)] transition-colors"
                title={sortOrder === 'asc' ? 'По возрастанию' : 'По убыванию'}
              >
                {sortOrder === 'asc' ? (
                  <ArrowUp className="w-3 h-3 text-[var(--text-tertiary)]" />
                ) : (
                  <ArrowDown className="w-3 h-3 text-[var(--text-tertiary)]" />
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
