import { useRef, useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCsvHandlers } from '../useCsvHandlers';
import type { CSVFileData, ExcelPreviewResponse } from '../types';

const preview = vi.hoisted(() => vi.fn());
vi.mock('../../../api/excelImportApi', () => ({ excelImportApi: { preview } }));

const sheets = [
  { index: 0, name: 'Январь', rowCount: 3, columnCount: 2, hidden: false },
  { index: 1, name: 'Февраль', rowCount: 2, columnCount: 2, hidden: false },
];
const sheetData = (index: number): ExcelPreviewResponse => ({
  format: 'xlsx',
  sheets,
  sheet: {
    ...sheets[index],
    rows: [['Имя', 'Сумма'], ['Иван', '10'], ['Пётр', '20']].slice(0, sheets[index].rowCount),
    values: [['Имя', 'Сумма'], ['Иван', 10], ['Пётр', 20]].slice(0, sheets[index].rowCount),
    emptyRowCount: 0,
    skippedCellCount: 0,
  },
  warnings: [{ code: 'OBJECTS_IGNORED', message: 'no images' }],
  limits: {},
});
const listOnly = (list = sheets): ExcelPreviewResponse => ({ format: 'xlsx', sheets: list, sheet: null, warnings: [], limits: {} });

const useHarness = (projectId: number | null = 5) => {
  const [csvFiles, setCsvFiles] = useState<CSVFileData[]>([]);
  const [currentCsvFileIndex, setCurrentCsvFileIndex] = useState(0);
  const [csvStep, setCsvStep] = useState<'upload' | 'configure' | 'creating'>('upload');
  const [expandedColumns, setExpandedColumns] = useState<Set<number>>(new Set());
  const csvTabsRef = useRef<HTMLDivElement>(null);
  const handlers = useCsvHandlers({
    csvFiles, setCsvFiles, currentCsvFileIndex, setCurrentCsvFileIndex, setCsvStep,
    setBasic: vi.fn(), csvTabsRef,
    setCanScrollCsvTabsLeft: vi.fn(), setCanScrollCsvTabsRight: vi.fn(),
    setSelectedTabLeftHidden: vi.fn(), setSelectedTabRightHidden: vi.fn(),
    expandedColumns, setExpandedColumns,
    targetProjectId: projectId, noProjectMessage: 'pick a project',
  });
  return { csvFiles, csvStep, handlers };
};

const upload = (files: File[]) => ({ target: { files } } as unknown as React.ChangeEvent<HTMLInputElement>);

beforeEach(() => preview.mockReset());

describe('useCsvHandlers with Excel workbooks', () => {
  it('auto-loads the only sheet of a single-sheet workbook', async () => {
    preview.mockResolvedValueOnce(listOnly([sheets[0]])).mockResolvedValueOnce(sheetData(0));
    const { result } = renderHook(() => useHarness());

    act(() => { result.current.handlers.handleCsvFileUpload(upload([new File(['x'], 'отчёт.xlsx')])); });

    expect(result.current.csvStep).toBe('configure');
    expect(result.current.csvFiles[0].source).toBe('excel');
    expect(result.current.csvFiles[0].excel?.loading).toBe(true);
    await waitFor(() => expect(result.current.csvFiles[0].excel?.sheetIndex).toBe(0));
    expect(preview).toHaveBeenCalledTimes(2);
    expect(preview.mock.calls[0].slice(0, 3)).toEqual([5, expect.any(File), undefined]);
    expect(preview.mock.calls[1].slice(0, 3)).toEqual([5, expect.any(File), 0]);
    const file = result.current.csvFiles[0];
    expect(file.headers).toEqual(['Имя', 'Сумма']);
    expect(file.columnDefinitions.map(d => d.type)).toEqual(['text', 'number']);
    expect(file.excel?.warnings[0].code).toBe('OBJECTS_IGNORED');
    expect(file.tableDisplayName).toBe('отчёт');
  });

  it('waits for the user to choose a sheet in a multi-sheet workbook and reloads on selection', async () => {
    preview.mockResolvedValueOnce(listOnly()).mockResolvedValueOnce(sheetData(1));
    const { result } = renderHook(() => useHarness());

    act(() => { result.current.handlers.handleCsvFileUpload(upload([new File(['x'], 'book.xls')])); });
    await waitFor(() => expect(result.current.csvFiles[0].excel?.loading).toBe(false));
    expect(result.current.csvFiles[0].excel?.sheetIndex).toBeNull();
    expect(result.current.csvFiles[0].excel?.sheets).toHaveLength(2);
    expect(result.current.csvFiles[0].data).toEqual([]);
    const keyBefore = result.current.csvFiles[0].excel?.importId;

    act(() => { result.current.handlers.selectExcelSheet(result.current.csvFiles[0].id, 1); });
    await waitFor(() => expect(result.current.csvFiles[0].excel?.sheetIndex).toBe(1));
    expect(preview.mock.calls[1][2]).toBe(1);
    expect(result.current.csvFiles[0].data).toHaveLength(2);
    expect(result.current.csvFiles[0].excel?.importId).not.toBe(keyBefore);
  });

  it('cancels a stale preview when another sheet is chosen before it answers', async () => {
    preview.mockResolvedValueOnce(listOnly());
    const { result } = renderHook(() => useHarness());
    act(() => { result.current.handlers.handleCsvFileUpload(upload([new File(['x'], 'book.xlsx')])); });
    await waitFor(() => expect(result.current.csvFiles[0].excel?.loading).toBe(false));

    let abortedFirst = false;
    preview.mockImplementationOnce((_p, _f, _i, signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => { abortedFirst = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    }));
    preview.mockResolvedValueOnce(sheetData(1));
    const id = result.current.csvFiles[0].id;
    act(() => { result.current.handlers.selectExcelSheet(id, 0); });
    act(() => { result.current.handlers.selectExcelSheet(id, 1); });

    await waitFor(() => expect(result.current.csvFiles[0].excel?.sheetIndex).toBe(1));
    expect(abortedFirst).toBe(true);
    expect(result.current.csvFiles[0].excel?.error).toBeNull();
  });

  it('surfaces preview errors and lets the user retry', async () => {
    preview.mockRejectedValueOnce(new Error('Защищённые паролем книги не поддерживаются.'));
    const { result } = renderHook(() => useHarness());
    act(() => { result.current.handlers.handleCsvFileUpload(upload([new File(['x'], 'locked.xlsx')])); });
    await waitFor(() => expect(result.current.csvFiles[0].excel?.error).toMatch(/паролем/));
    expect(result.current.csvFiles[0].excel?.loading).toBe(false);

    preview.mockResolvedValueOnce(listOnly([sheets[0]])).mockResolvedValueOnce(sheetData(0));
    act(() => { result.current.handlers.retryExcelPreview(result.current.csvFiles[0].id); });
    await waitFor(() => expect(result.current.csvFiles[0].excel?.sheetIndex).toBe(0));
    expect(result.current.csvFiles[0].excel?.error).toBeNull();
  });

  it('does not call the server without a project', async () => {
    const { result } = renderHook(() => useHarness(null));
    act(() => { result.current.handlers.handleCsvFileUpload(upload([new File(['x'], 'book.xlsx')])); });
    await waitFor(() => expect(result.current.csvFiles[0].excel?.error).toBe('pick a project'));
    expect(preview).not.toHaveBeenCalled();
  });

  it('still parses CSV files alongside workbooks', async () => {
    preview.mockResolvedValueOnce(listOnly([sheets[0]])).mockResolvedValueOnce(sheetData(0));
    const { result } = renderHook(() => useHarness());
    const csv = new File(['a;b\n1;2\n'], 'plain.csv', { type: 'text/csv' });
    act(() => { result.current.handlers.handleCsvFileUpload(upload([csv, new File(['x'], 'book.xlsx')])); });
    await waitFor(() => expect(result.current.csvFiles).toHaveLength(2));
    expect(result.current.csvFiles[0].source).toBe('csv');
    expect(result.current.csvFiles[0].headers).toEqual(['a', 'b']);
    expect(result.current.csvFiles[0].columnDefinitions[0].colIndex).toBe(0);
    expect(result.current.csvFiles[1].source).toBe('excel');
    await waitFor(() => expect(result.current.csvFiles[1].excel?.sheetIndex).toBe(0));
  });
});
