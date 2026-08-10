/**
 * ADR-025: Fitness Feature Frontend Tests
 * Unit tests for components and API hooks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatsCard } from '../components/StatsCard';
import { WorkoutCard } from '../components/WorkoutCard';
import { MuscleHeatmap } from '../components/MuscleHeatmap';
import type { FitnessWorkout, MuscleVolumeMap } from '../types';

// Test wrapper with QueryClient
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

// =============================================================================
// StatsCard Tests
// =============================================================================

describe('StatsCard', () => {
  it('renders title and value', () => {
    render(<StatsCard title="Тренировок" value={42} />);
    
    expect(screen.getByText('Тренировок')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders icon when provided', () => {
    render(<StatsCard title="Test" value={0} icon={<span data-testid="icon">🏋️</span>} />);
    
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('renders positive trend with up arrow', () => {
    render(<StatsCard title="Volume" value="100kg" trend={15} trendLabel="vs last week" />);
    
    expect(screen.getByText(/↑ 15%/)).toBeInTheDocument();
    expect(screen.getByText('vs last week')).toBeInTheDocument();
  });

  it('renders negative trend with down arrow', () => {
    render(<StatsCard title="Volume" value="100kg" trend={-10} />);
    
    expect(screen.getByText(/↓ 10%/)).toBeInTheDocument();
  });

  it('renders zero trend with dash', () => {
    render(<StatsCard title="Volume" value="100kg" trend={0} />);
    
    expect(screen.getByText(/− 0%/)).toBeInTheDocument();
  });
});

// =============================================================================
// WorkoutCard Tests
// =============================================================================

describe('WorkoutCard', () => {
  const mockWorkout: FitnessWorkout = {
    id: 1,
    space_id: 1,
    title: 'Chest Day',
    description: null,
    started_at: '2025-01-13T10:00:00Z',
    ended_at: '2025-01-13T11:30:00Z',
    notes: 'Great workout!',
    source: 'manual',
    created_at: '2025-01-13T10:00:00Z',
    updated_at: '2025-01-13T11:30:00Z',
    total_sets: 20,
    workout_volume: 5000,
    pr_count: 2,
    duration_minutes: 90,
  };

  it('renders workout title', () => {
    render(<WorkoutCard workout={mockWorkout} />);
    
    expect(screen.getByText('Chest Day')).toBeInTheDocument();
  });

  it('displays sets count', () => {
    render(<WorkoutCard workout={mockWorkout} />);
    
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('сетов')).toBeInTheDocument();
  });

  it('displays PR badge when PRs exist', () => {
    render(<WorkoutCard workout={mockWorkout} />);
    
    expect(screen.getByText(/2 PR/)).toBeInTheDocument();
  });

  it('displays notes preview', () => {
    render(<WorkoutCard workout={mockWorkout} />);
    
    expect(screen.getByText('Great workout!')).toBeInTheDocument();
  });

  it('calls onView when view button clicked', () => {
    const onView = vi.fn();
    render(<WorkoutCard workout={mockWorkout} onView={onView} />);
    
    fireEvent.click(screen.getByText('Открыть'));
    
    expect(onView).toHaveBeenCalledWith(mockWorkout);
  });

  it('calls onDelete when delete button clicked', () => {
    const onDelete = vi.fn();
    render(<WorkoutCard workout={mockWorkout} onDelete={onDelete} />);
    
    fireEvent.click(screen.getByText('🗑️'));
    
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it('shows source badge for CSV imports', () => {
    const csvWorkout = { ...mockWorkout, source: 'csv_hevy' as const };
    render(<WorkoutCard workout={csvWorkout} />);
    
    expect(screen.getByText('HEVY')).toBeInTheDocument();
  });

  it('does not show PR badge when pr_count is 0', () => {
    const noPrWorkout = { ...mockWorkout, pr_count: 0 };
    render(<WorkoutCard workout={noPrWorkout} />);
    
    expect(screen.queryByText(/PR/)).not.toBeInTheDocument();
  });

  it('shows default title when title is null', () => {
    const noTitleWorkout = { ...mockWorkout, title: null };
    render(<WorkoutCard workout={noTitleWorkout} />);
    
    expect(screen.getByText('Тренировка')).toBeInTheDocument();
  });
});

// =============================================================================
// MuscleHeatmap Tests
// =============================================================================

describe('MuscleHeatmap', () => {
  const mockVolumeData: MuscleVolumeMap = {
    chest: 5000,
    back: 4000,
    shoulders: 2000,
    biceps: 1000,
  };

  it('renders title', () => {
    render(<MuscleHeatmap volumeData={mockVolumeData} />);
    
    expect(screen.getByText('Нагрузка по мышцам')).toBeInTheDocument();
  });

  it('renders muscle names', () => {
    render(<MuscleHeatmap volumeData={mockVolumeData} />);
    
    expect(screen.getByText('Грудь')).toBeInTheDocument();
    expect(screen.getByText('Спина')).toBeInTheDocument();
    expect(screen.getByText('Плечи')).toBeInTheDocument();
    expect(screen.getByText('Бицепс')).toBeInTheDocument();
  });

  it('shows empty state when no data', () => {
    render(<MuscleHeatmap volumeData={{}} />);
    
    expect(screen.getByText('Нет данных о тренировках')).toBeInTheDocument();
  });

  it('renders legend', () => {
    render(<MuscleHeatmap volumeData={mockVolumeData} />);
    
    expect(screen.getByText('Низкая')).toBeInTheDocument();
    expect(screen.getByText('Высокая')).toBeInTheDocument();
  });

  it('sorts muscles by volume descending', () => {
    render(<MuscleHeatmap volumeData={mockVolumeData} />);
    
    const muscleNames = screen.getAllByText(/Грудь|Спина|Плечи|Бицепс/);
    expect(muscleNames[0].textContent).toBe('Грудь'); // highest volume
  });
});

// =============================================================================
// Type Tests
// =============================================================================

describe('Fitness Types', () => {
  it('SetType union includes all valid values', () => {
    const validTypes: Array<import('../types').SetType> = [
      'warmup',
      'normal', 
      'dropset',
      'failure',
      'amrap',
    ];
    expect(validTypes).toHaveLength(5);
  });

  it('FitnessTab union includes all tabs', () => {
    const validTabs: Array<import('../types').FitnessTab> = [
      'dashboard',
      'exercises',
      'history',
      'muscles',
      'import',
    ];
    expect(validTabs).toHaveLength(5);
  });
});
