import '../../styles/index.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { renderCellValue } from '@/features/tables/components/UniversalTable/renderCellValue';
import { TableGridRow } from '@/features/tables/components/UniversalTable/TableGridRow';
import { useRowMutations } from '@/features/tables/hooks/useRowMutations';
import { useTablesStore } from '@/features/tables/store/tablesStore';
import { tablesApi } from '@/features/tables/api/tablesApi';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnModel } from '@/features/tables/types/table.types';

// The smoke runner intercepts every API call; no application database is used.
localStorage.setItem('god-crm-language', 'en');
if (new URLSearchParams(location.search).has('protected')) apiClient.getAccessToken = () => 'fixture-image-token';
const column: ColumnModel = {
  id: '30', tableId: '10', name: 'images', displayName: 'Images', type: 'image',
  config: { file: new URLSearchParams(location.search).has('prefix') ? { prefix: '/uploads/', suffix: '?external=1', saveFormat: 'filename' } : undefined, image: { displayMode: new URLSearchParams(location.search).has('carousel') ? 'carousel' : 'grid' } },
  isRequired: false, isReadonly: new URLSearchParams(location.search).has('readonly'),
  orderIndex: 0, width: 200, isVisible: true,
};

function Fixture() {
  const rows = useTablesStore(state => state.rows['10']);
  const rowMutation = useRowMutations('10');
  const [error, setError] = useState('');
  const [edits, setEdits] = useState(0);
  const table = useReactTable({ data: rows ?? [], getCoreRowModel: getCoreRowModel(), columns: [{
    id: column.id, accessorFn: row => row.data[column.id],
    cell: info => renderCellValue({ column, value: info.getValue(), tableId: 10,
      rowId: info.row.original.id, rows, rowMutation }),
  }] });
  useEffect(() => {
    tablesApi.getRow('10', '20').then(row => {
      useTablesStore.getState().setRows('10', [row]);
    }).catch(() => setError('Could not load fixture row'));
  }, []);
  return <main className="p-4">
    <h1>Image upload regression</h1>
    <output aria-label="Parent edit calls">{edits}</output>
    {error ? <p role="alert">{error}</p> : rows?.[0] ?
      <section aria-label="Image cell"><table><tbody><TableGridRow
        row={table.getRowModel().rows[0]} rowIndex={0} columns={[column]} displayColumns={[column]}
        hiddenColumns={[]} editingCell={null} draftValue=""
        onCellDoubleClick={() => setEdits(count => count + 1)} onDraftChange={() => {}}
        onCommitEdit={() => {}} onCancelEdit={() => {}} readOnly={column.isReadonly} rawMode={false}
        isScrolledHorizontally={false} totalColumns={1} minRowHeight={40} maxRowHeight={200}
        fixedRowHeight={null} showHiddenTemporarily={false}
      /></tbody></table></section> : <p>Loading…</p>}
  </main>;
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient()}><LanguageProvider><Fixture /></LanguageProvider></QueryClientProvider>
);
