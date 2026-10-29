import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { flexRender } from '@tanstack/react-table';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { PublicViewProvider } from '@/features/public/PublicViewContext';
import { showToast } from '@/shared/hooks/useToast';
import { useTablesStore } from '../../../store/tablesStore';
import { tablesApi } from '../../../api/tablesApi';
import type { TableModel } from '../../../types/table.types';
import { useUniversalTableState } from '../useUniversalTableState';
import { createMockColumn } from './columnSettingsTestUtils';

vi.mock('@/features/ai-chat/context/AIChatContext', () => ({ useAIChat: () => ({ openTaskChat: vi.fn() }) }));
vi.mock('@/shared/hooks/useToast', () => ({ showToast: vi.fn() }));
vi.mock('../../../api/tablesApi', () => ({ tablesApi: { createColumn: vi.fn(), updateColumn: vi.fn() } }));
const table: TableModel = { id: '1', userId: '1', name: 'test', displayName: 'Test', type: 'custom', isVisible: true,
  config: { defaultView: 'table', views: [], permissions: {} }, createdAt: '', updatedAt: '' };
const columns = ['A', 'Hidden', 'B', 'C'].map((name, index) => createMockColumn({ id: String(index + 1), tableId: '1', name, displayName: name, orderIndex: index, isVisible: name !== 'Hidden' }));
let state: ReturnType<typeof useUniversalTableState>;
function Fixture({ readOnly = false }: { readOnly?: boolean }) {
  state = useUniversalTableState({ table, columns, rows: [], readOnly });
  return <>{state.tableInstance.getHeaderGroups()[0].headers.map(header => <div key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</div>)}</>;
}
function setup(readOnly = false, publicReadOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><LanguageProvider><PublicViewProvider readOnly={publicReadOnly} publicSlug={null}><Fixture readOnly={readOnly} /></PublicViewProvider></LanguageProvider></QueryClientProvider></MemoryRouter>);
  return userEvent.setup();
}
// «Добавить столбец» is a flyout: open it from the keyboard, then pick the side
async function pickAddColumn(user: ReturnType<typeof userEvent.setup>, anchor: string, side: 'left' | 'right') {
  await user.click(screen.getByRole('button', { name: `Действия столбца ${anchor}` }));
  screen.getByRole('menuitem', { name: 'Добавить столбец' }).focus();
  await user.keyboard('{ArrowRight}');
  (await screen.findByRole('menuitem', { name: side === 'left' ? 'Добавить слева' : 'Добавить справа' })).focus();
  await user.keyboard('{Enter}');
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('god-crm-language', 'ru');
  useTablesStore.setState({ tableRoles: { '1': 'owner' }, contextUserId: null });
  vi.mocked(tablesApi.createColumn).mockResolvedValue({ id: '5' });
  vi.mocked(tablesApi.updateColumn).mockImplementation(async (_tableId, id, payload) => ({ ...createMockColumn({ id, ...payload }), createdAt: '', updatedAt: '' }));
});
it.each(['left', 'right'] as const)('inserts a new column %s of the anchor including hidden columns', async side => {
  const user = setup();
  await pickAddColumn(user, 'B', side);
  expect(state.createColumnOpen).toBe(true);
  await act(() => state.createColumnMutation.mutateAsync({ name: 'new', displayName: 'New', type: 'text' }));
  expect(tablesApi.updateColumn).toHaveBeenCalledWith('1', '5', { orderIndex: side === 'left' ? 2 : 3 });
  expect(state.createColumnOpen).toBe(false);
  expect(tablesApi.updateColumn).not.toHaveBeenCalledWith('1', expect.stringContaining('__sys'), expect.anything());
});
it('moves across the adjacent visible column without treating hidden columns as visible indices', async () => {
  const user = setup();
  await user.click(screen.getByRole('button', { name: 'Действия столбца B' }));
  screen.getByRole('menuitem', { name: /Переместить столбец/ }).focus();
  await user.keyboard('{ArrowRight}');
  const left = await screen.findByRole('menuitem', { name: 'Переместить влево' });
  left.focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(tablesApi.updateColumn).toHaveBeenCalledWith('1', '3', { orderIndex: 0 }));
});
it.each(['viewer', 'editor', 'readonly'])('does not expose schema actions to %s', role => {
  if (role !== 'readonly') useTablesStore.setState({ tableRoles: { '1': role as 'viewer' | 'editor' } });
  setup(role === 'readonly');
  expect(screen.queryByRole('button', { name: /Действия столбца/ })).not.toBeInTheDocument();
});

it('keeps the form open on creation failure and does not reorder anything', async () => {
  vi.mocked(tablesApi.createColumn).mockRejectedValueOnce(new Error('offline'));
  const user = setup();
  await pickAddColumn(user, 'B', 'left');
  await act(async () => { await expect(state.createColumnMutation.mutateAsync({ name: 'new', displayName: 'New', type: 'text' })).rejects.toThrow('offline'); });
  expect(state.createColumnOpen).toBe(true);
  expect(tablesApi.updateColumn).not.toHaveBeenCalled();
});
it('reports a partial insertion without inviting duplicate creation', async () => {
  vi.mocked(tablesApi.updateColumn).mockRejectedValue(new Error('offline'));
  const user = setup();
  await pickAddColumn(user, 'B', 'right');
  await act(() => state.createColumnMutation.mutateAsync({ name: 'new', displayName: 'New', type: 'text' }));
  expect(state.createColumnOpen).toBe(false);
  await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Колонка создана, но'), 'error'));
  expect(tablesApi.createColumn).toHaveBeenCalledOnce();
});
it('clears a cancelled insertion when opening the regular add-column form', async () => {
  const user = setup();
  await pickAddColumn(user, 'B', 'left');
  act(() => state.setCreateColumnOpen(false));
  act(() => state.handleAddColumn());
  await act(() => state.createColumnMutation.mutateAsync({ name: 'new', displayName: 'New', type: 'text' }));
  expect(tablesApi.updateColumn).not.toHaveBeenCalled();
});

it('hides column actions in a public view', () => {
  setup(false, true);
  expect(screen.queryByRole('button', { name: /Действия столбца/ })).not.toBeInTheDocument();
});
it('does not offer movement beyond the first or last visible column', async () => {
  const user = setup();
  for (const [name, unavailable] of [['A', 'Переместить влево'], ['C', 'Переместить вправо']]) {
    await user.click(screen.getByRole('button', { name: `Действия столбца ${name}` }));
    screen.getByRole('menuitem', { name: /Переместить столбец/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.queryByRole('menuitem', { name: unavailable })).not.toBeInTheDocument();
    await user.keyboard('{Escape}{Escape}');
  }
});
it('reports a failed move without an unhandled rejection', async () => {
  vi.mocked(tablesApi.updateColumn).mockRejectedValue(new Error('offline'));
  setup();
  await act(() => state.handleColumnReorder('3', 0));
  expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Не удалось сохранить порядок'), 'error');
});
