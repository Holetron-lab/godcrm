import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SelectEditor } from '@/features/tables/components/cells/SelectEditor';
import type { ColumnRelationConfig } from '@/features/tables/types/table.types';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
const format = (params.get('format') || 'comma') as ColumnRelationConfig['storageFormat'];
const initial = format === 'json' ? '["alpha","beta","legacy"]'
  : ['alpha', 'beta', 'legacy'].join(format === 'semicolon' ? '; ' : format === 'newline' ? '\n' : ', ');
const client = new QueryClient();
function Fixture() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [events, setEvents] = useState<string[]>([]);
  return <main className="p-4">
    <h1>Удаление выбранных тегов</h1>
    <button type="button" onClick={() => { setValue(saved); setOpen(true); }}>Открыть</button>
    <output className="block break-all" aria-label="Значение">{value}</output>
    <output className="block break-all" aria-label="Сохранено">{saved}</output>
    <output className="block break-all" aria-label="События">{events.join(',')}</output>
    <div className="relative w-64 h-10">
      {open && <SelectEditor multiple value={value}
        options={[{ value: 'alpha', label: 'Альфа', color: '#3949ab' }, { value: 'beta', label: 'Бета', color: '#3949ab' }]}
        relation={{ enabled: false, storageFormat: format }}
        onChange={next => { setValue(next); setEvents(prev => [...prev, 'change']); }}
        onCommit={next => { setSaved(next ?? value); setEvents(prev => [...prev, 'commit']); setOpen(false); }}
        onCancel={() => { setValue(saved); setEvents(prev => [...prev, 'cancel']); setOpen(false); }} />}
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>);
