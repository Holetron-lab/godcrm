// Shared data for the install plan tests: a space tree, a blueprint and the dry-run plan for it.
import type { NavTreeNode } from '@/features/schema-editor/types/schema-editor.types';
import type { InstallPlan, ModuleBlueprint } from '../types';

const node = (id: string, type: NavTreeNode['type'], name: string, children: NavTreeNode[] = [], extra: Partial<NavTreeNode> = {}): NavTreeNode =>
  ({ id, type, numericId: Number(id.split(':')[1]), name, displayName: name, icon: '📋', children, parentId: null, ...extra });

export const tree: NavTreeNode[] = [
  node('project:1', 'project', 'Support', [
    node('table:1708', 'table', 'Tickets'),
    node('widget:110', 'widget', 'Old board', [], { presetName: 'kanban' }),
  ]),
  node('project:2', 'project', 'Sales', [node('table:1783', 'table', 'Clients'), node('table:100846', 'table', 'Companies')]),
];

export const blueprint: ModuleBlueprint = {
  key: 'crm-lite', version: '2.0.0', title: 'CRM lite',
  requires: {
    tables: [{
      key: 'tickets',
      columns: [
        { column_name: 'status', type: 'select', required: true },
        { column_name: 'priority', type: 'number' },
        { column_name: 'company', type: 'relation', target: 'companies' },
      ],
    }],
  },
  tables: [
    { key: 'sla', name: 'sla_rules', display_name: 'SLA rules' },
    { key: 'companies', name: 'companies', display_name: 'Companies' },
  ],
  services: [{ key: 'mail', url: 'https://mail.example', secrets: ['MAIL_API_KEY'] }],
  agents: [{ key: 'triage', title: 'Triage' }],
};

export const plan = (over: Partial<InstallPlan> = {}): InstallPlan => ({
  module_key: 'crm-lite', version: '2.0.0',
  projects: [{ key: 'main', action: 'use', project_id: 1, title: 'Support' }],
  tables: [
    { key: 'sla', name: 'sla_rules', table_id: null, action: 'create', columns_added: ['title'], project: 'main' },
    {
      key: 'tickets', name: 'tickets', table_id: 1708, action: 'connect', columns_added: [], project: 'main', requires: true,
      columns: [
        { module_column: 'status', target: 'state', match: 'display_name', compat: 'ok', module_type: 'select', target_type: 'select', options_added: 2 },
        { module_column: 'priority', target: 'prio', match: 'column_name', compat: 'ok', module_type: 'number', target_type: 'number' },
        { module_column: 'company', target: '__new', match: 'new', compat: 'ok', module_type: 'relation', target_type: 'relation' },
      ],
    },
  ],
  seed: [{ table: 'sla', insert: 12, existing: 8 }],
  apps: [{ key: 'board', preset_name: 'kanban', title: 'Board', dashboard_id: null, widget_id: null, action: 'create', binds: [{ table: 'tickets', table_id: 1708 }] }],
  dashboards: [{ key: 'main', title: 'Main board', dashboard_id: 7536, action: 'existing' }],
  tiles: [{ key: 'open_count', dashboard_key: 'main', preset_name: 'number_widget', title: 'Open tickets', dashboard_id: 7536, widget_id: null, action: 'create', binds: [] }],
  sidebar: [{ widget: 'board', action: 'create' }],
  services: [{ key: 'mail', action: 'deferred' }],
  agents: [{ key: 'triage', action: 'deferred' }],
  conflicts: [],
  changes: 17,
  ...over,
});

export const targetColumns = {
  1708: [
    { id: 'state', name: 'state', displayName: 'State', type: 'select' },
    { id: 'prio', name: 'prio', displayName: 'Prio', type: 'select' },
    { id: 'client', name: 'client', displayName: 'Client', type: 'relation' },
  ],
};

export const dashboards = [{ id: 7536, name: 'Main board' }, { id: 7540, name: 'Sales board' }];
