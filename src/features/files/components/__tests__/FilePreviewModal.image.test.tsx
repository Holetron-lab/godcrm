import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilePreviewModal } from '../FilePreviewModal';
import { apiClient } from '@/shared/utils/apiClient';

vi.mock('@google/model-viewer', () => ({}));
vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { getAccessToken: vi.fn(() => 'fixture-token') } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('FilePreviewModal protected images', () => {
  it('recovers with the session token, preserves image controls and releases its blob', async () => {
    const fetchImage = vi.fn().mockResolvedValue(new Response('image', { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchImage);
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:preview'; static revokeObjectURL = revoke; });
    const { unmount } = render(<FilePreviewModal isOpen onClose={() => {}} fileUrl="/uploads/spaces/11/image.png" fileName="image.png" fileType="image" />);
    fireEvent.error(screen.getByRole('img', { name: 'image.png' }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'image.png' })).toHaveAttribute('src', 'blob:preview'));
    expect(fetchImage).toHaveBeenCalledWith(new URL('/uploads/spaces/11/image.png', window.location.href).href, expect.objectContaining({
      headers: { Authorization: `Bearer ${apiClient.getAccessToken()}` }, credentials: 'same-origin', redirect: 'error',
    }));
    expect(screen.getByRole('img')).toHaveAttribute('draggable', 'false');
    fireEvent.click(screen.getByTitle('Zoom in'));
    expect(screen.getByRole('img').style.transform).toContain('scale(1.25)');
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:preview');
  });

  it('offers retry after denied access without forwarding credentials to an external image', async () => {
    const fetchImage = vi.fn();
    vi.stubGlobal('fetch', fetchImage);
    render(<FilePreviewModal isOpen onClose={() => {}} fileUrl="https://external.example/image.png" fileName="image.png" fileType="image" />);
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByRole('button', { name: /Повторить загрузку/ })).toBeEnabled();
    expect(fetchImage).not.toHaveBeenCalled();
  });
});
