import '../../styles/index.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { useToast } from '@/shared/hooks/useToast';
import { SortableTableItem as LegacyItem } from '@/shared/components/layout/ProjectTablesNavItems';
import { SortableTableItem as CurrentItem } from '@/shared/components/layout/project-tables-nav/SortableTableItem';

const params = new URLSearchParams(window.location.search);
localStorage.setItem('god-crm-language', params.get('language') || 'en');
document.documentElement.dataset.theme = params.get('theme') || 'light';
const Item = params.get('variant') === 'legacy' ? LegacyItem : CurrentItem;
function Fixture() {
  const [ids, setIds] = useState(['1708', '1784']);
  const [copied, setCopied] = useState<string[]>([]);
  const [failCopy, setFailCopy] = useState(false);
  const [privileged, setPrivileged] = useState(true);
  const { toasts } = useToast();
  const location = useLocation();
  useEffect(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (value: string) => {
        if (failCopy) throw new Error('Clipboard unavailable');
        setCopied(previous => [...previous, value]);
      },
    } });
  }, [failCopy]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  return <main className="p-4 max-w-md">
    <h1>Table navigation</h1>
    <button type="button">Before list</button>
    <DndContext collisionDetection={closestCenter} sensors={sensors} onDragEnd={({ active, over }) => {
      if (over) setIds(previous => arrayMove(previous, previous.indexOf(String(active.id)), previous.indexOf(String(over.id))));
    }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {ids.map(id => <Item key={id} table={{ id, name: id === '1708' ? 'Tickets' : 'Agents' }}
          projectId={1} isActive={id === '1708'} isPrivileged={privileged} />)}
      </SortableContext>
    </DndContext>
    <label><input type="checkbox" checked={privileged} onChange={event => setPrivileged(event.target.checked)} />Privileged</label>
    <label><input type="checkbox" checked={failCopy} onChange={event => setFailCopy(event.target.checked)} />Clipboard failure</label>
    <output aria-label="Copied">{copied.join(',')}</output>
    <output aria-label="Order">{ids.join(',')}</output>
    <output aria-label="Location">{location.pathname}{location.search}</output>
    <div role="status" aria-label="Notifications">{toasts.map(toast => <p key={toast.id}>{toast.type}: {toast.message}</p>)}</div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><MemoryRouter initialEntries={['/fixture']}><Fixture /></MemoryRouter></LanguageProvider>);
