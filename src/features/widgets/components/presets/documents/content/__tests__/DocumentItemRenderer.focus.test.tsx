import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { DocumentItemRenderer, type DocumentItemRendererProps } from '../DocumentItemRenderer';
const ctx = vi.hoisted(() => ({ editingItemId: null as number | null, selectedItemId: null, editingData: { content: 'Original' }, isReadOnly: false, setSelectedItemId: vi.fn(), setRightPanelMode: vi.fn(), setRightPanelOpen: vi.fn() }));
vi.mock('../../DocumentsContext', () => ({ useDocumentsContext: () => ctx }));
vi.mock('../../atoms/TicketRefAtom', () => ({ useAtomRow: () => ({}), isTicketRefAtomPayload: () => false, TicketRefAtom: () => null }));
vi.mock('@/shared/components/MarkdownPreview', () => ({ MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div> }));
it('returns focus to the text edit button on Escape without saving', async () => {
  const user = userEvent.setup();
  ctx.editingItemId = null;
  const props: DocumentItemRendererProps = {
    item: { id: 1, level: 'text', order: 10, content: 'Original' }, index: 0, itemsCount: 1,
    openMenu: null, openMenuAt: vi.fn(), closeMenu: vi.fn(),
    onStartEditing: vi.fn(() => { ctx.editingItemId = 1; rerender(<DocumentItemRenderer {...props} />); }),
    onCancelEditing: vi.fn(() => { ctx.editingItemId = null; rerender(<DocumentItemRenderer {...props} />); }),
    onSaveEditing: vi.fn(), onAddBefore: vi.fn(), onAddAfter: vi.fn(), onDelete: vi.fn(), onCopy: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(),
  };
  const { rerender } = render(<DocumentItemRenderer {...props} />);
  const trigger = screen.getByRole('button', { name: 'Редактировать текст' });
  trigger.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('textbox', { name: 'Текст блока (Markdown)' })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(props.onSaveEditing).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('returns focus to an empty text block after cancelling an unsaved draft', async () => {
  const user = userEvent.setup();
  ctx.editingItemId = null;
  ctx.editingData = { content: '' };
  const props: DocumentItemRendererProps = {
    item: { id: 2, level: 'text', order: 20, content: '' }, index: 0, itemsCount: 1,
    openMenu: null, openMenuAt: vi.fn(), closeMenu: vi.fn(),
    onStartEditing: vi.fn(() => { ctx.editingItemId = 2; rerender(<DocumentItemRenderer {...props} />); }),
    onCancelEditing: vi.fn(() => { ctx.editingItemId = null; rerender(<DocumentItemRenderer {...props} />); }),
    onSaveEditing: vi.fn(), onAddBefore: vi.fn(), onAddAfter: vi.fn(), onDelete: vi.fn(), onCopy: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(),
  };
  const { rerender } = render(<DocumentItemRenderer {...props} />);
  const trigger = screen.getByRole('button', { name: 'Нажмите чтобы редактировать...' });
  trigger.focus();
  await user.keyboard('{Enter}');
  const editor = screen.getByRole('textbox', { name: 'Текст блока (Markdown)' });
  expect(editor).toHaveFocus();
  ctx.editingData = { content: 'Unsaved draft' };
  rerender(<DocumentItemRenderer {...props} />);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(props.onSaveEditing).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
