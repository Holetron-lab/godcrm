import { groupOccurrences, isSeries, type OccurrenceEvent } from '../_shared/ticket-events';
import type { KanbanCardData } from './kanban-types';

/**
 * ADR-209 D6 — the events table as a second source for the board: a series
 * gets one card per column in which it has occurrences. Everything here is
 * pure: the widget feeds the result to the lane resolver instead of the
 * ticket rows.
 */

export interface OccurrenceMeta {
  ticketId: string;
  /** Live occurrences of the ticket in this column, earliest first. */
  eventIds: string[];
  count: number;
  /** Nearest upcoming occurrence in this column; the latest one when all are past. */
  nextStart: string | null;
}

export type OccurrenceCard = KanbanCardData & { _occ?: OccurrenceMeta };

/** Reconcile stops at this many occurrences per ticket (ADR-209 D4). */
export const OCCURRENCE_CAP = 500;
/** Series length when the ticket has no `duration` — same default as reconcile. */
export const DEFAULT_SERIES_MINUTES = 60;

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const startOf = (event: OccurrenceEvent): number => new Date(text(event.data.start_datetime)).getTime();

export const occurrenceOf = (card: KanbanCardData): OccurrenceMeta | undefined => (card as OccurrenceCard)._occ;

/** Positive number of minutes, or null when the ticket has no usable `duration`. */
export function ticketDurationMinutes(ticketData: Record<string, unknown> | undefined): number | null {
  const value = ticketData?.duration;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (String(value).trim() === '') return null;
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

function nearestStart(occurrences: OccurrenceEvent[], now: number): string | null {
  const upcoming = occurrences.find((event) => startOf(event) >= now);
  const nearest = upcoming ?? occurrences[occurrences.length - 1];
  return nearest ? text(nearest.data.start_datetime) || null : null;
}

interface BuildOptions {
  now?: number;
  /** Lane keys of the status column. An occurrence outside them follows its ticket. */
  knownStates?: ReadonlySet<string>;
}

/**
 * One card per column in which a series has live occurrences; every other
 * ticket is returned untouched, so the board without series is unchanged.
 */
export function buildOccurrenceCards(
  tickets: KanbanCardData[],
  events: OccurrenceEvent[],
  stateColumn: string,
  { now = Date.now(), knownStates }: BuildOptions = {},
): OccurrenceCard[] {
  const byTicket = groupOccurrences(events);
  return tickets.flatMap((ticket): OccurrenceCard[] => {
    const ticketId = text(ticket.id);
    const occurrences = byTicket.get(ticketId);
    if (!occurrences || !isSeries(ticket)) return [ticket];

    const ticketState = text(ticket.data?.[stateColumn]);
    const byState = new Map<string, OccurrenceEvent[]>();
    for (const occurrence of occurrences) {
      const own = text(occurrence.data.state);
      const state = own && (!knownStates || knownStates.has(own)) ? own : ticketState;
      const list = byState.get(state);
      if (list) list.push(occurrence);
      else byState.set(state, [occurrence]);
    }

    return Array.from(byState, ([state, list]) => ({
      ...ticket,
      id: `${ticketId}@${state}`,
      data: { ...ticket.data, [stateColumn]: state },
      _occ: {
        ticketId,
        eventIds: list.map((occurrence) => String(occurrence.id)),
        count: list.length,
        nextStart: nearestStart(list, now),
      },
    }));
  });
}

/**
 * Which occurrences a drag carries to column `toState`: every marked one of
 * the ticket, or — with no marks — the earliest one of the source column.
 */
export function pickOccurrencesToMove(
  card: OccurrenceMeta,
  events: OccurrenceEvent[],
  selected: ReadonlySet<string>,
  toState: string,
): string[] {
  const marked = events.filter((event) =>
    selected.has(String(event.id)) && text(event.data.ticket_id) === card.ticketId && event.data.status !== 'cancelled');
  if (marked.length === 0) return card.eventIds.slice(0, 1);
  return marked.filter((event) => text(event.data.state) !== toState).map((event) => String(event.id));
}

interface DurationLabels {
  hours: (amount: string) => string;
  minutes: (amount: string) => string;
}

/** 60 → «1 ч», 90 → «1,5 ч», 45 → «45 мин». Hours only when they need at most one decimal. */
export function formatDuration(minutes: number, language: string, labels: DurationLabels): string {
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  return minutes >= 60 && minutes % 6 === 0
    ? labels.hours(number.format(minutes / 60))
    : labels.minutes(number.format(minutes));
}

/** «12.11 15:00» in the reader's locale. */
export function formatEventStart(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = new Intl.DateTimeFormat(language, { day: '2-digit', month: '2-digit' }).format(date);
  const time = new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  return `${day} ${time}`;
}

/** Whole minutes between the start and the end of an event; null when either is missing. */
export function eventDurationMinutes(event: OccurrenceEvent): number | null {
  const minutes = Math.round((new Date(text(event.data.end_datetime)).getTime() - startOf(event)) / 60_000);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}
