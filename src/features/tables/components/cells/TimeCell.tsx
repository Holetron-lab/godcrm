import React, { useId, useState, useRef, useEffect } from 'react';
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
  daysOfWeek?: number[]; // 0-6 (Вс-Сб), по возрастанию
}

const DAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const DAY_NAMES = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
// Неделя с понедельника — порядок кнопок и подписи
const WEEK = [1, 2, 3, 4, 5, 6, 0];

// Поле дня недели cron: «1», «1,3,5», «1-5»; 7 — тоже воскресенье
const parseDaysOfWeek = (field: string): number[] | undefined => {
  const days = new Set<number>();
  for (const part of field.split(',')) {
    const range = part.match(/^([0-7])(?:-([0-7]))?$/);
    if (!range) continue;
    for (let day = Number(range[1]); day <= Number(range[2] ?? range[1]); day++) days.add(day % 7);
  }
  return days.size > 0 ? [...days].sort((a, b) => a - b) : undefined;
};

// Парсинг cron формата: "минуты часы день_месяца месяц день_недели"
const parseCronValue = (value: unknown): ParsedTime | null => {
  if (!value || value === '') return null;
  
  const str = String(value).trim();
  
  // Cron формат: "30 14 15 * *", "30 14 * * 1" или "30 14 * * 1,3,5"
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
        daysOfWeek: parseDaysOfWeek(dow),
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
  const { minutes, hours, dayOfMonth, daysOfWeek } = parsed;
  const dom = dayOfMonth !== undefined ? String(dayOfMonth) : '*';
  const dow = daysOfWeek?.length ? daysOfWeek.join(',') : '*';
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
  
  // День недели: "Пн, 14:30"; несколько дней: "пн, ср, пт 18:00"
  if (parsed.daysOfWeek?.length === 1) {
    return `${DAY_SHORT[parsed.daysOfWeek[0]]}, ${timeStr}`;
  }
  if (parsed.daysOfWeek) {
    const days = WEEK.filter(day => parsed.daysOfWeek?.includes(day));
    return `${days.map(day => DAY_SHORT[day].toLowerCase()).join(', ')} ${timeStr}`;
  }
  
  // Просто время: "14:30"
  return timeStr;
};

// Подпись расписания для мест вне ячейки (карточка канбана): «пн, ср, пт 18:00»
export const formatCronLabel = (value: unknown, config?: TimeConfig): string | null => {
  const parsed = parseCronValue(value);
  return parsed ? formatTimeDisplay(parsed, config) : null;
};

// Определить режим из сохранённого cron
const detectModeFromParsed = (parsed: ParsedTime | null): ScheduleMode => {
  if (!parsed) return 'time';
  if (parsed.dayOfMonth !== undefined) return 'monthly';
  if (parsed.daysOfWeek) return 'weekly';
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
  const fieldId = useId();
  const parsed = parseCronValue(value);
  
  // Состояние для редактирования
  const [mode, setMode] = useState<ScheduleMode>(() => config?.mode ?? detectModeFromParsed(parsed));
  const [hours, setHours] = useState(parsed?.hours ?? 12);
  const [minutes, setMinutes] = useState(parsed?.minutes ?? 0);
  const [dayOfMonth, setDayOfMonth] = useState(parsed?.dayOfMonth ?? 1);
  const [daysOfWeek, setDaysOfWeek] = useState(parsed?.daysOfWeek ?? [1]);
  
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
      if (newParsed.daysOfWeek) setDaysOfWeek(newParsed.daysOfWeek);
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
        result.daysOfWeek = daysOfWeek;
      }
      
      onSave(toCronFormat(result));
    };
    
    // Хотя бы один день остаётся выбранным
    const toggleDay = (day: number) => setDaysOfWeek(current => {
      if (!current.includes(day)) return [...current, day].sort((a, b) => a - b);
      return current.length > 1 ? current.filter(selected => selected !== day) : current;
    });

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
        <div role="group" aria-labelledby={`${fieldId}-label-0`} className="flex flex-col gap-1">
          <span id={`${fieldId}-label-0`} className="text-xs text-[var(--text-tertiary)]">Периодичность</span>
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
              id={`${fieldId}-weekly`}
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
        
        {/* Дни недели */}
        {mode === 'weekly' && (
          <div className="flex items-center gap-2">
            <Repeat className="w-4 h-4 text-[var(--text-tertiary)]" />
            <div role="group" aria-labelledby={`${fieldId}-weekly`} className="flex flex-1 gap-1">
              {WEEK.map(day => (
                <button
                  key={day}
                  type="button"
                  aria-label={DAY_NAMES[day]}
                  aria-pressed={daysOfWeek.includes(day)}
                  onClick={() => toggleDay(day)}
                  className={`flex-1 px-1 py-1.5 text-xs rounded transition-colors ${
                    daysOfWeek.includes(day)
                      ? 'bg-[var(--color-primary-500)] text-white'
                      : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                  }`}
                >
                  {DAY_SHORT[day]}
                </button>
              ))}
            </div>
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
              daysOfWeek: mode === 'weekly' ? daysOfWeek : undefined,
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
  const isRecurring = parsed.dayOfMonth !== undefined || parsed.daysOfWeek !== undefined;
  
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Clock className={`w-3.5 h-3.5 ${isRecurring ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)]'}`} />
      <span className="text-[var(--text-primary)]">{displayText}</span>
      {isRecurring && (
        <span title="Повторяющееся событие"><Repeat className="w-3 h-3 text-[var(--color-primary-500)]" /></span>
      )}
    </div>
  );
};
