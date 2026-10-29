import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { AIChatStubProvider } from '@/features/ai-chat/context/AIChatContext';
import { ChatAttachmentRenderer } from '@/features/ai-chat/components/AIChatPanel/components/ChatMessages/ChatAttachmentRenderer';
import { ChatConversationView } from '@/features/ai-chat/components/ChatConversationView';
import { apiClient } from '@/shared/utils/apiClient';

apiClient.getAccessToken = () => 'fixture-video-token';
localStorage.setItem('god-crm-language', 'ru');
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
function Fixture() {
  const [sent, setSent] = useState('');
  return <main className="mx-auto max-w-xl p-3 text-[var(--text-primary)]">
    <h1>Видео и файлы чата</h1>
    <section aria-label="Видео"><ChatAttachmentRenderer attachments={[
      { id: 'clip', name: 'clip.mp4', type: 'application/octet-stream', size: 1024, url: '/uploads/fixture-clip?download=1' },
    ]} /></section>
    <section aria-label="Переписка" className="mt-6 h-80">
      <ChatConversationView chat={{ id: 1, title: 'Файлы', type: 'group' }} messages={[]}
        onSendMessage={async (_content, files) => { setSent(files?.map(file => file.name).join(', ') || ''); }} />
    </section>
    <output aria-label="Отправленные файлы">{sent}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><LanguageProvider><AIChatStubProvider><Fixture /></AIChatStubProvider></LanguageProvider></QueryClientProvider>);
