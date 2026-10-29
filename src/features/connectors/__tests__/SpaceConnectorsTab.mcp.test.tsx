import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { SpaceConnectorsTab } from '../components/SpaceConnectorsTab';

vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mcp = { configured: true, allowed_agent_id: 174642, allowed_space_id: 11, safe_mode: true };
const type = {
  slug: 'blender_mcp', display_name: 'Blender MCP', icon: '🧊', auth_kind: 'mcp',
  fields: [], scopes_default: [], scopes_choices: [], refresh_supported: false, mcp,
};
const connector = {
  id: 42, space_id: 11, type_slug: 'blender_mcp', display_name: 'My Blender',
  kind: 'mcp', status: 'active', enabled: true, mcp,
  scopes_requested: [], scopes_granted: [], last_error: null, last_checked_at: null,
};
const envelope = (data: unknown) => ({ success: true, data, timestamp: '2026-09-28T20:00:00Z' });

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}><LanguageProvider><MemoryRouter>
      <SpaceConnectorsTab spaceId={11} />
    </MemoryRouter></LanguageProvider></QueryClientProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(apiClient.get).mockImplementation(async (url) => envelope(
    url === '/connectors/catalogue' ? { types: [type] } : { connectors: [] }
  ));
});

describe('Blender MCP connectors', () => {
  it('creates without secrets or client-selected scope and refreshes the list', async () => {
    vi.mocked(apiClient.post).mockImplementation(async () => {
      vi.mocked(apiClient.get).mockResolvedValue(envelope({ connectors: [connector] }));
      return envelope({ connector });
    });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Blender MCP/ }));
    expect(screen.getByText(/Agent #174642/)).toBeInTheDocument();
    expect(screen.getByText(/Safe mode is always on/)).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'Display name' }), { target: { value: 'My Blender' } });
    fireEvent.click(screen.getByRole('button', { name: /^Connect$/ }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/spaces/11/connectors', {
      type_slug: 'blender_mcp', display_name: 'My Blender',
    }));
    expect(await screen.findByRole('switch', { name: 'Enable My Blender' })).toBeChecked();
  });

  it.each([
    [{ ...mcp, configured: false }, /not configured on this server/i],
    [{ ...mcp, allowed_space_id: 7809 }, /only available in space #7809/i],
  ])('prevents creation for unavailable server scope', async (config, reason) => {
    vi.mocked(apiClient.get).mockImplementation(async (url) => envelope(
      url === '/connectors/catalogue' ? { types: [{ ...type, mcp: config }] } : { connectors: [] }
    ));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Blender MCP/ }));
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Connect$/ })).toBeDisabled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('prevents duplicates, including a disabled connector', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url) => envelope(
      url === '/connectors/catalogue' ? { types: [type] } : { connectors: [{ ...connector, status: 'disabled', enabled: false }] }
    ));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Blender MCP/ }));
    expect(screen.getByRole('button', { name: /^Connect$/ })).toBeDisabled();
    expect(screen.getByText(/already added/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  });

  it('disables and re-enables using boolean PATCH, without offering OAuth scopes', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url) => envelope(
      url === '/connectors/catalogue' ? { types: [type] } : { connectors: [connector] }
    ));
    vi.mocked(apiClient.patch).mockImplementation(async (_url, body) => envelope({
      connector: { ...connector, enabled: (body as { enabled: boolean }).enabled,
        status: (body as { enabled: boolean }).enabled ? 'active' : 'disabled' },
    }));
    renderTab();
    const toggle = await screen.findByRole('switch', { name: 'Enable My Blender' });
    expect(screen.queryByRole('button', { name: /Edit scopes/ })).toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(apiClient.patch).toHaveBeenLastCalledWith('/spaces/11/connectors/42', { enabled: false });
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(apiClient.patch).toHaveBeenLastCalledWith('/spaces/11/connectors/42', { enabled: true });
  });

  it('keeps the enabled state when PATCH fails and exposes a retryable error', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url) => envelope(
      url === '/connectors/catalogue' ? { types: [type] } : { connectors: [connector] }
    ));
    vi.mocked(apiClient.patch).mockRejectedValue(new Error('Connection lost'));
    renderTab();
    const toggle = await screen.findByRole('switch', { name: 'Enable My Blender' });
    fireEvent.click(toggle);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not update/i);
    expect(toggle).toBeChecked();
    expect(toggle).toBeEnabled();
  });

  it('shows failed checks for active connectors without changing enabled state', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url) => envelope(
      url === '/connectors/catalogue' ? { types: [type] } : { connectors: [connector] }
    ));
    vi.mocked(apiClient.post).mockResolvedValue(envelope({
      connector: { ...connector, last_error: 'MCP timeout', last_checked_at: '2026-09-28T20:00:00Z' },
      check: { ok: false, checked_at: '2026-09-28T20:00:00Z', latency_ms: 20000, error_code: 'timeout', error: 'MCP timeout' },
    }));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('MCP timeout')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enable My Blender' })).toBeChecked();
    expect(screen.getByText(/Last checked/)).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith('/spaces/11/connectors/42/test');
  });

  it('shows successful handshake details and locks actions while checking', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url) => envelope(
      url === '/connectors/catalogue' ? { types: [type] } : { connectors: [connector] }
    ));
    let finish: (value: unknown) => void = () => {};
    vi.mocked(apiClient.post).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(screen.getByRole('switch', { name: 'Enable My Blender' })).toBeDisabled();
    finish(envelope({ connector: { ...connector, last_checked_at: '2026-09-28T20:00:00Z' },
      check: { ok: true, checked_at: '2026-09-28T20:00:00Z', latency_ms: 125, tool_count: 8, server_name: 'Blender', server_version: '1.0' },
    }));
    expect(await screen.findByText(/8 tools/)).toBeInTheDocument();
    expect(screen.getByText(/125 ms/)).toBeInTheDocument();
  });

  it('shows a list error instead of treating unavailable data as an empty list', async () => {
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Offline'));
    renderTab();
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
    expect(screen.queryByText('No connectors linked yet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });

  it.each([
    ['CONNECTOR_NOT_CONFIGURED', /not configured on this server/i],
    ['MCP_SPACE_NOT_ALLOWED', /no longer allowed/i],
    ['CONNECTOR_EXISTS', /already added/i],
  ])('handles %s without losing the entered display name', async (code, reason) => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error(JSON.stringify({ error: { code } })));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Blender MCP/ }));
    const name = screen.getByRole('textbox', { name: 'Display name' });
    fireEvent.change(name, { target: { value: 'Keep this name' } });
    fireEvent.click(screen.getByRole('button', { name: /^Connect$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(reason);
    expect(name).toHaveValue('Keep this name');
    expect(screen.getByRole('button', { name: /^Connect$/ })).toBeEnabled();
  });

  it('shows persisted check errors after reload and does not expose actions on revoked rows', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url) => envelope(
      url === '/connectors/catalogue' ? { types: [type] } : { connectors: [{
        ...connector, status: 'revoked', enabled: false,
        last_error: '<script>bad()</script>', last_checked_at: '2026-09-28T20:00:00Z',
      }] }
    ));
    renderTab();
    expect(await screen.findByText('<script>bad()</script>')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Test connection' })).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText(/Last checked/)).toBeInTheDocument();
  });

  it('accepts a server-side disable during a check without inventing latency', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url) => envelope(
      url === '/connectors/catalogue' ? { types: [type] } : { connectors: [connector] }
    ));
    vi.mocked(apiClient.post).mockResolvedValue(envelope({
      connector: { ...connector, enabled: false, status: 'disabled' },
      check: { ok: false, checked_at: '2026-09-28T20:00:00Z', error_code: 'disabled' },
    }));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Enable the connector before testing.')).toBeInTheDocument();
    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(screen.getByRole('status')).not.toHaveTextContent(/undefined|ms/);
  });
});
