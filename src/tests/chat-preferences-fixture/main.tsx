import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { ChatSendSettings } from '@/pages/settings/components/ChatSendSettings';
import { ProfileSettings } from '@/pages/settings/components/ProfileSettings';
import { MentionInput } from '@/features/ai-chat/components/MentionInput';
import { ChatTurn } from '@/features/ai-chat/components/AIChatPanel/components/ChatMessages/ChatTurn';
import { MentionUsersProvider } from '@/features/ai-chat/components/MentionUsersContext';
import { HumanChatPresenceContext, useHumanChatPresence } from '@/features/ai-chat/hooks/useHumanChatPresence';
import { authApi, type UserProfile } from '@/features/auth/api/authApi';

localStorage.setItem('god-crm-language', 'ru');
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
let profile: UserProfile = { id: 1, name: 'Анна', email: 'anna@example.test', color: '#d97706', avatar: null, role: 'user', totp_enabled: false, created_at: '2026-09-24' };
let lastActivity = Date.now();
let unavailable = false;
// Isolated, in-memory API contract; no authenticated or external network traffic.
authApi.getProfile = async () => ({ success: true, data: profile });
authApi.updateProfile = async data => { profile = { ...profile, ...data }; return { success: true, data: profile }; };
apiClient.post = async <T,>(): Promise<T> => ({ success: true }) as T;
apiClient.get = async <T,>(url: string): Promise<T> => {
  if (url === '/users') return { success: true, data: [profile, { id: 2, name: 'Михаил' }] } as T;
  if (url.startsWith('/ai/agents?')) return { success: true, data: { agents: [], total: 0 } } as T;
  if (url.endsWith('/presence')) {
    if (unavailable) throw new Error('Presence unavailable');
    return { success: true, data: { server_time: new Date().toISOString(), users: url.includes('/11/') ? [{ user_id: 1, last_activity_at: new Date(lastActivity).toISOString() }] : [] } } as T;
  }
  throw new Error(`Unexpected fixture request: ${url}`);
};

function Fixture() {
  const [conversationId, setConversationId] = useState(11);
  const presence = useHumanChatPresence(conversationId, true);
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState('');
  const [count, setCount] = useState(0);
  return <HumanChatPresenceContext.Provider value={presence}>
    <main className="mx-auto max-w-3xl space-y-6 p-4 text-[var(--text-primary)]" data-chat-presence={conversationId}>
      <h1 className="text-xl font-semibold">Настройки и сообщения</h1>
      <ProfileSettings />
      <section aria-label="Внешний вид и локализация CRM" className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4"><ChatSendSettings /></section>
      <ChatTurn turnType="human" senderName="Анна" conversationId={conversationId} messages={[{ id: '1', role: 'user', content: 'Цветная тень справа. Статус относится к этому чату.', timestamp: new Date(), sender_id: 1 }]} />
      <ChatTurn turnType="human" senderName="Михаил" conversationId={conversationId} messages={[{ id: '2', role: 'user', content: 'Тень по умолчанию.', timestamp: new Date(), sender_id: 2 }]} />
      <div className="rounded-lg border border-[var(--border-primary)] p-3"><MentionInput value={draft} onChange={setDraft} onSubmit={() => { setSent(draft); setCount(count + 1); setDraft(''); }} availableUsers={[{ id: 1, name: 'Anna', type: 'human' }]} /></div>
      <p>Отправлено: <output aria-label="Отправлено">{count}</output></p><output aria-label="Текст сообщения" className="whitespace-pre-wrap">{sent}</output>
      <div className="flex flex-wrap gap-4">
        <button onClick={() => { lastActivity = Date.now(); unavailable = false; void client.invalidateQueries({ queryKey: ['human-chat-presence'] }); }}>Собеседник вернулся</button>
        <button onClick={() => setConversationId(id => id === 11 ? 12 : 11)}>Другая беседа</button>
        <button onClick={() => { unavailable = true; void client.invalidateQueries({ queryKey: ['human-chat-presence'] }); }}>Сбой статуса</button>
      </div>
    </main>
  </HumanChatPresenceContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><LanguageProvider><MentionUsersProvider agents={[]}><Fixture /></MentionUsersProvider></LanguageProvider></QueryClientProvider>);
