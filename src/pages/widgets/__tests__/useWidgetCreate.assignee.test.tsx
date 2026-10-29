import { act, renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWidgetCreate } from '../useWidgetCreate';
import { apiClient } from '@/shared/utils/apiClient';
import { tablesApi } from '@/features/tables/api/tablesApi';
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn() } }));
vi.mock('@/features/tables/api/tablesApi', () => ({ tablesApi: { getColumns: vi.fn(), createColumn: vi.fn() } }));
vi.mock('@/features/tables/hooks/useAllTables', () => ({ useAllTables: () => ({ data: { flat: [] } }) }));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.mocked(tablesApi.getColumns).mockResolvedValue({ columns: [], userRole: 'owner' });
  vi.mocked(apiClient.request).mockImplementation(async (url) => {
    if (url === '/tables') return { data: { table: { id: 17 }, columns: [
      { column_name: 'title', type: 'text' }, { column_name: 'status', type: 'select' }, { column_name: 'assignee', type: 'user' },
    ] } } as never;
    if (url.includes('/dashboard')) return { data: { id: 9 } } as never;
    return { data: [] } as never;
  });
});
async function setup(createNew = false, assignee = '__create_assignee__') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const hook = renderHook(useWidgetCreate, { wrapper: ({ children }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider> });
  act(() => {
    const preset = hook.result.current.widgetPresets.find(p => p.id === 'kanban_board')!;
    hook.result.current.handlePresetSelect(preset);
    hook.result.current.setTableMappings([{ tableKey: 'data', projectId: 3, tableId: createNew ? null : '17', createNew,
      columnMapping: createNew ? {} : { statusColumn: 'status', titleColumn: 'title', assigneeColumn: assignee } }]);
  });
  await waitFor(() => expect(hook.result.current.dashboardLoading).toBe(false));
  return hook;
}
function savedConfig() {
  const call = vi.mocked(apiClient.request).mock.calls.find(([url, options]) => url === '/dashboards/9/widgets' && options?.method === 'POST');
  expect(call).toBeDefined();
  return JSON.parse(String(call![1]!.body)).config;
}
it('creates the missing assignee before saving the board', async () => {
  const hook = await setup();
  await act(() => hook.result.current.handleCreateWidget());
  expect(tablesApi.createColumn).toHaveBeenCalledTimes(1);
  expect(savedConfig().kanban.assigneeColumn).toBe('assignee');
});
it('preserves a selected custom column without creating another', async () => {
  const hook = await setup(false, 'responsible_people');
  await act(() => hook.result.current.handleCreateWidget());
  expect(tablesApi.createColumn).not.toHaveBeenCalled();
  expect(savedConfig().kanban.assigneeColumn).toBe('responsible_people');
});
it('includes a person column and its mapping for a new table', async () => {
  const hook = await setup(true);
  await act(() => hook.result.current.handleCreateWidget());
  const tableCall = vi.mocked(apiClient.request).mock.calls.find(([url, options]) => url === '/tables' && options?.method === 'POST');
  expect(JSON.parse(String(tableCall![1]!.body)).columns).toContainEqual(expect.objectContaining({ name: 'assignee', type: 'user' }));
  expect(savedConfig().kanban.assigneeColumn).toBe('assignee');
});
it('does not save a widget when column creation fails', async () => {
  vi.mocked(tablesApi.createColumn).mockRejectedValueOnce(new Error('Forbidden'));
  const hook = await setup();
  await act(() => hook.result.current.handleCreateWidget());
  expect(apiClient.request).not.toHaveBeenCalledWith('/dashboards/9/widgets', expect.anything());
  expect(window.alert).toHaveBeenCalled();
});
