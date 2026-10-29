import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider, useLanguage } from '@/shared/i18n/LanguageContext';
import { PublicViewProvider } from '@/features/public/PublicViewContext';
import { KanbanWidget } from '@/features/widgets/components/presets/kanban/KanbanWidget';
import type { Widget } from '@/features/widgets/types/widget.types';
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
localStorage.setItem('god-crm-language', params.get('lang') || 'ru');
const client = new QueryClient();
const widget = { id: 99, config: { statusColumn: 'status' } } as Widget;
function Fixture() {
  const { language, setLanguage } = useLanguage();
  const [data, setData] = useState<Record<string, unknown>>({ title: 'Ticket', status: 'todo' });
  const [readOnly, setReadOnly] = useState(false);
  const [updates, setUpdates] = useState(0);
  return <main className="p-4 text-[var(--text-primary)]">
    <h1>Kanban color</h1>
    <label><input type="checkbox" checked={readOnly} onChange={event => setReadOnly(event.target.checked)} /> Read only</label>
    <button type="button" onClick={() => setLanguage(language === 'ru' ? 'en' : 'ru')}>Language</button>
    <PublicViewProvider readOnly={readOnly} publicSlug={null}>
      <KanbanWidget widget={widget} data={[{ id: 42, data }]} showToolbar={false}
        columnsInfo={[{ name: 'status', type: 'select', config: { options: [{ value: 'todo', label: 'Todo' }] } }, { name: 'colour', type: 'color' }]}
        columnOptions={[{ value: 'todo', label: 'Todo' }]} onOpenRowChat={() => {}} onAttachRowToMessage={() => {}}
        onCardUpdate={(_id, field, value) => { setUpdates(n => n + 1); setData(current => ({ ...current, [field]: value })); }} />
    </PublicViewProvider>
    <output className="block break-all" aria-label="State">{JSON.stringify({ data, updates })}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><LanguageProvider><Fixture /></LanguageProvider></QueryClientProvider>);
