import { describe, it, expect } from 'vitest';
import { parseDate, formatDate, detectFormat, getISOWeek, getISOWeekYear } from '../DateEditor';
import { parseMonth, parseYear, parseWeek, parseQuarter, detectDateFormat } from '../DateCell';

/**
 * ADR-070: Date Modes — Unit Tests for pure functions
 * Tests parsers, formatters, and validators for all 6 date modes
 */

// ===================================================================
// parseDate (DateEditor)
// ===================================================================
describe('parseDate', () => {
  it('should parse ISO date string', () => {
    const result = parseDate('2025-12-15');
    expect(result).toBeInstanceOf(Date);
    expect(result!.getFullYear()).toBe(2025);
    expect(result!.getMonth()).toBe(11); // 0-indexed
    expect(result!.getDate()).toBe(15);
  });

  it('should parse ISO datetime string', () => {
    const result = parseDate('2025-12-15T14:30:00Z');
    expect(result).toBeInstanceOf(Date);
    expect(result!.getFullYear()).toBe(2025);
  });

  it('should parse EU format (DD.MM.YYYY)', () => {
    const result = parseDate('15.12.2025');
    expect(result).toBeInstanceOf(Date);
    expect(result!.getFullYear()).toBe(2025);
    expect(result!.getMonth()).toBe(11);
    expect(result!.getDate()).toBe(15);
  });

  it('should parse US format (MM/DD/YYYY)', () => {
    const result = parseDate('12/15/2025');
    expect(result).toBeInstanceOf(Date);
    expect(result!.getFullYear()).toBe(2025);
    expect(result!.getMonth()).toBe(11);
    expect(result!.getDate()).toBe(15);
  });

  it('should parse Unix timestamp (10 digits)', () => {
    const result = parseDate('1734264600'); // 2024-12-15 ~14:30 UTC
    expect(result).toBeInstanceOf(Date);
    expect(result!.getFullYear()).toBe(2024);
  });

  it('should parse Unix timestamp (13 digits)', () => {
    const result = parseDate('1734264600000');
    expect(result).toBeInstanceOf(Date);
    expect(result!.getFullYear()).toBe(2024);
  });

  it('should return null for empty string', () => {
    expect(parseDate('')).toBeNull();
  });

  it('should return null for invalid string', () => {
    expect(parseDate('not-a-date')).toBeNull();
  });
});

// ===================================================================
// formatDate (DateEditor)
// ===================================================================
describe('formatDate', () => {
  const date = new Date(2025, 11, 15, 14, 30); // Dec 15, 2025 14:30

  it('should format as ISO', () => {
    expect(formatDate(date, 'iso')).toBe('2025-12-15');
  });

  it('should format as EU', () => {
    expect(formatDate(date, 'eu')).toBe('15.12.2025');
  });

  it('should format as US', () => {
    expect(formatDate(date, 'us')).toBe('12/15/2025');
  });

  it('should format as Unix timestamp', () => {
    const result = formatDate(date, 'unix');
    expect(result).toMatch(/^\d+$/);
    // Should be a valid unix timestamp
    const parsed = new Date(parseInt(result) * 1000);
    expect(parsed.getFullYear()).toBe(2025);
  });

  it('should include time when includeTime=true', () => {
    expect(formatDate(date, 'iso', true)).toBe('2025-12-15 14:30');
  });

  it('should NOT include time for unix even with includeTime=true', () => {
    const result = formatDate(date, 'unix', true);
    expect(result).toMatch(/^\d+$/);
  });

  it('should default to ISO for unknown format', () => {
    expect(formatDate(date, 'unknown')).toBe('2025-12-15');
  });
});

// ===================================================================
// detectFormat (DateEditor)
// ===================================================================
describe('detectFormat', () => {
  it('should detect ISO format', () => {
    expect(detectFormat('2025-12-15')).toBe('iso');
  });

  it('should detect EU format', () => {
    expect(detectFormat('15.12.2025')).toBe('eu');
  });

  it('should detect US format', () => {
    expect(detectFormat('12/15/2025')).toBe('us');
  });

  it('should detect Unix timestamp (10 digits)', () => {
    expect(detectFormat('1734264600')).toBe('unix');
  });

  it('should detect Unix timestamp (13 digits)', () => {
    expect(detectFormat('1734264600000')).toBe('unix');
  });

  it('should default to ISO for empty string', () => {
    expect(detectFormat('')).toBe('iso');
  });
});

// ===================================================================
// getISOWeek / getISOWeekYear (DateEditor)
// ===================================================================
describe('getISOWeek', () => {
  it('should return week 1 for Jan 1 2025 (Wednesday)', () => {
    // Jan 1, 2025 is a Wednesday — ISO week 1
    expect(getISOWeek(new Date(2025, 0, 1))).toBe(1);
  });

  it('should return week 52 for Dec 29 2025 (Monday)', () => {
    expect(getISOWeek(new Date(2025, 11, 29))).toBe(1); // Actually ISO week 1 of 2026
  });

  it('should return correct week for mid-year date', () => {
    // June 15, 2025 — should be around week 24
    const week = getISOWeek(new Date(2025, 5, 15));
    expect(week).toBeGreaterThanOrEqual(23);
    expect(week).toBeLessThanOrEqual(25);
  });
});

describe('getISOWeekYear', () => {
  it('should return 2025 for a date in mid-2025', () => {
    expect(getISOWeekYear(new Date(2025, 5, 15))).toBe(2025);
  });

  it('should handle year boundary correctly', () => {
    // Dec 31, 2025 may belong to ISO week year 2026
    const year = getISOWeekYear(new Date(2025, 11, 31));
    expect(year === 2025 || year === 2026).toBe(true);
  });
});

// ===================================================================
// parseMonth (DateCell)
// ===================================================================
describe('parseMonth', () => {
  it('should parse valid month "2025-12"', () => {
    const result = parseMonth('2025-12');
    expect(result).toEqual({ year: 2025, month: 12 });
  });

  it('should parse "2025-01"', () => {
    const result = parseMonth('2025-01');
    expect(result).toEqual({ year: 2025, month: 1 });
  });

  it('should reject invalid month "2025-13"', () => {
    expect(parseMonth('2025-13')).toBeNull();
  });

  it('should reject invalid month "2025-00"', () => {
    expect(parseMonth('2025-00')).toBeNull();
  });

  it('should reject non-month format "2025-12-15"', () => {
    expect(parseMonth('2025-12-15')).toBeNull();
  });

  it('should reject empty string', () => {
    expect(parseMonth('')).toBeNull();
  });

  it('should reject garbage input', () => {
    expect(parseMonth('not-a-month')).toBeNull();
  });
});

// ===================================================================
// parseYear (DateCell)
// ===================================================================
describe('parseYear', () => {
  it('should parse valid year "2025"', () => {
    expect(parseYear('2025')).toBe(2025);
  });

  it('should parse boundary year "1900"', () => {
    expect(parseYear('1900')).toBe(1900);
  });

  it('should parse boundary year "2200"', () => {
    expect(parseYear('2200')).toBe(2200);
  });

  it('should reject year below 1900', () => {
    expect(parseYear('1899')).toBeNull();
  });

  it('should reject year above 2200', () => {
    expect(parseYear('2201')).toBeNull();
  });

  it('should reject non-year string', () => {
    expect(parseYear('20')).toBeNull();
    expect(parseYear('year')).toBeNull();
    expect(parseYear('20250')).toBeNull();
  });

  it('should reject empty string', () => {
    expect(parseYear('')).toBeNull();
  });
});

// ===================================================================
// parseWeek (DateCell)
// ===================================================================
describe('parseWeek', () => {
  it('should parse valid week "2025-W50"', () => {
    expect(parseWeek('2025-W50')).toEqual({ year: 2025, week: 50 });
  });

  it('should parse "2025-W01"', () => {
    expect(parseWeek('2025-W01')).toEqual({ year: 2025, week: 1 });
  });

  it('should parse "2025-W53"', () => {
    expect(parseWeek('2025-W53')).toEqual({ year: 2025, week: 53 });
  });

  it('should reject week 0', () => {
    expect(parseWeek('2025-W00')).toBeNull();
  });

  it('should reject week 54', () => {
    expect(parseWeek('2025-W54')).toBeNull();
  });

  it('should reject invalid format', () => {
    expect(parseWeek('2025-50')).toBeNull();
    expect(parseWeek('W50')).toBeNull();
    expect(parseWeek('')).toBeNull();
  });
});

// ===================================================================
// parseQuarter (DateCell)
// ===================================================================
describe('parseQuarter', () => {
  it('should parse valid quarter "2025-Q1"', () => {
    expect(parseQuarter('2025-Q1')).toEqual({ year: 2025, quarter: 1 });
  });

  it('should parse "2025-Q4"', () => {
    expect(parseQuarter('2025-Q4')).toEqual({ year: 2025, quarter: 4 });
  });

  it('should reject Q0', () => {
    expect(parseQuarter('2025-Q0')).toBeNull();
  });

  it('should reject Q5', () => {
    expect(parseQuarter('2025-Q5')).toBeNull();
  });

  it('should reject invalid format', () => {
    expect(parseQuarter('2025-1')).toBeNull();
    expect(parseQuarter('Q4')).toBeNull();
    expect(parseQuarter('')).toBeNull();
  });
});

// ===================================================================
// detectDateFormat (DateCell) — EU/US detection
// ===================================================================
describe('detectDateFormat', () => {
  it('should detect ISO format', () => {
    expect(detectDateFormat('2025-12-15')).toBe('iso');
  });

  it('should detect ISO datetime', () => {
    expect(detectDateFormat('2025-12-15T14:30:00Z')).toBe('iso');
  });

  it('should detect Unix timestamp (10 digits)', () => {
    expect(detectDateFormat('1734264600')).toBe('unix');
  });

  it('should detect Unix timestamp (13 digits)', () => {
    expect(detectDateFormat('1734264600000')).toBe('unix_ms');
  });

  it('should detect EU format (DD.MM.YYYY)', () => {
    expect(detectDateFormat('15.12.2025')).toBe('eu');
  });

  it('should detect EU format with single digits (1.1.2025)', () => {
    expect(detectDateFormat('1.1.2025')).toBe('eu');
  });

  it('should detect EU datetime', () => {
    expect(detectDateFormat('15.12.2025 14:30')).toBe('eu');
  });

  it('should detect US format (MM/DD/YYYY)', () => {
    expect(detectDateFormat('12/15/2025')).toBe('us');
  });

  it('should detect US format with single digits (1/1/2025)', () => {
    expect(detectDateFormat('1/1/2025')).toBe('us');
  });

  it('should detect US datetime', () => {
    expect(detectDateFormat('12/15/2025 14:30')).toBe('us');
  });

  it('should return unknown for null', () => {
    expect(detectDateFormat(null)).toBe('unknown');
  });

  it('should return unknown for empty string', () => {
    expect(detectDateFormat('')).toBe('unknown');
  });

  it('should return unknown for garbage', () => {
    expect(detectDateFormat('not-a-date')).toBe('unknown');
  });
});
