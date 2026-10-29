import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTablesBootstrap } from '../useTablesBootstrap';
import { tablesApi } from '../../api/tablesApi';
import { useTablesStore } from '../../store/tablesStore';

vi.mock('../../api/tablesApi', () => ({
  tablesApi: { listTables: vi.fn(), getColumns: vi.fn(), getRows: vi.fn() },
}));
vi.mock('@/features/auth/store/authStore', () => ({
  useAuthStore: (select: (s: { user: { id: number } }) => unknown) => select({ user: { id: 1 } }),
}));
vi.mock('@/features/projects/store/projectStore', () => ({
  useProjectStore: (select: (s: { currentProjectId: null }) => unknown) => select({ currentProjectId: null }),
}));
vi.mock('../useTableRowsLiveSync', () => ({ useTableRowsLiveSync: vi.fn() }));

const TABLE = '7';
const page = (rows: Array<{ id: number; data: Record<string, unknown>; updated_at: string }>) => ({
  rows,
  pagination: { page: 1, limit: 50, total: rows.length, pages: 1 },
});

describe('useTablesBootstrap — a refetch with changed values reaches the store (Refresh button)', () => {
  beforeEach(() => {
    vi.mocked(tablesApi.listTables).mockResolvedValue({ tables: [{ id: TABLE, name: 't' }], meta: {} } as never);
    vi.mocked(tablesApi.getColumns).mockResolvedValue({ columns: [], userRole: 'owner' } as never);
    vi.mocked(tablesApi.getRows).mockReset();
    useTablesStore.setState({ rows: {}, activeTableId: TABLE, currentPage: 1 });
  });

  it('replaces rows whose ids did not change but updated_at did', async () => {
    vi.mocked(tablesApi.getRows).mockResolvedValue(
      page([{ id: 1, data: { status: 'todo', colour: 'none' }, updated_at: '2026-10-20T06:00:00Z' }]) as never,
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useTablesBootstrap(), {
      wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children),
    });
    await waitFor(() => expect(useTablesStore.getState().rows[TABLE]?.[0]?.data.colour).toBe('none'));

    // An automation painted the row; the server now returns the same id with a newer stamp.
    vi.mocked(tablesApi.getRows).mockResolvedValue(
      page([{ id: 1, data: { status: 'done', colour: 'red' }, updated_at: '2026-10-20T06:00:05Z' }]) as never,
    );
    await act(async () => { await client.invalidateQueries({ queryKey: ['rows', TABLE] }); });

    await waitFor(() => expect(useTablesStore.getState().rows[TABLE][0].data.colour).toBe('red'));
    expect(useTablesStore.getState().rows[TABLE][0].updatedAt).toBe('2026-10-20T06:00:05Z');
  });
});
