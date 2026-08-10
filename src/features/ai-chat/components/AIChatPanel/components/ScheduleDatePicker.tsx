/**
 * ScheduleDatePicker — Inline datetime picker for scheduling messages.
 * WP-17: Ported from DateEditor (tables), simplified for chat use.
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Clock, Send, X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

interface ScheduleDatePickerProps {
  onSchedule: (isoDate: string) => void;
  onCancel: () => void;
  isScheduling?: boolean;
}

const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Quick schedule options
const QUICK_OPTIONS = [
  { label: 'Через 30 мин', minutes: 30 },
  { label: 'Через 1 час', minutes: 60 },
  { label: 'Через 3 часа', minutes: 180 },
  { label: 'Завтра 9:00', getDate: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
  { label: 'Завтра 12:00', getDate: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12, 0, 0, 0); return d; } },
];

export function ScheduleDatePicker({ onSchedule, onCancel, isScheduling }: ScheduleDatePickerProps) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [hours, setHours] = useState(String(now.getHours()).padStart(2, '0'));
  const [minutes, setMinutes] = useState(String(Math.min(59, now.getMinutes() + 5)).padStart(2, '0'));
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onCancel]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const startDay = (firstDay.getDay() + 6) % 7; // Monday = 0
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();
    const days: Array<{ day: number; month: 'prev' | 'current' | 'next'; date: Date }> = [];

    for (let i = startDay - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      days.push({ day: d, month: 'prev', date: new Date(viewYear, viewMonth - 1, d) });
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({ day: i, month: 'current', date: new Date(viewYear, viewMonth, i) });
    }
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ day: i, month: 'next', date: new Date(viewYear, viewMonth + 1, i) });
    }
    return days;
  }, [viewYear, viewMonth]);

  const goMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const handleSchedule = () => {
    if (!selectedDate) return;
    const h = parseInt(hours) || 0;
    const m = parseInt(minutes) || 0;
    const scheduled = new Date(selectedDate);
    scheduled.setHours(h, m, 0, 0);
    if (scheduled.getTime() <= Date.now()) return; // Can't schedule in the past
    onSchedule(scheduled.toISOString());
  };

  const handleQuickOption = (opt: typeof QUICK_OPTIONS[number]) => {
    let d: Date;
    if (opt.getDate) {
      d = opt.getDate();
    } else {
      d = new Date(Date.now() + (opt.minutes ?? 0) * 60_000);
    }
    onSchedule(d.toISOString());
  };

  const isToday = (date: Date) => {
    const t = new Date();
    return date.getDate() === t.getDate() && date.getMonth() === t.getMonth() && date.getFullYear() === t.getFullYear();
  };

  const isSelected = (date: Date) => {
    if (!selectedDate) return false;
    return date.getDate() === selectedDate.getDate() && date.getMonth() === selectedDate.getMonth() && date.getFullYear() === selectedDate.getFullYear();
  };

  const isPast = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };

  const canSchedule = selectedDate && (() => {
    const h = parseInt(hours) || 0;
    const m = parseInt(minutes) || 0;
    const d = new Date(selectedDate);
    d.setHours(h, m, 0, 0);
    return d.getTime() > Date.now();
  })();

  return (
    <div ref={containerRef} className="mx-1 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-xl shadow-xl z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-secondary)]">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
          <Clock className="w-3.5 h-3.5 text-[var(--color-primary-500)]" />
          Запланировать отправку
        </div>
        <button onClick={onCancel} className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex">
        {/* Quick options */}
        <div className="w-36 border-r border-[var(--border-secondary)] py-1.5">
          <div className="px-2 py-1 text-[10px] text-[var(--text-tertiary)] uppercase font-medium">Быстрый выбор</div>
          {QUICK_OPTIONS.map((opt) => (
            <button key={opt.label} onClick={() => handleQuickOption(opt)} disabled={isScheduling}
              className="w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors">
              {opt.label}
            </button>
          ))}
        </div>

        {/* Calendar */}
        <div className="flex-1 p-2">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => goMonth(-1)} className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-medium text-[var(--text-primary)]">
              {MONTHS_RU[viewMonth]} {viewYear}
            </span>
            <button onClick={() => goMonth(1)} className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-0">
            {WEEKDAYS.map(w => (
              <div key={w} className="text-center text-[10px] text-[var(--text-tertiary)] py-0.5">{w}</div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 gap-0">
            {calendarDays.map((d, i) => (
              <button key={i} disabled={isPast(d.date)} onClick={() => setSelectedDate(d.date)}
                className={cn(
                  "w-7 h-7 text-xs rounded-md transition-colors flex items-center justify-center",
                  d.month !== 'current' && "text-[var(--text-tertiary)]/40",
                  d.month === 'current' && !isPast(d.date) && "text-[var(--text-primary)]",
                  isPast(d.date) && "text-[var(--text-tertiary)]/20 cursor-not-allowed",
                  isToday(d.date) && "ring-1 ring-[var(--color-primary-500)]/40",
                  isSelected(d.date) && "bg-[var(--color-primary-500)] text-white",
                  !isSelected(d.date) && !isPast(d.date) && "hover:bg-[var(--bg-tertiary)]",
                )}>
                {d.day}
              </button>
            ))}
          </div>

          {/* Time input + schedule button */}
          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--border-secondary)]">
            <Clock className="w-3.5 h-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
            <input type="text" value={hours} maxLength={2}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 2); setHours(v); }}
              onBlur={() => setHours(String(Math.min(23, Math.max(0, parseInt(hours) || 0))).padStart(2, '0'))}
              className="w-8 text-center text-xs bg-[var(--bg-tertiary)] rounded px-1 py-1 text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
            />
            <span className="text-xs text-[var(--text-tertiary)]">:</span>
            <input type="text" value={minutes} maxLength={2}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 2); setMinutes(v); }}
              onBlur={() => setMinutes(String(Math.min(59, Math.max(0, parseInt(minutes) || 0))).padStart(2, '0'))}
              className="w-8 text-center text-xs bg-[var(--bg-tertiary)] rounded px-1 py-1 text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
            />
            <div className="flex-1" />
            <button onClick={handleSchedule} disabled={!canSchedule || isScheduling}
              className={cn("flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                canSchedule && !isScheduling
                  ? "bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)]"
                  : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] cursor-not-allowed"
              )}>
              <Send className="w-3 h-3" />
              {isScheduling ? 'Сохраняю...' : 'Запланировать'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
