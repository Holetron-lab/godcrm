import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { flexRender } from '@tanstack/react-table';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { PublicViewProvider } from '@/features/public/PublicViewContext';
import { useTablesStore } from '../../../store/tablesStore';
import type { RowModel, TableModel } from '../../../types/table.types';
import { useUniversalTableState } from '../useUniversalTableState';
import { createMockColumn } from './columnSettingsTestUtils';

vi.mock('@/features/ai-chat/context/AIChatContext', () => ({ useAIChat: () => ({ openTaskChat: vi.fn() }) }));
vi.mock('@/shared/hooks/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { post: vi.fn(), request: vi.fn(), get: vi.fn(), getAccessToken: () => null } }));

import { apiClient } from '@/shared/utils/apiClient';

const table: TableModel = { id: '1', userId: '1', name: 'test', displayName: 'Test', type: 'custom', isVisible: true,
  config: { defaultView: 'table', views: [], permissions: {} }, createdAt: '', updatedAt: '' };
const columns = ['A', 'B'].map((name, index) => createMockColumn({ id: String(index + 1), tableId: '1', name, displayName: name, orderIndex: index }));
const rows: RowModel[] = [{ id: '1', tableId: '1', data: { A: 'x', B: 'y' }, createdAt: '', updatedAt: '', createdBy: 'test-user' }];

let state: ReturnType<typeof useUniversalTableState>;
function Fixture() {
  state = useUniversalTableState({ table, columns, rows });
  return <>{state.tableInstance.getHeaderGroups()[0].headers.map(header => <div key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</div>)}</>;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('god-crm-language', 'ru');
  useTablesStore.setState({ tableRoles: { '1': 'owner' }, contextUserId: null, rowsVersion: 0 });
});

it('keeps the column menu open while the server summary arrives', async () => {
  let resolveSummary: (value: unknown) => void = () => undefined;
  vi.mocked(apiClient.post).mockImplementation(() => new Promise(resolve => { resolveSummary = resolve; }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><LanguageProvider><PublicViewProvider readOnly={false} publicSlug={null}><Fixture /></PublicViewProvider></LanguageProvider></QueryClientProvider></MemoryRouter>);
  const user = userEvent.setup();

  expect(state.tableSummary.status).toBe('loading');
  await user.click(screen.getByRole('button', { name: 'Действия столбца B' }));
  expect(screen.getByRole('menuitem', { name: 'Добавить столбец' })).toBeInTheDocument();

  await act(async () => { resolveSummary({ success: true, data: { total: 1, columns: {} } }); });
  await waitFor(() => expect(state.tableSummary.status).toBe('ready'));
  expect(screen.getByRole('menuitem', { name: 'Добавить столбец' })).toBeInTheDocument();
});

it('keeps the column menu open when the summary request fails', async () => {
  let rejectSummary: (reason: unknown) => void = () => undefined;
  vi.mocked(apiClient.post).mockImplementation(() => new Promise((_resolve, reject) => { rejectSummary = reject; }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><LanguageProvider><PublicViewProvider readOnly={false} publicSlug={null}><Fixture /></PublicViewProvider></LanguageProvider></QueryClientProvider></MemoryRouter>);
  const user = userEvent.setup();

  await user.click(screen.getByRole('button', { name: 'Действия столбца B' }));
  expect(screen.getByRole('menuitem', { name: 'Добавить столбец' })).toBeInTheDocument();

  await act(async () => { rejectSummary(new Error('offline')); });
  await waitFor(() => expect(state.tableSummary.status).toBe('unavailable'));
  expect(screen.getByRole('menuitem', { name: 'Добавить столбец' })).toBeInTheDocument();
});
