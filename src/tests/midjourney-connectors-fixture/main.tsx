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
  slug: 'midjourney', display_name: 'Midjourney Relay', icon: '⛵', auth_kind: 'api_key',
  fields: [{ key: 'url', label: 'Relay API URL', type: 'url', required: true }, { key: 'access_token', label: 'Relay API secret', type: 'password', required: true }], authorize_url: null, token_url: null, client_env: null,
  scopes_default: [], scopes_choices: [], refresh_supported: false,
};
let rows: SpaceConnector[] = [];
connectorsApi.catalogue = async () => [type];
connectorsApi.list = async () => rows;
connectorsApi.createApiKey = async (spaceId, body) => {
  const row: SpaceConnector = {
    id: 42, space_id: spaceId, type_slug: body.type_slug, display_name: body.display_name, kind: 'api_key', status: 'active', enabled: true,
    scopes_requested: [], scopes_granted: [], account_label: null, custom_definition: null,
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
  rows = [{ ...rows[0], last_checked_at: new Date().toISOString(), last_error: ok ? null : 'Relay timeout' }];
  return { connector: rows[0], check: {
    ok, checked_at: rows[0].last_checked_at!, latency_ms: 125,
    ...(ok ? {} : { error_code: 'timeout' as const }),
  } };
};
connectorsApi.revoke = async () => { throw new Error('Revoke is outside this fixture'); };

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><LanguageProvider><MemoryRouter>
    <main className="mx-auto max-w-xl p-4">
      <h1 className="mb-4 text-xl text-[var(--text-primary)]">Midjourney Relay</h1>
      <SpaceConnectorsTab spaceId={11} />
    </main>
  </MemoryRouter></LanguageProvider></QueryClientProvider>
);
