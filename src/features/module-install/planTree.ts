// ADR-207 §2.6 — the dry-run plan printed onto the tree of the target space.
// Existing nodes the plan touches are marked in place; everything the install would create is added
// as a new node where it will live. Only the branches the plan touches stay on the tree (owner, chat
// 3813, 11.11.2026): a project the module leaves alone is not shown. No verdict is computed here:
// states mirror the plan's `action`.
import type { NavTreeNode } from '@/features/schema-editor/types/schema-editor.types';
import type { InstallPlan, ModuleBlueprint } from './types';

export type PlanNodeState = 'create' | 'change' | 'existing' | 'skip' | 'requires';

export interface PlanNodeMeta {
  kind: 'project' | 'table' | 'app' | 'tile' | 'section';
  /** Blueprint key of the planned entity; the section name for sections. */
  key: string;
  state: PlanNodeState | null;
}

export interface PlanTree {
  /** The planned nodes and the branches that lead to them; the rest of the space is left out. */
  nodes: NavTreeNode[];
  meta: Map<string, PlanNodeMeta>;
  /** Branches that lead to a planned node: open by default. */
  open: Set<string>;
}

export interface PlanSectionLabels {
  dashboards: string;
  menu: string;
  agents: string;
  automations: string;
  services: string;
}

const collectIds = (nodes: NavTreeNode[], ids = new Set<string>()): Set<string> => {
  for (const node of nodes) {
    ids.add(node.id);
    collectIds(node.children, ids);
  }
  return ids;
};

export function buildPlanTree(
  tree: NavTreeNode[],
  plan: InstallPlan,
  blueprint: ModuleBlueprint,
  labels: PlanSectionLabels,
): PlanTree {
  const existing = collectIds(tree);
  const meta = new Map<string, PlanNodeMeta>();
  const added = new Map<string | null, NavTreeNode[]>();
  const add = (parentId: string | null, node: Omit<NavTreeNode, 'children' | 'parentId' | 'numericId'>) => {
    added.set(parentId, [...(added.get(parentId) ?? []), { ...node, numericId: 0, children: [], parentId }]);
  };

  const projectIds = new Map<string, string>();
  for (const project of plan.projects ?? []) {
    const id = `project:${project.project_id}`;
    if (project.action === 'use' && existing.has(id)) {
      projectIds.set(project.key, id);
      meta.set(id, { kind: 'project', key: project.key, state: 'change' });
      continue;
    }
    const planned = `project:plan:${project.key}`;
    projectIds.set(project.key, planned);
    meta.set(planned, { kind: 'project', key: project.key, state: project.action === 'create' ? 'create' : 'change' });
    add(null, { id: planned, type: 'project', name: project.key, displayName: project.title || project.key, icon: project.icon || '📁' });
  }
  const projectOf = (key: string | undefined) => projectIds.get(key ?? 'main') ?? null;

  const declared = new Map([...(blueprint.tables ?? []), ...(blueprint.requires?.tables ?? [])].map((table) => [table.key, table]));
  const tableIds = new Map<string, string>();
  for (const table of plan.tables) {
    const id = `table:${table.table_id}`;
    if (table.table_id != null && existing.has(id)) {
      tableIds.set(table.key, id);
      meta.set(id, { kind: 'table', key: table.key, state: table.action === 'existing' ? 'existing' : 'change' });
      continue;
    }
    const planned = `table:plan:${table.key}`;
    tableIds.set(table.key, planned);
    const state = table.action === 'create' || table.action === 'skip' || table.action === 'requires' ? table.action : 'change';
    meta.set(planned, { kind: 'table', key: table.key, state });
    add(projectOf(table.project), {
      id: planned, type: 'table', name: table.name ?? table.key, icon: '📋',
      displayName: declared.get(table.key)?.display_name || table.name || table.key,
    });
  }

  for (const app of plan.apps ?? []) {
    const id = `widget:${app.widget_id}`;
    if (app.widget_id != null && existing.has(id)) {
      meta.set(id, { kind: 'app', key: app.key, state: app.action === 'existing' ? 'existing' : 'change' });
      continue;
    }
    const planned = `widget:plan:app:${app.key}`;
    meta.set(planned, { kind: 'app', key: app.key, state: app.action === 'create' ? 'create' : 'change' });
    // The app follows its table; an app with no table of its own goes to the module project.
    add(tableIds.get(app.binds[0]?.table) ?? projectOf('main'), {
      id: planned, type: 'widget', name: app.key, displayName: app.title, icon: '🧩', presetName: app.preset_name,
    });
  }

  const section = (key: keyof PlanSectionLabels, show: boolean) => {
    if (!show) return null;
    const id = `folder:plan:${key}`;
    meta.set(id, { kind: 'section', key, state: null });
    add(null, { id, type: 'folder', name: labels[key], displayName: labels[key], icon: '' });
    return id;
  };

  const tiles = plan.tiles ?? [];
  const boards = section('dashboards', tiles.length > 0 || (plan.dashboards ?? []).length > 0);
  const boardIds = new Map<string, string>();
  for (const board of plan.dashboards ?? []) {
    const id = `folder:plan:dashboard:${board.key}`;
    boardIds.set(board.key, id);
    if (board.action === 'create') meta.set(id, { kind: 'section', key: `dashboard:${board.key}`, state: 'create' });
    add(boards, { id, type: 'folder', name: board.key, displayName: board.title, icon: '' });
  }
  for (const tile of tiles) {
    const id = `widget:plan:tile:${tile.key}`;
    meta.set(id, { kind: 'tile', key: tile.key, state: tile.action === 'adopt' ? 'change' : tile.action });
    add(boardIds.get(tile.dashboard_key ?? '') ?? boards, {
      id, type: 'widget', name: tile.key, displayName: tile.title, icon: '🧩', presetName: tile.preset_name,
    });
  }

  section('menu', plan.sidebar.length > 0);
  section('agents', (plan.agents ?? []).length > 0);
  section('automations', (plan.automations ?? []).length > 0);
  section('services', (plan.services ?? []).length > 0);

  const open = new Set<string>();
  const attach = (node: NavTreeNode): NavTreeNode => {
    const children = [...node.children, ...(added.get(node.id) ?? [])].map(attach);
    if (children.some((child) => meta.has(child.id) || open.has(child.id))) open.add(node.id);
    return { ...node, children };
  };
  const roots = added.get(null) ?? [];
  const whole = [
    ...roots.filter((node) => node.type === 'project'),
    ...tree,
    ...roots.filter((node) => node.type !== 'project'),
  ].map(attach);
  // A planned node is open itself, so its controls are on screen.
  for (const id of meta.keys()) open.add(id);

  const touched = (nodes: NavTreeNode[]): NavTreeNode[] =>
    nodes.filter((node) => meta.has(node.id) || open.has(node.id)).map((node) => ({ ...node, children: touched(node.children) }));

  return { nodes: touched(whole), meta, open };
}
