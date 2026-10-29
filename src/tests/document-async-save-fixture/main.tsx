import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { AIChatStubProvider } from '@/features/ai-chat';
import { DocumentsProvider } from '@/features/widgets/components/presets/documents/context/DocumentsProvider';
import { DocumentsContent } from '@/features/widgets/components/presets/documents/DocumentsContent';
import { ToolbarLanguageSelector } from '@/features/widgets/components/presets/documents/toolbar/ToolbarLanguageSelector';

const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><LanguageProvider><AIChatStubProvider>
    <main className="bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <DocumentsProvider spaceId={0} widgetId={99} initialDocSlug="async-save"
        config={{ project_id: 1, registry_table_id: 41, languages: [{ code: 'en', name: 'English', is_default: true }] }}>
        <ToolbarLanguageSelector /><DocumentsContent />
      </DocumentsProvider>
      <button type="button">После документа</button>
    </main>
  </AIChatStubProvider></LanguageProvider></QueryClientProvider>,
);
