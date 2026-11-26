import { createContext, useContext, useId, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock, Repeat } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { formatCronLabel } from '@/features/tables/components/cells/TimeCell';
import { isSeries, oneOffEvent, type OccurrenceEvent } from '../_shared/ticket-events';
import { hexToRgba } from './kanban-utils';
import type { KanbanCardData } from './kanban-types';
import {
  DEFAULT_SERIES_MINUTES,
  OCCURRENCE_CAP,
  eventDurationMinutes,
  formatDuration,
  formatEventStart,
  occurrenceOf,
  ticketDurationMinutes,
} from './occurrence-cards';

/** What a card needs from the board's second source (ADR-209 D6). Absent = source off. */
export interface OccurrenceBoard {
  /** Live occurrences per ticket id, earliest first. */
  byTicket: Map<string, OccurrenceEvent[]>;
  selected: ReadonlySet<string>;
  toggleSelected: (eventIds: string[]) => void;
  states: Map<string, { label: string; color: string }>;
}

export const OccurrenceBoardContext = createContext<OccurrenceBoard | null>(null);

const NAV_BUTTON = 'p-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)]';
const HINT = 'mt-0.5 text-amber-700 dark:text-amber-400';

const startDate = (occurrence: OccurrenceEvent) => new Date(String(occurrence.data.start_datetime));

interface MiniCalendarProps {
  occurrences: OccurrenceEvent[];
  focus: string | null;
  board: OccurrenceBoard;
}

/** Month grid of one ticket's occurrences; a date is a toggle that marks it for the next drag. */
function OccurrenceMiniCalendar({ occurrences, focus, board }: MiniCalendarProps) {
  const { t, language } = useLanguage();
  const [month, setMonth] = useState(() => {
    const anchor = focus ? new Date(focus) : startDate(occurrences[0]);
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  });
  const year = month.getFullYear();
  const monthIndex = month.getMonth();

  const byDay = new Map<number, OccurrenceEvent[]>();
  for (const occurrence of occurrences) {
    const start = startDate(occurrence);
    if (start.getFullYear() !== year || start.getMonth() !== monthIndex) continue;
    byDay.set(start.getDate(), [...(byDay.get(start.getDate()) ?? []), occurrence]);
  }
  const leadingBlanks = (month.getDay() + 6) % 7; // weeks start on Monday
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const weekday = new Intl.DateTimeFormat(language, { weekday: 'narrow' });
  const dayLabel = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const markedCount = occurrences.filter((occurrence) => board.selected.has(String(occurrence.id))).length;

  return (
    <div role="group" aria-label={t('kanban.occurrenceCalendar')} className="mt-1.5">
      <div className="flex items-center justify-between mb-1">
        <button type="button" aria-label={t('kanban.previousMonth')} className={NAV_BUTTON}
          onClick={(event) => { event.stopPropagation(); setMonth(new Date(year, monthIndex - 1, 1)); }}>
          <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <span aria-live="polite" className="font-medium capitalize text-[var(--text-primary)]">
          {new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric' }).format(month)}
        </span>
        <button type="button" aria-label={t('kanban.nextMonth')} className={NAV_BUTTON}
          onClick={(event) => { event.stopPropagation(); setMonth(new Date(year, monthIndex + 1, 1)); }}>
          <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] tabular-nums">
        {/* 1 January 2024 is a Monday */}
        {Array.from({ length: 7 }, (_, index) => (
          <span key={`weekday-${index}`} aria-hidden="true" className="text-[var(--text-quaternary)]">
            {weekday.format(new Date(2024, 0, index + 1))}
          </span>
        ))}
        {Array.from({ length: leadingBlanks }, (_, index) => <span key={`blank-${index}`} />)}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1;
          const dayOccurrences = byDay.get(day);
          if (!dayOccurrences) {
            return <span key={day} className="h-6 leading-6 text-[var(--text-quaternary)]">{day}</span>;
          }
          const ids = dayOccurrences.map((occurrence) => String(occurrence.id));
          const state = board.states.get(String(dayOccurrences[0].data.state ?? ''));
          const marked = ids.every((id) => board.selected.has(id));
          const date = dayLabel.format(startDate(dayOccurrences[0]));
          return (
            <button key={day} type="button" aria-pressed={marked}
              aria-label={state ? t('kanban.occurrenceDay', { date, state: state.label }) : date}
              onClick={(event) => { event.stopPropagation(); board.toggleSelected(ids); }}
              style={state ? { backgroundColor: hexToRgba(state.color, 0.25), borderColor: state.color } : undefined}
              className={`h-6 rounded border border-[var(--border-primary)] text-[var(--text-primary)] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)] ${
                marked ? 'font-bold ring-2 ring-[var(--color-primary-500)]' : ''
              }`}>
              {day}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[var(--text-tertiary)]" aria-live="polite">
        {markedCount > 0 ? t('kanban.occurrencesMarked', { count: markedCount }) : t('kanban.occurrencesMarkHint')}
      </p>
    </div>
  );
}

interface DurationFieldProps {
  minutes: number | null;
  onChange: (minutes: number | null) => void;
}

/** `duration` of the ticket — the one place the length of its events is set (ADR-209 A2). */
function DurationField({ minutes, onChange }: DurationFieldProps) {
  const { t } = useLanguage();
  const fieldId = useId();
  return (
    <div className="mt-1.5 flex items-center gap-2">
      <label htmlFor={fieldId} className="text-[var(--text-tertiary)]">{t('kanban.durationField')}</label>
      <input
        id={fieldId}
        key={minutes ?? ''}
        type="number"
        min={1}
        step={1}
        defaultValue={minutes ?? ''}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        onBlur={(event) => {
          const next = event.target.value === '' ? null : Number(event.target.value);
          if (next !== minutes && (next === null || next > 0)) onChange(next);
        }}
        className="w-16 px-1.5 py-0.5 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] tabular-nums invalid:border-red-500 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
      />
    </div>
  );
}

interface OccurrenceCardSectionProps {
  item: KanbanCardData;
  isExpanded: boolean;
  /** Absent when the card is read-only or the table has no `duration` column. */
  onDurationChange?: (minutes: number | null) => void;
}

/**
 * Schedule line of a card: the series badge with its counter and mini-calendar,
 * or the time of a one-off ticket's event. Renders nothing without the second source.
 */
export function OccurrenceCardSection({ item, isExpanded, onDurationChange }: OccurrenceCardSectionProps) {
  const board = useContext(OccurrenceBoardContext);
  const { t, language } = useLanguage();
  if (!board) return null;

  const meta = occurrenceOf(item);
  const occurrences = board.byTicket.get(meta?.ticketId ?? String(item.id));
  const duration = (minutes: number) => formatDuration(minutes, language, {
    hours: (amount) => t('kanban.durationHours', { amount }),
    minutes: (amount) => t('kanban.durationMinutes', { amount }),
  });
  const durationField = isExpanded && onDurationChange
    ? <DurationField minutes={ticketDurationMinutes(item.data)} onChange={onDurationChange} />
    : null;

  if (isSeries(item)) {
    const schedule = [
      formatCronLabel(item.data?.repeat),
      duration(ticketDurationMinutes(item.data) ?? DEFAULT_SERIES_MINUTES),
    ].filter(Boolean).join(' · ');
    return (
      <div className="px-2 py-1 text-[11px] text-[var(--text-secondary)]">
        <div className="flex items-center gap-1.5">
          <Repeat className="w-3 h-3 flex-shrink-0 text-[var(--color-primary-500)]" aria-hidden="true" />
          <span className="truncate">{schedule}</span>
          {meta && (
            <span className="ml-auto flex-shrink-0 font-medium tabular-nums text-[var(--text-primary)]">
              <span aria-hidden="true">×{meta.count}</span>
              <span className="sr-only">{t('kanban.occurrenceCount', { count: meta.count })}</span>
            </span>
          )}
        </div>
        {meta?.nextStart && (
          <p className="text-[var(--text-tertiary)]">
            {t('kanban.nextOccurrence', { date: formatEventStart(meta.nextStart, language) })}
          </p>
        )}
        {!item.data?.due_date && <p className={HINT}>{t('kanban.seriesNeedsEnd')}</p>}
        {occurrences && occurrences.length >= OCCURRENCE_CAP && (
          <p className={HINT}>{t('kanban.seriesCapped', { count: OCCURRENCE_CAP })}</p>
        )}
        {isExpanded && meta && occurrences && (
          <OccurrenceMiniCalendar occurrences={occurrences} focus={meta.nextStart} board={board} />
        )}
        {durationField}
      </div>
    );
  }

  const event = oneOffEvent(occurrences);
  if (!event && !durationField) return null;
  const minutes = event && eventDurationMinutes(event);
  return (
    <div className="px-2 py-1 text-[11px] text-[var(--text-secondary)]">
      {event && (
        <div className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 flex-shrink-0 text-[var(--text-tertiary)]" aria-hidden="true" />
          <span className="truncate">
            {[formatEventStart(String(event.data.start_datetime), language), minutes && duration(minutes)].filter(Boolean).join(' · ')}
          </span>
        </div>
      )}
      {durationField}
    </div>
  );
}
