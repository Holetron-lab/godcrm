import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parseRowChangeEvent, useTableRowsLiveSync } from '../useTableRowsLiveSync';
import { tablesApi } from '../../api/tablesApi';
import { useTablesStore } from '../../store/tablesStore';
import type { RowModel } from '../../types/table.types';

vi.mock('../../api/tablesApi', () => ({ tablesApi: { getRow: vi.fn() } }));
vi.mock('@/shared/utils/apiClient', () => ({
  getAccessToken: () => 'jwt-token',
  getBaseUrlSync: () => '/api/v3',
}));

type Listener = (event: { data: string }) => void;

/** Minimal EventSource double: records the URL, lets a test push server events. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Listener[]>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, payload: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(payload) });
  }
  close() { this.closed = true; }
}

const TABLE = '7';
const row = (id: string, data: Record<string, unknown>): RowModel =>
  ({ id, tableId: TABLE, data, createdAt: '', updatedAt: '', createdBy: '' });

function mount(tableId: string | null = TABLE, enabled = true) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined);
  const hook = renderHook(() => useTableRowsLiveSync(tableId, enabled), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children),
  });
  return { ...hook, invalidate, source: FakeEventSource.instances.at(-1) };
}

const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(200); }); };

describe('useTableRowsLiveSync — grid follows writes made elsewhere', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.mocked(tablesApi.getRow).mockReset();
    useTablesStore.getState().setRows(TABLE, [row('1', { status: 'todo', colour: 'none' }), row('2', { status: 'todo' })]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('opens the table stream with the session token', () => {
    const { source, unmount } = mount();
    expect(source?.url).toBe('/api/v3/tables/7/events?token=jwt-token');
    unmount();
    expect(source?.closed).toBe(true);
  });

  it('does not open a stream when disabled or without a table', () => {
    mount(TABLE, false);
    mount(null);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('merges an updated row into the store — the automation result shows without reload', async () => {
    vi.mocked(tablesApi.getRow).mockResolvedValue({
      row: { id: 1, data: { status: 'done', colour: 'red' } },
      columns: [{ id: 10, column_name: 'status' }, { id: 11, column_name: 'colour' }],
    });
    const { source, invalidate } = mount();

    source?.emit('row.updated', { table_id: 7, row_id: '1', action: 'updated', source: 'automation', ts: 't' });
    source?.emit('row.updated', { table_id: 7, row_id: '1', action: 'updated', source: 'api', ts: 't' });
    await flush();

    // Two events in one burst → one fetch.
    expect(tablesApi.getRow).toHaveBeenCalledTimes(1);
    expect(tablesApi.getRow).toHaveBeenCalledWith(TABLE, '1', { includeRelations: true });
    expect(useTablesStore.getState().rows[TABLE][0].data).toEqual({ status: 'done', colour: 'red' });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('maps legacy numeric column keys to column names like the list endpoint', async () => {
    vi.mocked(tablesApi.getRow).mockResolvedValue({
      row: { id: 1, data: { 10: 'done', 11: 'red' } },
      columns: [{ id: 10, column_name: 'status' }, { id: 11, column_name: 'colour' }],
    });
    const { source } = mount();
    source?.emit('row.updated', { table_id: 7, row_id: '1', action: 'updated', source: 'agent', ts: 't' });
    await flush();
    expect(useTablesStore.getState().rows[TABLE][0].data).toEqual({ status: 'done', colour: 'red' });
  });

  it('ignores rows that are not loaded and events for other tables', async () => {
    const { source } = mount();
    source?.emit('row.updated', { table_id: 7, row_id: '999', action: 'updated', source: 'api', ts: 't' });
    source?.emit('row.updated', { table_id: 8, row_id: '1', action: 'updated', source: 'api', ts: 't' });
    source?.emit('row.updated', 'not json');
    await flush();
    expect(tablesApi.getRow).not.toHaveBeenCalled();
  });

  it('refetches the page on create/delete instead of fetching rows one by one', async () => {
    const { source, invalidate } = mount();
    source?.emit('row.updated', { table_id: 7, row_id: '1', action: 'updated', source: 'api', ts: 't' });
    source?.emit('row.created', { table_id: 7, row_id: '3', action: 'created', source: 'api', ts: 't' });
    await flush();
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rows', TABLE] });
    expect(tablesApi.getRow).not.toHaveBeenCalled();
  });
});

describe('parseRowChangeEvent', () => {
  it('accepts the server envelope and rejects anything else', () => {
    expect(parseRowChangeEvent('{"table_id":7,"row_id":1,"action":"deleted","source":"api","ts":"t"}'))
      .toEqual({ table_id: 7, row_id: '1', action: 'deleted', source: 'api', ts: 't' });
    expect(parseRowChangeEvent('{"table_id":"7","row_id":1,"action":"updated"}')).toBeNull();
    expect(parseRowChangeEvent('{"table_id":7,"row_id":1,"action":"exploded"}')).toBeNull();
    expect(parseRowChangeEvent('{')).toBeNull();
    expect(parseRowChangeEvent(null)).toBeNull();
  });
});
