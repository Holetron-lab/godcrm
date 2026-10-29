import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { useSpacesStore } from '@/features/spaces/store/spacesStore';
import type { SpaceModel } from '@/features/spaces/types/space.types';
import { MentionUsersProvider } from '@/features/ai-chat/components/MentionUsersContext';
import { MentionPill } from '@/features/ai-chat/components/InvocationPills';
import { HighlightedText } from '@/features/ai-chat/components/HighlightedText';
import { TurnHeader } from '@/features/ai-chat/components/AIChatPanel/components/ChatMessages/ChatTurn/TurnHeader';

localStorage.setItem('god-crm-language', 'ru');
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
const agent = { id: 123, name: 'Remote Agent', agent_slug: 'remote-helper', icon: '🦊', color: '#cc5500', is_active: false };
// A global namesake must not replace the identity linked to the chat user.
const agentDirectory = [agent, { ...agent, id: 999, icon: '🤖', color: '#3B82F6' }];
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
// Exercise the stored API shape, rather than the legacy editor's roleMapping.
const accessControl = {
  enabled: true, users_table_id: 1782, role_column_id: '13257',
  role_mappings: [{ columnValue: 'writer', accessLevel: 'editor' }],
} as unknown as SpaceModel['access_control'];
const spaces = [11, 12, 13].map(id => ({ id, name: `Space ${id}`, owner_id: 8, type: 'team' as const, created_at: '', updated_at: '', access_control: accessControl }));
useSpacesStore.setState({ spaces, activeSpaceId: 11, currentSpace: null });
// All data is local; the fixture has no backend and makes no authenticated requests.
apiClient.get = async <T,>(url: string): Promise<T> => {
  if (url === '/users') return { success: true, data: [{ id: 7, name: agent.name, managed_by_agent_row_id: 123, agent_icon: agent.icon, agent_color: agent.color }, { id: 8, name: 'Human' }] } as T;
  if (url.startsWith('/ai/agents?')) return { success: true, data: { agents: agentDirectory, total: agentDirectory.length } } as T;
  if (url.includes('/13/')) throw new Error('Fixture access unavailable');
  if (url.endsWith('/available-users')) return { success: true, data: { users: url.includes('/11/') ? [{ id: 7, role: 'writer' }] : [] } } as T;
  if (url.endsWith('/permissions')) return { success: true, data: [] } as T;
  throw new Error(`Unexpected fixture request: ${url}`);
};
function Fixture() {
  const [submits, setSubmits] = useState(0);
  const [commands, setCommands] = useState(0);
  return <main className="mx-auto max-w-lg p-4 text-[var(--text-primary)]">
    <h1 className="mb-6 text-xl">Участники чата</h1>
    <form onSubmit={event => { event.preventDefault(); setSubmits(value => value + 1); }} className="space-y-8">
      <MentionPill slug="remote-helper" onClick={() => setCommands(value => value + 1)} />
      <TurnHeader turnType="agent" senderName="Remote Agent" senderUserId={7} timestamp="12:00" />
      <TurnHeader turnType="human" senderName="Human" senderUserId={8} timestamp="12:01" />
      <HighlightedText text="/remote-helper" onMentionClick={() => setCommands(value => value + 1)} />
    </form>
    <div className="mt-8 flex flex-wrap gap-4">
      {spaces.map(space => <button type="button" key={space.id} onClick={() => useSpacesStore.setState({ activeSpaceId: space.id })}>{space.name}</button>)}
    </div>
    <output aria-label="Submissions">{submits}</output>
    <output aria-label="Commands">{commands}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><LanguageProvider><MentionUsersProvider agents={[]}><Fixture /></MentionUsersProvider></LanguageProvider></QueryClientProvider>);
