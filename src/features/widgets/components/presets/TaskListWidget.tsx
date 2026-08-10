import { useState, useCallback, useMemo } from 'react';
import { CheckSquare, Eye, EyeOff, Filter } from 'lucide-react';
import type { PresetWidgetProps } from '../../types/widget.types';
import { useIsPublicReadOnly } from '@/features/public/PublicViewContext';
import {
  BDD_FILTERS,
  BDD_FILTER_LABELS,
  type BddFilter,
  isVerified,
  isRegressed,
  matchesBddFilter,
} from '@/components/bdd/bdd-status-helpers';
import { cn } from '@/shared/utils/cn';
import { BddTaskRow } from './task-list/BddTaskRow';
import { TaskCard, type TaskItem, type ColumnInfo } from './task-list/TaskCard';
import type { FieldValue } from './kanban/kanban-types';

interface TaskListWidgetProps extends PresetWidgetProps {
  columnsInfo?: ColumnInfo[];
  completedColumn?: string;       // Column that stores completion status
  cardTitleColumn?: string;       // Column for card title
  cardSubtitleColumn?: string;    // Column for card subtitle
  scheduledDateColumn?: string;   // Start date
  dueDateColumn?: string;         // Due date
  colorColumn?: string;           // Color column
  cardColumns?: string[];         // Additional visible columns
  visibleColumns?: string[];      // Which columns to show
  compact?: boolean;
  onTaskToggle?: (taskId: string, completed: boolean) => void;
  onTaskDoubleClick?: (task: TaskItem, initialTab?: 'details' | 'files' | 'comments') => void;
  onTaskUpdate?: (taskId: string, field: string, value: FieldValue) => void;
  translations?: {
    openFull?: string;
    comments?: string;
    description?: string;
    noDescription?: string;
    moreFields?: string;
  };
}

// --- Filter Tabs Component ---
type FilterMode = 'all' | 'active' | 'completed';

interface FilterTabsProps {
  mode: FilterMode;
  onChange: (mode: FilterMode) => void;
  counts: {
    all: number;
    active: number;
    completed: number;
  };
}

function FilterTabs({ mode, onChange, counts }: FilterTabsProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-[var(--bg-secondary)] rounded-lg">
      <button
        onClick={() => onChange('all')}
        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
          mode === 'all' 
            ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm' 
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
        }`}
      >
        Все ({counts.all})
      </button>
      <button
        onClick={() => onChange('active')}
        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
          mode === 'active' 
            ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm' 
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
        }`}
      >
        Активные ({counts.active})
      </button>
      <button
        onClick={() => onChange('completed')}
        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
          mode === 'completed' 
            ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm' 
            : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
        }`}
      >
        Выполненные ({counts.completed})
      </button>
    </div>
  );
}

// --- BDD Filter Tabs (ADR-0003 vocabulary: all / locked / unlocked / regressed) ---
interface BddFilterTabsProps {
  mode: BddFilter;
  onChange: (mode: BddFilter) => void;
  counts: Record<BddFilter, number>;
}

function BddFilterTabs({ mode, onChange, counts }: BddFilterTabsProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-[var(--bg-secondary)] rounded-lg">
      {BDD_FILTERS.map(f => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={cn(
            'px-3 py-1 text-xs font-medium rounded-md transition-colors',
            mode === f
              ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
          )}
        >
          {BDD_FILTER_LABELS[f]} ({counts[f]})
        </button>
      ))}
    </div>
  );
}

// --- Main TaskListWidget ---
export function TaskListWidget({
  widget,
  data,
  columnsInfo = [],
  completedColumn,
  cardTitleColumn,
  cardSubtitleColumn,
  scheduledDateColumn,
  dueDateColumn,
  colorColumn,
  cardColumns = [],
  visibleColumns = [],
  compact = false,
  onTaskToggle: rawOnTaskToggle,
  onTaskDoubleClick,
  onTaskUpdate: rawOnTaskUpdate,
  translations = {},
}: TaskListWidgetProps) {
  // ADR-0060 P5c — drop mutation callbacks in public read-only scope so the
  // checkbox toggle + inline-edit affordances don't fire mutations the hook
  // layer would silently swallow anyway.
  const publicReadOnly = useIsPublicReadOnly();
  const onTaskToggle = publicReadOnly ? undefined : rawOnTaskToggle;
  const onTaskUpdate = publicReadOnly ? undefined : rawOnTaskUpdate;
  // Get config from widget
  const config = widget.config || {};
  const bddMode = config.bdd_mode === true;

  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [bddFilter, setBddFilter] = useState<BddFilter>('all');
  const titleCol = cardTitleColumn || config.card_title_column || (bddMode ? 'title' : 'title');
  const subtitleCol = cardSubtitleColumn || config.card_subtitle_column || (bddMode ? 'description' : 'description');
  const completedCol = completedColumn || config.completed_column || config.status_column || (bddMode ? 'status' : 'completed');
  const startDateCol = scheduledDateColumn || config.scheduled_date_column;
  const endDateCol = dueDateColumn || config.due_date_column;
  const colorCol = colorColumn || config.color_column;
  const cardCols = cardColumns.length > 0 ? cardColumns : (config.card_columns || []);
  const visCols = visibleColumns.length > 0 ? visibleColumns : (config.visible_columns || []);
  const bddCodeCol = (config.bdd_code_column as string) || 'code';
  const bddPriorityCol = (config.bdd_priority_column as string) || 'priority';
  const bddStatusCol = (config.bdd_status_column as string) || 'status';
  
  // Convert data to TaskItem format
  const tasks: TaskItem[] = useMemo(() => {
    if (!data || !Array.isArray(data)) return [];
    return data.map((item) => ({
      id: String(item.id || item.data?.id),
      data: item.data || item,
    }));
  }, [data]);

  // Check if task is completed
  const isTaskCompleted = useCallback((task: TaskItem): boolean => {
    if (bddMode) {
      return isVerified(task.data[bddStatusCol] as string | null | undefined);
    }
    const value = task.data[completedCol];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return ['done', 'completed', 'завершено', 'выполнено', 'true', '1', 'yes'].includes(value.toLowerCase());
    }
    if (typeof value === 'number') return value === 1;
    return false;
  }, [completedCol, bddMode, bddStatusCol]);
  
  // Calculate counts
  const counts = useMemo(() => {
    const all = tasks.length;
    const completed = tasks.filter(isTaskCompleted).length;
    const active = all - completed;
    return { all, active, completed };
  }, [tasks, isTaskCompleted]);

  // BDD-specific counts (ADR-0003 vocabulary)
  const bddCounts = useMemo<Record<BddFilter, number>>(() => {
    const base = { all: 0, locked: 0, unlocked: 0, regressed: 0 };
    if (!bddMode) return base;
    base.all = tasks.length;
    for (const t of tasks) {
      const s = t.data[bddStatusCol] as string | null | undefined;
      if (isVerified(s)) base.locked++;
      else if (isRegressed(s)) base.regressed++;
      else base.unlocked++;
    }
    return base;
  }, [tasks, bddMode, bddStatusCol]);

  // BDD must-progress stats (used by progress bar in bdd_mode)
  const bddMustStats = useMemo(() => {
    if (!bddMode) return { total: 0, verified: 0, regressed: 0 };
    let total = 0;
    let verified = 0;
    let regressed = 0;
    for (const t of tasks) {
      const priority = String(t.data[bddPriorityCol] || '').toLowerCase();
      if (priority !== 'must') continue;
      total++;
      const s = t.data[bddStatusCol] as string | null | undefined;
      if (isVerified(s)) verified++;
      if (isRegressed(s)) regressed++;
    }
    return { total, verified, regressed };
  }, [tasks, bddMode, bddPriorityCol, bddStatusCol]);

  // Filter tasks based on mode
  const filteredTasks = useMemo(() => {
    if (bddMode) {
      return tasks.filter(t => matchesBddFilter(t.data[bddStatusCol] as string | null | undefined, bddFilter));
    }
    switch (filterMode) {
      case 'active':
        return tasks.filter(t => !isTaskCompleted(t));
      case 'completed':
        return tasks.filter(t => isTaskCompleted(t));
      default:
        return tasks;
    }
  }, [tasks, filterMode, isTaskCompleted, bddMode, bddFilter, bddStatusCol]);
  
  // Sort tasks: active first, then completed
  const sortedTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => {
      const aCompleted = isTaskCompleted(a);
      const bCompleted = isTaskCompleted(b);
      if (aCompleted === bCompleted) return 0;
      return aCompleted ? 1 : -1;
    });
  }, [filteredTasks, isTaskCompleted]);
  
  const handleTaskToggle = (taskId: string, completed: boolean) => {
    // Determine the value to set based on column type
    const colInfo = columnsInfo.find(c => c.name === completedCol);
    let newValue: FieldValue = completed;
    
    if (colInfo?.type === 'select') {
      // For select columns, use appropriate status value
      const options = colInfo.config?.options || [];
      const completedOption = options.find(o => 
        ['done', 'completed', 'завершено', 'выполнено'].includes(o.value.toLowerCase())
      );
      const activeOption = options.find(o => 
        ['active', 'in progress', 'в работе', 'todo', 'новый'].includes(o.value.toLowerCase())
      );
      newValue = completed 
        ? (completedOption?.value || 'completed')
        : (activeOption?.value || 'active');
    }
    
    onTaskToggle?.(taskId, completed);
    onTaskUpdate?.(taskId, completedCol, newValue);
  };
  
  // Empty state
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)] p-6">
        <CheckSquare className="w-12 h-12 mb-3 opacity-50" />
        <p className="text-base font-medium mb-1">Нет задач</p>
        <p className="text-sm">Добавьте записи в таблицу</p>
      </div>
    );
  }
  
  // BDD-mode progress (must_verified / must_total) — falls back to counts in non-BDD
  const mustPct = bddMustStats.total > 0
    ? Math.round((bddMustStats.verified / bddMustStats.total) * 100)
    : 0;
  const mustProgressColor = bddMustStats.regressed > 0
    ? 'bg-red-500'
    : bddMustStats.total > 0 && bddMustStats.verified === bddMustStats.total
      ? 'bg-green-500'
      : 'bg-amber-500';

  return (
    <div className="flex flex-col h-full">
      {/* Filter tabs */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-[var(--border-secondary)]">
        {bddMode ? (
          <BddFilterTabs mode={bddFilter} onChange={setBddFilter} counts={bddCounts} />
        ) : (
          <FilterTabs mode={filterMode} onChange={setFilterMode} counts={counts} />
        )}
      </div>

      {/* Task list */}
      <div className={cn('flex-1 overflow-y-auto p-3', bddMode ? 'space-y-1' : 'space-y-2')}>
        {sortedTasks.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-tertiary)]">
            {bddMode
              ? (bddFilter === 'locked' ? 'Нет verified критериев'
                : bddFilter === 'unlocked' ? 'Нет открытых критериев'
                : bddFilter === 'regressed' ? 'Нет регрессий'
                : 'Нет критериев')
              : (filterMode === 'active' ? 'Нет активных задач'
                : filterMode === 'completed' ? 'Нет выполненных задач'
                : 'Нет задач')}
          </div>
        ) : bddMode ? (
          sortedTasks.map(task => (
            <BddTaskRow
              key={task.id}
              item={task}
              codeCol={bddCodeCol}
              priorityCol={bddPriorityCol}
              statusCol={bddStatusCol}
              titleCol={titleCol}
              onDoubleClick={(tab) => onTaskDoubleClick?.(task, tab)}
            />
          ))
        ) : (
          sortedTasks.map((task) => (
            <TaskCard
              key={task.id}
              item={task}
              isCompleted={isTaskCompleted(task)}
              cardTitleColumn={titleCol}
              cardSubtitleColumn={subtitleCol}
              scheduledDateColumn={startDateCol}
              dueDateColumn={endDateCol}
              colorColumn={colorCol}
              cardColumns={cardCols}
              visibleColumns={visCols}
              columnsInfo={columnsInfo}
              onToggle={(completed) => handleTaskToggle(task.id, completed)}
              onDoubleClick={(tab) => onTaskDoubleClick?.(task, tab)}
              onUpdate={(field, value) => onTaskUpdate?.(task.id, field, value)}
              translations={translations}
            />
          ))
        )}
      </div>

      {/* Progress bar */}
      <div className="flex-shrink-0 px-3 py-2 border-t border-[var(--border-secondary)]">
        {bddMode && bddMustStats.total > 0 ? (
          <>
            <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)] mb-1">
              <span className="font-mono">must {bddMustStats.verified}/{bddMustStats.total}</span>
              <span className="font-mono">
                {mustPct}%
                {bddMustStats.regressed > 0 && (
                  <span className="ml-2 text-red-500">{bddMustStats.regressed} regressed</span>
                )}
              </span>
            </div>
            <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-300', mustProgressColor)}
                style={{ width: `${mustPct}%` }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)] mb-1">
              <span>Прогресс</span>
              <span>{counts.completed} из {counts.all}</span>
            </div>
            <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all duration-300"
                style={{ width: counts.all > 0 ? `${(counts.completed / counts.all) * 100}%` : '0%' }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
