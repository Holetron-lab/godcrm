import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useReactTable, getCoreRowModel, type ColumnDef } from '@tanstack/react-table';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TableGrid } from '../TableGrid';
import { ScrollableTextCell } from '../ScrollableTextCell';
import type { ColumnModel, RowModel } from '../../../types/table.types';
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const column: ColumnModel = {
  id: 'text', tableId: 'table', name: 'text', displayName: 'Description', type: 'text', config: {},
  isRequired: false, isReadonly: false, orderIndex: 0, width: 180, isVisible: true, createdAt: '', updatedAt: '',
};
const rows: RowModel[] = [{ id: '1', tableId: 'table', data: { text: 'First line\nSecond line', group: 'A' }, createdAt: '', updatedAt: '', createdBy: 'test' }];
const columns: ColumnModel[] = [column, { ...column, id: 'group', name: 'group' }];
function Grid({ grouped = false, editing = false, readOnly = false, commit = vi.fn(), cancel = vi.fn(), edit = vi.fn() }) {
  const table = useReactTable({ data: rows, columns: columns.map((col): ColumnDef<RowModel> => ({ id: col.id, accessorFn: (row: RowModel) => row.data[col.id], cell: info => String(info.getValue()) })), getCoreRowModel: getCoreRowModel() });
  return <QueryClientProvider client={new QueryClient()}><TableGrid
    table={table} rows={rows} columns={columns} fixedRowHeight={120}
    groupByColumn={grouped ? 'group' : undefined} readOnly={readOnly}
    editingCell={editing ? { rowId: '1', columnId: 'text' } : null}
    draftValue="First line" onDraftChange={vi.fn()} onCommitEdit={commit} onCancelEdit={cancel} onCellDoubleClick={edit}
  /></QueryClientProvider>;
}
it.each([false, true])('renders the full text editor in grouped=%s mode and preserves keyboard semantics', (grouped) => {
  const commit = vi.fn(); const cancel = vi.fn();
  render(<Grid grouped={grouped} editing commit={commit} cancel={cancel} />);
  const input = screen.getByRole('textbox', { name: 'Description' });
  expect(input.tagName).toBe('TEXTAREA');
  expect(input).toHaveFocus();
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true, isComposing: true });
  expect(commit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(commit).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(cancel).toHaveBeenCalledTimes(1);
});
it.each([false, true])('does not edit read-only text in grouped=%s mode', (grouped) => {
  const edit = vi.fn();
  render(<Grid grouped={grouped} readOnly edit={edit} />);
  const region = screen.getAllByRole('group', { name: 'Текст ячейки' })[0];
  fireEvent.doubleClick(region);
  fireEvent.keyDown(region, { key: 'Enter' });
  expect(edit).not.toHaveBeenCalled();
});
it('routes wheel to the table unless held, and releases on blur', () => {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(120);
  const { container } = render(<div style={{ overflowY: 'auto' }}><ScrollableTextCell height={120}>Long text</ScrollableTextCell></div>);
  const parent = container.firstElementChild as HTMLElement;
  Object.defineProperties(parent, { scrollHeight: { value: 800 }, clientHeight: { value: 200 } });
  const region = screen.getByRole('group');
  const button = screen.getByRole('button');
  fireEvent.wheel(region, { deltaY: 40 });
  expect(parent.scrollTop).toBe(40);
  expect(region.scrollTop).toBe(0);
  fireEvent.keyDown(button, { key: ' ' });
  expect(button).toHaveAttribute('aria-pressed', 'true');
  fireEvent.wheel(button, { deltaY: 30 });
  expect(region.scrollTop).toBe(30);
  expect(parent.scrollTop).toBe(40);
  fireEvent.blur(button);
  fireEvent.wheel(region, { deltaY: 20 });
  expect(parent.scrollTop).toBe(60);
  expect(button).toHaveAttribute('aria-pressed', 'false');
});
