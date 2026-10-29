import '../../styles/index.css';
import { useState } from 'react';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { Modal } from '@/shared/components/ui/Modal';
import { ChatToolbarOverflowMenu } from '@/features/ai-chat/components/AIChatPanel/components/ChatToolbarOverflowMenu';
import { PerChatSettingsInline, type PerChatSettingsTab } from '@/features/ai-chat/components/ChatNotifications/PerChatSettingsInline';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationSpaceDialog } from '@/features/ai-chat/components/AIChatPanel/components/ConversationSpace';
import { useConversationSpace } from '@/features/ai-chat/components/AIChatPanel/hooks/useConversationSpace';

// Isolated browser fixture: all requests resolve locally; no live account or database.
let spaceId: number | null = null;
const variant = new URLSearchParams(location.search).get('variant');
window.fetch = async (input, init) => {
  const path = String(input);
  if (path.includes('/notification-prefs/')) return Response.json({ data: { prefs: null } });
  if (path.endsWith('/spaces')) return Response.json({ data: variant === 'empty' ? [] : [
    { id: 11, name: 'Development', owner_id: 1, user_access_level: 'owner' },
    { id: 12, name: 'Design', owner_id: 2, user_access_level: 'admin' },
    { id: 13, name: 'Read-only', owner_id: 2, user_access_level: 'viewer' },
  ] });
  if (path.endsWith('/space') && init?.method === 'PATCH') {
    spaceId = (JSON.parse(String(init.body)) as { space_id: number }).space_id;
    return Response.json({ success: true, data: { id: 44, space_id: spaceId } });
  }
  if (path.endsWith('/chat/conversations/44')) return Response.json({ data: { id: 44, created_by: variant === 'participant' ? 2 : 1, space_id: spaceId, type: 'chat' } });
  throw new Error(`Unexpected fixture request: ${path}`);
};
function Fixture() {
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<PerChatSettingsTab | null>(null);
  const binding = useConversationSpace({ conversationId: 44, partnerKey: 'group:44', userId: 1, createConversation: async () => 44, onCreated: () => {} });
  return <main className="mx-auto max-w-lg p-4">
    <h1 className="mb-4 text-xl">Настройки чата</h1>
    <ChatToolbarOverflowMenu onSettings={() => setTab('settings')} onNotifications={() => setTab('notifications')}
      onParticipants={() => setTab('participants')} onDelete={() => setNotice('Delete requested')} />
    {tab && <Modal open title="Настройки чата" restoreFocus onOpenChange={open => { if (!open) setTab(null); }}>
      <PerChatSettingsInline conversationId={44} currentUserId={1} initialTab={tab} conversationSpace={binding} onClose={() => setTab(null)} />
    </Modal>}
    <button className="mt-4 rounded border p-2" onClick={() => void binding.ensureSpace().then(id => setNotice(`Space #${id}`)).catch(error => setNotice(error.message))}>Прикрепить файл</button>
    <label className="mt-4 block">Черновик<input defaultValue="Не потерять текст" className="block w-full rounded border p-2" /></label>
    <p role="status">{notice}</p>
    <ConversationSpaceDialog binding={binding} userId={1} />
  </main>;
}
localStorage.setItem('god-crm-language', 'ru');
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LanguageProvider><Fixture /></LanguageProvider></QueryClientProvider>);
