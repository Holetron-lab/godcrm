import { describe, it, expect } from 'vitest';
import { mergeWidgetConfig, getLockedPaths, isFieldLocked } from '../mergeWidgetConfig';

describe('mergeWidgetConfig (ADR-0012 Phase 8.5)', () => {
  it('returns base config when override is null/undefined', () => {
    expect(mergeWidgetConfig({ a: 1 }, null)).toEqual({ a: 1 });
    expect(mergeWidgetConfig({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  it('returns {} when widget config is missing', () => {
    expect(mergeWidgetConfig(null, { a: 1 })).toEqual({ a: 1 });
    expect(mergeWidgetConfig(undefined, null)).toEqual({});
  });

  it('deep-merges plain objects', () => {
    const base = { table_id: 1708, view: { columns: ['a', 'b'], dense: true } };
    const ovr = { view: { dense: false, header: 'Tickets' } };
    expect(mergeWidgetConfig(base, ovr)).toEqual({
      table_id: 1708,
      view: { columns: ['a', 'b'], dense: false, header: 'Tickets' },
    });
  });

  it('replaces arrays wholesale (Helm-style)', () => {
    const base = { filters: [{ column: 'status', value: 'open' }] };
    const ovr = { filters: [{ column: 'status', value: 'closed' }] };
    expect(mergeWidgetConfig(base, ovr)).toEqual({
      filters: [{ column: 'status', value: 'closed' }],
    });
  });

  it('null in override replaces base (explicit clear)', () => {
    expect(mergeWidgetConfig({ filter: { column: 'x' } }, { filter: null })).toEqual({
      filter: null,
    });
  });

  it('does not mutate the base config', () => {
    const base = { view: { dense: true } };
    const ovr = { view: { dense: false } };
    mergeWidgetConfig(base, ovr);
    expect(base).toEqual({ view: { dense: true } });
  });

  it('ignores non-object override (number/string/array)', () => {
    expect(mergeWidgetConfig({ a: 1 }, 42)).toEqual({ a: 1 });
    expect(mergeWidgetConfig({ a: 1 }, 'x')).toEqual({ a: 1 });
    expect(mergeWidgetConfig({ a: 1 }, [1, 2])).toEqual({ a: 1 });
  });
});

describe('getLockedPaths (ADR-0005 C-4)', () => {
  it('returns [] for empty/non-object overrides', () => {
    expect(getLockedPaths(null)).toEqual([]);
    expect(getLockedPaths(undefined)).toEqual([]);
    expect(getLockedPaths('not an object')).toEqual([]);
    expect(getLockedPaths([1, 2, 3])).toEqual([]);
    expect(getLockedPaths({})).toEqual([]);
  });

  it('returns leaf paths for nested objects', () => {
    const paths = getLockedPaths({ filter: { column: 'status', value: 'open' } });
    expect(paths.sort()).toEqual(['filter.column', 'filter.value']);
  });

  it('treats arrays as leaves (replace-wholesale semantics)', () => {
    expect(getLockedPaths({ visible_columns: ['a', 'b'] })).toEqual(['visible_columns']);
  });

  it('treats null as a leaf (explicit clear)', () => {
    expect(getLockedPaths({ filter: null })).toEqual(['filter']);
  });

  it('flat scalar fields produce themselves', () => {
    expect(getLockedPaths({ show_filters: false, default_expanded: true }).sort()).toEqual([
      'default_expanded',
      'show_filters',
    ]);
  });
});

describe('isFieldLocked (ADR-0005 C-4)', () => {
  it('matches the exact path', () => {
    expect(isFieldLocked(['filter.column'], 'filter.column')).toBe(true);
  });

  it('treats an ancestor path as locking the field', () => {
    expect(isFieldLocked(['filter'], 'filter.column')).toBe(true);
  });

  it('treats a subtree leaf as locking the parent', () => {
    expect(isFieldLocked(['filter.column'], 'filter')).toBe(true);
  });

  it('returns false for unrelated fields', () => {
    expect(isFieldLocked(['filter.column'], 'show_filters')).toBe(false);
    expect(isFieldLocked([], 'anything')).toBe(false);
    expect(isFieldLocked(['filter.column'], '')).toBe(false);
  });
});
