// ADR-207 W4.2 — the catalog page: registry requests for the filters, Install leading to the module page, old links.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { apiClient } from '@/shared/utils/apiClient';
import { useAuthStore } from '@/features/auth/store/authStore';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { agents, kanban, modules } from '@/features/module-catalog/__tests__/fixtures';
import { ModuleCatalogPage, WidgetCreateRedirect } from '../ModuleCatalogPage';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), request: vi.fn() } }));

const Location = () => { const { pathname, search } = useLocation(); return <output aria-label="Location">{pathname}{search}</output>; };
const open = (entry: string) => renderWithProviders(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="projects/:projectId/modules" element={<ModuleCatalogPage />} />
      <Route path="projects/:projectId/widgets/create" element={<WidgetCreateRedirect />} />
      <Route path="*" element={null} />
    </Routes>
    <Location />
  </MemoryRouter>,
  { language: 'en' },
);
const registryCalls = () => vi.mocked(apiClient.request).mock.calls.map(([path]) => path).filter(path => path.startsWith('/module-registry'));
const lastQuery = () => Object.fromEntries(new URLSearchParams(registryCalls().at(-1)?.split('?')[1]));

const api = async (path: string) => {
  if (path === '/projects') return { success: true, data: [{ id: 5, space_id: 11, name: 'Sales' }] };
  if (path === '/tables/7') return { success: true, data: { id: 7, project_id: 5, name: 'Deals' } };
  if (path.startsWith('/tables/')) throw new Error('Table not found');
  return { success: true, data: { items: modules } };
};

beforeEach(() => {
  // The project list query runs only for a signed-in user.
  useAuthStore.setState({ user: { id: '1', email: 'qa@example.test', name: 'QA', role: 'admin' }, token: 't', initialized: true });
  vi.mocked(apiClient.request).mockReset().mockImplementation(api);
});
afterEach(() => cleanup());

describe('catalog', () => {
  it('loads the registry of the project space', async () => {
    open('/projects/5/modules');
    expect(await screen.findByRole('article', { name: 'Kanban' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Module catalog' })).toBeInTheDocument();
    expect(apiClient.request).toHaveBeenCalledWith('/projects');
    expect(registryCalls()).toEqual(['/module-registry?space_id=11']);
  });

  it('leads from a card to the module page with the filters kept', async () => {
    open('/projects/5/modules?origin=default&tableId=7');
    await screen.findByRole('article', { name: 'Kanban' });
    expect(screen.getByRole('link', { name: 'Kanban' })).toHaveAttribute('href', `/projects/5/modules/${kanban.id}?origin=default&tableId=7`);
  });

  it('reports a project the list does not know', async () => {
    open('/projects/404/modules');
    expect(await screen.findByRole('alert')).toHaveTextContent('Project not found');
    expect(registryCalls()).toEqual([]);
  });

  it('combines the filters into one registry request and keeps them in the URL', async () => {
    const user = userEvent.setup();
    open('/projects/5/modules');
    await screen.findByRole('article', { name: 'Kanban' });

    await user.click(screen.getByRole('radio', { name: 'Built-in' }));
    await user.click(screen.getByRole('checkbox', { name: 'Apps' }));
    await user.click(screen.getByRole('checkbox', { name: 'Agents' }));
    await user.click(screen.getByRole('button', { name: 'support' }));
    await user.click(screen.getByRole('checkbox', { name: 'I can install myself' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search modules' }), 'board');

    await waitFor(() => expect(lastQuery()).toEqual({
      space_id: '11', origin: 'default', components: 'app,agent', category: 'support', can_install: 'true', search: 'board',
    }));
    expect(screen.getByLabelText('Location')).toHaveTextContent('/projects/5/modules?origin=default&components=app%2Cagent&category=support&mine=1&q=board');
  });

  it('does not ask the registry for every keystroke of the search', async () => {
    const user = userEvent.setup();
    open('/projects/5/modules');
    await screen.findByRole('article', { name: 'Kanban' });
    await user.type(screen.getByRole('searchbox', { name: 'Search modules' }), 'kanban');
    await waitFor(() => expect(lastQuery().search).toBe('kanban'));
    expect(registryCalls()).toHaveLength(2);
  });

  it('restores the filters from a link', async () => {
    open('/projects/5/modules?origin=internal&mine=1');
    await waitFor(() => expect(lastQuery()).toEqual({ space_id: '11', origin: 'internal', can_install: 'true' }));
    expect(screen.getByRole('radio', { name: 'Internal' })).toBeChecked();
  });

  it('reports a registry failure and retries', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.request).mockImplementation(async (path: string) => {
      if (path === '/projects') return api(path);
      throw new Error('Registry offline');
    });
    open('/projects/5/modules');
    expect(await screen.findByRole('alert')).toHaveTextContent('Registry offline');
    vi.mocked(apiClient.request).mockImplementation(api);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('article', { name: 'Kanban' })).toBeInTheDocument();
  });
});

describe('install', () => {
  it('leads from Install on a card to the module page, keeping the filters', async () => {
    const user = userEvent.setup();
    open('/projects/5/modules?origin=default');
    await user.click(await screen.findByRole('button', { name: 'Install Kanban' }));
    expect(screen.getByLabelText('Location')).toHaveTextContent(`/projects/5/modules/${kanban.id}?origin=default`);
  });

  it('lands an old ?install= link on the module page, with the rest of its query', async () => {
    open(`/projects/5/modules?origin=default&install=${agents.id}&tableId=7`);
    await waitFor(() => expect(screen.getByLabelText('Location')).toHaveTextContent(`/projects/5/modules/${agents.id}?origin=default&tableId=7`));
  });

  it('ignores an ?install= that is not a module id', async () => {
    open('/projects/5/modules?install=abc');
    expect(await screen.findByRole('article', { name: 'Kanban' })).toBeInTheDocument();
    expect(screen.getByLabelText('Location')).toHaveTextContent('/projects/5/modules?install=abc');
  });
});

describe('old create link (ADR-163 surface)', () => {
  it('lands in the catalog and keeps its query', async () => {
    open('/projects/5/widgets/create?tableId=7&type=table');
    expect(await screen.findByRole('article', { name: 'Kanban' })).toBeInTheDocument();
    expect(screen.getByLabelText('Location')).toHaveTextContent('/projects/5/modules?tableId=7&type=table');
  });
});

describe('table a link brought along (?tableId)', () => {
  // The links as the table screens write them, and the catalog's own URL.
  it.each([
    ['the table toolbar (TableFilters, ToolbarButtons)', '/projects/5/widgets/create?tableId=7'],
    ['the raw table view (RawTableViewPage)', '/projects/5/widgets/create?tableId=7&type=table'],
    ['a direct catalog URL', '/projects/5/modules?tableId=7'],
  ])('offers the table from %s to the module the user opens', async (_source, link) => {
    const user = userEvent.setup();
    open(link);
    expect(await screen.findByText('Opened from the table Deals. The install plan of a module will offer to connect it.')).toBeInTheDocument();
    expect(apiClient.request).toHaveBeenCalledWith('/tables/7');

    // The module page takes the table along: its plan starts with it connected.
    await user.click(await screen.findByRole('button', { name: 'Install Kanban' }));
    expect(screen.getByLabelText('Location')).toHaveTextContent(`/projects/5/modules/${kanban.id}?tableId=7`);
  });

  it('lets the user go on without the table', async () => {
    const user = userEvent.setup();
    open('/projects/5/modules?origin=default&tableId=7&type=table');
    await user.click(await screen.findByRole('link', { name: 'Continue without the table' }));
    expect(screen.getByLabelText('Location')).toHaveTextContent('/projects/5/modules?origin=default');
    expect(screen.queryByText(/Opened from the table/)).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Install Kanban' }));
    expect(screen.getByLabelText('Location')).toHaveTextContent(`/projects/5/modules/${kanban.id}?origin=default`);
  });

  it('names a table it could not read by its number and still hands it over', async () => {
    open('/projects/5/modules?tableId=99');
    expect(await screen.findByText('Opened from the table #99. The install plan of a module will offer to connect it.')).toBeInTheDocument();
  });

  it.each(['undefined', '0', '7abc', ''])('ignores tableId=%s', async (value) => {
    open(`/projects/5/modules?tableId=${value}`);
    expect(await screen.findByRole('article', { name: 'Kanban' })).toBeInTheDocument();
    expect(screen.queryByText(/Opened from the table/)).not.toBeInTheDocument();
    expect(vi.mocked(apiClient.request).mock.calls.some(([path]) => path.startsWith('/tables/'))).toBe(false);
  });
});
