// ADR-207 W3.3 — InstallPlanScreen: dry-run round trip, role states and the install request.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { apiClient } from '@/shared/utils/apiClient';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { InstallPlanScreen } from '../InstallPlanScreen';
import type { InstallBindings, ModuleBlueprint } from '../types';
import { blueprint, plan } from './fixtures';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), request: vi.fn() } }));
const access = vi.hoisted(() => ({ level: 'admin' }));
vi.mock('@/features/spaces/hooks/useSpaceAccessLevel', () => ({
  useSpaceAccessLevel: () => ({ accessLevel: access.level, loading: false }),
}));

const apiTree = [{
  id: 'project:1', type: 'project', name: 'Support',
  children: [{ id: 'table:1708', type: 'table', name: 'Tickets', data: { name: 'tickets', display_name: 'Tickets' } }],
}];
const columns = [{ id: 1, table_id: 1708, name: 'state', display_name: 'State', column_type: 'select' }];
const dataOnly: ModuleBlueprint = { ...blueprint, services: [], agents: [] };
const onInstalled = vi.fn();

interface InstallBody { dry_run: boolean; bindings: InstallBindings; space_id: number; project_id: number; blueprint: ModuleBlueprint }
const posts = () => vi.mocked(apiClient.post).mock.calls.map(([path, body]) => ({ path, body: body as InstallBody }));

const open = (module: ModuleBlueprint = blueprint, connectTable?: { id: number; name: string }) =>
  renderWithProviders(<InstallPlanScreen blueprint={module} spaceId={11} projectId={1} connectTable={connectTable} onInstalled={onInstalled} />, { language: 'en' });

beforeEach(() => {
  access.level = 'admin';
  onInstalled.mockClear();
  vi.mocked(apiClient.request).mockReset().mockImplementation(async (path: string) =>
    (path.endsWith('/tree') ? { success: true, data: apiTree } : { success: true, data: columns }));
  vi.mocked(apiClient.post).mockReset().mockImplementation(async (_path: string, body: unknown) => {
    const { dry_run: dryRun } = body as InstallBody;
    return { data: { dry_run: dryRun, status: dryRun ? 'install' : 'installed', plan: plan() } };
  });
});
afterEach(() => cleanup());

describe('dry-run round trip', () => {
  it('asks the server for the plan and sends every change back as bindings', async () => {
    const user = userEvent.setup();
    open();
    const table = await screen.findByRole('combobox', { name: 'Table for SLA rules' });
    expect(posts()[0]).toEqual({
      path: '/modules/install',
      body: { blueprint, space_id: 11, project_id: 1, dry_run: true, bindings: {} },
    });
    expect(screen.getByText('Changes: 17')).toBeInTheDocument();

    await user.selectOptions(table, 'connect:1708');
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1].body).toMatchObject({ dry_run: true, bindings: { tables: { sla: { action: 'connect', table_id: 1708 } } } });
  });

  it('offers the columns of a connected table as mapping targets', async () => {
    open();
    const target = await screen.findByRole('combobox', { name: 'Target column for status' });
    await waitFor(() => expect(target).toHaveValue('state'));
    expect(vi.mocked(apiClient.request)).toHaveBeenCalledWith('/tables/1708/columns');
    expect(await within(target).findByRole('option', { name: 'State' })).toBeInTheDocument();
  });

  it('installs with the same bindings and reports the result', async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole('checkbox', { name: 'Show Board in the menu' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(onInstalled).toHaveBeenCalledTimes(1));
    expect(posts()[2].body).toMatchObject({ dry_run: false, project_id: 1, bindings: { sidebar: { board: false } } });
  });

  it('says why the plan could not be built and lets the user retry', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('bindings are invalid'));
    const user = userEvent.setup();
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('The install plan could not be built');
    expect(screen.getByRole('alert')).toHaveTextContent('bindings are invalid');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Changes: 17')).toBeInTheDocument();
  });

  it('keeps the plan on screen and shows the reason when the install is refused', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText('Changes: 17');
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('Resolve module binding conflicts before installing'));
    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Resolve module binding conflicts before installing');
    expect(onInstalled).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Install' })).toBeInTheDocument();
  });
});

describe('table a link brought along', () => {
  const tickets = { id: 1708, name: 'Tickets' };

  it('starts the plan with the table connected and says where it went', async () => {
    open(blueprint, tickets);
    expect(await screen.findByText('The table Tickets you came from is chosen for tickets. Check below how its columns fit, or choose another table.')).toBeInTheDocument();
    expect(posts()[0].body).toMatchObject({ dry_run: true, bindings: { tables: { tickets: { action: 'connect', table_id: 1708 } } } });
  });

  it('keeps quiet once the user gives the module table another one', async () => {
    vi.mocked(apiClient.post).mockImplementation(async (_path: string, body: unknown) => {
      const { bindings } = body as InstallBody;
      const chosen = bindings.tables?.tickets;
      const tableId = chosen?.action === 'connect' ? chosen.table_id : null;
      return { data: { dry_run: true, status: 'install', plan: plan({ tables: plan().tables.map(table => (table.key === 'tickets' ? { ...table, table_id: tableId } : table)) }) } };
    });
    const user = userEvent.setup();
    open(blueprint, { id: 1783, name: 'Clients' });
    expect(await screen.findByText(/The table Clients you came from is chosen for tickets/)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Table for tickets' }), 'connect:1708');
    await waitFor(() => expect(screen.queryByText(/The table Clients you came from/)).not.toBeInTheDocument());
  });

  it('shows the dry-run refusal of a table that is not in the space', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { dry_run: true, status: 'install', plan: plan({
      tables: plan().tables.map(table => (table.key === 'tickets' ? { ...table, table_id: 99, columns: undefined } : table)),
      conflicts: [{ kind: 'TABLE_NOT_IN_SPACE', table: 'tickets', blocking: true }],
    }) } });
    open(blueprint, { id: 99, name: '#99' });
    expect(await screen.findByText('The table #99 you came from cannot be connected: it was not found in this space. Choose another table below.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled();
  });

  it('says that a module without tables leaves the table alone', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { dry_run: true, status: 'install', plan: plan({ tables: [], seed: [], apps: [], tiles: [], sidebar: [], services: [], agents: [] }) } });
    open({ key: 'notes', version: '1.0.0', title: 'Notes' }, tickets);
    expect(await screen.findByText('This module has no tables, so the table Tickets you came from will not be connected.')).toBeInTheDocument();
    expect(posts()[0].body.bindings).toEqual({});
  });
});

describe('roles', () => {
  it('shows a viewer why the module cannot be installed and asks the server nothing', async () => {
    access.level = 'viewer';
    open(dataOnly);
    expect(await screen.findByText('Installing a module requires the member role in this space.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('lets a member plan a module made of tables, apps and tiles', async () => {
    access.level = 'editor';
    open(dataOnly);
    expect(await screen.findByRole('button', { name: 'Install' })).toBeEnabled();
    expect(posts()[0].body.dry_run).toBe(true);
  });

  it('shows a member the locked agent and service branches instead of a plan', async () => {
    access.level = 'editor';
    open();
    expect(await screen.findByText(/Only a space administrator can install it/)).toBeInTheDocument();
    const locked = screen.getByRole('list', { name: 'Requires an administrator' });
    expect(locked).toHaveTextContent('Agents: Triage');
    expect(locked).toHaveTextContent('Services: mail');
    expect(locked).not.toHaveTextContent('MAIL_API_KEY');
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('gives an administrator the whole plan, deferred branches included', async () => {
    access.level = 'owner_owner';
    open();
    expect(await screen.findByText('Secrets, set in the space vault: MAIL_API_KEY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled();
  });
});

describe('example rows', () => {
  const seeded: ModuleBlueprint = { ...dataOnly, seed: [{ table: 'sla', key: ['name'], rows: [{ name: 'a' }, { name: 'b' }], example: true }] };

  it('are off until asked for: the first plan writes the no, the switch and the table box agree, the switch turns them on', async () => {
    const user = userEvent.setup();
    open(seeded);
    const examples = await screen.findByRole('checkbox', { name: /Add example rows/ });
    expect(examples).toHaveAccessibleDescription(/2 rows in SLA rules/);
    await waitFor(() => expect(posts().at(-1)?.body.bindings).toEqual({ tables: { sla: { action: 'create', seed: false } } }));
    expect(examples).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Add sample rows to SLA rules' })).not.toBeChecked();

    await user.click(examples);
    await waitFor(() => expect(posts().at(-1)?.body.bindings).toEqual({ tables: { sla: { action: 'create', seed: true } } }));
    expect(examples).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Add sample rows to SLA rules' })).toBeChecked();
  });

  it('have no switch, and cost no second dry-run, in a module without example groups', async () => {
    open(dataOnly);
    expect(await screen.findByRole('checkbox', { name: 'Add sample rows to SLA rules' })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /Add example rows/ })).not.toBeInTheDocument();
    expect(posts()).toHaveLength(1);
  });
});
