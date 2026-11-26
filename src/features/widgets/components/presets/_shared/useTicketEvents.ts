import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tablesApi } from '@/features/tables/api/tablesApi';
import type { OccurrenceEvent } from './ticket-events';

// ponytail: the whole events table in one page; a server-side date window
// replaces it once a widget outgrows the limit (ADR-209 D6).
const EVENTS_LIMIT = 2000;
/** Ticket fields reconcile reads — a change in any of them rewrites the events. */
const SCHEDULE_FIELDS = ['repeat', 'duration', 'scheduled_date', 'due_date', 'what'];
// Reconcile runs after the save response (ADR-209 Risks), so the first re-read
// can land before it commits; one more after this delay picks up the rest.
// ponytail: a row-change signal from reconcile would replace the second read.
const RECONCILE_SETTLE_MS = 1500;
const NO_EVENTS: OccurrenceEvent[] = [];

interface TicketRow {
  id?: string | number;
  data?: Record<string, unknown>;
}

const scheduleSignature = (ticket: TicketRow): string =>
  SCHEDULE_FIELDS.map((field) => String(ticket.data?.[field] ?? '')).join('\u0001');

/**
 * Rows of the events table of a widget (ADR-209): one request next to the
 * ticket rows, re-read once a ticket's schedule changes, whichever path saved
 * it. `eventsTableId = null` switches the second source off.
 */
export function useTicketEvents(eventsTableId: string | null, tickets: TicketRow[]) {
  const queryKey = useMemo(() => ['ticket-events', eventsTableId], [eventsTableId]);
  const { data: events = NO_EVENTS, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<OccurrenceEvent[]> => {
      if (!eventsTableId) return NO_EVENTS;
      const result = await tablesApi.getRows(eventsTableId, 1, EVENTS_LIMIT, true);
      return result.rows || NO_EVENTS;
    },
    enabled: !!eventsTableId,
    staleTime: 60000,
  });

  const seenSchedules = useRef(new Map<string, string>());
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!eventsTableId) return;
    const seen = seenSchedules.current;
    const primed = seen.size > 0;
    let changed = false;
    for (const ticket of tickets) {
      const id = String(ticket.id);
      const signature = scheduleSignature(ticket);
      if (primed && seen.get(id) !== signature) changed = true;
      seen.set(id, signature);
    }
    if (!changed) return;
    void refetch();
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => void refetch(), RECONCILE_SETTLE_MS);
  }, [eventsTableId, tickets, refetch]);
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  return { events, queryKey, refetch };
}
