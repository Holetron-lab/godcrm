/**
 * ADR-027: Muscle Exercise Panel Component
 * Shows exercises for selected muscle + progress bar
 * Displayed when user clicks on BodyMap muscle
 */

import { useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import { useExercises, useMuscleVolume } from '../api/fitnessApi';
import type { FitnessExercise } from '../types';

export interface MuscleExercisePanelProps {
  spaceId: number;
  /** Selected muscle group name (e.g., 'Chest', 'Back', 'Biceps') */
  selectedMuscle: string | null;
  /** Muscle volume data for progress calculation */
  muscleVolumes: Map<string, number>;
  /** Maximum volume for percentage calculation */
  maxVolume?: number;
  /** Days to calculate volume over */
  days?: number;
  /** Callback when exercise is clicked */
  onExerciseClick?: (exercise: FitnessExercise) => void;
  /** Close handler */
  onClose?: () => void;
  className?: string;
}

// Muscle name mappings (English -> Russian)
const MUSCLE_LABELS: Record<string, string> = {
  'Chest': 'Грудь',
  'Back': 'Спина',
  'Shoulders': 'Плечи',
  'Biceps': 'Бицепс',
  'Triceps': 'Трицепс',
  'Forearms': 'Предплечья',
  'Abs': 'Пресс',
  'Quadriceps': 'Квадрицепс',
  'Hamstrings': 'Бицепс бедра',
  'Glutes': 'Ягодицы',
  'Calves': 'Икры',
  'Traps': 'Трапеции',
  'Lats': 'Широчайшие',
  'Lower Back': 'Поясница',
  'Core': 'Кор',
};

// Muscle -> primary_muscle filter value mapping
const MUSCLE_FILTER_MAP: Record<string, string> = {
  'Chest': 'chest',
  'Back': 'back',
  'Shoulders': 'shoulders',
  'Biceps': 'biceps',
  'Triceps': 'triceps',
  'Forearms': 'forearms',
  'Abs': 'abs',
  'Quadriceps': 'quadriceps',
  'Hamstrings': 'hamstrings',
  'Glutes': 'glutes',
  'Calves': 'calves',
  'Traps': 'traps',
  'Lats': 'lats',
  'Lower Back': 'lower_back',
  'Core': 'core',
};

export function MuscleExercisePanel({
  spaceId,
  selectedMuscle,
  muscleVolumes,
  maxVolume = 1,
  days = 7,
  onExerciseClick,
  onClose,
  className,
}: MuscleExercisePanelProps) {
  const { data: allExercises, isLoading } = useExercises(spaceId);

  // Filter exercises for selected muscle
  const muscleExercises = useMemo(() => {
    if (!allExercises || !selectedMuscle) return [];
    
    const filterValue = MUSCLE_FILTER_MAP[selectedMuscle]?.toLowerCase() || selectedMuscle.toLowerCase();
    
    return allExercises.filter((ex) => {
      const primaryMatch = ex.primary_muscle?.toLowerCase() === filterValue;
      const secondaryMatch = ex.secondary_muscle?.toLowerCase() === filterValue;
      return primaryMatch || secondaryMatch;
    });
  }, [allExercises, selectedMuscle]);

  // Calculate progress for this muscle
  const muscleProgress = useMemo(() => {
    if (!selectedMuscle || maxVolume <= 0) return 0;
    const volume = muscleVolumes.get(selectedMuscle) || 0;
    return Math.min(100, Math.round((volume / maxVolume) * 100));
  }, [selectedMuscle, muscleVolumes, maxVolume]);

  const muscleVolume = selectedMuscle ? muscleVolumes.get(selectedMuscle) || 0 : 0;

  if (!selectedMuscle) {
    return (
      <div className={cn(
        'rounded-lg border border-dashed border-[var(--border-primary)] bg-[var(--bg-secondary)] p-8 text-center',
        className
      )}>
        <p className="text-3xl mb-2">💪</p>
        <p className="text-[var(--text-muted)]">Нажмите на мышцу на карте тела</p>
        <p className="text-xs text-[var(--text-muted)] mt-1">для просмотра упражнений</p>
      </div>
    );
  }

  const muscleName = MUSCLE_LABELS[selectedMuscle] || selectedMuscle;

  return (
    <div className={cn(
      'rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden',
      className
    )}>
      {/* Header with muscle name and close button */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">
            {muscleName}
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            {muscleExercises.length} упражнений
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            ✕
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-4 py-3 border-b border-[var(--border-primary)]">
        <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
          <span>Объём за {days} дней</span>
          <span>{muscleVolume.toLocaleString()} кг ({muscleProgress}%)</span>
        </div>
        <div className="h-2.5 w-full rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
          <div 
            className={cn(
              'h-full rounded-full transition-all duration-500',
              muscleProgress >= 80 ? 'bg-green-500' :
              muscleProgress >= 50 ? 'bg-blue-500' :
              muscleProgress >= 25 ? 'bg-yellow-500' : 'bg-gray-500'
            )}
            style={{ width: `${muscleProgress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-[var(--text-muted)] mt-1">
          <span>Недотренирована</span>
          <span>Перетренирована</span>
        </div>
      </div>

      {/* Exercise list */}
      <div className="max-h-80 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-[var(--color-primary-500)]" />
          </div>
        ) : muscleExercises.length > 0 ? (
          <div className="divide-y divide-[var(--border-primary)]">
            {muscleExercises.slice(0, 15).map((exercise) => (
              <button
                key={exercise.id}
                onClick={() => onExerciseClick?.(exercise)}
                className="w-full text-left px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {exercise.name}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {exercise.equipment || 'Без снаряда'}
                      {exercise.secondary_muscle && exercise.secondary_muscle !== exercise.primary_muscle && (
                        <span> • + {MUSCLE_LABELS[capitalize(exercise.secondary_muscle)] || exercise.secondary_muscle}</span>
                      )}
                    </p>
                  </div>
                  <span className="text-[var(--text-muted)]">→</span>
                </div>
              </button>
            ))}
            {muscleExercises.length > 15 && (
              <div className="px-4 py-2 text-xs text-center text-[var(--text-muted)]">
                И ещё {muscleExercises.length - 15} упражнений...
              </div>
            )}
          </div>
        ) : (
          <div className="py-8 text-center text-[var(--text-muted)]">
            <p className="text-2xl mb-2">🔍</p>
            <p>Нет упражнений для этой мышцы</p>
            <p className="text-xs mt-1">Добавьте упражнения в каталог</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper to capitalize first letter
function capitalize(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export default MuscleExercisePanel;
