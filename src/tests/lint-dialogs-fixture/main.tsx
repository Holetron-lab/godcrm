import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { ApiKeysManager } from '@/features/api-keys/components/ApiKeysManager';
import { ProjectApiKeysPage } from '@/pages/projects/ProjectApiKeysPage';
import RowViewerModal from '@/features/ai-chat/components/AIChatPanel/components/ChatMessages/RowViewerModal';
import { apiClient } from '@/shared/utils/apiClient';
import { apiKeysApi } from '@/features/api-keys/api/apiKeysApi';

localStorage.setItem('god-crm-language', 'en');
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
const kind = params.get('kind') || 'manager';
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
client.setQueryData(['table-columns', 1], []);
client.setQueryData(['table-info', 1], {});
client.setQueryData(['ticket-data', 'direct', 1], []);
apiKeysApi.list = async () => [];
apiKeysApi.create = async () => { throw new Error('This fixture must not create API keys'); };
apiClient.get = async <T,>(path: string): Promise<T> => {
  if (path.includes('/rows/')) throw new Error('Row unavailable');
  return { data: [] } as T;
};
function Fixture() {
  const [open, setOpen] = useState(false);
  return <main className="p-4">
    {kind === 'manager' && <ApiKeysManager />}
    {kind === 'project' && <ProjectApiKeysPage />}
    {kind === 'row' && <>
      <button type="button" onClick={() => setOpen(true)}>Open row</button>
      <RowViewerModal isOpen={open} onClose={() => setOpen(false)} tableId={1} rowId={2} />
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render(
  <LanguageProvider><QueryClientProvider client={client}><MemoryRouter><Fixture /></MemoryRouter></QueryClientProvider></LanguageProvider>
);
