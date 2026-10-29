import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { ChatListView } from '@/features/ai-chat/components/ChatListView';
import { ChatConversationView } from '@/features/ai-chat/components/ChatConversationView';

const chats = [
  { id: 1, title: 'Команда — обсуждение следующего релиза', type: 'group' as const, unreadCount: 3 },
  { id: 2, title: 'Дизайн', type: 'direct' as const },
];
function Fixture() {
  const [selection, setSelection] = useState(0);
  const [action, setAction] = useState('');
  return <main className="mx-auto max-w-4xl p-3">
    <h1>Проверка навигации чатов</h1>
    <output aria-label="Выбранный чат">{selection}</output>
    <output aria-label="Действие">{action}</output>
    <section aria-label="Чаты" className="relative h-80">
      <ChatListView chats={chats} selectedChatId={selection} onSelectChat={setSelection}
        onCreateChat={() => setAction('create')} onPinChat={id => setAction(`pin:${id}`)}
        onMuteChat={id => setAction(`mute:${id}`)} onDeleteChat={id => setAction(`delete:${id}`)} />
    </section>
    <section aria-label="Переписка" className="h-80">
      <ChatConversationView chat={chats[0]} messages={[]} onSendMessage={async () => {}}
        onOpenSettings={() => setAction('settings')} />
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture /></LanguageProvider>);
