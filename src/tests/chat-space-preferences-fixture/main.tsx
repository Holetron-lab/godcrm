import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { ChatSendSettings } from '@/pages/settings/components/ChatSendSettings';
import { useChatState } from '@/features/ai-chat/components/AIChatPanel/hooks/useChatState';
import { AddUsersPanel } from '@/shared/components/access/user-access/AddUsersPanel';
import { SpaceVisibilitySettings } from '@/features/spaces/components/SpaceVisibilitySettings';
import { spacesApi } from '@/features/spaces/api/spacesApi';
import type { SpaceVisibilityData } from '@/features/spaces/types/space.types';
import type { UserAccessLevel } from '@/shared/types/user-access.types';

localStorage.setItem('god-crm-language', 'en');
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
let visibility: SpaceVisibilityData = { visibility: 'internal', public_slug: null, has_password: false, public_sidebar: { default_open: true, hidden: false } };
// In-memory API: no real accounts, credentials or network writes.
spacesApi.getVisibility = async () => visibility;
spacesApi.setVisibility = async (_id, payload) => { visibility = { ...visibility, visibility: payload.visibility }; return visibility; };
const users = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: `Person ${i + 1}`, email: `p${i + 1}@example.test`, user_type: i % 2 ? 'agent' : 'human' }));

function Fixture() {
  const { state, actions } = useChatState();
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<UserAccessLevel>('viewer');
  const [selected, setSelected] = useState<Array<{ userId: number; level: UserAccessLevel }>>([]);
  return <main className="mx-auto max-w-3xl space-y-6 p-4 text-[var(--text-primary)]">
    <h1 className="text-xl font-semibold">Chat and Space preferences</h1>
    <ChatSendSettings />
    <section aria-label="Composer" className="space-y-3">
      <div className="flex gap-4">{[101, 102].map(id => <button key={id} type="button" onClick={() => {
        actions.setChatPartner({ type: 'user', id: 1, name: 'Person' }); actions.setUserConversationId(id);
      }}>Chat {id}</button>)}</div>
      <label htmlFor="fixture-message" className="block">Message</label><textarea id="fixture-message" className="block w-full border border-[var(--border-primary)] bg-[var(--bg-primary)]" value={state.inputValue} onChange={event => actions.setInputValue(event.target.value)} />
      <button type="button" onClick={() => actions.setMessageBoundRows([{ table_id: 1, row_id: 2 }])}>Attach entity</button>
      <output aria-label="Attached entities">{state.messageBoundRows.length}</output>
    </section>
    <SpaceVisibilitySettings spaceId={11} />
    <AddUsersPanel systemUsers={users} usersTableRows={[]} selectedUsersToAdd={selected}
      selectedLevel={level} setSelectedLevel={setLevel} addUserSearchQuery={search} setAddUserSearchQuery={setSearch}
      availableLevels={[{ value: 'viewer', label: 'Viewer' }]} isAddingUser={false}
      onToggleUser={userId => setSelected(previous => previous.some(user => user.userId === userId) ? previous.filter(user => user.userId !== userId) : [...previous, { userId, level }])}
      onUpdateSelectedLevel={(userId, nextLevel) => setSelected(previous => previous.map(user => user.userId === userId ? { ...user, level: nextLevel } : user))}
      onRemoveSelected={userId => setSelected(previous => previous.filter(user => user.userId !== userId))}
      onConfirm={() => {}} onCancel={() => {}} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><LanguageProvider><Fixture /></LanguageProvider></QueryClientProvider>);
