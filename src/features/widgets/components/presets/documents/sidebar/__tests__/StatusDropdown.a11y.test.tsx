import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const mocks = vi.hoisted(() => ({ updateRow: vi.fn(), gate: vi.fn(), ctx: {
  isReadOnly: false, resolveStatus: () => ({ id: 1, label: 'Draft', slug: 'draft' }),
  statusOptions: [{ id: 1, label: 'Draft', slug: 'draft' }, { id: 2, label: 'Review', slug: 'review' }],
} }));
vi.mock('../../DocumentsContext', () => ({ useDocumentsContext: () => mocks.ctx }));
vi.mock('@/features/tables/api/tablesApi', () => ({ tablesApi: { updateRow: mocks.updateRow } }));
vi.mock('@/features/tables/store/tablesStore', () => ({ useTablesStore: { getState: () => ({ openVerificationGate: mocks.gate }) } }));
import { StatusDropdown } from '../StatusDropdown';
const doc = { id: 7, name: 'Guide', slug: 'guide', table_id: 42, status_id: 1 };
beforeEach(() => { vi.clearAllMocks(); mocks.ctx.isReadOnly = false; });

it('selects a status from the keyboard, restores focus and does not navigate the parent row', async () => {
  const user = userEvent.setup(), parent = vi.fn(), updated = vi.fn();
  render(<div onClick={parent} role="presentation"><StatusDropdown doc={doc} registryTableId={2197} onUpdate={updated}/></div>);
  const trigger = screen.getByRole('button', { name: 'Draft' });
  trigger.focus(); await user.keyboard(' ');
  expect(screen.getByRole('dialog', { name: 'Статус документа' }).contains(document.activeElement)).toBe(true);
  screen.getByRole('button', { name: 'Review' }).focus(); await user.keyboard('{Enter}');
  expect(mocks.updateRow).toHaveBeenCalledWith('2197', '7', { status_id: 2, status: 'review' });
  expect(updated).toHaveBeenCalledOnce(); expect(parent).not.toHaveBeenCalled();
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.keyboard('{Enter}{Escape}'); await waitFor(() => expect(trigger).toHaveFocus());
});

it('keeps verification-gated writes in the existing verification flow', async () => {
  mocks.updateRow.mockRejectedValueOnce(Object.assign(new Error('Verification required'), { code: 'VERIFICATION_REQUIRED', details: { verification_column_id: 4, verification_column_name: 'verified' } }));
  const user = userEvent.setup(), updated = vi.fn();
  render(<StatusDropdown doc={doc} registryTableId={2197} onUpdate={updated}/>);
  await user.click(screen.getByRole('button', { name: 'Draft' }));
  await user.click(screen.getByRole('button', { name: 'Review' }));
  expect(mocks.gate).toHaveBeenCalledWith(expect.objectContaining({ tableId: '2197', rowId: '7', reason: 'required' }));
  expect(updated).not.toHaveBeenCalled();
});

it('renders a static badge in read-only mode', () => {
  mocks.ctx.isReadOnly = true;
  render(<StatusDropdown doc={doc} registryTableId={2197} onUpdate={vi.fn()}/>);
  expect(screen.getByText('Draft')).toBeVisible(); expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
