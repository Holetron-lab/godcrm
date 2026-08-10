/**
 * ADR-027: Wellness Feature Frontend Tests
 * Unit tests for components and API hooks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LevelProgress } from '../components/LevelProgress';
import { StreakDisplay } from '../components/StreakDisplay';
import { VitalsCard } from '../components/VitalsCard';
import { ProfileSummary } from '../components/ProfileSummary';
import type { 
  GamificationSummary, 
  WellnessStreak, 
  VitalLatest,
  WellnessProfile 
} from '../types';

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
// LevelProgress Tests
// =============================================================================

describe('LevelProgress', () => {
  const mockData: GamificationSummary = {
    level: 5,
    current_xp: 350,
    xp_for_next_level: 500,
    total_points: 1200,
    total_spent: 200,
    points_balance: 1000,
    xp_progress_percent: 70,
  };

  it('renders level number', () => {
    render(<LevelProgress data={mockData} />);
    
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Level 5')).toBeInTheDocument();
  });

  it('renders points balance', () => {
    render(<LevelProgress data={mockData} />);
    
    expect(screen.getByText('💰 1000')).toBeInTheDocument();
  });

  it('renders XP progress', () => {
    render(<LevelProgress data={mockData} />);
    
    expect(screen.getByText('XP: 350 / 500')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
  });

  it('shows XP needed for next level', () => {
    render(<LevelProgress data={mockData} />);
    
    expect(screen.getByText('150 XP до Level 6')).toBeInTheDocument();
  });
});

// =============================================================================
// StreakDisplay Tests
// =============================================================================

describe('StreakDisplay', () => {
  const mockStreaks: WellnessStreak[] = [
    { streak_type: 'workout', current_streak: 7, longest_streak: 14, last_activity_at: '2026-01-18T10:00:00Z' },
    { streak_type: 'vitals_logged', current_streak: 3, longest_streak: 10, last_activity_at: '2026-01-18T09:00:00Z' },
    { streak_type: 'nutrition_logged', current_streak: 0, longest_streak: 5, last_activity_at: null },
  ];

  it('renders all streaks', () => {
    render(<StreakDisplay streaks={mockStreaks} />);
    
    expect(screen.getByText('Тренировки')).toBeInTheDocument();
    expect(screen.getByText('Замеры')).toBeInTheDocument();
    expect(screen.getByText('Питание')).toBeInTheDocument();
  });

  it('renders streak counts', () => {
    render(<StreakDisplay streaks={mockStreaks} />);
    
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('shows longest streak when greater than current', () => {
    render(<StreakDisplay streaks={mockStreaks} />);
    
    expect(screen.getByText('Рекорд: 14')).toBeInTheDocument();
    expect(screen.getByText('Рекорд: 10')).toBeInTheDocument();
    expect(screen.getByText('Рекорд: 5')).toBeInTheDocument();
  });

  it('renders fire emojis based on streak level', () => {
    render(<StreakDisplay streaks={mockStreaks} />);
    
    // 7 days = 🔥🔥🔥
    const container = screen.getByText('7').closest('div')?.parentElement;
    expect(container?.textContent).toContain('🔥🔥🔥');
    
    // 0 days = ⚪
    const zeroContainer = screen.getByText('0').closest('div')?.parentElement;
    expect(zeroContainer?.textContent).toContain('⚪');
  });
});

// =============================================================================
// VitalsCard Tests
// =============================================================================

describe('VitalsCard', () => {
  const mockVitals: VitalLatest[] = [
    { vital_type: 'weight', value: 75.5, unit: 'кг', recorded_at: new Date().toISOString() },
    { vital_type: 'heart_rate', value: 68, unit: 'уд/мин', recorded_at: new Date().toISOString() },
  ];

  it('renders empty state when no vitals', () => {
    render(<VitalsCard vitals={[]} />);
    
    expect(screen.getByText('Нет записей')).toBeInTheDocument();
    expect(screen.getByText('Добавьте первый замер')).toBeInTheDocument();
  });

  it('renders vital values', () => {
    render(<VitalsCard vitals={mockVitals} />);
    
    expect(screen.getByText('75.5')).toBeInTheDocument();
    expect(screen.getByText('68')).toBeInTheDocument();
  });

  it('renders vital labels', () => {
    render(<VitalsCard vitals={mockVitals} />);
    
    expect(screen.getByText('Вес')).toBeInTheDocument();
    expect(screen.getByText('Пульс')).toBeInTheDocument();
  });

  it('calls onLogVital when vital clicked', () => {
    const onLogVital = vi.fn();
    render(<VitalsCard vitals={mockVitals} onLogVital={onLogVital} />);
    
    const weightCard = screen.getByText('Вес').closest('div[class*="cursor-pointer"]');
    if (weightCard) {
      fireEvent.click(weightCard);
      expect(onLogVital).toHaveBeenCalledWith('weight');
    }
  });

  it('shows add button when onLogVital provided', () => {
    const onLogVital = vi.fn();
    render(<VitalsCard vitals={mockVitals} onLogVital={onLogVital} />);
    
    expect(screen.getByText('+ Добавить замер')).toBeInTheDocument();
  });
});

// =============================================================================
// ProfileSummary Tests
// =============================================================================

describe('ProfileSummary', () => {
  const mockProfile: WellnessProfile = {
    id: 1,
    space_id: 1,
    height_cm: 180,
    current_weight_kg: 75,
    target_weight_kg: 70,
    birth_date: '1990-05-15',
    gender: 'male',
    activity_level: 'moderate',
    bmr_kcal: 1750,
    tdee_kcal: 2712,
    created_at: '2026-01-18T10:00:00Z',
    updated_at: '2026-01-18T10:00:00Z',
  };

  it('renders empty state when no profile', () => {
    render(<ProfileSummary profile={null} />);
    
    expect(screen.getByText('Профиль не настроен')).toBeInTheDocument();
    expect(screen.getByText('Заполните профиль для расчёта BMR/TDEE')).toBeInTheDocument();
  });

  it('renders setup button when no profile and onEdit provided', () => {
    const onEdit = vi.fn();
    render(<ProfileSummary profile={null} onEdit={onEdit} />);
    
    const button = screen.getByText('Настроить профиль');
    expect(button).toBeInTheDocument();
    
    fireEvent.click(button);
    expect(onEdit).toHaveBeenCalled();
  });

  it('renders height and weight', () => {
    render(<ProfileSummary profile={mockProfile} />);
    
    expect(screen.getByText('180')).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();
  });

  it('renders target weight with difference', () => {
    render(<ProfileSummary profile={mockProfile} />);
    
    expect(screen.getByText('70')).toBeInTheDocument();
    expect(screen.getByText('(-5.0)')).toBeInTheDocument();
  });

  it('renders activity level', () => {
    render(<ProfileSummary profile={mockProfile} />);
    
    expect(screen.getByText('Умеренная активность')).toBeInTheDocument();
  });

  it('renders BMR and TDEE', () => {
    render(<ProfileSummary profile={mockProfile} />);
    
    expect(screen.getByText('1750')).toBeInTheDocument();
    expect(screen.getByText('2712')).toBeInTheDocument();
    expect(screen.getByText('BMR (базовый метаболизм)')).toBeInTheDocument();
    expect(screen.getByText('TDEE (с активностью)')).toBeInTheDocument();
  });

  it('renders edit button when onEdit provided', () => {
    const onEdit = vi.fn();
    render(<ProfileSummary profile={mockProfile} onEdit={onEdit} />);
    
    const button = screen.getByText('Редактировать');
    fireEvent.click(button);
    expect(onEdit).toHaveBeenCalled();
  });

  it('calculates age from birth date', () => {
    // Mock current date is 2026, birth is 1990 = ~35-36 years old
    render(<ProfileSummary profile={mockProfile} />);
    
    // Age should be around 35-36 depending on current date
    const ageElement = screen.getByText('лет').previousElementSibling;
    const age = parseInt(ageElement?.textContent || '0');
    expect(age).toBeGreaterThanOrEqual(35);
    expect(age).toBeLessThanOrEqual(36);
  });
});
