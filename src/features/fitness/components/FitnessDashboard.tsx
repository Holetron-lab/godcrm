/**
 * ADR-025: Fitness Dashboard Component
 * Main dashboard with stats cards and charts
 */

import { useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import { StatsCard } from './StatsCard';
import { MuscleHeatmap } from './MuscleHeatmap';
import { BodyMap } from './BodyMap';
import { getSvgIdsForMuscleName } from './BodyMap/muscleMapping';
import { WorkoutCard } from './WorkoutCard';
import { 
  useFitnessSummary, 
  useStreak, 
  useWorkouts, 
  useMuscleVolume,
  usePersonalRecords 
} from '../api/fitnessApi';
import type { FitnessWorkout, MuscleVolumeMap } from '../types';

export interface FitnessDashboardProps {
  spaceId: number;
  onViewWorkout?: (workout: FitnessWorkout) => void;
  className?: string;
}

function formatVolume(kg: number): string {
  if (kg >= 1000000) {
    return `${(kg / 1000000).toFixed(1)}т`;
  }
  if (kg >= 1000) {
    return `${(kg / 1000).toFixed(1)}т`;
  }
  return `${kg.toLocaleString()}кг`;
}

export function FitnessDashboard({ spaceId, onViewWorkout, className }: FitnessDashboardProps) {
  const { data: summary, isLoading: loadingSummary } = useFitnessSummary(spaceId);
  const { data: streak, isLoading: loadingStreak } = useStreak(spaceId);
  const { data: workouts, isLoading: loadingWorkouts } = useWorkouts(spaceId);
  const { data: muscleVolume, isLoading: loadingMuscle } = useMuscleVolume(spaceId, 30);
  const { data: prs, isLoading: loadingPRs } = usePersonalRecords(spaceId, 5);

  const isLoading = loadingSummary || loadingStreak || loadingWorkouts || loadingMuscle;

  // Convert muscle volume array to map (for MuscleHeatmap bar chart)
  const muscleVolumeMap: MuscleVolumeMap = (muscleVolume || []).reduce((acc, mv) => {
    acc[mv.muscle] = Number(mv.volume) || 0;
    return acc;
  }, {} as MuscleVolumeMap);

  // Convert to Map<string, number> for BodyMap SVG
  // Maps muscle names to SVG element IDs and aggregates volumes
  const bodyMapVolumes = useMemo(() => {
    const volumeMap = new Map<string, number>();
    
    (muscleVolume || []).forEach(mv => {
      const svgIds = getSvgIdsForMuscleName(mv.muscle);
      const volume = Number(mv.volume) || 0;
      
      svgIds.forEach(svgId => {
        const current = volumeMap.get(svgId) || 0;
        volumeMap.set(svgId, current + volume);
      });
    });
    
    return volumeMap;
  }, [muscleVolume]);

  // Get recent workouts (last 4)
  const recentWorkouts = (workouts || []).slice(0, 4);

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center py-12', className)}>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-[var(--color-primary-500)]" />
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatsCard
          title="Тренировок"
          value={summary?.total_workouts || 0}
          icon={<span className="text-xl">🏋️</span>}
        />
        <StatsCard
          title="Общий объём"
          value={formatVolume(summary?.total_volume || 0)}
          icon={<span className="text-xl">📊</span>}
        />
        <StatsCard
          title="Рекордов"
          value={summary?.total_prs || 0}
          icon={<span className="text-xl">🏆</span>}
        />
        <StatsCard
          title="Streak"
          value={`${streak?.current_streak || 0} дн`}
          icon={<span className="text-xl">🔥</span>}
        />
      </div>

      {/* Week stats */}
      {streak && (
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
          <h3 className="font-semibold text-[var(--text-primary)]">Статистика</h3>
          <div className="mt-3 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-[var(--color-primary-500)]">{streak.workouts_this_week}</p>
              <p className="text-xs text-[var(--text-muted)]">на этой неделе</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--text-primary)]">{streak.longest_streak}</p>
              <p className="text-xs text-[var(--text-muted)]">макс. streak</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-[var(--text-primary)]">{streak.total_workout_days}</p>
              <p className="text-xs text-[var(--text-muted)]">всего дней</p>
            </div>
          </div>
        </div>
      )}

      {/* Two columns: PRs + Muscle Heatmap */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent PRs */}
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
          <h3 className="font-semibold text-[var(--text-primary)]">Последние рекорды 🏆</h3>
          {prs && prs.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {prs.map((pr, i) => (
                <li key={i} className="flex items-center justify-between text-sm">
                  <span className="text-[var(--text-primary)]">{pr.exercise_name}</span>
                  <span className="font-medium text-[var(--color-primary-500)]">
                    {pr.weight_kg}кг × {pr.reps}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-[var(--text-muted)]">Пока нет рекордов</p>
          )}
        </div>

        {/* Muscle Bar Chart */}
        <MuscleHeatmap volumeData={muscleVolumeMap} />
      </div>

      {/* Body Map SVG */}
      {Object.keys(muscleVolumeMap).length > 0 && (
        <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
          <h3 className="mb-4 font-semibold text-[var(--text-primary)]">Карта мышц 💪</h3>
          <BodyMap 
            muscleVolumes={bodyMapVolumes}
            compact={false}
          />
        </div>
      )}

      {/* Recent Workouts */}
      <div>
        <h3 className="mb-4 font-semibold text-[var(--text-primary)]">Последние тренировки</h3>
        {recentWorkouts.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {recentWorkouts.map((workout) => (
              <WorkoutCard 
                key={workout.id} 
                workout={workout} 
                onView={onViewWorkout}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-[var(--border-primary)] p-8 text-center">
            <p className="text-[var(--text-muted)]">Пока нет тренировок</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Добавьте первую тренировку или импортируйте из CSV
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
