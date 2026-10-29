import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SelectEditor } from '@/features/tables/components/cells/SelectEditor';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
const multiple = params.get('multiple') === 'true';
const initial = multiple ? 'alpha, legacy' : 'beta';
const client = new QueryClient();

function Fixture() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [events, setEvents] = useState<string[]>([]);
  const [submits, setSubmits] = useState(0);
  return <main className="p-4">
    <h1>Выбор опций</h1>
    <button type="button" onClick={() => { setValue(saved); setOpen(true); }}>Открыть</button>
    <output className="block break-all" aria-label="Значение">{value}</output>
    <output className="block break-all" aria-label="Сохранено">{saved}</output>
    <output className="block break-all" aria-label="События">{events.join(',')}</output>
    <output className="block" aria-label="Отправки">{submits}</output>
    <form onSubmit={event => { event.preventDefault(); setSubmits(count => count + 1); }}>
      <div className="relative w-64 h-10">
        {open && <SelectEditor multiple={multiple} value={value}
          options={[{ value: 'alpha', label: 'Альфа' }, { value: 'beta', label: 'Бета' }]}
          onChange={next => { setValue(next); setEvents(prev => [...prev, 'change']); }}
          onCommit={next => { setSaved(next ?? value); setEvents(prev => [...prev, 'commit']); setOpen(false); }}
          onCancel={() => { setValue(saved); setEvents(prev => [...prev, 'cancel']); setOpen(false); }} />}
      </div>
    </form>
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>);
