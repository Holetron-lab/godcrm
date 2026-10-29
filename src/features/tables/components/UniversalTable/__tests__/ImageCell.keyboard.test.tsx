import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import type { ColumnModel, RowModel } from '../../../types/table.types';
import { TableGridRow } from '../TableGridRow';
import { renderCellValue } from '../renderCellValue';

const column: ColumnModel = {
  id: 'images', tableId: '1', name: 'images', displayName: 'Images', type: 'image',
  config: { image: { displayMode: 'carousel' }, cellFormat: { textWrap: 'nowrap' } }, isRequired: false, isReadonly: false,
  orderIndex: 0, width: 240, isVisible: true,
};
const data: RowModel[] = [{ id: '7', tableId: '1', data: { images: '/wide.png,/portrait.png' }, createdAt: '', updatedAt: '', createdBy: '1' }];

function Fixture({ edit, mutate, readOnly = false, rawMode = false, type = 'image' }: {
  edit: () => void; mutate: () => void; readOnly?: boolean; rawMode?: boolean; type?: ColumnModel['type'];
}) {
  const col = { ...column, type, isReadonly: readOnly };
  const table = useReactTable({ data, getCoreRowModel: getCoreRowModel(), columns: [{
    id: col.id, accessorFn: row => row.data.images,
    cell: info => renderCellValue({ column: col, value: info.getValue(), rawMode,
      rowId: '7', tableId: '1', rows: data, rowMutation: { mutate } }),
  }] });
  return <QueryClientProvider client={new QueryClient()}><LanguageProvider><table><tbody><TableGridRow row={table.getRowModel().rows[0]} rowIndex={0}
    columns={[col]} displayColumns={[col]} hiddenColumns={[]} editingCell={null}
    draftValue="" onCellDoubleClick={edit} onDraftChange={vi.fn()}
    onCommitEdit={vi.fn()} onCancelEdit={vi.fn()} readOnly={readOnly} rawMode={rawMode}
    isScrolledHorizontally={false} totalColumns={1} minRowHeight={40} maxRowHeight={200}
    fixedRowHeight={null} showHiddenTemporarily={false}
  /></tbody></table></LanguageProvider></QueryClientProvider>;
}

it.each([false, true])('activates image controls inside TableGridRow (readonly=%s)', async readOnly => {
  localStorage.setItem('god-crm-language', 'en');
  const edit = vi.fn();
  const mutate = vi.fn();
  const user = userEvent.setup();
  const { container } = render(<Fixture edit={edit} mutate={mutate} readOnly={readOnly} />);
  const open = screen.getByRole('button', { name: 'Open image 1' });
  open.focus();
  for (const key of ['{Enter}', ' ']) {
    await user.keyboard(key);
    expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute('src', '/wide.png');
    await user.keyboard('{Escape}');
    expect(open).toHaveFocus();
  }
  for (const key of ['{Enter}', ' ']) {
    screen.getByRole('button', { name: 'Next image' }).focus();
    await user.keyboard(key);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/portrait.png');
    screen.getByRole('button', { name: 'Previous image' }).focus();
    await user.keyboard(key);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/wide.png');
  }
  expect(container.querySelector('button button')).toBeNull();
  expect(edit).not.toHaveBeenCalled();
  expect(mutate).not.toHaveBeenCalled();
  if (readOnly) {
    expect(container.querySelector('input[type=file]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove image' })).not.toBeInTheDocument();
  }
});

it.each(['image', 'text', 'select', 'file'] as const)('preserves parent keyboard editing for %s in RAW mode', async type => {
  const edit = vi.fn();
  render(<Fixture edit={edit} mutate={vi.fn()} rawMode type={type} />);
  await userEvent.tab();
  await userEvent.keyboard('{Enter} ');
  expect(edit).toHaveBeenCalledTimes(2);
  expect(edit).toHaveBeenCalledWith('7', 'images', '/wide.png,/portrait.png');
});
