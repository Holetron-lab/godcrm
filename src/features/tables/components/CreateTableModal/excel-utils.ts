import { BOOL_TRUE_VALUES } from '@/shared/utils/i18n-utils';
import { guessColumnType } from './csv-utils';
import type {
  CSVColumnDefinition,
  CSVFileData,
  ExcelCellValue,
  ExcelFileState,
  ExcelImportBatch,
  ExcelImportState,
  ExcelPreviewResponse,
} from './types';

export const EXCEL_EXTENSION = /\.(xlsx|xls)$/i;
export const CSV_EXTENSION = /\.csv$/i;
export const isExcelFileName = (name: string) => EXCEL_EXTENSION.test(name);
export const isCsvFileName = (name: string) => CSV_EXTENSION.test(name);
export const isSupportedImportFile = (file: File) =>
  isCsvFileName(file.name) || isExcelFileName(file.name) || file.type === 'text/csv';

// ISO wall-clock date from the preview contract: no zone is ever invented.
const ISO_LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const LEADING_ZERO = /^0\d/;

// Single rows/import batch limits (README: 1–10000 rows, 200000 cells, 8 MiB).
export const IMPORT_BATCH_LIMITS = Object.freeze({
  rows: 10000,
  cells: 200000,
  bytes: 7 * 1024 * 1024,
});

export function newImportId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  // RFC 4122 v4 fallback for environments without crypto.randomUUID.
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const isEmptyCell = (text: string | undefined, value: ExcelCellValue | undefined) =>
  (value === null || value === undefined || value === '') && (text === undefined || text === '');

// Column type guess from typed cell values; falls back to the CSV text heuristic.
export function guessExcelColumnType(header: string, values: ExcelCellValue[], texts: string[]): string {
  const nonEmpty = values.filter(v => v !== null && v !== '');
  const nonEmptyTexts = texts.filter(t => t && t.trim());
  if (nonEmptyTexts.some(t => LEADING_ZERO.test(t.trim()))) return 'text';
  if (nonEmpty.length > 0) {
    if (nonEmpty.every(v => typeof v === 'boolean')) return 'checkbox';
    if (nonEmpty.every(v => typeof v === 'number')) return 'number';
    if (nonEmpty.every(v => typeof v === 'string' && ISO_LOCAL_DATETIME.test(v))) return 'datetime';
  }
  return guessColumnType(header, nonEmptyTexts);
}

const slugFromHeader = (header: string, fallback: string, toSlug: (value: string) => string) => {
  const base = toSlug(header) || header.toLowerCase().replace(/[^a-z0-9_]/gi, '_');
  return !base || /^_+$/.test(base) ? fallback : base;
};

// Column definitions keyed by the source column index, so duplicate or blank
// header strings never collapse two columns into one.
export function buildColumnDefinitions(
  headers: string[],
  typeFor: (header: string, colIndex: number) => string,
  toSlug: (value: string) => string,
): CSVColumnDefinition[] {
  const usedNames = new Set<string>();
  return headers.map((header, colIndex) => {
    const guessedType = typeFor(header, colIndex);
    const baseName = slugFromHeader(header, guessedType, toSlug);
    let finalName = baseName;
    let suffix = 1;
    while (usedNames.has(finalName)) {
      finalName = `${baseName}_${String(suffix).padStart(2, '0')}`;
      suffix++;
    }
    usedNames.add(finalName);
    return {
      colIndex,
      csvColumn: header,
      name: finalName,
      displayName: header || `Column ${colIndex + 1}`,
      type: guessedType,
      isNotionRelation: false,
      relationTargetFileId: undefined,
    };
  });
}

const padRow = <T,>(row: T[] | undefined, width: number, fill: T): T[] => {
  const next = (row ?? []).slice(0, width);
  while (next.length < width) next.push(fill);
  return next;
};

export function createExcelFileEntry(file: File, index: number): CSVFileData {
  const baseName = file.name.replace(EXCEL_EXTENSION, '');
  return {
    id: `excel-${Date.now()}-${index}`,
    fileName: file.name,
    tableName: baseName.toLowerCase().replace(/[^a-z0-9_]/gi, '_'),
    tableDisplayName: baseName,
    tableDescription: '',
    icon: '\u{1F4CA}',
    color: null,
    showInMenu: false,
    menuWidgetTitle: '',
    menuWidgetIcon: '',
    menuWidgetDescription: '',
    data: [],
    headers: [],
    columnDefinitions: [],
    source: 'excel',
    excel: {
      file,
      format: null,
      sheets: [],
      sheetIndex: null,
      values: [],
      warnings: [],
      emptyRowCount: 0,
      skippedCellCount: 0,
      loading: true,
      error: null,
      importId: newImportId(),
    },
  };
}

// Applies a preview response. With `sheet: null` only the sheet list is known.
export function applyExcelPreview(
  entry: CSVFileData,
  preview: ExcelPreviewResponse,
  toSlug: (value: string) => string,
): CSVFileData {
  const previous = entry.excel as ExcelFileState;
  if (!preview.sheet) {
    return {
      ...entry,
      excel: {
        ...previous,
        format: preview.format,
        sheets: preview.sheets,
        sheetIndex: null,
        values: [],
        warnings: preview.warnings,
        loading: false,
        error: null,
      },
    };
  }
  const { sheet } = preview;
  const width = sheet.columnCount;
  const rows = sheet.rows.map(row => padRow(row, width, ''));
  const values = sheet.values.map(row => padRow<ExcelCellValue>(row, width, null));
  const headers = padRow(rows[0], width, '');
  const dataRows = rows.slice(1);
  const dataValues = values.slice(1);
  const columnDefinitions = buildColumnDefinitions(
    headers,
    (header, colIndex) => guessExcelColumnType(
      header,
      dataValues.map(row => row[colIndex] ?? null),
      dataRows.map(row => row[colIndex] ?? ''),
    ),
    toSlug,
  );
  return {
    ...entry,
    data: rows,
    headers,
    columnDefinitions,
    excel: {
      ...previous,
      format: preview.format,
      sheets: preview.sheets,
      sheetIndex: sheet.index,
      values,
      warnings: preview.warnings,
      emptyRowCount: sheet.emptyRowCount,
      skippedCellCount: sheet.skippedCellCount,
      loading: false,
      error: null,
      // Another sheet is another import: a fresh key, no stale frozen payload.
      importId: previous.sheetIndex === sheet.index && previous.importState ? previous.importId : newImportId(),
      importState: previous.sheetIndex === sheet.index ? previous.importState : undefined,
    },
  };
}

// Projects one cell to the chosen column type. `text` is the display string
// (keeps leading zeros); `value` is the typed value from the preview.
export function projectExcelValue(text: string, value: ExcelCellValue, type: string): string | number | boolean | null {
  if (isEmptyCell(text, value)) return null;
  switch (type) {
    case 'number': {
      if (typeof value === 'number') return value;
      if (typeof value === 'boolean') return value ? 1 : 0;
      const parsed = Number(String(value ?? text).replace(',', '.').replace(/\s/g, ''));
      return Number.isFinite(parsed) ? parsed : null;
    }
    case 'checkbox': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      const lower = String(value ?? text).toLowerCase().trim();
      return BOOL_TRUE_VALUES.includes(lower as typeof BOOL_TRUE_VALUES[number]);
    }
    case 'datetime':
    case 'date': {
      if (typeof value === 'string' && ISO_LOCAL_DATETIME.test(value)) {
        return type === 'date' ? value.slice(0, 10) : value;
      }
      return text || String(value ?? '') || null;
    }
    default:
      return text !== '' ? text : String(value ?? '');
  }
}

export interface ExcelRowsProjection {
  rows: Record<string, unknown>[];
  skippedEmptyRows: number;
  excludedColumns: number;
}

export function buildExcelRows(file: CSVFileData, useFirstRowAsHeaders: boolean): ExcelRowsProjection {
  const values = file.excel?.values ?? [];
  const start = useFirstRowAsHeaders ? 1 : 0;
  const columns = file.columnDefinitions.filter(col => !col.excluded && col.name !== 'id');
  const rows: Record<string, unknown>[] = [];
  let skippedEmptyRows = 0;
  for (let r = start; r < file.data.length; r++) {
    const textRow = file.data[r] ?? [];
    const valueRow = values[r] ?? [];
    if (columns.every(col => isEmptyCell(textRow[col.colIndex], valueRow[col.colIndex]))) {
      skippedEmptyRows++;
      continue;
    }
    const row: Record<string, unknown> = {};
    for (const col of columns) {
      row[col.name] = projectExcelValue(textRow[col.colIndex] ?? '', valueRow[col.colIndex] ?? null, col.type);
    }
    rows.push(row);
  }
  return { rows, skippedEmptyRows, excludedColumns: file.columnDefinitions.length - columns.length };
}

const byteLength = (text: string) => new TextEncoder().encode(text).length;

// Splits rows into fixed batches; each batch gets its own stable UUID.
export function splitImportBatches(rows: Record<string, unknown>[], limits: { rows: number; cells: number; bytes: number } = IMPORT_BATCH_LIMITS): ExcelImportBatch[] {
  const batches: ExcelImportBatch[] = [];
  let current: Record<string, unknown>[] = [];
  let cells = 0;
  let bytes = 2;
  const flush = () => {
    if (current.length) batches.push({ importId: newImportId(), rows: current });
    current = [];
    cells = 0;
    bytes = 2;
  };
  for (const row of rows) {
    const rowCells = Object.keys(row).length;
    const rowBytes = byteLength(JSON.stringify(row)) + 1;
    if (current.length && (current.length >= limits.rows || cells + rowCells > limits.cells || bytes + rowBytes > limits.bytes)) {
      flush();
    }
    current.push(row);
    cells += rowCells;
    bytes += rowBytes;
  }
  flush();
  return batches;
}

const SELECT_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899'];

const selectOptions = (file: CSVFileData, col: CSVColumnDefinition, useFirstRowAsHeaders: boolean) => {
  const unique = new Set<string>();
  const dataRows = useFirstRowAsHeaders ? file.data.slice(1) : file.data;
  dataRows.forEach(row => {
    (row[col.colIndex] || '').split(',').forEach(part => {
      const trimmed = part.trim();
      if (trimmed) unique.add(trimmed);
    });
  });
  return Array.from(unique).slice(0, 50).map((label, idx) => ({
    label,
    value: label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
    color: SELECT_COLORS[idx % SELECT_COLORS.length],
  }));
};

// Table creation request with the whole schema; property order is part of the
// backend digest, so the serialized string is what gets retried.
export function buildExcelCreateBody(
  file: CSVFileData,
  projectId: number,
  importId: string,
  useFirstRowAsHeaders: boolean,
  description: string,
): string {
  const columns = file.columnDefinitions
    .filter(col => !col.excluded && col.name !== 'id')
    .map(col => {
      const type = col.type === 'relation' ? 'text' : col.type;
      const config: Record<string, unknown> = {};
      if (type === 'select') config.options = selectOptions(file, col, useFirstRowAsHeaders);
      if (col.emoji) config.appearance = { indicator: { type: 'emoji', value: col.emoji } };
      return {
        name: col.name,
        displayName: col.displayName || col.name,
        type,
        isVisible: true,
        ...(Object.keys(config).length ? { config } : {}),
      };
    });
  return JSON.stringify({
    name: file.tableName,
    displayName: file.tableDisplayName,
    description,
    icon: file.icon || '\u{1F4CA}',
    projectId,
    columns,
    importId,
  });
}

export function freezeExcelImport(
  file: CSVFileData,
  projectId: number,
  useFirstRowAsHeaders: boolean,
  description: string,
): ExcelImportState {
  const excel = file.excel as ExcelFileState;
  const projection = buildExcelRows(file, useFirstRowAsHeaders);
  return {
    importId: excel.importId,
    createBody: buildExcelCreateBody(file, projectId, excel.importId, useFirstRowAsHeaders, description),
    batches: splitImportBatches(projection.rows),
    skippedEmptyRows: projection.skippedEmptyRows,
    excludedColumns: projection.excludedColumns,
    completedBatchIds: [],
    importedRows: 0,
    error: null,
  };
}

export const isExcelFileReady = (file: CSVFileData) =>
  file.source !== 'excel' ||
  (!!file.excel && !file.excel.loading && !file.excel.error && file.excel.sheetIndex !== null);

export const columnLetter = (colIndex: number) => {
  let n = colIndex + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

export const cellAddress = (rowIndex: number, colIndex: number) => `${columnLetter(colIndex)}${rowIndex + 1}`;
