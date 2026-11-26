import { describe, expect, it } from 'vitest';
import { groupOccurrences, oneOffEvent, type OccurrenceEvent } from '../_shared/ticket-events';
import {
  buildOccurrenceCards,
  formatDuration,
  occurrenceOf,
  pickOccurrencesToMove,
  ticketDurationMinutes,
} from './occurrence-cards';

const BACKLOG = '1';
const REVIEW = '4';
const DONE = '7';
const NOW = new Date(2026, 10, 10, 12, 0).getTime();

const at = (day: number, hour = 18) => new Date(2026, 10, day, hour, 0).toISOString();

function event(id: number, ticketId: number, day: number, state: string | null, extra: Record<string, unknown> = {}): OccurrenceEvent {
  const start = at(day);
  return {
    id,
    data: {
      ticket_id: ticketId, state: state === null ? null : Number(state), status: 'confirmed',
      original_start: start, start_datetime: start, end_datetime: at(day, 19), ...extra,
    },
  };
}

const series = { id: 7, data: { what: 'Английский', state: 1, repeat: '0 18 * * 1,3,5', duration: 60 } };
const single = { id: 8, data: { what: 'Созвон', state: 4, duration: 60 } };

describe('buildOccurrenceCards', () => {
  it('splits a series into one card per column that holds live occurrences', () => {
    const events = [
      event(101, 7, 13, BACKLOG), event(102, 7, 11, BACKLOG), event(103, 7, 9, REVIEW),
      event(104, 7, 6, DONE), event(105, 7, 4, DONE), event(106, 7, 16, BACKLOG, { status: 'cancelled' }),
    ];
    // Column order is the lane resolver's business; sort to compare.
    const cards = buildOccurrenceCards([series], events, 'state', { now: NOW })
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));

    expect(cards.map((card) => card.id)).toEqual(['7@1', '7@4', '7@7']);
    expect(cards.map((card) => card.data?.state)).toEqual([BACKLOG, REVIEW, DONE]);
    expect(occurrenceOf(cards[0])).toEqual({ ticketId: '7', eventIds: ['102', '101'], count: 2, nextStart: at(11) });
    // Every occurrence of the Done card is in the past: the latest one stands in for "next".
    expect(occurrenceOf(cards[2])).toMatchObject({ eventIds: ['105', '104'], count: 2, nextStart: at(6) });
    expect(cards[0].data?.what).toBe('Английский');
  });

  it('keeps a one-off ticket as a single card in its own column even when it has an event', () => {
    const cards = buildOccurrenceCards([single], [event(201, 8, 12, null)], 'state', { now: NOW });
    expect(cards).toEqual([single]);
    expect(cards[0]).toBe(single);
  });

  it('keeps one card for a ticket whose repeat was cleared but occurrences of the old series remain', () => {
    const former = { id: 9, data: { what: 'Бывшая серия', state: 1, repeat: '  ' } };
    const cards = buildOccurrenceCards([former], [event(301, 9, 4, DONE), event(302, 9, 6, REVIEW)], 'state', { now: NOW });
    expect(cards).toEqual([former]);
  });

  it('keeps a series without live occurrences as its own card', () => {
    const cancelled = [event(401, 7, 11, BACKLOG, { status: 'cancelled' })];
    expect(buildOccurrenceCards([series], cancelled, 'state', { now: NOW })).toEqual([series]);
    expect(buildOccurrenceCards([series], [], 'state', { now: NOW })).toEqual([series]);
  });

  it('files an occurrence with an empty or unknown state under the state of its ticket', () => {
    const events = [event(501, 7, 11, null), event(502, 7, 13, '999'), event(503, 7, 16, REVIEW)];
    const cards = buildOccurrenceCards([series], events, 'state', { now: NOW, knownStates: new Set([BACKLOG, REVIEW]) });
    expect(cards.map((card) => [card.id, occurrenceOf(card)?.count])).toEqual([['7@1', 2], ['7@4', 1]]);
  });

  it('ignores events of tickets that are not on the board', () => {
    expect(buildOccurrenceCards([single], [event(601, 7, 11, BACKLOG)], 'state', { now: NOW })).toEqual([single]);
  });
});

describe('pickOccurrencesToMove', () => {
  const events = [event(101, 7, 13, BACKLOG), event(102, 7, 11, BACKLOG), event(103, 7, 16, BACKLOG), event(104, 7, 9, REVIEW), event(201, 8, 12, BACKLOG)];
  const backlogCard = { ticketId: '7', eventIds: ['102', '101', '103'], count: 3, nextStart: at(11) };

  it('moves the earliest occurrence of the source column when nothing is marked', () => {
    expect(pickOccurrencesToMove(backlogCard, events, new Set(), REVIEW)).toEqual(['102']);
  });

  it('moves every marked occurrence of the ticket, whatever column the drag started from', () => {
    const marked = new Set(['101', '103', '104']);
    expect(pickOccurrencesToMove(backlogCard, events, marked, DONE).sort()).toEqual(['101', '103', '104']);
  });

  it('skips marked occurrences that already sit in the target column and marks of other tickets', () => {
    const marked = new Set(['101', '104', '201']);
    expect(pickOccurrencesToMove(backlogCard, events, marked, REVIEW)).toEqual(['101']);
  });
});

describe('helpers', () => {
  it('reads duration the way reconcile does: a positive number or nothing', () => {
    expect(ticketDurationMinutes({ duration: 90 })).toBe(90);
    expect(ticketDurationMinutes({ duration: '45' })).toBe(45);
    for (const duration of ['', ' ', 0, -5, 'abc', null, undefined, true]) {
      expect(ticketDurationMinutes({ duration })).toBeNull();
    }
  });

  it('formats duration in hours when it reads better', () => {
    const labels = { hours: (n: string) => `${n} ч`, minutes: (n: string) => `${n} мин` };
    expect(formatDuration(60, 'ru', labels)).toBe('1 ч');
    expect(formatDuration(90, 'ru', labels)).toBe('1,5 ч');
    expect(formatDuration(45, 'ru', labels)).toBe('45 мин');
    expect(formatDuration(100, 'ru', labels)).toBe('100 мин');
  });

  it('finds the reconcile-managed event of a one-off ticket and skips leftovers of a former series', () => {
    const byTicket = groupOccurrences([
      event(301, 9, 4, DONE), event(302, 9, 12, null), event(303, 9, 14, null, { original_start: null }),
      event(304, 9, 10, null, { status: 'cancelled' }),
    ]);
    expect(oneOffEvent(byTicket.get('9'))?.id).toBe(302);
    expect(oneOffEvent(undefined)).toBeUndefined();
  });
});
