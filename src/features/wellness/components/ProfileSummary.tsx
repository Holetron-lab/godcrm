/**
 * ADR-027: Profile Summary Component
 * Displays wellness profile with BMR/TDEE calculations
 */

import { cn } from '@/shared/utils/cn';
import type { WellnessProfile } from '../types';

export interface ProfileSummaryProps {
  profile: WellnessProfile | null;
  onEdit?: () => void;
  className?: string;
}

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: 'Сидячий образ жизни',
  light: 'Лёгкая активность',
  moderate: 'Умеренная активность',
  active: 'Активный образ жизни',
  very_active: 'Очень активный',
};

function calculateAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export function ProfileSummary({ profile, onEdit, className }: ProfileSummaryProps) {
  if (!profile) {
    return (
      <div className={cn(
        'rounded-lg border border-dashed border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 text-center',
        className
      )}>
        <p className="text-3xl mb-3">👤</p>
        <p className="text-[var(--text-secondary)] mb-2">Профиль не настроен</p>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          Заполните профиль для расчёта BMR/TDEE
        </p>
        {onEdit && (
          <button
            onClick={onEdit}
            className="px-4 py-2 text-sm rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors"
          >
            Настроить профиль
          </button>
        )}
      </div>
    );
  }

  const age = calculateAge(profile.birth_date);
  const weightDiff = profile.target_weight_kg && profile.current_weight_kg
    ? profile.target_weight_kg - profile.current_weight_kg
    : null;

  return (
    <div className={cn(
      'rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4',
      className
    )}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">
          👤 Мой профиль
        </h3>
        {onEdit && (
          <button
            onClick={onEdit}
            className="text-xs text-blue-500 hover:text-blue-400"
          >
            Редактировать
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {/* Height */}
        {profile.height_cm && (
          <div className="text-center">
            <div className="text-2xl font-bold text-[var(--text-primary)]">
              {profile.height_cm}
            </div>
            <div className="text-xs text-[var(--text-muted)]">см</div>
          </div>
        )}

        {/* Weight */}
        {profile.current_weight_kg && (
          <div className="text-center">
            <div className="text-2xl font-bold text-[var(--text-primary)]">
              {profile.current_weight_kg}
            </div>
            <div className="text-xs text-[var(--text-muted)]">кг</div>
          </div>
        )}

        {/* Age */}
        {age && (
          <div className="text-center">
            <div className="text-2xl font-bold text-[var(--text-primary)]">
              {age}
            </div>
            <div className="text-xs text-[var(--text-muted)]">лет</div>
          </div>
        )}

        {/* Target */}
        {profile.target_weight_kg && (
          <div className="text-center">
            <div className="text-2xl font-bold text-[var(--text-primary)]">
              {profile.target_weight_kg}
              {weightDiff !== null && (
                <span className={cn(
                  'text-sm ml-1',
                  weightDiff < 0 ? 'text-green-500' : weightDiff > 0 ? 'text-orange-500' : 'text-[var(--text-muted)]'
                )}>
                  ({weightDiff > 0 ? '+' : ''}{weightDiff.toFixed(1)})
                </span>
              )}
            </div>
            <div className="text-xs text-[var(--text-muted)]">цель кг</div>
          </div>
        )}
      </div>

      {/* Activity Level */}
      {profile.activity_level && (
        <div className="mt-4 pt-4 border-t border-[var(--border-primary)]">
          <div className="text-xs text-[var(--text-muted)] mb-1">Активность</div>
          <div className="text-sm text-[var(--text-primary)]">
            {ACTIVITY_LABELS[profile.activity_level] || profile.activity_level}
          </div>
        </div>
      )}

      {/* BMR / TDEE */}
      {(profile.bmr_kcal || profile.tdee_kcal) && (
        <div className="mt-4 pt-4 border-t border-[var(--border-primary)] grid grid-cols-2 gap-4">
          {profile.bmr_kcal && (
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-1">
                BMR (базовый метаболизм)
              </div>
              <div className="text-lg font-bold text-[var(--text-primary)]">
                {Math.round(profile.bmr_kcal)} <span className="text-xs font-normal">ккал/день</span>
              </div>
            </div>
          )}
          {profile.tdee_kcal && (
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-1">
                TDEE (с активностью)
              </div>
              <div className="text-lg font-bold text-[var(--text-primary)]">
                {Math.round(profile.tdee_kcal)} <span className="text-xs font-normal">ккал/день</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
