// ADR-207 W3.1 — regression for the live CSV path after the extraction to
// src/shared/column-mapping: upload → guessed column definitions → excluded
// column skipped → rows converted and sent to rows/import. CreateTableModal is
// the only mounted CSV import (ImportModal's CSV tab is a stub), so this hook
// pair is the behaviour that must not drift.
import { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useCsvHandlers } from '../useCsvHandlers';
import { useCsvCreate } from '../useCsvCreate';
import type { CSVFileData } from '../types';

const api = vi.hoisted(() => ({
  createTable: vi.fn(async () => ({ table: { id: '42' } })),
  createColumn: vi.fn(),
  importRows: vi.fn(),
  getRows: vi.fn(async () => ({ rows: [] })),
  getColumns: vi.fn(async () => ({ columns: [] })),
  updateColumn: vi.fn(),
}));
vi.mock('../../../api/tablesApi', () => ({ tablesApi: api }));
vi.mock('../../../api/excelImportApi', () => ({ excelImportApi: { preview: vi.fn() } }));
vi.mock('../../../hooks/useCreateTable', () => ({ useCreateTable: () => ({ isPending: false }) }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ refetchQueries: vi.fn() }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

const CSV = [
  'Name;Total;Active;Created At;Notes',
  'Alice;1 200,5;да;2026-09-28;first',
  'Bob;7;no;2026-09-29;',
  '"Cara; Jr";3;yes;2026-09-30;"quoted ""note"""',
].join('\n');

function useHarness() {
  const [csvFiles, setCsvFiles] = useState<CSVFileData[]>([]);
  const [, setIdx] = useState(0);
  const [, setStep] = useState<'upload' | 'configure' | 'creating'>('upload');
  const [, setBasic] = useState({ displayName: '', name: '', description: '', icon: '', color: '' });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const noop = () => {};
  const handlers = useCsvHandlers({
    csvFiles, setCsvFiles, currentCsvFileIndex: 0, setCurrentCsvFileIndex: setIdx, setCsvStep: setStep,
    setBasic, csvTabsRef: { current: null }, setCanScrollCsvTabsLeft: noop, setCanScrollCsvTabsRight: noop,
    setSelectedTabLeftHidden: noop, setSelectedTabRightHidden: noop, expandedColumns: expanded,
    setExpandedColumns: setExpanded, targetProjectId: 1,
  });
  const create = useCsvCreate({
    csvFiles, csvFilesBeforeNotionImport: null, targetProjectId: 1, useFirstRowAsHeaders: true,
    setCsvCreating: noop, setCsvStep: setStep, setCsvFiles, resetState: noop, onOpenChange: noop,
    tableType: 'csv', basic: { displayName: 'People', name: 'people', description: '', icon: '', color: '' },
    derivedName: 'people', hierarchy: { mode: 'flat' }, columns: [], selectedDataSource: '',
    selectedExternalTable: '', selectedRelatedTables: [], showInMenu: false, menuWidgetTitle: '',
    menuWidgetIcon: '', menuWidgetDescription: '', slugify: v => v,
  });
  return { csvFiles, handlers, create };
}

it('uploads a CSV, guesses types from the shared module, skips an excluded column and imports converted rows', async () => {
  const { result } = renderHook(() => useHarness());

  const file = new File([CSV], 'people.csv', { type: 'text/csv' });
  const input = document.createElement('input');
  input.type = 'file';
  // jsdom has no DataTransfer; a FileList-like object is enough for Array.from(target.files).
  Object.defineProperty(input, 'files', { value: { 0: file, length: 1, item: () => file }, configurable: true });
  act(() => {
    result.current.handlers.handleCsvFileUpload({ target: input } as unknown as React.ChangeEvent<HTMLInputElement>);
  });

  await waitFor(() => expect(result.current.csvFiles).toHaveLength(1));
  const parsed = result.current.csvFiles[0];
  // Semicolon delimiter detected; quoted cell with embedded delimiter preserved.
  expect(parsed.headers).toEqual(['Name', 'Total', 'Active', 'Created At', 'Notes']);
  expect(parsed.data[3][0]).toBe('Cara; Jr');
  expect(parsed.data[3][4]).toBe('quoted "note"');
  // Type guesses come from src/shared/column-mapping guessColumnType.
  expect(parsed.columnDefinitions.map(d => [d.csvColumn, d.type])).toEqual([
    ['Name', 'text'],
    ['Total', 'number'],
    ['Active', 'checkbox'],
    ['Created At', 'datetime'],
    ['Notes', 'text'],
  ]);

  // Preview contract used by CsvConfigureSection: 5 rows max of the data body.
  expect(parsed.data.slice(1).slice(0, 5)).toHaveLength(3);

  // User skips the Notes column (CsvConfigureSection → updateCsvColumn(colIndex, 'excluded', true)).
  act(() => {
    result.current.handlers.updateCsvColumn(4, 'excluded', true);
  });
  await waitFor(() => expect(result.current.csvFiles[0].columnDefinitions[4].excluded).toBe(true));

  await act(async () => {
    await result.current.create.handleCsvCreate();
  });

  // Excluded column is neither created nor imported.
  // Column names are the slugged headers (buildColumnDefinitions + toSlug).
  const createdColumnNames = api.createColumn.mock.calls.map(call => (call[1] as { name: string }).name);
  expect(createdColumnNames).toEqual(['name', 'total', 'active', 'created_at']);

  expect(api.importRows).toHaveBeenCalledTimes(1);
  const payload = api.importRows.mock.calls[0][1] as { rows: Record<string, unknown>[]; mode: string };
  expect(payload.mode).toBe('add');
  expect(payload.rows).toEqual([
    { name: 'Alice', total: 1200.5, active: true, created_at: new Date('2026-09-28').toISOString() },
    { name: 'Bob', total: 7, active: false, created_at: new Date('2026-09-29').toISOString() },
    { name: 'Cara; Jr', total: 3, active: true, created_at: new Date('2026-09-30').toISOString() },
  ]);
});
