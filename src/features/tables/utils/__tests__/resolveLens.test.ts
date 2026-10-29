import { describe, expect, it } from 'vitest';
import { parseRelationValues, resolveLens } from '../resolveLens';
import type { ColumnRelationConfig } from '../../types/table.types';

const relation: ColumnRelationConfig = { enabled: true, tableId: '7820', valueColumn: 'sku', labelColumn: 'image' };
const serverMap = {
  'sku-1': { value: 'products/a.jpg', label: 'Chair A', color: '#112233', description: 'first' },
  'sku-2': { value: 'products/b.jpg', label: 'Chair B' },
  'abs': { value: 'https://cdn.example.com/x.jpg', label: 'Absolute' },
};

describe('parseRelationValues', () => {
  it('prefers a JSON array, then the storage format, then auto-detects', () => {
    expect(parseRelationValues('["a","b"]', 'comma')).toEqual(['a', 'b']);
    expect(parseRelationValues('a, b', 'comma')).toEqual(['a', 'b']);
    expect(parseRelationValues('a;b', 'semicolon')).toEqual(['a', 'b']);
    expect(parseRelationValues('a\nb', 'newline')).toEqual(['a', 'b']);
    expect(parseRelationValues('a, b', 'single')).toEqual(['a, b']);
    expect(parseRelationValues('a, b')).toEqual(['a', 'b']);
    expect(parseRelationValues(['x', 2])).toEqual(['x', '2']);
    expect(parseRelationValues(null)).toEqual([]);
  });
});

describe('resolveLens', () => {
  it('passes the raw value through when the lens is off', () => {
    expect(resolveLens('sku-1', undefined, serverMap)).toEqual({ value: 'sku-1', label: 'sku-1', items: [], mapped: false });
    expect(resolveLens('sku-1', { ...relation, enabled: false }, serverMap).value).toBe('sku-1');
  });

  it('keeps the raw key and reports unmapped while no map is available', () => {
    const lensed = resolveLens('sku-1', relation, undefined);
    expect(lensed.mapped).toBe(false);
    expect(lensed.value).toBe('sku-1');
    expect(lensed.items).toEqual([{ key: 'sku-1', value: 'sku-1', label: 'sku-1', resolved: false }]);
  });

  it('swaps a single key for the related row value, label, color and description', () => {
    const lensed = resolveLens('sku-1', relation, serverMap);
    expect(lensed).toMatchObject({ value: 'products/a.jpg', label: 'Chair A', color: '#112233', description: 'first', mapped: true });
    expect(lensed.items[0]).toMatchObject({ key: 'sku-1', resolved: true });
  });

  it('renders an unresolved key as the raw key, never blank (D1.5)', () => {
    const lensed = resolveLens('ghost', relation, serverMap);
    expect(lensed.value).toBe('ghost');
    expect(lensed.label).toBe('ghost');
    expect(lensed.items[0].resolved).toBe(false);
    expect(lensed.mapped).toBe(true);
  });

  it.each([
    ['comma', 'sku-1, sku-2'],
    ['json', '["sku-1","sku-2"]'],
  ] as const)('resolves multi-value keys per key with storageFormat %s (AC7)', (storageFormat, stored) => {
    const lensed = resolveLens(stored, { ...relation, multiple: true, storageFormat }, serverMap);
    expect(lensed.value).toEqual(['products/a.jpg', 'products/b.jpg']);
    expect(lensed.label).toBe('Chair A, Chair B');
    expect(lensed.items.map((i) => i.resolved)).toEqual([true, true]);
  });

  it('keeps a comma inside a single-value key when neither multiple nor storageFormat is set', () => {
    const map = { 'Smith, John': { value: 'u-1', label: 'John' } };
    expect(resolveLens('Smith, John', relation, map).value).toBe('u-1');
    // the multi-value cells still auto-split (their historical behaviour)
    expect(resolveLens('sku-1,sku-2', relation, serverMap, 'auto').items).toHaveLength(2);
  });

  it('accepts a client Map and falls back to label when the entry has no value', () => {
    const clientMap = new Map([['sku-1', { label: 'Only label', color: '#000' }]]);
    const lensed = resolveLens('sku-1', relation, clientMap);
    expect(lensed.value).toBe('Only label');
    expect(lensed.color).toBe('#000');
  });

  it('leaves absolute URLs in the related row untouched (AC4)', () => {
    expect(resolveLens('abs', relation, serverMap).value).toBe('https://cdn.example.com/x.jpg');
  });

  it('serialises non-string server values instead of printing [object Object]', () => {
    const map = { k: { value: ['a.jpg', 'b.jpg'], label: 'pair' } };
    expect(resolveLens('k', relation, map).value).toBe('["a.jpg","b.jpg"]');
  });
});
