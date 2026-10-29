import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { UniversalTable } from '../UniversalTable';
import { useTablesStore } from '../../../store/tablesStore';
import type { ColumnModel, RowModel, TableModel } from '../../../types/table.types';
import { tablesApi } from '../../../api/tablesApi';

vi.mock('@google/model-viewer', () => ({}));
vi.mock('@/features/ai-chat/context/AIChatContext', () => ({ useAIChat: () => ({ openTaskChat: vi.fn() }) }));
vi.mock('../../../api/tablesApi', () => ({ tablesApi: { updateRow: vi.fn(), updateColumn: vi.fn() } }));
const table: TableModel = {
  id: 'preview-table', userId: 'u1', name: 'preview', displayName: 'Preview', type: 'system',
  isVisible: true, config: { defaultView: 'table', views: [], permissions: {} }, createdAt: '', updatedAt: '',
};
const columns: ColumnModel[] = [{
  id: 'images', tableId: table.id, name: 'images', displayName: 'Images', type: 'image',
  config: { image: { displayMode: 'carousel' } }, isRequired: false, isReadonly: false,
  orderIndex: 0, width: 200, isVisible: true,
}, {
  id: 'name', tableId: table.id, name: 'name', displayName: 'Name', type: 'text',
  config: {}, isRequired: false, isReadonly: false, orderIndex: 1, width: 180, isVisible: true,
}];
const rows: RowModel[] = [{ id: '7', tableId: table.id, createdAt: '', updatedAt: '', createdBy: 'fixture', data: { images: '/wide.png,/portrait.png', name: 'Before' } }];

beforeEach(() => {
  localStorage.setItem('god-crm-language', 'en');
  vi.clearAllMocks();
  useTablesStore.setState({ rows: { [table.id]: rows }, rowsVersion: 0 });
});

it.each([false, true])('retains preview, transforms and opener across parent/data updates (readonly=%s)', async readOnly => {
  const user = userEvent.setup();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (data = rows, activeTable = table) => <MemoryRouter><QueryClientProvider client={client}><LanguageProvider>
    <UniversalTable table={activeTable} columns={columns.map(column => ({ ...column, tableId: activeTable.id, isReadonly: readOnly }))} rows={data} readOnly={readOnly} />
  </LanguageProvider></QueryClientProvider></MemoryRouter>;
  const { rerender } = render(view());
  const open = screen.getByRole('button', { name: 'Open image 1' });
  open.focus();
  await user.keyboard('{Enter}');
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByTitle('Zoom in'));
  fireEvent.click(within(dialog).getByTitle('Rotate'));
  rerender(view());
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(open.isConnected).toBe(true);
  const updated = [{ ...rows[0], data: { ...rows[0].data, name: 'After' } }];
  act(() => useTablesStore.getState().updateCell(table.id, '7', 'name', 'After'));
  rerender(view(updated));
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(screen.getByText('After')).toBeInTheDocument();
  expect(within(dialog).getByRole('img').style.transform).toContain('scale(1.25)');
  expect(within(dialog).getByRole('img').style.transform).toContain('rotate(90deg)');
  await user.keyboard('{Escape}');
  expect(open).toHaveFocus();
  await user.keyboard(' ');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(open).toHaveFocus();
  // Stable identity must still read current data, and must reset for a new table.
  const refreshed = [{ ...rows[0], data: { images: '/fresh.png', name: 'After' } }];
  rerender(view(refreshed));
  expect(screen.getByRole('img')).toHaveAttribute('src', '/fresh.png');
  const refreshedOpener = screen.getByRole('button', { name: 'Open image 1' });
  refreshedOpener.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('dialog', { name: 'fresh.png' })).toBeInTheDocument();
  const anotherTable = { ...table, id: 'another-table' };
  rerender(view([{ ...refreshed[0], tableId: anotherTable.id }], anotherTable));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(refreshedOpener.isConnected).toBe(false);
  expect(tablesApi.updateRow).not.toHaveBeenCalled();
});
