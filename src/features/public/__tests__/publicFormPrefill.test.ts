import { describe, expect, it } from 'vitest';
import { buildInitialFormData, buildUrlPrefill, coerceParam } from '../publicFormPrefill';
import type { ColumnModel } from '@/features/tables/types/table.types';
import type { FormField } from '@/features/tables/types/form-config.types';

const col = (id: string, name: string, type: ColumnModel['type']): ColumnModel =>
  ({ id, tableId: '1', name, displayName: name, type, isRequired: false, isReadonly: false, orderIndex: 0, width: 160, isVisible: true } as ColumnModel);

const columns = [col('10', 'source', 'text'), col('11', 'amount', 'number'), col('12', 'agree', 'checkbox'), col('13', 'tags', 'multi-select'), col('14', 'secret', 'text')];
const field = (columnId: string, extra: Partial<FormField> = {}): FormField => ({ id: `f${columnId}`, columnId, width: 'full', order: 0, ...extra });

describe('buildUrlPrefill', () => {
  it('reads only fields flagged urlParam, by column name or id', () => {
    const fields = [field('10', { urlParam: true }), field('11', { urlParam: true }), field('14')];
    const params = new URLSearchParams('source=telegram&11=42&secret=leak');
    expect(buildUrlPrefill(fields, columns, params)).toEqual({ 10: 'telegram', 11: 42 });
  });

  it('coerces by column type', () => {
    expect(coerceParam('yes', 'checkbox')).toBe(true);
    expect(coerceParam('0', 'checkbox')).toBe(false);
    expect(coerceParam('abc', 'number')).toBe('abc');
    expect(coerceParam('a, b,,c', 'multi-select')).toEqual(['a', 'b', 'c']);
  });
});

describe('buildInitialFormData', () => {
  it('prefers prefill, then literal default, then an empty value per type', () => {
    const fields = [field('10', { urlParam: true, defaultValue: 'web' }), field('11', { defaultValue: '{{now}}' }), field('12'), field('13')];
    expect(buildInitialFormData(fields, columns, { 10: 'telegram' })).toEqual({ 10: 'telegram', 11: '', 12: false, 13: [] });
    expect(buildInitialFormData([field('10', { defaultValue: 'web' })], columns, {})).toEqual({ 10: 'web' });
  });
});
