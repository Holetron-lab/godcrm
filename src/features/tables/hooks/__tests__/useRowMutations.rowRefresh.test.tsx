import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { hasPendingCellUpdate, useRowMutations } from '../useRowMutations';
import { tablesApi } from '../../api/tablesApi';
import { useTablesStore } from '../../store/tablesStore';
import type { RowModel } from '../../types/table.types';

vi.mock('../../api/tablesApi', () => ({ tablesApi: { updateRow: vi.fn(), getRow: vi.fn() } }));

const TABLE = '7';
const ROW = '1';

function mount() {
  const client = new QueryClient();
  return renderHook(() => useRowMutations(TABLE), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children),
  });
}

const rowData = () => useTablesStore.getState().rows[TABLE][0].data;
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('useRowMutations — one cell saved, the whole row refreshed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(tablesApi.updateRow).mockReset().mockResolvedValue({});
    vi.mocked(tablesApi.getRow).mockReset();
    useTablesStore.getState().setRows(TABLE, [
      { id: ROW, tableId: TABLE, data: { status: 'todo', colour: 'none', note: '' }, createdAt: '', updatedAt: '', createdBy: '' } as RowModel,
    ]);
  });
  afterEach(() => { vi.useRealTimers(); });

  it('merges server-computed columns after the debounced save, keeping cells still being typed', async () => {
    // Server state after the save: an automation painted the row red; `note` on the server is stale.
    vi.mocked(tablesApi.getRow).mockResolvedValue({
      row: { id: 1, data: { status: 'done', colour: 'red', note: 'server-old' } },
      columns: [],
    });
    const { result } = mount();

    act(() => { result.current.mutate({ rowId: ROW, columnId: 'status', value: 'done', data: {} }); });
    expect(rowData().status).toBe('done'); // optimistic
    await tick(500);
    act(() => { result.current.mutate({ rowId: ROW, columnId: 'note', value: 'typing…', data: {} }); });
    await tick(500); // status debounce (1 s) elapsed, note still pending

    expect(tablesApi.updateRow).toHaveBeenCalledTimes(1);
    expect(tablesApi.updateRow).toHaveBeenCalledWith(TABLE, ROW, { status: 'done' });
    expect(tablesApi.getRow).toHaveBeenCalledWith(TABLE, ROW, { includeRelations: true });
    expect(hasPendingCellUpdate(TABLE, ROW, 'note')).toBe(true);
    expect(rowData()).toEqual({ status: 'done', colour: 'red', note: 'typing…' });

    await tick(500); // note flushes too
    expect(tablesApi.updateRow).toHaveBeenCalledWith(TABLE, ROW, { note: 'typing…' });
    expect(hasPendingCellUpdate(TABLE, ROW, 'note')).toBe(false);
  });

  it('keeps the saved cell when the row refresh fails', async () => {
    vi.mocked(tablesApi.getRow).mockRejectedValue(new Error('offline'));
    const { result } = mount();
    act(() => { result.current.mutate({ rowId: ROW, columnId: 'status', value: 'done', data: {} }); });
    await tick(1000);
    expect(tablesApi.updateRow).toHaveBeenCalledTimes(1);
    expect(rowData().status).toBe('done');
    expect(useTablesStore.getState().error).toBeNull();
  });
});
