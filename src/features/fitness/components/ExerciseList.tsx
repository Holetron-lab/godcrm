/**
 * ADR-025: Exercise List Component
 * Catalog of exercises with search and muscle filter
 */

import { useState, useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import { Input } from '@/shared/components/ui/Input';
import { useExercises, useExerciseStats } from '../api/fitnessApi';
import type { FitnessExercise, ExerciseStats } from '../types';

export interface ExerciseListProps {
  spaceId: number;
  className?: string;
}

const muscleGroups = [
  { value: 'all', label: 'Все' },
  { value: 'chest', label: 'Грудь' },
  { value: 'back', label: 'Спина' },
  { value: 'shoulders', label: 'Плечи' },
  { value: 'biceps', label: 'Бицепс' },
  { value: 'triceps', label: 'Трицепс' },
  { value: 'forearms', label: 'Предплечья' },
  { value: 'abs', label: 'Пресс' },
  { value: 'quadriceps', label: 'Квадрицепс' },
  { value: 'hamstrings', label: 'Бицепс бедра' },
  { value: 'glutes', label: 'Ягодицы' },
  { value: 'calves', label: 'Икры' },
];

export function ExerciseList({ spaceId, className }: ExerciseListProps) {
  const [search, setSearch] = useState('');
  const [muscleFilter, setMuscleFilter] = useState('all');
  const [selectedExercise, setSelectedExercise] = useState<string | null>(null);
  
  const { data: exercises, isLoading } = useExercises(spaceId);
  const { data: stats } = useExerciseStats(spaceId, selectedExercise || '');

  const filteredExercises = useMemo(() => {
    if (!exercises) return [];
    
    return exercises.filter((ex) => {
      const matchesSearch = !search || 
        ex.name.toLowerCase().includes(search.toLowerCase());
      const matchesMuscle = muscleFilter === 'all' || 
        ex.primary_muscle === muscleFilter || 
        ex.secondary_muscle === muscleFilter;
      return matchesSearch && matchesMuscle;
    });
  }, [exercises, search, muscleFilter]);

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-[var(--color-primary-500)]" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Search & Filter */}
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[200px]">
          <Input
            placeholder="Поиск упражнения..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]"
          value={muscleFilter}
          onChange={(e) => setMuscleFilter(e.target.value)}
        >
          {muscleGroups.map((g) => (
            <option key={g.value} value={g.value}>{g.label}</option>
          ))}
        </select>
      </div>

      {/* Exercise Grid + Stats Panel */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* List */}
        <div className="lg:col-span-2">
          <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] divide-y divide-[var(--border-primary)]">
            {filteredExercises.length > 0 ? (
              filteredExercises.map((exercise) => (
                <ExerciseRow 
                  key={exercise.id} 
                  exercise={exercise}
                  isSelected={selectedExercise === exercise.name}
                  onClick={() => setSelectedExercise(exercise.name)}
                />
              ))
            ) : (
              <div className="p-8 text-center text-[var(--text-muted)]">
                Упражнения не найдены
              </div>
            )}
          </div>
        </div>

        {/* Stats Panel */}
        <div className="lg:col-span-1">
          {selectedExercise && stats ? (
            <ExerciseStatsPanel stats={stats} />
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--border-primary)] p-8 text-center text-[var(--text-muted)]">
              Выберите упражнение для просмотра статистики
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

interface ExerciseRowProps {
  exercise: FitnessExercise;
  isSelected: boolean;
  onClick: () => void;
}

function ExerciseRow({ exercise, isSelected, onClick }: ExerciseRowProps) {
  return (
    <button
      className={cn(
        'w-full px-4 py-3 text-left transition-colors hover:bg-[var(--bg-tertiary)]',
        isSelected && 'bg-[var(--color-primary-500)]/10'
      )}
      onClick={onClick}
    >
      <p className="font-medium text-[var(--text-primary)]">{exercise.name}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {exercise.primary_muscle && (
          <span className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
            {exercise.primary_muscle}
          </span>
        )}
        {exercise.equipment && (
          <span className="rounded bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
            {exercise.equipment}
          </span>
        )}
      </div>
    </button>
  );
}

interface ExerciseStatsPanelProps {
  stats: ExerciseStats;
}

function ExerciseStatsPanel({ stats }: ExerciseStatsPanelProps) {
  // PostgreSQL returns numeric values as strings, convert to numbers
  const avgWeight = Number(stats.avg_weight) || 0;
  const estimated1rm = Number(stats.estimated_1rm) || 0;
  const totalVolume = Number(stats.total_volume) || 0;
  
  return (
    <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
      <h3 className="font-semibold text-[var(--text-primary)]">{stats.exercise_name}</h3>
      
      <div className="mt-4 space-y-3">
        <StatRow label="Всего подходов" value={stats.total_sets} />
        <StatRow label="Макс. вес" value={`${stats.max_weight}кг`} highlight />
        <StatRow label="Средний вес" value={`${avgWeight.toFixed(1)}кг`} />
        <StatRow label="Макс. повторения" value={stats.max_reps} />
        <StatRow label="Общий объём" value={formatVolume(totalVolume)} />
        <StatRow label="1RM (оценка)" value={`${estimated1rm.toFixed(1)}кг`} highlight />
      </div>
    </div>
  );
}

function StatRow({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      <span className={cn(
        'text-sm font-medium',
        highlight ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-primary)]'
      )}>
        {value}
      </span>
    </div>
  );
}

function formatVolume(kg: number): string {
  if (kg >= 1000) {
    return `${(kg / 1000).toFixed(1)}т`;
  }
  return `${kg.toLocaleString()}кг`;
}
