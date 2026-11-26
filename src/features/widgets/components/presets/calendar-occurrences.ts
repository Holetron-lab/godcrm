import { format } from 'date-fns';
import { groupOccurrences, isSeries, oneOffEvent, type OccurrenceEvent } from './_shared/ticket-events';

/**
 * ADR-209 D7 — the events table as a second source for the calendar: a series
 * is drawn as its occurrences instead of one strip over the whole window, and
 * the event of a one-off ticket replaces the ticket on its day. Pure: the
 * widget only places the result on the month grid.
 */

export interface CalendarOccurrence {
  eventId: string;
  /** Local day of the occurrence, `yyyy-MM-dd`. */
  day: string;
  /** «18:00–19:00»; empty for an all-day event. */
  time: string;
  /** Status the entry is coloured by: the occurrence's own, the ticket's when it has none. */
  state: string;
}

export interface TicketOccurrences {
  /** A series: the occurrences are drawn instead of the ticket's own strip. */
  replacesTicket: boolean;
  entries: CalendarOccurrence[];
}

interface TicketRow {
  id?: string | number;
  data?: Record<string, unknown>;
}

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

function timeLabel(event: OccurrenceEvent, start: Date): string {
  if (event.data.is_all_day === true) return '';
  const end = new Date(text(event.data.end_datetime));
  const from = format(start, 'HH:mm');
  return end.getTime() > start.getTime() ? `${from}–${format(end, 'HH:mm')}` : from;
}

/** What the calendar draws from the events table, per ticket id. Tickets without events are absent. */
export function calendarOccurrences(
  tickets: TicketRow[],
  events: OccurrenceEvent[],
  stateColumn: string,
): Map<string, TicketOccurrences> {
  const byTicket = groupOccurrences(events);
  const result = new Map<string, TicketOccurrences>();
  for (const ticket of tickets) {
    const ticketId = text(ticket.id);
    const live = byTicket.get(ticketId);
    if (!live) continue;
    const series = isSeries(ticket);
    const single = series ? undefined : oneOffEvent(live);
    const drawn = series ? live : single ? [single] : [];
    const ticketState = text(ticket.data?.[stateColumn]);

    const entries = drawn.flatMap((event): CalendarOccurrence[] => {
      const start = new Date(text(event.data.start_datetime));
      if (Number.isNaN(start.getTime())) return [];
      return [{
        eventId: String(event.id),
        day: format(start, 'yyyy-MM-dd'),
        time: timeLabel(event, start),
        state: text(event.data.state) || ticketState,
      }];
    });
    if (entries.length > 0) result.set(ticketId, { replacesTicket: series, entries });
  }
  return result;
}
