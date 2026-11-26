import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { apiClient } from '@/shared/utils/apiClient';
import type { Widget } from '../types/widget.types';
import { useTicketData } from './useTicketData';

vi.mock('@/features/tables/api/tablesApi', () => ({ tablesApi: { getColumns: vi.fn() } }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn() } }));

afterEach(() => { vi.resetAllMocks(); });

it('loads kanban lanes for a module-installed relation without an enabled flag', async () => {
  const columns = [{
    id: 'state', tableId: '101330', name: 'state', displayName: 'State', type: 'relation',
    config: { relation: { tableId: 101327 } }, orderIndex: 0, width: 160,
    isVisible: true, isRequired: false, isReadonly: false,
  }] as unknown as ColumnModel[];
  const stateRows = ['backlog', 'assigned', 'in progress', 'review', 'control', 'on hold', 'done', 'rejected']
    .map((name, index) => ({ id: String(index + 1), data: { name, order: index + 1 } }));
  const widget = {
    id: 4430,
    preset_name: 'kanban_board',
    config: { table_id: 101330, group_by_column: 'state', kanban: { eventsTableId: 101331 } },
  } as unknown as Widget;

  vi.mocked(tablesApi.getColumns).mockResolvedValue({ columns } as never);
  vi.mocked(apiClient.request).mockImplementation(async (url) => {
    if (url === '/tables/101330/rows?limit=500&mode=raw') return { data: { rows: [] } } as never;
    if (url === '/tables/101330') return { data: { config: {} } } as never;
    if (url === '/tables/101327/rows?limit=5000&mode=raw') return { data: { rows: stateRows } } as never;
    throw new Error(`Unexpected request: ${url}`);
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, unmount } = renderHook(() => useTicketData({ widgetId: 4430, widget }), { wrapper });
  try {
    await waitFor(() => expect(result.current.kanbanColumnOptions).toHaveLength(8));
    expect(result.current.relationTableId).toBe(101327);
    expect(result.current.kanbanColumnOptions.map((option) => option.label)).toEqual(stateRows.map((row) => row.data.name));
  } finally {
    unmount();
    client.clear();
  }
});

it('keeps empty column inputs stable and updates derived columns when the cache changes', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, rerender, unmount } = renderHook(
    () => useTicketData({ widgetId: 0, tableId: 42, enabled: false }),
    { wrapper },
  );
  try {
    const empty = result.current.tableColumns;
    const emptyInfo = result.current.columnsInfo;
    expect(empty).toEqual([]);
    rerender();
    expect(result.current.tableColumns).toBe(empty);
    expect(result.current.columnsInfo).toBe(emptyInfo);

    const columns: ColumnModel[] = [{
      id: '1', tableId: '42', name: 'title', displayName: 'Title', type: 'text', config: {},
      orderIndex: 0, width: 160, isVisible: true, isRequired: false, isReadonly: false,
    }];
    act(() => { client.setQueryData(['table-columns', 42], columns); });
    await waitFor(() => expect(result.current.tableColumns).toEqual(columns));
    expect(result.current.columnsInfo).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'title' })]));
    const loaded = result.current.tableColumns;
    rerender();
    expect(result.current.tableColumns).toBe(loaded);

    act(() => { client.setQueryData(['table-columns', 42], []); });
    await waitFor(() => expect(result.current.tableColumns).toEqual([]));
    expect(result.current.columnsInfo).toEqual([]);
  } finally {
    unmount();
    client.clear();
  }
});
