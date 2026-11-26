// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveSchedule, ScheduledMessageError } from '../operations.js';

const NOW = new Date('2026-11-07T12:00:00.000Z');

function resolve(input, senderType = 'human', current = null) {
  return resolveSchedule(input, { senderType, current, now: NOW });
}

describe('ADR-208 D6 — schedule validation', () => {
  it.each([
    ['human', '*/5 * * * *', true],
    ['human', '*/4 * * * *', false],
    ['agent', '*/15 * * * *', true],
    ['agent', '*/5 * * * *', false],
  ])('%s recurrence %s accepted=%s', (senderType, recurrence_cron, accepted) => {
    const input = { content: 'report', recurrence_cron };
    if (accepted) {
      const result = resolve(input, senderType);
      expect(new Date(result.scheduledAt).getTime()).toBeGreaterThan(NOW.getTime());
      expect(result.timezone).toBe('Europe/Moscow');
    } else {
      expect(() => resolve(input, senderType)).toThrowError(expect.objectContaining({
        code: 'RECURRENCE_TOO_FREQUENT',
      }));
    }
  });

  it('requires content and a date for a one-time message', () => {
    expect(() => resolve({ scheduled_at: '2026-11-07T13:00:00Z' })).toThrow(ScheduledMessageError);
    expect(() => resolve({ content: 'once' })).toThrow(/scheduled_at/);
  });

  it('rejects an invalid IANA timezone', () => {
    expect(() => resolve({ content: 'report', recurrence_cron: '0 9 * * *', timezone: 'Moscow' }))
      .toThrow(/timezone/i);
  });

  it.each([0, -1, 1.5, '2'])('rejects invalid max_runs=%s', max_runs => {
    expect(() => resolve({ content: 'report', recurrence_cron: '0 9 * * *', max_runs }))
      .toThrow(/max_runs/);
  });

  it('rejects max_runs without recurrence', () => {
    expect(() => resolve({ content: 'once', scheduled_at: '2026-11-07T13:00:00Z', max_runs: 2 }))
      .toThrow(/recurrence_cron/);
  });

  it('recalculates the next run when cron or timezone changes during edit', () => {
    const current = {
      content: 'report', recurrence_cron: '0 9 * * *', timezone: 'Europe/Moscow',
      max_runs: null, scheduled_at: '2026-11-08T06:00:00.000Z',
    };
    const result = resolve({ recurrence_cron: '*/30 * * * *' }, 'human', current);
    expect(result.scheduledAt).toBe('2026-11-07T12:30:00.000Z');
  });

  it('preserves an explicit first run when only scheduled_at changes', () => {
    const current = {
      content: 'report', recurrence_cron: '0 9 * * *', timezone: 'Europe/Moscow',
      max_runs: null, scheduled_at: '2026-11-08T06:00:00.000Z',
    };
    const result = resolve({ scheduled_at: '2026-11-07T13:15:00Z' }, 'human', current);
    expect(result.scheduledAt).toBe('2026-11-07T13:15:00.000Z');
  });

  it('preserves an explicitly supplied first run on create', () => {
    const result = resolve({
      content: 'report', recurrence_cron: '0 9 * * *', scheduled_at: '2026-11-07T13:15:00Z',
    });
    expect(result.scheduledAt).toBe('2026-11-07T13:15:00.000Z');
  });

  it('accepts null max_runs for an infinite series', () => {
    const result = resolve({ content: 'report', recurrence_cron: '0 9 * * *', max_runs: null });
    expect(result.maxRuns).toBeNull();
  });
});
