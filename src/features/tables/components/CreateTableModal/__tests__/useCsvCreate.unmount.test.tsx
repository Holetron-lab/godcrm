import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { useCsvCreate } from '../useCsvCreate';
import { apiClient } from '@/shared/utils/apiClient';
import { useTablesStore } from '../../../store/tablesStore';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn() } }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); useTablesStore.setState({ tables: [], error: null }); });

const params: Parameters<typeof useCsvCreate>[0] = {
  csvFiles: [], csvFilesBeforeNotionImport: null, targetProjectId: 3, useFirstRowAsHeaders: true,
  setCsvCreating: vi.fn(), setCsvStep: vi.fn(), resetState: vi.fn(), onOpenChange: vi.fn(),
  tableType: 'local', basic: { displayName: 'Orders', name: 'orders', description: '', icon: '', color: '' },
  derivedName: 'orders', hierarchy: { mode: 'flat' }, columns: [], selectedDataSource: '',
  selectedExternalTable: '', selectedRelatedTables: [], showInMenu: true, menuWidgetTitle: 'Orders view',
  menuWidgetIcon: '', menuWidgetDescription: '', slugify: value => value,
};

it.each(['pending request', 'table store update'])('creates the widget after unmount during %s', async (timing) => {
  let resolveTable!: () => void;
  const response = new Promise<void>(resolve => { resolveTable = resolve; });
  vi.mocked(apiClient.request).mockImplementation(async (url) => {
    if (url === '/tables') {
      await response;
      return { data: { table: { id: 17, project_id: 3, name: 'orders' }, columns: [] } } as never;
    }
    if (url === '/projects/3/dashboard') return { data: { id: 9 } } as never;
    if (url === '/dashboards/9/widgets') return { data: { id: 42 } } as never;
    throw new Error(`Unexpected request: ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const { result, unmount } = renderHook(() => useCsvCreate(params), {
    wrapper: ({ children }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>,
  });
  let unmounted = false;
  const unsubscribe = useTablesStore.subscribe(state => {
    if (timing === 'table store update' && state.tables.length && !unmounted) {
      unmounted = true;
      unmount();
    }
  });
  try {
    let submission!: Promise<void>;
    act(() => { submission = result.current.handleSubmit(); });
    await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith('/tables', expect.any(Object)));
    if (timing === 'pending request') { unmount(); unmounted = true; }
    await act(async () => { resolveTable(); await submission; });
    expect(unmounted).toBe(true);
    await waitFor(() => expect(apiClient.request).toHaveBeenCalledWith('/dashboards/9/widgets', expect.objectContaining({ method: 'POST' })));
    const widgetCall = vi.mocked(apiClient.request).mock.calls.find(([url]) => url === '/dashboards/9/widgets');
    expect(JSON.parse(String(widgetCall?.[1]?.body))).toMatchObject({ title: 'Orders view', config: { table_id: 17 } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['project-widgets', 3] });
    expect(params.onOpenChange).toHaveBeenCalledWith(false);
  } finally { unsubscribe(); client.clear(); }
});

it('handles table rejection without creating a widget or closing the form', async () => {
  vi.mocked(apiClient.request).mockRejectedValue(new Error('Table creation failed'));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const { result } = renderHook(() => useCsvCreate(params), {
    wrapper: ({ children }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>,
  });
  await act(async () => { await expect(result.current.handleSubmit()).resolves.toBeUndefined(); });
  await waitFor(() => expect(useTablesStore.getState().error).toBe('Table creation failed'));
  expect(apiClient.request).toHaveBeenCalledTimes(1);
  expect(params.resetState).not.toHaveBeenCalled();
  expect(params.onOpenChange).not.toHaveBeenCalled();
  client.clear();
});
