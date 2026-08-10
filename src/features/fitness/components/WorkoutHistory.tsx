/**
 * ADR-025: Workout History Component
 * List of all workouts with filters
 */

import { useState } from 'react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { WorkoutCard } from './WorkoutCard';
import { useWorkouts, useDeleteWorkout } from '../api/fitnessApi';
import type { FitnessWorkout } from '../types';

export interface WorkoutHistoryProps {
  spaceId: number;
  onViewWorkout?: (workout: FitnessWorkout) => void;
  onEditWorkout?: (workout: FitnessWorkout) => void;
  className?: string;
}

export function WorkoutHistory({ 
  spaceId, 
  onViewWorkout, 
  onEditWorkout,
  className 
}: WorkoutHistoryProps) {
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const { data: workouts, isLoading } = useWorkouts(spaceId);
  const deleteMutation = useDeleteWorkout();

  const sortedWorkouts = [...(workouts || [])].sort((a, b) => {
    const dateA = new Date(a.started_at).getTime();
    const dateB = new Date(b.started_at).getTime();
    return sortOrder === 'newest' ? dateB - dateA : dateA - dateB;
  });

  const handleDelete = async (workoutId: number) => {
    if (confirm('Удалить тренировку?')) {
      await deleteMutation.mutateAsync({ workoutId, spaceId });
    }
  };

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-[var(--color-primary-500)]" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header & Sort */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-[var(--text-primary)]">
          Все тренировки ({sortedWorkouts.length})
        </h3>
        <div className="flex gap-2">
          <Button
            variant={sortOrder === 'newest' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setSortOrder('newest')}
          >
            Новые
          </Button>
          <Button
            variant={sortOrder === 'oldest' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setSortOrder('oldest')}
          >
            Старые
          </Button>
        </div>
      </div>

      {/* Workouts Grid */}
      {sortedWorkouts.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sortedWorkouts.map((workout) => (
            <WorkoutCard
              key={workout.id}
              workout={workout}
              onView={onViewWorkout}
              onEdit={onEditWorkout}
              onDelete={handleDelete}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--border-primary)] p-8 text-center">
          <p className="text-[var(--text-muted)]">Пока нет тренировок</p>
        </div>
      )}
    </div>
  );
}
