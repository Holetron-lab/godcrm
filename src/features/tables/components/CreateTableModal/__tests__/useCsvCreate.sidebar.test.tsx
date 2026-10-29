import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { useCsvCreate } from '../useCsvCreate';
import { cloneDefaultColumns } from '../constants';
import { useProjectWidgets } from '@/features/projects/hooks/useProjectWidgets';
import { apiClient } from '@/shared/utils/apiClient';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn() } }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);

it('creates a table and its menu widget and refreshes the mounted sidebar', async () => {
  const widget = { id: 42, title: 'Orders view', dashboard_id: 9, icon: '📊', widget_type: 'preset' };
  let created = false;
  vi.mocked(apiClient.request).mockImplementation(async (url, options) => {
    if (url === '/tables' && options?.method === 'POST') {
      return { data: { table: { id: 17, project_id: 3, name: 'orders', display_name: 'Orders' }, columns: [] } } as never;
    }
    if (url === '/projects/3/widgets') return { data: created ? [widget] : [] } as never;
    if (url === '/projects/3/dashboard') return { data: { id: 9 } } as never;
    if (url === '/dashboards/9/widgets' && options?.method === 'POST') {
      created = true;
      return { data: widget } as never;
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onOpenChange = vi.fn();
  const { result } = renderHook(() => ({
    sidebar: useProjectWidgets(3),
    creator: useCsvCreate({
      csvFiles: [], csvFilesBeforeNotionImport: null, targetProjectId: 3, useFirstRowAsHeaders: true,
      setCsvCreating: vi.fn(), setCsvStep: vi.fn(), resetState: vi.fn(), onOpenChange,
      tableType: 'local', basic: { displayName: 'Orders', name: 'orders', description: '', icon: '', color: '' },
      derivedName: 'orders', hierarchy: { mode: 'flat' }, columns: cloneDefaultColumns(), selectedDataSource: '',
      selectedExternalTable: '', selectedRelatedTables: [], showInMenu: true, menuWidgetTitle: 'Orders view',
      menuWidgetIcon: '', menuWidgetDescription: '', slugify: value => value,
    }),
  }), { wrapper: ({ children }) => <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider> });
  await waitFor(() => expect(result.current.sidebar.data).toEqual([]));
  await act(() => result.current.creator.handleSubmit());
  await waitFor(() => expect(result.current.sidebar.data).toEqual([widget]));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  const tableCall = vi.mocked(apiClient.request).mock.calls.find(([url]) => url === '/tables');
  expect(JSON.parse(String(tableCall?.[1]?.body)).columns).toContainEqual(expect.objectContaining({ name: 'date' }));
  client.clear();
});
