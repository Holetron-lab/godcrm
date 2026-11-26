import { describe, expect, it } from 'vitest';
import type { OccurrenceEvent } from './_shared/ticket-events';
import { calendarOccurrences } from './calendar-occurrences';

/** ADR-209 D7 — what the calendar draws from the events table. */

const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();
const event = (id: number, ticketId: number, day: number, extra: Record<string, unknown> = {}): OccurrenceEvent => ({
  id,
  data: {
    ticket_id: ticketId, state: 1, status: 'confirmed',
    original_start: local(day, 18), start_datetime: local(day, 18), end_datetime: local(day, 19), ...extra,
  },
});

const series = { id: 7, data: { what: 'Английский', state: 1, repeat: '0 18 * * 1,3,5' } };
const oneOff = { id: 8, data: { what: 'Созвон', state: 4, scheduled_date: local(12, 15), duration: 60 } };

describe('calendarOccurrences', () => {
  it('draws every live occurrence of a series instead of the ticket', () => {
    const result = calendarOccurrences([series], [event(1, 7, 4), event(2, 7, 2), event(3, 7, 6, { state: 7 })], 'state');

    expect(result.get('7')).toEqual({
      replacesTicket: true,
      entries: [
        { eventId: '2', day: '2026-11-02', time: '18:00–19:00', state: '1' },
        { eventId: '1', day: '2026-11-04', time: '18:00–19:00', state: '1' },
        { eventId: '3', day: '2026-11-06', time: '18:00–19:00', state: '7' },
      ],
    });
  });

  it('skips cancelled occurrences', () => {
    const result = calendarOccurrences([series], [event(1, 7, 2), event(2, 7, 4, { status: 'cancelled' })], 'state');

    expect(result.get('7')?.entries.map((entry) => entry.eventId)).toEqual(['1']);
  });

  it('leaves a series whose occurrences are all cancelled to the ticket', () => {
    expect(calendarOccurrences([series], [event(1, 7, 2, { status: 'cancelled' })], 'state').has('7')).toBe(false);
  });

  it('gives a one-off ticket its single event, coloured by the ticket status', () => {
    const single = event(5, 8, 12, { state: null, original_start: local(12, 15), start_datetime: local(12, 15), end_datetime: local(12, 16) });

    expect(calendarOccurrences([oneOff], [single], 'state').get('8')).toEqual({
      replacesTicket: false,
      entries: [{ eventId: '5', day: '2026-11-12', time: '15:00–16:00', state: '4' }],
    });
  });

  it('ignores occurrences a former series left on a ticket without repeat', () => {
    expect(calendarOccurrences([oneOff], [event(1, 8, 2), event(2, 8, 4, { state: 7 })], 'state').has('8')).toBe(false);
  });

  it('leaves tickets without events and events without a ticket out', () => {
    expect(calendarOccurrences([series, oneOff], [event(1, 999, 2)], 'state').size).toBe(0);
  });

  it('shows only the start when the event has no end, and no time for an all-day event', () => {
    const result = calendarOccurrences(
      [series],
      [event(1, 7, 2, { end_datetime: null }), event(2, 7, 4, { is_all_day: true })],
      'state',
    );

    expect(result.get('7')?.entries.map((entry) => entry.time)).toEqual(['18:00', '']);
  });

  it('drops an occurrence without a readable start', () => {
    expect(calendarOccurrences([series], [event(1, 7, 2, { start_datetime: 'soon' })], 'state').has('7')).toBe(false);
  });
});
