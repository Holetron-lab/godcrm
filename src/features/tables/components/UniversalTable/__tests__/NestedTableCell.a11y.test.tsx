import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { describe, expect, it, vi } from 'vitest';
import { TableGridRow } from '../TableGridRow';
import { TableCell } from '../../cells/TableCell';
import type { ColumnModel, RowModel } from '../../../types/table.types';

const column: ColumnModel = {
  id: 'nested', tableId: '1', name: 'nested', displayName: 'Records', type: 'table',
  config: { table: { tableId: '42' } }, isRequired: false, isReadonly: false,
  orderIndex: 0, width: 200, isVisible: true,
};
const data: RowModel[] = [{ id: '7', tableId: '1', data: { nested: '7' }, createdAt: '', updatedAt: '', createdBy: '1' }];

function Fixture({ open, edit, rawMode = false, grouped = false, readOnly = false }: {
  open: () => void; edit: () => void; rawMode?: boolean; grouped?: boolean; readOnly?: boolean;
}) {
  const table = useReactTable({ data, getCoreRowModel: getCoreRowModel(), columns: [{
    id: 'nested', accessorFn: row => row.data.nested,
    cell: () => <TableCell value="7" column={column} rawMode={rawMode} onOpenNestedTable={open} />,
  }] });
  return <table><tbody><TableGridRow row={table.getRowModel().rows[0]} rowIndex={0}
    columns={[column]} displayColumns={[column]} hiddenColumns={[]} editingCell={null}
    draftValue="" onCellDoubleClick={edit} onDraftChange={vi.fn()}
    onCommitEdit={vi.fn()} onCancelEdit={vi.fn()} readOnly={readOnly} rawMode={rawMode}
    groupByColumn={grouped ? 'group' : null} isScrolledHorizontally={false} totalColumns={1}
    minRowHeight={40} maxRowHeight={200} fixedRowHeight={null} showHiddenTemporarily={false}
  /></tbody></table>;
}

describe('Nested table controls inside real grid rows', () => {
  it.each([false, true])('opens by keyboard without nested buttons or starting edit (grouped: %s)', async grouped => {
    const open = vi.fn();
    const edit = vi.fn();
    render(<Fixture open={open} edit={edit} grouped={grouped} />);
    const button = screen.getByRole('button', { name: 'Показать записи' });
    expect(button.parentElement?.closest('button')).toBeNull();
    await userEvent.setup().tab();
    expect(button).toHaveFocus();
    await userEvent.setup().keyboard('{Enter} ');
    expect(open).toHaveBeenCalledTimes(2);
    expect(edit).not.toHaveBeenCalled();
  });

  it('preserves keyboard editing in RAW mode', async () => {
    const edit = vi.fn();
    render(<Fixture open={vi.fn()} edit={edit} rawMode />);
    await userEvent.setup().tab();
    await userEvent.setup().keyboard('{Enter}');
    expect(edit).toHaveBeenCalledWith('7', 'nested', '7');
  });

  it.each([false, true])('preserves double-click editing permission (readOnly: %s)', async readOnly => {
    const edit = vi.fn();
    render(<Fixture open={vi.fn()} edit={edit} readOnly={readOnly} />);
    await userEvent.setup().dblClick(screen.getByTestId('table-cell'));
    expect(edit).toHaveBeenCalledTimes(readOnly ? 0 : 1);
  });
});
