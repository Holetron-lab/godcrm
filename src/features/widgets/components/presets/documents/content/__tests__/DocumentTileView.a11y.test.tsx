import { expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
vi.mock('@/shared/i18n/LanguageContext', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/components/MarkdownPreview', () => ({ MarkdownPreview: () => <a href="#guide">Guide</a> }));
import { DocumentTileView } from '../DocumentTileView';
const doc = { id: 7, name: 'Handbook', slug: 'handbook', table_id: 42 };

it('opens documents with Enter/Space while keeping links and footer actions independent', async () => {
  const user = userEvent.setup(), open = vi.fn(), chat = vi.fn(), submit = vi.fn();
  const { container } = render(<form onSubmit={e => { e.preventDefault(); submit(); }}>
    <DocumentTileView doc={doc} preview="Guide" isLoadingPreview={false} statusOptions={[]} onClick={open} onChat={chat}/>
  </form>);
  const trigger = screen.getByRole('button', { name: 'Открыть документ Handbook' });
  trigger.focus(); await user.keyboard('{Enter} ');
  expect(open).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole('link', { name: 'Guide' }));
  await user.click(screen.getByRole('button', { name: 'Открыть чат' }));
  expect(open).toHaveBeenCalledTimes(2); expect(chat).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
  expect(container.querySelector('button button, button a')).toBeNull();
});

it('contains deletion focus, restores it on Escape and keeps failed deletion recoverable', async () => {
  const user = userEvent.setup();
  const remove = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
  render(<DocumentTileView doc={doc} preview="" isLoadingPreview={false} statusOptions={[]} onConfirmDelete={remove}/>);
  const trigger = screen.getByRole('button', { name: 'Удалить документ' });
  trigger.focus(); await user.keyboard(' ');
  let dialog = screen.getByRole('dialog', { name: 'Удалить документ?' });
  expect(within(dialog).getByRole('button', { name: 'Отмена' })).toHaveFocus();
  await user.keyboard('{Escape}'); await waitFor(() => expect(trigger).toHaveFocus());
  await user.keyboard('{Enter}'); dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось удалить документ');
  expect(screen.getByRole('dialog')).toBeVisible();
  await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(remove).toHaveBeenCalledTimes(2);
});
