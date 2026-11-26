import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { PublicViewProvider } from '@/features/public/PublicViewContext';
import { KanbanWidget } from '@/features/widgets/components/presets/kanban/KanbanWidget';
import { apiClient } from '@/shared/utils/apiClient';
import { tablesApi } from '@/features/tables/api/tablesApi';
import type { ColumnModel } from '@/features/tables/types/table.types';
import type { Widget, WidgetConfig } from '@/features/widgets/types/widget.types';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
document.documentElement.lang = 'ru';
localStorage.setItem('god-crm-language', 'ru');
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
const column = (name: string, type: string): ColumnModel => ({ id: name, name, type: type as ColumnModel['type'], displayName: name, tableId: '17', config: {}, isRequired: false, isReadonly: false, orderIndex: 0, width: 160, isVisible: true });
const columns = [column('title', 'text'), column('status', 'select'), column('team', 'user')];
columns[1].config = { options: [{ value: 'todo', label: 'К выполнению' }] };
client.setQueryData(['workspace-users', 'anonymous'], [{ id: 7, name: 'Алиса' }, { id: 8, name: 'Боб' }]);
apiClient.request = async <T,>(path: string): Promise<T> => {
  if (path === '/tables/17/columns') return { data: columns } as T;
  if (path === '/spaces') return { data: [] } as T;
  throw new Error(`Unexpected fixture API: ${path}`);
};
tablesApi.getColumns = async () => ({ columns, userRole: 'owner' });
// A board on table 17 with `team` as its assignee column.
const config: WidgetConfig = {
  table_id: 17, statusColumn: 'status', titleColumn: 'title', assigneeColumn: 'team',
  kanban: { tableId: '17', statusColumn: 'status', titleColumn: 'title', assigneeColumn: 'team', lanes: [] },
};
function Fixture() {
  const [data, setData] = useState<Record<string, unknown>>({ title: 'Задача', status: 'todo' });
  const [readOnly, setReadOnly] = useState(false);
  return <main className="p-4 space-y-4 text-[var(--text-primary)]">
    <h1>Исполнитель канбан-доски</h1>
    <label><input type="checkbox" checked={readOnly} onChange={e => setReadOnly(e.target.checked)} /> Публичный режим</label>
    <PublicViewProvider readOnly={readOnly} publicSlug={readOnly ? 'fixture' : null}>
      <KanbanWidget widget={{ config, id: 99 } as Widget} data={[{ id: 42, data }]} columnsInfo={columns} columnOptions={[{ value: 'todo', label: 'К выполнению' }]} showToolbar={false}
        onCardUpdate={(_id, field, value) => setData(current => ({ ...current, [field]: value }))} />
    </PublicViewProvider>
    <output className="block break-all" aria-label="Состояние">{JSON.stringify({ data })}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><MemoryRouter><LanguageProvider><Fixture /></LanguageProvider></MemoryRouter></QueryClientProvider>);
