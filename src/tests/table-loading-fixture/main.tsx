import '../../styles/index.css';
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { TableGrid } from '@/features/tables/components/UniversalTable/TableGrid';
import type { ColumnModel, RowModel } from '@/features/tables/types/table.types';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
const client = new QueryClient();
const columns: ColumnModel[] = [{ id: 'name', tableId: 'fixture', name: 'name', displayName: 'Name',
  type: 'text', config: {}, isRequired: false, isReadonly: false, orderIndex: 0, width: 240, isVisible: true }];
const initialRows: RowModel[] = [{ id: '1', tableId: 'fixture', data: { name: 'Loaded row' },
  createdAt: '', updatedAt: '', createdBy: 'fixture' }];
const noop = () => {};

function Fixture() {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState(initialRows);
  const [clicks, setClicks] = useState(0);
  const tableColumns = useMemo<ColumnDef<RowModel>[]>(() => [{
    id: 'name', header: 'Name', accessorFn: row => row.data.name,
    cell: ({ getValue }) => <button onClick={() => setClicks(value => value + 1)}>{String(getValue())}</button>,
  }], []);
  const table = useReactTable({ data: rows, getCoreRowModel: getCoreRowModel(), columns: tableColumns });
  return <main className="p-4 text-[var(--text-primary)]">
    <h1>Table loading regression</h1>
    <button onClick={() => setLoading(true)}>Start loading</button>
    <button onClick={() => { setRows([...initialRows, { ...initialRows[0], id: '2', data: { name: 'New row' } }]); setLoading(false); }}>Complete loading</button>
    <button onClick={() => setLoading(false)}>Fail loading</button>
    <p role="status">Clicks: {clicks}</p>
    <div className="overflow-auto">
      <TableGrid table={table} columns={columns} rows={rows} readOnly isLoadingMore={loading}
        editingCell={null} draftValue="" onCellDoubleClick={noop} onDraftChange={noop}
        onCommitEdit={noop} onCancelEdit={noop} />
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><LanguageProvider><Fixture /></LanguageProvider></QueryClientProvider>
);
