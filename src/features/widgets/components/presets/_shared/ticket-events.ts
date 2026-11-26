/**
 * ADR-209 — the module's `ticket_events` table, read by widgets as a second
 * source next to the tickets. A ticket with `repeat` is a series; each of its
 * occurrences is one row of the events table with its own `state`. A one-off
 * ticket with a start time and a `duration` owns exactly one event.
 */

/** Row of the events table as `GET /tables/:id/rows?mode=raw` returns it. */
export interface OccurrenceEvent {
  id: string | number;
  data: Record<string, unknown>;
}

interface TicketRow {
  id?: string | number;
  data?: Record<string, unknown>;
}

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const startOf = (event: OccurrenceEvent): number => new Date(text(event.data.start_datetime)).getTime();

export const isSeries = (ticket: TicketRow): boolean => text(ticket.data?.repeat).trim() !== '';

/** Live (not cancelled) occurrences per ticket id, earliest first. */
export function groupOccurrences(events: OccurrenceEvent[]): Map<string, OccurrenceEvent[]> {
  const byTicket = new Map<string, OccurrenceEvent[]>();
  for (const event of events) {
    if (event.data.status === 'cancelled') continue;
    const ticketId = text(event.data.ticket_id);
    if (!ticketId) continue;
    const list = byTicket.get(ticketId);
    if (list) list.push(event);
    else byTicket.set(ticketId, [event]);
  }
  byTicket.forEach((list) => list.sort((left, right) => startOf(left) - startOf(right)));
  return byTicket;
}

/**
 * The event reconcile keeps for a one-off ticket: it carries `original_start`
 * and no `state`. Occurrences left over from a former series keep their state.
 */
export function oneOffEvent(occurrences: OccurrenceEvent[] | undefined): OccurrenceEvent | undefined {
  return occurrences?.find((event) => text(event.data.original_start) !== '' && text(event.data.state) === '');
}
