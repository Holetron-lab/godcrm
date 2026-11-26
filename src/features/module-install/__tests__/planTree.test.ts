// ADR-207 W3.3 — the dry-run plan printed onto the space tree (§2.6).
import { describe, expect, it } from 'vitest';
import type { NavTreeNode } from '@/features/schema-editor/types/schema-editor.types';
import { buildPlanTree } from '../planTree';
import type { InstallPlan, ModuleBlueprint } from '../types';

const node = (id: string, type: NavTreeNode['type'], name: string, children: NavTreeNode[] = [], extra: Partial<NavTreeNode> = {}): NavTreeNode =>
  ({ id, type, numericId: Number(id.split(':')[1]), name, displayName: name, icon: '📋', children, parentId: null, ...extra });

const tree = [
  node('project:1', 'project', 'Support', [
    node('table:1708', 'table', 'Tickets'),
    node('widget:110', 'widget', 'Old board', [], { presetName: 'kanban' }),
  ]),
  node('project:2', 'project', 'Sales', [node('table:1783', 'table', 'Clients')]),
];

const blueprint: ModuleBlueprint = {
  key: 'crm-lite', version: '2.0.0',
  tables: [{ key: 'sla', name: 'sla_rules', display_name: 'SLA rules' }],
  requires: { tables: [{ key: 'tickets' }] },
};

const plan = (over: Partial<InstallPlan> = {}): InstallPlan => ({
  module_key: 'crm-lite', version: '2.0.0',
  projects: [{ key: 'main', action: 'use', project_id: 1, title: 'Support' }],
  tables: [
    { key: 'sla', name: 'sla_rules', table_id: null, action: 'create', columns_added: ['title'], project: 'main' },
    { key: 'tickets', name: 'tickets', table_id: 1708, action: 'connect', columns: [], columns_added: [], project: 'main' },
  ],
  seed: [],
  apps: [{ key: 'board', preset_name: 'kanban', title: 'Board', dashboard_id: null, widget_id: null, action: 'create', binds: [{ table: 'tickets', table_id: 1708 }] }],
  dashboards: [{ key: 'main', title: 'Main', dashboard_id: 7536, action: 'existing' }],
  tiles: [{ key: 'open_count', dashboard_key: 'main', preset_name: 'number_widget', title: 'Open', dashboard_id: 7536, widget_id: null, action: 'create', binds: [] }],
  sidebar: [{ widget: 'board', action: 'create' }],
  services: [{ key: 'mail', action: 'deferred' }],
  conflicts: [], changes: 4,
  ...over,
});

const labels = { dashboards: 'Dashboards', menu: 'Menu', agents: 'Agents', automations: 'Automations', services: 'Services' };
const find = (nodes: NavTreeNode[], id: string): NavTreeNode | undefined =>
  nodes.map((n) => (n.id === id ? n : find(n.children, id))).find(Boolean);

describe('buildPlanTree', () => {
  it('adds a created table to its project and marks the connected one where it already lives', () => {
    const built = buildPlanTree(tree, plan(), blueprint, labels);
    const created = find(built.nodes, 'table:plan:sla');
    expect(created).toMatchObject({ displayName: 'SLA rules', parentId: 'project:1' });
    expect(built.meta.get('table:plan:sla')).toEqual({ kind: 'table', key: 'sla', state: 'create' });
    expect(built.meta.get('table:1708')).toEqual({ kind: 'table', key: 'tickets', state: 'change' });
    expect(built.meta.get('project:1')).toEqual({ kind: 'project', key: 'main', state: 'change' });
  });

  it('puts the app under its table and adopts an existing widget in place', () => {
    const created = buildPlanTree(tree, plan(), blueprint, labels);
    expect(find(created.nodes, 'widget:plan:app:board')).toMatchObject({ parentId: 'table:1708', presetName: 'kanban' });

    const adopted = buildPlanTree(tree, plan({
      apps: [{ key: 'board', preset_name: 'kanban', title: 'Board', dashboard_id: null, widget_id: 110, action: 'adopt', binds: [] }],
    }), blueprint, labels);
    expect(find(adopted.nodes, 'widget:plan:app:board')).toBeUndefined();
    expect(adopted.meta.get('widget:110')).toEqual({ kind: 'app', key: 'board', state: 'change' });
  });

  it('creates a dashed project for `create` and keeps skipped and unbound tables under it', () => {
    const built = buildPlanTree(tree, plan({
      projects: [{ key: 'main', action: 'create', project_id: null, title: 'Support desk' }],
      tables: [
        { key: 'sla', name: 'sla_rules', table_id: null, action: 'skip', columns_added: [], project: 'main' },
        { key: 'tickets', name: null, table_id: null, action: 'requires', columns_added: [], project: 'main', requires: true },
      ],
      apps: [],
    }), blueprint, labels);
    expect(built.nodes[0]).toMatchObject({ id: 'project:plan:main', displayName: 'Support desk' });
    expect(built.nodes[0].children.map((child) => child.id)).toEqual(['table:plan:sla', 'table:plan:tickets']);
    expect(built.meta.get('table:plan:sla')?.state).toBe('skip');
    expect(built.meta.get('table:plan:tickets')?.state).toBe('requires');
  });

  it('adds dashboards with tiles and one section per menu / service group', () => {
    const built = buildPlanTree(tree, plan(), blueprint, labels);
    expect(find(built.nodes, 'widget:plan:tile:open_count')).toMatchObject({ parentId: 'folder:plan:dashboard:main' });
    expect(built.nodes.map((n) => n.id)).toEqual([
      'project:1', 'folder:plan:dashboards', 'folder:plan:menu', 'folder:plan:services',
    ]);
    expect(built.meta.get('folder:plan:services')).toEqual({ kind: 'section', key: 'services', state: null });
  });

  it('opens every branch that leads to a planned node and leaves the rest closed', () => {
    const { open } = buildPlanTree(tree, plan(), blueprint, labels);
    expect(open.has('project:1')).toBe(true);
    expect(open.has('table:1708')).toBe(true);
    expect(open.has('folder:plan:dashboard:main')).toBe(true);
    expect(open.has('project:2')).toBe(false);
  });

  it('shows only the branches the plan touches: untouched projects and siblings are left out', () => {
    const { nodes } = buildPlanTree(tree, plan(), blueprint, labels);
    expect(nodes.map((node) => node.id)).toEqual(['project:1', 'folder:plan:dashboards', 'folder:plan:menu', 'folder:plan:services']);
    // The connected table and the created one stay; the old board the plan does not mention goes.
    expect(find(nodes, 'project:1')?.children.map((node) => node.id)).toEqual(['table:1708', 'table:plan:sla']);
    expect(find(nodes, 'widget:110')).toBeUndefined();
    expect(find(nodes, 'project:2')).toBeUndefined();
  });

  it('keeps a widget the plan adopts, and nothing else of its project', () => {
    const adopting = plan({ apps: [{ ...plan().apps![0], widget_id: 110, action: 'adopt' }] });
    const { nodes } = buildPlanTree(tree, adopting, blueprint, labels);
    expect(find(nodes, 'widget:110')).toBeDefined();
    expect(find(nodes, 'project:2')).toBeUndefined();
  });
});
