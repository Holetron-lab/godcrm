import { expect, it } from 'vitest';
import { cloneDefaultColumns } from '../constants';

it('starts with an editable Date column instead of duplicating system timestamps', () => {
  const columns = cloneDefaultColumns();
  expect(columns.map(column => column.name)).not.toContain('created_at');
  expect(columns.map(column => column.name)).not.toContain('updated_at');
  expect(columns).toContainEqual(expect.objectContaining({ name: 'date', displayName: 'Date', type: 'datetime' }));
  expect(columns.find(column => column.name === 'date')?.config?.date?.mode).toBe('date');
  expect(columns.find(column => column.name === 'date')?.isReadonly).not.toBe(true);
});
