/**
 * ADR-027: Streak Display Component
 * Shows wellness streaks with fire emoji indicators
 */

import { cn } from '@/shared/utils/cn';
import type { WellnessStreak } from '../types';

export interface StreakDisplayProps {
  streaks: WellnessStreak[];
  className?: string;
}

const STREAK_LABELS: Record<string, { label: string; emoji: string }> = {
  workout: { label: 'Тренировки', emoji: '💪' },
  vitals_logged: { label: 'Замеры', emoji: '📊' },
  nutrition_logged: { label: 'Питание', emoji: '🥗' },
};

function getFireLevel(streak: number): string {
  if (streak === 0) return '⚪';
  if (streak < 3) return '🔥';
  if (streak < 7) return '🔥🔥';
  if (streak < 14) return '🔥🔥🔥';
  return '💎';
}

export function StreakDisplay({ streaks, className }: StreakDisplayProps) {
  return (
    <div className={cn(
      'rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4',
      className
    )}>
      <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">
        🔥 Страйки
      </h3>
      
      <div className="grid grid-cols-3 gap-3">
        {streaks.map((streak) => {
          const info = STREAK_LABELS[streak.streak_type] || { 
            label: streak.streak_type, 
            emoji: '📈' 
          };
          
          return (
            <div 
              key={streak.streak_type}
              className="text-center p-3 rounded-lg bg-[var(--bg-tertiary)]"
            >
              <div className="text-2xl mb-1">
                {info.emoji}
              </div>
              <div className="text-lg font-bold text-[var(--text-primary)]">
                {streak.current_streak}
              </div>
              <div className="text-xs text-[var(--text-muted)]">
                {info.label}
              </div>
              <div className="text-sm mt-1">
                {getFireLevel(streak.current_streak)}
              </div>
              {streak.longest_streak > streak.current_streak && (
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  Рекорд: {streak.longest_streak}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
