/**
 * ADR-025: Workout Card Component  
 * Displays workout summary with sets preview
 */

import { cn } from '@/shared/utils/cn';
import type { FitnessWorkout } from '../types';
import { Button } from '@/shared/components/ui/Button';

export interface WorkoutCardProps {
  workout: FitnessWorkout;
  onView?: (workout: FitnessWorkout) => void;
  onEdit?: (workout: FitnessWorkout) => void;
  onDelete?: (workoutId: number) => void;
  className?: string;
}

function formatDuration(minutes: number | undefined): string {
  if (!minutes) return '—';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatWeight(kg: number): string {
  if (kg >= 1000) {
    return `${(kg / 1000).toFixed(1)}т`;
  }
  return `${kg.toLocaleString()}кг`;
}

export function WorkoutCard({ 
  workout, 
  onView,
  onEdit, 
  onDelete,
  className 
}: WorkoutCardProps) {
  return (
    <div className={cn(
      'rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 transition-colors hover:bg-[var(--bg-tertiary)]',
      className
    )}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-[var(--text-primary)]">
            {workout.title || 'Тренировка'}
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">
            {formatDate(workout.started_at)}
          </p>
        </div>
        {workout.pr_count && workout.pr_count > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-500">
            🏆 {workout.pr_count} PR
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">
            {workout.total_sets || 0}
          </p>
          <p className="text-xs text-[var(--text-muted)]">сетов</p>
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">
            {formatWeight(workout.workout_volume || 0)}
          </p>
          <p className="text-xs text-[var(--text-muted)]">объём</p>
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">
            {formatDuration(workout.duration_minutes)}
          </p>
          <p className="text-xs text-[var(--text-muted)]">время</p>
        </div>
      </div>

      {/* Notes preview */}
      {workout.notes && (
        <p className="mt-3 line-clamp-2 text-sm text-[var(--text-secondary)]">
          {workout.notes}
        </p>
      )}

      {/* Source badge */}
      {workout.source !== 'manual' && (
        <div className="mt-2">
          <span className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
            {workout.source.replace('csv_', '').toUpperCase()}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex gap-2">
        {onView && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onView(workout)}
            className="flex-1"
          >
            Открыть
          </Button>
        )}
        {onEdit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(workout)}
          >
            ✏️
          </Button>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(workout.id)}
            className="text-red-500 hover:text-red-600"
          >
            🗑️
          </Button>
        )}
      </div>
    </div>
  );
}
