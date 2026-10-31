import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { DocumentItemRenderer, type DocumentItemRendererProps } from '../DocumentItemRenderer';
const ctx = vi.hoisted(() => ({ editingItemId: null as number | null, selectedItemId: null, editingData: { content: 'Original' }, isReadOnly: false, setSelectedItemId: vi.fn(), setRightPanelMode: vi.fn(), setRightPanelOpen: vi.fn() }));
vi.mock('../../DocumentsContext', () => ({ useDocumentsContext: () => ctx }));
vi.mock('../../atoms/TicketRefAtom', () => ({ useAtomRow: () => ({}), isTicketRefAtomPayload: () => false, TicketRefAtom: () => null }));
vi.mock('@/shared/components/MarkdownPreview', () => ({ MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div> }));
it('returns focus to the text edit button on Escape without saving', async () => {
  const user = userEvent.setup();
  localStorage.setItem('god-crm-language', 'ru');
  ctx.editingItemId = null;
  const props: DocumentItemRendererProps = {
    item: { id: 1, level: 'text', order: 10, content: 'Original' }, index: 0, itemsCount: 1,
    openMenu: null, openMenuAt: vi.fn(), closeMenu: vi.fn(),
    onStartEditing: vi.fn(() => { ctx.editingItemId = 1; rerender(<LanguageProvider><DocumentItemRenderer {...props} /></LanguageProvider>); }),
    onCancelEditing: vi.fn(() => { ctx.editingItemId = null; rerender(<LanguageProvider><DocumentItemRenderer {...props} /></LanguageProvider>); }),
    onSaveEditing: vi.fn(), onAddBefore: vi.fn(), onAddAfter: vi.fn(), onDelete: vi.fn(), onCopy: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(),
  };
  const { rerender } = render(<LanguageProvider><DocumentItemRenderer {...props} /></LanguageProvider>);
  const trigger = screen.getByRole('button', { name: 'Редактировать текст' });
  expect(trigger).toBeEmptyDOMElement();
  expect(trigger).toHaveClass('sr-only');
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
    onStartEditing: vi.fn(() => { ctx.editingItemId = 2; rerender(<LanguageProvider><DocumentItemRenderer {...props} /></LanguageProvider>); }),
    onCancelEditing: vi.fn(() => { ctx.editingItemId = null; rerender(<LanguageProvider><DocumentItemRenderer {...props} /></LanguageProvider>); }),
    onSaveEditing: vi.fn(), onAddBefore: vi.fn(), onAddAfter: vi.fn(), onDelete: vi.fn(), onCopy: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(),
  };
  const { rerender } = render(<LanguageProvider><DocumentItemRenderer {...props} /></LanguageProvider>);
  const trigger = screen.getByRole('button', { name: 'Нажмите чтобы редактировать...' });
  trigger.focus();
  await user.keyboard('{Enter}');
  const editor = screen.getByRole('textbox', { name: 'Текст блока (Markdown)' });
  expect(editor).toHaveFocus();
  ctx.editingData = { content: 'Unsaved draft' };
  rerender(<LanguageProvider><DocumentItemRenderer {...props} /></LanguageProvider>);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(props.onSaveEditing).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('uses English editor controls and preserves Escape focus behavior', async () => {
  const user = userEvent.setup();
  localStorage.setItem('god-crm-language', 'en');
  ctx.editingItemId = null;
  ctx.editingData = { content: 'Original' };
  const props: DocumentItemRendererProps = {
    item: { id: 3, level: 'text', order: 30, content: 'Original' }, index: 0, itemsCount: 1,
    openMenu: null, openMenuAt: vi.fn(), closeMenu: vi.fn(),
    onStartEditing: vi.fn(() => { ctx.editingItemId = 3; rerender(<LanguageProvider><DocumentItemRenderer {...props} /></LanguageProvider>); }),
    onCancelEditing: vi.fn(() => { ctx.editingItemId = null; rerender(<LanguageProvider><DocumentItemRenderer {...props} /></LanguageProvider>); }),
    onSaveEditing: vi.fn(), onAddBefore: vi.fn(), onAddAfter: vi.fn(), onDelete: vi.fn(), onCopy: vi.fn(), onMoveUp: vi.fn(), onMoveDown: vi.fn(),
  };
  const { rerender } = render(<LanguageProvider><DocumentItemRenderer {...props} /></LanguageProvider>);
  expect(screen.getByTitle('Menu')).toBeInTheDocument();
  const trigger = screen.getByRole('button', { name: 'Edit text' });
  trigger.focus();
  await user.keyboard('{Enter}');
  const editor = screen.getByRole('textbox', { name: 'Block text (Markdown)' });
  expect(editor).toHaveAttribute('placeholder', 'Enter text in Markdown...');
  expect(editor).toHaveFocus();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(props.onSaveEditing).not.toHaveBeenCalled();
});
