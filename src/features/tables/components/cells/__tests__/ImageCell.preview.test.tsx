import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { ImageCell } from '../ImageCell';

vi.mock('@google/model-viewer', () => ({}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('recovers protected thumbnails and uses the chat preview with zoom, rotation and focus return', async () => {
  localStorage.setItem('god-crm-language', 'en');
  vi.spyOn(apiClient, 'getAccessToken').mockReturnValue('fixture-token');
  const fetchImage = vi.fn().mockImplementation(async () => new Response('image', { headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', fetchImage);
  const revoke = vi.fn();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:recovered'; static revokeObjectURL = revoke; });
  const { container, unmount } = render(<ImageCell value="/uploads/spaces/11/image.png" readOnly />, { wrapper: LanguageProvider });
  fireEvent.error(screen.getByRole('img'));
  await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:recovered'));
  expect(fetchImage).toHaveBeenCalledWith(new URL('/uploads/spaces/11/image.png', window.location.href).href, expect.objectContaining({
    headers: { Authorization: 'Bearer fixture-token' }, credentials: 'same-origin', redirect: 'error',
  }));
  const open = screen.getByRole('button', { name: 'Open image 1' });
  open.focus();
  await userEvent.keyboard('{Enter}');
  const dialog = within(screen.getByRole('dialog', { name: 'image.png' }));
  fireEvent.error(dialog.getByRole('img'));
  await waitFor(() => expect(dialog.getByRole('img')).toHaveAttribute('src', 'blob:recovered'));
  fireEvent.click(dialog.getByTitle('Zoom in'));
  expect(dialog.getByRole('img').style.transform).toContain('scale(1.25)');
  fireEvent.click(dialog.getByTitle('Rotate'));
  expect(dialog.getByRole('img').style.transform).toContain('rotate(90deg)');
  await userEvent.keyboard('{Escape}');
  expect(open).toHaveFocus();
  expect(container.querySelector('button button')).toBeNull();
  unmount();
  expect(revoke).toHaveBeenCalledTimes(2);
});

it('offers retry on denied access and never forwards credentials to external images', async () => {
  vi.spyOn(apiClient, 'getAccessToken').mockReturnValue('fixture-token');
  const fetchImage = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
  vi.stubGlobal('fetch', fetchImage);
  const { rerender, container } = render(<ImageCell value="/uploads/denied.png" readOnly />, { wrapper: LanguageProvider });
  fireEvent.error(screen.getByRole('img'));
  await waitFor(() => expect(screen.getByRole('button', { name: /Повторить загрузку/ })).toBeEnabled());
  expect(container.querySelector('button button')).toBeNull();
  fetchImage.mockClear();
  rerender(<ImageCell value="https://external.example/uploads/image.png" readOnly />);
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByRole('button', { name: /Повторить загрузку/ })).toBeEnabled();
  expect(fetchImage).not.toHaveBeenCalled();
});
