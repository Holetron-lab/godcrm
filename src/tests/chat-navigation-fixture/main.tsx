import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useConversationMessages } from '@/features/ai-chat/hooks/useConversationMessages';
import { useSyncEffects } from '@/features/ai-chat/components/AIChatPanel/hooks/useSyncEffects';
import { ChatInfoBar } from '@/features/ai-chat/components/AIChatPanel/components/ChatHeader/ChatHeaderFull';
import { BindRowChatPrompt } from '@/features/ai-chat/components/AIChatPanel/components/BindRowChatPrompt';
import { WelcomeDashboardWidget } from '@/features/widgets/components/presets/WelcomeDashboardWidget';
import type { Widget } from '@/features/widgets/types/widget.types';

type Participant = { id: number; name: string; type: 'user' | 'agent' };
type SyncParams = Parameters<typeof useSyncEffects>[0];
const noop = () => {};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const owner = { user_id: 1, name: 'Owner', user_type: 'human' };
let serverParticipants = [owner, { user_id: 2, name: 'Frontend', user_type: 'agent' }];
apiClient.get = (async (url: string) => {
  if (url === '/chat/conversations/10') return { data: { id: 10, participants: serverParticipants } };
  if (url.startsWith('/chat/conversations/10/messages?')) return { data: { messages: [{ id: '1', content: 'Hello' }], hasMore: false } };
  throw new Error(`Unexpected fixture API: ${url}`);
}) as typeof apiClient.get;
useAuthStore.setState({ user: { id: '1', name: 'Owner' } as NonNullable<ReturnType<typeof useAuthStore.getState>['user']>, initialized: true });
const widget = { id: 1, config: { starter_tables_map: { 'daily-log': 42 } } } as unknown as Widget;

function Fixture() {
  const { conversation } = useConversationMessages(10);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const partner = { type: 'group' as const, id: 10, name: 'Task chat' };
  useSyncEffects({ agents: [], chatPartner: partner, userConversationId: 10, userConversationData: conversation,
    setChatParticipants: setParticipants, setBoundRows: noop, setShowBoundRowsBar: noop, markAsRead: noop, refetchUnread: noop,
  } as unknown as SyncParams);
  return <div className="max-w-4xl mx-auto">
    <ChatInfoBar chatMode="people" chatPartner={partner} chatParticipants={participants} togglePanel={noop}
      setChatPartner={noop} resolvedConvTitle="Task chat" currentConversationId={null} userConversationId={10}
      renameConversation={noop} conversationMode="group" />
    <div className="flex flex-wrap gap-3 p-3">
      <label>Chat draft<input className="border" /></label>
      <button onClick={() => {
        serverParticipants = [...serverParticipants, { user_id: 3, name: 'Architect', user_type: 'agent' }];
        client.setQueryData(['conversation-messages', 10], { pages: [{ messages: [{ id: '2', content: 'Working' }], hasMore: false }], pageParams: [null] });
      }}>Add agent event</button>
      <button onClick={() => setShowPrompt(true)}>Bind row</button>
    </div>
    <output aria-label="Current route">{location.pathname}{location.search}{location.hash}</output>
    <Routes>
      <Route path="/tables/42" element={<div><p>Journal loaded</p><button onClick={() => navigate(-1)}>Back</button></div>} />
      <Route path="*" element={<WelcomeDashboardWidget widget={widget} data={[]} />} />
    </Routes>
    {showPrompt && <BindRowChatPrompt rowTitle="Test task" onBindCurrent={() => setShowPrompt(false)} onCreateNew={() => setShowPrompt(false)} onClose={() => setShowPrompt(false)} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><LanguageProvider><BrowserRouter><Fixture /></BrowserRouter></LanguageProvider></QueryClientProvider>);
