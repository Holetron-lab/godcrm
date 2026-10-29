// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { previewExcel } from '../excel-preview.js';

const XLSX = createRequire(import.meta.url)('xlsx');
function workbook(format, change = () => {}) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Имя', 'Имя', '', 'Дата', 'Флаг'],
    ['00123', 'Кириллица', 12.5, new Date(2026, 9, 8), true],
    [],
    ['https://example.invalid/image.png', 'после пропуска', 7, null, false],
  ], { cellDates: true });
  sheet.C2.z = '0000.00';
  change(sheet);
  XLSX.utils.book_append_sheet(book, sheet, 'Первый');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Другой'], ['только этот лист']]), 'Второй');
  return XLSX.write(book, { type: 'buffer', bookType: format });
}

describe.each(['xlsx', 'xls'])('%s preview', (format) => {
  it('lists sheets without choosing or returning any rows implicitly', async () => {
    const result = await previewExcel(workbook(format), `test.${format}`);
    expect(result.sheets.map(s => s.name)).toEqual(['Первый', 'Второй']);
    expect(result.sheet).toBeNull();
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'OBJECTS_IGNORED' }));
  });

  it('preserves coordinates, blank headers/rows, Cyrillic, raw values and number formats', async () => {
    const result = await previewExcel(workbook(format), `test.${format}`, 0);
    expect(result.sheet.rows[0]).toEqual(['Имя', 'Имя', '', 'Дата', 'Флаг']);
    expect(result.sheet.rows[1]).toEqual(['00123', 'Кириллица', '0012.50', '2026-10-08T00:00:00', 'true']);
    expect(result.sheet.rows[2]).toEqual(['', '', '', '', '']);
    expect(result.sheet.values[1]).toEqual(['00123', 'Кириллица', 12.5, '2026-10-08T00:00:00', true]);
    expect(result.sheet.rows[3][0]).toBe('https://example.invalid/image.png');
    expect(result.sheet.rowCount).toBe(4);
    expect(result.sheet.columnCount).toBe(5);
    expect(result.sheet.emptyRowCount).toBe(1);
  });

  it('returns only the explicitly selected sheet', async () => {
    const result = await previewExcel(workbook(format), `test.${format}`, 1);
    expect(result.sheet.rows).toEqual([['Другой'], ['только этот лист']]);
  });

  it('rejects an invalid selection and extension/content mismatch', async () => {
    await expect(previewExcel(workbook(format), `test.${format}`, 2)).rejects.toMatchObject({ code: 'SHEET_NOT_FOUND' });
    await expect(previewExcel(workbook(format), `test.${format === 'xls' ? 'xlsx' : 'xls'}`)).rejects.toMatchObject({ code: 'FORMAT_MISMATCH' });
  });

  it('rejects excessive source coordinates rather than truncating silently', async () => {
    const buffer = workbook(format, s => { s.A10002 = { t: 's', v: 'too far' }; s['!ref'] = 'A1:E10002'; });
    await expect(previewExcel(buffer, `test.${format}`, 0)).rejects.toMatchObject({ code: 'WORKBOOK_LIMIT' });
  });
});

it('uses cached formulas, leaves missing cache blank with coordinates', async () => {
  const buffer = workbook('xlsx', s => {
    s.A2 = { t: 'n', f: '1+1', v: 2 };
    s.B2 = { t: 'n', f: '2+2' };
  });
  const result = await previewExcel(buffer, 'formulas.xlsx', 0);
  expect(result.sheet.values[1].slice(0, 2)).toEqual([2, null]);
  expect(result.sheet.rows[1].slice(0, 2)).toEqual(['2', '']);
  expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'FORMULA_CACHE_MISSING', rowIndex: 1, colIndex: 1 }));
});

it('rejects malformed files, unsupported extensions and size overflow', async () => {
  await expect(previewExcel(Buffer.from('not Excel'), 'fake.xlsx')).rejects.toMatchObject({ code: 'FORMAT_MISMATCH' });
  await expect(previewExcel(Buffer.from('a,b'), 'file.csv')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  await expect(previewExcel(Buffer.alloc(10 * 1024 * 1024 + 1), 'large.xls')).rejects.toMatchObject({ code: 'FILE_LIMIT' });
});

it.each(['xls', 'xlsx'])('reads independent Apache POI %s fixtures with images and a stale formula cache', async format => {
  const data = readFileSync(new URL(`./fixtures/excel/poi-values.${format}`, import.meta.url));
  const result = await previewExcel(data, `values.${format}`, 0);
  expect(result.sheet.values[1].slice(0, 4)).toEqual(['00042', true, 7, '2026-10-08T00:00:00']);
  expect(result.sheet.rows[1][4]).toBe('Текст вместе с картинками');
  expect(result.sheet.rows[1][5]).toBe('https://example.invalid/do-not-fetch.png');
  expect(result.warnings[0].code).toBe('OBJECTS_IGNORED');
});

it('rejects a truncated ZIP and a renamed non-XLSX ZIP', async () => {
  const data = workbook('xlsx');
  await expect(previewExcel(data.subarray(0, data.length - 30), 'broken.xlsx')).rejects.toMatchObject({ code: 'INVALID_WORKBOOK' });
  const zip = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(zip, 'unrelated.txt', Buffer.from('a,b'));
  await expect(previewExcel(XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip' }), 'renamed.xlsx')).rejects.toMatchObject({ code: 'FORMAT_MISMATCH' });
});

it('rejects oversized archives before inflating', async () => {
  const data = workbook('xlsx');
  const central = data.indexOf(Buffer.from('504b0102', 'hex'));
  data.writeUInt32LE(51 * 1024 * 1024, central + 24);
  // Central size may be rejected by yauzl itself when the entry is uncompressed.
  await expect(previewExcel(data, 'bomb.xlsx')).rejects.toMatchObject({ code: expect.stringMatching(/ARCHIVE_LIMIT|INVALID_WORKBOOK/) });
});

it('rejects invalid CRC instead of accepting a corrupted entry', async () => {
  const data = workbook('xlsx');
  const central = data.indexOf(Buffer.from('504b0102', 'hex'));
  data.writeUInt32LE(0, central + 16);
  await expect(previewExcel(data, 'crc.xlsx')).rejects.toMatchObject({ code: 'INVALID_WORKBOOK' });
});

it('rejects excessive columns and text instead of returning partial success', async () => {
  await expect(previewExcel(workbook('xlsx', s => { s.IW1 = { t: 's', v: 'overflow' }; s['!ref'] = 'A1:IW4'; }), 'columns.xlsx')).rejects.toMatchObject({ code: 'WORKBOOK_LIMIT' });
  const largeText = workbook('xlsx', s => {
    for (let r = 2; r <= 302; r++) s[`A${r}`] = { t: 's', v: 'x'.repeat(16000) };
    s['!ref'] = 'A1:E302';
  });
  await expect(previewExcel(largeText, 'text.xlsx', 0)).rejects.toMatchObject({ code: 'WORKBOOK_LIMIT' });
});

it('limits concurrent parsers and releases capacity after failures', async () => {
  const data = workbook('xlsx');
  const first = previewExcel(data, 'a.xlsx');
  const second = previewExcel(data, 'b.xlsx');
  await expect(previewExcel(data, 'c.xlsx')).rejects.toMatchObject({ code: 'PREVIEW_BUSY' });
  await Promise.all([first, second]);
  await expect(previewExcel(Buffer.from('bad'), 'bad.xlsx')).rejects.toBeDefined();
  expect((await previewExcel(data, 'd.xlsx')).sheets).toHaveLength(2);
});

it('rejects encrypted XLSX containers and password-protected BIFF streams', async () => {
  const encrypted = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(encrypted, 'EncryptedPackage', Buffer.alloc(16));
  await expect(previewExcel(XLSX.CFB.write(encrypted, { type: 'buffer' }), 'protected.xlsx')).rejects.toMatchObject({ code: 'PROTECTED_WORKBOOK' });
  const cfb = XLSX.CFB.read(workbook('xls'), { type: 'buffer' });
  const book = XLSX.CFB.find(cfb, 'Workbook');
  const bofEnd = 4 + book.content.readUInt16LE(2);
  const protectedStream = Buffer.concat([book.content.subarray(0, bofEnd), Buffer.from('2f000600000000000000', 'hex'), book.content.subarray(bofEnd)]);
  XLSX.CFB.utils.cfb_add(cfb, 'Workbook', protectedStream);
  await expect(previewExcel(XLSX.CFB.write(cfb, { type: 'buffer' }), 'protected.xls')).rejects.toMatchObject({ code: 'PROTECTED_WORKBOOK' });
});

it('retains a zero XLS cache with an explicit uncertainty warning', async () => {
  const data = readFileSync(new URL('./fixtures/excel/poi-values.xls', import.meta.url));
  const cfb = XLSX.CFB.read(data, { type: 'buffer' });
  const book = XLSX.CFB.find(cfb, 'Workbook');
  for (let offset = 0; offset + 4 <= book.content.length;) {
    const id = book.content.readUInt16LE(offset);
    const length = book.content.readUInt16LE(offset + 2);
    if (id === 6) book.content.writeDoubleLE(0, offset + 10);
    offset += length + 4;
  }
  const result = await previewExcel(XLSX.CFB.write(cfb, { type: 'buffer' }), 'zero.xls', 0);
  expect(result.sheet.values[1][2]).toBe(0);
  expect(result.warnings).toContainEqual(expect.objectContaining({ code: 'FORMULA_CACHE_UNVERIFIED', rowIndex: 1, colIndex: 2 }));
});

it('bounds warning output for a workbook with many missing formula caches', async () => {
  const data = workbook('xlsx', s => {
    for (let r = 1; r <= 1002; r++) s[`A${r}`] = { t: 'n', f: '1+1' };
    s['!ref'] = 'A1:E1002';
  });
  await expect(previewExcel(data, 'warnings.xlsx', 0)).rejects.toMatchObject({ code: 'WORKBOOK_LIMIT' });
});
