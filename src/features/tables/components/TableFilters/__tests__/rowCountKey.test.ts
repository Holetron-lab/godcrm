import { describe, it, expect } from 'vitest';
import { rowCountKey } from '../utils';

describe('rowCountKey', () => {
  it.each([
    ['ru', 1, 'table.rowCountOne'],
    ['ru', 21, 'table.rowCountOne'],
    ['ru', 3, 'table.rowCountFew'],
    ['ru', 11, 'table.rowCountMany'],
    ['ru', 5000, 'table.rowCountMany'],
    ['en', 1, 'table.rowCountOne'],
    ['en', 2, 'table.rowCountMany'],
  ])('%s: %d → %s', (language, count, key) => {
    expect(rowCountKey(language, count)).toBe(key);
  });
});
