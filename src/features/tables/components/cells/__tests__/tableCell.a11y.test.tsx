import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { TableCell } from '../TableCell';
import type { ColumnModel, TableColumnConfig } from '../../../types/table.types';

const column: ColumnModel = {
  id: 'nested', tableId: '1', name: 'nested', displayName: 'Records', type: 'table',
  config: {}, isRequired: false, isReadonly: false, orderIndex: 0, width: 200, isVisible: true,
};
const nested = { filterColumn: 'parent_id', buttonLabel: 'Records' };

function renderCell(table: TableColumnConfig, props: Partial<React.ComponentProps<typeof TableCell>> = {}, count = 5) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['embedded-table-info', '42'], { columns: [{ name: 'name', displayName: 'Name' }] });
  client.setQueryData(['embedded-table-rows', '42', 'parent_id', '7'], {
    rows: Array.from({ length: count }, (_, index) => ({ id: String(index), data: { name: `Record ${index + 1}` } })), total: count,
  });
  const open = vi.fn();
  const toggle = vi.fn();
  const submit = vi.fn(event => event.preventDefault());
  const parentClick = vi.fn();
  const parentKey = vi.fn();
  render(<QueryClientProvider client={client}>
    <div role="grid" tabIndex={0} onClick={parentClick} onKeyDown={parentKey}>
      <form onSubmit={submit}>
        <TableCell value="7" column={{ ...column, config: { table: { tableId: '42', nested, ...table } } }}
          onOpenNestedTable={open} onToggleInlineExpand={toggle} {...props} />
      </form>
    </div>
  </QueryClientProvider>);
  return { open, toggle, submit, parentClick, parentKey };
}

describe('Table cell keyboard controls', () => {
  it.each([
    { displayMode: 'modal' }, { displayMode: 'inline' },
    { displayMode: 'embedded', expandAction: 'modal' }, { displayMode: 'embedded', expandAction: 'inline' },
  ] as const)('disables unavailable navigation: %j', async table => {
    renderCell(table, { onOpenNestedTable: undefined, onToggleInlineExpand: undefined });
    expect(screen.getByRole('button')).toBeDisabled();
    await userEvent.setup().tab();
    await userEvent.setup().tab();
    expect(screen.getByRole('button')).not.toHaveFocus();
  });

  it('announces inline expansion controlled by the parent', () => {
    renderCell({ displayMode: 'inline' }, { isExpanded: true });
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  });

  it.each([0, 3])('does not offer expansion for %s embedded rows', count => {
    renderCell({ displayMode: 'embedded' }, {}, count);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    if (!count) expect(screen.getByText('Нет записей')).toBeInTheDocument();
  });

  it('keeps an unconfigured table noninteractive', () => {
    renderCell({ tableId: undefined });
    expect(screen.getByText('Таблица не настроена')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(['modal', 'inline'] as const)('opens %s once per activation and preserves external row filters', async displayMode => {
    const user = userEvent.setup();
    const { open, toggle, submit, parentClick, parentKey } = renderCell({ displayMode }, { rowData: { id: 'ext_148_2_7958' } });
    const button = screen.getByRole('button', { name: 'Показать записи' });
    expect(button.tagName).toBe('BUTTON');
    button.focus();
    await user.keyboard('{Enter} ');
    await user.click(button);
    const action = displayMode === 'modal' ? open : toggle;
    expect(action).toHaveBeenCalledTimes(3);
    expect(action).toHaveBeenLastCalledWith(...(displayMode === 'modal' ? ['42', 'parent_id', '7958', nested] : ['42', 'parent_id', '7958']));
    expect(submit).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
    expect(parentKey).not.toHaveBeenCalled();
  });

  it.each(['modal', 'inline'] as const)('opens embedded %s with the same filter and config', async expandAction => {
    const { open, toggle, submit, parentClick, parentKey } = renderCell({ displayMode: 'embedded', expandAction });
    const button = screen.getByRole('button', { name: 'Показать записи (5)' });
    button.focus();
    await userEvent.setup().keyboard('{Enter} ');
    const action = expandAction === 'modal' ? open : toggle;
    expect(action).toHaveBeenCalledTimes(2);
    expect(action).toHaveBeenLastCalledWith(...(expandAction === 'modal' ? ['42', 'parent_id', '7', nested] : ['42', 'parent_id', '7']));
    expect(screen.queryByText('Record 4')).not.toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
    expect(parentKey).not.toHaveBeenCalled();
  });

  it('expands and collapses embedded rows with announced state', async () => {
    const { open, toggle, submit } = renderCell({ displayMode: 'embedded', expandAction: 'expand' });
    const button = screen.getByRole('button', { name: 'Показать записи (5)' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    button.focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(screen.getByText('Record 5')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAccessibleName('Свернуть');
    await userEvent.setup().keyboard(' ');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Record 4')).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
