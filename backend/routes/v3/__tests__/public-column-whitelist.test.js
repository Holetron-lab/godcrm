/**
 * ADR-0060 P5d AC14 — Row-level column whitelist (AC3 projection).
 *
 * `/api/v3/public/s/:slug/widgets/:id/data` and `/tables/:id/rows` project
 * each row's data through the `isColumnPublic(col)` filter so that columns
 * with `config.is_public === false` never reach the public viewer.
 *
 * The route-level integration is exercised by the live DEV smoke (curl).
 * This file pins down the gate function itself: it is the only thing that
 * stands between an owner-flipped is_public=false and an actual leak.
 */
import { describe, test, expect } from 'vitest';
import { isColumnPublic, parseColumnConfig } from '../public.js';

describe('isColumnPublic — opt-out gate', () => {
  test('defaults to public when no config / no is_public key', () => {
    expect(isColumnPublic({ id: 1, config: null })).toBe(true);
    expect(isColumnPublic({ id: 1, config: undefined })).toBe(true);
    expect(isColumnPublic({ id: 1 })).toBe(true);
    expect(isColumnPublic({ id: 1, config: '{}' })).toBe(true);
    expect(isColumnPublic({ id: 1, config: JSON.stringify({}) })).toBe(true);
  });

  test('respects explicit is_public=true', () => {
    expect(isColumnPublic({ id: 1, config: JSON.stringify({ is_public: true }) })).toBe(true);
    // Sibling fields must not change the outcome.
    expect(
      isColumnPublic({
        id: 1,
        config: JSON.stringify({ is_public: true, options: ['a', 'b'] }),
      }),
    ).toBe(true);
  });

  test('explicit is_public=false strips the column', () => {
    expect(
      isColumnPublic({ id: 1, config: JSON.stringify({ is_public: false }) }),
    ).toBe(false);
  });

  test('string "false" also strips the column (legacy string serialization)', () => {
    expect(
      isColumnPublic({ id: 1, config: JSON.stringify({ is_public: 'false' }) }),
    ).toBe(false);
  });

  test('truthy strings ("true", "1") do NOT strip — only literal false / "false"', () => {
    // Defensive: any other value defaults to "visible" to avoid accidentally
    // hiding columns when owners flipped a non-boolean.
    expect(isColumnPublic({ id: 1, config: JSON.stringify({ is_public: 'true' }) })).toBe(true);
    expect(isColumnPublic({ id: 1, config: JSON.stringify({ is_public: 1 }) })).toBe(true);
    expect(isColumnPublic({ id: 1, config: JSON.stringify({ is_public: 0 }) })).toBe(true);
    expect(isColumnPublic({ id: 1, config: JSON.stringify({ is_public: null }) })).toBe(true);
  });

  test('accepts an already-parsed config object (DB sometimes returns parsed)', () => {
    expect(isColumnPublic({ id: 1, config: { is_public: false } })).toBe(false);
    expect(isColumnPublic({ id: 1, config: { is_public: true } })).toBe(true);
    expect(isColumnPublic({ id: 1, config: {} })).toBe(true);
  });

  test('garbage config string falls back to public (parser returns {})', () => {
    expect(isColumnPublic({ id: 1, config: 'not-json' })).toBe(true);
    expect(isColumnPublic({ id: 1, config: '[1,2]' })).toBe(true);
  });
});

describe('parseColumnConfig — safety contract', () => {
  test('returns {} for null/undefined/empty col', () => {
    expect(parseColumnConfig(null)).toEqual({});
    expect(parseColumnConfig(undefined)).toEqual({});
    expect(parseColumnConfig({})).toEqual({});
    expect(parseColumnConfig({ config: null })).toEqual({});
  });

  test('parses a JSON string', () => {
    expect(parseColumnConfig({ config: '{"a":1}' })).toEqual({ a: 1 });
  });

  test('passes through an object as-is', () => {
    expect(parseColumnConfig({ config: { a: 2 } })).toEqual({ a: 2 });
  });

  test('returns {} on parse failure', () => {
    expect(parseColumnConfig({ config: '{broken' })).toEqual({});
  });
});

describe('row-level column projection — invariant', () => {
  // Simulates what fetchPublicRows() does internally: project each row through
  // the filtered column set. This locks in the contract that drives AC14.
  function projectRow(rowData, columns) {
    const publicCols = columns.filter(isColumnPublic);
    const out = {};
    for (const col of publicCols) {
      out[col.column_name] = rowData[col.column_name] ?? null;
    }
    return out;
  }

  test('strips is_public=false columns from row data', () => {
    const columns = [
      { id: 1, column_name: 'name', config: JSON.stringify({ is_public: true }) },
      { id: 2, column_name: 'email', config: JSON.stringify({ is_public: false }) },
      { id: 3, column_name: 'public_id', config: JSON.stringify({}) },
    ];
    const projected = projectRow(
      { name: 'Alice', email: 'secret@x.io', public_id: 'P-1' },
      columns,
    );
    expect(projected).toEqual({ name: 'Alice', public_id: 'P-1' });
    expect(projected.email).toBeUndefined();
  });

  test('an all-false column set yields an empty projection (no leak)', () => {
    const columns = [
      { id: 1, column_name: 'a', config: JSON.stringify({ is_public: false }) },
      { id: 2, column_name: 'b', config: JSON.stringify({ is_public: 'false' }) },
    ];
    expect(projectRow({ a: 1, b: 2 }, columns)).toEqual({});
  });

  test('an all-public column set yields a full projection', () => {
    const columns = [
      { id: 1, column_name: 'a', config: JSON.stringify({ is_public: true }) },
      { id: 2, column_name: 'b', config: JSON.stringify({}) },
    ];
    expect(projectRow({ a: 1, b: 2 }, columns)).toEqual({ a: 1, b: 2 });
  });
});
