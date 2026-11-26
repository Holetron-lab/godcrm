// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { nextRun } from '../../../services/scheduled-messages/recurrence.js';

describe('ADR-208 WP-4 — Europe/Berlin DST', () => {
  it('advances across the nonexistent spring-forward wall-clock time', () => {
    const result = nextRun('30 2 * * *', 'Europe/Berlin', new Date('2026-03-28T23:00:00.000Z'));
    expect(result?.toISOString()).toBe('2026-03-29T01:00:00.000Z');
  });
});
