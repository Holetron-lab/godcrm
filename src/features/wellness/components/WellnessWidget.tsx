/**
 * ADR-027: Wellness Widget Component
 * Main dashboard widget for Personal Space wellness tracking
 */

import { useState } from 'react';
import { cn } from '@/shared/utils/cn';
import { useWellnessDashboard } from '../api/wellnessApi';
import { LevelProgress } from './LevelProgress';
import { StreakDisplay } from './StreakDisplay';
import { VitalsCard } from './VitalsCard';
import { ProfileSummary } from './ProfileSummary';
import type { VitalType } from '../types';

export interface WellnessWidgetProps {
  spaceId: number;
  className?: string;
  compact?: boolean;
  onEditProfile?: () => void;
  onLogVital?: (type: VitalType) => void;
}

export function WellnessWidget({ 
  spaceId, 
  className, 
  compact = false,
  onEditProfile,
  onLogVital,
}: WellnessWidgetProps) {
  const { data: dashboard, isLoading, error } = useWellnessDashboard(spaceId);
  const [activeTab, setActiveTab] = useState<'overview' | 'vitals' | 'achievements'>('overview');

  if (isLoading) {
    return (
      <div className={cn('animate-pulse', className)}>
        <div className="h-32 rounded-lg bg-[var(--bg-secondary)]" />
        <div className="h-24 mt-4 rounded-lg bg-[var(--bg-secondary)]" />
        <div className="h-24 mt-4 rounded-lg bg-[var(--bg-secondary)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn(
        'rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-center',
        className
      )}>
        <p className="text-red-500">Ошибка загрузки wellness данных</p>
        <p className="text-xs text-[var(--text-muted)] mt-1">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  if (!dashboard) {
    return null;
  }

  const { profile, latest_vitals, gamification, streaks } = dashboard;

  // Compact mode - show just level and key stats
  if (compact) {
    return (
      <div className={cn('space-y-3', className)}>
        <LevelProgress data={gamification} />
        <div className="grid grid-cols-3 gap-2 text-center">
          {streaks.slice(0, 3).map((streak) => (
            <div key={streak.streak_type} className="p-2 rounded bg-[var(--bg-secondary)]">
              <div className="text-lg font-bold">{streak.current_streak}</div>
              <div className="text-xs text-[var(--text-muted)]">
                {streak.streak_type === 'workout' ? '💪' : streak.streak_type === 'vitals_logged' ? '📊' : '🥗'}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header with tabs */}
      <div className="flex items-center gap-2 border-b border-[var(--border-primary)] pb-2">
        <button
          onClick={() => setActiveTab('overview')}
          className={cn(
            'px-3 py-1.5 text-sm rounded-lg transition-colors',
            activeTab === 'overview' 
              ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' 
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          )}
        >
          Обзор
        </button>
        <button
          onClick={() => setActiveTab('vitals')}
          className={cn(
            'px-3 py-1.5 text-sm rounded-lg transition-colors',
            activeTab === 'vitals' 
              ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' 
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          )}
        >
          Показатели
        </button>
        <button
          onClick={() => setActiveTab('achievements')}
          className={cn(
            'px-3 py-1.5 text-sm rounded-lg transition-colors',
            activeTab === 'achievements' 
              ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]' 
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          )}
        >
          Достижения
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Level & Points */}
          <LevelProgress data={gamification} />
          
          {/* Streaks */}
          <StreakDisplay streaks={streaks} />
          
          {/* Quick Vitals */}
          <VitalsCard 
            vitals={latest_vitals.slice(0, 6)} 
            onLogVital={onLogVital}
          />
        </div>
      )}

      {/* Vitals Tab */}
      {activeTab === 'vitals' && (
        <div className="space-y-4">
          {/* Profile Summary */}
          <ProfileSummary profile={profile} onEdit={onEditProfile} />
          
          {/* All Vitals */}
          <VitalsCard vitals={latest_vitals} onLogVital={onLogVital} />
        </div>
      )}

      {/* Achievements Tab */}
      {activeTab === 'achievements' && (
        <div className="text-center py-8 text-[var(--text-muted)]">
          <p className="text-4xl mb-3">🏆</p>
          <p>Достижения скоро появятся</p>
          <p className="text-xs mt-1">Продолжайте отслеживать показатели!</p>
        </div>
      )}
    </div>
  );
}
