import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
vi.mock('@/shared/components/MarkdownPreview', () => ({ MarkdownPreview: () => <a href="#guide">Guide</a> }));
import { DocumentTileView } from '../DocumentTileView';
const doc = { id: 7, name: 'Handbook', slug: 'handbook', table_id: 42 };

beforeEach(() => {
  localStorage.setItem('god-crm-language', 'ru');
});

it('opens documents with Enter/Space while keeping links and footer actions independent', async () => {
  const user = userEvent.setup(), open = vi.fn(), chat = vi.fn(), submit = vi.fn();
  const { container } = render(<form onSubmit={e => { e.preventDefault(); submit(); }}>
    <DocumentTileView doc={doc} preview="Guide" isLoadingPreview={false} statusOptions={[]} onClick={open} onChat={chat}/>
  </form>, { wrapper: LanguageProvider });
  const trigger = screen.getByRole('button', { name: 'Открыть документ Handbook' });
  trigger.focus(); await user.keyboard('{Enter} ');
  expect(open).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole('link', { name: 'Guide' }));
  await user.click(screen.getByRole('button', { name: 'Открыть чат документа' }));
  expect(open).toHaveBeenCalledTimes(2); expect(chat).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
  expect(container.querySelector('button button, button a')).toBeNull();
});

it('contains deletion focus, restores it on Escape and keeps failed deletion recoverable', async () => {
  const user = userEvent.setup();
  const remove = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
  render(<DocumentTileView doc={doc} preview="" isLoadingPreview={false} statusOptions={[]} onConfirmDelete={remove}/>, { wrapper: LanguageProvider });
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

it.each([
  { language: 'en', open: 'Open document Handbook', status: 'Document status', chat: 'Open document chat', attach: 'Attach to message', download: 'Download Markdown', edit: 'Edit document', remove: 'Delete document' },
  { language: 'ru', open: 'Открыть документ Handbook', status: 'Статус документа', chat: 'Открыть чат документа', attach: 'Прикрепить к сообщению', download: 'Скачать Markdown', edit: 'Редактировать документ', remove: 'Удалить документ' },
])('localizes document card controls in $language', ({ language, open, status, chat, attach, download, edit, remove }) => {
  localStorage.setItem('god-crm-language', language);
  render(<DocumentTileView doc={doc} preview="" isLoadingPreview={false} statusOptions={[{ id: 1, label: 'Draft', slug: 'draft' }]} currentStatus={{ id: 1, label: 'Draft', slug: 'draft' }}
    onClick={vi.fn()} onStatusChange={vi.fn()} onChat={vi.fn()} onAttach={vi.fn()} onDownload={vi.fn()} onSettings={vi.fn()} onConfirmDelete={vi.fn()}
  />, { wrapper: LanguageProvider });
  expect(screen.getByRole('button', { name: open })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: status })).toBeInTheDocument();
  for (const name of [chat, attach, download, edit, remove]) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  }
});
