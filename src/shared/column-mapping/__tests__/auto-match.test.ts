// ADR-207 W3.1 — unit coverage for the shared mapping core:
// auto-match, manual reassignment, `__new`, null, projection.
import { describe, expect, it } from 'vitest';
import {
  NEW_COLUMN,
  applyColumnMappings,
  autoMatchColumns,
  countMappedColumns,
  findMatchingColumn,
  isExistingTarget,
  normalizeColumnName,
  setMappingTarget,
  setMappingType,
  type TargetColumnLike,
} from '@/shared/column-mapping';

const targets: TargetColumnLike[] = [
  { id: 'c1', name: 'name', displayName: 'Name', type: 'text' },
  { id: 'c2', name: 'created_at', displayName: 'Created At', type: 'datetime' },
  { id: 'c3', name: 'status', displayName: 'Статус', type: 'select' },
  { id: 'c4', name: 'qty', displayName: null, type: 'number' },
];

describe('normalizeColumnName', () => {
  it('ignores case, whitespace, underscores and hyphens', () => {
    expect(normalizeColumnName('Created At')).toBe('createdat');
    expect(normalizeColumnName('created_at')).toBe('createdat');
    expect(normalizeColumnName(' created-AT ')).toBe('createdat');
    expect(normalizeColumnName(null)).toBe('');
  });
});

describe('findMatchingColumn', () => {
  it('matches exact name case-insensitively (legacy CSV behaviour)', () => {
    expect(findMatchingColumn('NAME', targets)).toEqual({ column: targets[0], match: 'name' });
  });

  it('matches display name case-insensitively, including Cyrillic', () => {
    expect(findMatchingColumn('статус', targets)).toEqual({ column: targets[2], match: 'display_name' });
  });

  it('falls back to the normalized key for spaces/underscores', () => {
    expect(findMatchingColumn('Created at', targets)).toEqual({ column: targets[1], match: 'display_name' });
    expect(findMatchingColumn('CreatedAt', targets)).toEqual({ column: targets[1], match: 'normalized_name' });
    expect(findMatchingColumn('created-at', targets)).toEqual({ column: targets[1], match: 'normalized_name' });
  });

  it('returns null when nothing matches', () => {
    expect(findMatchingColumn('owner', targets)).toBeNull();
    expect(findMatchingColumn('   ', targets)).toBeNull();
  });
});

describe('autoMatchColumns', () => {
  const headers = ['Name', 'Created At', 'Total', 'Note'];
  const rows = [
    ['Alice', '2026-09-28', '10', 'a'],
    ['Bob', '2026-09-29', '2,5', 'b'],
  ];
  const sampleValues = (_h: string, i: number) => rows.map(r => r[i]);

  it('prefills matches with the target type and guesses the rest', () => {
    const mappings = autoMatchColumns(headers, targets, { sampleValues });
    expect(mappings).toEqual([
      { sourceColumn: 'Name', targetColumn: 'c1', type: 'text', match: 'name' },
      { sourceColumn: 'Created At', targetColumn: 'c2', type: 'datetime', match: 'display_name' },
      { sourceColumn: 'Total', targetColumn: null, type: 'number', match: null },
      { sourceColumn: 'Note', targetColumn: null, type: 'text', match: null },
    ]);
  });

  it('can default unmatched columns to __new (install screen)', () => {
    const mappings = autoMatchColumns(headers, targets, { sampleValues, unmatchedTarget: NEW_COLUMN });
    expect(mappings[2].targetColumn).toBe(NEW_COLUMN);
    expect(mappings[3].targetColumn).toBe(NEW_COLUMN);
    expect(mappings[0].targetColumn).toBe('c1');
  });
});

describe('manual reassignment', () => {
  const base = autoMatchColumns(['Name', 'Owner'], targets);

  it('setMappingTarget to an existing column locks the type to that column and clears match', () => {
    const next = setMappingTarget(base, 'Owner', 'c4', targets);
    expect(next[1]).toEqual({ sourceColumn: 'Owner', targetColumn: 'c4', type: 'number', match: null });
    expect(next[0]).toBe(base[0]);
  });

  it('setMappingTarget to __new keeps the guessed type', () => {
    const next = setMappingTarget(base, 'Owner', NEW_COLUMN, targets);
    expect(next[1].targetColumn).toBe(NEW_COLUMN);
    expect(next[1].type).toBe('text');
  });

  it('setMappingTarget to null skips the column', () => {
    const next = setMappingTarget(base, 'Name', null, targets);
    expect(next[0].targetColumn).toBeNull();
    expect(next[0].match).toBeNull();
    expect(countMappedColumns(next)).toBe(0);
  });

  it('setMappingType changes only the addressed row', () => {
    const next = setMappingType(base, 'Owner', 'email');
    expect(next[1].type).toBe('email');
    expect(next[0].type).toBe('text');
  });

  it('isExistingTarget distinguishes existing ids from __new and null', () => {
    expect(isExistingTarget('c1')).toBe(true);
    expect(isExistingTarget(NEW_COLUMN)).toBe(false);
    expect(isExistingTarget(null)).toBe(false);
  });
});

describe('applyColumnMappings', () => {
  const headers = ['Name', 'Qty', 'Done', 'Skip me', 'Extra'];
  const rows = [
    ['Alice', '1 000,5', 'да', 'x', 'e1'],
    ['Bob', 'n/a', 'no', 'y', ''],
    ['Cara', '3', 'yes', 'z', 'e3'],
    ['Dan', '4', 'yes', 'z', 'e4'],
    ['Eve', '5', 'yes', 'z', 'e5'],
    ['Finn', '6', 'yes', 'z', 'e6'],
  ];
  const mappings = [
    { sourceColumn: 'Name', targetColumn: 'c1', type: 'text' },
    { sourceColumn: 'Qty', targetColumn: 'c4', type: 'number' },
    { sourceColumn: 'Done', targetColumn: 'done', type: 'checkbox' },
    { sourceColumn: 'Skip me', targetColumn: null, type: 'text' },
    { sourceColumn: 'Extra', targetColumn: NEW_COLUMN, type: 'text' },
  ];

  it('converts values, drops skipped columns and keys __new by source name', () => {
    const out = applyColumnMappings(rows, headers, mappings);
    expect(out).toHaveLength(6);
    expect(out[0]).toEqual({ c1: 'Alice', c4: 1000.5, done: true, Extra: 'e1' });
    expect(out[1]).toEqual({ c1: 'Bob', c4: null, done: false, Extra: null });
    expect(out[0]).not.toHaveProperty('Skip me');
  });

  it('honours limit for the preview and a custom __new key', () => {
    const out = applyColumnMappings(rows, headers, mappings, { limit: 5, newColumnKey: m => m.sourceColumn.toLowerCase() });
    expect(out).toHaveLength(5);
    expect(out[0]).toHaveProperty('extra', 'e1');
  });

  it('ignores headers with no mapping entry', () => {
    const out = applyColumnMappings([['a', 'b']], ['Name', 'Unknown'], mappings.slice(0, 1));
    expect(out).toEqual([{ c1: 'a' }]);
  });
});
