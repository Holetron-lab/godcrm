import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { AudioAttachmentPlayer } from '../AudioAttachmentPlayer';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { getAccessToken: () => 'session-token' } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it('authorizes protected playback and download without requiring Web Audio, and releases blobs', async () => {
  localStorage.setItem('god-crm-language', 'en');
  vi.stubGlobal('AudioContext', undefined);
  const fetchMock = vi.fn().mockImplementation(async () => new Response('audio', { headers: { 'content-type': 'video/webm' } }));
  vi.stubGlobal('fetch', fetchMock);
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
    static revokeObjectURL = revoke;
  });
  const { container, rerender, unmount } = render(<LanguageProvider><AudioAttachmentPlayer src="/uploads/first.webm" name="voice.webm" /></LanguageProvider>);
  expect(container.querySelector('audio')).not.toHaveAttribute('src', '/uploads/first.webm');
  await waitFor(() => expect(container.querySelector('audio')).toHaveAttribute('src', 'blob:first'));
  expect(fetchMock).toHaveBeenCalledWith(new URL('/uploads/first.webm', location.href).href, expect.objectContaining({
    headers: { Authorization: `Bearer ${apiClient.getAccessToken()}` }, credentials: 'same-origin', redirect: 'error',
  }));
  fireEvent.click(screen.getByRole('button', { name: 'Audio options' }));
  expect(screen.getByRole('link')).toHaveAttribute('href', 'blob:first');
  rerender(<LanguageProvider><AudioAttachmentPlayer src="/downloads/second.webm" name="voice.webm" /></LanguageProvider>);
  expect(container.querySelector('audio')).not.toHaveAttribute('src', 'blob:first');
  await waitFor(() => expect(container.querySelector('audio')).toHaveAttribute('src', 'blob:second'));
  expect(revoke).toHaveBeenCalledWith('blob:first');
  unmount();
  expect(revoke).toHaveBeenCalledWith('blob:second');
});

it('reports a denied protected fetch and allows retry', async () => {
  localStorage.setItem('god-crm-language', 'en');
  vi.stubGlobal('AudioContext', undefined);
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(new Response('audio', { headers: { 'content-type': 'audio/webm' } }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:retry'; static revokeObjectURL = vi.fn(); });
  const { container } = render(<LanguageProvider><AudioAttachmentPlayer src="/uploads/voice.webm" name="voice.webm" /></LanguageProvider>);
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Play voice.webm' }));
  await waitFor(() => expect(container.querySelector('audio')).toHaveAttribute('src', 'blob:retry'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each(['https://external.example/uploads/voice.webm', '/api/v3/private', 'blob:draft'])(
  'does not send bearer credentials to %s', async (src) => {
    vi.stubGlobal('AudioContext', class {});
    const fetchMock = vi.fn().mockRejectedValue(new Error('unsupported'));
    vi.stubGlobal('fetch', fetchMock);
    render(<LanguageProvider><AudioAttachmentPlayer src={src} name="voice.webm" /></LanguageProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(src, expect.not.objectContaining({ headers: expect.anything() }));
  },
);
