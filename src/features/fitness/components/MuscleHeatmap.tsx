/**
 * ADR-025: Muscle Heatmap Component
 * SVG body diagram with muscle group coloring based on volume
 */

import { useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import type { MuscleGroup, MuscleVolumeMap } from '../types';

export interface MuscleHeatmapProps {
  volumeData: MuscleVolumeMap;
  maxVolume?: number; // Max volume for intensity scaling
  className?: string;
}

// Map muscle names from DB to display names
const muscleDisplayNames: Record<string, string> = {
  chest: 'Грудь',
  back: 'Спина',
  shoulders: 'Плечи',
  biceps: 'Бицепс',
  triceps: 'Трицепс',
  forearms: 'Предплечья',
  abs: 'Пресс',
  obliques: 'Косые',
  quadriceps: 'Квадрицепс',
  hamstrings: 'Бицепс бедра',
  glutes: 'Ягодицы',
  calves: 'Икры',
  traps: 'Трапеция',
  lats: 'Широчайшие',
  lower_back: 'Поясница',
};

// Get color intensity based on volume (0-100%)
function getIntensityColor(volume: number, maxVolume: number): string {
  if (!volume || !maxVolume) return 'var(--bg-tertiary)';
  
  const intensity = Math.min(volume / maxVolume, 1);
  
  if (intensity < 0.2) return 'rgb(254 243 199)'; // yellow-100
  if (intensity < 0.4) return 'rgb(253 224 71)';  // yellow-300
  if (intensity < 0.6) return 'rgb(250 204 21)';  // yellow-400
  if (intensity < 0.8) return 'rgb(234 179 8)';   // yellow-500
  return 'rgb(202 138 4)'; // yellow-600
}

export function MuscleHeatmap({ volumeData, maxVolume, className }: MuscleHeatmapProps) {
  const calculatedMax = useMemo(() => {
    if (maxVolume) return maxVolume;
    const values = Object.values(volumeData);
    return values.length > 0 ? Math.max(...values) : 1;
  }, [volumeData, maxVolume]);

  const muscles = Object.entries(volumeData).sort((a, b) => b[1] - a[1]);

  return (
    <div className={cn('rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4', className)}>
      <h3 className="mb-4 font-semibold text-[var(--text-primary)]">Нагрузка по мышцам</h3>
      
      {muscles.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Нет данных о тренировках</p>
      ) : (
        <div className="space-y-2">
          {muscles.map(([muscle, volume]) => {
            const percentage = Math.round((volume / calculatedMax) * 100);
            return (
              <div key={muscle} className="flex items-center gap-3">
                <span className="w-24 text-sm text-[var(--text-secondary)]">
                  {muscleDisplayNames[muscle] || muscle}
                </span>
                <div className="flex-1 h-4 bg-[var(--bg-tertiary)] rounded overflow-hidden">
                  <div 
                    className="h-full rounded transition-all duration-300"
                    style={{ 
                      width: `${percentage}%`,
                      backgroundColor: getIntensityColor(volume, calculatedMax)
                    }}
                  />
                </div>
                <span className="w-16 text-right text-xs text-[var(--text-muted)]">
                  {formatVolume(volume)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      
      {/* Legend */}
      <div className="mt-4 flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>Низкая</span>
        <div className="flex gap-1">
          <span className="h-3 w-6 rounded" style={{ backgroundColor: 'rgb(254 243 199)' }} />
          <span className="h-3 w-6 rounded" style={{ backgroundColor: 'rgb(253 224 71)' }} />
          <span className="h-3 w-6 rounded" style={{ backgroundColor: 'rgb(250 204 21)' }} />
          <span className="h-3 w-6 rounded" style={{ backgroundColor: 'rgb(234 179 8)' }} />
          <span className="h-3 w-6 rounded" style={{ backgroundColor: 'rgb(202 138 4)' }} />
        </div>
        <span>Высокая</span>
      </div>
    </div>
  );
}

function formatVolume(kg: number): string {
  if (kg >= 1000) {
    return `${(kg / 1000).toFixed(1)}т`;
  }
  return `${kg.toLocaleString()}кг`;
}
