import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTime } from '../ChatTurn/helpers';

describe('chat time range', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 11)); });
  afterEach(() => vi.useRealTimers());

  it('shows a compact numeric date once for the same day', () => {
    expect(formatTime(new Date(2026, 8, 10, 19, 10), new Date(2026, 8, 10, 19, 21)))
      .toBe('10.09 19:10 - 19:21');
  });
  it('hides the date for today and collapses the same minute', () => {
    expect(formatTime(new Date(2026, 8, 11, 19, 10), new Date(2026, 8, 11, 19, 10, 45)))
      .toBe('19:10');
  });
  it('shows only times for a range today', () => {
    expect(formatTime(new Date(2026, 8, 11, 10, 20), new Date(2026, 8, 11, 10, 29)))
      .toBe('10:20 - 10:29');
    expect(formatTime(new Date(2026, 8, 11, 10, 20))).toBe('10:20');
  });
  it('keeps the date only for the non-today endpoint across midnight', () => {
    expect(formatTime(new Date(2026, 8, 10, 23, 59), new Date(2026, 8, 11, 0, 1)))
      .toBe('10.09 23:59 - 00:01');
  });
  it('keeps the year for older messages', () => {
    expect(formatTime(new Date(2025, 8, 10, 19, 10))).toBe('10.09.2025 19:10');
  });
  it('handles missing or invalid dates', () => {
    expect(formatTime(undefined)).toBe('');
    expect(formatTime('invalid')).toBe('');
    expect(formatTime(new Date(2026, 8, 10, 19, 10), 'invalid')).toBe('10.09 19:10');
  });
});
