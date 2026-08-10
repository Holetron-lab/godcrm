/**
 * PlanWidget.tsx
 * ADR-113: Agent Runtime Planning Tool — read-only plan checklist widget.
 *
 * Renders an interactive-looking (but read-only) checklist of plan tasks
 * within the chat message stream. Each task shows its status via an icon
 * and optional inline note. A header displays the plan title and a
 * completed/total progress counter.
 */

import React from 'react';
import { ClipboardList, CheckCircle2, Zap, Circle, AlertTriangle } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanTask {
  id: number;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  note?: string;
}

export interface PlanWidgetProps {
  tasks: PlanTask[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Status icon mapping — returns the icon element and associated color class. */
function taskStatusIcon(status: PlanTask['status']): { icon: React.ReactNode; color: string } {
  switch (status) {
    case 'completed':
      return {
        icon: <CheckCircle2 className="w-4 h-4" />,
        color: 'text-green-400',
      };
    case 'in_progress':
      return {
        icon: <Zap className="w-4 h-4 animate-pulse" />,
        color: 'text-yellow-400',
      };
    case 'blocked':
      return {
        icon: <AlertTriangle className="w-4 h-4" />,
        color: 'text-amber-500',
      };
    case 'pending':
    default:
      return {
        icon: <Circle className="w-4 h-4" />,
        color: 'text-[var(--text-tertiary)]',
      };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PlanWidget: React.FC<PlanWidgetProps> = ({ tasks }) => {
  if (!tasks || tasks.length === 0) return null;

  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const totalCount = tasks.length;
  const allDone = completedCount === totalCount;

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden mb-2',
        'bg-[var(--bg-tertiary)] border-[var(--border-secondary)]',
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between px-3 py-2',
          'border-b border-[var(--border-secondary)]',
          'bg-[var(--bg-secondary)]',
        )}
      >
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-purple-400" />
          <span className="text-sm font-medium text-[var(--text-primary)]">
            Agent Plan
          </span>
        </div>
        <span
          className={cn(
            'text-xs font-medium tabular-nums',
            allDone ? 'text-green-400' : 'text-[var(--text-tertiary)]',
          )}
        >
          {completedCount}/{totalCount}
        </span>
      </div>

      {/* Task list */}
      <div className="px-3 py-2 space-y-1">
        {tasks.map((task, idx) => {
          const { icon, color } = taskStatusIcon(task.status);

          return (
            <div
              key={task.id ?? idx}
              className={cn(
                'flex items-start gap-2 py-1 rounded-md px-1',
                task.status === 'in_progress' && 'bg-yellow-500/5',
              )}
            >
              {/* Status icon */}
              <span className={cn('flex-shrink-0 mt-0.5', color)}>
                {icon}
              </span>

              {/* Task number + title + note */}
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    'text-sm',
                    task.status === 'completed'
                      ? 'text-[var(--text-tertiary)] line-through'
                      : task.status === 'blocked'
                        ? 'text-amber-400/80'
                        : 'text-[var(--text-primary)]',
                  )}
                >
                  <span className="text-[var(--text-tertiary)] mr-1">{idx + 1}.</span>
                  {task.title}
                </span>

                {/* Optional note */}
                {task.note && (
                  <span className="ml-1.5 text-xs text-[var(--text-tertiary)] italic">
                    ({task.note})
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="px-3 pb-2">
          <div className="h-1 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500 ease-out',
                allDone ? 'bg-green-500' : 'bg-purple-500',
              )}
              style={{ width: `${(completedCount / totalCount) * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
