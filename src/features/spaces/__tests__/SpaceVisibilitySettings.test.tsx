import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { SpaceVisibilitySettings } from '../components/SpaceVisibilitySettings';
import { spacesApi } from '../api/spacesApi';
vi.mock('../api/spacesApi', () => ({ spacesApi: { getVisibility: vi.fn(), setVisibility: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ showToast: vi.fn() }));

it('uses a labelled select and restores the server value after a failed save', async () => {
  vi.mocked(spacesApi.getVisibility).mockResolvedValue({ visibility: 'internal', has_password: false, public_slug: null, public_sidebar: { default_open: true, hidden: false } });
  vi.mocked(spacesApi.setVisibility).mockRejectedValue(new Error('Denied'));
  renderWithProviders(<SpaceVisibilitySettings spaceId={11} />, { language: 'en' });
  const select = await screen.findByRole('combobox', { name: 'Space visibility' });
  expect(select).toHaveValue('internal');
  fireEvent.change(select, { target: { value: 'open' } });
  await waitFor(() => expect(spacesApi.setVisibility).toHaveBeenCalledWith(11, { visibility: 'open', custom_slug: undefined }));
  await waitFor(() => expect(select).toHaveValue('internal'));
});
