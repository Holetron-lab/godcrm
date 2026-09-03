/**
 * ADR-0041R Phase 2 — the column-type enum has a single owner.
 *
 * Pure unit tests: manifest → owner module → DB constraint, no DB connection.
 */
import { describe, it, expect } from 'vitest';
import {
  COLUMN_TYPES,
  COLUMN_TYPE_ALIASES,
  PROVISIONAL_COLUMN_TYPES,
  VALID_COLUMN_TYPES,
  canonicalizeColumnType,
  persistColumnType,
} from '../services/ColumnService.js';
import { RATCHET_TYPES } from '../database/migrations/knex/088_adr_0041r_p1_type_ratchet.js';
import { ALL_PERSISTABLE_COLUMN_TYPES } from '../../shared/column-types.js';

describe('ADR-0041R: canonicalizeColumnType', () => {
  it('maps textarea and markdown to long_text, not text', () => {
    // The single highest-consequence line in the ADR: 1 751 columns across
    // 1 485 tables. `text` is single-line — mapping there is a render downgrade.
    expect(canonicalizeColumnType('textarea')).toBe('long_text');
    expect(canonicalizeColumnType('markdown')).toBe('long_text');
  });

  it('keeps every ADR-0041 P0 mapping', () => {
    expect(canonicalizeColumnType('boolean')).toBe('checkbox');
    expect(canonicalizeColumnType('multi_select')).toBe('multi-select');
    expect(canonicalizeColumnType('multiselect')).toBe('multi-select');
    expect(canonicalizeColumnType('longtext')).toBe('long_text');
    expect(canonicalizeColumnType('richText')).toBe('long_text');
    expect(canonicalizeColumnType('rich_text')).toBe('long_text');
  });

  it('maps person to user — user has 296 rows in production, person has 0', () => {
    expect(canonicalizeColumnType('person')).toBe('user');
    expect(COLUMN_TYPES).toContain('user');
    expect(COLUMN_TYPES).not.toContain('person');
  });

  it('returns unknown types unchanged — it normalizes, it does not gate', () => {
    expect(canonicalizeColumnType('text')).toBe('text');
    expect(canonicalizeColumnType('who_knows')).toBe('who_knows');
  });

  it('does not resolve Object.prototype keys (input comes from an LLM)', () => {
    expect(canonicalizeColumnType('constructor')).toBe('constructor');
    expect(canonicalizeColumnType('toString')).toBe('toString');
  });
});

describe('ADR-0041R: persistColumnType', () => {
  it('emits the canonical spelling for every alias', () => {
    for (const [alias, canonical] of Object.entries(COLUMN_TYPE_ALIASES)) {
      expect(persistColumnType(alias)).toBe(canonical);
    }
  });

  it('passes canonical types through untouched', () => {
    for (const type of COLUMN_TYPES) {
      expect(persistColumnType(type)).toBe(type);
    }
  });

  it('admits Tier D provisional types so live writers do not break', () => {
    // backend/routes/v3/api-keys.js emits `link` today.
    for (const type of PROVISIONAL_COLUMN_TYPES) {
      expect(persistColumnType(type)).toBe(type);
    }
  });

  it('rejects anything else — this is what stops the drift', () => {
    expect(() => persistColumnType('richtext')).toThrow(/Unknown column type/);
    expect(() => persistColumnType('rating')).toThrow(/Unknown column type/);
    expect(() => persistColumnType('')).toThrow(/Unknown column type/);
    expect(() => persistColumnType(undefined)).toThrow(/Unknown column type/);
  });
});

describe('ADR-0041R: VALID_COLUMN_TYPES', () => {
  it('admits json and color — creating either returned 400 before this ADR', () => {
    // 360 `json` and 19 `color` columns exist in production and in the
    // frontend union, but were absent from the backend enum.
    expect(VALID_COLUMN_TYPES).toContain('json');
    expect(VALID_COLUMN_TYPES).toContain('color');
    expect(VALID_COLUMN_TYPES).toContain('time');
    expect(VALID_COLUMN_TYPES).toContain('audio');
  });

  it('keeps the ADR-151 types', () => {
    expect(COLUMN_TYPES).toContain('order');
    expect(COLUMN_TYPES).toContain('actor');
  });

  it('is derived, not hand-typed', () => {
    expect(VALID_COLUMN_TYPES).toEqual([
      ...COLUMN_TYPES,
      ...PROVISIONAL_COLUMN_TYPES,
      ...Object.keys(COLUMN_TYPE_ALIASES),
    ]);
  });

  it('contains no duplicates', () => {
    expect(new Set(VALID_COLUMN_TYPES).size).toBe(VALID_COLUMN_TYPES.length);
  });
});

describe('ADR-0041R: manifest, owner module and DB ratchet agree', () => {
  it('the owner module admits exactly what the manifest declares', () => {
    expect([...VALID_COLUMN_TYPES].sort()).toEqual(
      [...ALL_PERSISTABLE_COLUMN_TYPES].sort()
    );
  });

  it('the DB constraint admits exactly the same alphabet', () => {
    // If this fails, someone widened one layer without the other: either a new
    // type can be created by the API and rejected by the DB (500 on INSERT), or
    // the constraint admits a spelling the application will never emit.
    // Migration 088 keeps its own literal copy on purpose — an applied
    // migration must not change meaning when the manifest is later edited.
    // This test is what keeps the two honest.
    expect([...VALID_COLUMN_TYPES].sort()).toEqual([...RATCHET_TYPES].sort());
  });
});
