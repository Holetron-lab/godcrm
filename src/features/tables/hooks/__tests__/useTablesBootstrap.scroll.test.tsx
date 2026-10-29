import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTablesBootstrap } from '../useTablesBootstrap';
import { useTablesStore } from '../../store/tablesStore';
import { tablesApi } from '../../api/tablesApi';

vi.mock('@/features/auth/store/authStore', () => ({
  useAuthStore: (selector: (state: { user: { id: number } }) => unknown) => selector({ user: { id: 1 } }),
}));
vi.mock('../../api/tablesApi', () => ({
  tablesApi: { listTables: vi.fn(), getColumns: vi.fn(), getRows: vi.fn() },
}));

const row = { id: '1', tableId: 'table', data: { text: 'First row' }, createdAt: '', updatedAt: '', createdBy: 'test' };
const pagination = { page: 1, limit: 50, total: 100, pages: 2 };
const initialState = useTablesStore.getInitialState();
let client: QueryClient;

function Table() {
  const { loading, error } = useTablesBootstrap();
  const rows = useTablesStore(state => state.rows.table);
  if (loading) return <div>Initial loading</div>;
  return <div data-testid="scroll-container">{rows?.map(item => <div key={item.id}>{item.data.text as string}</div>)}{error && <span>Load error</span>}</div>;
}

beforeEach(() => {
  vi.resetAllMocks();
  useTablesStore.setState(initialState, true);
  useTablesStore.setState({ activeTableId: 'table' });
  vi.mocked(tablesApi.listTables).mockResolvedValue({ tables: [], meta: null });
  vi.mocked(tablesApi.getColumns).mockResolvedValue({ columns: [], userRole: 'owner' });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { cleanup(); client.clear(); useTablesStore.setState(initialState, true); });

it('keeps the scroll container and existing rows mounted while appending a page', async () => {
  vi.mocked(tablesApi.getRows).mockResolvedValueOnce({ rows: [row], pagination });
  render(<QueryClientProvider client={client}><Table /></QueryClientProvider>);
  await screen.findByText('First row');
  const container = screen.getByTestId('scroll-container');
  container.scrollTop = 480;
  let resolvePage!: (value: Awaited<ReturnType<typeof tablesApi.getRows>>) => void;
  vi.mocked(tablesApi.getRows).mockImplementationOnce(() => new Promise(resolve => { resolvePage = resolve; }));
  act(() => useTablesStore.getState().setCurrentPage(2));
  await waitFor(() => expect(useTablesStore.getState().loadingMore).toBe(true));
  expect(screen.getByTestId('scroll-container')).toBe(container);
  expect(container.scrollTop).toBe(480);
  await act(async () => resolvePage({ rows: [{ ...row, id: '2', data: { text: 'Second row' } }], pagination: { ...pagination, page: 2 } }));
  await screen.findByText('Second row');
  expect(screen.getByTestId('scroll-container')).toBe(container);
  expect(container.scrollTop).toBe(480);
  expect(screen.getByText('First row')).toBeVisible();
});

it('still shows initial loading when opening a table at a later page without rows', async () => {
  useTablesStore.setState({ currentPage: 3 });
  vi.mocked(tablesApi.getRows).mockImplementation(() => new Promise(() => {}));
  render(<QueryClientProvider client={client}><Table /></QueryClientProvider>);
  expect(screen.getByText('Initial loading')).toBeVisible();
});

it('keeps existing rows after a failed append and permits retry', async () => {
  vi.mocked(tablesApi.getRows).mockResolvedValueOnce({ rows: [row], pagination });
  render(<QueryClientProvider client={client}><Table /></QueryClientProvider>);
  await screen.findByText('First row');
  const container = screen.getByTestId('scroll-container');
  vi.mocked(tablesApi.getRows).mockRejectedValue(new Error('offline'));
  act(() => useTablesStore.getState().setCurrentPage(2));
  await screen.findByText('Load error', {}, { timeout: 3000 });
  expect(screen.getByTestId('scroll-container')).toBe(container);
  expect(screen.getByText('First row')).toBeVisible();
  vi.mocked(tablesApi.getRows).mockResolvedValue({ rows: [{ ...row, id: '2', data: { text: 'Retried row' } }], pagination: { ...pagination, page: 2 } });
  await act(async () => { await client.refetchQueries({ queryKey: ['rows', 'table', 2] }); });
  await screen.findByText('Retried row');
  expect(screen.getByTestId('scroll-container')).toBe(container);
});
