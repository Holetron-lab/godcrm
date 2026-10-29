import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { AIChatStubProvider } from '@/features/ai-chat/context/AIChatContext';
import { ImageDraftAttachment } from '@/features/ai-chat/components/AIChatPanel/components/ImageDraftAttachment';
import { ChatAttachmentRenderer } from '@/features/ai-chat/components/AIChatPanel/components/ChatMessages/ChatAttachmentRenderer';
import { apiClient } from '@/shared/utils/apiClient';

apiClient.getAccessToken = () => 'fixture-image-token';

const svg = (width: number, color: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="180"><rect width="100%" height="100%" fill="${color}"/></svg>`;
const file = new File([svg(100, '#476d80')], 'draft.svg', { type: 'image/svg+xml' });
const attachments = [100, 110, 120, 100, 600].map((width, i) => ({ id: String(i), name: `Image ${i + 1}`, type: 'image/svg+xml', size: 100,
  url: `data:image/svg+xml,${encodeURIComponent(svg(width, ['#476d80', '#477a63', '#976445'][i % 3]))}` }));
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
function Fixture() {
  const [attached, setAttached] = useState(true);
  const [showProtected, setShowProtected] = useState(false);
  return <main className="p-4 text-[var(--text-primary)] max-w-[640px]">
    <h1>Изображения чата</h1>
    <section aria-label="Сообщение" className="group"><ChatAttachmentRenderer attachments={[...attachments,
      { id: 'file', name: 'notes.txt', type: 'text/plain', size: 4, url: 'data:text/plain,Note' }]} /></section>
    <section aria-label="Черновик" className="mt-8 flex items-center gap-2">
      {attached && <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] text-xs">
        <ImageDraftAttachment file={file} /><span>{file.name}</span>
        <button onClick={() => setAttached(false)} aria-label="Удалить draft.svg">×</button>
      </div>}
    </section>
    <button type="button" onClick={() => setShowProtected(true)}>Load protected image</button>
    {showProtected && <ChatAttachmentRenderer attachments={[
      { id: 'protected', name: 'protected.svg', type: 'image/svg+xml', size: 100, url: '/uploads/fixture-protected.svg' },
    ]} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><LanguageProvider><AIChatStubProvider><Fixture /></AIChatStubProvider></LanguageProvider></QueryClientProvider>);
