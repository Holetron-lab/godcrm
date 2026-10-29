import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { afterEach, expect, it, vi } from 'vitest';
import { TableGrid } from '../TableGrid';
import type { ColumnModel, RowModel } from '../../../types/table.types';

vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
afterEach(cleanup);
const columns: ColumnModel[] = ['text', 'group'].map(id => ({
  id, tableId: 'table', name: id, displayName: id, type: 'text', config: { cellFormat: { textWrap: 'wrap' } },
  isRequired: false, isReadonly: false, orderIndex: 0, width: 180, isVisible: true, createdAt: '', updatedAt: '',
}));
const rows: RowModel[] = [{ id: '1', tableId: 'table', data: { text: 'Long text\n'.repeat(50), group: 'A' }, createdAt: '', updatedAt: '', createdBy: 'test' }];

function Grid({ grouped, readOnly, edit }: { grouped: boolean; readOnly: boolean; edit: () => void }) {
  const table = useReactTable({
    data: rows,
    columns: columns.map((column): ColumnDef<RowModel> => ({ id: column.id, accessorFn: row => row.data[column.id], cell: info => String(info.getValue()) })),
    getCoreRowModel: getCoreRowModel(),
  });
  return <QueryClientProvider client={new QueryClient()}><TableGrid
    table={table} columns={columns} rows={rows} minRowHeight={24} maxRowHeight={120}
    groupByColumn={grouped ? 'group' : undefined} readOnly={readOnly}
    editingCell={null} draftValue="" onCellDoubleClick={edit} onDraftChange={vi.fn()} onCommitEdit={vi.fn()} onCancelEdit={vi.fn()}
  /></QueryClientProvider>;
}

it.each([false, true])('keeps overflowing automatic-height text accessible with grouping=%s', grouped => {
  const edit = vi.fn();
  render(<Grid grouped={grouped} readOnly={false} edit={edit} />);
  const region = screen.getAllByRole('group', { name: 'Текст ячейки' })[0];
  expect(region).toHaveStyle({ minHeight: '24px', maxHeight: '120px' });
  expect(region).toHaveAttribute('tabindex', '0');
  expect(region).toHaveClass('overflow-y-auto');
  fireEvent.keyDown(region, { key: 'Enter' });
  expect(edit).toHaveBeenCalledTimes(1);
});

it.each([false, true])('keeps automatic-height read-only text scrollable with grouping=%s', grouped => {
  const edit = vi.fn();
  render(<Grid grouped={grouped} readOnly edit={edit} />);
  const region = screen.getAllByRole('group', { name: 'Текст ячейки' })[0];
  fireEvent.doubleClick(region);
  fireEvent.keyDown(region, { key: 'F2' });
  expect(edit).not.toHaveBeenCalled();
});
