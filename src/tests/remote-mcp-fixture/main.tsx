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
const type: CatalogueType = {
  slug: 'custom_blender_mcp', display_name: 'Blender MCP (HTTPS)', icon: '🧊', auth_kind: 'mcp',
  fields: [], authorize_url: null, token_url: null, client_env: null,
  scopes_default: [], scopes_choices: [], refresh_supported: false,
};
let rows: SpaceConnector[] = [];
connectorsApi.catalogue = async () => [type, { ...type, slug: 'custom_api_key', auth_kind: 'api_key', display_name: 'API key' }];
connectorsApi.list = async () => rows;
connectorsApi.createMcp = async (spaceId, body) => {
  if (!body.fields?.url.startsWith('https:') || body.allowed_tools?.length) throw new Error('Invalid fixture request');
  const row: SpaceConnector = {
    id: 42, space_id: spaceId, type_slug: body.type_slug, display_name: body.display_name,
    kind: 'mcp', status: 'active', enabled: true,
    scopes_requested: [], scopes_granted: [], account_label: null,
    custom_definition: { url: body.fields.url, allowed_tools: [] },
    expires_at: null, last_refresh_at: null, last_error: null, last_checked_at: null,
    created_by: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), has_payload: true,
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
  rows = [{ ...rows[0], last_checked_at: new Date().toISOString(), last_error: ok ? null : 'Remote MCP connection failed' }];
  return { connector: rows[0], check: {
    ok, checked_at: rows[0].last_checked_at!,
    ...(ok ? { tool_count: 2, server_info: { name: 'Blender', version: '1.0' } } : { error_code: 'remote' as const }),
  } };
};
connectorsApi.discoverTools = async () => [
  { name: 'scene_info', description: 'Read the Blender scene' },
  { name: 'execute_code', description: 'Execute code in Blender. Only allow for trusted callers.' },
];
connectorsApi.setAllowedTools = async (_spaceId, _id, allowed_tools) => {
  rows = [{ ...rows[0], custom_definition: { ...rows[0].custom_definition, allowed_tools } }];
  return rows[0];
};
connectorsApi.revoke = async () => {
  rows = [{ ...rows[0], status: 'revoked', enabled: false }];
  return { id: 42, status: 'revoked' };
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><LanguageProvider><MemoryRouter>
    <main className="mx-auto max-w-xl p-4">
      <h1 className="mb-4 text-xl text-[var(--text-primary)]">Remote MCP</h1>
      <SpaceConnectorsTab spaceId={11} />
    </main>
  </MemoryRouter></LanguageProvider></QueryClientProvider>
);
