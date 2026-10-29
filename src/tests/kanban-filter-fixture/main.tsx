import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FilterPill } from '@/features/widgets/components/presets/kanban/KanbanFilterPill';
import type { KanbanFilterState } from '@/features/widgets/components/presets/kanban/kanban-types';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
const columns = [
  { id: 'status', name: 'status', displayName: 'Статус', type: 'select' },
  { id: 'date', name: 'date', displayName: 'Дата', type: 'date' },
  { id: 'empty', name: 'empty', displayName: 'Без опций', type: 'select' },
];
function Fixture() {
  const [open, setOpen] = useState<string | null>(null);
  const [selectFilters, onSelectFiltersChange] = useState<KanbanFilterState['selectFilters']>({});
  const [dateFilters, onDateFiltersChange] = useState<KanbanFilterState['dateFilters']>({});
  const [activeFilterColumns, onActiveFilterColumnsChange] = useState(['status', 'date', 'empty']);
  const [group, setGroup] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(['old']);
  const [submits, setSubmits] = useState(0);
  const filterState: KanbanFilterState = {
    searchQuery: '', onSearchChange: () => {}, searchColumns: [], onSearchColumnsChange: () => {},
    selectFilters, onSelectFiltersChange, dateFilters, onDateFiltersChange,
    activeFilterColumns, onActiveFilterColumnsChange, tableColumns: columns,
  };
  return <main className="p-4 text-[var(--text-primary)]">
    <h1>Фильтры Kanban</h1>
    <form onSubmit={event => { event.preventDefault(); setSubmits(count => count + 1); }}>
      <div className="flex justify-end gap-2 flex-wrap">
        {columns.filter(col => activeFilterColumns.includes(col.id)).map(col => <FilterPill key={col.id}
          col={col} filterState={filterState} groupByColumn={group || 'default'} defaultGroupBy="default"
          divisionColumns={[columns[0]]} setGroupByOverride={setGroup} setColumnOrder={setOrder}
          getFilterOptions={column => column.id === 'status' ? [{ value: 'new', label: 'Новый' }, { value: 'done', label: 'Готово' }] : []}
          isOpen={open === col.id} onToggle={() => setOpen(open === col.id ? null : col.id)} onClose={() => setOpen(null)} />)}
      </div>
    </form>
    <button type="button">Фоновое действие</button>
    <output className="block break-all" aria-label="Состояние">{JSON.stringify({ selectFilters, dateFilters, activeFilterColumns, group, order, submits })}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
