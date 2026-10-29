import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { AIChatStubProvider } from '@/features/ai-chat/context/AIChatContext';
import { StatusBar } from '@/shared/components/desktop/StatusBar';

Object.assign(globalThis, { __APP_VERSION__: 'fixture' });
localStorage.setItem('god-crm-language', 'en');
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><LanguageProvider><MemoryRouter><AIChatStubProvider>
    <main><h1>Quick links fixture</h1><button type="button">Outside control</button></main>
    <StatusBar />
  </AIChatStubProvider></MemoryRouter></LanguageProvider></QueryClientProvider>
);
