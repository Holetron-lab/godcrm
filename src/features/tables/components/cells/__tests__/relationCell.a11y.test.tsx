import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { RelationCell } from '../RelationCell';
import type { ColumnRelationConfig } from '../../../types/table.types';
import { apiClient } from '@/shared/utils/apiClient';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { request: vi.fn() } }));

const relation: ColumnRelationConfig = {
  enabled: true, tableId: '42', valueColumn: 'id', labelColumn: 'name',
};

function renderCell(props: Partial<React.ComponentProps<typeof RelationCell>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(apiClient.request).mockResolvedValue({
    data: { rows: [{ id: '7', data: { name: 'Related record', parent_id: '9' } }] },
  });
  const navigate = vi.fn();
  const submit = vi.fn(event => event.preventDefault());
  const parentClick = vi.fn();
  const parentKey = vi.fn();
  render(<QueryClientProvider client={client}>
    <div role="grid" tabIndex={0} onClick={parentClick} onKeyDown={parentKey}>
      <form onSubmit={submit}>
        <RelationCell value="7" relation={relation} onNavigateToRow={navigate} {...props} />
      </form>
    </div>
  </QueryClientProvider>);
  return { navigate, submit, parentClick, parentKey };
}

describe('Relation cell keyboard navigation', () => {
  it.each(['badges', 'tags', 'cards'] as const)('activates %s once per Enter/Space without submitting or activating the parent', async displayMode => {
    const user = userEvent.setup();
    const { navigate, submit, parentClick, parentKey } = renderCell({ relation: { ...relation, displayMode } });
    const button = await screen.findByRole('button', { name: 'Related record' });
    expect(button.tagName).toBe('BUTTON');
    button.focus();
    await user.keyboard('{Enter} ');
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenLastCalledWith('42', '7', 'id');
    expect(submit).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
    expect(parentKey).not.toHaveBeenCalled();
  });

  it.each(['badges', 'tags'] as const)('opens reverse %s by row ID with the keyboard', async displayMode => {
    const user = userEvent.setup();
    const { navigate, submit, parentClick, parentKey } = renderCell({ rowId: '9', relation: { ...relation, lookupMode: 'reverse', valueColumn: 'parent_id', displayMode } });
    const button = await screen.findByRole('button', { name: 'Related record' });
    button.focus();
    await user.keyboard('{Enter} ');
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenLastCalledWith('42', '7');
    expect(submit).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
    expect(parentKey).not.toHaveBeenCalled();
  });

  it('disables navigation when no row opener is provided', async () => {
    renderCell({ onNavigateToRow: undefined });
    expect(await screen.findByRole('button', { name: 'Related record' })).toBeDisabled();
  });

  it('keeps raw values noninteractive', () => {
    renderCell({ rawMode: true });
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(['list', 'count'] as const)('keeps %s mode noninteractive', async displayMode => {
    renderCell({ relation: { ...relation, displayMode } });
    expect(await screen.findByText(displayMode === 'list' ? 'Related record' : '1')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('opens a nested table without submitting its containing form', async () => {
    const open = vi.fn();
    const nested = { filterColumn: 'parent_id', buttonLabel: 'Open records' };
    const { submit } = renderCell({ onOpenNestedTable: open, relation: { ...relation, type: 'nested', nested } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open records' }));
    expect(open).toHaveBeenCalledWith('42', 'parent_id', '7', nested);
    expect(submit).not.toHaveBeenCalled();
  });
});
