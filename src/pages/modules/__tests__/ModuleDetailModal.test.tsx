// ADR-207 §2.7 — the module dialog over the catalog page: the module from the catalog query, the install
// plan of the space on the install step and Confirm that runs it, the arrows, View module, the example
// rows switch, and closing back to the catalog with its filters.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { apiClient } from '@/shared/utils/apiClient';
import { useAuthStore } from '@/features/auth/store/authStore';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { agents, kanban, modules } from '@/features/module-catalog/__tests__/fixtures';
import type { CatalogModule } from '@/features/module-catalog';
import type { InstallBindings } from '@/features/module-install';
import { plan } from '@/features/module-install/__tests__/fixtures';
import { ModuleCatalogPage } from '../ModuleCatalogPage';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), request: vi.fn() } }));
vi.mock('@/features/spaces/hooks/useSpaceAccessLevel', () => ({
  useSpaceAccessLevel: () => ({ accessLevel: 'admin', loading: false }),
}));

const apiTree = [{ id: 'project:5', type: 'project', name: 'Sales', children: [{ id: 'table:7', type: 'table', name: 'Leads', data: { name: 'leads', display_name: 'Leads' } }] }];
interface InstallBody { dry_run: boolean; space_id: number; project_id: number; bindings: InstallBindings }
const posts = () => vi.mocked(apiClient.post).mock.calls.map(([path, body]) => ({ path, body: body as InstallBody }));

/** A module whose SLA table carries example rows: off until asked for. */
const seeded: CatalogModule = {
  ...kanban, id: 8, key: 'sla_pack',
  blueprint: {
    ...kanban.blueprint, key: 'sla_pack', title: 'SLA pack',
    tables: [{ key: 'sla', name: 'sla_rules', display_name: 'SLA rules' }],
    seed: [{ table: 'sla', key: ['name'], rows: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], example: true }],
  },
};
let catalog: CatalogModule[] = modules;

const Location = () => { const { pathname, search } = useLocation(); return <output aria-label="Location">{pathname}{search}</output>; };
const open = (entry: string) => renderWithProviders(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="projects/:projectId/modules" element={<ModuleCatalogPage />} />
      <Route path="projects/:projectId/modules/:moduleId" element={<ModuleCatalogPage />} />
      <Route path="*" element={null} />
    </Routes>
    <Location />
  </MemoryRouter>,
  { language: 'en' },
);
const dialog = () => within(screen.getByRole('dialog'));
const region = (name: string) => within(screen.getByRole('region', { name }));

const api = async (path: string) => {
  if (path === '/projects') return { success: true, data: [{ id: 5, space_id: 11, name: 'Sales' }] };
  if (path === '/spaces/11/tree') return { success: true, data: apiTree };
  if (path === '/tables/7') return { success: true, data: { id: 7, name: 'Leads' } };
  if (path.endsWith('/columns')) return { success: true, data: [] };
  return { success: true, data: { items: catalog } };
};

beforeEach(() => {
  catalog = modules;
  useAuthStore.setState({ user: { id: '1', email: 'qa@example.test', name: 'QA', role: 'admin' }, token: 't', initialized: true });
  vi.mocked(apiClient.request).mockReset().mockImplementation(api);
  vi.mocked(apiClient.post).mockReset().mockImplementation(async (_path: string, body: unknown) => {
    const { dry_run: dryRun } = body as InstallBody;
    return { data: { dry_run: dryRun, status: dryRun ? 'install' : 'installed', plan: plan() } };
  });
});
afterEach(() => cleanup());

describe('module dialog', () => {
  it('opens the module of the project space over the catalog, with what the plan amounts to', async () => {
    open(`/projects/5/modules/${kanban.id}`);
    expect(await screen.findByRole('dialog', { name: 'Kanban' })).toBeInTheDocument();
    expect(vi.mocked(apiClient.request).mock.calls.map(([path]) => path)).toContain('/module-registry?space_id=11');
    // The catalog stays underneath, out of the accessibility tree while the dialog is up.
    expect(screen.getByRole('heading', { level: 1, name: 'Module catalog', hidden: true })).toBeInTheDocument();
    expect(await region('What is inside').findByText('Changes in the space: 17')).toBeInTheDocument();
    expect(posts()[0]).toMatchObject({ path: '/modules/install', body: { dry_run: true, space_id: 11, project_id: 5 } });
  });

  it('shows the install plan of the project space on the install step, with the linked table in it', async () => {
    // The dry-run answers with the linked table connected, as the server does when it fits.
    vi.mocked(apiClient.post).mockImplementation(async () => ({
      data: { dry_run: true, status: 'install', plan: plan({ tables: plan().tables.map(table => (table.key === 'tickets' ? { ...table, table_id: 7 } : table)) }) },
    }));
    const user = userEvent.setup();
    open(`/projects/5/modules/${kanban.id}?origin=default&tableId=7`);
    await user.click(await screen.findByRole('button', { name: 'Get Kanban' }));
    expect(await region('Where it goes').findByText(/The table Leads you came from is chosen for tickets/)).toBeInTheDocument();
  });

  it('installs through Get module and Confirm, and leads to the project', async () => {
    const user = userEvent.setup();
    open(`/projects/5/modules/${kanban.id}`);
    await user.click(await screen.findByRole('button', { name: 'Get Kanban' }));
    const button = region('Where it goes').getByRole('button', { name: 'Confirm and install Kanban' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await waitFor(() => expect(posts().some(({ body }) => body.dry_run === false)).toBe(true));
    await waitFor(() => expect(screen.getByLabelText('Location')).toHaveTextContent('/projects/5/dashboard'));
  });

  it('keeps Confirm off until the plan has arrived', async () => {
    let release: (value: unknown) => void = () => {};
    vi.mocked(apiClient.post).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const user = userEvent.setup();
    open(`/projects/5/modules/${kanban.id}`);
    await user.click(await screen.findByRole('button', { name: 'Get Kanban' }));
    const where = region('Where it goes');
    expect(where.getByRole('button', { name: 'Confirm and install Kanban' })).toBeDisabled();
    release({ data: { dry_run: true, status: 'install', plan: plan() } });
    await waitFor(() => expect(where.getByRole('button', { name: 'Confirm and install Kanban' })).toBeEnabled());
  });

  it('keeps Confirm off while the plan has a blocking conflict and says so', async () => {
    vi.mocked(apiClient.post).mockImplementation(async () => ({
      data: { dry_run: true, status: 'blocked', plan: plan({ conflicts: [{ kind: 'TABLE_ALREADY_EXISTS', table: 'sla', blocking: true }] }) },
    }));
    const user = userEvent.setup();
    open(`/projects/5/modules/${kanban.id}`);
    await user.click(await screen.findByRole('button', { name: 'Get Kanban' }));
    const button = screen.getByRole('button', { name: 'Confirm and install Kanban' });
    await waitFor(() => expect(button).toHaveAccessibleDescription('Resolve the conflicts to install.'));
    expect(button).toBeDisabled();
  });

  it('offers View module once the space has an app of the module', async () => {
    vi.mocked(apiClient.post).mockImplementation(async () => ({
      data: { dry_run: true, status: 'install', plan: plan({ apps: [{ key: 'board', preset_name: 'kanban', title: 'Board', dashboard_id: null, widget_id: 77, action: 'existing', binds: [] }] }) },
    }));
    open(`/projects/5/modules/${kanban.id}`);
    expect(await screen.findByRole('link', { name: 'View module' })).toHaveAttribute('href', '/widgets/77');
  });

  it('walks the listed modules with the arrows, keeping the filters', async () => {
    const user = userEvent.setup();
    open(`/projects/5/modules/${kanban.id}?origin=default`);
    const arrows = within(await screen.findByRole('navigation', { name: 'Other modules' }));
    expect(arrows.queryByRole('link', { name: /Previous module/ })).not.toBeInTheDocument();
    await user.click(arrows.getByRole('link', { name: 'Next module: AI Agents' }));
    expect(screen.getByLabelText('Location')).toHaveTextContent(`/projects/5/modules/${agents.id}?origin=default`);
    expect(await screen.findByRole('dialog', { name: 'AI Agents' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Previous module: Kanban' })).toHaveAttribute('href', `/projects/5/modules/${kanban.id}?origin=default`);
  });

  it('lets the platform owner edit a marketplace page and nobody else', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.patch).mockResolvedValue({ data: { item: kanban } });
    open(`/projects/5/modules/${kanban.id}`);
    await screen.findByRole('dialog', { name: 'Kanban' });
    await user.click(screen.getByRole('button', { name: 'Edit: Short description' }));
    await user.clear(screen.getByRole('textbox', { name: 'Short description' }));
    await user.type(screen.getByRole('textbox', { name: 'Short description' }), 'Boards for everyone');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith('/module-registry/preset_kanban_board', { space_id: 11, version: '2.0.0', blueprint: { description: 'Boards for everyone' } }));
    cleanup();

    useAuthStore.setState({ user: { id: '2', email: 'member@example.test', name: 'Member', role: 'member' } });
    open(`/projects/5/modules/${kanban.id}`);
    await screen.findByRole('dialog', { name: 'Kanban' });
    expect(screen.queryByRole('button', { name: /^Edit:/ })).not.toBeInTheDocument();
  });

  it('closes back to the catalog with the same filters', async () => {
    const user = userEvent.setup();
    open(`/projects/5/modules/${kanban.id}?origin=default`);
    // The loading dialog has a Close of its own: wait for the module's.
    const opened = within(await screen.findByRole('dialog', { name: 'Kanban' }));
    await user.click(opened.getByRole('button', { name: 'Close' }));
    expect(screen.getByLabelText('Location')).toHaveTextContent('/projects/5/modules?origin=default');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { level: 1, name: 'Module catalog' })).toBeInTheDocument();
  });

  it('reports a module the registry does not know, and a project the list does not know', async () => {
    open('/projects/5/modules/404');
    expect(await dialog().findByRole('alert')).toHaveTextContent('Module not found');
    expect(dialog().getByRole('link', { name: 'Back to the catalog' })).toHaveAttribute('href', '/projects/5/modules');
    cleanup();
    open(`/projects/404/modules/${kanban.id}`);
    expect(await dialog().findByRole('alert')).toHaveTextContent('Project not found');
  });

  it('reports a registry failure and retries', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.request).mockImplementation(async (path: string) => {
      if (path === '/projects') return api(path);
      throw new Error('Registry offline');
    });
    open(`/projects/5/modules/${kanban.id}`);
    expect(await dialog().findByRole('alert')).toHaveTextContent('Registry offline');
    vi.mocked(apiClient.request).mockImplementation(api);
    await user.click(dialog().getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('dialog', { name: 'Kanban' })).toBeInTheDocument();
  });
});

describe('example rows', () => {
  it('are off until asked for: the first plan writes the no, the switch turns every example table on', async () => {
    catalog = [seeded, ...modules];
    const user = userEvent.setup();
    open(`/projects/5/modules/${seeded.id}`);
    await user.click(await screen.findByRole('button', { name: 'Get SLA pack' }));
    const where = region('Where it goes');
    const examples = await where.findByRole('checkbox', { name: /Add example rows/ });
    expect(examples).not.toBeChecked();
    expect(examples).toHaveAccessibleDescription(/3 rows in SLA rules/);
    await waitFor(() => expect(posts().at(-1)?.body.bindings).toEqual({ tables: { sla: { action: 'create', seed: false } } }));
    expect(where.getByRole('checkbox', { name: 'Add sample rows to SLA rules' })).not.toBeChecked();

    await user.click(examples);
    await waitFor(() => expect(posts().at(-1)?.body.bindings).toEqual({ tables: { sla: { action: 'create', seed: true } } }));
    expect(examples).toBeChecked();
  });
});
