import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { authApi } from '@/features/auth/api/authApi';
import { ProfileSettings } from '../ProfileSettings';
vi.mock('@/features/auth/api/authApi', () => ({ authApi: { getProfile: vi.fn(), updateProfile: vi.fn() } }));
const profile = { id: 1, name: 'Tester', email: 'test@example.com', avatar: null, color: '#112233', role: 'user', totp_enabled: false, created_at: '2026-09-18' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authApi.getProfile).mockResolvedValue({ success: true, data: profile });
});
it('persists the selected profile color through the profile API', async () => {
  vi.mocked(authApi.updateProfile).mockResolvedValue({ success: true, data: { ...profile, color: '#abcdef' } });
  renderWithProviders(<ProfileSettings />);
  const input = await screen.findByLabelText('Цвет тени');
  expect(input).toHaveValue('#112233');
  fireEvent.change(input, { target: { value: '#abcdef' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  await waitFor(() => expect(authApi.updateProfile).toHaveBeenCalledWith({ color: '#abcdef' }));
});
it('retains the chosen color and reports an unsupported or failed save', async () => {
  vi.mocked(authApi.updateProfile).mockResolvedValue({ success: true, data: profile });
  renderWithProviders(<ProfileSettings />);
  const input = await screen.findByLabelText('Цвет тени');
  fireEvent.change(input, { target: { value: '#abcdef' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(input).toHaveValue('#abcdef');
});
