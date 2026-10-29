import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { VideoAttachmentPlayer } from '../VideoAttachmentPlayer';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { getAccessToken: () => 'video-token' } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

it('loads protected video only on request, authorizes playback and releases the blob', async () => {
  localStorage.setItem('god-crm-language', 'en');
  const fetchMock = vi.fn().mockResolvedValue(new Response('video', { headers: { 'content-type': 'video/mp4' } }));
  vi.stubGlobal('fetch', fetchMock);
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:video'; static revokeObjectURL = revoke; });
  const { container, unmount } = render(<LanguageProvider><VideoAttachmentPlayer src="/uploads/clip.mp4" name="clip.mp4" /></LanguageProvider>);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Load video: clip.mp4' }));
  await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:video'));
  expect(fetchMock).toHaveBeenCalledWith(new URL('/uploads/clip.mp4', location.href).href, expect.objectContaining({
    headers: { Authorization: 'Bearer video-token' }, credentials: 'same-origin', redirect: 'error',
  }));
  expect(container.querySelector('video')).toHaveAttribute('controls');
  expect(container.querySelector('video')).toHaveAttribute('playsinline');
  expect(container.querySelector('video')).not.toHaveAttribute('autoplay');
  expect(screen.getByRole('link', { name: 'clip.mp4' })).toHaveAttribute('href', 'blob:video');
  unmount();
  expect(revoke).toHaveBeenCalledWith('blob:video');
});

it('reports denied access and retries without losing the filename', async () => {
  localStorage.setItem('god-crm-language', 'en');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 403 }))
    .mockResolvedValueOnce(new Response('video')));
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:retry'; static revokeObjectURL = vi.fn(); });
  const { container } = render(<LanguageProvider><VideoAttachmentPlayer src="/downloads/clip.mp4" name="clip.mp4" /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Load video: clip.mp4' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load video: clip.mp4' }));
  await waitFor(() => expect(container.querySelector('video')).toHaveAttribute('src', 'blob:retry'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.error(container.querySelector('video')!);
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'clip.mp4' })).toHaveAttribute('href', 'blob:retry');
});

it.each(['https://external.example/uploads/clip.mp4', '/api/v3/private', 'blob:draft'])(
  'does not fetch or forward credentials to %s', (src) => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<LanguageProvider><VideoAttachmentPlayer src={src} name="clip.mp4" /></LanguageProvider>);
    expect(container.querySelector('video')).toHaveAttribute('src', src);
    expect(fetchMock).not.toHaveBeenCalled();
  },
);
