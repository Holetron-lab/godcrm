import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import { FileUploader } from '../FileUploader';
import { FileBrowser } from '../FileBrowser';
import { MiniFileUploader } from '@/features/widgets/components/presets/MiniFileUploader';
import { MiniFileUploader as KanbanUploader } from '@/features/widgets/components/presets/kanban/MiniFileUploader';
import { filesApi, type FileModel } from '../../api/filesApi';

vi.mock('../../api/filesApi', () => ({
  filesApi: { upload: vi.fn(), list: vi.fn(), delete: vi.fn() },
  getFileIcon: () => '📄', formatFileSize: () => '1 KB',
}));
vi.mock('../FilePreviewModal', () => ({
  FilePreviewModal: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div role="dialog" aria-label="Preview" /> : null,
  isPreviewable: () => true, detectFileType: () => 'pdf',
}));

const file: FileModel = { id: '1', name: 'report.pdf', originalName: 'report.pdf', mimeType: 'application/pdf', size: 12, url: '/uploads/report.pdf' };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(filesApi.upload).mockResolvedValue(file);
  vi.mocked(filesApi.list).mockResolvedValue({ files: [file], pagination: { page: 1, limit: 100, total: 1, pages: 1 } });
});

describe('file controls keyboard access', () => {
  it('opens the picker with Enter and Space without submitting its form', async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const { container } = render(<form onSubmit={submit}><FileUploader /></form>);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const picker = vi.spyOn(input, 'click').mockImplementation(() => {});
    await user.tab();
    expect(screen.getByRole('button', { name: /выберите файлы/ })).toHaveFocus();
    await user.keyboard('{Enter} ');
    expect(picker).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
  });

  it('keeps dropped files and size validation working', async () => {
    const complete = vi.fn();
    const error = vi.fn();
    render(<FileUploader maxSize={1} spaceId={11} onUploadComplete={complete} onError={error} />);
    const zone = screen.getByRole('button', { name: /выберите файлы/ });
    const small = new File(['test'], 'report.pdf', { type: 'application/pdf' });
    fireEvent.drop(zone, { dataTransfer: { files: [small] } });
    await waitFor(() => expect(complete).toHaveBeenCalledWith([file]));
    expect(filesApi.upload).toHaveBeenCalledWith([small], expect.objectContaining({ spaceId: 11 }));
    fireEvent.drop(zone, { dataTransfer: { files: [new File([new Uint8Array(1048577)], 'large.pdf')] } });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('too large'));
    expect(filesApi.upload).toHaveBeenCalledOnce();
  });

  it.each([['preset', MiniFileUploader], ['kanban', KanbanUploader]] as const)('%s keeps picker, links and removal independent', async (_, Uploader) => {
    const user = userEvent.setup();
    const update = vi.fn();
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const { container } = render(<form onSubmit={submit}><Uploader value={file.url} fieldName="files" displayName="Вложения" onUpdate={update} /></form>);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const picker = vi.spyOn(input, 'click').mockImplementation(() => {});
    await user.tab();
    const choose = screen.getByRole('button', { name: /Добавить ещё.*Вложения/ });
    expect(choose).toHaveFocus();
    await user.keyboard('{Enter} ');
    expect(picker).toHaveBeenCalledTimes(2);
    await user.tab();
    expect(screen.getByRole('link', { name: 'report.pdf' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Удалить report.pdf' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(update).toHaveBeenCalledWith('files', '');
    expect(picker).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
    expect(choose.querySelector('a, button, input')).toBeNull();
    await user.upload(input, new File(['new'], 'new.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('files', `${file.url},${file.url}`));
  });

  it('selects a card with Enter/Space and keeps preview separate', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    render(<FileBrowser spaceId={11} showUploader={false} onFileSelect={select} />);
    const choose = await screen.findByRole('button', { name: 'Выбрать report.pdf' });
    for (let i = 0; i < 5 && document.activeElement !== choose; i++) await user.tab();
    expect(choose).toHaveFocus();
    await user.keyboard('{Enter} ');
    expect(select).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenLastCalledWith(file);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Просмотр' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Preview' })).toBeInTheDocument();
    expect(select).toHaveBeenCalledTimes(2);
    expect(choose.querySelector('button')).toBeNull();
  });
});
