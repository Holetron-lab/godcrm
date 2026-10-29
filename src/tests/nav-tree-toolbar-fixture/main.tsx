import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider, useLanguage } from '@/shared/i18n/LanguageContext';
import { NavTreeToolbar } from '@/features/schema-editor/components/panels/NavTreeToolbar';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
document.documentElement.lang = params.get('lang') || 'en';
localStorage.setItem('god-crm-language', document.documentElement.lang);

function Fixture() {
  const { t } = useLanguage();
  const [events, setEvents] = useState<string[]>([]);
  const record = (event: string) => setEvents(previous => [...previous, event]);
  return <main className="p-4">
    <h1>Schema toolbar</h1>
    <div className="max-w-xs">
      <NavTreeToolbar allVisible sortMode={false} t={t}
        onToggleVisibility={() => record('visibility')} onToggleSortMode={() => record('sort')}
        onExpandAll={() => record('expand')} onCollapseAll={() => record('collapse')}
        onCollapseTables={() => record('collapse-tables')} />
    </div>
    <button type="button">Outside</button>
    <output aria-label="Events">{events.join(',')}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture /></LanguageProvider>);
