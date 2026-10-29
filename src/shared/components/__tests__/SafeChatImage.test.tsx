import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SafeChatImage } from '../SafeChatImage';
import { apiClient } from '@/shared/utils/apiClient';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { getAccessToken: vi.fn<() => string | null>(() => null) } }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.mocked(apiClient.getAccessToken).mockReturnValue(null); });

describe('SafeChatImage recovery', () => {
  it('lets the user retry a failed image without opening the preview', () => {
    const onClick = vi.fn();
    render(<SafeChatImage src="/uploads/one.jpg" alt="Screenshot" onClick={onClick} />);
    fireEvent.error(screen.getByRole('img'));
    fireEvent.click(screen.getByRole('button', { name: /Повторить загрузку/ }));
    expect(screen.getByRole('img')).toHaveAttribute('src', '/uploads/one.jpg');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loads a new source after the previous source failed', () => {
    const { rerender } = render(<SafeChatImage src="/uploads/one.jpg" alt="Screenshot" />);
    fireEvent.error(screen.getByRole('img'));
    rerender(<SafeChatImage src="/uploads/two.jpg" alt="Screenshot" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/uploads/two.jpg');
  });

  it('requires consent again when an oversized inline source changes', () => {
    const src = 'data:image/png;base64,' + 'a'.repeat(256 * 1024);
    const { rerender } = render(<SafeChatImage src={src} alt="Large" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('img')).toBeInTheDocument();
    rerender(<SafeChatImage src={src + 'b'} alt="Large" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});


describe('authenticated image recovery', () => {
  it('recovers a protected image with the existing session token and releases its blob', async () => {
    vi.mocked(apiClient.getAccessToken).mockReturnValue('session-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response('image', { headers: { 'content-type': 'image/jpeg' } }));
    vi.stubGlobal('fetch', fetchMock);
    const create = vi.fn(() => 'blob:recovered');
    const revoke = vi.fn();
    vi.stubGlobal('URL', class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
    const { unmount } = render(<SafeChatImage src="/uploads/test.jpg" alt="Screenshot" />);
    fireEvent.error(screen.getByRole('img'));
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:recovered'));
    expect(fetchMock).toHaveBeenCalledWith(new URL('/uploads/test.jpg', window.location.href).href, expect.objectContaining({
      headers: { Authorization: 'Bearer session-token' }, credentials: 'same-origin', redirect: 'error',
    }));
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:recovered');
  });

  it.each(['https://external.example/uploads/test.jpg', '/api/v3/private', 'data:image/png;base64,bad'])(
    'never sends the token to %s', async (src) => {
      vi.mocked(apiClient.getAccessToken).mockReturnValue('session-token');
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      render(<SafeChatImage src={src} alt="Screenshot" />);
      fireEvent.error(screen.getByRole('img'));
      expect(screen.getByRole('button', { name: /Повторить/ })).toBeEnabled();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('keeps a retry action when authorization fails', async () => {
    vi.mocked(apiClient.getAccessToken).mockReturnValue('session-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    render(<SafeChatImage src="/uploads/test.jpg" alt="Screenshot" />);
    fireEvent.error(screen.getByRole('img'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Повторить/ })).toBeEnabled());
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
