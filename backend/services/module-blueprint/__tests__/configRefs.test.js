// ADR-200 W3 — blueprint config references.
//
// This is the substitution ADR-192 §W4 will reuse for copy-time widget remapping, so it is
// tested on its own: pure, no database, no installer.

import { describe, it, expect } from 'vitest';
import { collectTableRefs, isTableRef, remapConfigTableRefs } from '../configRefs.js';

const ids = { schemes: 101, runs: 202 };
const resolve = (ref) => ids[ref];

describe('isTableRef', () => {
  it('accepts only the bare single-key sentinel', () => {
    expect(isTableRef({ $table: 'schemes' })).toBe(true);
    expect(isTableRef({ $table: 'schemes', extra: 1 })).toBe(false);
    expect(isTableRef({ $table: 5 })).toBe(false);
    expect(isTableRef({ table: 'schemes' })).toBe(false);
    expect(isTableRef(['$table'])).toBe(false);
    expect(isTableRef(null)).toBe(false);
  });
});

describe('collectTableRefs', () => {
  it('finds references at any depth, including inside arrays', () => {
    const refs = collectTableRefs({
      table_id: { $table: 'schemes' },
      filters: [{ source: { $table: 'runs' } }, { plain: 1 }],
      nested: { deep: { deeper: { $table: 'schemes' } } },
    });
    expect([...refs].sort()).toEqual(['runs', 'schemes']);
  });

  it('returns nothing for a config that binds no table', () => {
    expect(collectTableRefs({ columns: ['a', 'b'], limit: 10 }).size).toBe(0);
  });
});

describe('remapConfigTableRefs', () => {
  it('substitutes every reference and leaves everything else identical', () => {
    const config = {
      table_id: { $table: 'schemes' },
      filters: [{ source: { $table: 'runs' } }],
      title: 'Схемы',
      limit: 10,
      flag: false,
      nothing: null,
    };
    expect(remapConfigTableRefs(config, resolve)).toEqual({
      table_id: 101,
      filters: [{ source: 202 }],
      title: 'Схемы',
      limit: 10,
      flag: false,
      nothing: null,
    });
  });

  it('does not mutate the input — the blueprint is stored verbatim and must survive intact', () => {
    const config = { table_id: { $table: 'schemes' } };
    const frozen = structuredClone(config);
    remapConfigTableRefs(config, resolve);
    expect(config).toEqual(frozen);
  });

  it('throws on a reference the resolver cannot satisfy rather than binding to nothing', () => {
    expect(() => remapConfigTableRefs({ table_id: { $table: 'ghost' } }, resolve))
      .toThrow(/unresolved table reference "ghost"/);
  });

  it('works for the copy domain too — resolve is the only difference (ADR-192 §W4)', () => {
    const idMap = { 7: 99 };
    expect(remapConfigTableRefs({ table_id: { $table: '7' } }, (old) => idMap[old])).toEqual({ table_id: 99 });
  });
});
