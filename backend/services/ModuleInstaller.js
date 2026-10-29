/**
 * ModuleInstaller — ADR-200 W2: install / reconcile / uninstall a declarative module.
 *
 * A module v1 is DATA, not code: a blueprint the core interprets. This service is the
 * missing caller of `provisionModuleTables` (ADR-200 §"written and not wired": the
 * provisioner had no HTTP caller at all) plus the three things it lacked to be an
 * installer — identity (`module_installations`), a diff you can look at before writing
 * (`dry_run`), and add-only reconciliation for a blueprint that grew a column.
 *
 * Three invariants hold everywhere in this file:
 *
 *   1. The blueprint is INTERPRETED, never executed. No value from it reaches `eval`,
 *      `new Function`, or a concatenated SQL string — every write goes through the same
 *      parameterized statements the public REST API uses.
 *   2. Reconciliation is ADD-ONLY. Columns are appended; nothing is dropped or retyped.
 *      Any other rule turns "upgrade the module" into "silently lose user data".
 *   3. `dry_run` writes NOTHING. The planner uses read handles only, and the caller gets
 *      the same diff the apply path would produce.
 *
 * W3 adds the `widgets` and `sidebar` sections on the same three invariants. Two more rules
 * are specific to the surface a module puts in front of the user:
 *
 *   4. A module may only use a preset that ALREADY EXISTS in this installation. A new renderer
 *      is a React component, and a component is a deploy — that is the exact border of ADR-200
 *      variant 1, and an unknown `preset_name` is refused at dry-run rather than installed as
 *      an empty square.
 *   5. New widgets go on the space's DEFAULT dashboard, never a new one. `/spaces/:id/dashboard`
 *      renders only the default board and has no switcher, so a widget anywhere else is
 *      installed-and-invisible. Explicit existingWidgets adoption keeps the original dashboard/URL.
 *
 * Still not here: the `tools` section (W4), rejected with an explicit message rather than
 * silently ignored — a blueprint that declares a tool and installs without one is worse than
 * a refusal.
 */

import { createHash } from 'crypto';
import { z } from 'zod';
import { dbGet, dbAll, safeJsonParse, withTransactionAsync } from '../database/connection.js';
import {
  provisionModuleTables,
  seedModuleRows,
  parseData,
  keySignature,
} from './ModuleTableProvisioner.js';
import { VALID_COLUMN_TYPES } from './ColumnService.js';
import { createWidget, deleteWidgetInTrx } from './WidgetService.js';
import { createModule, VALID_ACCESS_LEVELS } from './ModuleService.js';
import { getSpaceDashboard } from './DashboardService.js';
import { registerWidgetSafe } from './WidgetLibraryService.js';
import { isValidPreset } from '../widgets/presets.js';
import { collectTableRefs, isTableRef, remapConfigTableRefs } from './module-blueprint/configRefs.js';
import { apiLogger } from '../utils/logger.js';

// ADR-200 §Security: without ceilings, `install` is a schema-shaped DoS — one request that
// asks for ten thousand tables. Generous enough that no honest module notices.
export const BLUEPRINT_LIMITS = Object.freeze({
  tables: 25,
  columnsPerTable: 60,
  seedGroups: 25,
  seedRows: 500,
  widgets: 25,
  sidebar: 25,
});

// Sections the blueprint format reserves but this work package does not implement.
const DEFERRED_SECTIONS = Object.freeze({
  tools: 'W4 (declarative agent tools)',
});

const TOP_LEVEL_KEYS = new Set([
  'key', 'version', 'title', 'icon', 'description', 'tables', 'seed', 'widgets', 'sidebar',
]);

/**
 * The ownership stamp written into `widgets.config`. Widgets are unique by neither `title` nor
 * `preset_name`, so without it `uninstall` would have to GUESS which widget it put there —
 * the (dashboard_id, preset_name, table_id) heuristic used by StarterPackService, which will
 * eventually take a USER's widget down with it. The stamp costs no migration (`config` is
 * already a free-form blob) and it makes the widget self-describing even if the installation
 * record is lost: a stamped widget with no record is reported as an orphan, not guessed at.
 */
export const WIDGET_TAG_KEY = '__module';

/**
 * A blueprint/plan-level refusal — a client error, never a 500. `code` is what the route
 * maps onto an HTTP status; the message is meant to be shown to whoever wrote the blueprint.
 */
export class BlueprintError extends Error {
  constructor(message, code = 'BLUEPRINT_INVALID', details = null) {
    super(message);
    this.name = 'BlueprintError';
    this.code = code;
    this.details = details;
  }
}

// ============================================================
// Blueprint contract
// ============================================================

// Module keys may carry a dash (`sc-sim`); TABLE and COLUMN keys may not — those stay on
// the provisioner's ASCII snake_case rail, which is what keeps a module from re-creating
// the SC-SIM Cyrillic-key bug class.
const moduleKey = z.string().regex(/^[a-z][a-z0-9_-]*$/, 'module key must be ascii kebab/snake_case');
const machineKey = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be ASCII snake_case (a-z, 0-9, _)');

const columnSchema = z.object({
  column_name: machineKey,
  display_name: z.string().max(255).optional(),
  // The blueprint may not invent a column type the public API would reject (ADR-0041R owns
  // this enum) — "a blueprint can do nothing the REST API cannot do" is the whole boundary.
  type: z.enum(VALID_COLUMN_TYPES).optional(),
  config: z.record(z.any()).nullable().optional(),
  order_index: z.number().int().min(0).optional(),
});

const tableSchema = z.object({
  key: machineKey,
  name: machineKey,
  display_name: z.string().max(255).optional(),
  icon: z.string().max(64).nullable().optional(),
  table_type: z.string().max(64).nullable().optional(),
  columns: z.array(columnSchema).max(BLUEPRINT_LIMITS.columnsPerTable).optional(),
});

const seedGroupSchema = z.object({
  table: machineKey,
  key: z.array(machineKey).min(1),
  rows: z.array(z.record(z.any())).optional(),
});

// A widget carries its own `key`: the sidebar refers to it, and the ownership stamp records it.
// (The ADR sketch used a positional index — `sidebar: [{ widget: 0 }]` — which no diff, log
// line or error message can name usefully once the list is edited.)
const widgetSchema = z.object({
  key: machineKey,
  preset_name: z.string().min(1).max(64),
  title: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  icon: z.string().max(64).optional(),
  // The only accepted target. Spelled out rather than implied so a blueprint asking for its
  // own board gets a contract error, not a silently different placement.
  dashboard: z.literal('main').optional(),
  config: z.record(z.any()).optional(),
  position: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
  }).optional(),
  order_index: z.number().int().min(0).optional(),
});

const sidebarSchema = z.object({
  widget: machineKey, // a widget key declared above
  icon: z.string().max(64).optional(),
  order: z.number().int().min(0).optional(),
  access_level: z.enum(VALID_ACCESS_LEVELS).optional(),
  is_pinned: z.boolean().optional(),
});

const blueprintSchema = z.object({
  key: moduleKey,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver MAJOR.MINOR.PATCH'),
  title: z.string().max(255).optional(),
  icon: z.string().max(64).optional(),
  description: z.string().max(2000).optional(),
  tables: z.array(tableSchema).min(1).max(BLUEPRINT_LIMITS.tables),
  seed: z.array(seedGroupSchema).max(BLUEPRINT_LIMITS.seedGroups).optional(),
  widgets: z.array(widgetSchema).max(BLUEPRINT_LIMITS.widgets).optional(),
  sidebar: z.array(sidebarSchema).max(BLUEPRINT_LIMITS.sidebar).optional(),
});

/**
 * Validate a blueprint and return the parsed copy. Everything this throws is a
 * BlueprintError, so no malformed input can reach the installer as a 500.
 */
export function validateBlueprint(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BlueprintError('blueprint must be an object', 'BLUEPRINT_INVALID');
  }

  // Named-but-unimplemented sections get their own message: the author asked for something
  // real that this version cannot deliver, and must not be told "unknown key".
  for (const [section, owner] of Object.entries(DEFERRED_SECTIONS)) {
    if (section in raw) {
      throw new BlueprintError(
        `blueprint section "${section}" is not supported yet — it belongs to ADR-200 ${owner}. ` +
        `Remove it and install the tables/seed now, or wait for that work package.`,
        'BLUEPRINT_SECTION_UNSUPPORTED'
      );
    }
  }

  const unknown = Object.keys(raw).filter((k) => !TOP_LEVEL_KEYS.has(k));
  if (unknown.length > 0) {
    throw new BlueprintError(
      `unknown blueprint key(s): ${unknown.join(', ')}. Allowed: ${[...TOP_LEVEL_KEYS].join(', ')}`,
      'BLUEPRINT_INVALID'
    );
  }

  const parsed = blueprintSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new BlueprintError(`blueprint is invalid: ${issues[0]}`, 'BLUEPRINT_INVALID', issues);
  }
  const blueprint = parsed.data;

  const tableKeys = new Set();
  const tableNames = new Set();
  for (const t of blueprint.tables) {
    if (tableKeys.has(t.key)) {
      throw new BlueprintError(`duplicate table key "${t.key}"`, 'BLUEPRINT_INVALID');
    }
    if (tableNames.has(t.name)) {
      throw new BlueprintError(`duplicate table name "${t.name}"`, 'BLUEPRINT_INVALID');
    }
    tableKeys.add(t.key);
    tableNames.add(t.name);

    const colNames = new Set();
    for (const c of (t.columns || [])) {
      if (colNames.has(c.column_name)) {
        throw new BlueprintError(
          `duplicate column "${c.column_name}" in table "${t.key}"`, 'BLUEPRINT_INVALID'
        );
      }
      colNames.add(c.column_name);
    }
  }

  // A seed group pointing at a table the blueprint does not declare would only blow up deep
  // inside seedModuleRows, mid-install. Catch it here, before anything is planned.
  let seedRows = 0;
  for (const g of (blueprint.seed || [])) {
    if (!tableKeys.has(g.table)) {
      throw new BlueprintError(
        `seed group targets table "${g.table}", which the blueprint does not declare`,
        'BLUEPRINT_INVALID'
      );
    }
    for (const row of (g.rows || [])) {
      for (const k of g.key) {
        if (!(k in row)) {
          throw new BlueprintError(
            `a seed row for "${g.table}" is missing natural-key column "${k}"`,
            'BLUEPRINT_INVALID'
          );
        }
      }
    }
    seedRows += (g.rows || []).length;
  }
  if (seedRows > BLUEPRINT_LIMITS.seedRows) {
    throw new BlueprintError(
      `blueprint seeds ${seedRows} rows, over the limit of ${BLUEPRINT_LIMITS.seedRows}`,
      'BLUEPRINT_TOO_LARGE'
    );
  }

  validateSurface(blueprint, tableKeys);

  return blueprint;
}

/**
 * ADR-200 W3 — everything about the widget/sidebar sections that can be decided WITHOUT the
 * database. All of it lives here rather than in the planner, because validateBlueprint runs
 * first on every path (dry-run, install, upgrade): a refusal here cannot be preceded by a
 * partial install, which is exactly what AC#5 asks for.
 */
function validateSurface(blueprint, tableKeys) {
  const widgetKeys = new Set();

  for (const widget of (blueprint.widgets || [])) {
    if (widgetKeys.has(widget.key)) {
      throw new BlueprintError(`duplicate widget key "${widget.key}"`, 'BLUEPRINT_INVALID');
    }
    widgetKeys.add(widget.key);

    // The border of variant 1, enforced. `createWidget` only checks that `preset_name` is
    // PRESENT (WidgetService:88) — a made-up preset is accepted today and renders as nothing.
    if (!isValidPreset(widget.preset_name)) {
      throw new BlueprintError(
        `widget "${widget.key}" uses preset "${widget.preset_name}", which does not exist in ` +
        `this installation. A module may only use presets that already ship with the platform — ` +
        `a new renderer is code, and code is a deploy (ADR-200 §Decision).`,
        'PRESET_NOT_FOUND'
      );
    }

    if (widget.config && WIDGET_TAG_KEY in widget.config) {
      throw new BlueprintError(
        `widget "${widget.key}" sets the reserved config key "${WIDGET_TAG_KEY}" — the installer ` +
        `owns it (it is how uninstall recognises its own widgets)`,
        'BLUEPRINT_RESERVED_KEY'
      );
    }

    for (const ref of collectTableRefs(widget.config || {})) {
      if (!tableKeys.has(ref)) {
        throw new BlueprintError(
          `widget "${widget.key}" references table "${ref}", which the blueprint does not declare`,
          'BLUEPRINT_UNKNOWN_TABLE_REF'
        );
      }
    }

    assertNoRawTableBinding(widget, tableKeys);
  }

  const pinned = new Set();
  for (const entry of (blueprint.sidebar || [])) {
    if (!widgetKeys.has(entry.widget)) {
      throw new BlueprintError(
        `sidebar entry points at widget "${entry.widget}", which the blueprint does not declare`,
        'BLUEPRINT_INVALID'
      );
    }
    // `modules.widget_id` is UNIQUE — two entries for one widget is a constraint violation
    // mid-install, i.e. a 500 for what is plainly a blueprint mistake.
    if (pinned.has(entry.widget)) {
      throw new BlueprintError(
        `widget "${entry.widget}" is pinned to the sidebar twice`,
        'BLUEPRINT_INVALID'
      );
    }
    pinned.add(entry.widget);
  }
}

/**
 * Refuse the two ways a widget can end up bound to NOTHING while looking bound.
 *
 * `{ $table: "<key>" }` is the only substitution the installer performs, so anything else that
 * looks like a table binding passes through untouched and the widget renders empty — with no
 * error anywhere. Two shapes hit this:
 *
 *   config: { table: "schemes" }   — the shorthand the ADR's own blueprint EXAMPLE shows
 *                                    (§"The blueprint (contract)"); the sentinel was chosen
 *                                    later, and a blueprint copied from that example must not
 *                                    install silently wrong.
 *   config: { table_id: 103027 }   — a literal id, which is precisely what a blueprint may not
 *                                    carry: the same blueprint has to install into any space.
 *
 * Both are refused at dry-run, naming the sentinel — a refusal an author can act on beats an
 * empty widget they have to debug.
 */
function assertNoRawTableBinding(widget, tableKeys) {
  const config = widget.config;
  if (!config || typeof config !== 'object') return;

  if (typeof config.table === 'string' && tableKeys.has(config.table)) {
    throw new BlueprintError(
      `widget "${widget.key}" binds a table with the shorthand \`table: "${config.table}"\`, which ` +
      `the installer does not substitute. Write \`table_id: { $table: "${config.table}" }\`.`,
      'BLUEPRINT_RAW_TABLE_BINDING'
    );
  }

  if (config.table_id != null && !isTableRef(config.table_id)) {
    throw new BlueprintError(
      `widget "${widget.key}" hard-codes \`table_id: ${JSON.stringify(config.table_id)}\`. A blueprint ` +
      `must not carry ids — they differ per installation. Write \`table_id: { $table: "<table key>" }\`.`,
      'BLUEPRINT_RAW_TABLE_BINDING'
    );
  }
}

/**
 * Content pin for an installation. Keys are sorted recursively so that two blueprints that
 * differ only in property order hash the same — otherwise "reinstall the same module" would
 * look like a change every time the YAML was re-serialized. Same role as ADR-192's
 * `bundle_sha256`.
 */
export function blueprintSha256(blueprint) {
  return createHash('sha256').update(canonicalJson(blueprint)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

// ============================================================
// Plan (read-only — this is what `dry_run` returns)
// ============================================================

/**
 * Compute what an install/upgrade WOULD do, touching nothing. Read handles only: the
 * guarantee behind AC#4 is that this path physically cannot write.
 *
 * @param {number} projectId
 * @param {object} blueprint - already validated
 * @param {object} [opts]
 * @param {number} [opts.spaceId] - required only when the blueprint declares widgets: they are
 *   placed on the SPACE's default dashboard, so without it there is nothing to plan against.
 * @returns {Promise<object>} { module_key, version, tables, seed, widgets, sidebar, dashboard,
 *   tools, conflicts, changes }
 */
export async function planModuleInstall(projectId, blueprint, { spaceId = null, existingWidgets = {} } = {}) {
  const tables = [];
  const conflicts = [];
  const tableIds = {}; // blueprint table key -> existing table id (null when it must be created)

  for (const table of blueprint.tables) {
    const existing = await dbGet(
      `SELECT id FROM universal_tables WHERE project_id = ? AND name = ?`,
      [projectId, table.name]
    );
    const declared = table.columns || [];

    if (!existing) {
      tableIds[table.key] = null;
      tables.push({
        key: table.key,
        name: table.name,
        table_id: null,
        action: 'create',
        columns_added: declared.map((c) => c.column_name),
      });
      continue;
    }

    tableIds[table.key] = existing.id;
    const current = await dbAll(
      `SELECT column_name, type FROM table_columns WHERE table_id = ?`,
      [existing.id]
    );
    const byName = new Map(current.map((c) => [c.column_name, c]));
    const missing = declared.filter((c) => !byName.has(c.column_name));

    // Add-only means a type disagreement is REPORTED, not resolved. The operator sees it
    // in the diff and decides; the installer never rewrites a column that holds data.
    for (const col of declared) {
      const live = byName.get(col.column_name);
      if (live && col.type && live.type && live.type !== col.type) {
        conflicts.push({
          kind: 'column_type_mismatch',
          table: table.key,
          column: col.column_name,
          existing_type: live.type,
          declared_type: col.type,
          resolution: 'left as-is (reconciliation is add-only)',
        });
      }
    }

    tables.push({
      key: table.key,
      name: table.name,
      table_id: existing.id,
      action: missing.length > 0 ? 'columns_added' : 'existing',
      columns_added: missing.map((c) => c.column_name),
    });
  }

  const seed = [];
  for (const group of (blueprint.seed || [])) {
    const rows = group.rows || [];
    const tableId = tableIds[group.table];

    // No table yet → nothing exists to collide with, so every declared row would insert.
    const existingRows = tableId
      ? await dbAll(`SELECT data FROM table_rows WHERE table_id = ?`, [tableId])
      : [];
    const seen = new Set(existingRows.map((r) => keySignature(parseData(r.data), group.key)));

    let insert = 0;
    for (const row of rows) {
      const sig = keySignature(row, group.key);
      if (seen.has(sig)) continue;
      seen.add(sig); // duplicates inside one batch collapse, exactly as seedModuleRows does
      insert += 1;
    }
    seed.push({ table: group.table, insert, existing: rows.length - insert });
  }

  const surface = await planSurface(blueprint, spaceId, tableIds, existingWidgets);

  const changes =
    tables.filter((t) => t.action === 'create').length +
    tables.reduce((n, t) => n + t.columns_added.length, 0) +
    seed.reduce((n, s) => n + s.insert, 0) +
    surface.widgets.filter((w) => w.action === 'create' || w.action === 'adopt').length +
    surface.sidebar.filter((s) => s.action === 'create').length;

  return {
    module_key: blueprint.key,
    version: blueprint.version,
    tables,
    seed,
    ...surface,
    tools: [], // ADR-200 W4
    conflicts,
    changes,
  };
}

/**
 * Read-only half of W3: what the widgets/sidebar sections WOULD do.
 *
 * Add-only here too, and for the same reason as columns: a widget that already carries this
 * module's stamp is reported as `existing` and left completely alone. Re-applying a newer
 * blueprint's title, position or config would silently undo whatever the user has since
 * changed on their own dashboard.
 */
async function planSurface(blueprint, spaceId, tableIds, existingWidgets) {
  const specs = blueprint.widgets || [];
  const pins = blueprint.sidebar || [];
  if (specs.length === 0 && pins.length === 0) {
    return { widgets: [], sidebar: [], dashboard: null };
  }
  if (!spaceId) {
    throw new BlueprintError(
      'this blueprint declares widgets, so the installation must name a space',
      'BLUEPRINT_INVALID'
    );
  }

  const board = await dbGet(
    `SELECT id FROM dashboards WHERE space_id = ? AND is_default = 1 ORDER BY id ASC`,
    [spaceId]
  );
  const dashboard = { dashboard_id: board?.id ?? null, action: board ? 'existing' : 'create' };

  const installed = await loadModuleWidgets(dbAll, spaceId, blueprint.key);

  const adopted = await loadWidgetAdoptions(dbGet, blueprint, spaceId, existingWidgets, installed);
  const widgets = [];
  for (const spec of specs) {
    const found = installed.get(spec.key) || adopted.get(spec.key);
    widgets.push({
      key: spec.key,
      preset_name: spec.preset_name,
      title: spec.title || spec.key,
      dashboard_id: found ? found.dashboard_id : dashboard.dashboard_id,
      widget_id: found ? found.id : null,
      action: adopted.has(spec.key) ? 'adopt' : found ? 'existing' : 'create',
      binds: [...collectTableRefs(spec.config || {})].map((ref) => ({
        table: ref,
        table_id: tableIds[ref] ?? null, // null = the table itself is still to be created
      })),
    });
  }

  const sidebar = [];
  for (const pin of pins) {
    const widget = installed.get(pin.widget) || adopted.get(pin.widget);
    const pinned = widget
      ? await dbGet('SELECT id FROM modules WHERE widget_id = ?', [widget.id])
      : null;
    sidebar.push({
      widget: pin.widget,
      module_id: pinned?.id ?? null,
      action: pinned ? 'existing' : 'create',
    });
  }

  return { widgets, sidebar, dashboard: widgets.some((w) => w.action === 'create') ? dashboard : null };
}

/**
 * This module's widgets across the space, indexed by their blueprint widget key.
 *
 * `widgets.config` is `text`, not `jsonb` (checked on master A), so the stamp cannot be matched
 * with a jsonb operator — the honest form is "the space's widgets, parsed, filtered in JS".
 * At the scale of one space's widgets that is the right trade against an artefact column and a
 * second migration.
 *
 * @param {(sql: string, params: any[]) => Promise<any[]>} all - read handle (dbAll or trx.all)
 * @returns {Promise<Map<string, {id:number, dashboard_id:number, preset_name:string}>>}
 */
async function loadModuleWidgets(all, spaceId, moduleKey) {
  const rows = await all(
    `SELECT w.id, w.dashboard_id, w.preset_name, w.title, w.config
       FROM widgets w
       JOIN dashboards d ON d.id = w.dashboard_id
       LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.space_id = ? OR p.space_id = ?`,
    [spaceId, spaceId]
  );

  const found = new Map();
  for (const row of rows) {
    const tag = safeJsonParse(row.config, {})?.[WIDGET_TAG_KEY];
    if (!tag || tag.key !== moduleKey || !tag.widget_key) continue;
    // First one wins: a duplicate stamp would mean someone copied the widget, and adopting the
    // copy as "the" module widget is how an install starts editing rows it does not own.
    if (!found.has(tag.widget_key)) found.set(tag.widget_key, row);
  }
  return found;
}

// ============================================================
// Install / upgrade / uninstall
// ============================================================

/**
 * Install a blueprint into an existing project of an existing space.
 *
 * Everything the install writes — tables, columns, seed rows AND the installation record —
 * commits in ONE transaction (ADR-200 AC#1): a process killed mid-install leaves no
 * half-provisioned module and no installation row claiming one exists.
 *
 * @param {object} args
 * @param {object} args.blueprint - raw blueprint (validated here)
 * @param {number} args.spaceId
 * @param {number} args.projectId
 * @param {number} [args.userId]
 * @param {boolean} [args.dryRun] - compute the diff, write nothing
 * @param {Record<string, number>} [args.existingWidgets] - explicit widget key → existing ID; same space/preset only
 */
export async function installModule({ blueprint: raw, spaceId, projectId, userId = null, dryRun = false, existingWidgets = {} }) {
  const blueprint = validateBlueprint(raw);
  await assertProjectInSpace(projectId, spaceId);

  const sha = blueprintSha256(blueprint);
  const existing = await findInstallation(blueprint.key, spaceId);

  if (existing && existing.status === 'active' && existing.blueprint_sha256 !== sha) {
    throw new BlueprintError(
      `module "${blueprint.key}" is already installed in this space at version ${existing.version}. ` +
      `Use POST /api/v3/modules/${blueprint.key}/upgrade to move it to ${blueprint.version}.`,
      'ALREADY_INSTALLED'
    );
  }

  if (existing && Number(existing.project_id) !== Number(projectId)) {
    throw new BlueprintError('An installation cannot be moved to another project', 'INSTALLATION_PROJECT_MISMATCH');
  }
  const plan = await planModuleInstall(projectId, blueprint, { spaceId, existingWidgets });
  if (Object.keys(existingWidgets).length && plan.conflicts.length) {
    throw new BlueprintError('Resolve table schema conflicts before adopting a widget', 'WIDGET_ADOPTION_CONFLICT', plan.conflicts);
  }

  if (dryRun) {
    return { dry_run: true, status: existing ? 'reinstall' : 'install', plan, installation: existing || null };
  }

  // Same blueprint, already installed, nothing left to do — AC#2's no-op. The record is
  // untouched, so `updated_at` keeps meaning "last time something actually changed".
  if (existing && existing.status === 'active' && plan.changes === 0) {
    return { dry_run: false, status: 'unchanged', plan, installation: existing };
  }

  const applied = await applyPlan({ blueprint, projectId, spaceId, userId, sha, existingWidgets });
  apiLogger.info(
    { module: blueprint.key, spaceId, projectId, version: blueprint.version, changes: plan.changes },
    '[ModuleInstaller] module installed'
  );
  return { dry_run: false, status: existing ? 'reinstalled' : 'installed', plan, ...applied };
}

/**
 * Roll a newer blueprint onto an existing installation. Add-only: new tables and new
 * columns land, nothing is dropped or retyped, and rows already in the tables stay put.
 *
 * The version rules are deliberately strict — an installation record whose `version` does
 * not match what is actually deployed is worse than a refusal:
 *   - identical content (same sha)  → no-op
 *   - older version                 → refused (downgrade)
 *   - same version, different sha   → refused (bump the version)
 */
export async function upgradeModule({ moduleKey, blueprint: raw, spaceId, userId = null, dryRun = false }) {
  const blueprint = validateBlueprint(raw);
  if (blueprint.key !== moduleKey) {
    throw new BlueprintError(
      `blueprint key "${blueprint.key}" does not match the module being upgraded ("${moduleKey}")`,
      'BLUEPRINT_KEY_MISMATCH'
    );
  }

  const existing = await findInstallation(moduleKey, spaceId);
  if (!existing || existing.status === 'removed') {
    throw new BlueprintError(
      `module "${moduleKey}" is not installed in space ${spaceId}`,
      'NOT_INSTALLED'
    );
  }

  const sha = blueprintSha256(blueprint);
  const cmp = compareSemver(blueprint.version, existing.version);
  if (sha !== existing.blueprint_sha256) {
    if (cmp < 0) {
      throw new BlueprintError(
        `refusing to downgrade "${moduleKey}" from ${existing.version} to ${blueprint.version}`,
        'VERSION_DOWNGRADE'
      );
    }
    if (cmp === 0) {
      throw new BlueprintError(
        `blueprint content changed but version is still ${existing.version} — bump the version`,
        'VERSION_NOT_BUMPED'
      );
    }
  }

  const plan = await planModuleInstall(existing.project_id, blueprint, { spaceId });
  if (dryRun) {
    return { dry_run: true, status: 'upgrade', plan, installation: existing };
  }

  if (sha === existing.blueprint_sha256 && plan.changes === 0) {
    return { dry_run: false, status: 'unchanged', plan, installation: existing };
  }

  const applied = await applyPlan({
    blueprint,
    projectId: existing.project_id,
    spaceId,
    userId,
    sha,
  });
  apiLogger.info(
    { module: moduleKey, spaceId, from: existing.version, to: blueprint.version, changes: plan.changes },
    '[ModuleInstaller] module upgraded'
  );
  return { dry_run: false, status: 'upgraded', from_version: existing.version, plan, ...applied };
}

/**
 * Uninstall a module from a space.
 *
 * Default is deliberately shallow: the installation is marked `removed` and its widgets and
 * sidebar entries come off, but its TABLES AND ROWS STAY. Whatever the user typed into a
 * module's tables is the user's, not the module's (AC#6).
 *
 * `purge: true` is the explicit second decision: the module's tables, their columns and all
 * their rows are deleted, in one transaction with the record update.
 */
export async function uninstallModule({ moduleKey, spaceId, purge = false, userId = null }) {
  const existing = await findInstallation(moduleKey, spaceId);
  if (!existing || existing.status === 'removed') {
    throw new BlueprintError(
      `module "${moduleKey}" is not installed in space ${spaceId}`,
      'NOT_INSTALLED'
    );
  }

  const blueprint = typeof existing.blueprint === 'string'
    ? JSON.parse(existing.blueprint)
    : existing.blueprint;

  // Resolve the module's tables through the blueprint's own names — the record stores the
  // blueprint verbatim precisely so an uninstall knows what it put there.
  const targets = [];
  for (const table of (blueprint?.tables || [])) {
    const row = await dbGet(
      `SELECT id FROM universal_tables WHERE project_id = ? AND name = ?`,
      [existing.project_id, table.name]
    );
    if (row) targets.push({ key: table.key, name: table.name, table_id: row.id });
  }

  // The module's own widgets, found by the stamp it wrote — never by shape. Sidebar entries
  // (`modules`) and the library index come off with them via ON DELETE CASCADE.
  const installedWidgets = await loadModuleWidgets(dbAll, spaceId, moduleKey);
  const widgetTargets = [...installedWidgets.entries()].map(([key, row]) => ({
    widget_key: key, widget_id: row.id, preset_name: row.preset_name,
  }));
  const declaredWidgets = new Set((blueprint?.widgets || []).map((w) => w.key));
  const orphanWidgets = widgetTargets
    .filter((w) => !declaredWidgets.has(w.widget_key))
    .map((w) => w.widget_key);

  const purged = { tables: 0, rows: 0 };
  await withTransactionAsync(async (trx) => {
    for (const widget of widgetTargets) {
      // `orphan: true`: a document atom may embed this widget, and refusing to uninstall over
      // that would be worse than the documented broken-ref UI (T-127905/906). A bare DELETE
      // would leave the atom pointing at a dead id instead.
      await deleteWidgetInTrx(trx, widget.widget_id, { orphan: true, userId });
    }

    if (purge) {
      for (const t of targets) {
        const counted = await trx.get(
          `SELECT COUNT(*) AS n FROM table_rows WHERE table_id = ?`, [t.table_id]
        );
        purged.rows += Number(counted?.n || 0);
        await trx.run(`DELETE FROM table_rows WHERE table_id = ?`, [t.table_id]);
        await trx.run(`DELETE FROM table_columns WHERE table_id = ?`, [t.table_id]);
        await trx.run(`DELETE FROM universal_tables WHERE id = ?`, [t.table_id]);
        purged.tables += 1;
      }
    }
    await trx.run(
      `UPDATE module_installations SET status = 'removed', updated_at = NOW() WHERE id = ?`,
      [existing.id]
    );
  });

  apiLogger.info(
    { module: moduleKey, spaceId, purge, purged, widgets: widgetTargets.length },
    '[ModuleInstaller] module uninstalled'
  );
  return {
    module_key: moduleKey,
    status: 'removed',
    purged: purge,
    tables_kept: purge ? [] : targets,
    tables_purged: purge ? targets : [],
    rows_purged: purged.rows,
    widgets_removed: widgetTargets,
    // Stamped widgets the stored blueprint never declared: removed all the same (the stamp is
    // this module's), but reported rather than passed over in silence.
    widgets_orphaned: orphanWidgets,
  };
}

// ============================================================
// Internals
// ============================================================

/**
 * The one write path. provision (add-only reconcile) + seed + widgets + sidebar + the
 * installation record, all inside a single `withTransactionAsync` — the composition
 * ModuleTableProvisioner's own JSDoc prescribes, which W1 made possible and W3 completes
 * (AC#1: a process killed mid-install leaves no half-installed module and no widget on a
 * dashboard pointing at a table that was rolled back).
 */
async function applyPlan({ blueprint, projectId, spaceId, userId, sha, existingWidgets = {} }) {
  const applied = await withTransactionAsync(async (trx) => {
    // One writer per (module_key, space_id) at a time. `universal_tables` has no unique index on
    // (project_id, name) and the installation row is an upsert, so without this two concurrent
    // installs both plan "create" and each provisions its own copy of every table (Neo16 W1
    // concurrency test). Transaction-scoped: released on commit/rollback, nothing to clean up.
    await trx.run('SELECT pg_advisory_xact_lock(hashtext(?))', [`module-install:${blueprint.key}:${spaceId}`]);
    const current = await trx.get('SELECT project_id FROM module_installations WHERE module_key = ? AND space_id = ?', [blueprint.key, spaceId]);
    if (current && Number(current.project_id) !== Number(projectId)) {
      throw new BlueprintError('An installation cannot be moved to another project', 'INSTALLATION_PROJECT_MISMATCH');
    }
    const mapping = await provisionModuleTables(projectId, blueprint, { userId, trx, reconcile: true });
    const seeded = await seedModuleRows(mapping, blueprint, { userId, trx });
    const surface = await applySurface({ blueprint, spaceId, userId, mapping, trx, existingWidgets });

    await trx.run(
      `INSERT INTO module_installations
         (module_key, version, space_id, project_id, blueprint, blueprint_sha256, status, installed_by, installed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NOW(), NOW())
       ON CONFLICT (module_key, space_id) DO UPDATE SET
         version = EXCLUDED.version,
         project_id = EXCLUDED.project_id,
         blueprint = EXCLUDED.blueprint,
         blueprint_sha256 = EXCLUDED.blueprint_sha256,
         status = 'active',
         updated_at = NOW()`,
      [
        blueprint.key,
        blueprint.version,
        spaceId,
        projectId,
        JSON.stringify(blueprint),
        sha,
        userId,
      ]
    );

    const installation = await trx.get(
      `SELECT id, module_key, version, space_id, project_id, blueprint_sha256, status, installed_at, updated_at
         FROM module_installations WHERE module_key = ? AND space_id = ?`,
      [blueprint.key, spaceId]
    );

    return { installation, mapping, seeded, ...surface };
  });

  // ADR-073 widget-library indexing runs AFTER the commit, deliberately: registerWidgetSafe
  // takes its own connection and cannot see rows this transaction had not committed yet, so
  // inside it would fail into its own catch and the widget would be missing from the Widget
  // Picker. It stays non-critical — a missing library row does not undo an install.
  for (const pin of applied.sidebar) {
    if (pin.action !== 'created') continue;
    try {
      await registerWidgetSafe(pin.widget_id, spaceId, { is_public: false, tags: [] });
    } catch (err) {
      apiLogger.warn(
        { module: blueprint.key, widgetId: pin.widget_id, spaceId, err: err.message },
        '[ModuleInstaller] widget installed but not indexed in the widget library'
      );
    }
  }

  return applied;
}

/**
 * Write half of W3 — the module's widgets and its sidebar entries, inside the caller's trx.
 *
 * Add-only, matching the planner: an existing stamped widget is adopted as-is and never
 * rewritten. What IS resolved fresh every time is the table binding — `{ $table: "schemes" }`
 * becomes the id this very install just provisioned, so the same blueprint installs into any
 * space without carrying ids.
 */
async function applySurface({ blueprint, spaceId, userId, mapping, trx, existingWidgets }) {
  const specs = blueprint.widgets || [];
  const pins = blueprint.sidebar || [];
  if (specs.length === 0 && pins.length === 0) return { widgets: [], sidebar: [] };

  const installed = await loadModuleWidgets((sql, params) => trx.all(sql, params), spaceId, blueprint.key);
  const adopted = await loadWidgetAdoptions((sql, params) => trx.get(sql, params), blueprint, spaceId, existingWidgets, installed, true);
  const needsBoard = specs.some((spec) => !installed.has(spec.key) && !adopted.has(spec.key));
  const board = needsBoard ? await getSpaceDashboard(spaceId, { trx }) : null;
  if (needsBoard && !board) {
    throw new BlueprintError(`space ${spaceId} does not exist`, 'SPACE_NOT_FOUND');
  }
  const resolve = (ref) => mapping[ref]?.table_id;

  const widgets = [];
  const widgetIds = {};
  for (const spec of specs) {
    const found = installed.get(spec.key);
    if (found) {
      widgetIds[spec.key] = found.id;
      widgets.push({ key: spec.key, widget_id: found.id, action: 'existing' });
      continue;
    }

    const config = {
      ...remapConfigTableRefs(spec.config || {}, resolve),
      [WIDGET_TAG_KEY]: { key: blueprint.key, widget_key: spec.key },
    };
    const target = adopted.get(spec.key);
    if (target) {
      await trx.run('UPDATE widgets SET config = ?, updated_at = NOW() WHERE id = ?', [
        JSON.stringify({ ...safeJsonParse(target.config, {}), ...config }), target.id,
      ]);
      widgetIds[spec.key] = target.id;
      widgets.push({ key: spec.key, widget_id: target.id, action: 'adopted' });
      continue;
    }
    const widget = await createWidget({
      dashboard_id: board.id,
      widget_type: 'preset',
      preset_name: spec.preset_name,
      title: spec.title || spec.key,
      description: spec.description ?? null,
      icon: spec.icon || '🧩',
      config,
      position: spec.position || undefined, // undefined → createWidget's own default grid cell
      order_index: spec.order_index ?? 0,
      created_by: userId,
    }, { trx });

    widgetIds[spec.key] = widget.id;
    widgets.push({ key: spec.key, widget_id: widget.id, action: 'created' });
  }

  const sidebar = [];
  for (const pin of pins) {
    const widgetId = widgetIds[pin.widget];
    // `modules.widget_id` is UNIQUE and createModule throws on a second registration; on a
    // reinstall the pin is already there, and that is a no-op, not an error.
    const already = await trx.get('SELECT id FROM modules WHERE widget_id = ?', [widgetId]);
    if (already) {
      sidebar.push({ widget: pin.widget, widget_id: widgetId, module_id: already.id, action: 'existing' });
      continue;
    }
    const mod = await createModule({
      widget_id: widgetId,
      space_id: spaceId,
      sidebar_order: pin.order ?? 0,
      sidebar_icon: pin.icon ?? null,
      access_level: pin.access_level || 'member',
      is_pinned: pin.is_pinned === true,
    }, { trx });
    sidebar.push({ widget: pin.widget, widget_id: widgetId, module_id: mod.module_id, action: 'created' });
  }

  return { widgets, sidebar };
}

/** Explicit opt-in only; never guess a legacy widget by title/preset. Recheck under row lock. */
async function loadWidgetAdoptions(get, blueprint, spaceId, raw, installed, lock = false) {
  const parsed = z.record(machineKey, z.number().int().positive()).safeParse(raw);
  if (!parsed.success) throw new BlueprintError('existingWidgets must map widget keys to positive integer IDs');
  const adopted = new Map();
  const ids = new Set();
  for (const [key, id] of Object.entries(parsed.data)) {
    const spec = blueprint.widgets?.find((w) => w.key === key);
    const row = await get(
      `SELECT w.id, w.dashboard_id, w.preset_name, w.widget_type, w.config,
              COALESCE(d.space_id, p.space_id) AS space_id
         FROM widgets w JOIN dashboards d ON d.id = w.dashboard_id
         LEFT JOIN projects p ON p.id = d.project_id WHERE w.id = ?${lock ? ' FOR UPDATE OF w' : ''}`,
      [id]
    );
    const config = safeJsonParse(row?.config, null);
    const tag = config?.[WIDGET_TAG_KEY];
    if (!spec || !row || Number(row.space_id) !== Number(spaceId) || row.widget_type !== 'preset'
        || row.preset_name !== spec.preset_name || !config || typeof config !== 'object' || Array.isArray(config)
        || ids.has(id) || (tag && (tag.key !== blueprint.key || tag.widget_key !== key))
        || (installed.has(key) && installed.get(key).id !== id)) {
      throw new BlueprintError(`Cannot adopt widget ${id} as "${key}"`, 'WIDGET_ADOPTION_CONFLICT');
    }
    ids.add(id);
    if (!installed.has(key)) adopted.set(key, row);
  }
  return adopted;
}

async function findInstallation(moduleKey, spaceId) {
  return dbGet(
    `SELECT id, module_key, version, space_id, project_id, blueprint, blueprint_sha256, status, installed_at, updated_at
       FROM module_installations WHERE module_key = ? AND space_id = ?`,
    [moduleKey, spaceId]
  );
}

async function assertProjectInSpace(projectId, spaceId) {
  const project = await dbGet('SELECT id, space_id FROM projects WHERE id = ?', [projectId]);
  if (!project) {
    throw new BlueprintError(`project ${projectId} does not exist`, 'PROJECT_NOT_FOUND');
  }
  if (Number(project.space_id) !== Number(spaceId)) {
    throw new BlueprintError(
      `project ${projectId} does not belong to space ${spaceId}`,
      'PROJECT_NOT_IN_SPACE'
    );
  }
}

// Blueprint versions are validated as MAJOR.MINOR.PATCH, so a numeric compare is the whole
// of semver we need. (`semver` is not a declared dependency of this repo — adding one to
// compare three integers would not survive review.)
function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}
