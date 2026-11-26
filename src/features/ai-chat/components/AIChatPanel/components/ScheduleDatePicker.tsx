import { useLanguage } from '@/shared/i18n/LanguageContext';
/**
 * ScheduleDatePicker — Inline datetime picker for scheduling messages.
 * WP-17: Ported from DateEditor (tables), simplified for chat use.
 * ADR-208 D8: optional "Repeat" section (presets → cron, free-form cron, end condition, timezone).
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Clock, Globe, Repeat, Send, X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { ScheduleSeries } from '../hooks/useScheduledMessages';
import {
  buildCron, formatCronLabel, getBrowserTimezone, isValidTimezone, listTimezones,
  WEEKDAY_KEYS, type RecurrenceForm, type RecurrencePreset,
} from '../utils/scheduleRecurrence';

interface ScheduleDatePickerProps {
  onSchedule: (isoDate: string) => void;
  onCancel: () => void;
  isScheduling?: boolean;
  /** ADR-208 D8: when provided, the "Repeat" section is shown and series are submitted through it. */
  onScheduleSeries?: (series: ScheduleSeries) => void;
}

const MONTHS_RU = ["dateSettings.months.jan", "dateSettings.months.feb", "dateSettings.months.mar", "dateSettings.months.apr", "dateSettings.months.may", "dateSettings.months.jun", "dateSettings.months.jul", "dateSettings.months.aug", "dateSettings.months.sep", "dateSettings.months.oct", "dateSettings.months.nov", "dateSettings.months.dec"];
const WEEKDAYS = ["dateSettings.weekdays.mon", "dateSettings.weekdays.tue", "dateSettings.weekdays.wed", "dateSettings.weekdays.thu", "dateSettings.weekdays.fri", "dateSettings.weekdays.sat", "dateSettings.weekdays.sun"];

// Quick schedule options
const QUICK_OPTIONS = [
  { label: "aiChat.ui.in30Minutes", minutes: 30 },
  { label: "aiChat.ui.in1Hour", minutes: 60 },
  { label: "aiChat.ui.in3Hours", minutes: 180 },
  { label: "aiChat.ui.tomorrowAt900", getDate: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; } },
  { label: "aiChat.ui.tomorrowAt1200", getDate: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12, 0, 0, 0); return d; } },
];

const PRESETS: Array<{ value: RecurrencePreset; labelKey: string }> = [
  { value: 'none', labelKey: 'aiChat.ui.repeatNone' },
  { value: 'daily', labelKey: 'aiChat.ui.repeatDaily' },
  { value: 'weekdays', labelKey: 'aiChat.ui.repeatWeekdays' },
  { value: 'weekly', labelKey: 'aiChat.ui.repeatWeekly' },
  { value: 'monthly', labelKey: 'aiChat.ui.repeatMonthly' },
  { value: 'cron', labelKey: 'aiChat.ui.repeatCron' },
];

const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
const TZ_LIST_ID = 'schedule-timezone-options';

const fieldClass = "text-xs bg-[var(--bg-tertiary)] rounded px-1.5 py-1 text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30";
const labelClass = "text-[10px] text-[var(--text-tertiary)] uppercase font-medium";

export function ScheduleDatePicker({ onSchedule, onCancel, isScheduling, onScheduleSeries }: ScheduleDatePickerProps) {
  const { t, language } = useLanguage();
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [hours, setHours] = useState(String(now.getHours()).padStart(2, '0'));
  const [minutes, setMinutes] = useState(String(Math.min(59, now.getMinutes() + 5)).padStart(2, '0'));
  const containerRef = useRef<HTMLDivElement>(null);

  // ADR-208 D8 — recurrence form (only rendered when onScheduleSeries is provided)
  const [preset, setPreset] = useState<RecurrencePreset>('none');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [monthDay, setMonthDay] = useState(String(now.getDate()));
  const [cronText, setCronText] = useState('');
  const [endless, setEndless] = useState(true);
  const [maxRuns, setMaxRuns] = useState('10');
  const [timezone, setTimezone] = useState(getBrowserTimezone);
  const timezones = useMemo(listTimezones, []);

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

  const hour = Math.min(23, Math.max(0, parseInt(hours) || 0));
  const minute = Math.min(59, Math.max(0, parseInt(minutes) || 0));

  const selectedInstant = (() => {
    if (!selectedDate) return null;
    const scheduled = new Date(selectedDate);
    scheduled.setHours(hour, minute, 0, 0);
    return scheduled;
  })();
  const selectedInFuture = !!selectedInstant && selectedInstant.getTime() > Date.now();

  const isSeries = !!onScheduleSeries && preset !== 'none';
  const recurrenceForm: RecurrenceForm = {
    preset, hour, minute, weekdays,
    monthDay: Math.min(31, Math.max(1, parseInt(monthDay) || 1)),
    cron: cronText,
  };
  const cron = isSeries ? buildCron(recurrenceForm) : null;
  const timezoneValid = isValidTimezone(timezone);
  const maxRunsValue = endless ? null : parseInt(maxRuns);
  const maxRunsValid = endless || (Number.isInteger(maxRunsValue) && (maxRunsValue as number) >= 1);
  const canScheduleSeries = cron !== null && timezoneValid && maxRunsValid && (!selectedDate || selectedInFuture);

  const handleSchedule = () => {
    if (isSeries) {
      if (!canScheduleSeries || !cron || !onScheduleSeries) return;
      onScheduleSeries({
        recurrence_cron: cron,
        timezone,
        max_runs: maxRunsValue,
        scheduled_at: selectedInstant && selectedInFuture ? selectedInstant.toISOString() : null,
      });
      return;
    }
    if (!selectedInstant || !selectedInFuture) return; // Can't schedule in the past
    onSchedule(selectedInstant.toISOString());
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

  const toggleWeekday = (day: number) =>
    setWeekdays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);

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

  const canSchedule = isSeries ? canScheduleSeries : selectedInFuture;

  return (
    <div ref={containerRef} className="mx-1 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-xl shadow-xl z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-secondary)]">
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
          <Clock className="w-3.5 h-3.5 text-[var(--color-primary-500)]" />
          {t('aiChat.ui.scheduleSend')}</div>
        <button onClick={onCancel} aria-label={t('aiChat.ui.close')} className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex">
        {/* Quick options */}
        <div className="w-36 border-r border-[var(--border-secondary)] py-1.5">
          <div className={cn('px-2 py-1', labelClass)}>{t('aiChat.ui.quickSelection')}</div>
          {QUICK_OPTIONS.map((opt) => (
            <button key={opt.label} onClick={() => handleQuickOption(opt)} disabled={isScheduling || isSeries}
              title={isSeries ? t('aiChat.ui.quickOptionsDisabledForSeries') : undefined}
              className="w-full px-3 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 disabled:hover:bg-transparent">
              {t(opt.label)}
            </button>
          ))}
        </div>

        {/* Calendar */}
        <div className="flex-1 p-2">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-2">
            <button onClick={() => goMonth(-1)} aria-label={t('aiChat.ui.previousMonth')} className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-medium text-[var(--text-primary)]">
              {t(MONTHS_RU[viewMonth])} {viewYear}
            </span>
            <button onClick={() => goMonth(1)} aria-label={t('aiChat.ui.nextMonth')} className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-0">
            {WEEKDAYS.map(w => (
              <div key={w} className="text-center text-[10px] text-[var(--text-tertiary)] py-0.5">{t(w)}</div>
            ))}
          </div>

          {/* Days grid */}
          <div className="grid grid-cols-7 gap-0">
            {calendarDays.map((d, i) => (
              <button key={i} disabled={isPast(d.date)} onClick={() => setSelectedDate(isSelected(d.date) && isSeries ? null : d.date)}
                aria-pressed={isSelected(d.date)}
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
            <input type="text" value={hours} maxLength={2} aria-label={t('aiChat.ui.hours')}
              onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 2); setHours(v); }}
              onBlur={() => setHours(String(Math.min(23, Math.max(0, parseInt(hours) || 0))).padStart(2, '0'))}
              className="w-8 text-center text-xs bg-[var(--bg-tertiary)] rounded px-1 py-1 text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
            />
            <span className="text-xs text-[var(--text-tertiary)]">:</span>
            <input type="text" value={minutes} maxLength={2} aria-label={t('aiChat.ui.minutes')}
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
              {isSeries ? <Repeat className="w-3 h-3" /> : <Send className="w-3 h-3" />}
              {isScheduling ? t('aiChat.ui.saving') : t(isSeries ? 'aiChat.ui.scheduleSeries' : 'aiChat.ui.schedule')}
            </button>
          </div>
        </div>
      </div>

      {/* ADR-208 D8 — Repeat section */}
      {onScheduleSeries && (
        <div className="border-t border-[var(--border-secondary)] px-3 py-2 space-y-2">
          <div className="flex items-center gap-2">
            <label htmlFor="schedule-repeat-preset" className={cn('flex items-center gap-1', labelClass)}>
              <Repeat className="w-3 h-3" />
              {t('aiChat.ui.repeat')}
            </label>
            <select id="schedule-repeat-preset" value={preset} onChange={(e) => setPreset(e.target.value as RecurrencePreset)}
              className={cn(fieldClass, 'flex-1 min-w-0')}>
              {PRESETS.map(p => <option key={p.value} value={p.value}>{t(p.labelKey)}</option>)}
            </select>
          </div>

          {preset === 'weekly' && (
            <div role="group" aria-label={t('aiChat.ui.repeatWeekly')} className="flex gap-1">
              {ISO_WEEKDAYS.map(day => (
                <button key={day} type="button" onClick={() => toggleWeekday(day)} aria-pressed={weekdays.includes(day)}
                  className={cn("flex-1 py-1 text-[10px] rounded-md border transition-colors",
                    weekdays.includes(day)
                      ? "bg-[var(--color-primary-500)] text-white border-transparent"
                      : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-primary)] hover:text-[var(--text-primary)]")}>
                  {t(WEEKDAY_KEYS[day])}
                </button>
              ))}
            </div>
          )}

          {preset === 'monthly' && (
            <div className="flex items-center gap-2">
              <label htmlFor="schedule-month-day" className={labelClass}>{t('aiChat.ui.monthDay')}</label>
              <input id="schedule-month-day" type="number" min={1} max={31} value={monthDay}
                onChange={(e) => setMonthDay(e.target.value)} className={cn(fieldClass, 'w-16')} />
            </div>
          )}

          {preset === 'cron' && (
            <div className="space-y-1">
              <input type="text" value={cronText} onChange={(e) => setCronText(e.target.value)}
                aria-label={t('aiChat.ui.repeatCron')} aria-invalid={cronText.trim() !== '' && cron === null}
                placeholder={t('aiChat.ui.cronPlaceholder')} spellCheck={false}
                className={cn(fieldClass, 'w-full font-mono')} />
              {cronText.trim() !== '' && cron === null && (
                <p role="alert" className="text-[10px] text-red-400">{t('aiChat.ui.cronInvalid')}</p>
              )}
            </div>
          )}

          {isSeries && (
            <>
              <div className="flex items-center gap-2">
                <label htmlFor="schedule-end" className={labelClass}>{t('aiChat.ui.endCondition')}</label>
                <select id="schedule-end" value={endless ? 'never' : 'count'} onChange={(e) => setEndless(e.target.value === 'never')}
                  className={cn(fieldClass, 'flex-1 min-w-0')}>
                  <option value="never">{t('aiChat.ui.endNever')}</option>
                  <option value="count">{t('aiChat.ui.endAfterRuns')}</option>
                </select>
                {!endless && (
                  <input type="number" min={1} value={maxRuns} onChange={(e) => setMaxRuns(e.target.value)}
                    aria-label={t('aiChat.ui.runsCount')} aria-invalid={!maxRunsValid}
                    className={cn(fieldClass, 'w-16', !maxRunsValid && 'border-red-400')} />
                )}
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="schedule-timezone" className={cn('flex items-center gap-1', labelClass)}>
                  <Globe className="w-3 h-3" />
                  {t('aiChat.ui.timezone')}
                </label>
                <input id="schedule-timezone" type="text" list={TZ_LIST_ID} value={timezone}
                  onChange={(e) => setTimezone(e.target.value.trim())} aria-invalid={!timezoneValid} spellCheck={false}
                  className={cn(fieldClass, 'flex-1 min-w-0', !timezoneValid && 'border-red-400')} />
                <datalist id={TZ_LIST_ID}>
                  {timezones.map(tz => <option key={tz} value={tz} />)}
                </datalist>
              </div>
              {!timezoneValid && <p role="alert" className="text-[10px] text-red-400">{t('aiChat.ui.timezoneInvalid')}</p>}

              {cron && (
                <p className="text-[11px] text-[var(--text-secondary)]" data-testid="recurrence-preview">
                  <span className="text-[var(--text-primary)] font-medium">↻ {formatCronLabel(cron, t)}</span>
                  {' · '}{timezone}
                  {' · '}{selectedInstant && selectedInFuture
                    ? t('aiChat.ui.firstRunAt', { date: selectedInstant.toLocaleString(language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })
                    : t('aiChat.ui.firstRunAuto')}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
