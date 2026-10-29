import { describe, expect, it } from 'vitest';
import {
  applyExcelPreview, buildColumnDefinitions, buildExcelCreateBody, buildExcelRows, cellAddress,
  createExcelFileEntry, freezeExcelImport, guessExcelColumnType, isExcelFileName, isExcelFileReady,
  projectExcelValue, splitImportBatches,
} from '../excel-utils';
import type { CSVFileData, ExcelPreviewResponse } from '../types';

const toSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const preview = (sheet: ExcelPreviewResponse['sheet'], sheets = [{ index: 0, name: 'Данные', rowCount: 4, columnCount: 3, hidden: false }]): ExcelPreviewResponse => ({
  format: 'xlsx',
  sheets,
  sheet,
  warnings: [{ code: 'OBJECTS_IGNORED', message: 'Изображения не импортируются.' }],
  limits: {},
});

const loadedEntry = (): CSVFileData => {
  const entry = createExcelFileEntry(new File(['x'], 'Заказы.xlsx'), 0);
  return applyExcelPreview(entry, preview({
    index: 0, name: 'Данные', rowCount: 4, columnCount: 3, hidden: false,
    rows: [['Код', 'Код', ''], ['007', 'Иван', '2026-10-08T00:00:00'], ['', '', ''], ['12', 'Пётр']],
    values: [['Код', 'Код', null], [7, 'Иван', '2026-10-08T00:00:00'], [null, null, null], [12, 'Пётр']],
    emptyRowCount: 1, skippedCellCount: 0,
  }), toSlug);
};

describe('file routing', () => {
  it('recognises Excel extensions case-insensitively and keeps CSV separate', () => {
    expect(isExcelFileName('a.XLSX')).toBe(true);
    expect(isExcelFileName('a.xls')).toBe(true);
    expect(isExcelFileName('a.csv')).toBe(false);
    expect(isExcelFileName('a.xlsm')).toBe(false);
  });
});

describe('guessExcelColumnType', () => {
  it('uses typed values and keeps leading zeros as text', () => {
    expect(guessExcelColumnType('qty', [1, 2.5, null], ['1', '2.5', ''])).toBe('number');
    expect(guessExcelColumnType('code', [7, 12], ['007', '012'])).toBe('text');
    expect(guessExcelColumnType('done', [true, false], ['true', 'false'])).toBe('checkbox');
    expect(guessExcelColumnType('when', ['2026-10-08T12:00:00'], ['2026-10-08T12:00:00'])).toBe('datetime');
    expect(guessExcelColumnType('name', ['Иван'], ['Иван'])).toBe('text');
  });
});

describe('buildColumnDefinitions', () => {
  it('keeps source indices for duplicate and blank headers', () => {
    const defs = buildColumnDefinitions(['Код', 'Код', ''], () => 'text', toSlug);
    expect(defs.map(d => d.colIndex)).toEqual([0, 1, 2]);
    expect(defs.map(d => d.name)).toEqual(['text', 'text_01', 'text_02']);
    expect(defs[2].displayName).toBe('Column 3');
    expect(defs.map(d => d.csvColumn)).toEqual(['Код', 'Код', '']);
  });
});

describe('applyExcelPreview', () => {
  it('stores the sheet list and waits for a choice when no sheet was sent', () => {
    const entry = createExcelFileEntry(new File(['x'], 'book.xls'), 1);
    expect(entry.excel?.loading).toBe(true);
    expect(entry.excel?.importId).toMatch(UUID);
    const next = applyExcelPreview(entry, preview(null, [
      { index: 0, name: 'A', rowCount: 1, columnCount: 1, hidden: false },
      { index: 1, name: 'B', rowCount: 1, columnCount: 1, hidden: true },
    ]), toSlug);
    expect(next.excel?.sheetIndex).toBeNull();
    expect(next.excel?.sheets).toHaveLength(2);
    expect(next.excel?.loading).toBe(false);
    expect(next.data).toEqual([]);
    expect(isExcelFileReady(next)).toBe(false);
  });

  it('pads ragged rows, derives definitions by colIndex and regenerates the key on a sheet change', () => {
    const entry = loadedEntry();
    expect(entry.headers).toEqual(['Код', 'Код', '']);
    expect(entry.data[3]).toEqual(['12', 'Пётр', '']);
    expect(entry.excel?.values[3]).toEqual([12, 'Пётр', null]);
    expect(entry.columnDefinitions.map(d => [d.colIndex, d.type])).toEqual([[0, 'text'], [1, 'text'], [2, 'datetime']]);
    expect(isExcelFileReady(entry)).toBe(true);

    const firstKey = entry.excel?.importId;
    const frozen = { ...entry, excel: { ...entry.excel!, importState: freezeExcelImport(entry, 1, true, 'd') } };
    const sameSheet = applyExcelPreview(frozen, preview({ ...preview(null).sheets[0], rows: [['a']], values: [['a']], emptyRowCount: 0, skippedCellCount: 0 }), toSlug);
    expect(sameSheet.excel?.importId).toBe(firstKey);
    expect(sameSheet.excel?.importState).toBeDefined();

    const otherSheet = applyExcelPreview(frozen, preview({ index: 1, name: 'B', rowCount: 1, columnCount: 1, hidden: false, rows: [['a']], values: [['a']], emptyRowCount: 0, skippedCellCount: 0 }), toSlug);
    expect(otherSheet.excel?.importId).not.toBe(firstKey);
    expect(otherSheet.excel?.importState).toBeUndefined();
  });
});

describe('projectExcelValue', () => {
  it('projects by the chosen column type without inventing time zones', () => {
    expect(projectExcelValue('007', 7, 'text')).toBe('007');
    expect(projectExcelValue('007', 7, 'number')).toBe(7);
    expect(projectExcelValue('1 234,5', '1 234,5', 'number')).toBe(1234.5);
    expect(projectExcelValue('да', 'да', 'checkbox')).toBe(true);
    expect(projectExcelValue('false', false, 'checkbox')).toBe(false);
    expect(projectExcelValue('2026-10-08T12:34:56', '2026-10-08T12:34:56', 'datetime')).toBe('2026-10-08T12:34:56');
    expect(projectExcelValue('2026-10-08T12:34:56', '2026-10-08T12:34:56', 'date')).toBe('2026-10-08');
    expect(projectExcelValue('', null, 'number')).toBeNull();
    expect(projectExcelValue('', null, 'text')).toBeNull();
    expect(projectExcelValue('', 0, 'number')).toBe(0);
  });
});

describe('buildExcelRows', () => {
  it('maps by source coordinates, skips empty rows and excluded columns', () => {
    const entry = loadedEntry();
    entry.columnDefinitions[0].type = 'number';
    entry.columnDefinitions[2].excluded = true;
    const projection = buildExcelRows(entry, true);
    expect(projection.rows).toEqual([{ text: 7, text_01: 'Иван' }, { text: 12, text_01: 'Пётр' }]);
    expect(projection.skippedEmptyRows).toBe(1);
    expect(projection.excludedColumns).toBe(1);
  });

  it('keeps the header row as data when the first row is not a header', () => {
    const entry = loadedEntry();
    // Blank header + ISO values → key falls back to the guessed type ('datetime').
    expect(buildExcelRows(entry, false).rows[0]).toEqual({ text: 'Код', text_01: 'Код', datetime: null });
  });
});

describe('splitImportBatches', () => {
  it('splits by row limit and gives every batch its own UUID', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ a: i }));
    const batches = splitImportBatches(rows, { rows: 2, cells: 200000, bytes: 1 << 20 });
    expect(batches.map(b => b.rows.length)).toEqual([2, 2, 1]);
    expect(new Set(batches.map(b => b.importId)).size).toBe(3);
    batches.forEach(b => expect(b.importId).toMatch(UUID));
    expect(splitImportBatches([])).toEqual([]);
  });
});

describe('buildExcelCreateBody / freezeExcelImport', () => {
  it('serialises the whole schema with importId in a stable property order', () => {
    const entry = loadedEntry();
    entry.columnDefinitions[1].type = 'select';
    entry.columnDefinitions[1].emoji = '🏷️';
    entry.columnDefinitions[2].excluded = true;
    const body = buildExcelCreateBody(entry, 42, 'k', true, 'desc');
    const parsed = JSON.parse(body);
    expect(Object.keys(parsed)).toEqual(['name', 'displayName', 'description', 'icon', 'projectId', 'columns', 'importId']);
    expect(parsed.projectId).toBe(42);
    expect(parsed.importId).toBe('k');
    expect(parsed.columns.map((c: { name: string }) => c.name)).toEqual(['text', 'text_01']);
    expect(parsed.columns[1].config.options.map((o: { label: string }) => o.label)).toEqual(['Иван', 'Пётр']);
    expect(parsed.columns[1].config.appearance.indicator.value).toBe('🏷️');
    expect(buildExcelCreateBody(entry, 42, 'k', true, 'desc')).toBe(body);

    const frozen = freezeExcelImport(entry, 42, true, 'desc');
    expect(frozen.importId).toBe(entry.excel?.importId);
    expect(frozen.batches).toHaveLength(1);
    expect(frozen.batches[0].rows).toHaveLength(2);
    expect(frozen.skippedEmptyRows).toBe(1);
    expect(frozen.completedBatchIds).toEqual([]);
  });
});

describe('cellAddress', () => {
  it('formats A1 coordinates', () => {
    expect(cellAddress(0, 0)).toBe('A1');
    expect(cellAddress(9, 27)).toBe('AB10');
  });
});
