import { describe, expect, it } from 'vitest';
import { getColumnTypeOptions, getColumnTypeOptionsForCSV, getColumnTypeOptionsWithEmoji } from './index';
import { cloneDefaultColumns } from '@/features/tables/components/CreateTableModal/constants';
import { guessColumnType } from '@/features/tables/components/CreateTableModal/csv-utils';

describe('available column types', () => {
  for (const language of ['en', 'ru'] as const) {
    it(`offers the same supported types in every ${language} selector`, () => {
      const options = getColumnTypeOptions(language);
      const values = options.map(option => option.value);
      expect(values).not.toContain('date');
      expect(values).not.toContain('rollup');
      expect(values).not.toContain('relation');
      expect(values).toEqual(expect.arrayContaining(['datetime', 'time']));
      expect(getColumnTypeOptionsForCSV(language).map(({ value }) => value)).toEqual(values);
      expect(getColumnTypeOptionsWithEmoji(language).map(({ value }) => value)).toEqual(values);
      expect(options.find(({ value }) => value === 'datetime')?.label)
        .toBe(language === 'en' ? 'Date & Time' : 'Дата и время');
      expect(options.find(({ value }) => value === 'time')?.label)
        .toBe(language === 'en' ? 'Time (cron)' : 'Время (крон)');
    });
  }

  it('uses available types for initial columns and detected CSV dates', () => {
    const values = getColumnTypeOptions().map(({ value }) => value);
    for (const column of cloneDefaultColumns()) expect(values).toContain(column.type);
    expect(guessColumnType('created_at', [])).toBe('datetime');
    expect(guessColumnType('deadline', ['2026-09-28', '2026-09-29'])).toBe('datetime');
  });
});
