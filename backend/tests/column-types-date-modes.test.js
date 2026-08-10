// ADR-070: Date Modes — Backend Validation Tests

process.env.TEST_MODE = 'true';
process.env.MASTER_ENCRYPTION_KEY = 'test_master_key_32_characters_long!';

import { describe, test, expect } from 'vitest';
import { validateColumnValue } from '../services/ColumnService.js';

// ===================================================================
// Date mode
// ===================================================================
describe('Date mode validation', () => {
  const column = { type: 'datetime', config: { date: { mode: 'date' } } };

  test('should accept valid ISO date "2025-12-15"', () => {
    expect(validateColumnValue(column, '2025-12-15')).toBe(true);
  });

  test('should accept "2025-01-01"', () => {
    expect(validateColumnValue(column, '2025-01-01')).toBe(true);
  });

  test('should reject datetime value', () => {
    expect(validateColumnValue(column, '2025-12-15T14:30:00Z')).toBe(false);
  });

  test('should reject month value', () => {
    expect(validateColumnValue(column, '2025-12')).toBe(false);
  });

  test('should reject garbage', () => {
    expect(validateColumnValue(column, 'not-a-date')).toBe(false);
  });

  test('should accept date-like value with rollover (JS Date behavior)', () => {
    // Note: JS Date('2025-02-30') rolls over to March 2 — regex passes, Date is valid
    // Calendar validation is NOT done at DB level, only format is checked
    expect(validateColumnValue(column, '2025-02-30')).toBe(true);
  });
});

// ===================================================================
// Datetime mode
// ===================================================================
describe('Datetime mode validation', () => {
  const column = { type: 'datetime', config: { date: { mode: 'datetime' } } };

  test('should accept ISO datetime with T separator', () => {
    expect(validateColumnValue(column, '2025-12-15T14:30:00Z')).toBe(true);
  });

  test('should accept datetime with space separator', () => {
    expect(validateColumnValue(column, '2025-12-15 14:30')).toBe(true);
  });

  test('should accept Unix timestamp (10 digits)', () => {
    expect(validateColumnValue(column, '1734264600')).toBe(true);
  });

  test('should accept Unix timestamp (13 digits)', () => {
    expect(validateColumnValue(column, '1734264600000')).toBe(true);
  });

  test('should reject plain date without time', () => {
    expect(validateColumnValue(column, '2025-12-15')).toBe(false);
  });

  test('should reject garbage', () => {
    expect(validateColumnValue(column, 'not-a-date')).toBe(false);
  });
});

// ===================================================================
// Month mode
// ===================================================================
describe('Month mode validation', () => {
  const column = { type: 'datetime', config: { date: { mode: 'month' } } };

  test('should accept "2025-12"', () => {
    expect(validateColumnValue(column, '2025-12')).toBe(true);
  });

  test('should accept "2025-01"', () => {
    expect(validateColumnValue(column, '2025-01')).toBe(true);
  });

  test('should reject month "2025-13"', () => {
    expect(validateColumnValue(column, '2025-13')).toBe(false);
  });

  test('should reject month "2025-00"', () => {
    expect(validateColumnValue(column, '2025-00')).toBe(false);
  });

  test('should reject full date', () => {
    expect(validateColumnValue(column, '2025-12-15')).toBe(false);
  });

  test('should reject garbage', () => {
    expect(validateColumnValue(column, 'Dec 2025')).toBe(false);
  });
});

// ===================================================================
// Year mode
// ===================================================================
describe('Year mode validation', () => {
  const column = { type: 'datetime', config: { date: { mode: 'year' } } };

  test('should accept "2025"', () => {
    expect(validateColumnValue(column, '2025')).toBe(true);
  });

  test('should accept boundary "1900"', () => {
    expect(validateColumnValue(column, '1900')).toBe(true);
  });

  test('should accept boundary "2200"', () => {
    expect(validateColumnValue(column, '2200')).toBe(true);
  });

  test('should reject "1899" (below min)', () => {
    expect(validateColumnValue(column, '1899')).toBe(false);
  });

  test('should reject "2201" (above max)', () => {
    expect(validateColumnValue(column, '2201')).toBe(false);
  });

  test('should reject "20"', () => {
    expect(validateColumnValue(column, '20')).toBe(false);
  });

  test('should reject "20250"', () => {
    expect(validateColumnValue(column, '20250')).toBe(false);
  });
});

// ===================================================================
// Week mode
// ===================================================================
describe('Week mode validation', () => {
  const column = { type: 'datetime', config: { date: { mode: 'week' } } };

  test('should accept "2025-W50"', () => {
    expect(validateColumnValue(column, '2025-W50')).toBe(true);
  });

  test('should accept "2025-W01"', () => {
    expect(validateColumnValue(column, '2025-W01')).toBe(true);
  });

  test('should accept "2025-W53"', () => {
    expect(validateColumnValue(column, '2025-W53')).toBe(true);
  });

  test('should reject "2025-W00" (week 0)', () => {
    expect(validateColumnValue(column, '2025-W00')).toBe(false);
  });

  test('should reject "2025-W54" (week 54)', () => {
    expect(validateColumnValue(column, '2025-W54')).toBe(false);
  });

  test('should reject "2025-50" (missing W)', () => {
    expect(validateColumnValue(column, '2025-50')).toBe(false);
  });
});

// ===================================================================
// Quarter mode
// ===================================================================
describe('Quarter mode validation', () => {
  const column = { type: 'datetime', config: { date: { mode: 'quarter' } } };

  test('should accept "2025-Q1"', () => {
    expect(validateColumnValue(column, '2025-Q1')).toBe(true);
  });

  test('should accept "2025-Q4"', () => {
    expect(validateColumnValue(column, '2025-Q4')).toBe(true);
  });

  test('should reject "2025-Q0"', () => {
    expect(validateColumnValue(column, '2025-Q0')).toBe(false);
  });

  test('should reject "2025-Q5"', () => {
    expect(validateColumnValue(column, '2025-Q5')).toBe(false);
  });

  test('should reject "2025-1" (missing Q)', () => {
    expect(validateColumnValue(column, '2025-1')).toBe(false);
  });
});

// ===================================================================
// Fallback: no mode (backward compatibility)
// ===================================================================
describe('Date column without mode (backward compat)', () => {
  test('should fall through to old validateDate for date type', () => {
    const column = { type: 'date', config: {} };
    // Old validation only accepts YYYY-MM-DD
    expect(validateColumnValue(column, '2025-12-15')).toBe(true);
  });

  test('should fall through to old validateDatetime for datetime type', () => {
    const column = { type: 'datetime', config: {} };
    // Old validation only accepts YYYY-MM-DD HH:mm
    expect(validateColumnValue(column, '2025-12-15 14:30')).toBe(true);
  });
});

// ===================================================================
// Edge cases
// ===================================================================
describe('Date mode edge cases', () => {
  test('should reject numeric input for date mode', () => {
    const column = { type: 'datetime', config: { date: { mode: 'date' } } };
    expect(validateColumnValue(column, 12345)).toBe(false);
  });

  test('should accept numeric input for datetime mode (unix)', () => {
    const column = { type: 'datetime', config: { date: { mode: 'datetime' } } };
    expect(validateColumnValue(column, 1734264600)).toBe(true);
  });

  test('should handle null-ish values gracefully for all modes', () => {
    const modes = ['date', 'datetime', 'month', 'year', 'week', 'quarter'];
    for (const mode of modes) {
      const column = { type: 'datetime', config: { date: { mode } } };
      expect(validateColumnValue(column, null)).toBe(false);
      expect(validateColumnValue(column, undefined)).toBe(false);
      expect(validateColumnValue(column, '')).toBe(false);
    }
  });
});

// ===================================================================
// EU format (storageFormat: 'eu')
// ===================================================================
describe('Date mode with storageFormat EU', () => {
  const column = { type: 'datetime', config: { date: { mode: 'date', storageFormat: 'eu' } } };

  test('should accept valid EU date "15.12.2025"', () => {
    expect(validateColumnValue(column, '15.12.2025')).toBe(true);
  });

  test('should accept "1.1.2025" (single digits)', () => {
    expect(validateColumnValue(column, '1.1.2025')).toBe(true);
  });

  test('should reject ISO date in EU mode', () => {
    expect(validateColumnValue(column, '2025-12-15')).toBe(false);
  });

  test('should reject invalid day 30.02.2025', () => {
    expect(validateColumnValue(column, '30.02.2025')).toBe(false);
  });

  test('should reject invalid month 15.13.2025', () => {
    expect(validateColumnValue(column, '15.13.2025')).toBe(false);
  });

  test('should reject garbage', () => {
    expect(validateColumnValue(column, 'not-a-date')).toBe(false);
  });
});

describe('Datetime mode with storageFormat EU', () => {
  const column = { type: 'datetime', config: { date: { mode: 'datetime', storageFormat: 'eu' } } };

  test('should accept "15.12.2025 14:30"', () => {
    expect(validateColumnValue(column, '15.12.2025 14:30')).toBe(true);
  });

  test('should accept "15.12.2025 14:30:45"', () => {
    expect(validateColumnValue(column, '15.12.2025 14:30:45')).toBe(true);
  });

  test('should reject ISO datetime in EU mode', () => {
    expect(validateColumnValue(column, '2025-12-15T14:30:00Z')).toBe(false);
  });

  test('should reject EU date without time', () => {
    expect(validateColumnValue(column, '15.12.2025')).toBe(false);
  });
});

// ===================================================================
// US format (storageFormat: 'us')
// ===================================================================
describe('Date mode with storageFormat US', () => {
  const column = { type: 'datetime', config: { date: { mode: 'date', storageFormat: 'us' } } };

  test('should accept valid US date "12/15/2025"', () => {
    expect(validateColumnValue(column, '12/15/2025')).toBe(true);
  });

  test('should accept "1/1/2025" (single digits)', () => {
    expect(validateColumnValue(column, '1/1/2025')).toBe(true);
  });

  test('should reject ISO date in US mode', () => {
    expect(validateColumnValue(column, '2025-12-15')).toBe(false);
  });

  test('should reject invalid day 02/30/2025', () => {
    expect(validateColumnValue(column, '02/30/2025')).toBe(false);
  });

  test('should reject invalid month 13/15/2025', () => {
    expect(validateColumnValue(column, '13/15/2025')).toBe(false);
  });

  test('should reject garbage', () => {
    expect(validateColumnValue(column, 'not-a-date')).toBe(false);
  });
});

describe('Datetime mode with storageFormat US', () => {
  const column = { type: 'datetime', config: { date: { mode: 'datetime', storageFormat: 'us' } } };

  test('should accept "12/15/2025 14:30"', () => {
    expect(validateColumnValue(column, '12/15/2025 14:30')).toBe(true);
  });

  test('should accept "12/15/2025 14:30:45"', () => {
    expect(validateColumnValue(column, '12/15/2025 14:30:45')).toBe(true);
  });

  test('should reject ISO datetime in US mode', () => {
    expect(validateColumnValue(column, '2025-12-15T14:30:00Z')).toBe(false);
  });

  test('should reject US date without time', () => {
    expect(validateColumnValue(column, '12/15/2025')).toBe(false);
  });
});
