import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { AIChatStubProvider } from '@/features/ai-chat/context/AIChatContext';
import { AgentConfigurationFields } from '@/features/ai-chat/components/AIChatPanel/hooks/usePanelContent/AgentConfigurationFields';
import { AgentRowWidget } from '@/features/widgets/components/presets/AgentRowWidget';
import type { AIAgent } from '@/features/ai-chat/types';
import type { Widget } from '@/features/widgets/types/widget.types';

localStorage.setItem('god-crm-language', 'ru');
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const agent = { id: 12, name: 'Reviewer', table_id: 1784, space_id: 7809, icon: '🤖', color: '#336699' } as AIAgent;
const widget = { config: { space_id: 7809 } } as unknown as Widget;
let mode = 'allow';
let handle: string | null = null;
// The fixture exercises production components using local data only.
apiClient.get = async <T,>(url: string): Promise<T> => {
  if (url === '/users/passport-authority?space_id=7809' || url === '/users/passport-authority?row_id=12') {
    if (mode === 'error') throw new Error('Offline');
    return { success: true, data: { allowed: mode === 'allow', reason: mode === 'allow' ? 'ok' : 'space_admin_required', space: { id: 7809 } } } as T;
  }
  if (url === '/ai/agents/7809') return { success: true, data: { agents: [agent] } } as T;
  if (url === '/users/agents?spaceId=7809') return { success: true, data: [{ id: 99, managed_by_agent_row_id: 12, handle }] } as T;
  if (url.includes('/rows/')) return { success: true, data: { row: { data: { main_instructions: 'Original instructions' } } } } as T;
  throw new Error(`Unexpected fixture request: ${url}`);
};
apiClient.post = async <T,>(url: string): Promise<T> => {
  if (mode !== 'allow' || url !== '/users/99/passport') throw new Error('Unexpected passport mutation');
  handle = 'reviewer';
  return { success: true, data: { ok: true, handle } } as T;
};
apiClient.delete = async <T,>(url: string): Promise<T> => {
  if (mode !== 'allow' || url !== '/users/99/passport') throw new Error('Unexpected passport mutation');
  handle = null;
  return { success: true, data: { ok: true } } as T;
};

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><LanguageProvider><AIChatStubProvider>
    <main className="mx-auto max-w-xl p-4 text-[var(--text-primary)]">
      <h1 className="text-xl mb-4">Паспорта агентов</h1>
      <div className="flex gap-3 mb-4">
        {['allow', 'deny', 'error'].map(value => <button type="button" key={value} onClick={() => {
          mode = value;
          void client.invalidateQueries({ queryKey: ['passport-authority'] });
        }}>{value}</button>)}
      </div>
      <section aria-label="Настройки"><AgentConfigurationFields agent={agent} operators={[]} disabled={false} /></section>
      <section aria-label="Ростер" className="mt-6"><AgentRowWidget widget={widget} data={[]} /></section>
    </main>
  </AIChatStubProvider></LanguageProvider></QueryClientProvider>,
);
