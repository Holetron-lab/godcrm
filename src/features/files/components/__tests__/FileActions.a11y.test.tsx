import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import { CardFilesPanel } from '@/features/widgets/components/modals/CardFilesPanel';
import { FileCell } from '@/features/tables/components/cells/FileCell';
import { filesApi, type FileModel } from '../../api/filesApi';

vi.mock('../../api/filesApi', () => ({ filesApi: { upload: vi.fn() } }));
vi.mock('../FilePreviewModal', () => ({
  FilePreviewModal: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div role="dialog" aria-label="Preview" /> : null,
  isPreviewable: () => true, detectFileType: () => 'pdf',
}));
vi.mock('@/features/widgets/components/modals/FilePreviewModal', () => ({ getFileIcon: () => '📄' }));

const file: FileModel = { id: '1', name: 'report.pdf', originalName: 'report.pdf', mimeType: 'application/pdf', size: 12, url: '/uploads/report.pdf' };
const attached = { id: file.id, name: file.name, url: file.url, size: file.size, type: file.mimeType, uploadedAt: new Date(0) };
const config = { file: { prefix: '/uploads/', saveFormat: 'filename' as const } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(filesApi.upload).mockResolvedValue(file);
});

it('opens the empty card picker by keyboard without submitting, and disables both upload controls while uploading', async () => {
  const user = userEvent.setup();
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const props = { files: [], uploading: false, isPublicReadOnly: false, onUpload: vi.fn(), onRemove: vi.fn(), onPreview: vi.fn() };
  const { container, rerender } = render(<form onSubmit={submit}><CardFilesPanel {...props} /></form>);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const picker = vi.spyOn(input, 'click').mockImplementation(() => {});
  await user.tab();
  await user.keyboard('{Enter}');
  await user.tab();
  expect(screen.getByRole('button', { name: 'Нажмите для загрузки' })).toHaveFocus();
  await user.keyboard('{Enter} ');
  expect(picker).toHaveBeenCalledTimes(3);
  expect(submit).not.toHaveBeenCalled();
  rerender(<CardFilesPanel {...props} uploading />);
  expect(screen.getByRole('button', { name: 'Нажмите для загрузки' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Загрузка...' })).toBeDisabled();
});

it('keeps card preview, link and remove independently reachable', async () => {
  const user = userEvent.setup();
  const preview = vi.fn(), remove = vi.fn();
  const props = { files: [attached], uploading: false, isPublicReadOnly: false, onUpload: vi.fn(), onRemove: remove, onPreview: preview };
  const { container, rerender } = render(<CardFilesPanel {...props} />);
  const picker = vi.spyOn(container.querySelector('input') as HTMLInputElement, 'click').mockImplementation(() => {});
  await user.tab();
  await user.tab();
  expect(screen.getByRole('button', { name: 'report.pdf' })).toHaveFocus();
  await user.keyboard('{Enter} ');
  expect(preview).toHaveBeenCalledTimes(2);
  await user.tab();
  expect(screen.getByRole('button', { name: 'Просмотр' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('link', { name: 'Открыть' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Удалить' })).toHaveFocus();
  await user.keyboard(' ');
  expect(remove).toHaveBeenCalledWith('1');
  expect(preview).toHaveBeenCalledTimes(2);
  expect(picker).not.toHaveBeenCalled();
  rerender(<CardFilesPanel {...props} isPublicReadOnly />);
  expect(screen.queryByRole('button', { name: 'Добавить' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'report.pdf' }));
  expect(preview).toHaveBeenCalledTimes(3);
});

it('opens the cell picker with Enter/Space and preserves drag-and-drop formatting', async () => {
  const user = userEvent.setup(), update = vi.fn();
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const { container } = render(<form onSubmit={submit}><FileCell tableId={10} rowId="20" columnId="30" value="" config={config} onUpdate={update} /></form>);
  const picker = vi.spyOn(container.querySelector('input') as HTMLInputElement, 'click').mockImplementation(() => {});
  await user.tab();
  const choose = screen.getByRole('button', { name: 'Click or drop files' });
  expect(choose).toHaveFocus();
  await user.keyboard('{Enter} ');
  expect(picker).toHaveBeenCalledTimes(2);
  expect(submit).not.toHaveBeenCalled();
  const upload = new File(['report'], 'report.pdf', { type: 'application/pdf' });
  fireEvent.drop(choose, { dataTransfer: { files: [upload] } });
  await waitFor(() => expect(update).toHaveBeenCalledWith('/uploads/report.pdf'));
  expect(filesApi.upload).toHaveBeenCalledWith([upload], expect.any(Object));
});

it('keeps cell preview and removal separate from upload, including read-only mode', async () => {
  const user = userEvent.setup(), update = vi.fn();
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const { container, rerender } = render(<form onSubmit={submit}><FileCell tableId={10} rowId="20" columnId="30" value={file.url} config={config} onUpdate={update} /></form>);
  const picker = vi.spyOn(container.querySelector('input') as HTMLInputElement, 'click').mockImplementation(() => {});
  const preview = screen.getByRole('button', { name: 'report.pdf' });
  expect(preview.tagName).toBe('BUTTON');
  await user.tab();
  expect(preview).toHaveFocus();
  await user.keyboard(' ');
  expect(screen.getByRole('dialog', { name: 'Preview' })).toBeInTheDocument();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Preview' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('link', { name: 'Open in new tab' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Remove file' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(update).toHaveBeenCalledWith('');
  expect(picker).not.toHaveBeenCalled();
  await user.tab();
  expect(screen.getByRole('button', { name: '+ Add more' })).toHaveFocus();
  await user.keyboard('{Enter} ');
  expect(picker).toHaveBeenCalledTimes(2);
  expect(submit).not.toHaveBeenCalled();
  expect(container.querySelector('button button, button a, button input')).toBeNull();
  rerender(<FileCell tableId={10} rowId="20" columnId="30" value={file.url} config={config} onUpdate={update} readOnly />);
  expect(screen.queryByRole('button', { name: '+ Add more' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Remove file' })).not.toBeInTheDocument();
  expect(container.querySelector('input')).toBeNull();
  fireEvent.drop(screen.getByRole('button', { name: 'report.pdf' }), { dataTransfer: { files: [new File(['x'], 'x.pdf')] } });
  expect(filesApi.upload).not.toHaveBeenCalled();
});
