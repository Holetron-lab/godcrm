import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { filesApi } from '@/features/files/api/filesApi';
import { PublicViewProvider } from '@/features/public/PublicViewContext';
import { FileUploaderField } from '../../modals/FileUploaderField';
import { FileCell } from '../../cells/FileCell';
import { renderCellValue } from '../renderCellValue';
import type { ColumnModel } from '../../../types/table.types';

vi.mock('@/features/files/api/filesApi', () => ({ filesApi: { upload: vi.fn() } }));
vi.mock('@/features/files/components/FilePreviewModal', () => ({
  FilePreviewModal: () => null, isPreviewable: () => false, detectFileType: () => 'pdf',
}));
const column: ColumnModel = {
  id: '30', tableId: '10', name: 'files', displayName: 'Files', type: 'file',
  config: { visibility: 'private', file: { prefix: 'https://app.godcrm.ai', saveFormat: 'url' } },
  isRequired: false, isReadonly: false, orderIndex: 0, width: 200, isVisible: true,
};
const scope = { tableId: 10, rowId: '20', columnId: '30' };
const pdf = new File(['pdf'], 'invoice.pdf', { type: 'application/pdf' });
const png = new File(['png'], 'invoice.png', { type: 'image/png' });
const uploaded = [pdf, png].map((file, index) => ({
  id: String(index), name: file.name, originalName: file.name, mimeType: file.type,
  size: file.size, url: `/uploads/spaces/11/${file.name}`,
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(filesApi.upload).mockResolvedValue(uploaded);
});

it('uploads PDF/PNG with scope and persists the file column without losing the supplier', async () => {
  const mutate = vi.fn();
  const row = { id: '20', data: { supplier: '42', '30': '' } };
  const options = { column, value: '', tableId: '10', rowId: '20', rowData: row.data, rows: [row], rowMutation: { mutate } };
  const { rerender } = render(renderCellValue(options));
  fireEvent.drop(screen.getByRole('button', { name: 'Click or drop files' }), { dataTransfer: { files: [pdf, png] } });
  await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  expect(filesApi.upload).toHaveBeenCalledWith([pdf, png], expect.objectContaining({ ...scope, visibility: 'private' }));
  const value = uploaded.map(file => column.config.file!.prefix + file.url).join(',');
  expect(mutate).toHaveBeenCalledWith({ rowId: '20', columnId: '30', value, data: { supplier: '42', '30': value } });
  rerender(renderCellValue({ ...options, value }));
  expect(screen.getByRole('link', { name: 'invoice.pdf' })).toHaveAttribute('href', column.config.file!.prefix + uploaded[0].url);
  expect(screen.getByRole('link', { name: 'invoice.png' })).toHaveAttribute('href', column.config.file!.prefix + uploaded[1].url);
  rerender(<FileUploaderField value={value} onChange={vi.fn()} disabled />);
  expect(screen.getByRole('link', { name: 'invoice.pdf' })).toHaveAttribute('href', column.config.file!.prefix + uploaded[0].url);
  expect(screen.getByRole('link', { name: 'invoice.png' })).toHaveAttribute('href', column.config.file!.prefix + uploaded[1].url);
});

it.each(['tableId', 'rowId', 'columnId', 'onUpdate'] as const)('refuses uploads without %s', key => {
  const props = { ...scope, value: uploaded[0].url, config: column.config, onUpdate: vi.fn(), [key]: undefined };
  const { container } = render(<FileCell {...props} />);
  expect(container.querySelector('input[type="file"]')).toBeNull();
  fireEvent.drop(screen.getByRole('link', { name: 'invoice.pdf' }), { dataTransfer: { files: [png] } });
  expect(filesApi.upload).not.toHaveBeenCalled();
});

it('does not upload from a public read-only table', () => {
  const { container } = render(<PublicViewProvider readOnly publicSlug="invoices"><FileCell {...scope} value="" config={column.config} onUpdate={vi.fn()} /></PublicViewProvider>);
  expect(container.querySelector('input[type="file"]')).toBeNull();
});

it('shows upload errors without replacing existing attachments and allows retry', async () => {
  const update = vi.fn();
  vi.mocked(filesApi.upload).mockRejectedValueOnce(new Error('Access denied'));
  const { container } = render(<FileCell {...scope} value={uploaded[0].url} config={column.config} onUpdate={update} />);
  const input = container.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [png] } });
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  expect(update).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'invoice.pdf' })).toBeInTheDocument();
  vi.mocked(filesApi.upload).mockResolvedValueOnce(uploaded[1]);
  fireEvent.change(input, { target: { files: [png] } });
  await waitFor(() => expect(update).toHaveBeenCalledWith([uploaded[0].url, column.config.file!.prefix + uploaded[1].url].join(',')));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('does not offer upload when the grid row cannot be saved', () => {
  const { container } = render(renderCellValue({ column, value: '', tableId: '10', rowId: '20', rows: [], rowMutation: { mutate: vi.fn() } }));
  expect(container.querySelector('input[type="file"]')).toBeNull();
});

it.each([0, -1, Number.NaN, 1.5])('does not upload with invalid table ID %s', tableId => {
  const { container } = render(<FileCell {...scope} tableId={tableId} value="" config={column.config} onUpdate={vi.fn()} />);
  expect(container.querySelector('input[type="file"]')).toBeNull();
});
