import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { filesApi } from '@/features/files/api/filesApi';
import { ImageCell } from '../ImageCell';

afterEach(() => vi.restoreAllMocks());

const url = '/uploads/spaces/11/file_test.png';

it.each([undefined, { prefix: '/uploads/', suffix: '?size=small', saveFormat: 'filename' as const },
  { prefix: 'https://external.example/images/', saveFormat: 'path' as const }])(
  'stores the space file URL unchanged with config %j and renders it after reload', async file => {
    const upload = vi.spyOn(filesApi, 'upload').mockResolvedValue({
      id: 'file_test', name: 'file_test.png', originalName: 'photo.png', mimeType: 'image/png', size: 4, url, spaceId: 11,
    });
    const update = vi.fn();
    const props = { tableId: 1708, rowId: '20', columnId: '30', config: { file }, onUpdate: update };
    const { container, unmount } = render(<ImageCell {...props} value="https://cdn.example/old.png" />, { wrapper: LanguageProvider });
    const input = container.querySelector('input[type=file]');
    expect(input).not.toBeNull();
    const image = new File(['test'], 'photo.png', { type: 'image/png' });
    fireEvent.change(input!, { target: { files: [image] } });
    await waitFor(() => expect(update).toHaveBeenCalledWith(`https://cdn.example/old.png,${url}`));
    expect(upload).toHaveBeenCalledWith([image], expect.objectContaining({ tableId: 1708, rowId: '20', columnId: '30' }));
    unmount();
    render(<ImageCell {...props} value={`https://cdn.example/old.png,${url}`} readOnly />, { wrapper: LanguageProvider });
    expect(screen.getAllByRole('img').map(img => img.getAttribute('src'))).toEqual(['https://cdn.example/old.png', url]);
  }
);

it('allows an empty table image cell to upload without a prefix', () => {
  const { container, rerender } = render(<ImageCell tableId={1708} value="" onUpdate={vi.fn()} />, { wrapper: LanguageProvider });
  expect(container.querySelector('input[type=file]')).not.toBeNull();
  rerender(<ImageCell tableId={1708} value="" onUpdate={vi.fn()} readOnly />);
  expect(container.querySelector('input[type=file]')).toBeNull();
});
