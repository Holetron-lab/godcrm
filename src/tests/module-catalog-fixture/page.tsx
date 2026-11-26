import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { kanban, modules } from '@/features/module-catalog/__tests__/fixtures';
import type { InstallBindings, InstallPlan } from '@/features/module-install/types';
import { useSpacesStore } from '@/features/spaces/store/spacesStore';
import type { SpaceModel } from '@/features/spaces/types/space.types';
import { ModuleCatalogPage, WidgetCreateRedirect } from '@/pages/modules/ModuleCatalogPage';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';

// The catalog page behind its real routes, opened at `?from=<link>`: the old create links and `?tableId=`.
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
document.documentElement.lang = params.get('lang') || 'en';
localStorage.setItem('god-crm-language', document.documentElement.lang);

const board = { ...kanban, blueprint: { ...kanban.blueprint, tables: [{ key: 'tasks', name: 'tasks', display_name: 'Tasks' }] } };
const spaceTables = [7, 8];

// Stands in for the dry-run: a connected table of the space gets its columns matched, any other table is refused.
const dryRun = (bindings: InstallBindings): InstallPlan => {
  const bound = bindings.tables?.tasks;
  const tableId = bound?.action === 'connect' ? bound.table_id : null;
  const inSpace = tableId != null && spaceTables.includes(tableId);
  return {
    module_key: board.key, version: board.version,
    projects: [{ key: 'main', action: 'use', project_id: 5, title: 'Sales' }],
    tables: [tableId == null
      ? { key: 'tasks', name: 'tasks', table_id: null, action: bound?.action === 'skip' ? 'skip' : 'create', columns_added: ['title'], project: 'main' }
      : {
        key: 'tasks', name: 'tasks', table_id: tableId, action: 'connect', columns_added: [], project: 'main',
        columns: inSpace ? [{ module_column: 'title', target: 'name', match: 'display_name', compat: 'ok', module_type: 'text', target_type: 'text' }] : undefined,
      }],
    seed: [], sidebar: [],
    conflicts: tableId != null && !inSpace ? [{ kind: 'TABLE_NOT_IN_SPACE', table: 'tasks', blocking: true }] : [],
    changes: tableId == null ? 2 : 1,
  };
};

const answers: Record<string, unknown> = {
  '/projects/5': { id: 5, space_id: 11 },
  '/spaces/11/tree': [{
    id: 'project:5', type: 'project', name: 'Sales',
    children: [
      { id: 'table:7', type: 'table', name: 'Deals', data: { name: 'deals', display_name: 'Deals' } },
      { id: 'table:8', type: 'table', name: 'Leads', data: { name: 'leads', display_name: 'Leads' } },
    ],
  }],
  '/tables/7': { id: 7, project_id: 5, name: 'Deals' },
  '/tables/7/columns': [{ name: 'name', display_name: 'Name', column_type: 'text' }],
  '/tables/8/columns': [{ name: 'name', display_name: 'Name', column_type: 'text' }],
};
Object.assign(apiClient, {
  request: async (path: string) => {
    if (path.startsWith('/module-registry')) return { data: { items: modules.map(module => (module.id === board.id ? board : module)) } };
    if (path in answers) return { data: answers[path] };
    throw new Error(`Not found: ${path}`);
  },
  post: async (_path: string, body: { dry_run: boolean; bindings: InstallBindings }) =>
    ({ data: { dry_run: body.dry_run, status: body.dry_run ? 'install' : 'installed', plan: dryRun(body.bindings) } }),
});
useSpacesStore.setState({ spaces: [{ id: 11, name: 'Fixture', user_access_level: 'admin' } as unknown as SpaceModel] });

const Location = () => { const { pathname, search } = useLocation(); return <output aria-label="Location" className="sr-only">{pathname}{search}</output>; };

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <LanguageProvider>
      <MemoryRouter initialEntries={[params.get('from') || '/projects/5/modules']}>
        <main className="h-screen p-6">
          <Routes>
            <Route path="projects/:projectId/modules" element={<ModuleCatalogPage />} />
            <Route path="projects/:projectId/modules/:moduleId" element={<ModuleCatalogPage />} />
            <Route path="projects/:projectId/widgets/create" element={<WidgetCreateRedirect />} />
          </Routes>
        </main>
        <Location />
      </MemoryRouter>
    </LanguageProvider>
  </QueryClientProvider>,
);
