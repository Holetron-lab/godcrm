import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { SpaceConnectorsTab } from '@/features/connectors/components/SpaceConnectorsTab';
import { connectorsApi, type CatalogueType, type SpaceConnector } from '@/features/connectors/api/connectorsApi';

const params = new URLSearchParams(location.search);
const language = params.get('language') === 'ru' ? 'ru' : 'en';
localStorage.setItem('god-crm-language', language);
document.documentElement.lang = language;
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark');
const mcp = { configured: true, allowed_agent_id: 174642, allowed_space_id: 11, safe_mode: true as const };
const type: CatalogueType = {
  slug: 'blender_mcp', display_name: 'Blender MCP', icon: '🧊', auth_kind: 'mcp',
  fields: [], authorize_url: null, token_url: null, client_env: null,
  scopes_default: [], scopes_choices: [], refresh_supported: false, mcp,
};
let rows: SpaceConnector[] = [];
connectorsApi.catalogue = async () => [type];
connectorsApi.list = async () => rows;
connectorsApi.createMcp = async (spaceId, body) => {
  const row: SpaceConnector = {
    id: 42, space_id: spaceId, ...body, kind: 'mcp', status: 'active', enabled: true, mcp,
    scopes_requested: [], scopes_granted: [], account_label: null, custom_definition: null,
    expires_at: null, last_refresh_at: null, last_error: null, last_checked_at: null,
    created_by: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), has_payload: false,
  };
  rows = [row];
  return row;
};
connectorsApi.setEnabled = async (_spaceId, _id, enabled) => {
  rows = [{ ...rows[0], enabled, status: enabled ? 'active' : 'disabled' }];
  return rows[0];
};
let checks = 0;
connectorsApi.test = async () => {
  const ok = checks++ > 0;
  rows = [{ ...rows[0], last_checked_at: new Date().toISOString(), last_error: ok ? null : 'MCP timeout' }];
  return { connector: rows[0], check: {
    ok, checked_at: rows[0].last_checked_at!, latency_ms: 125,
    ...(ok ? { tool_count: 8, server_name: 'Blender', server_version: '1.0' } : { error_code: 'timeout' as const }),
  } };
};
connectorsApi.revoke = async () => { throw new Error('Revoke is outside this fixture'); };

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><LanguageProvider><MemoryRouter>
    <main className="mx-auto max-w-xl p-4">
      <h1 className="mb-4 text-xl text-[var(--text-primary)]">Blender MCP</h1>
      <SpaceConnectorsTab spaceId={11} />
    </main>
  </MemoryRouter></LanguageProvider></QueryClientProvider>
);
