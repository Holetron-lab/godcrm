import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { showToast } from '@/shared/hooks/useToast';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { logger } from '@/shared/utils/logger';
import { groupOccurrences, type OccurrenceEvent } from '../_shared/ticket-events';
import { useTicketEvents } from '../_shared/useTicketEvents';
import type { KanbanCardData } from './kanban-types';
import {
  buildOccurrenceCards,
  occurrenceOf,
  pickOccurrencesToMove,
  type OccurrenceCard,
  type OccurrenceMeta,
} from './occurrence-cards';

const NO_EVENTS: OccurrenceEvent[] = [];
const NO_TICKETS: KanbanCardData[] = [];

interface OccurrenceSourceParams {
  /** Events table of the board; null switches the second source off. */
  eventsTableId: string | null;
  tickets: KanbanCardData[] | undefined;
  /** Status column the board is grouped by; null when it is grouped by anything else. */
  stateColumn: string | null;
  knownStates?: ReadonlySet<string>;
}

export function useOccurrenceSource({ eventsTableId, tickets = NO_TICKETS, stateColumn, knownStates }: OccurrenceSourceParams) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { events, queryKey, refetch } = useTicketEvents(eventsTableId, tickets);

  const cards: OccurrenceCard[] = useMemo(
    () => (eventsTableId && stateColumn ? buildOccurrenceCards(tickets, events, stateColumn, { knownStates }) : tickets),
    [eventsTableId, stateColumn, tickets, events, knownStates],
  );
  const metaByCardId = useMemo(() => {
    const map = new Map<string, OccurrenceMeta>();
    for (const card of cards) {
      const meta = occurrenceOf(card);
      if (meta) map.set(String(card.id), meta);
    }
    return map;
  }, [cards]);
  const byTicket = useMemo(() => groupOccurrences(events), [events]);

  // Marks of the mini-calendar: event ids, kept for the lifetime of the widget.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const toggleSelected = useCallback((eventIds: string[]) => {
    setSelected((current) => {
      const next = new Set(current);
      const allMarked = eventIds.every((id) => next.has(id));
      eventIds.forEach((id) => (allMarked ? next.delete(id) : next.add(id)));
      return next;
    });
  }, []);

  const move = useCallback(async (card: OccurrenceMeta, toState: string) => {
    if (!eventsTableId) return;
    const ids = new Set(pickOccurrencesToMove(card, events, selected, toState));
    if (ids.size === 0) return;
    const state = /^\d+$/.test(toState) ? Number(toState) : toState;

    await queryClient.cancelQueries({ queryKey });
    const previousEvents = queryClient.getQueryData<OccurrenceEvent[]>(queryKey);
    queryClient.setQueryData<OccurrenceEvent[]>(queryKey, (current = NO_EVENTS) =>
      current.map((event) => (ids.has(String(event.id)) ? { ...event, data: { ...event.data, state } } : event)));
    setSelected((current) => new Set([...current].filter((id) => !ids.has(id))));

    try {
      const result = await tablesApi.batchUpdateRows(eventsTableId, [...ids].map((rowId) => ({ rowId, data: { state } })));
      if (result.errors?.length) throw new Error(result.errors[0].error);
    } catch (error) {
      logger.error('Failed to move occurrences:', error);
      queryClient.setQueryData(queryKey, previousEvents);
      setSelected(selected);
      showToast(t('kanban.occurrenceMoveFailed'), 'error');
    } finally {
      await queryClient.invalidateQueries({ queryKey });
    }
  }, [eventsTableId, events, selected, queryClient, queryKey, t]);

  return { cards, metaByCardId, byTicket, selected, toggleSelected, move, refetch };
}
