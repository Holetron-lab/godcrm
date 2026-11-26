// ADR-207 W3.3 — InstallPlanTree: the §2.6 matrix on the space tree, exact bindings, mapping and conflicts.
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstallPlanTree } from '../InstallPlanTree';
import type { InstallBindings, InstallPlan, PlanConflict } from '../types';
import { blueprint, dashboards, plan, targetColumns, tree } from './fixtures';

vi.mock('@/shared/utils/apiClient', () => ({ apiClient: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
// Keys stay visible and carry their params, so an assertion names exactly what the screen says.
vi.mock('@/shared/i18n/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}(${Object.values(params).join('|')})` : key),
  }),
}));

afterEach(() => cleanup());

const onInstall = vi.fn();
const changes: InstallBindings[] = [];

/** Holds bindings like the real screen and answers each change with the plan `server` returns for it. */
function Screen({ server = () => plan(), initial = {} }: { server?: (bindings: InstallBindings) => InstallPlan; initial?: InstallBindings }) {
  const [bindings, setBindings] = useState(initial);
  return (
    <InstallPlanTree
      blueprint={blueprint} tree={tree} plan={server(bindings)} bindings={bindings}
      onBindingsChange={(next) => { changes.push(next); setBindings(next); }}
      targetColumns={targetColumns} dashboards={dashboards} onInstall={onInstall}
    />
  );
}
const setup = (props: Parameters<typeof Screen>[0] = {}) => {
  changes.length = 0;
  onInstall.mockClear();
  render(<Screen {...props} />);
  return userEvent.setup();
};
const lastChange = () => changes[changes.length - 1];
const withConflicts = (conflicts: PlanConflict[], over: Partial<InstallPlan> = {}) => () => plan({ conflicts, ...over });
const installButton = () => screen.getByRole('button', { name: 'moduleInstall.summary.install' });

describe('the plan on the tree', () => {
  it('shows new and changed nodes, seed, app, tile, menu and the deferred branches', () => {
    setup();
    const region = screen.getByRole('region', { name: 'moduleInstall.treeLabel(CRM lite)' });
    expect(within(region).getByText('SLA rules').closest('.border-dashed')).not.toBeNull();
    expect(within(region).getAllByText('moduleInstall.state.create').length).toBeGreaterThan(0);
    expect(within(region).getByText('Tickets').parentElement).toHaveTextContent('moduleInstall.state.change');
    expect(within(region).getByText('moduleInstall.seed.counts(12|8)')).toBeInTheDocument();
    expect(within(region).getByText('Board')).toBeInTheDocument();
    expect(within(region).getByText('Open tickets')).toBeInTheDocument();
    expect(within(region).getByRole('checkbox', { name: 'moduleInstall.menu.pin(Board)' })).toBeChecked();
    expect(within(region).getByText('Triage')).toBeInTheDocument();
    expect(within(region).getAllByText('moduleInstall.deferred')).toHaveLength(2);
    expect(screen.getByText('moduleInstall.summary.changes(17)')).toBeInTheDocument();
  });

  it('leaves the rest of the space out of the tree, but keeps it among the connect choices', () => {
    setup();
    expect(screen.queryByText('Sales', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.queryByText('Clients', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('option', { name: 'Sales / Clients' }).length).toBeGreaterThan(0);
  });

  it('names secrets without asking for their values', () => {
    setup();
    const secrets = screen.getByText('moduleInstall.secrets(MAIL_API_KEY)');
    expect(secrets.closest('ul')?.querySelector('input, textarea')).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
});

describe('bindings', () => {
  it('creates, connects and skips a table', async () => {
    const user = setup();
    const select = screen.getByRole('combobox', { name: 'moduleInstall.table.label(SLA rules)' });
    expect(select).toHaveValue('create');
    await user.selectOptions(select, 'connect:1783');
    expect(lastChange()).toEqual({ tables: { sla: { action: 'connect', table_id: 1783 } } });
    await user.selectOptions(screen.getByRole('combobox', { name: 'moduleInstall.table.label(SLA rules)' }), 'skip');
    expect(lastChange()).toEqual({ tables: { sla: { action: 'skip' } } });
  });

  it('offers only connecting for a table the module requires', () => {
    setup({ server: () => plan({ tables: [{ key: 'tickets', name: null, table_id: null, action: 'requires', columns_added: [], project: 'main', requires: true }] }) });
    const select = screen.getByRole('combobox', { name: 'moduleInstall.table.label(tickets)' });
    expect(select).toHaveValue('');
    expect(within(select).queryByRole('option', { name: 'moduleInstall.table.create' })).not.toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Support / Tickets' })).toBeInTheDocument();
  });

  it('selects the project and the dashboard, adopts an app, toggles seed and the menu entry', async () => {
    const user = setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'moduleInstall.project.label(Support)' }), 'create');
    expect(lastChange()).toEqual({ projects: { main: { action: 'create' } } });
    await user.selectOptions(screen.getByRole('combobox', { name: 'moduleInstall.project.label(Support)' }), '2');
    expect(lastChange().projects).toEqual({ main: { action: 'use', project_id: 2 } });

    await user.selectOptions(screen.getByRole('combobox', { name: 'moduleInstall.tile.label(Open tickets)' }), '7540');
    expect(lastChange().tiles).toEqual({ open_count: { dashboard_id: 7540 } });
    await user.selectOptions(screen.getByRole('combobox', { name: 'moduleInstall.tile.label(Open tickets)' }), 'skip');
    expect(lastChange().tiles).toEqual({ open_count: { action: 'skip' } });

    await user.selectOptions(screen.getByRole('combobox', { name: 'moduleInstall.app.label(Board)' }), '110');
    expect(lastChange().apps).toEqual({ board: { action: 'adopt', widget_id: 110 } });

    await user.click(screen.getByRole('checkbox', { name: 'moduleInstall.seed.label(SLA rules)' }));
    expect(lastChange().tables).toEqual({ sla: { action: 'create', seed: false } });

    await user.click(screen.getByRole('checkbox', { name: 'moduleInstall.menu.pin(Board)' }));
    expect(lastChange().sidebar).toEqual({ board: false });
  });
});

describe('column mapping', () => {
  const target = (column: string) => screen.getByRole('combobox', { name: `columnMapping.targetFor(${column})` });

  it('shows the auto-match and walks rename → new column → skip', async () => {
    const user = setup();
    expect(target('status')).toHaveValue('state');
    expect(screen.getByText('moduleInstall.table.optionsAdded(state|2)')).toBeInTheDocument();
    await user.selectOptions(target('status'), 'prio');
    expect(lastChange()).toEqual({
      tables: { tickets: { action: 'connect', table_id: 1708, columns: [{ module_column: 'status', target: 'prio' }] } },
    });
    await user.selectOptions(target('status'), '__new');
    await user.selectOptions(target('status'), '');
    expect(lastChange().tables?.tickets).toMatchObject({ columns: [{ module_column: 'status', target: null }] });
    expect(target('status')).toHaveValue('');
  });

  it('keeps a reassignment when the next dry-run answers with its own match', async () => {
    const user = setup();
    await user.selectOptions(target('status'), 'prio');
    // The server still reports `state` here; the user's choice is what the screen and the next request carry.
    expect(target('status')).toHaveValue('prio');
    await user.click(screen.getByRole('checkbox', { name: 'moduleInstall.seed.label(SLA rules)' }));
    expect(lastChange().tables?.tickets).toMatchObject({ columns: [{ module_column: 'status', target: 'prio' }] });
  });

  it('never lets the type of a mapped column be edited', () => {
    setup();
    expect(screen.getByRole('combobox', { name: 'columnMapping.typeFor(status)' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'columnMapping.typeFor(company)' })).toBeDisabled();
  });
});

describe('conflicts', () => {
  const typeConflict: PlanConflict = {
    kind: 'column_type', table: 'tickets', column: 'priority', target: 'prio', existing_type: 'select', declared_type: 'number',
    reason: 'select ← number', referenced_by: ['apps.board.config.sort'], blocking: true,
  };

  it('blocks Install until the server reports no blocking conflict', async () => {
    const user = setup({ server: (bindings) => plan({ conflicts: bindings.tables?.tickets ? [] : [typeConflict] }) });
    expect(installButton()).toBeDisabled();
    expect(screen.getByText('moduleInstall.summary.resolve')).toBeInTheDocument();
    expect(screen.getAllByText('moduleInstall.conflicts.columnType(priority|number|prio|select)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('moduleInstall.conflicts.usedBy(apps.board.config.sort)').length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByRole('combobox', { name: 'columnMapping.targetFor(priority)' }), '__new');
    expect(installButton()).toBeEnabled();
    await user.click(installButton());
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('leaves Install on for a conflict the server does not mark as blocking', () => {
    setup({ server: withConflicts([{ kind: 'column_type_mismatch', table: 'sla', column: 'title', existing_type: 'text', declared_type: 'number' }]) });
    expect(screen.getAllByText('moduleInstall.conflicts.typeKept(title|text|number)').length).toBeGreaterThan(0);
    expect(installButton()).toBeEnabled();
  });

  it('keeps the changes count and the conflicts, but no Install, when whoever shows the plan installs from elsewhere', () => {
    render(<InstallPlanTree blueprint={blueprint} tree={tree} plan={plan({ conflicts: [typeConflict] })} bindings={{}} onBindingsChange={() => undefined}
      targetColumns={targetColumns} dashboards={dashboards} />);
    expect(screen.queryByRole('button', { name: 'moduleInstall.summary.install' })).not.toBeInTheDocument();
    expect(screen.getByText('moduleInstall.summary.changes(17)')).toBeInTheDocument();
    expect(screen.getByText('moduleInstall.summary.resolve')).toBeInTheDocument();
  });

  it('names both tables of a relation_target conflict with expected and actual', () => {
    setup({
      server: withConflicts([{
        kind: 'relation_target', table: 'tickets', column: 'company', target: 'client',
        expected_table_id: 100846, actual_table_id: 1783, reason: 'relation_target: 100846 ≠ 1783', blocking: true,
      }]),
    });
    expect(screen.getAllByText('moduleInstall.conflicts.relationTarget(company|client|Companies #100846|Clients #1783)').length).toBeGreaterThan(0);
  });

  it('names the module table when the expected relation target is still to be created', () => {
    setup({
      server: withConflicts([{
        kind: 'relation_target', table: 'tickets', column: 'company', target: 'client',
        expected_table_id: null, actual_table_id: 1783, blocking: true,
      }]),
    });
    expect(screen.getAllByText('moduleInstall.conflicts.relationTarget(company|client|Companies|Clients #1783)').length).toBeGreaterThan(0);
  });

  it('explains an unsupported preset and a missing required column', () => {
    setup({
      server: withConflicts([
        { kind: 'PRESET_COLUMN_MAPPING_UNSUPPORTED', table: 'tickets', preset: 'gantt', referenced_by: ['apps.board'], blocking: true },
        { kind: 'REQUIRED_COLUMN_UNMAPPED', table: 'tickets', column: 'status', blocking: true },
      ]),
    });
    expect(screen.getAllByText('moduleInstall.conflicts.presetUnsupported(gantt)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('moduleInstall.conflicts.requiredColumn(status)').length).toBeGreaterThan(0);
    expect(screen.getByText('moduleInstall.conflicts.title(2)')).toBeInTheDocument();
    expect(installButton()).toBeDisabled();
  });

  it('leads from the conflict list to the control of the problem node, opening its branch', async () => {
    const user = setup({ server: withConflicts([typeConflict]) });
    await user.click(screen.getByRole('button', { name: 'schemaEditor.collapseAll: Support' }));
    expect(screen.queryByRole('combobox', { name: 'columnMapping.targetFor(priority)' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'moduleInstall.conflicts.show' }));
    expect(screen.getByRole('combobox', { name: 'columnMapping.targetFor(priority)' })).toHaveFocus();
  });

  it('falls back to the server wording for a conflict kind it does not know', () => {
    setup({ server: withConflicts([{ kind: 'TABLE_NOT_IN_SPACE', table: 'sla', blocking: true }]) });
    expect(screen.getAllByText('moduleInstall.conflicts.other(TABLE_NOT_IN_SPACE)').length).toBeGreaterThan(0);
  });
});

describe('keyboard', () => {
  it('keeps focus on the control after the plan moves its node', async () => {
    // Connecting moves the table from "to be created" under the project onto the existing table node.
    const user = setup({
      server: (bindings) => (bindings.tables?.sla?.action === 'connect'
        ? plan({ tables: [{ key: 'sla', name: 'sla_rules', table_id: 1783, action: 'connect', columns: [], columns_added: [], project: 'main' }] })
        : plan()),
    });
    const select = screen.getByRole('combobox', { name: 'moduleInstall.table.label(SLA rules)' });
    select.focus();
    await user.selectOptions(select, 'connect:1783');
    const moved = screen.getByRole('combobox', { name: 'moduleInstall.table.label(SLA rules)' });
    expect(moved).toHaveValue('connect:1783');
    expect(moved).toHaveFocus();
  });

  it('reaches every control of the plan with Tab alone', async () => {
    const user = setup();
    const reached = new Set<Element>();
    for (let i = 0; i < 60 && document.activeElement !== installButton(); i += 1) {
      await user.tab();
      if (document.activeElement) reached.add(document.activeElement);
    }
    expect(document.activeElement).toBe(installButton());
    for (const name of [
      'moduleInstall.project.label(Support)', 'moduleInstall.table.label(SLA rules)', 'columnMapping.targetFor(status)',
      'moduleInstall.app.label(Board)', 'moduleInstall.tile.label(Open tickets)',
    ]) expect(reached, name).toContain(screen.getByRole('combobox', { name }));
  });
});
