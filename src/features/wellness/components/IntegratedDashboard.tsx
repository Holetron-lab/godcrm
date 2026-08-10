/**
 * ADR-027: Integrated Wellness Dashboard
 * Combines fitness stats with wellness data (level, vitals, streaks)
 */

import { useState, useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import { StatsCard } from '@/features/fitness/components/StatsCard';
import { MuscleHeatmap } from '@/features/fitness/components/MuscleHeatmap';
import { BodyMap } from '@/features/fitness/components/BodyMap';
import { MuscleExercisePanel } from '@/features/fitness/components/MuscleExercisePanel';
import { getSvgIdsForMuscleName } from '@/features/fitness/components/BodyMap/muscleMapping';
import { WorkoutCard } from '@/features/fitness/components/WorkoutCard';
import { 
  useFitnessSummary, 
  useStreak as useFitnessStreak, 
  useWorkouts, 
  useMuscleVolume,
  usePersonalRecords 
} from '@/features/fitness/api/fitnessApi';
import { useWellnessDashboard } from '@/features/wellness/api/wellnessApi';
import { LevelProgress } from '@/features/wellness/components/LevelProgress';
import { StreakDisplay } from '@/features/wellness/components/StreakDisplay';
import { VitalsCard } from '@/features/wellness/components/VitalsCard';
import type { FitnessWorkout, MuscleVolumeMap } from '@/features/fitness/types';

export interface IntegratedDashboardProps {
  spaceId: number;
  onViewWorkout?: (workout: FitnessWorkout) => void;
  className?: string;
}

function formatVolume(kg: number): string {
  if (kg >= 1000000) {
    return `${(kg / 1000000).toFixed(1)}М`;
  }
  if (kg >= 1000) {
    return `${(kg / 1000).toFixed(1)}т`;
  }
  return `${kg.toLocaleString()}кг`;
}

export function IntegratedDashboard({ spaceId, onViewWorkout, className }: IntegratedDashboardProps) {
  const [selectedMuscle, setSelectedMuscle] = useState<string | null>(null);
  
  // Fitness data
  const { data: summary, isLoading: loadingSummary } = useFitnessSummary(spaceId);
  const { data: fitnessStreak, isLoading: loadingStreak } = useFitnessStreak(spaceId);
  const { data: workouts, isLoading: loadingWorkouts } = useWorkouts(spaceId);
  const { data: muscleVolume, isLoading: loadingMuscle } = useMuscleVolume(spaceId, 30);
  const { data: prs } = usePersonalRecords(spaceId, 5);

  // Wellness data
  const { data: wellness, isLoading: loadingWellness } = useWellnessDashboard(spaceId);

  const isLoading = loadingSummary || loadingStreak || loadingWorkouts || loadingMuscle || loadingWellness;

  // Convert muscle volume array to map (for MuscleHeatmap bar chart)
  const muscleVolumeMap: MuscleVolumeMap = (muscleVolume || []).reduce((acc, mv) => {
    acc[mv.muscle] = Number(mv.volume) || 0;
    return acc;
  }, {} as MuscleVolumeMap);

  // Max volume for progress calculation
  const maxMuscleVolume = useMemo(() => {
    const volumes = Object.values(muscleVolumeMap);
    return volumes.length > 0 ? Math.max(...volumes) : 1;
  }, [muscleVolumeMap]);

  // Convert to Map<string, number> for BodyMap SVG
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

  // Muscle volumes as Map for MuscleExercisePanel
  const muscleVolumesMap = useMemo(() => {
    return new Map(Object.entries(muscleVolumeMap));
  }, [muscleVolumeMap]);

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
      {/* Gamification Header - Level & Points */}
      {wellness?.gamification && (
        <LevelProgress data={wellness.gamification} />
      )}

      {/* Stats Grid - Combined fitness + wellness */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
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
          value={`${fitnessStreak?.current_streak || 0} дн`}
          icon={<span className="text-xl">🔥</span>}
        />
        {wellness?.gamification && (
          <StatsCard
            title="Уровень"
            value={wellness.gamification.level}
            icon={<span className="text-xl">⭐</span>}
          />
        )}
      </div>

      {/* Wellness Streaks */}
      {wellness?.streaks && wellness.streaks.length > 0 && (
        <StreakDisplay streaks={wellness.streaks} />
      )}

      {/* Latest Vitals */}
      {wellness?.latest_vitals && wellness.latest_vitals.length > 0 && (
        <VitalsCard vitals={wellness.latest_vitals.slice(0, 6)} />
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

      {/* Body Map with Exercise Panel */}
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
        <h3 className="mb-4 font-semibold text-[var(--text-primary)]">
          Карта мышц 💪 
          <span className="ml-2 text-xs font-normal text-[var(--text-muted)]">
            Нажмите на мышцу для просмотра упражнений
          </span>
        </h3>
        <div className="grid gap-6 lg:grid-cols-2">
          <BodyMap 
            muscleVolumes={bodyMapVolumes}
            selectedPart={selectedMuscle}
            onPartClick={setSelectedMuscle}
            compact={false}
          />
          <MuscleExercisePanel
            spaceId={spaceId}
            selectedMuscle={selectedMuscle}
            muscleVolumes={muscleVolumesMap}
            maxVolume={maxMuscleVolume}
            days={30}
            onClose={() => setSelectedMuscle(null)}
          />
        </div>
      </div>

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

export default IntegratedDashboard;
