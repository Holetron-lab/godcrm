import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runExcelImport } from '../excel-import';
import { applyExcelPreview, createExcelFileEntry } from '../excel-utils';
import type { CSVFileData, ExcelImportState } from '../types';

const api = vi.hoisted(() => ({ request: vi.fn(), importRows: vi.fn() }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: api.request }, getBaseUrlSync: () => '/api/v3' }));
vi.mock('../../../api/tablesApi', () => ({ tablesApi: { importRows: api.importRows } }));

const toSlug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_');

const entry = (): CSVFileData => applyExcelPreview(createExcelFileEntry(new File(['x'], 'orders.xlsx'), 0), {
  format: 'xlsx',
  sheets: [{ index: 0, name: 'S', rowCount: 3, columnCount: 2, hidden: false }],
  sheet: {
    index: 0, name: 'S', rowCount: 3, columnCount: 2, hidden: false,
    rows: [['qty', 'name'], ['1', 'a'], ['2', 'b']],
    values: [['qty', 'name'], [1, 'a'], [2, 'b']],
    emptyRowCount: 0, skippedCellCount: 0,
  },
  warnings: [],
  limits: {},
}, toSlug);

const options = (persist = vi.fn()) => ({ projectId: 7, useFirstRowAsHeaders: true, description: 'from orders.xlsx', persist });

beforeEach(() => {
  api.request.mockReset();
  api.importRows.mockReset();
});

describe('runExcelImport', () => {
  it('creates the table with the full schema and imports rows under the importId contract', async () => {
    api.request.mockResolvedValue({ data: { table: { id: '55' } } });
    api.importRows.mockResolvedValue({ stats: { added: 2, updated: 0, skipped: 0, errors: [] }, imported: 2, replayed: false });
    const file = entry();
    const persist = vi.fn();

    const result = await runExcelImport(file, options(persist));

    expect(api.request).toHaveBeenCalledTimes(1);
    const [path, init] = api.request.mock.calls[0];
    expect(path).toBe('/tables');
    const body = JSON.parse(init.body);
    expect(body.importId).toBe(file.excel?.importId);
    expect(body.projectId).toBe(7);
    expect(body.columns.map((c: { name: string; type: string }) => [c.name, c.type])).toEqual([['qty', 'number'], ['name', 'text']]);

    expect(api.importRows).toHaveBeenCalledWith('55', { importId: expect.any(String), mode: 'add', rows: [{ qty: 1, name: 'a' }, { qty: 2, name: 'b' }] });
    expect(api.importRows.mock.calls[0][1]).not.toHaveProperty('idMapping');
    expect(result.tableId).toBe(55);
    expect(result.state.importedRows).toBe(2);
    expect(result.replayed).toBe(false);
    expect(persist).toHaveBeenLastCalledWith(expect.objectContaining({ tableId: 55, completedBatchIds: [result.state.batches[0].importId] }));
  });

  it('retries from the frozen state without creating a second table or key', async () => {
    api.request.mockResolvedValue({ data: { table: { id: 55 } } });
    api.importRows.mockRejectedValueOnce(new Error('network down'));
    const file = entry();
    let saved: ExcelImportState | undefined;
    const persist = vi.fn((state: ExcelImportState) => { saved = state; });

    await expect(runExcelImport(file, options(persist))).rejects.toThrow('network down');
    expect(saved?.tableId).toBe(55);
    expect(saved?.error).toBe('network down');
    expect(saved?.completedBatchIds).toEqual([]);

    api.importRows.mockResolvedValueOnce({ stats: { added: 0, updated: 0, skipped: 0, errors: [] }, imported: 2, replayed: true });
    const retried = { ...file, excel: { ...file.excel!, importState: saved } };
    const result = await runExcelImport(retried, options(persist));

    expect(api.request).toHaveBeenCalledTimes(1);
    expect(api.importRows).toHaveBeenCalledTimes(2);
    expect(api.importRows.mock.calls[1][1].importId).toBe(api.importRows.mock.calls[0][1].importId);
    expect(api.importRows.mock.calls[1][1].rows).toEqual(api.importRows.mock.calls[0][1].rows);
    expect(result.replayed).toBe(true);
    expect(result.state.importedRows).toBe(2);
    expect(result.state.error).toBeNull();
  });

  it('keeps the error and no table id when creation itself fails', async () => {
    api.request.mockRejectedValue(new Error('403 forbidden'));
    const persist = vi.fn();
    await expect(runExcelImport(entry(), options(persist))).rejects.toThrow('403 forbidden');
    expect(api.importRows).not.toHaveBeenCalled();
    const last = persist.mock.calls.at(-1)?.[0] as ExcelImportState;
    expect(last.error).toBe('403 forbidden');
    expect(last.tableId).toBeUndefined();
  });

  it('refuses to run before a sheet is chosen', async () => {
    const file = createExcelFileEntry(new File(['x'], 'orders.xlsx'), 0);
    await expect(runExcelImport(file, options())).rejects.toThrow(/not selected/);
    expect(api.request).not.toHaveBeenCalled();
  });
});
