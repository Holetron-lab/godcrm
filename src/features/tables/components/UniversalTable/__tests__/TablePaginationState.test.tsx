import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ColumnModel, RowModel, TableModel } from '../../../types/table.types';
import { useTablesStore } from '../../../store/tablesStore';
import { useUniversalTableState } from '../useUniversalTableState';
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/ai-chat/context/AIChatContext', () => ({ useAIChat: () => ({ openTaskChat: vi.fn() }) }));
const table: TableModel = {
  id: 'test-table',
  userId: 'u1',
  name: 'test',
  displayName: 'Test Table',
  type: 'system',
  isVisible: true,
  config: {
    defaultView: 'table',
    views: [{ id: 'table', name: 'Table', type: 'table', filters: [], sorts: [], visibleColumns: ['col-name'] }],
    permissions: {}
  },
  createdAt: '',
  updatedAt: ''
};

const column: ColumnModel = {
  id: 'col-name',
  tableId: table.id,
  name: 'name',
  displayName: 'Name',
  type: 'text',
  config: {},
  isRequired: false,
  isReadonly: false,
  orderIndex: 0,
  width: 180,
  isVisible: true,
  formula: undefined,
  mapping: undefined,
  defaultValue: undefined,
  createdAt: '',
  updatedAt: ''
};

const row: RowModel = {
  id: 'row-1',
  tableId: table.id,
  data: { 'col-name': 'Sample Row' },
  createdAt: '',
  updatedAt: '',
  createdBy: 'tester'
};


beforeEach(() => useTablesStore.setState({ tables: [table], columns: { [table.id]: [column] }, rows: { [table.id]: [row] }, activeTableId: table.id, totalPages: { [table.id]: 2 }, totalRows: { [table.id]: 2 }, currentPage: 1, loadingMore: false }));
function setup(client = new QueryClient(), searchQuery = '') {
 return renderHook(() => useUniversalTableState({ searchQuery }), { wrapper: ({children}: {children: ReactNode}) => <MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter> });
}
it('counts unfiltered loaded rows when deciding how many remain', () => {
 const { result } = setup(new QueryClient(), 'no matching rows');
 expect(result.current.rows).toHaveLength(0);
 expect(result.current.rowsBelow).toBe(1);
 act(() => useTablesStore.setState({ totalRows: { [table.id]: 1 }, totalPages: { [table.id]: 1 } }));
 expect(result.current.canLoadMore).toBe(false);
});
it('does not advance a page while its query is fetching', () => {
 const client = new QueryClient();
 const query = client.getQueryCache().build(client, { queryKey: ['rows', table.id, 1] });
 query.setState({ fetchStatus: 'fetching' });
 const { result } = setup(client);
 act(() => result.current.handleLoadMore());
 expect(useTablesStore.getState().currentPage).toBe(1);
});
it('retries the failed last page instead of hiding recovery or skipping it', () => {
 useTablesStore.setState({ currentPage: 2 });
 const client = new QueryClient();
 const query = client.getQueryCache().build(client, { queryKey: ['rows', table.id, 2] });
 query.setState({ status: 'error', error: new Error('offline') });
 const retry = vi.spyOn(client, 'refetchQueries').mockResolvedValue();
 const { result } = setup(client);
 expect(result.current.canLoadMore).toBe(true);
 act(() => result.current.handleLoadMore());
 expect(retry).toHaveBeenCalledWith({ queryKey: ['rows', table.id, 2], type: 'active' });
 expect(useTablesStore.getState().currentPage).toBe(2);
});
