import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { useTicketData } from './useTicketData';

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
