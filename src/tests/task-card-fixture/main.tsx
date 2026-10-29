import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskCard } from '@/features/widgets/components/presets/task-list/TaskCard';

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
function Fixture() {
  const [completed, setCompleted] = useState(false);
  const [events, setEvents] = useState<string[]>([]);
  return <main className="p-4 text-[var(--text-primary)]">
    <h1>Карточки задач</h1>
    <form className="mt-4 max-w-lg space-y-4" onSubmit={event => { event.preventDefault(); setEvents(previous => [...previous, 'submit']); }}>
      <TaskCard item={{ id: '1', data: { title: 'Проверить карточку', description: 'Описание задачи', amount: 5, color: '#ef4444' } }}
        isCompleted={completed} onToggle={setCompleted} colorColumn="color" visibleColumns={['amount']}
        columnsInfo={[{ name: 'amount', displayName: 'Количество', type: 'number' }]}
        onUpdate={(field, value) => setEvents(previous => [...previous, `${field}:${value}`])}
        onDoubleClick={tab => setEvents(previous => [...previous, String(tab)])} />
      <TaskCard item={{ id: '2', data: { title: 'Без дополнительных полей' } }} isCompleted={false} onToggle={() => {}}
        onDoubleClick={tab => setEvents(previous => [...previous, `empty:${tab}`])} />
    </form>
    <output aria-label="События" className="block break-all">{events.join(',')}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
