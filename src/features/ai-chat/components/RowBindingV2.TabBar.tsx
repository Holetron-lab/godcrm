/**
 * RowBindingTabBar — horizontal tab strip for RowBindingV2.
 * Tabs: Tickets (tasksSource) → Documents (favorite) → custom favorites,
 * with "Другая таблица" pinned to the right (icon-only TableIcon, never
 * scrolls under) — mirrors the unified chat-attach popup layout.
 *
 * Tab icons are intentionally **monochrome lucide** (one shape per tab kind,
 * all in `currentColor`) so the strip reads as a uniform navigation row
 * regardless of which widget supplies the source. Per-row colour returns
 * inside the list via emoji + status pills.
 *
 * Extracted to keep RowBindingV2 under the 800-line cap (pre-commit hook).
 */
import { FileText, ListTodo, Table as TableIcon, X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { TasksSourceConfig, FavoriteTable } from './RowBindingV2';

type BindingTab = 'tasks' | 'other' | 'documents' | `favorite:${number}`;

interface RowBindingTabBarProps {
  activeTab: BindingTab;
  setActiveTab: (t: BindingTab) => void;
  resetFavoriteSearch: () => void;
  tasksSource?: TasksSourceConfig;
  documentsSource?: FavoriteTable;
  customSources?: FavoriteTable[];
  showOtherTab: boolean;
  /** When provided, renders a close button next to "Другая таблица". */
  onClose?: () => void;
}

const TAB_CLS_BASE =
  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors';
const TAB_CLS_ACTIVE = 'text-[var(--color-primary-500)] border-[var(--color-primary-500)]';
const TAB_CLS_INACTIVE = 'text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-primary)]';

export function RowBindingTabBar({
  activeTab,
  setActiveTab,
  resetFavoriteSearch,
  tasksSource,
  documentsSource,
  customSources,
  showOtherTab,
  onClose,
}: RowBindingTabBarProps) {
  return (
    <div className="flex items-stretch border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
      {/* ── Scrollable tabs (browser-tab style) ── */}
      <div className="flex items-center flex-1 min-w-0 overflow-x-auto">
        {tasksSource && (
          <button
            onClick={() => setActiveTab('tasks')}
            className={cn(TAB_CLS_BASE, activeTab === 'tasks' ? TAB_CLS_ACTIVE : TAB_CLS_INACTIVE)}
          >
            <ListTodo className="w-3.5 h-3.5" />
            {tasksSource.tableName}
          </button>
        )}
        {documentsSource && (
          <button
            onClick={() => { setActiveTab('documents'); resetFavoriteSearch(); }}
            className={cn(TAB_CLS_BASE, activeTab === 'documents' ? TAB_CLS_ACTIVE : TAB_CLS_INACTIVE)}
          >
            <FileText className="w-3.5 h-3.5" />
            {documentsSource.tableName}
          </button>
        )}
        {(customSources || []).map(c => {
          const tabId = `favorite:${c.tableId}` as const;
          return (
            <button
              key={c.tableId}
              onClick={() => { setActiveTab(tabId); resetFavoriteSearch(); }}
              className={cn(TAB_CLS_BASE, activeTab === tabId ? TAB_CLS_ACTIVE : TAB_CLS_INACTIVE)}
            >
              <TableIcon className="w-3.5 h-3.5" />
              {c.tableName}
            </button>
          );
        })}
      </div>
      {/* ── Right-pinned: Другая таблица + Close (never scroll) ── */}
      {(showOtherTab || onClose) && (
        <div className="flex items-center flex-shrink-0 border-l border-[var(--border-secondary)]">
          {showOtherTab && (
            <button
              onClick={() => setActiveTab('other')}
              title="Другая таблица"
              className={cn(
                'flex items-center px-2 py-1.5 whitespace-nowrap transition-colors border-b-2 self-stretch',
                activeTab === 'other' ? TAB_CLS_ACTIVE : TAB_CLS_INACTIVE
              )}
            >
              <TableIcon className="w-3.5 h-3.5" />
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              title="Закрыть"
              className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
