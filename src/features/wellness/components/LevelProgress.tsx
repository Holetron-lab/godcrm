/**
 * ADR-027: Level Progress Component
 * Displays user level with XP progress bar
 */

import { cn } from '@/shared/utils/cn';
import type { GamificationSummary } from '../types';

export interface LevelProgressProps {
  data: GamificationSummary;
  className?: string;
}

export function LevelProgress({ data, className }: LevelProgressProps) {
  const { 
    level, 
    current_xp, 
    xp_for_next_level, 
    xp_progress_percent,
    points_balance 
  } = data;

  return (
    <div className={cn(
      'rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4',
      className
    )}>
      {/* Level Badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-white font-bold text-lg shadow-lg">
              {level}
            </div>
            <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-yellow-400 text-[10px] font-bold">
              ⭐
            </div>
          </div>
          <div>
            <p className="text-sm text-[var(--text-secondary)]">Уровень</p>
            <p className="text-xl font-bold text-[var(--text-primary)]">Level {level}</p>
          </div>
        </div>
        
        {/* Points Balance */}
        <div className="text-right">
          <p className="text-sm text-[var(--text-secondary)]">Баланс</p>
          <p className="text-xl font-bold text-amber-500">💰 {points_balance}</p>
        </div>
      </div>

      {/* XP Progress Bar */}
      <div className="mt-4">
        <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
          <span>XP: {current_xp} / {xp_for_next_level}</span>
          <span>{Math.round(xp_progress_percent)}%</span>
        </div>
        <div className="h-3 w-full rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
          <div 
            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all duration-500"
            style={{ width: `${Math.min(xp_progress_percent, 100)}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {xp_for_next_level - current_xp} XP до Level {level + 1}
        </p>
      </div>
    </div>
  );
}
