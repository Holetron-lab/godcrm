import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const ctx = vi.hoisted(() => ({
  allAtoms: [{ id: 1, key: 'guide', title: 'Guide atom', content: 'Guide content', type: 'reference' }],
  isLoadingAtoms: false, selectedDocumentId: null, items: [], atomsPanelSearchQuery: '',
  atomsDisplayMode: 'list', setAtomsDisplayMode: vi.fn(), updateAtom: vi.fn(), refreshAtoms: vi.fn(),
}));
vi.mock('../../DocumentsContext', () => ({ useDocumentsContext: () => ctx }));
vi.mock('@/shared/components/MarkdownPreview', () => ({ MarkdownPreview: ({ content }: { content: string }) => <p>{content}<a href="#guide">Guide link</a></p> }));
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ language: 'ru' }) }));
import { AtomsListView } from '../AtomsListView';
beforeEach(() => { vi.clearAllMocks(); ctx.atomsDisplayMode = 'list'; });

it('expands with the keyboard and edits independently with focus restored after cancel', async () => {
  const user = userEvent.setup(), submit = vi.fn();
  const { container } = render(<form onSubmit={e => { e.preventDefault(); submit(); }}><AtomsListView/></form>);
  const toggle = await screen.findByRole('button', { name: 'Guide atom' });
  toggle.focus(); await user.keyboard(' ');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Guide content')).toBeVisible();
  const edit = screen.getByRole('button', { name: 'Редактировать' });
  edit.focus(); await user.keyboard('{Enter}');
  const dialog = screen.getByRole('dialog', { name: 'Редактирование атома' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
  await waitFor(() => expect(edit).toHaveFocus());
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  toggle.focus(); await user.keyboard('{Enter}');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(submit).not.toHaveBeenCalled();
  expect(container.querySelector('button button, button a')).toBeNull();
});

it('edits a card with Space, saves content and keeps preview links independent', async () => {
  ctx.atomsDisplayMode = 'cards';
  const user = userEvent.setup();
  render(<AtomsListView/>);
  await user.click(await screen.findByRole('link', { name: 'Guide link' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const edit = screen.getByRole('button', { name: 'Редактировать атом Guide atom' });
  edit.focus(); await user.keyboard(' ');
  await user.clear(screen.getByRole('textbox', { name: 'Название' }));
  await user.type(screen.getByRole('textbox', { name: 'Название' }), 'Revised');
  await user.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(ctx.updateAtom).toHaveBeenCalledWith({ atomId: 1, data: { key: 'guide', title: 'Revised', content: 'Guide content', type: 'reference' } });
  expect(ctx.refreshAtoms).toHaveBeenCalledOnce();
  await waitFor(() => expect(edit).toHaveFocus());
});
