// ADR-207 §2.5 — every user action on the install plan becomes one edit of `bindings`.
// Only the user's own choices are stored: the server auto-matches the rest on each dry-run,
// so a new plan never overwrites a reassignment.
import type { BindingColumnTarget, InstallBindings, InstallPlan, ModuleBlueprint, PlanTable, TableBinding } from './types';

/**
 * Bindings a plan starts from when a link brought a table along: the table goes to the module table
 * that needs an existing one, else to the module's first table. A starting choice only — the dry-run
 * says whether it fits, and the user can give the module table another one.
 */
export function connectCandidate(blueprint: ModuleBlueprint, tableId: number | undefined): InstallBindings {
  const key = (blueprint.requires?.tables?.[0] ?? blueprint.tables?.[0])?.key;
  return key && tableId != null ? { tables: { [key]: { action: 'connect', table_id: tableId } } } : {};
}

/** Value of the table select: `create`, `skip`, `connect:<table_id>`, or '' while a required table is unbound. */
export function tableChoice(table: PlanTable): string {
  if (table.action === 'create' || table.action === 'skip') return table.action;
  return table.table_id != null ? `connect:${table.table_id}` : '';
}

const withTable = (bindings: InstallBindings, key: string, binding: TableBinding): InstallBindings =>
  ({ ...bindings, tables: { ...bindings.tables, [key]: binding } });

/** The binding the plan already implies for a table the user has not touched yet. */
function tableBinding(bindings: InstallBindings, table: PlanTable): TableBinding | null {
  const bound = bindings.tables?.[table.key];
  if (bound) return bound;
  if (table.action === 'create' || table.action === 'skip') return { action: table.action };
  return table.table_id != null ? { action: 'connect', table_id: table.table_id } : null;
}

export function setTableChoice(bindings: InstallBindings, key: string, choice: string): InstallBindings {
  const seed = bindings.tables?.[key]?.seed;
  const kept = seed === undefined ? {} : { seed };
  if (choice === 'create' || choice === 'skip') return withTable(bindings, key, { action: choice, ...kept });
  // Column overrides belong to the table they were made for, so a new target starts from auto-match.
  return withTable(bindings, key, { action: 'connect', table_id: Number(choice.slice('connect:'.length)), ...kept });
}

export function setColumnTarget(
  bindings: InstallBindings,
  table: PlanTable,
  moduleColumn: string,
  target: BindingColumnTarget,
): InstallBindings {
  const binding = tableBinding(bindings, table);
  if (binding?.action !== 'connect') return bindings;
  const columns = (binding.columns ?? []).filter((column) => column.module_column !== moduleColumn);
  return withTable(bindings, table.key, { ...binding, columns: [...columns, { module_column: moduleColumn, target }] });
}

export function setSeed(bindings: InstallBindings, table: PlanTable, seed: boolean): InstallBindings {
  const binding = tableBinding(bindings, table);
  return binding ? withTable(bindings, table.key, { ...binding, seed }) : bindings;
}

/** Tables whose seed rows are examples (`seed[].example`): sample content, off until asked for. */
export const exampleTables = (blueprint: ModuleBlueprint): string[] =>
  [...new Set((blueprint.seed ?? []).filter((group) => group.example).map((group) => group.table))];

/** Example tables the user has not decided on yet get an explicit "no"; the rest of the bindings stay as they are. */
export function examplesOffByDefault(bindings: InstallBindings, blueprint: ModuleBlueprint, plan: InstallPlan): InstallBindings {
  return exampleTables(blueprint).reduce((current, key) => {
    if (current.tables?.[key]?.seed !== undefined) return current;
    const table = plan.tables.find((entry) => entry.key === key);
    return table ? setSeed(current, table, false) : current;
  }, bindings);
}

/** Turns the example rows of every example table on or off at once. */
export function setExamples(bindings: InstallBindings, blueprint: ModuleBlueprint, plan: InstallPlan, on: boolean): InstallBindings {
  return exampleTables(blueprint).reduce((current, key) => {
    const table = plan.tables.find((entry) => entry.key === key);
    return table ? setSeed(current, table, on) : current;
  }, bindings);
}

/** `projectId === null` creates the module project. */
export function setProject(bindings: InstallBindings, key: string, projectId: number | null): InstallBindings {
  const binding = projectId === null ? { action: 'create' as const } : { action: 'use' as const, project_id: projectId };
  return { ...bindings, projects: { ...bindings.projects, [key]: binding } };
}

/** `widgetId === null` creates the app instead of adopting an existing one. */
export function setApp(bindings: InstallBindings, key: string, widgetId: number | null): InstallBindings {
  const binding = widgetId === null ? { action: 'create' as const } : { action: 'adopt' as const, widget_id: widgetId };
  return { ...bindings, apps: { ...bindings.apps, [key]: binding } };
}

/** A dashboard id, `skip` for no tile, or null to return the tile to the module's own dashboard. */
export function setTile(bindings: InstallBindings, key: string, choice: number | 'skip' | null): InstallBindings {
  const { [key]: _removed, ...rest } = bindings.tiles ?? {};
  if (choice === null) return { ...bindings, tiles: rest };
  return { ...bindings, tiles: { ...rest, [key]: choice === 'skip' ? { action: 'skip' } : { dashboard_id: choice } } };
}

export function setSidebar(bindings: InstallBindings, widget: string, pinned: boolean): InstallBindings {
  return { ...bindings, sidebar: { ...bindings.sidebar, [widget]: pinned } };
}
