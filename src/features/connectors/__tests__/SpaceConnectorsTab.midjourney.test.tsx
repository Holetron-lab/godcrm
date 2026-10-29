import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { SpaceConnectorsTab } from '../components/SpaceConnectorsTab';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const type = {
  slug: 'midjourney', display_name: 'Midjourney Relay', icon: '⛵', auth_kind: 'api_key',
  fields: [
    { key: 'url', label: 'Relay API URL', type: 'url', required: true },
    { key: 'access_token', label: 'Relay API secret', type: 'password', required: true },
  ], scopes_default: [], scopes_choices: [], refresh_supported: false,
};
const connector = { id: 42, space_id: 11, type_slug: 'midjourney', display_name: 'My relay',
  kind: 'api_key', status: 'active', enabled: true, scopes_requested: [], scopes_granted: [] };
const envelope = (data: unknown) => ({ success: true, data });
function renderTab() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <LanguageProvider><MemoryRouter><SpaceConnectorsTab spaceId={11} /></MemoryRouter></LanguageProvider>
  </QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(apiClient.get).mockImplementation(async url => envelope(
    url === '/connectors/catalogue' ? { types: [type] } : { connectors: [] }
  ));
});
describe('Midjourney in space settings', () => {
  it('saves accessible URL/password fields only in the selected space', async () => {
    vi.mocked(apiClient.post).mockResolvedValue(envelope({ connector }));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Midjourney Relay/ }));
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'My relay' } });
    fireEvent.change(screen.getByLabelText(/Relay API URL/), { target: { value: 'https://relay.example.com/mj' } });
    const secret = screen.getByLabelText(/Relay API secret/);
    expect(secret).toHaveAttribute('type', 'password');
    fireEvent.change(secret, { target: { value: 'fixture-secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/spaces/11/connectors', {
      type_slug: 'midjourney', display_name: 'My relay',
      fields: { url: 'https://relay.example.com/mj', access_token: 'fixture-secret' },
    }));
  });
  it('checks the relay and can disable generation without OAuth controls', async () => {
    vi.mocked(apiClient.get).mockImplementation(async url => envelope(
      url === '/connectors/catalogue' ? { types: [type] } : { connectors: [connector] }
    ));
    vi.mocked(apiClient.post).mockResolvedValue(envelope({ connector, check: { ok: true } }));
    vi.mocked(apiClient.patch).mockResolvedValue(envelope({ connector: { ...connector, enabled: false, status: 'disabled' } }));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/spaces/11/connectors/42/test'));
    expect(await screen.findByText(/Relay API responded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Enable My relay' }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/spaces/11/connectors/42', { enabled: false }));
    expect(screen.queryByRole('button', { name: /Edit scopes/ })).toBeNull();
  });
});
