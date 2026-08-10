/**
 * ADR-027: Vitals Card Component
 * Displays latest vital readings with quick input
 */

import { cn } from '@/shared/utils/cn';
import type { VitalLatest, VitalType } from '../types';

export interface VitalsCardProps {
  vitals: VitalLatest[];
  onLogVital?: (type: VitalType) => void;
  className?: string;
}

const VITAL_INFO: Record<string, { label: string; emoji: string; unit: string }> = {
  weight: { label: 'Вес', emoji: '⚖️', unit: 'кг' },
  heart_rate: { label: 'Пульс', emoji: '❤️', unit: 'уд/мин' },
  blood_pressure_sys: { label: 'Давление (верх)', emoji: '🩺', unit: 'мм' },
  blood_pressure_dia: { label: 'Давление (низ)', emoji: '🩺', unit: 'мм' },
  temperature: { label: 'Температура', emoji: '🌡️', unit: '°C' },
  spo2: { label: 'SpO2', emoji: '🫁', unit: '%' },
  blood_glucose: { label: 'Глюкоза', emoji: '🩸', unit: 'ммоль/л' },
  body_fat_pct: { label: '% жира', emoji: '📏', unit: '%' },
  body_battery: { label: 'Энергия', emoji: '🔋', unit: '%' },
};

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  
  if (diffMins < 1) return 'только что';
  if (diffMins < 60) return `${diffMins} мин назад`;
  if (diffHours < 24) return `${diffHours}ч назад`;
  if (diffDays < 7) return `${diffDays}д назад`;
  return date.toLocaleDateString('ru-RU');
}

export function VitalsCard({ vitals, onLogVital, className }: VitalsCardProps) {
  return (
    <div className={cn(
      'rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4',
      className
    )}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-[var(--text-secondary)]">
          📊 Показатели здоровья
        </h3>
        {onLogVital && (
          <button 
            onClick={() => onLogVital('weight')}
            className="text-xs text-blue-500 hover:text-blue-400"
          >
            + Добавить замер
          </button>
        )}
      </div>
      
      {vitals.length === 0 ? (
        <div className="text-center py-6 text-[var(--text-muted)]">
          <p className="text-3xl mb-2">📊</p>
          <p>Нет записей</p>
          <p className="text-xs mt-1">Добавьте первый замер</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {vitals.map((vital) => {
            const info = VITAL_INFO[vital.vital_type] || { 
              label: vital.vital_type, 
              emoji: '📈',
              unit: vital.unit 
            };
            
            return (
              <div 
                key={vital.vital_type}
                className="p-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] cursor-pointer transition-colors"
                onClick={() => onLogVital?.(vital.vital_type)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{info.emoji}</span>
                  <span className="text-xs text-[var(--text-muted)]">{info.label}</span>
                </div>
                <div className="text-lg font-bold text-[var(--text-primary)]">
                  {vital.value} <span className="text-xs font-normal text-[var(--text-muted)]">{vital.unit}</span>
                </div>
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  {formatTimeAgo(vital.recorded_at)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
