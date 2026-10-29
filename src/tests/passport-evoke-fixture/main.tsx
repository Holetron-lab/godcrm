import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useSpacesStore } from '@/features/spaces/store/spacesStore';
import { AIChatStubProvider } from '@/features/ai-chat/context/AIChatContext';
import { AgentConfigurationFields } from '@/features/ai-chat/components/AIChatPanel/hooks/usePanelContent/AgentConfigurationFields';
import { AgentRowWidget } from '@/features/widgets/components/presets/AgentRowWidget';
import { useDataQueries } from '@/features/ai-chat/components/AIChatPanel/hooks/useDataQueries';
import { MentionInput, type MentionUser } from '@/features/ai-chat/components/MentionInput';
import { MentionUsersProvider } from '@/features/ai-chat/components/MentionUsersContext';
import { ValidSlugsProvider } from '@/features/ai-chat/context/ValidSlugsContext';
import { HighlightedText } from '@/features/ai-chat/components/HighlightedText';
import type { AIAgent } from '@/features/ai-chat/types';

localStorage.setItem('god-crm-language', 'ru');
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
useAuthStore.setState({ user: { id: '1', name: 'Owner', email: 'fixture@example.test', role: 'owner' } });
useSpacesStore.setState({ spaces: [{ id: 11, name: 'Fixture', owner_id: 1, type: 'team', created_at: '', updated_at: '' }], activeSpaceId: 11, currentSpace: null });
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
const agent = { id: 12, name: 'Quality Reviewer', table_id: 1784, space_id: 11, icon: '🔍', color: '#0f766e' } as AIAgent;
const human = { id: 1, name: 'Human', color: '#a16207' };
let account = false;
let member = false;
let handle: string | null = null;
let fail = false;
// Local API fixtures only. No backend, credentials or real passport writes.
const agentUsers = () => account ? [{ id: 99, name: agent.name, managed_by_agent_table_id: 1784, managed_by_agent_row_id: 12, handle, agent_data: agent }] : [];
apiClient.get = async <T,>(url: string): Promise<T> => {
  if (url === '/users/passport-authority?space_id=11' || url === '/users/passport-authority?row_id=12') {
    return { success: true, data: { allowed: true, reason: 'ok', space: { id: 11 } } } as T;
  }
  if (url.startsWith('/users/agents')) return { success: true, data: agentUsers() } as T;
  if (url === '/users') return { success: true, data: [human, ...agentUsers()] } as T;
  if (url.includes('/available-users')) return { success: true, data: { users: [human, ...(member ? agentUsers() : [])] } } as T;
  if (url.includes('/rows/')) return { success: true, data: { row: { data: { main_instructions: 'Original' } } } } as T;
  if (url.startsWith('/ai/agents')) return { success: true, data: { agents: [agent], total: 1 } } as T;
  if (url === '/chat/unread') return { success: true, data: { total_unread: 0 } } as T;
  throw new Error(`Unexpected fixture GET: ${url}`);
};
apiClient.request = async <T,>(url: string): Promise<T> => {
  if (url === '/spaces' || url === '/projects') return { data: [] } as T;
  throw new Error(`Unexpected fixture request: ${url}`);
};
apiClient.post = async <T,>(url: string): Promise<T> => {
  if (url === '/users/create-agent-user') { account = true; return { success: true, data: agentUsers()[0] } as T; }
  if (url === '/users/99/passport') {
    if (fail) { fail = false; throw new Error('Fixture issuance unavailable'); }
    handle = 'audit-reviewer'; return { success: true, data: { ok: true, handle } } as T;
  }
  throw new Error(`Unexpected fixture POST: ${url}`);
};
apiClient.delete = async <T,>(url: string): Promise<T> => {
  if (url !== '/users/99/passport') throw new Error(`Unexpected fixture DELETE: ${url}`);
  handle = null; return { success: true, data: { ok: true } } as T;
};
function Fixture() {
  const [value, setValue] = useState('Draft ');
  const { usersForMentions = [] } = useDataQueries({ activePanel: 'none', effectiveSpaceId: 11, showAllContacts: false, tasksSource: undefined, tasksSearch: '', filesSource: undefined, showFilePicker: false, chatOperatorId: null, currentAgentOperatorId: undefined, currentAgentProviderId: undefined, contextSpaceId: 11, inboxSearch: '', inboxAgentFilter: '', inboxUserFilter: [], inboxParticipantMode: 'any', inboxDateFrom: '', inboxDateTo: '', inboxSortBy: 'updated', inboxSortDir: 'desc', inboxUnreadOnly: false, isWideMode: false });
  const users: MentionUser[] = usersForMentions.map(user => ({ id: user.id, name: user.name, handle: user.handle, icon: user.agent_icon, color: user.color || undefined, type: user.managed_by_agent_table_id ? 'bot' : 'human' }));
  return <main className="mx-auto max-w-xl p-4 text-[var(--text-primary)]">
    <h1 className="mb-3 text-xl">Паспорта и эвоки</h1>
    <AgentConfigurationFields agent={agent} operators={[]} disabled={false} />
    <section aria-label="Агенты"><AgentRowWidget widget={{ config: { space_id: 11 } } as unknown as Parameters<typeof AgentRowWidget>[0]['widget']} data={[]} /></section>
    <div className="mt-8 border border-[var(--border-primary)] p-2"><MentionInput value={value} onChange={setValue} availableUsers={users} placeholder="Сообщение" /></div>
    <ValidSlugsProvider mentionUsers={users}><MentionUsersProvider agents={[agent]} mentionUsers={users} spaceId={11}><HighlightedText text={value} /></MentionUsersProvider></ValidSlugsProvider>
    <button type="button" onClick={() => { member = !member; void client.invalidateQueries({ queryKey: ['users-for-mentions'] }); }}>Изменить участие в спейсе</button>
    <button type="button" onClick={() => { fail = true; }}>Сбой следующей выдачи</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><LanguageProvider><AIChatStubProvider><Fixture /></AIChatStubProvider></LanguageProvider></QueryClientProvider>);
