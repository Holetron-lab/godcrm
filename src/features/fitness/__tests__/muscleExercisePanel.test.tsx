/**
 * ADR-027: MuscleExercisePanel Tests
 * Tests for muscle exercise panel component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MuscleExercisePanel } from '../components/MuscleExercisePanel';

// Mock the API hooks
vi.mock('../api/fitnessApi', () => ({
  useExercises: vi.fn(() => ({
    data: [
      { id: 1, name: 'Bench Press', primary_muscle: 'chest', secondary_muscle: 'triceps', equipment: 'Barbell' },
      { id: 2, name: 'Push-ups', primary_muscle: 'chest', secondary_muscle: 'shoulders', equipment: null },
      { id: 3, name: 'Cable Fly', primary_muscle: 'chest', secondary_muscle: null, equipment: 'Cable' },
      { id: 4, name: 'Bicep Curl', primary_muscle: 'biceps', secondary_muscle: null, equipment: 'Dumbbell' },
    ],
    isLoading: false,
  })),
  useMuscleVolume: vi.fn(() => ({
    data: [{ muscle: 'Chest', volume: 5000 }],
    isLoading: false,
  })),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('MuscleExercisePanel', () => {
  const defaultProps = {
    spaceId: 1,
    selectedMuscle: null as string | null,
    muscleVolumes: new Map<string, number>(),
    maxVolume: 10000,
  };

  it('renders empty state when no muscle selected', () => {
    render(
      <MuscleExercisePanel {...defaultProps} />,
      { wrapper: createWrapper() }
    );
    
    expect(screen.getByText('Нажмите на мышцу на карте тела')).toBeInTheDocument();
  });

  it('renders muscle name when selected', () => {
    render(
      <MuscleExercisePanel 
        {...defaultProps} 
        selectedMuscle="Chest"
        muscleVolumes={new Map([['Chest', 5000]])}
      />,
      { wrapper: createWrapper() }
    );
    
    expect(screen.getByText('Грудь')).toBeInTheDocument();
    expect(screen.getByText('3 упражнений')).toBeInTheDocument();
  });

  it('renders progress bar with volume', () => {
    render(
      <MuscleExercisePanel 
        {...defaultProps} 
        selectedMuscle="Chest"
        muscleVolumes={new Map([['Chest', 5000]])}
        maxVolume={10000}
        days={7}
      />,
      { wrapper: createWrapper() }
    );
    
    expect(screen.getByText('Объём за 7 дней')).toBeInTheDocument();
    expect(screen.getByText(/5[\s,]?000.*50%/)).toBeInTheDocument();
  });

  it('renders exercise list', () => {
    render(
      <MuscleExercisePanel 
        {...defaultProps} 
        selectedMuscle="Chest"
      />,
      { wrapper: createWrapper() }
    );
    
    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Push-ups')).toBeInTheDocument();
    expect(screen.getByText('Cable Fly')).toBeInTheDocument();
  });

  it('filters exercises by selected muscle only', () => {
    render(
      <MuscleExercisePanel 
        {...defaultProps} 
        selectedMuscle="Chest"
      />,
      { wrapper: createWrapper() }
    );
    
    // Bicep Curl should not appear (primary_muscle is 'biceps')
    expect(screen.queryByText('Bicep Curl')).not.toBeInTheDocument();
  });

  it('calls onExerciseClick when exercise is clicked', () => {
    const onExerciseClick = vi.fn();
    render(
      <MuscleExercisePanel 
        {...defaultProps} 
        selectedMuscle="Chest"
        onExerciseClick={onExerciseClick}
      />,
      { wrapper: createWrapper() }
    );
    
    fireEvent.click(screen.getByText('Bench Press'));
    expect(onExerciseClick).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Bench Press' })
    );
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <MuscleExercisePanel 
        {...defaultProps} 
        selectedMuscle="Chest"
        onClose={onClose}
      />,
      { wrapper: createWrapper() }
    );
    
    fireEvent.click(screen.getByText('✕'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows equipment info', () => {
    render(
      <MuscleExercisePanel 
        {...defaultProps} 
        selectedMuscle="Chest"
      />,
      { wrapper: createWrapper() }
    );
    
    // Check equipment appears in the list (use getAllBy since there may be multiple matches)
    const barbellElements = screen.getAllByText(/Barbell/);
    expect(barbellElements.length).toBeGreaterThan(0);
    
    // "Без снаряда" should appear for Push-ups
    expect(screen.getByText(/Без снаряда/)).toBeInTheDocument();
  });

  it('calculates progress percentage correctly', () => {
    render(
      <MuscleExercisePanel 
        {...defaultProps} 
        selectedMuscle="Chest"
        muscleVolumes={new Map([['Chest', 8000]])}
        maxVolume={10000}
      />,
      { wrapper: createWrapper() }
    );
    
    // 8000/10000 = 80%
    expect(screen.getByText(/80%/)).toBeInTheDocument();
  });

  it('caps progress at 100%', () => {
    render(
      <MuscleExercisePanel 
        {...defaultProps} 
        selectedMuscle="Chest"
        muscleVolumes={new Map([['Chest', 15000]])}
        maxVolume={10000}
      />,
      { wrapper: createWrapper() }
    );
    
    // Should show 100%, not 150%
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });
});
