// ADR-151 Slice A — typed `order` column type (Twenty-inspired)
//
// Registration + value validation for the new first-class `order` column type.
// Pure-function tests (no DB) — safe to run anywhere under ADR-0009 guard.
//
// Out of scope here (later slices):
//   - Slice A2: auto-sort-ascending wiring in the list API (hot read path)
//   - P1: fractional indexing ("insert between") for type='order' only
//   - frontend cell-render (@frontend)

process.env.TEST_MODE = 'true';
process.env.MASTER_ENCRYPTION_KEY = 'test_master_key_32_characters_long!';

import { describe, test, expect } from 'vitest';
import {
  validateColumnValue,
  VALID_COLUMN_TYPES,
  canonicalizeColumnType,
} from '../services/ColumnService.js';

describe('ADR-151: `order` column type registration', () => {
  test('`order` is a recognized column type', () => {
    expect(VALID_COLUMN_TYPES).toContain('order');
  });

  test('`order` is its own canonical type (not aliased away)', () => {
    expect(canonicalizeColumnType('order')).toBe('order');
  });
});

describe('ADR-151: `order` value validation', () => {
  const column = { type: 'order', config: {} };

  test('accepts integer order values (P0 round-trip)', () => {
    expect(validateColumnValue(column, 0)).toBe(true);
    expect(validateColumnValue(column, 42)).toBe(true);
    expect(validateColumnValue(column, -5)).toBe(true);
  });

  test('rejects fractional values in P0 (fractional indexing is reserved for P1)', () => {
    // ADR-151: P0 is integer-only. Fractional "insert between" support arrives
    // in P1, gated to type='order' only — never the legacy doc_* path.
    expect(validateColumnValue(column, 1.5)).toBe(false);
    expect(validateColumnValue(column, '2.25')).toBe(false);
  });

  test('accepts numeric strings (JSON cell coercion)', () => {
    expect(validateColumnValue(column, '7')).toBe(true);
  });

  test('treats null/undefined/empty as unset (valid)', () => {
    expect(validateColumnValue(column, null)).toBe(true);
    expect(validateColumnValue(column, undefined)).toBe(true);
    expect(validateColumnValue(column, '')).toBe(true);
  });

  test('rejects non-numeric and non-primitive values', () => {
    expect(validateColumnValue(column, 'abc')).toBe(false);
    expect(validateColumnValue(column, true)).toBe(false);
    expect(validateColumnValue(column, false)).toBe(false);
    expect(validateColumnValue(column, {})).toBe(false);
    expect(validateColumnValue(column, [1, 2])).toBe(false);
    expect(validateColumnValue(column, NaN)).toBe(false);
  });
});
