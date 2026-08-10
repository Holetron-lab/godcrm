/**
 * ADR-027: Integrated Dashboard Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntegratedDashboard } from '../components/IntegratedDashboard';

// Mock fitness API
vi.mock('@/features/fitness/api/fitnessApi', () => ({
  useFitnessSummary: vi.fn(() => ({
    data: { total_workouts: 42, total_volume: 150000, total_prs: 15, total_sets: 500 },
    isLoading: false,
  })),
  useStreak: vi.fn(() => ({
    data: { current_streak: 7, longest_streak: 14, workouts_this_week: 3, total_workout_days: 100 },
    isLoading: false,
  })),
  useWorkouts: vi.fn(() => ({
    data: [
      { id: 1, title: 'Chest Day', started_at: '2026-01-18T10:00:00Z', space_id: 1, source: 'manual', created_at: '2026-01-18', updated_at: '2026-01-18' },
    ],
    isLoading: false,
  })),
  useMuscleVolume: vi.fn(() => ({
    data: [
      { muscle: 'Chest', volume: 5000 },
      { muscle: 'Back', volume: 4000 },
    ],
    isLoading: false,
  })),
  usePersonalRecords: vi.fn(() => ({
    data: [{ exercise_name: 'Bench Press', weight_kg: 100, reps: 5, achieved_at: '2026-01-18' }],
    isLoading: false,
  })),
}));

// Mock wellness API
vi.mock('@/features/wellness/api/wellnessApi', () => ({
  useWellnessDashboard: vi.fn(() => ({
    data: {
      profile: { height_cm: 180, current_weight_kg: 75 },
      latest_vitals: [
        { vital_type: 'weight', value: 75, unit: 'кг', recorded_at: '2026-01-18T09:00:00Z' },
        { vital_type: 'heart_rate', value: 68, unit: 'уд/мин', recorded_at: '2026-01-18T09:00:00Z' },
      ],
      gamification: {
        level: 5,
        current_xp: 350,
        xp_for_next_level: 500,
        total_points: 1200,
        total_spent: 200,
        points_balance: 1000,
        xp_progress_percent: 70,
      },
      streaks: [
        { streak_type: 'workout', current_streak: 7, longest_streak: 14, last_activity_at: '2026-01-18' },
        { streak_type: 'vitals_logged', current_streak: 3, longest_streak: 10, last_activity_at: '2026-01-18' },
      ],
    },
    isLoading: false,
  })),
}));

// Mock fitness components
vi.mock('@/features/fitness/components/MuscleHeatmap', () => ({
  MuscleHeatmap: () => <div data-testid="muscle-heatmap">MuscleHeatmap</div>,
}));

vi.mock('@/features/fitness/components/BodyMap', () => ({
  BodyMap: ({ onPartClick }: { onPartClick?: (part: string) => void }) => (
    <div data-testid="body-map" onClick={() => onPartClick?.('Chest')}>BodyMap</div>
  ),
}));

vi.mock('@/features/fitness/components/MuscleExercisePanel', () => ({
  MuscleExercisePanel: ({ selectedMuscle }: { selectedMuscle?: string }) => (
    <div data-testid="muscle-exercise-panel">
      {selectedMuscle ? `Exercises for ${selectedMuscle}` : 'No muscle selected'}
    </div>
  ),
}));

vi.mock('@/features/fitness/components/WorkoutCard', () => ({
  WorkoutCard: ({ workout }: { workout: { title: string } }) => <div data-testid="workout-card">{workout.title}</div>,
}));

vi.mock('@/features/fitness/components/BodyMap/muscleMapping', () => ({
  getSvgIdsForMuscleName: () => ['chest-muscle'],
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('IntegratedDashboard', () => {
  it('renders level progress from wellness data', () => {
    render(<IntegratedDashboard spaceId={1} />, { wrapper: createWrapper() });
    
    expect(screen.getByText('Level 5')).toBeInTheDocument();
    expect(screen.getByText('💰 1000')).toBeInTheDocument();
  });

  it('renders fitness stats cards', () => {
    render(<IntegratedDashboard spaceId={1} />, { wrapper: createWrapper() });
    
    expect(screen.getByText('Тренировок')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('Рекордов')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('renders wellness streaks', () => {
    render(<IntegratedDashboard spaceId={1} />, { wrapper: createWrapper() });
    
    expect(screen.getByText('Тренировки')).toBeInTheDocument();
    expect(screen.getByText('Замеры')).toBeInTheDocument();
  });

  it('renders latest vitals', () => {
    render(<IntegratedDashboard spaceId={1} />, { wrapper: createWrapper() });
    
    expect(screen.getByText('Вес')).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();
    expect(screen.getByText('Пульс')).toBeInTheDocument();
  });

  it('renders body map with exercise panel', () => {
    render(<IntegratedDashboard spaceId={1} />, { wrapper: createWrapper() });
    
    expect(screen.getByTestId('body-map')).toBeInTheDocument();
    expect(screen.getByTestId('muscle-exercise-panel')).toBeInTheDocument();
  });

  it('shows exercises when muscle clicked on body map', () => {
    render(<IntegratedDashboard spaceId={1} />, { wrapper: createWrapper() });
    
    const bodyMap = screen.getByTestId('body-map');
    fireEvent.click(bodyMap);
    
    expect(screen.getByText('Exercises for Chest')).toBeInTheDocument();
  });

  it('renders recent workouts', () => {
    render(<IntegratedDashboard spaceId={1} />, { wrapper: createWrapper() });
    
    expect(screen.getByText('Последние тренировки')).toBeInTheDocument();
    expect(screen.getByText('Chest Day')).toBeInTheDocument();
  });

  it('renders PRs section', () => {
    render(<IntegratedDashboard spaceId={1} />, { wrapper: createWrapper() });
    
    expect(screen.getByText('Последние рекорды 🏆')).toBeInTheDocument();
    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    expect(screen.getByText('100кг × 5')).toBeInTheDocument();
  });
});
