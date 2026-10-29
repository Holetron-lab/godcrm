import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { useWidgetCreate } from '../useWidgetCreate';
import { useProjectWidgets } from '@/features/projects/hooks/useProjectWidgets';
import { apiClient } from '@/shared/utils/apiClient';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn() } }));
vi.mock('@/features/tables/hooks/useAllTables', () => ({ useAllTables: () => ({ data: { flat: [] } }) }));
afterEach(cleanup);

it('refreshes the mounted sidebar after creating a widget, without a reload', async () => {
  const widget = { id: 42, title: 'New view', dashboard_id: 9, icon: '📊', widget_type: 'preset' };
  let created = false;
  vi.mocked(apiClient.request).mockImplementation(async (url, options) => {
    if (url === '/projects/3/widgets') return { data: created ? [widget] : [] } as never;
    if (url === '/projects/3/dashboard') return { data: { id: 9 } } as never;
    if (url === '/dashboards/9/widgets' && options?.method === 'POST') {
      created = true;
      return { data: widget } as never;
    }
    return { data: [] } as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const { result } = renderHook(() => ({ creator: useWidgetCreate(), sidebar: useProjectWidgets(3) }), {
    wrapper: ({ children }) => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/widgets/new?projectId=3']}>{children}</MemoryRouter></QueryClientProvider>,
  });
  await waitFor(() => expect(result.current.sidebar.isSuccess).toBe(true));
  act(() => {
    const preset = result.current.creator.widgetPresets.find(p => p.id === 'table_view')!;
    result.current.creator.handlePresetSelect(preset);
    result.current.creator.setTableMappings([{ tableKey: 'data', tableId: '17', projectId: 3, columnMapping: {}, createNew: false }]);
  });
  await waitFor(() => expect(result.current.creator.dashboardLoading).toBe(false));
  await act(() => result.current.creator.handleCreateWidget());
  expect(created).toBe(true);
  await waitFor(() => expect(result.current.sidebar.data).toEqual([widget]));
  client.clear();
});
