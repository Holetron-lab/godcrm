import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTablesBootstrap } from '../useTablesBootstrap';
import { useUniversalTableState } from '../../components/UniversalTable/useUniversalTableState';
import { useTablesStore } from '../../store/tablesStore';
import { tablesApi } from '../../api/tablesApi';
import type { ColumnModel, RowModel, TableModel } from '../../types/table.types';

vi.mock('@/features/auth/store/authStore', () => ({ useAuthStore: (select: (state: { user: { id: number } }) => unknown) => select({ user: { id: 21 } }) }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('@/features/ai-chat/context/AIChatContext', () => ({ useAIChat: () => ({ openTaskChat: vi.fn() }) }));
vi.mock('../../api/tablesApi', () => ({ tablesApi: { listTables: vi.fn(), getColumns: vi.fn(), getRows: vi.fn() } }));

const table: TableModel = {
  id: '100965', name: 'suppliers', displayName: 'Suppliers', type: 'custom', isVisible: true, createdAt: '', updatedAt: '',
  config: { defaultView: 'table', permissions: {}, views: [{ id: 'table', name: 'Table', type: 'table', filters: [], sorts: [], visibleColumns: [] }] },
};
const column: ColumnModel = { id: '59194', tableId: table.id, name: 'status', displayName: 'Status', type: 'select', config: { defaultSort: 'desc' }, isRequired: false, isReadonly: false, isVisible: true, orderIndex: 0, width: 150, createdAt: '', updatedAt: '' };
const rows: RowModel[] = ['Архив', 'Заказываем', 'Изучить поставщика'].map((status, i) => ({ id: String(i + 1), tableId: table.id, data: { [column.id]: status }, createdAt: '', updatedAt: '', createdBy: 'fixture' }));
let client: QueryClient;
const initial = useTablesStore.getInitialState();
function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter>;
}
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  useTablesStore.setState({ ...initial, tables: [table], activeTableId: table.id, columns: { [table.id]: [column] }, rows: { [table.id]: structuredClone(rows) }, totalRows: { [table.id]: 3 }, totalPages: { [table.id]: 1 } }, true);
  vi.mocked(tablesApi.listTables).mockResolvedValue({ tables: [table], meta: null });
  vi.mocked(tablesApi.getColumns).mockResolvedValue({ columns: [column], userRole: 'owner' });
  vi.mocked(tablesApi.getRows).mockResolvedValue({ rows, pagination: { page: 1, limit: 50, total: 3, pages: 1 } });
});
afterEach(() => { cleanup(); client.clear(); useTablesStore.setState(initial, true); });

it('restores the saved sort on remount and moves a changed status above/below archive', () => {
  const hook = renderHook(() => useUniversalTableState(), { wrapper });
  const ids = () => hook.result.current.tableInstance.getRowModel().rows.map(row => row.id);
  expect(ids()).toEqual(['3', '2', '1']);
  act(() => useTablesStore.getState().updateCell(table.id, '3', column.id, 'Архив'));
  expect(ids()).toEqual(['2', '1', '3']);
  act(() => useTablesStore.getState().updateCell(table.id, '1', column.id, 'Заказываем'));
  expect(ids()).toEqual(['1', '2', '3']);
  hook.unmount();
  const reloaded = renderHook(() => useUniversalTableState(), { wrapper });
  expect(reloaded.result.current.tableInstance.getRowModel().rows.map(row => row.id)).toEqual(['1', '2', '3']);
});
it('keeps the original order without a saved sort and permits manual sorting', () => {
  useTablesStore.setState({ columns: { [table.id]: [{ ...column, config: {} }] } });
  const { result } = renderHook(() => useUniversalTableState(), { wrapper });
  expect(result.current.tableInstance.getRowModel().rows.map(row => row.id)).toEqual(['1', '2', '3']);
  act(() => result.current.tableInstance.setSorting([{ id: column.id, desc: true }]));
  expect(result.current.tableInstance.getRowModel().rows.map(row => row.id)).toEqual(['3', '2', '1']);
});
it('sends the same saved sort for the first and subsequent server pages', async () => {
  renderHook(() => useTablesBootstrap(), { wrapper });
  // ADR-205 D4: the grid always asks for the relation lens map alongside the page.
  const lens = { includeRelations: true };
  await waitFor(() => expect(tablesApi.getRows).toHaveBeenLastCalledWith(table.id, 1, 50, false, column.id, 'desc', lens));
  act(() => useTablesStore.getState().setCurrentPage(2));
  await waitFor(() => expect(tablesApi.getRows).toHaveBeenLastCalledWith(table.id, 2, 50, false, column.id, 'desc', lens));
  act(() => useTablesStore.getState().setSorting(column.id, 'asc'));
  await waitFor(() => expect(tablesApi.getRows).toHaveBeenLastCalledWith(table.id, 1, 50, false, column.id, 'asc', lens));
});
it('reorders loaded server rows immediately after a status change', () => {
  useTablesStore.setState({ totalPages: { [table.id]: 2 }, totalRows: { [table.id]: 60 }, rows: { [table.id]: [rows[2], rows[1], rows[0]] } });
  const { result } = renderHook(() => useUniversalTableState(), { wrapper });
  act(() => useTablesStore.getState().updateCell(table.id, '3', column.id, 'Архив'));
  expect(result.current.tableInstance.getRowModel().rows[0].id).toBe('2');
});
it('ignores a removed sort column', () => {
  useTablesStore.setState({ columns: { [table.id]: [{ ...column, id: 'replacement', config: {} }] } });
  const { result } = renderHook(() => useUniversalTableState(), { wrapper });
  expect(result.current.tableInstance.getState().sorting).toEqual([]);
});
it('uses each table own default when switching from a manually sorted table', () => {
  const { result } = renderHook(() => useUniversalTableState(), { wrapper });
  act(() => result.current.tableInstance.setSorting([{ id: column.id, desc: false }]));
  expect(result.current.tableInstance.getState().sorting).toEqual([{ id: column.id, desc: false }]);
  act(() => useTablesStore.setState({ tables: [{ ...table, id: 'other' }], activeTableId: 'other', columns: { other: [column] }, rows: { other: rows } }));
  expect(result.current.tableInstance.getState().sorting).toEqual([{ id: column.id, desc: true }]);
});
