import { fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { BindableRowsList } from '../BindableRowsList';
vi.mock('@/features/tables/hooks/useTableColumns', () => ({ useTableColumns: () => ({ data: [] }) }));
vi.mock('../../hooks/useRowBoundChats', () => ({ useRowBoundChats: () => ({ map: new Map(), refetch: vi.fn() }) }));
vi.mock('../ChatMessages/RowViewerModal', () => ({ default: ({ mode, tableId, rowId, onClose }: { mode: string; tableId: number; rowId: number; onClose: () => void }) => <div role="dialog" aria-label={`${mode}:${tableId}/${rowId}`}><button onClick={onClose}>Close</button></div> }));

it.each([{ tableId: 1708, tableName: 'Tickets' }])('previews $tableName without opening a chat and keeps editing separate', source => {
  const openTaskChat = vi.fn();
  const closePanel = vi.fn();
  renderWithProviders(<BindableRowsList source={source} rows={[{ id: 42, data: { name: 'Example' } }]} currentConversationId={null} selectConversation={vi.fn()} openTaskChat={openTaskChat} closePanel={closePanel} setBoundRows={vi.fn()} setShowBoundRowsBar={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Просмотр' }));
  expect(screen.getByRole('dialog', { name: `view:${source.tableId}/42` })).toBeInTheDocument();
  expect(openTaskChat).not.toHaveBeenCalled();
  expect(closePanel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle('Редактировать'));
  expect(screen.getByRole('dialog', { name: `edit:${source.tableId}/42` })).toBeInTheDocument();
});

it('delegates document preview to its content viewer', () => {
  const onViewRow = vi.fn();
  const row = { id: 42, data: { name: 'Document', table_id: 100545 } };
  renderWithProviders(<BindableRowsList source={{ tableId: 2197, tableName: 'Documents' }} rows={[row]} onViewRow={onViewRow} currentConversationId={null} selectConversation={vi.fn()} closePanel={vi.fn()} setBoundRows={vi.fn()} setShowBoundRowsBar={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Просмотр' }));
  expect(onViewRow).toHaveBeenCalledWith(row);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
