import '../../styles/index.css';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { PublicViewProvider } from '@/features/public/PublicViewContext';
import { useWidgetCreate } from '@/pages/widgets/useWidgetCreate';
import { TableMappingSelector } from '@/features/widgets/components/TableMappingSelector';
import { KanbanWidget } from '@/features/widgets/components/presets/kanban/KanbanWidget';
import { apiClient } from '@/shared/utils/apiClient';
import { tablesApi } from '@/features/tables/api/tablesApi';
import type { ColumnModel } from '@/features/tables/types/table.types';
import type { Widget, WidgetConfig } from '@/features/widgets/types/widget.types';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
const column = (name: string, type: string): ColumnModel => ({ id: name, name, type: type as ColumnModel['type'], displayName: name, tableId: '17', config: {}, isRequired: false, isReadonly: false, orderIndex: 0, width: 160, isVisible: true });
const columns = [column('title', 'text'), column('status', 'select'), column('team', 'user')];
columns[1].config = { options: [{ value: 'todo', label: 'К выполнению' }] };
client.setQueryData(['all-tables-grouped'], { spaces: [{ id: 11, name: 'Fixture', projects: [{ id: 3, name: 'Project', tables: [{ id: '17', name: 'Tasks', displayName: 'Tasks', projectId: 3 }] }] }], flat: [{ id: '17', name: 'Tasks', projectId: 3 }] });
client.setQueryData(['workspace-users', 'anonymous'], [{ id: 7, name: 'Алиса' }, { id: 8, name: 'Боб' }]);
let saved: WidgetConfig | undefined;
let creates = 0;
let fail = false;
apiClient.request = async <T,>(path: string, options?: RequestInit): Promise<T> => {
  if (path === '/tables/17/columns') return { data: columns } as T;
  if (path === '/projects/3/dashboard') return { data: { id: 9 } } as T;
  if (path === '/dashboards/9/widgets') {
    saved = JSON.parse(String(options?.body)).config;
    return { data: { id: 99 } } as T;
  }
  if (path === '/spaces') return { data: [] } as T;
  throw new Error(`Unexpected fixture API: ${path}`);
};
tablesApi.getColumns = async () => ({ columns, userRole: 'owner' });
tablesApi.createColumn = async (_id, payload) => {
  if (fail) throw new Error('Fixture denied');
  creates++;
  const created = column(payload.name, 'user');
  columns.push(created);
  return created;
};
function Fixture() {
  const wizard = useWidgetCreate();
  const [data, setData] = useState<Record<string, unknown>>({ title: 'Задача', status: 'todo' });
  const [config, setConfig] = useState<WidgetConfig>();
  const [readOnly, setReadOnly] = useState(false);
  useEffect(() => {
    wizard.handlePresetSelect(wizard.widgetPresets.find(p => p.id === 'kanban_board')!);
    wizard.setTableMappings([{ tableKey: 'data', tableId: '17', projectId: 3, columnMapping: { statusColumn: 'status', titleColumn: 'title' } }]);
  }, []);
  return <main className="p-4 space-y-4 text-[var(--text-primary)]">
    <h1>Исполнитель канбан-доски</h1>
    {!config && wizard.selectedPreset && <section aria-label="Создание доски" className="max-w-xl">
      <TableMappingSelector tableRequirements={wizard.selectedPreset.tables} mappings={wizard.tableMappings} onMappingsChange={wizard.setTableMappings} defaultProjectId={3} />
      <label><input type="checkbox" onChange={e => { fail = e.target.checked; }} /> Ошибка создания</label>
      <button type="button" disabled={wizard.createWidget.isPending} onClick={async () => { await wizard.handleCreateWidget(); setConfig(saved); }}>Создать доску</button>
    </section>}
    {config && <>
      <label><input type="checkbox" checked={readOnly} onChange={e => setReadOnly(e.target.checked)} /> Публичный режим</label>
      <PublicViewProvider readOnly={readOnly} publicSlug={readOnly ? 'fixture' : null}>
        <KanbanWidget widget={{ config, id: 99 } as Widget} data={[{ id: 42, data }]} columnsInfo={columns} columnOptions={[{ value: 'todo', label: 'К выполнению' }]} showToolbar={false}
          onCardUpdate={(_id, field, value) => setData(current => ({ ...current, [field]: value }))} />
      </PublicViewProvider>
    </>}
    <output className="block break-all" aria-label="Состояние">{JSON.stringify({ config, creates, data })}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><MemoryRouter><LanguageProvider><Fixture /></LanguageProvider></MemoryRouter></QueryClientProvider>);
