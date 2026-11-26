// ADR-207 §2.5 — module install contract as the server implements it
// (backend/routes/v3/module-install.js, backend/services/ModuleInstaller.js).
// The dry-run plan is the only source of the install screen; nothing here re-derives a server verdict.

/** A column target in `bindings.tables[].columns[]`: existing `column_name`, `__new`, or null (skip). */
export type BindingColumnTarget = string | null;

export type ProjectBinding = { action: 'create' } | { action: 'use'; project_id: number };

export interface ColumnBinding {
  module_column: string;
  target: BindingColumnTarget;
}

export type TableBinding =
  | { action: 'create'; seed?: boolean }
  | { action: 'connect'; table_id: number; seed?: boolean; columns?: ColumnBinding[] }
  | { action: 'skip'; seed?: boolean };

export type AppBinding = { action: 'create' } | { action: 'adopt'; widget_id: number };

export type TileBinding = { dashboard_id: number } | { action: 'skip' };

/** `bindings` of `POST /modules/install` — the server schema is strict, no other key is accepted. */
export interface InstallBindings {
  projects?: Record<string, ProjectBinding>;
  tables?: Record<string, TableBinding>;
  apps?: Record<string, AppBinding>;
  tiles?: Record<string, TileBinding>;
  sidebar?: Record<string, boolean>;
}

export interface BlueprintColumn {
  column_name: string;
  display_name?: string;
  type?: string;
  /** Blueprint key of the table a `relation` column points to. */
  target?: string;
  required?: boolean;
}

interface BlueprintTable {
  key: string;
  name?: string;
  display_name?: string;
  columns?: BlueprintColumn[];
}

/**
 * Rows the install adds to a table. `example: true` marks sample content — filled-in tickets, demo
 * rows — that stays off until the user asks for it (owner, chat 3813, 13.11.2026); reference data
 * (dictionaries, statuses) carries no mark and is added by default.
 */
export interface BlueprintSeedGroup {
  table: string;
  key?: string[];
  rows?: unknown[];
  example?: boolean;
}

/** The slice of a blueprint the install screen reads next to the plan: names, columns, secret names. */
export interface ModuleBlueprint {
  key: string;
  version: string;
  title?: string;
  tables?: BlueprintTable[];
  requires?: { tables?: BlueprintTable[] };
  seed?: BlueprintSeedGroup[];
  agents?: { key: string; title?: string }[];
  automations?: { key: string; title?: string }[];
  services?: { key: string; url?: string; secrets?: string[] }[];
  [section: string]: unknown;
}

export interface PlanProject {
  key: string;
  action: 'create' | 'use';
  project_id: number | null;
  title?: string;
  icon?: string;
}

export interface PlanColumn {
  module_column: string;
  target: BindingColumnTarget;
  match: string;
  compat: 'ok' | 'conflict';
  reason?: string | null;
  module_type: string;
  target_type: string | null;
  options_added?: number;
}

export interface PlanTable {
  key: string;
  name: string | null;
  table_id: number | null;
  action: 'create' | 'connect' | 'skip' | 'requires' | 'existing' | 'columns_added';
  columns?: PlanColumn[];
  columns_added: string[];
  project?: string;
  project_id?: number | null;
  requires?: boolean;
}

export interface PlanSeed {
  table: string;
  insert: number;
  existing: number;
  skipped?: boolean;
  disabled_reason?: string | null;
}

export interface PlanSurface {
  key: string;
  preset_name: string;
  title: string;
  dashboard_key?: string;
  dashboard_id: number | null;
  widget_id: number | null;
  action: 'create' | 'adopt' | 'existing' | 'skip';
  binds: { table: string; table_id: number | null }[];
}

export interface PlanDashboard {
  key: string;
  title: string;
  dashboard_id: number | null;
  action: 'create' | 'existing';
}

export interface PlanSidebarEntry {
  widget: string;
  action: 'create' | 'existing' | 'skip';
}

export interface PlanDeferred {
  key: string;
  action: string;
}

/** One entry of `plan.conflicts`. `blocking` is the server's verdict on whether Install may proceed. */
export interface PlanConflict {
  kind: string;
  blocking?: boolean;
  table?: string;
  column?: string;
  target?: string;
  reason?: string;
  referenced_by?: string[];
  expected_table_id?: number | null;
  actual_table_id?: number | null;
  existing_type?: string;
  declared_type?: string;
  preset?: string;
  app?: string;
  tile?: string;
  project?: string;
  dashboard?: string;
  agent?: string;
}

export interface InstallPlan {
  module_key: string;
  version: string;
  projects?: PlanProject[];
  tables: PlanTable[];
  seed: PlanSeed[];
  apps?: PlanSurface[];
  tiles?: PlanSurface[];
  dashboards?: PlanDashboard[];
  sidebar: PlanSidebarEntry[];
  services?: PlanDeferred[];
  agents?: PlanDeferred[];
  automations?: PlanDeferred[];
  conflicts: PlanConflict[];
  changes: number;
}

export interface InstallResult {
  dry_run: boolean;
  status: string;
  plan: InstallPlan;
  /** What a real install placed: apps (`/widgets/:id`) and tiles. Absent on a dry-run. */
  widgets?: { key: string; kind: 'app' | 'tile'; widget_id: number }[];
}

/** Install role of the current user in the target space (ADR-207 §2.2 axis C). */
export type InstallRole = 'admin' | 'member' | 'viewer';
