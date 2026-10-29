import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { EditSpaceModal } from '@/features/spaces/components/EditSpaceModal';

localStorage.setItem('god-crm-language', 'en');
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const avatar = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#0f766e"/><circle cx="16" cy="12" r="6" fill="white"/><path d="M4 32a12 12 0 0124 0" fill="white"/></svg>');
const identities = [
  { id: 24, name: 'Architect', avatar, color: '#0f766e', agent_icon: '🔍', user_type: 'agent' },
  { id: 1, name: 'GERATRON', avatar: null, color: '#a16207' },
];
const columns = ['system_user_id', 'name', 'email', 'role', 'active', 'project_viewer'].map(name => ({ id: name, name, type: 'text' }));
const rows = identities.map(user => ({ id: String(user.id), data: { system_user_id: user.id, name: user.name, email: `${user.name.toLowerCase()}@example.test`, role: 'admin', active: true, project_viewer: ['44'] } }));
// All requests stay inside this fixture; no credentials or live API writes.
apiClient.request = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  if (options?.method) return { success: true } as T;
  if (url === '/spaces/11/tree') return { data: [] } as T;
  if (url.endsWith('/settings')) return { data: { owner_id: 1, access_control: { enabled: true, users_table_id: 90, role_column_id: 'role', role_mappings: [] } } } as T;
  if (url.includes('/available-users')) return { data: { users: identities } } as T;
  if (url === '/tables/90/rows') return { data: { rows } } as T;
  if (url === '/tables/90/columns') return { data: columns } as T;
  if (url.endsWith('/tables')) return { data: { tables: [], default_table_id: 90 } } as T;
  if (url.endsWith('/permissions') || url === '/users') return { data: [] } as T;
  throw new Error(`Unexpected fixture request: ${url}`);
};
apiClient.get = async <T,>(url: string): Promise<T> => {
  if (url === '/user-settings/spaces-order') return { success: true, data: {} } as T;
  if (url === '/spaces/11/visibility') return { data: { visibility: 'internal' } } as T;
  throw new Error(`Unexpected fixture GET: ${url}`);
};
function Fixture() {
  const [open, setOpen] = useState(true);
  return <main><h1>Space access</h1><EditSpaceModal open={open} onOpenChange={setOpen} space={{ id: 11, name: 'Vibe KZ', type: 'business' }} /></main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><LanguageProvider><Fixture /></LanguageProvider></QueryClientProvider>);
