import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBulkReplace } from '../useBulkReplace';
import { tablesApi } from '../../api/tablesApi';
import type { RowModel, ColumnModel } from '../../types/table.types';
import type { BulkReplaceConfig, BulkReplaceResult } from '../../types/selection.types';

vi.mock('../../api/tablesApi', () => ({ tablesApi: {
  getRows: vi.fn(),
  batchUpdateRows: vi.fn(async (_table: string, updates: unknown[]) => ({ success: true, updated: updates.length }))
} }));
vi.mock('../../store/tablesStore', () => ({
  useTablesStore: (select: (s: { updateCell: () => void }) => unknown) => select({ updateCell: vi.fn() })
}));
vi.mock('@/shared/hooks/useToast', () => ({ showToast: vi.fn() }));

// Ticket 22477: a 441-row table of which the view has loaded 300.
const TABLE_SIZE = 441;
const fullRows = Array.from({ length: TABLE_SIZE }, (_, i) => ({
  id: String(i + 1), tableId: '100986', data: { category_id: 'old' }
})) as unknown as RowModel[];
const columns = [{ id: 'category', name: 'category_id', type: 'text' }] as ColumnModel[];
const config: BulkReplaceConfig = {
  targetScope: 'all', columnId: 'category', operationType: 'replace', findValue: 'old', replaceValue: 'new'
};

/** Server answers page by page; `pageSize` lets a test force several pages. */
function mockServer(pageSize: number) {
  const pages = Math.ceil(TABLE_SIZE / pageSize);
  vi.mocked(tablesApi.getRows).mockImplementation(async (_table, page = 1) => ({
    rows: fullRows.slice((page - 1) * pageSize, page * pageSize),
    pagination: { page, limit: pageSize, total: TABLE_SIZE, pages }
  }));
}

function mount(rows: RowModel[], selected = new Set<string | number>()) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return renderHook(() => useBulkReplace({
    tableId: '100986', columns, rows, selectedRowIds: selected, filteredRowIds: rows.map(r => r.id)
  }), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  });
}

async function run(result: { current: ReturnType<typeof useBulkReplace> }, cfg: BulkReplaceConfig) {
  let outcome!: BulkReplaceResult;
  await act(async () => { outcome = await result.current.executeBulkReplace(cfg); });
  return outcome;
}

describe('useBulkReplace — "all rows" scope covers the whole table (22477)', () => {
  beforeEach(() => {
    vi.mocked(tablesApi.getRows).mockReset();
    vi.mocked(tablesApi.batchUpdateRows).mockClear();
    mockServer(1000);
  });

  it('updates all 441 matching rows when only 300 are loaded', async () => {
    const { result } = mount(fullRows.slice(0, 300));
    const outcome = await run(result, config);
    expect(outcome.totalChanged).toBe(441);
    expect(outcome.totalProcessed).toBe(441);
  });

  it('does not let the active filter narrow all-row replacement', async () => {
    const { result } = mount(fullRows.slice(0, 1));
    expect((await run(result, config)).totalChanged).toBe(441);
  });

  it('reads every server page, including rows the view never loaded', async () => {
    mockServer(200); // 3 pages: 200 + 200 + 41
    const { result } = mount(fullRows.slice(400, 441)); // view sits on the last page
    const outcome = await run(result, config);
    expect(outcome.totalChanged).toBe(441);
    expect(vi.mocked(tablesApi.getRows)).toHaveBeenCalledTimes(3);
    const sent = vi.mocked(tablesApi.batchUpdateRows).mock.calls[0][1];
    expect(sent.map(u => u.rowId)).toEqual(fullRows.map(r => r.id));
  });

  it('keeps selected scope restricted to selected rows', async () => {
    const { result } = mount(fullRows, new Set(['2']));
    expect((await run(result, { ...config, targetScope: 'selected' })).totalChanged).toBe(1);
    expect(tablesApi.getRows).not.toHaveBeenCalled();
  });

  it('keeps filtered scope restricted to the filtered rows', async () => {
    const { result } = mount(fullRows.slice(0, 5));
    expect((await run(result, { ...config, targetScope: 'filtered' })).totalChanged).toBe(5);
    expect(tablesApi.getRows).not.toHaveBeenCalled();
  });

  it('prefers the injected fetchAllRows loader', async () => {
    const fetchAllRows = vi.fn(async () => fullRows.slice(0, 7));
    const client = new QueryClient();
    const { result } = renderHook(() => useBulkReplace({
      tableId: '100986', columns, rows: [], selectedRowIds: new Set(), filteredRowIds: [], fetchAllRows
    }), { wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children) });
    expect((await run(result, config)).totalChanged).toBe(7);
    expect(fetchAllRows).toHaveBeenCalledOnce();
    expect(tablesApi.getRows).not.toHaveBeenCalled();
  });
});
