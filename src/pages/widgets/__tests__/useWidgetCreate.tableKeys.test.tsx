import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { useWidgetCreate } from '../useWidgetCreate';
import { apiClient } from '@/shared/utils/apiClient';
// @ts-expect-error The backend JS schema has no TypeScript declaration.
import { tableKeySchema } from '../../../../backend/utils/tableKeySchema.js';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn() } }));
vi.mock('@/features/tables/hooks/useAllTables', () => ({ useAllTables: () => ({ data: { flat: [] } }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([
  ['Document Atoms', 'document_atoms'],
  ['Атомы документа', 'atomy_dokumenta'],
  ['📄', 'atoms'],
])('creates a documents widget with the table title %s and a valid API key', async (title, key) => {
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  const tables: { name: string; displayName: string }[] = [];
  let widgetConfig: Record<string, unknown> | undefined;
  vi.mocked(apiClient.request).mockReset().mockImplementation(async (url, options) => {
    if (url === '/projects/8409/dashboard') return { data: { id: 9 } } as never;
    if (url === '/tables' && options?.method === 'POST') {
      const payload = JSON.parse(String(options.body));
      // Enforce the actual server contract instead of accepting any mocked name.
      tableKeySchema.parse(payload.name);
      tables.push(payload);
      return { data: { table: { id: 100 + tables.length }, columns: payload.columns.map(
        (column: { name: string; type: string }) => ({ column_name: column.name, type: column.type }),
      ) } } as never;
    }
    if (url === '/dashboards/9/widgets' && options?.method === 'POST') {
      widgetConfig = JSON.parse(String(options.body)).config;
      return { data: {} } as never;
    }
    return { data: [] } as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const { result } = renderHook(useWidgetCreate, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/8409/widgets/create']}>
        <Routes><Route path="/projects/:projectId/widgets/create" element={children} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  });
  try {
    await waitFor(() => expect(result.current.dashboardLoading).toBe(false));
    act(() => {
      const preset = result.current.widgetPresets.find(p => p.id === 'documents')!;
      result.current.handlePresetSelect({ ...preset, tables: preset.tables.map(table =>
        table.key === 'atoms' ? { ...table, defaultTableName: title } : table),
      });
    });
    await act(() => result.current.handleCreateWidget());
    expect(alert).not.toHaveBeenCalled();
    expect(tables).toHaveLength(2);
    expect(tables[1]).toMatchObject({ name: key, displayName: title });
    expect(widgetConfig).toMatchObject({ registry_table_id: 101, atoms_table_id: 102, project_id: 8409 });
  } finally {
    client.clear();
  }
});
