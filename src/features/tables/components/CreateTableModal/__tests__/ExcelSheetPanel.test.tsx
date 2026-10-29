import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExcelSheetPanel, groupWarnings } from '../ExcelSheetPanel';
import { createExcelFileEntry } from '../excel-utils';
import type { CSVFileData } from '../types';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

const file = (patch: Partial<NonNullable<CSVFileData['excel']>> = {}, extra: Partial<CSVFileData> = {}): CSVFileData => {
  const entry = createExcelFileEntry(new File(['x'], 'отчёт.xlsx'), 0);
  return {
    ...entry,
    ...extra,
    excel: {
      ...entry.excel!,
      format: 'xlsx',
      loading: false,
      sheets: [
        { index: 0, name: 'Январь', rowCount: 10, columnCount: 3, hidden: false },
        { index: 1, name: 'Скрытый', rowCount: 2, columnCount: 1, hidden: true },
      ],
      ...patch,
    },
  };
};

describe('ExcelSheetPanel', () => {
  it('lists sheets, marks hidden ones and reports the chosen index', () => {
    const onSelectSheet = vi.fn();
    const entry = file();
    render(<ExcelSheetPanel file={entry} onSelectSheet={onSelectSheet} onRetryPreview={vi.fn()} t={t} />);

    const select = screen.getByLabelText('tables.create.excel.sheet') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(screen.getByText(/Скрытый/)).toHaveTextContent('tables.create.excel.hidden');
    fireEvent.change(select, { target: { value: '1' } });
    expect(onSelectSheet).toHaveBeenCalledWith(entry.id, 1);
    expect(screen.getByText('tables.create.excel.otherSheets')).toBeInTheDocument();
  });

  it('shows the busy state and disables the selector while loading', () => {
    render(<ExcelSheetPanel file={file({ loading: true })} onSelectSheet={vi.fn()} onRetryPreview={vi.fn()} t={t} />);
    expect(screen.getByRole('status')).toHaveTextContent('tables.create.excel.loading');
    expect(screen.getByLabelText('tables.create.excel.sheet')).toBeDisabled();
  });

  it('groups cell warnings and never hides the unverified formula cache notice', () => {
    const entry = file({
      sheetIndex: 0,
      emptyRowCount: 1,
      skippedCellCount: 2,
      warnings: [
        { code: 'OBJECTS_IGNORED', message: 'Изображения не импортируются.' },
        { code: 'FORMULA_CACHE_MISSING', message: 'Нет кеша', sheetIndex: 0, rowIndex: 1, colIndex: 0 },
        { code: 'FORMULA_CACHE_MISSING', message: 'Нет кеша', sheetIndex: 0, rowIndex: 2, colIndex: 1 },
        { code: 'FORMULA_CACHE_UNVERIFIED', message: 'Нулевой кеш', sheetIndex: 0, rowIndex: 3, colIndex: 2 },
      ],
    }, { data: [['a'], ['b'], ['c']] });
    render(<ExcelSheetPanel file={entry} onSelectSheet={vi.fn()} onRetryPreview={vi.fn()} t={t} />);

    expect(screen.getByText('Изображения не импортируются.')).toBeInTheDocument();
    expect(screen.getByText(/Нет кеша/)).toHaveTextContent('A2, B3');
    const unverified = document.querySelector('[data-warning-code="FORMULA_CACHE_UNVERIFIED"]');
    expect(unverified).toHaveTextContent('Нулевой кеш');
    expect(unverified).toHaveTextContent('C4');
    expect(screen.getByText(/sheetStats/)).toHaveTextContent('"rows":2,"empty":1,"skipped":2');
    expect(groupWarnings(entry.excel!.warnings).cells.map(g => [g.code, g.count])).toEqual([['FORMULA_CACHE_MISSING', 2], ['FORMULA_CACHE_UNVERIFIED', 1]]);
  });

  it('shows preview errors with a retry action', () => {
    const onRetryPreview = vi.fn();
    const entry = file({ error: 'Содержимое файла не соответствует формату .xlsx.' });
    render(<ExcelSheetPanel file={entry} onSelectSheet={vi.fn()} onRetryPreview={onRetryPreview} t={t} />);
    expect(screen.getByRole('alert')).toHaveTextContent('не соответствует формату');
    fireEvent.click(screen.getByText('tables.create.excel.retry'));
    expect(onRetryPreview).toHaveBeenCalledWith(entry.id);
  });

  it('explains a failed import and that retry keeps the created table', () => {
    const entry = file({
      sheetIndex: 0,
      importState: {
        importId: 'k', createBody: '{}', batches: [], skippedEmptyRows: 0, excludedColumns: 0,
        tableId: 77, completedBatchIds: [], importedRows: 0, error: 'Строка 2: значение не соответствует типу колонки qty.',
      },
    });
    render(<ExcelSheetPanel file={entry} onSelectSheet={vi.fn()} onRetryPreview={vi.fn()} t={t} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('importFailed');
    expect(alert).toHaveTextContent('retryKeepsTable {"tableId":77}');
  });
});
