import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { HighlightedText } from '@/features/ai-chat/components/HighlightedText';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';

localStorage.setItem('god-crm-language', 'ru');
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
const text = 'Видео https://youtu.be/M7lc1UVf-VE?t=90\nПин https://pin.it/abcDEF12\nИдеи https://ru.pinterest.com/designer/ideas/\nReel https://www.instagram.com/reel/ABC_123/?igsh=abc';
function Fixture() {
  const [revision, setRevision] = useState(0);
  return <main className="mx-auto max-w-xl p-3 text-[var(--text-primary)]">
    <h1>Ссылки в чате</h1>
    <button type="button" onClick={() => setRevision(revision + 1)}>Обновить сообщение {revision}</button>
    <section aria-label="Обычный текст"><h2>Сообщение пользователя</h2><HighlightedText text={text} /></section>
    <section aria-label="Markdown"><h2>Ответ агента</h2><MarkdownPreview mediaLinks content={text} /></section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><MemoryRouter><Fixture /></MemoryRouter></LanguageProvider>);
