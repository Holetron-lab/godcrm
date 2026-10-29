import '../../styles/index.css';
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { TableGridHeader } from '@/features/tables/components/UniversalTable/TableGridHeader';
import { ColumnHeader } from '@/features/tables/components/UniversalTable/ColumnHeader';
import type { ColumnModel, RowModel } from '@/features/tables/types/table.types';

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
localStorage.setItem('god-crm-language', 'ru');
const columns: ColumnModel[] = ['Название', 'Описание', 'Статус'].map((name, index) => ({
  id: String(index), tableId: 'fixture', name, displayName: name, type: 'text', config: {},
  isRequired: false, isReadonly: false, orderIndex: index, width: 230, isVisible: true,
}));
const rows: RowModel[] = [];
function Fixture() {
  const [order, setOrder] = useState(columns.map(column => column.id));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const [status, setStatus] = useState('Готово');
  const [readOnly, setReadOnly] = useState(false);
  const definitions = useMemo(() => columns.map<ColumnDef<RowModel>>((column, index) => ({ id: column.id, size: 230, minSize: 110,
      header: ({ column: tableColumn }) => <ColumnHeader column={column}
        sortDirection={tableColumn.getIsSorted()} onSort={() => { tableColumn.toggleSorting(); setStatus('Сортировка'); }}
        onOpenSettings={() => setStatus(`Настройки ${column.name}`)} disableSettings={readOnly}
        onMoveLeft={index > 0 ? () => setStatus(`Влево ${column.name}`) : undefined}
        onMoveRight={index < 2 ? () => setStatus(`Вправо ${column.name}`) : undefined}
        onAddColumn={side => setStatus(`${side} ${column.name}`)} />,
      accessorFn: row => row.data[column.name],
    })), [readOnly]);
  const table = useReactTable({ data: rows, columns: definitions, getCoreRowModel: getCoreRowModel(), columnResizeMode: 'onChange', state: { columnOrder: order } });
  return <main className="p-4 text-[var(--text-primary)]">
    <h1 className="mb-4 text-xl">Меню столбцов</h1>
    <label><input type="checkbox" checked={readOnly} onChange={event => setReadOnly(event.target.checked)} /> Только чтение</label>
    <div className="mt-4 overflow-auto">
      <DndContext collisionDetection={closestCenter} sensors={sensors} onDragEnd={({ active, over }) => { if (over) { setOrder(current => arrayMove(current, current.indexOf(String(active.id)), current.indexOf(String(over.id)))); setStatus('Перемещено'); } }}><table style={{ width: table.getTotalSize(), tableLayout: 'fixed' }}>
        <TableGridHeader table={table} columns={columns} columnIds={order} hiddenColumns={[]}
          showHiddenTemporarily={false} setShowHiddenTemporarily={() => {}} isScrolledHorizontally={false}
          groupByColumn={null} rawMode={false} readOnly={readOnly} isAllSelected={false}
          isSelectionIndeterminate={false} hasActionsColumn={false} />
        <tbody><tr>{order.map(id => <td key={id} className="p-3">Значение</td>)}</tr></tbody>
      </table></DndContext>
    </div>
    <p role="status" aria-label="Результат" className="mt-4">{status}</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture /></LanguageProvider>);
