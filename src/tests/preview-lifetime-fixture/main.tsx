import '../../styles/index.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { AIChatStubProvider } from '@/features/ai-chat/context/AIChatContext';
import { UniversalTable } from '@/features/tables/components/UniversalTable/UniversalTable';
import { useTablesStore } from '@/features/tables/store/tablesStore';
import type { ColumnModel, TableModel } from '@/features/tables/types/table.types';

// In-memory data only. The runner refuses all API and external requests.
localStorage.setItem('god-crm-language', 'en');
const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
for (const formType of ['edit_row', 'add_row']) {
  client.setQueryData(['form-configs', 'preview', formType], { success: true, data: null });
}
const params = new URLSearchParams(location.search);
const table: TableModel = {
  id: 'preview', userId: 'fixture', name: 'preview', displayName: 'Preview', type: 'system',
  isVisible: true, config: { defaultView: 'table', views: [], permissions: {} }, createdAt: '', updatedAt: '',
};
const columns: ColumnModel[] = [{
  id: 'images', tableId: table.id, name: 'images', displayName: 'Images', type: 'image',
  config: { image: { displayMode: 'carousel' } }, isRequired: false, isReadonly: params.has('readonly'),
  orderIndex: 0, width: 200, isVisible: true,
}, {
  id: 'name', tableId: table.id, name: 'name', displayName: 'Name', type: 'text',
  config: {}, isRequired: false, isReadonly: false, orderIndex: 1, width: 180, isVisible: true,
}];
useTablesStore.setState({ rows: { preview: [{ id: '7', tableId: 'preview', createdAt: '', updatedAt: '', createdBy: 'fixture', data: {
  images: '/src/tests/image-settings-fixture/wide.svg,/src/tests/image-settings-fixture/portrait.svg', name: 'Before',
} }] } });
function Fixture() {
  const rows = useTablesStore(state => state.rows.preview);
  const [updates, setUpdates] = useState(0);
  useEffect(() => {
    const update = () => setUpdates(count => count + 1);
    window.addEventListener('resize', update);
    const timer = params.has('updates') ? window.setInterval(() => {
      update();
      if (params.has('data')) useTablesStore.getState().updateCell('preview', '7', 'name', `Updated ${Date.now()}`);
    }, 1000) : undefined;
    return () => { window.removeEventListener('resize', update); window.clearInterval(timer); };
  }, []);
  return <main className="p-4"><h1>Preview lifetime regression</h1>
    <output aria-label="Background updates">{updates}</output>
    <UniversalTable table={table} columns={columns} rows={rows} readOnly={params.has('readonly')} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<MemoryRouter><LanguageProvider>
  <QueryClientProvider client={client}><AIChatStubProvider><Fixture /></AIChatStubProvider></QueryClientProvider>
</LanguageProvider></MemoryRouter>);
