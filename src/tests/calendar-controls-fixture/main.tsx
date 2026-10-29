import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { format } from 'date-fns';
import { CalendarWidget } from '@/features/widgets/components/presets/CalendarWidget';
import type { Widget } from '@/features/widgets/types/widget.types';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
const date = format(new Date(), 'yyyy-MM-dd');
const widget: Widget = {
  id: 1, dashboard_id: 1, source_widget_id: null,
  widget_type: 'preset', preset_name: 'calendar_widget',
  code: null, code_version: 1, title: 'Календарь', description: null, icon: 'calendar',
  config: { calendar: { tableId: '1', dateColumn: 'date', titleColumn: 'title' } },
  position: { x: 0, y: 0, w: 4, h: 4 },
  is_visible: true, is_module: false, order_index: 0, created_by: null,
  created_at: '2026-01-01', updated_at: '2026-01-01',
  module_id: null, sidebar_order: null, sidebar_icon: null, access_level: null, is_pinned: null,
};
const data = Array.from({ length: 4 }, (_, index) => ({
  id: String(index), data: { title: `Встреча ${index + 1}`, date },
}));

function Fixture() {
  const [created, setCreated] = useState<string[]>([]);
  const [opened, setOpened] = useState(0);
  const [moved, setMoved] = useState(0);
  const [submits, setSubmits] = useState(0);
  return <main className="p-2 text-[var(--text-primary)]">
    <h1>Календарь</h1>
    <form className="h-[700px]" onSubmit={event => { event.preventDefault(); setSubmits(value => value + 1); }}>
      <CalendarWidget widget={widget} data={data}
        onAddEvent={params.has('readonly') ? undefined : day => setCreated(value => [...value, format(day, 'yyyy-MM-dd')])}
        onEventClick={() => setOpened(value => value + 1)}
        onEventUpdate={() => setMoved(value => value + 1)} />
    </form>
    <output aria-label="Состояние">{JSON.stringify({ date, created, opened, moved, submits })}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
