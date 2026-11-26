import { describe, it, expect } from 'vitest';
import { nextRun, validateCron, minIntervalMinutes, occurrencesBetween } from '../recurrence.js';

describe('scheduled-message recurrence', () => {
  it('validates five-field cron expressions', () => {
    expect(validateCron('*/15 * * * *')).toBe(true);
    expect(validateCron('*/15 * * * * *')).toBe(false);
    expect(validateCron('not a cron')).toBe(false);
  });

  it('computes the minimum interval and timezone-aware next run', () => {
    expect(minIntervalMinutes('*/15 * * * *', 'Europe/Moscow')).toBe(15);
    expect(nextRun('0 9 * * *', 'Europe/Moscow', new Date('2026-11-07T00:00:00Z'))?.toISOString())
      .toBe('2026-11-07T06:00:00.000Z');
  });

  it('handles a nonexistent Europe/Berlin wall-clock time using croner DST rules', () => {
    expect(nextRun('30 2 * * *', 'Europe/Berlin', new Date('2026-03-28T23:00:00Z'))?.toISOString())
      .toBe('2026-03-29T01:00:00.000Z');
  });

  it('enumerates the ADR-209 English course inclusively in Europe/Moscow', () => {
    const runs = occurrencesBetween(
      '0 18 * * 1,3,5',
      'Europe/Moscow',
      new Date('2026-10-31T21:00:00.000Z'),
      new Date('2026-12-25T20:59:59.999Z'),
      500,
    );

    expect(runs).toHaveLength(24);
    expect(runs[0].toISOString()).toBe('2026-11-02T15:00:00.000Z');
    expect(runs.at(-1).toISOString()).toBe('2026-12-25T15:00:00.000Z');
  });

  it('accepts HH:MM as a daily rule and includes both window boundaries', () => {
    const runs = occurrencesBetween(
      '18:00',
      'Europe/Moscow',
      new Date('2026-11-02T15:00:00.000Z'),
      new Date('2026-11-03T15:00:00.000Z'),
      500,
    );

    expect(runs.map((run) => run.toISOString())).toEqual([
      '2026-11-02T15:00:00.000Z',
      '2026-11-03T15:00:00.000Z',
    ]);
  });

  it('caps enumeration and returns no runs for invalid input', () => {
    const from = new Date('2026-11-01T00:00:00.000Z');
    const to = new Date('2026-11-01T00:10:00.000Z');
    expect(occurrencesBetween('* * * * *', 'UTC', from, to, 5)).toHaveLength(5);
    expect(occurrencesBetween('not a cron', 'UTC', from, to, 5)).toEqual([]);
  });
});
