import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { CardDetailModal } from '../CardDetailModal';
import type { ColumnModel } from '@/features/tables/types/table.types';

vi.mock('@/shared/hooks/useRowChat', () => ({ useRowChat: () => ({ messages: [], isLoading: false, sendMessage: vi.fn(), isSending: false }) }));
vi.mock('@/shared/components/MarkdownPreview', () => ({ MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div> }));
const access = vi.hoisted(() => ({ readOnly: false }));
vi.mock('@/features/public/PublicViewContext', () => ({ useIsPublicReadOnly: () => access.readOnly }));
const columns: ColumnModel[] = [{ id: '2', name: 'main_instructions', displayName: 'MAIN INSTRUCTIONS', type: 'text', tableId: '1', isRequired: false, isReadonly: false, width: 150, isVisible: true, orderIndex: 1, config: {} }];
const card = { id: '42', data: { title: 'Agent', main_instructions: 'Original instructions' } };
function Harness() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>View</button><CardDetailModal isOpen={open} onClose={() => setOpen(false)} card={card} columns={columns} /></>;
}
it('opens text editing by keyboard and restores View after Escape', async () => {
  access.readOnly = false;
  const user = userEvent.setup();
  render(<Harness />);
  const view = screen.getByRole('button', { name: 'View' });
  view.focus();
  await user.keyboard('{Enter}');
  const edit = screen.getByRole('button', { name: 'Редактировать MAIN INSTRUCTIONS' });
  edit.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('textbox')).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(view).toHaveFocus());
});
it('does not expose text editing on public read-only cards', async () => {
  access.readOnly = true;
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'View' }));
  expect(screen.queryByRole('button', { name: 'Редактировать MAIN INSTRUCTIONS' })).not.toBeInTheDocument();
  fireEvent.doubleClick(screen.getByText('Original instructions'));
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  access.readOnly = false;
});
