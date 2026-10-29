import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { SpaceConnectorsTab } from '../components/SpaceConnectorsTab';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const remote = { slug: 'custom_blender_mcp', display_name: 'Blender MCP (HTTPS)', icon: '🧊', auth_kind: 'mcp', fields: [], scopes_default: [], scopes_choices: [], refresh_supported: false };
const row = { id: 42, space_id: 11, type_slug: remote.slug, display_name: 'My remote', kind: 'mcp', status: 'active', enabled: true, scopes_requested: [], scopes_granted: [], custom_definition: { url: 'https://example.com/mcp', allowed_tools: [] }, last_checked_at: null, last_error: null };
const envelope = (data: unknown) => ({ success: true, data });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><LanguageProvider><MemoryRouter><SpaceConnectorsTab spaceId={11} /></MemoryRouter></LanguageProvider></QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(apiClient.get).mockImplementation(async url => envelope(url === '/connectors/catalogue' ? { types: [remote, { ...remote, slug: 'imap', display_name: 'Mail', auth_kind: 'api_key' }, { ...remote, slug: 'google', display_name: 'Google', auth_kind: 'oauth2' }] } : { connectors: [] }));
});

it('filters catalogue by auth kind and shows empty filter results', async () => {
  mount();
  await screen.findByRole('button', { name: /Blender MCP/ });
  fireEvent.click(screen.getByRole('button', { name: 'MCP' }));
  expect(screen.queryByRole('button', { name: /Mail/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'API key' }));
  expect(screen.getByRole('button', { name: /Mail/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Blender MCP/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'OAuth' }));
  expect(screen.getByRole('button', { name: /Google/ })).toBeInTheDocument();
});

it('creates remote MCP with HTTPS and a write-only token, denying all tools initially', async () => {
  vi.mocked(apiClient.post).mockResolvedValue(envelope({ connector: row }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /Blender MCP/ }));
  const url = screen.getByRole('textbox', { name: 'MCP HTTPS URL' });
  fireEvent.change(url, { target: { value: 'http://localhost:9876' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
  expect(apiClient.post).not.toHaveBeenCalled();
  fireEvent.change(url, { target: { value: 'https://example.com/mcp' } });
  const token = screen.getByLabelText('Bearer token (optional)');
  expect(token).toHaveAttribute('type', 'password');
  fireEvent.change(token, { target: { value: 'secret-test-token' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
  await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/spaces/11/connectors', { type_slug: remote.slug, display_name: remote.display_name, fields: { url: 'https://example.com/mcp', bearer_token: 'secret-test-token' }, allowed_tools: [] }));
  await waitFor(() => expect(screen.queryByLabelText('Bearer token (optional)')).toBeNull());
  expect(document.body.textContent).not.toContain('secret-test-token');
});

it('discovers without approving, then saves exact selected tools', async () => {
  vi.mocked(apiClient.get).mockImplementation(async url => envelope(url === '/connectors/catalogue' ? { types: [remote] } : url.endsWith('/tools') ? { tools: [{ name: 'scene_info', description: 'Read scene' }, { name: 'execute_code', description: '<script>unsafe()</script>' }] } : { connectors: [row] }));
  vi.mocked(apiClient.patch).mockResolvedValue(envelope({ connector: { ...row, custom_definition: { ...row.custom_definition, allowed_tools: ['scene_info'] } } }));
  mount();
  expect(await screen.findByText('Saved · Not checked')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Discover tools' }));
  const tool = await screen.findByRole('checkbox', { name: 'scene_info' });
  expect(tool).not.toBeChecked();
  expect(apiClient.patch).not.toHaveBeenCalled();
  fireEvent.click(tool);
  fireEvent.click(screen.getByRole('button', { name: 'Save tool permissions' }));
  await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/spaces/11/connectors/42', { allowed_tools: ['scene_info'] }));
  expect(await screen.findByText('Tool permissions saved.')).toBeInTheDocument();
  expect(document.querySelector('script')).toBeNull();
});

it('keeps input after a denied creation without rendering the server error or token', async () => {
  vi.mocked(apiClient.post).mockRejectedValue(new Error('403 secret-test-token'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /Blender MCP/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'MCP HTTPS URL' }), { target: { value: 'https://example.com/mcp' } });
  fireEvent.change(screen.getByLabelText('Bearer token (optional)'), { target: { value: 'secret-test-token' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/owner\/admin/);
  expect(screen.getByRole('textbox', { name: 'MCP HTTPS URL' })).toHaveValue('https://example.com/mcp');
  expect(document.body.textContent).not.toContain('secret-test-token');
  expect(screen.getByRole('button', { name: 'Save connection' })).toBeEnabled();
});

it.each(['disabled', 'revoked'])('blocks discovery and testing for %s connections', async status => {
  vi.mocked(apiClient.get).mockImplementation(async url => envelope(url === '/connectors/catalogue' ? { types: [remote] } : { connectors: [{ ...row, status, enabled: false }] }));
  mount();
  await screen.findByText('My remote');
  const discover = screen.queryByRole('button', { name: 'Discover tools' });
  if (status === 'revoked') expect(discover).toBeNull();
  else expect(discover).toBeDisabled();
  expect(apiClient.post).not.toHaveBeenCalled();
});

it('retains selection after a denied save and allows removing previously approved tools', async () => {
  vi.mocked(apiClient.get).mockImplementation(async url => envelope(url === '/connectors/catalogue' ? { types: [remote] } : { connectors: [{ ...row, custom_definition: { ...row.custom_definition, allowed_tools: ['old_tool'] } }] }));
  vi.mocked(apiClient.patch).mockRejectedValueOnce(new Error('403')).mockResolvedValueOnce(envelope({ connector: row }));
  mount();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'old_tool' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save tool permissions' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load or save/);
  expect(screen.getByRole('checkbox', { name: 'old_tool' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Save tool permissions' }));
  expect(await screen.findByText('Tool permissions saved.')).toBeInTheDocument();
  expect(apiClient.patch).toHaveBeenLastCalledWith('/spaces/11/connectors/42', { allowed_tools: [] });
});

it('locks other operations during discovery and can retry a failed discovery', async () => {
  let rejectDiscovery: (error: Error) => void = () => {};
  vi.mocked(apiClient.get).mockImplementation(async url => {
    if (url.endsWith('/tools')) return new Promise((_resolve, reject) => { rejectDiscovery = reject; });
    return envelope(url === '/connectors/catalogue' ? { types: [remote] } : { connectors: [row] });
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Discover tools' }));
  expect(screen.getByRole('switch')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Revoke' })).toBeDisabled();
  rejectDiscovery(new Error('offline'));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Discover tools' })).toBeEnabled();
});

it('explains private GodCRM support without autofilling a public endpoint', async () => {
  vi.mocked(apiClient.get).mockImplementation(async url => envelope(url === '/connectors/catalogue' ? { types: [{ ...remote, slug: 'custom_godcrm_mcp', display_name: 'GodCRM MCP' }] } : { connectors: [] }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: /GodCRM MCP/ }));
  expect(screen.getByText(/Private GodCRM data access is not implemented/)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'MCP HTTPS URL' })).toHaveValue('');
});

it('shows empty catalogue filters and an empty discovered tool list', async () => {
  vi.mocked(apiClient.get).mockImplementation(async url => envelope(url === '/connectors/catalogue' ? { types: [{ ...remote, slug: 'custom_mcp', display_name: 'Remote MCP' }] } : url.endsWith('/tools') ? { tools: [] } : { connectors: [row] }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Discover tools' }));
  expect(await screen.findByText('The server advertised no tools.')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'OAuth' }));
  expect(screen.getByText('No connectors of this type.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  fireEvent.click(screen.getByRole('button', { name: /Remote MCP/ }));
  expect(screen.getByRole('textbox', { name: 'MCP HTTPS URL' })).toHaveValue('');
});

it('preserves unsaved tool choices across disabling and re-enabling', async () => {
  vi.mocked(apiClient.get).mockImplementation(async url => envelope(url === '/connectors/catalogue' ? { types: [remote] } : url.endsWith('/tools') ? { tools: [{ name: 'scene_info' }] } : { connectors: [row] }));
  vi.mocked(apiClient.patch).mockImplementation(async (_url, body) => {
    const enabled = (body as { enabled: boolean }).enabled;
    return envelope({ connector: { ...row, enabled, status: enabled ? 'active' : 'disabled' } });
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Discover tools' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'scene_info' }));
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeChecked());
  fireEvent.click(screen.getByRole('switch'));
  await waitFor(() => expect(screen.getByRole('switch')).toBeChecked());
  expect(screen.getByRole('checkbox', { name: 'scene_info' })).toBeChecked();
});
