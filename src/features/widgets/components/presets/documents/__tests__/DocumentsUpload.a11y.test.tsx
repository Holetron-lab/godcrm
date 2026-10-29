import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const ctx = vi.hoisted(() => ({
  showFileUploadModal: true, isReadOnly: false, importLanguage: 'auto', urlInput: '',
  setShowFileUploadModal: vi.fn(), setUrlInput: vi.fn(), setImportLanguage: vi.fn(),
  setNewDocName: vi.fn(), setNewDocDescription: vi.fn(), setImportTree: vi.fn(),
  setIsCreatingMode: vi.fn(), setPreviewMode: vi.fn(),
}));
vi.mock('../DocumentsContext', () => ({ useDocumentsContext: () => ctx }));
vi.mock('../modals/CreateDocumentModal', () => ({ CreateDocumentModal: () => null }));
vi.mock('../modals/EditDocumentModal', () => ({ EditDocumentModal: () => null }));
vi.mock('../modals/StructureEditorModal', () => ({ StructureEditorModal: () => null }));
vi.mock('../modals/ConvertToAtomModal', () => ({ ConvertToAtomModal: () => null }));
vi.mock('../modals/ConvertToTicketModal', () => ({ ConvertToTicketModal: () => null }));
vi.mock('../modals/AgentsModal', () => ({ AgentsModal: () => null }));
vi.mock('../modals/TranslationMissingModal', () => ({ TranslationMissingModal: () => null }));

import { DocumentsModals } from '../DocumentsModals';

describe('Markdown upload controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ctx.showFileUploadModal = true;
    ctx.isReadOnly = false;
    ctx.importLanguage = 'auto';
    ctx.urlInput = '';
  });

  it('opens the picker exactly once with Enter, Space, or the drop-area text', async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const { container } = render(<form onSubmit={submit}><DocumentsModals /></form>);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const picker = vi.fn();
    input.addEventListener('click', picker);
    const choose = screen.getByRole('button', { name: 'Выбрать файл' });
    expect(choose).toHaveAccessibleDescription('Перетащите MD файл сюда');
    expect(choose.querySelector('button, input, a')).toBeNull();
    await user.tab();
    await user.tab();
    expect(choose).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(picker).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(picker).toHaveBeenCalledTimes(2);
    await user.click(screen.getByText('Перетащите MD файл сюда'));
    expect(picker).toHaveBeenCalledTimes(3);
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps Markdown parsing and preview transitions after file selection', async () => {
    const { container } = render(<DocumentsModals />);
    const file = new File(['# Guide\n\n## Section\n\nBody'], 'guide.md', { type: 'text/markdown' });
    Object.defineProperty(file, 'text', { value: async () => '# Guide\n\n## Section\n\nBody' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(ctx.setNewDocName).toHaveBeenCalledWith('Guide'));
    expect(ctx.setImportTree).toHaveBeenCalledWith(expect.any(Array));
    expect(ctx.setImportLanguage).toHaveBeenCalledWith('en');
    expect(ctx.setIsCreatingMode).toHaveBeenCalledWith(true);
    expect(ctx.setPreviewMode).toHaveBeenCalledWith('none');
    expect(ctx.setShowFileUploadModal).toHaveBeenCalledWith(false);
  });

  it('exposes language selection and closes without submitting the parent form', async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={submit}><DocumentsModals /></form>);
    expect(screen.getByRole('button', { name: /Авто/ })).toHaveAttribute('aria-pressed', 'true');
    const russian = screen.getByRole('button', { name: /RU/ });
    expect(russian).toHaveAttribute('aria-pressed', 'false');
    await user.click(russian);
    expect(ctx.setImportLanguage).toHaveBeenCalledWith('ru');
    expect(screen.getByRole('button', { name: 'Загрузить' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Закрыть загрузку Markdown' }));
    expect(ctx.setShowFileUploadModal).toHaveBeenCalledWith(false);
    expect(ctx.setUrlInput).toHaveBeenCalledWith('');
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(['readonly', 'closed'])('hides upload controls when %s', mode => {
    ctx.isReadOnly = mode === 'readonly';
    ctx.showFileUploadModal = mode !== 'closed';
    const { container } = render(<DocumentsModals />);
    expect(screen.queryByRole('button', { name: 'Выбрать файл' })).not.toBeInTheDocument();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });
});
