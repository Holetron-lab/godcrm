import '../../styles/index.css';
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getCoreRowModel, useReactTable, type CellContext } from '@tanstack/react-table';
import { TableCell } from '@/features/tables/components/cells/TableCell';
import { TableGridRow } from '@/features/tables/components/UniversalTable/TableGridRow';
import type { ColumnModel, RowModel, TableColumnConfig } from '@/features/tables/types/table.types';

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
client.setQueryData(['embedded-table-info', '42'], { columns: [{ name: 'name', displayName: 'Название' }] });
client.setQueryData(['embedded-table-rows', '42', 'parent_id', '7'], {
  rows: Array.from({ length: 5 }, (_, index) => ({ id: String(index), data: { name: `Запись ${index + 1}` } })), total: 5,
});
const column: ColumnModel = {
  id: 'nested', tableId: '1', name: 'nested', displayName: 'Записи', type: 'table',
  config: {}, isRequired: false, isReadonly: false, orderIndex: 0, width: 240, isVisible: true,
};
const data: RowModel[] = [{ id: '7', tableId: '1', data: { nested: '7' }, createdAt: '', updatedAt: '', createdBy: '1' }];

function Cell({ table }: CellContext<RowModel, unknown>) {
  return <TableCell {...table.options.meta as React.ComponentProps<typeof TableCell>} />;
}

function Grid({ config, navigate, edit }: { config: TableColumnConfig; navigate: (tableId: string, column: string, value: string) => void; edit: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const columns = useMemo(() => [{ id: 'nested', size: 280, accessorFn: (row: RowModel) => row.data.nested, cell: Cell }], []);
  const meta: React.ComponentProps<typeof TableCell> = {
    value: '7', column: { ...column, config: { table: { tableId: '42', ...config } } },
    isExpanded: expanded, onOpenNestedTable: navigate,
    onToggleInlineExpand: (...args) => { navigate(...args); setExpanded(value => !value); },
  };
  const table = useReactTable({ data, columns, meta, getCoreRowModel: getCoreRowModel() });
  return <table><tbody><TableGridRow row={table.getRowModel().rows[0]} rowIndex={0}
    columns={[column]} displayColumns={[column]} hiddenColumns={[]} editingCell={null}
    draftValue="" onCellDoubleClick={edit} onDraftChange={() => {}}
    onCommitEdit={() => {}} onCancelEdit={() => {}} readOnly={false} rawMode={false}
    isScrolledHorizontally={false} totalColumns={1} minRowHeight={40} maxRowHeight={300}
    fixedRowHeight={null} showHiddenTemporarily={false} /></tbody></table>;
}

function Fixture() {
  const [calls, setCalls] = useState(0);
  const [destination, setDestination] = useState('');
  const [submits, setSubmits] = useState(0);
  const [edits, setEdits] = useState(0);
  const navigate = (tableId: string, column: string, value: string) => {
    setCalls(count => count + 1);
    setDestination([tableId, column, value].join('/'));
  };
  return <main className="p-6 text-[var(--text-primary)]">
    <h1>Управление вложенными таблицами</h1>
    <form onSubmit={event => { event.preventDefault(); setSubmits(count => count + 1); }}>
      {(['modal', 'inline', 'expand', 'embedded-modal', 'embedded-inline'] as const).map(mode => <section key={mode} aria-label={mode} className="my-4">
        <Grid config={{ displayMode: mode === 'modal' || mode === 'inline' ? mode : 'embedded',
          expandAction: mode === 'embedded-modal' ? 'modal' : mode === 'embedded-inline' ? 'inline' : 'expand' }}
          navigate={navigate} edit={() => setEdits(count => count + 1)} />
      </section>)}
      <section aria-label="disabled"><TableCell value="7" column={{ ...column, config: { table: { tableId: '42' } } }} /></section>
      <button type="button">Снаружи</button>
    </form>
    <p role="status">Opened {calls}: {destination}</p>
    <p>Submits: {submits}; Edits: {edits}</p>
    <div aria-hidden="true" className="h-[1200px]" />
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>);
