import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import '../../styles/index.css';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AssignedUsersRow, CardStatusBar } from '@/features/widgets/components/presets/kanban/KanbanCardExpanded';
import type { FieldValue } from '@/features/widgets/components/presets/kanban/kanban-types';

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
localStorage.setItem('god-crm-language', 'ru');
const users = [{ value: 'alice', label: 'Алиса' }, { value: 'bob', label: 'Боб' }];
const types = [{ value: 'task', label: 'Задача' }, { value: 'bug', label: 'Ошибка' }];
function Fixture() {
  const [type, setType] = useState<string | null>('task');
  const [assigned, setAssigned] = useState(['alice']);
  const [typeOpen, setTypeOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [submits, setSubmits] = useState(0);
  const [bubbled, setBubbled] = useState(0);
  const [edits, setEdits] = useState(0);
  const typeRef = useRef<HTMLButtonElement>(null);
  const assignedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onClick = () => setBubbled(count => count + 1);
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  const onQuickEdit = (field: string, value: FieldValue) => {
    setEdits(count => count + 1);
    if (field === 'type') setType(value === null ? null : String(value));
    if (field === 'assigned_to') setAssigned(Array.isArray(value) ? value.map(String) : []);
  };
  return <main className="p-4 text-[var(--text-primary)]">
    <h1>Карточка Kanban</h1>
    <form className="group ml-auto mt-8 w-72 max-w-full" onSubmit={event => { event.preventDefault(); setSubmits(count => count + 1); }}>
      <AssignedUsersRow assignedResolved={users.filter(user => assigned.includes(user.value))} assignedArray={assigned}
        assignedFieldName="assigned_to" allAssignedOptions={users} showAssignedEditor={editing} setShowAssignedEditor={setEditing}
        showAssignedAddSelect={addOpen} setShowAssignedAddSelect={setAddOpen} assignedButtonRef={assignedRef}
        itemId={42} onQuickEdit={onQuickEdit} />
      <CardStatusBar itemId={42} adrLabel={null} adrValue={null} typeLabel={types.find(option => option.value === type)?.label || null}
        typeValue={type} typeRelation={null} typeRelOptions={types} showTypeSelect={typeOpen} setShowTypeSelect={setTypeOpen}
        typeButtonRef={typeRef} onQuickEdit={onQuickEdit} />
    </form>
    <button type="button">Фоновое действие</button>
    <output className="block break-all" aria-label="Состояние">{JSON.stringify({ type, assigned, submits, bubbled, edits })}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture /></LanguageProvider>);
