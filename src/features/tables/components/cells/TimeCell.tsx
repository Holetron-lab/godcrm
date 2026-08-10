import React, { useState, useRef, useEffect } from 'react';
import { Clock, Calendar, Repeat } from 'lucide-react';

/**
 * Периодичность расписания
 * - time: только время (каждый день)
 * - monthly: конкретный день месяца + время
 * - weekly: день недели + время
 */
type ScheduleMode = 'time' | 'monthly' | 'weekly';

interface TimeConfig {
  mode?: ScheduleMode;
  format24h?: boolean;
}

interface TimeCellProps {
  value: unknown;
  config?: TimeConfig;
  rowData?: Record<string, unknown>;
  rawMode?: boolean;
  isEditing?: boolean;
  onSave?: (value: string | null) => void;
  onCancel?: () => void;
}

interface ParsedTime {
  hours: number;
  minutes: number;
  dayOfMonth?: number;  // 1-31
  dayOfWeek?: number;   // 0-6 (Вс-Сб)
}

// Парсинг cron формата: "минуты часы день_месяца месяц день_недели"
const parseCronValue = (value: unknown): ParsedTime | null => {
  if (!value || value === '') return null;
  
  const str = String(value).trim();
  
  // Cron формат: "30 14 15 * *" или "30 14 * * 1"
  const cronParts = str.split(/\s+/);
  if (cronParts.length >= 5) {
    const [mins, hrs, dom, , dow] = cronParts;
    const minutes = parseInt(mins, 10);
    const hours = parseInt(hrs, 10);
    
    if (!isNaN(minutes) && !isNaN(hours)) {
      return {
        minutes,
        hours,
        dayOfMonth: dom !== '*' ? parseInt(dom, 10) : undefined,
        dayOfWeek: dow !== '*' ? parseInt(dow, 10) : undefined,
      };
    }
  }
  
  // Простой формат "HH:MM" → конвертируем в cron-like структуру
  const timeMatch = str.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    return {
      hours: parseInt(timeMatch[1], 10),
      minutes: parseInt(timeMatch[2], 10),
    };
  }
  
  return null;
};

// Конвертация в cron формат для хранения
const toCronFormat = (parsed: ParsedTime): string => {
  const { minutes, hours, dayOfMonth, dayOfWeek } = parsed;
  const dom = dayOfMonth !== undefined ? String(dayOfMonth) : '*';
  const dow = dayOfWeek !== undefined ? String(dayOfWeek) : '*';
  return `${minutes} ${hours} ${dom} * ${dow}`;
};

// Форматирование для красивого отображения
const formatTimeDisplay = (parsed: ParsedTime, config?: TimeConfig): string => {
  const format24h = config?.format24h !== false;
  
  let timeStr: string;
  if (format24h) {
    timeStr = `${String(parsed.hours).padStart(2, '0')}:${String(parsed.minutes).padStart(2, '0')}`;
  } else {
    const hours12 = parsed.hours % 12 || 12;
    const ampm = parsed.hours < 12 ? 'AM' : 'PM';
    timeStr = `${hours12}:${String(parsed.minutes).padStart(2, '0')} ${ampm}`;
  }
  
  // День месяца: "15-е, 14:30"
  if (parsed.dayOfMonth !== undefined) {
    return `${parsed.dayOfMonth}-е, ${timeStr}`;
  }
  
  // День недели: "Пн, 14:30"
  if (parsed.dayOfWeek !== undefined) {
    const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    return `${days[parsed.dayOfWeek]}, ${timeStr}`;
  }
  
  // Просто время: "14:30"
  return timeStr;
};

// Определить режим из сохранённого cron
const detectModeFromParsed = (parsed: ParsedTime | null): ScheduleMode => {
  if (!parsed) return 'time';
  if (parsed.dayOfMonth !== undefined) return 'monthly';
  if (parsed.dayOfWeek !== undefined) return 'weekly';
  return 'time';
};

export const TimeCell: React.FC<TimeCellProps> = ({
  value,
  config,
  rawMode = false,
  isEditing = false,
  onSave,
  onCancel,
}) => {
  const parsed = parseCronValue(value);
  
  // Состояние для редактирования
  const [mode, setMode] = useState<ScheduleMode>(() => config?.mode ?? detectModeFromParsed(parsed));
  const [hours, setHours] = useState(parsed?.hours ?? 12);
  const [minutes, setMinutes] = useState(parsed?.minutes ?? 0);
  const [dayOfMonth, setDayOfMonth] = useState(parsed?.dayOfMonth ?? 1);
  const [dayOfWeek, setDayOfWeek] = useState(parsed?.dayOfWeek ?? 1);
  
  const inputRef = useRef<HTMLInputElement>(null);
  
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);
  
  // Синхронизация при изменении value
  useEffect(() => {
    const newParsed = parseCronValue(value);
    if (newParsed) {
      setHours(newParsed.hours);
      setMinutes(newParsed.minutes);
      if (newParsed.dayOfMonth !== undefined) setDayOfMonth(newParsed.dayOfMonth);
      if (newParsed.dayOfWeek !== undefined) setDayOfWeek(newParsed.dayOfWeek);
      setMode(detectModeFromParsed(newParsed));
    }
  }, [value]);
  
  // RAW mode - показываем cron формат
  if (rawMode) {
    if (!value || value === '') {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)] break-all">
        {String(value)}
      </span>
    );
  }
  
  // Editing mode
  if (isEditing && onSave) {
    const handleSave = () => {
      const result: ParsedTime = { hours, minutes };
      
      if (mode === 'monthly') {
        result.dayOfMonth = dayOfMonth;
      } else if (mode === 'weekly') {
        result.dayOfWeek = dayOfWeek;
      }
      
      onSave(toCronFormat(result));
    };
    
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        onCancel?.();
      }
    };
    
    return (
      <div className="flex flex-col gap-3 p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--color-primary-500)] min-w-[280px]">
        {/* Периодичность */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-[var(--text-tertiary)]">Периодичность</label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setMode('time')}
              className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                mode === 'time' 
                  ? 'bg-[var(--color-primary-500)] text-white' 
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
              }`}
            >
              ⏰ Каждый день
            </button>
            <button
              type="button"
              onClick={() => setMode('monthly')}
              className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                mode === 'monthly' 
                  ? 'bg-[var(--color-primary-500)] text-white' 
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
              }`}
            >
              📅 День месяца
            </button>
            <button
              type="button"
              onClick={() => setMode('weekly')}
              className={`flex-1 px-2 py-1.5 text-xs rounded transition-colors ${
                mode === 'weekly' 
                  ? 'bg-[var(--color-primary-500)] text-white' 
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
              }`}
            >
              🔄 День недели
            </button>
          </div>
        </div>
        
        {/* Время */}
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-[var(--text-tertiary)]" />
          <input
            ref={inputRef}
            type="time"
            value={`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number);
              setHours(h);
              setMinutes(m);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 px-2 py-1.5 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm"
          />
        </div>
        
        {/* День месяца */}
        {mode === 'monthly' && (
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[var(--text-tertiary)]" />
            <select
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(Number(e.target.value))}
              className="flex-1 px-2 py-1.5 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm"
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>{d}-е число</option>
              ))}
            </select>
          </div>
        )}
        
        {/* День недели */}
        {mode === 'weekly' && (
          <div className="flex items-center gap-2">
            <Repeat className="w-4 h-4 text-[var(--text-tertiary)]" />
            <select
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(Number(e.target.value))}
              className="flex-1 px-2 py-1.5 rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm"
            >
              <option value="1">Понедельник</option>
              <option value="2">Вторник</option>
              <option value="3">Среда</option>
              <option value="4">Четверг</option>
              <option value="5">Пятница</option>
              <option value="6">Суббота</option>
              <option value="0">Воскресенье</option>
            </select>
          </div>
        )}
        
        {/* Превью */}
        <div className="flex items-center gap-2 p-2 bg-[var(--bg-tertiary)] rounded text-sm">
          <span className="text-[var(--text-tertiary)]">→</span>
          <span className="font-medium text-[var(--text-primary)]">
            {formatTimeDisplay({
              hours,
              minutes,
              dayOfMonth: mode === 'monthly' ? dayOfMonth : undefined,
              dayOfWeek: mode === 'weekly' ? dayOfWeek : undefined,
            }, config)}
          </span>
          {mode !== 'time' && <Repeat className="w-3 h-3 text-[var(--color-primary-500)]" />}
        </div>
        
        {/* Кнопки */}
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            className="flex-1 px-3 py-1.5 text-xs bg-[var(--color-primary-500)] text-white rounded hover:opacity-90"
          >
            Сохранить
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-secondary)]"
          >
            Отмена
          </button>
        </div>
      </div>
    );
  }
  
  // Display mode - красивое отображение
  if (!parsed) {
    return <span className="text-sm text-[var(--text-tertiary)]">—</span>;
  }
  
  const displayText = formatTimeDisplay(parsed, config);
  const isRecurring = parsed.dayOfMonth !== undefined || parsed.dayOfWeek !== undefined;
  
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Clock className={`w-3.5 h-3.5 ${isRecurring ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)]'}`} />
      <span className="text-[var(--text-primary)]">{displayText}</span>
      {isRecurring && (
        <Repeat className="w-3 h-3 text-[var(--color-primary-500)]" title="Повторяющееся событие" />
      )}
    </div>
  );
};
