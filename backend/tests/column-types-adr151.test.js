// ADR-151 Column Types — order (typed sort position) + actor (provenance)

process.env.TEST_MODE = 'true';
process.env.MASTER_ENCRYPTION_KEY = 'test_master_key_32_characters_long!';

import { describe, test, expect } from 'vitest';
import {
  validateColumnValue,
  VALID_COLUMN_TYPES,
  ACTOR_SOURCES,
} from '../services/ColumnService.js';

describe('ADR-151: type registration', () => {
  test('order and actor are valid column types', () => {
    expect(VALID_COLUMN_TYPES).toContain('order');
    expect(VALID_COLUMN_TYPES).toContain('actor');
  });

  test('actor source enum keeps ai distinct from api', () => {
    expect(ACTOR_SOURCES).toEqual(['manual', 'import', 'api', 'workflow', 'system', 'ai']);
  });
});

describe('ADR-151 Type: order (P0 integer, ascending)', () => {
  const column = { type: 'order' };

  test('accepts integers (incl. zero and negatives)', () => {
    expect(validateColumnValue(column, 0)).toBe(true);
    expect(validateColumnValue(column, 5)).toBe(true);
    expect(validateColumnValue(column, -3)).toBe(true);
    expect(validateColumnValue(column, '7')).toBe(true); // numeric string
  });

  test('allows empty/null (unset position)', () => {
    expect(validateColumnValue(column, null)).toBe(true);
    expect(validateColumnValue(column, undefined)).toBe(true);
    expect(validateColumnValue(column, '')).toBe(true);
  });

  test('rejects fractional in P0 (reserved for P1 fractional indexing)', () => {
    expect(validateColumnValue(column, 3.5)).toBe(false);
    expect(validateColumnValue(column, '2.25')).toBe(false);
  });

  test('rejects non-numeric', () => {
    expect(validateColumnValue(column, 'abc')).toBe(false);
    expect(validateColumnValue(column, NaN)).toBe(false);
  });
});

describe('ADR-151 Type: actor (composite provenance)', () => {
  const column = { type: 'actor' };

  test('accepts a full composite value', () => {
    expect(
      validateColumnValue(column, { source: 'manual', actor_ref: 1, at: '2026-06-03T10:00:00Z' })
    ).toBe(true);
  });

  test('accepts each known source', () => {
    for (const source of ACTOR_SOURCES) {
      expect(validateColumnValue(column, { source })).toBe(true);
    }
  });

  test('accepts string actor_ref (person slug) and null', () => {
    expect(validateColumnValue(column, { source: 'api', actor_ref: 'svc-bot' })).toBe(true);
    expect(validateColumnValue(column, { source: 'system', actor_ref: null })).toBe(true);
  });

  test('allows null cell (unset)', () => {
    expect(validateColumnValue(column, null)).toBe(true);
    expect(validateColumnValue(column, undefined)).toBe(true);
  });

  test('rejects unknown source', () => {
    expect(validateColumnValue(column, { source: 'robot' })).toBe(false);
    expect(validateColumnValue(column, { actor_ref: 1 })).toBe(false); // missing source
  });

  test('rejects non-object / array shapes', () => {
    expect(validateColumnValue(column, 'manual')).toBe(false);
    expect(validateColumnValue(column, ['manual'])).toBe(false);
    expect(validateColumnValue(column, 42)).toBe(false);
  });

  test('rejects malformed actor_ref / at', () => {
    expect(validateColumnValue(column, { source: 'manual', actor_ref: {} })).toBe(false);
    expect(validateColumnValue(column, { source: 'manual', at: 12345 })).toBe(false);
  });
});
