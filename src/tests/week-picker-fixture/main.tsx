import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { DateEditor } from '@/features/tables/components/cells/DateEditor';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
document.documentElement.lang = params.get('lang') || 'en';
localStorage.setItem('god-crm-language', document.documentElement.lang);
function Fixture() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('2026-W01');
  const [events, setEvents] = useState<string[]>([]);
  return <main className="p-4">
    <h1>Week selection</h1>
    <button type="button" onClick={() => setOpen(true)}>Open week picker</button>
    <output aria-label="Selected week">{value}</output>
    <output aria-label="Events">{events.join(',')}</output>
    <div className="relative w-64 h-10">
      {open && <DateEditor mode="week" value={value} onChange={setValue}
        onCommit={next => { if (next) setValue(next); setEvents(prev => [...prev, `commit:${next}`]); setOpen(false); }}
        onCancel={() => { setEvents(prev => [...prev, 'cancel']); setOpen(false); }} />}
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture /></LanguageProvider>);
