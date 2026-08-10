import React from 'react';
import { ColumnSettingsProps } from './types';
import { Clock, Repeat } from 'lucide-react';

/**
 * Настройки для колонки типа time
 * Простой UI - пользователь видит предпросмотр, хранение в cron формате
 */
export const TimeColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
}) => {
  const format24h = draft.config?.time?.format24h !== false;
  
  const updateTimeConfig = (updates: Record<string, unknown>) => {
    setDraft(prev => ({
      ...prev,
      config: {
        ...prev.config,
        time: { ...prev.config?.time, ...updates }
      }
    }));
  };

  return (
    <div className="space-y-4 p-4 border border-[var(--border-color)] rounded-lg bg-[var(--bg-secondary)]">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        <Clock className="w-4 h-4" />
        Настройки времени
      </h4>

      {/* Формат времени */}
      <div className="space-y-2">
        <label className="text-sm text-[var(--text-secondary)]">Формат отображения</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => updateTimeConfig({ format24h: true })}
            className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
              format24h 
                ? 'border-[var(--color-primary-500)] bg-primary-50 text-[var(--color-primary-500)]' 
                : 'border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:border-[var(--color-primary-300)]'
            }`}
          >
            24-часовой (14:30)
          </button>
          <button
            type="button"
            onClick={() => updateTimeConfig({ format24h: false })}
            className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
              !format24h 
                ? 'border-[var(--color-primary-500)] bg-primary-50 text-[var(--color-primary-500)]' 
                : 'border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:border-[var(--color-primary-300)]'
            }`}
          >
            12-часовой (2:30 PM)
          </button>
        </div>
      </div>

      {/* Примеры отображения */}
      <div className="space-y-3 p-3 bg-[var(--bg-tertiary)] rounded-lg">
        <div className="text-xs text-[var(--text-tertiary)]">Примеры отображения:</div>
        
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
            <span className="text-sm text-[var(--text-primary)]">
              {format24h ? '14:30' : '2:30 PM'}
            </span>
            <span className="text-xs text-[var(--text-tertiary)]">— каждый день</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-[var(--color-primary-500)]" />
            <span className="text-sm text-[var(--text-primary)]">
              {format24h ? '15-е, 14:30' : '15-е, 2:30 PM'}
            </span>
            <Repeat className="w-3 h-3 text-[var(--color-primary-500)]" />
            <span className="text-xs text-[var(--text-tertiary)]">— 15-го числа</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-[var(--color-primary-500)]" />
            <span className="text-sm text-[var(--text-primary)]">
              {format24h ? 'Пн, 14:30' : 'Пн, 2:30 PM'}
            </span>
            <Repeat className="w-3 h-3 text-[var(--color-primary-500)]" />
            <span className="text-xs text-[var(--text-tertiary)]">— каждый понедельник</span>
          </div>
        </div>
      </div>

      {/* Подсказка о cron */}
      <div className="text-xs text-[var(--text-tertiary)] space-y-1 p-2 bg-[var(--bg-primary)] rounded border border-[var(--border-primary)]">
        <p>💡 <strong>Хранение:</strong> данные сохраняются в cron формате</p>
        <p className="font-mono text-[10px] text-[var(--text-quaternary)]">
          30 14 * * * = 14:30 каждый день<br/>
          30 14 15 * * = 14:30 15-го числа<br/>
          30 14 * * 1 = 14:30 по понедельникам
        </p>
      </div>
    </div>
  );
};
