/**
 * ADR-0035-A — `address` value normalizer (pure) and the by-type cell dispatch.
 * No DB. The write-path enumeration test at the bottom is the ADR §Risks
 * mitigation: a path that stops calling the shared dispatch fails here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { normalizeAddressValue, ADDRESS_INVALID, ADDRESS_KEYS, ADDRESS_FORMATTED_MAX } from '../address.js';
import { normalizeTypedCells, NORMALIZED_CELL_TYPES } from '../../cellNormalizers.js';
import { GEO_POINT_INVALID } from '../geoPoint.js';

const FULL = {
  formatted: 'Тверская 7, Москва', name: 'Офис', country_code: 'ru', country: 'Россия', region: 'Москва',
  city: 'Москва', street: 'Тверская', building: '7', unit: '12', postal_code: '125009',
  provider: 'dadata', provider_place_id: 'fias-123',
};

describe('normalizeAddressValue', () => {
  it('null, empty and whitespace-only clear the cell', () => {
    for (const v of [null, undefined, '', '   ']) expect(normalizeAddressValue(v)).toEqual({ ok: true, value: null });
  });

  it('a string becomes { formatted } trimmed', () => {
    expect(normalizeAddressValue('  Тверская 7, Москва ')).toEqual({ ok: true, value: { formatted: 'Тверская 7, Москва' } });
  });

  it('an object keeps every allowlisted key, uppercases country_code, drops unknown and empty keys', () => {
    const r = normalizeAddressValue({ ...FULL, foo: 'bar', unit: '', city: '  ' });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ ...FULL, country_code: 'RU', unit: undefined, city: undefined, foo: undefined });
    expect(Object.keys(r.value).every((k) => ADDRESS_KEYS.includes(k))).toBe(true);
    expect(r.value).not.toHaveProperty('unit');
    expect(r.value).not.toHaveProperty('city');
    expect(r.value).not.toHaveProperty('foo');
  });

  it('reserved provider keys round-trip verbatim', () => {
    expect(normalizeAddressValue({ formatted: 'x', provider: 'photon', provider_place_id: 'osm:1' }).value)
      .toEqual({ formatted: 'x', provider: 'photon', provider_place_id: 'osm:1' });
  });

  it.each([
    ['object without formatted', { name: 'Офис' }],
    ['object with empty formatted', { formatted: '   ', city: 'Москва' }],
    ['non-string component', { formatted: 'x', building: 7 }],
    ['bad country_code', { formatted: 'x', country_code: 'RUS' }],
    ['string over the cap', 'x'.repeat(ADDRESS_FORMATTED_MAX + 1)],
    ['object over the cap', { formatted: 'x'.repeat(ADDRESS_FORMATTED_MAX + 1) }],
    ['number', 42],
    ['array', ['Тверская 7']],
  ])('rejects %s', (_label, value) => {
    expect(normalizeAddressValue(value).ok).toBe(false);
  });

  it('accepts exactly the cap', () => {
    expect(normalizeAddressValue('x'.repeat(ADDRESS_FORMATTED_MAX)).ok).toBe(true);
  });
});

describe('normalizeTypedCells dispatch', () => {
  const cols = [
    { id: 1, column_name: 'where', type: 'geo_point' },
    { id: 2, column_name: 'addr', type: 'address' },
    { id: 3, column_name: 'title', type: 'text' },
  ];

  it('covers geo_point and address, nothing else', () => {
    expect([...NORMALIZED_CELL_TYPES].sort()).toEqual(['address', 'geo_point']);
  });

  it('normalizes both types in one pass, by name and by id, and leaves other columns alone', () => {
    const r = normalizeTypedCells(cols, { where: '55.75, 37.61', 2: 'Тверская 7', title: { formatted: 'not touched' } });
    expect(r).toEqual({ ok: true, data: {
      where: { lat: 55.75, lng: 37.61, source: 'raw' },
      2: { formatted: 'Тверская 7' },
      title: { formatted: 'not touched' },
    } });
  });

  it('reports the failing column with its own code', () => {
    expect(normalizeTypedCells(cols, { addr: { name: 'no line' } })).toMatchObject({ ok: false, status: 400, code: ADDRESS_INVALID, meta: { column: 'addr' } });
    expect(normalizeTypedCells(cols, { where: 'nowhere' })).toMatchObject({ ok: false, status: 400, code: GEO_POINT_INVALID, meta: { column: 'where' } });
    expect(normalizeTypedCells(cols, { addr: '' })).toEqual({ ok: true, data: { addr: null } });
  });
});

describe('every row write path calls the shared dispatch (ADR-0035-A §Risks)', () => {
  const root = path.join(process.cwd(), 'backend'); // vitest root = repo root
  it.each([
    'routes/v3/tables/tableRowCreateController.js',
    'routes/v3/tables/tableRowMutateController.js',
    'routes/v3/tables/tableRowBatchController.js',
    'services/agent-tools/data-tools.js',
    'services/ImportService.js',
    'routes/v3/webhooks.js',
    'services/forms/publicFormSubmission.js',
  ])('%s', (rel) => {
    const src = readFileSync(path.join(root, rel), 'utf8');
    expect(src).toMatch(/normalizeTypedCells\(/);
    expect(src).not.toMatch(/normalizeGeoCells/);
  });
});
