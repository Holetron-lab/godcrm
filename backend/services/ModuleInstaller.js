/**
 * ModuleInstaller — ADR-200 + ADR-207 W1–W2.1: plan, install, reconcile and uninstall a module.
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
 *   5. Schema-1 widgets keep their legacy placement on the space's DEFAULT dashboard. Schema 2
 *      distinguishes standalone apps from dashboard tiles and may create explicit new boards.
 *      Explicit existingWidgets adoption keeps the original dashboard/URL.
 *
 * ADR-207 W1.1–W1.5 adds optional schema-1 project/table/column bindings. The unbound branch
 * below remains the legacy planner/apply path; bound plans resolve create/use, create/connect/skip
 * and column mappings with blocking conflicts. Connected seed uses the same mapped columns and
 * natural keys, relation targets resolve through the same bindings, and newly created relation
 * columns receive actual table ids without rewriting existing columns or row values. Successful
 * writes also journal the effective bindings in `module_installs`; upgrades reuse them and
 * auto-match only columns introduced by the newer blueprint.
 *
 * ADR-207 W2.1 adds schema 2 with multiple projects, required instance tables, standalone apps,
 * default/new dashboards and tiles. Their resolved bindings are journaled too, so repeat installs
 * and upgrades do not duplicate projects, boards or widgets.
 * W2.2 applies the same column dictionary to widget, agent and automation configs through
 * declarative reference paths.
 * W2.3 resolves relation seed values through target natural keys in dependency order, drops
 * unavailable relation values with plan warnings, and rejects agent tools outside the services'
 * combined allowlist. Relation columns added to required tables receive resolved table ids too.
 * W6.1 provisions stamped remote connectors, agent rows and automations in the same transaction.
 * Connector secrets remain in the space vault; journals carry only their canonical vault refs.
 *
 * Still not here: the `tools` section (W4), explicitly deferred rather than silently ignored —
 * a blueprint that declares a capability and installs without it is worse than a refusal.
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
import { getModuleInstall, upsertModuleInstall, deleteModuleInstall } from './ModuleInstallService.js';
import { getSpaceDashboard } from './DashboardService.js';
import { registerWidgetSafe } from './WidgetLibraryService.js';
import { isValidPreset } from '../widgets/presets.js';
import { collectTableRefs, isTableRef, remapBlueprintColumnRefs, remapConfigTableRefs } from './module-blueprint/configRefs.js';
import { parseBlueprintV2 } from './module-blueprint/blueprintV2.js';
import {
  mergeSelectOptions,
  planColumnBindings,
  relationTargetId,
  remapRelationConfig,
  remapSeedGroup,
} from './module-blueprint/columnMapping.js';
import {
  resolveRelationSeedGroup,
  seedGroupsHaveRelations,
  seedModuleRelationGroups,
} from './module-blueprint/relationSeed.js';
import { applyModuleComponents, planModuleComponents, uninstallModuleComponents } from './ModuleComponentService.js';
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
  media: 20,
});

// Sections the blueprint format reserves but this work package does not implement.
const DEFERRED_SECTIONS = Object.freeze({
  tools: 'W4 (declarative agent tools)',
});

const TOP_LEVEL_KEYS = new Set([
  'key', 'version', 'schema', 'title', 'icon', 'description', 'readme', 'media', 'tables', 'seed', 'widgets', 'sidebar',
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
  target: machineKey.optional(),
  config: z.record(z.any()).nullable().optional(),
  order_index: z.number().int().min(0).optional(),
  required: z.boolean().optional(),
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

const mediaItemSchema = z.object({
  type: z.enum(['image', 'video']),
  url: z.string().min(1).max(2000),
  title: z.string().max(255).optional(),
  thumbnail_url: z.string().min(1).max(2000).optional(),
  captions_url: z.string().min(1).max(2000).optional(),
}).strict();

const blueprintSchema = z.object({
  key: moduleKey,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver MAJOR.MINOR.PATCH'),
  schema: z.literal(1).optional(),
  title: z.string().max(255).optional(),
  icon: z.string().max(64).optional(),
  description: z.string().max(2000).optional(),
  readme: z.string().max(100000).optional(),
  media: z.array(mediaItemSchema).max(BLUEPRINT_LIMITS.media).optional(),
  tables: z.array(tableSchema).min(1).max(BLUEPRINT_LIMITS.tables),
  seed: z.array(seedGroupSchema).max(BLUEPRINT_LIMITS.seedGroups).optional(),
  widgets: z.array(widgetSchema).max(BLUEPRINT_LIMITS.widgets).optional(),
  sidebar: z.array(sidebarSchema).max(BLUEPRINT_LIMITS.sidebar).optional(),
});

const projectBindingSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create') }).strict(),
  z.object({ action: z.literal('use'), project_id: z.number().int().positive() }).strict(),
]);
const columnBindingSchema = z.object({
  module_column: machineKey,
  target: z.union([machineKey, z.literal('__new'), z.null()]),
}).strict();
const tableBindingSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), seed: z.boolean().optional() }).strict(),
  z.object({
    action: z.literal('connect'),
    table_id: z.number().int().positive(),
    seed: z.boolean().optional(),
    columns: z.array(columnBindingSchema).max(BLUEPRINT_LIMITS.columnsPerTable).optional(),
  }).strict(),
  z.object({ action: z.literal('skip'), seed: z.boolean().optional() }).strict(),
]);
const appBindingSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create') }).strict(),
  z.object({ action: z.literal('adopt'), widget_id: z.number().int().positive() }).strict(),
]);
const tileBindingSchema = z.union([
  z.object({ dashboard_id: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('skip') }).strict(),
]);
const bindingsSchema = z.object({
  projects: z.record(machineKey, projectBindingSchema).optional(),
  tables: z.record(machineKey, tableBindingSchema).optional(),
  apps: z.record(machineKey, appBindingSchema).optional(),
  tiles: z.record(machineKey, tileBindingSchema).optional(),
  dashboards: z.record(machineKey, z.object({ dashboard_id: z.number().int().positive() }).strict()).optional(),
  sidebar: z.record(machineKey, z.boolean()).optional(),
  secrets: z.record(
    z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    z.string().regex(/^vault:[A-Z][A-Z0-9_]*$/, 'secret binding must be a vault reference'),
  ).optional(),
}).strict().superRefine((bindings, ctx) => {
  for (const [name, ref] of Object.entries(bindings.secrets || {})) {
    if (ref !== `vault:${name}`) {
      ctx.addIssue({ code: 'custom', path: ['secrets', name], message: 'secret binding must reference the declared vault key' });
    }
  }
});

function parseBindings(raw) {
  if (raw == null) return null;
  const parsed = bindingsSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new BlueprintError(`bindings are invalid: ${issues[0]}`, 'BLUEPRINT_INVALID', issues);
  }
  return parsed.data;
}

function mergeBindings(saved, requested) {
  if (!saved) return requested;
  if (!requested) return saved;
  const merged = { ...saved, ...requested };
  for (const section of ['projects', 'tables', 'apps', 'tiles', 'dashboards', 'sidebar', 'secrets']) {
    if (saved[section] || requested[section]) {
      merged[section] = { ...(saved[section] || {}), ...(requested[section] || {}) };
    }
  }
  return merged;
}

function installTableSpecs(blueprint) {
  const owned = (blueprint.tables || []).map((table) => ({ ...table, project: table.project || 'main', requires: false }));
  if (blueprint.schema !== 2) return owned;
  return [
    ...owned,
    ...(blueprint.requires?.tables || []).map((table) => ({ ...table, requires: true })),
  ];
}

function surfaceSpecs(blueprint) {
  if (blueprint.schema !== 2) return blueprint.widgets || [];
  const withConfig = (spec, kind, extra = {}) => ({
    ...spec,
    ...extra,
    kind,
    preset_name: spec.preset,
    config: {
      ...(spec.config || {}),
      ...(spec.table && spec.config?.table_id == null ? { table_id: { $table: spec.table } } : {}),
      ...(spec.app && spec.config?.app_widget_id == null ? { app_widget_id: { $app: spec.app } } : {}),
    },
  });
  return [
    ...(blueprint.apps || []).map((app) => withConfig(app, 'app')),
    ...(blueprint.dashboards || []).flatMap((dashboard) =>
      (dashboard.tiles || []).map((tile) => withConfig(tile, 'tile', { dashboard_key: dashboard.key }))
    ),
  ];
}

function remapConfigAppRefs(value, resolve) {
  if (value && typeof value === 'object' && !Array.isArray(value)
      && typeof value.$app === 'string' && Object.keys(value).length === 1) {
    const resolved = resolve(value.$app);
    if (resolved == null) throw new Error(`unresolved app reference "${value.$app}"`);
    return resolved;
  }
  if (Array.isArray(value)) return value.map((item) => remapConfigAppRefs(item, resolve));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapConfigAppRefs(item, resolve)]));
  }
  return value;
}

/**
 * Validate a blueprint and return the parsed copy. Everything this throws is a
 * BlueprintError, so no malformed input can reach the installer as a 500.
 */
export function validateBlueprint(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BlueprintError('blueprint must be an object', 'BLUEPRINT_INVALID');
  }
  if (raw.schema === 2) {
    try {
      return parseBlueprintV2(raw);
    } catch (error) {
      throw new BlueprintError(error.message, error.code || 'BLUEPRINT_INVALID', error.details || null);
    }
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

  for (const table of blueprint.tables) {
    for (const column of (table.columns || [])) {
      if (column.target && (column.type || 'text') !== 'relation') {
        throw new BlueprintError(
          `column "${column.column_name}" in table "${table.key}" declares a target but is not a relation`,
          'BLUEPRINT_INVALID'
        );
      }
      if (column.target && !tableKeys.has(column.target)) {
        throw new BlueprintError(
          `relation column "${column.column_name}" in table "${table.key}" references table "${column.target}", which the blueprint does not declare`,
          'BLUEPRINT_UNKNOWN_TABLE_REF'
        );
      }
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
 * @param {number} [opts.spaceId] - required for widgets and explicit bindings
 * @param {Record<string, number>} [opts.existingWidgets] - widget key → existing ID
 * @param {object} [opts.bindings] - optional project/table/surface choices shared by dry-run and apply
 * @returns {Promise<object>} { module_key, version, projects (bound only), tables, seed, widgets,
 *   sidebar, dashboard(s), tools, conflicts, changes }
 */
export async function planModuleInstall(projectId, blueprint, { spaceId = null, existingWidgets = {}, bindings: rawBindings = null } = {}) {
  const bindings = parseBindings(rawBindings);
  if (blueprint.schema === 2) {
    const effective = bindings || { projects: { main: { action: 'use', project_id: projectId } } };
    const adopted = { ...existingWidgets };
    for (const [key, binding] of Object.entries(effective.apps || {})) {
      if (binding.action === 'adopt') adopted[key] = binding.widget_id;
    }
    return planBoundModuleInstallV2(projectId, blueprint, { spaceId, existingWidgets: adopted, bindings: effective });
  }
  if (bindings) {
    return planBoundModuleInstall(projectId, blueprint, { spaceId, existingWidgets, bindings });
  }

  const tables = [];
  const conflicts = [];
  const tableIds = {}; // blueprint table key -> existing table id (null when it must be created)
  const existingColumns = {};

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
      `SELECT column_name, type, config FROM table_columns WHERE table_id = ?`,
      [existing.id]
    );
    existingColumns[table.key] = current;
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

  for (const table of blueprint.tables) {
    const byName = new Map((existingColumns[table.key] || []).map((column) => [column.column_name, column]));
    for (const column of (table.columns || [])) {
      const live = byName.get(column.column_name);
      if (!column.target || column.type !== 'relation' || live?.type !== 'relation') continue;
      const expectedTableId = tableIds[column.target] ?? null;
      const actualTableId = relationTargetId(live.config);
      if (expectedTableId != null && actualTableId != null && Number(expectedTableId) === Number(actualTableId)) continue;
      conflicts.push({
        kind: 'relation_target', table: table.key, column: column.column_name, target: column.column_name,
        expected_table_id: expectedTableId, actual_table_id: actualTableId,
        reason: `relation_target: ${expectedTableId} ≠ ${actualTableId}`, blocking: true,
      });
    }
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

function agentServiceToolConflicts(blueprint) {
  const allowedTools = new Set((blueprint.services || []).flatMap((service) => service.allowed_tools || []));
  const conflicts = [];
  for (const agent of blueprint.agents || []) {
    const declared = Array.isArray(agent.tools)
      ? agent.tools
      : Array.isArray(agent.config?.tools) ? agent.config.tools : [];
    const extra = [...new Set(declared.filter((tool) => !allowedTools.has(tool)))];
    if (extra.length > 0) {
      conflicts.push({
        kind: 'AGENT_TOOLS_NOT_ALLOWED',
        agent: agent.key,
        tools: extra,
        allowed_tools: [...allowedTools].sort(),
        blocking: true,
      });
    }
  }
  return conflicts;
}

async function planBoundModuleInstallV2(projectId, blueprint, { spaceId, existingWidgets, bindings }) {
  if (!spaceId) throw new BlueprintError('bindings require an installation space', 'BLUEPRINT_INVALID');

  const tableSpecs = installTableSpecs(blueprint);
  const conflicts = [];
  const projectKeys = new Set(blueprint.projects.map((project) => project.key));
  for (const key of Object.keys(bindings.projects || {})) {
    if (!projectKeys.has(key)) conflicts.push({ kind: 'UNKNOWN_PROJECT_BINDING', project: key, blocking: true });
  }

  const projects = [];
  const projectIds = {};
  const projectUsable = {};
  for (const spec of blueprint.projects) {
    const binding = bindings.projects?.[spec.key]
      || (spec.key === 'main' ? { action: 'use', project_id: projectId } : { action: 'create' });
    const resolvedId = binding.action === 'create' ? null : binding.project_id;
    projectUsable[spec.key] = true;
    if (binding.action === 'use') {
      const project = await dbGet('SELECT id, space_id FROM projects WHERE id = ?', [resolvedId]);
      if (!project) {
        projectUsable[spec.key] = false;
        conflicts.push({ kind: 'PROJECT_NOT_FOUND', project: spec.key, project_id: resolvedId, blocking: true });
      } else if (Number(project.space_id) !== Number(spaceId)) {
        projectUsable[spec.key] = false;
        conflicts.push({ kind: 'PROJECT_NOT_IN_SPACE', project: spec.key, project_id: resolvedId, blocking: true });
      }
    }
    projectIds[spec.key] = resolvedId;
    projects.push({
      key: spec.key,
      action: binding.action,
      project_id: resolvedId,
      title: spec.title,
      description: spec.description,
      icon: spec.icon,
    });
  }

  const blueprintKeys = new Set(tableSpecs.map((table) => table.key));
  for (const key of Object.keys(bindings.tables || {})) {
    if (!blueprintKeys.has(key)) conflicts.push({ kind: 'UNKNOWN_TABLE_BINDING', table: key, blocking: true });
  }

  const tables = [];
  const tableIds = {};
  const connectedColumns = {};
  const relationTargets = {};
  for (const table of tableSpecs) {
    const binding = bindings.tables?.[table.key];
    const resolvedProjectId = projectIds[table.project];
    if (binding?.action === 'connect') {
      relationTargets[table.key] = binding.table_id;
    } else if (!table.requires && !binding && resolvedProjectId && projectUsable[table.project]) {
      const existing = await dbGet(
        'SELECT id FROM universal_tables WHERE project_id = ? AND name = ?',
        [resolvedProjectId, table.name],
      );
      relationTargets[table.key] = existing?.id ?? null;
    } else {
      relationTargets[table.key] = null;
    }
  }

  for (const table of tableSpecs) {
    const binding = bindings.tables?.[table.key];
    const declared = table.columns || [];
    const resolvedProjectId = projectIds[table.project];
    const location = {
      project: table.project,
      project_id: resolvedProjectId,
      ...(table.requires ? { requires: true } : {}),
    };

    if (table.requires && binding?.action !== 'connect') {
      tableIds[table.key] = null;
      tables.push({ key: table.key, name: null, table_id: null, action: 'requires', columns_added: [], ...location });
      conflicts.push({ kind: 'REQUIRES_TABLE_UNBOUND', table: table.key, blocking: true });
      continue;
    }

    if (binding?.action === 'skip') {
      tableIds[table.key] = null;
      tables.push({ key: table.key, name: table.name, table_id: null, action: 'skip', columns_added: [], ...location });
      const referencedBy = [];
      if (binding.seed !== false && (blueprint.seed || []).some((group) => group.table === table.key)) {
        referencedBy.push(`seed.${table.key}`);
      }
      for (const widget of surfaceSpecs(blueprint)) {
        if (collectTableRefs(widget.config || {}).has(table.key)) referencedBy.push(`widgets.${widget.key}`);
      }
      for (const source of tableSpecs) {
        for (const column of (source.columns || [])) {
          if (column.target === table.key) referencedBy.push(`tables.${source.key}.columns.${column.column_name}`);
        }
      }
      if (referencedBy.length) {
        conflicts.push({ kind: 'TABLE_SKIP_DEPENDENCY', table: table.key, referenced_by: referencedBy, blocking: true });
      }
      continue;
    }

    let existing;
    if (binding?.action === 'connect') {
      existing = await dbGet(
        `SELECT t.id, t.project_id, t.name, p.space_id
           FROM universal_tables t JOIN projects p ON p.id = t.project_id
          WHERE t.id = ?`,
        [binding.table_id],
      );
      if (!existing) {
        conflicts.push({ kind: 'TABLE_NOT_FOUND', table: table.key, table_id: binding.table_id, blocking: true });
      } else if (Number(existing.space_id) !== Number(spaceId)) {
        conflicts.push({ kind: 'TABLE_NOT_IN_SPACE', table: table.key, table_id: binding.table_id, blocking: true });
      }
      if (!existing || Number(existing.space_id) !== Number(spaceId)) {
        tableIds[table.key] = null;
        tables.push({ key: table.key, name: table.name, table_id: binding.table_id, action: 'connect', columns_added: [], ...location });
        continue;
      }
    } else if (!table.requires && resolvedProjectId && projectUsable[table.project]) {
      existing = await dbGet(
        'SELECT id FROM universal_tables WHERE project_id = ? AND name = ?',
        [resolvedProjectId, table.name],
      );
    }

    if (!existing) {
      tableIds[table.key] = null;
      tables.push({
        key: table.key,
        name: table.name,
        table_id: null,
        action: 'create',
        columns_added: declared.map((column) => column.column_name),
        ...location,
      });
      continue;
    }

    if (binding?.action === 'create') {
      conflicts.push({ kind: 'TABLE_ALREADY_EXISTS', table: table.key, table_id: existing.id, blocking: true });
      tableIds[table.key] = null;
      tables.push({ key: table.key, name: table.name, table_id: null, action: 'create', columns_added: declared.map((column) => column.column_name), ...location });
      continue;
    }

    tableIds[table.key] = existing.id;
    const current = await dbAll(
      'SELECT id, column_name, display_name, type, config, order_index FROM table_columns WHERE table_id = ?',
      [existing.id],
    );

    if (binding?.action === 'connect') {
      const columnPlan = planColumnBindings({
        table: table.key,
        declared,
        existing: current,
        manual: binding.columns || [],
        seedGroups: binding.seed === false
          ? []
          : (blueprint.seed || []).filter((group) => group.table === table.key),
        relationTargets,
      });
      conflicts.push(...columnPlan.conflicts);
      connectedColumns[table.key] = current;
      tables.push({
        key: table.key,
        name: table.requires ? existing.name : table.name,
        table_id: existing.id,
        action: 'connect',
        columns: columnPlan.columns,
        columns_added: columnPlan.columns.filter((column) => column.target === '__new').map((column) => column.module_column),
        ...location,
      });
      continue;
    }

    const byName = new Map(current.map((column) => [column.column_name, column]));
    const missing = declared.filter((column) => !byName.has(column.column_name));
    for (const column of declared) {
      const live = byName.get(column.column_name);
      if (live && column.type && live.type && live.type !== column.type) {
        conflicts.push({
          kind: 'column_type_mismatch',
          table: table.key,
          column: column.column_name,
          existing_type: live.type,
          declared_type: column.type,
          resolution: 'left as-is (reconciliation is add-only)',
        });
      }
    }
    tables.push({
      key: table.key,
      name: table.name,
      table_id: existing.id,
      action: missing.length > 0 ? 'columns_added' : 'existing',
      columns_added: missing.map((column) => column.column_name),
      ...location,
    });
  }

  const candidateGroups = [];
  for (const group of blueprint.seed || []) {
    const binding = bindings.tables?.[group.table];
    if (binding?.action === 'skip' || binding?.seed === false) continue;
    const planned = tables.find((table) => table.key === group.table);
    const remapped = remapSeedGroup(group, planned, connectedColumns[group.table] || []);
    if (remapped.group) candidateGroups.push(remapped.group);
  }

  const seed = [];
  for (const group of blueprint.seed || []) {
    const binding = bindings.tables?.[group.table];
    if (binding?.action === 'skip' || binding?.seed === false) {
      seed.push({ table: group.table, insert: 0, existing: 0, skipped: true });
      continue;
    }
    const planned = tables.find((table) => table.key === group.table);
    const remapped = remapSeedGroup(group, planned, connectedColumns[group.table] || []);
    if (!remapped.group) {
      seed.push({
        table: group.table,
        insert: 0,
        existing: 0,
        skipped: true,
        disabled_reason: remapped.disabled_reason,
        warning: remapped.warning,
      });
      continue;
    }
    const relation = await resolveRelationSeedGroup(remapped.group, {
      tableSpecs,
      plannedTables: tables,
      tableIds,
      all: dbAll,
      candidateGroups,
      includeCandidates: true,
    });
    if (!relation.group) {
      seed.push({
        table: group.table,
        insert: 0,
        existing: 0,
        skipped: true,
        disabled_reason: relation.warnings.join('; '),
        warning: relation.warnings.join('; '),
        relations_dropped: relation.dropped,
      });
      continue;
    }
    const effective = relation.group;
    const rows = effective.rows || [];
    const tableId = tableIds[group.table];
    const existingRows = tableId ? await dbAll('SELECT data FROM table_rows WHERE table_id = ?', [tableId]) : [];
    const seen = new Set(existingRows.map((row) => keySignature(parseData(row.data), effective.key)));
    let insert = 0;
    for (const row of rows) {
      const signature = keySignature(row, effective.key);
      if (seen.has(signature)) continue;
      seen.add(signature);
      insert += 1;
    }
    seed.push({
      table: group.table,
      insert,
      existing: rows.length - insert,
      ...(relation.dropped > 0 ? { relations_dropped: relation.dropped, warning: relation.warnings.join('; ') } : {}),
    });
  }

  const consumers = remapBlueprintColumnRefs(blueprint, tables);
  conflicts.push(...consumers.conflicts, ...agentServiceToolConflicts(blueprint));
  const surface = await planSurfaceV2(consumers.blueprint, spaceId, tableIds, existingWidgets, bindings, projects, conflicts);
  const components = await planModuleComponents({
    blueprint: consumers.blueprint,
    spaceId,
    bindings,
    plannedTables: tables,
    tableMapping: tableIds,
  });
  conflicts.push(...components.conflicts);
  const changes =
    projects.filter((project) => project.action === 'create').length +
    tables.filter((table) => table.action === 'create').length +
    tables.reduce((count, table) => count + table.columns_added.length, 0) +
    tables.reduce((count, table) => count + (table.columns || []).reduce((sum, column) => sum + (column.options_added || 0), 0), 0) +
    seed.reduce((count, group) => count + group.insert, 0) +
    surface.widgets.filter((widget) => widget.action === 'create' || widget.action === 'adopt').length +
    surface.dashboards.filter((dashboard) => dashboard.action === 'create').length +
    surface.sidebar.filter((entry) => entry.action === 'create').length +
    components.changes;

  return {
    module_key: blueprint.key,
    version: blueprint.version,
    projects,
    tables,
    seed,
    ...surface,
    tools: [],
    services: components.services,
    agents: components.agents,
    automations: components.automations,
    conflicts,
    changes,
  };
}

async function planBoundModuleInstall(projectId, blueprint, { spaceId, existingWidgets, bindings }) {
  if (!spaceId) {
    throw new BlueprintError('bindings require an installation space', 'BLUEPRINT_INVALID');
  }

  const conflicts = [];
  const projectKeys = new Set(['main']);
  for (const key of Object.keys(bindings.projects || {})) {
    if (!projectKeys.has(key)) {
      conflicts.push({ kind: 'UNKNOWN_PROJECT_BINDING', project: key, blocking: true });
    }
  }

  const projectBinding = bindings.projects?.main || { action: 'use', project_id: projectId };
  let resolvedProjectId = projectId;
  let projectUsable = true;
  if (projectBinding.action === 'create') {
    resolvedProjectId = null;
  } else {
    resolvedProjectId = projectBinding.project_id;
    const project = await dbGet('SELECT id, space_id FROM projects WHERE id = ?', [resolvedProjectId]);
    if (!project) {
      projectUsable = false;
      conflicts.push({ kind: 'PROJECT_NOT_FOUND', project: 'main', project_id: resolvedProjectId, blocking: true });
    } else if (Number(project.space_id) !== Number(spaceId)) {
      projectUsable = false;
      conflicts.push({ kind: 'PROJECT_NOT_IN_SPACE', project: 'main', project_id: resolvedProjectId, blocking: true });
    }
  }
  const projects = [{ key: 'main', action: projectBinding.action, project_id: resolvedProjectId }];

  const blueprintKeys = new Set(blueprint.tables.map((table) => table.key));
  for (const key of Object.keys(bindings.tables || {})) {
    if (!blueprintKeys.has(key)) {
      conflicts.push({ kind: 'UNKNOWN_TABLE_BINDING', table: key, blocking: true });
    }
  }

  const tables = [];
  const tableIds = {};
  const connectedColumns = {};
  const relationTargets = {};
  for (const table of blueprint.tables) {
    const binding = bindings.tables?.[table.key];
    if (binding?.action === 'connect') {
      relationTargets[table.key] = binding.table_id;
    } else if (!binding && resolvedProjectId && projectUsable) {
      const existing = await dbGet(
        'SELECT id FROM universal_tables WHERE project_id = ? AND name = ?',
        [resolvedProjectId, table.name]
      );
      relationTargets[table.key] = existing?.id ?? null;
    } else {
      relationTargets[table.key] = null;
    }
  }

  for (const table of blueprint.tables) {
    const binding = bindings.tables?.[table.key];
    const declared = table.columns || [];
    const location = { project: 'main', project_id: resolvedProjectId };

    if (binding?.action === 'skip') {
      tableIds[table.key] = null;
      tables.push({ key: table.key, name: table.name, table_id: null, action: 'skip', columns_added: [], ...location });
      const referencedBy = [];
      if (binding.seed !== false && (blueprint.seed || []).some((group) => group.table === table.key)) {
        referencedBy.push(`seed.${table.key}`);
      }
      for (const widget of (blueprint.widgets || [])) {
        if (collectTableRefs(widget.config || {}).has(table.key)) referencedBy.push(`widgets.${widget.key}`);
      }
      for (const source of blueprint.tables) {
        for (const column of (source.columns || [])) {
          if (column.target === table.key) referencedBy.push(`tables.${source.key}.columns.${column.column_name}`);
        }
      }
      if (referencedBy.length) {
        conflicts.push({ kind: 'TABLE_SKIP_DEPENDENCY', table: table.key, referenced_by: referencedBy, blocking: true });
      }
      continue;
    }

    let existing;
    if (binding?.action === 'connect') {
      existing = await dbGet(
        `SELECT t.id, t.project_id, t.name, p.space_id
           FROM universal_tables t JOIN projects p ON p.id = t.project_id
          WHERE t.id = ?`,
        [binding.table_id]
      );
      if (!existing) {
        conflicts.push({ kind: 'TABLE_NOT_FOUND', table: table.key, table_id: binding.table_id, blocking: true });
      } else if (Number(existing.space_id) !== Number(spaceId)) {
        conflicts.push({ kind: 'TABLE_NOT_IN_SPACE', table: table.key, table_id: binding.table_id, blocking: true });
      }
      if (!existing || Number(existing.space_id) !== Number(spaceId)) {
        tableIds[table.key] = null;
        tables.push({ key: table.key, name: table.name, table_id: binding.table_id, action: 'connect', columns_added: [], ...location });
        continue;
      }
    } else if (resolvedProjectId && projectUsable) {
      existing = await dbGet(
        `SELECT id FROM universal_tables WHERE project_id = ? AND name = ?`,
        [resolvedProjectId, table.name]
      );
    }

    if (!existing) {
      tableIds[table.key] = null;
      tables.push({
        key: table.key,
        name: table.name,
        table_id: null,
        action: 'create',
        columns_added: declared.map((c) => c.column_name),
        ...location,
      });
      continue;
    }

    if (binding?.action === 'create') {
      conflicts.push({ kind: 'TABLE_ALREADY_EXISTS', table: table.key, table_id: existing.id, blocking: true });
      tableIds[table.key] = null;
      tables.push({ key: table.key, name: table.name, table_id: null, action: 'create', columns_added: declared.map((c) => c.column_name), ...location });
      continue;
    }

    tableIds[table.key] = existing.id;
    const current = await dbAll(
      'SELECT id, column_name, display_name, type, config, order_index FROM table_columns WHERE table_id = ?',
      [existing.id]
    );

    if (binding?.action === 'connect') {
      const columnPlan = planColumnBindings({
        table: table.key,
        declared,
        existing: current,
        manual: binding.columns || [],
        seedGroups: binding.seed === false
          ? []
          : (blueprint.seed || []).filter((group) => group.table === table.key),
        relationTargets,
      });
      conflicts.push(...columnPlan.conflicts);
      connectedColumns[table.key] = current;
      tables.push({
        key: table.key,
        name: table.name,
        table_id: existing.id,
        action: 'connect',
        columns: columnPlan.columns,
        columns_added: columnPlan.columns.filter((column) => column.target === '__new').map((column) => column.module_column),
        ...location,
      });
      continue;
    }

    const byName = new Map(current.map((c) => [c.column_name, c]));
    const missing = declared.filter((c) => !byName.has(c.column_name));
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
      ...location,
    });
  }

  const seed = [];
  for (const group of (blueprint.seed || [])) {
    const binding = bindings.tables?.[group.table];
    if (binding?.action === 'skip' || binding?.seed === false) {
      seed.push({ table: group.table, insert: 0, existing: 0, skipped: true });
      continue;
    }

    const plannedTable = tables.find((table) => table.key === group.table);
    const remapped = remapSeedGroup(group, plannedTable, connectedColumns[group.table] || []);
    if (!remapped.group) {
      seed.push({
        table: group.table, insert: 0, existing: 0, skipped: true,
        disabled_reason: remapped.disabled_reason, warning: remapped.warning,
      });
      continue;
    }

    const effective = remapped.group;
    const rows = effective.rows || [];
    const tableId = tableIds[group.table];
    const existingRows = tableId ? await dbAll('SELECT data FROM table_rows WHERE table_id = ?', [tableId]) : [];
    const seen = new Set(existingRows.map((r) => keySignature(parseData(r.data), effective.key)));
    let insert = 0;
    for (const row of rows) {
      const sig = keySignature(row, effective.key);
      if (seen.has(sig)) continue;
      seen.add(sig);
      insert += 1;
    }
    seed.push({ table: group.table, insert, existing: rows.length - insert });
  }

  const consumers = remapBlueprintColumnRefs(blueprint, tables);
  conflicts.push(...consumers.conflicts);
  const surface = await planSurface(consumers.blueprint, spaceId, tableIds, existingWidgets);
  const changes =
    (projectBinding.action === 'create' ? 1 : 0) +
    tables.filter((t) => t.action === 'create').length +
    tables.reduce((n, t) => n + t.columns_added.length, 0) +
    tables.reduce((n, t) => n + (t.columns || []).reduce((m, column) => m + (column.options_added || 0), 0), 0) +
    seed.reduce((n, s) => n + s.insert, 0) +
    surface.widgets.filter((w) => w.action === 'create' || w.action === 'adopt').length +
    surface.sidebar.filter((s) => s.action === 'create').length;

  return {
    module_key: blueprint.key,
    version: blueprint.version,
    projects,
    tables,
    seed,
    ...surface,
    tools: [],
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

async function planSurfaceV2(blueprint, spaceId, tableIds, existingWidgets, bindings, projects, conflicts) {
  const specs = surfaceSpecs(blueprint);
  const appSpecs = specs.filter((spec) => spec.kind === 'app');
  const tileSpecs = specs.filter((spec) => spec.kind === 'tile');
  const appKeys = new Set(appSpecs.map((spec) => spec.key));
  const tileKeys = new Set(tileSpecs.map((spec) => spec.key));
  const dashboardKeys = new Set((blueprint.dashboards || []).map((dashboard) => dashboard.key));
  for (const key of Object.keys(bindings.apps || {})) {
    if (!appKeys.has(key)) conflicts.push({ kind: 'UNKNOWN_APP_BINDING', app: key, blocking: true });
  }
  for (const key of Object.keys(bindings.tiles || {})) {
    if (!tileKeys.has(key)) conflicts.push({ kind: 'UNKNOWN_TILE_BINDING', tile: key, blocking: true });
  }
  for (const key of Object.keys(bindings.dashboards || {})) {
    if (!dashboardKeys.has(key)) conflicts.push({ kind: 'UNKNOWN_DASHBOARD_BINDING', dashboard: key, blocking: true });
  }
  if (specs.length === 0 && (blueprint.sidebar || []).length === 0 && dashboardKeys.size === 0) {
    return { widgets: [], apps: [], tiles: [], dashboards: [], sidebar: [], dashboard: null };
  }

  const installed = await loadModuleWidgets(dbAll, spaceId, blueprint.key, true);
  const adopted = await loadWidgetAdoptions(dbGet, blueprint, spaceId, existingWidgets, installed);
  const binds = (spec) => [...collectTableRefs(spec.config || {})].map((ref) => ({
    table: ref,
    table_id: tableIds[ref] ?? null,
  }));
  const loadDashboard = async (dashboardId) => dbGet(
    `SELECT d.id, d.space_id, d.project_id, d.is_default, COALESCE(d.space_id, p.space_id) AS owner_space_id
       FROM dashboards d LEFT JOIN projects p ON p.id = d.project_id WHERE d.id = ?`,
    [dashboardId],
  );

  const dashboards = [];
  for (const spec of blueprint.dashboards || []) {
    const project = projects.find((candidate) => candidate.key === spec.project);
    let board = null;
    if (spec.target === 'default') {
      board = await dbGet('SELECT id FROM dashboards WHERE space_id = ? AND is_default = 1 ORDER BY id ASC', [spaceId]);
    } else {
      const installedTile = tileSpecs
        .filter((tile) => tile.dashboard_key === spec.key)
        .map((tile) => installed.get(tile.key))
        .find(Boolean);
      const boundId = installedTile?.dashboard_id ?? bindings.dashboards?.[spec.key]?.dashboard_id;
      if (boundId) {
        board = await loadDashboard(boundId);
        if (!board) {
          conflicts.push({ kind: 'DASHBOARD_NOT_FOUND', dashboard: spec.key, dashboard_id: boundId, blocking: true });
        } else if (Number(board.owner_space_id) !== Number(spaceId)) {
          conflicts.push({ kind: 'DASHBOARD_NOT_IN_SPACE', dashboard: spec.key, dashboard_id: boundId, blocking: true });
        }
      }
    }
    dashboards.push({
      key: spec.key,
      target: spec.target,
      project: spec.project || null,
      project_id: project?.project_id ?? null,
      title: spec.title || spec.key,
      description: spec.description,
      icon: spec.icon,
      dashboard_id: board?.id ?? null,
      action: board ? 'existing' : 'create',
    });
  }

  const apps = appSpecs.map((spec) => {
    const found = installed.get(spec.key) || adopted.get(spec.key);
    return {
      key: spec.key,
      kind: 'app',
      preset_name: spec.preset_name,
      title: spec.title || spec.key,
      dashboard_id: null,
      widget_id: found?.id ?? null,
      action: adopted.has(spec.key) ? 'adopt' : found ? 'existing' : 'create',
      binds: binds(spec),
    };
  });

  const tiles = [];
  for (const spec of tileSpecs) {
    const binding = bindings.tiles?.[spec.key];
    const found = installed.get(spec.key);
    let dashboardId = found?.dashboard_id
      ?? binding?.dashboard_id
      ?? dashboards.find((dashboard) => dashboard.key === spec.dashboard_key)?.dashboard_id
      ?? null;
    if (!found && binding?.dashboard_id) {
      const board = await loadDashboard(binding.dashboard_id);
      if (!board) {
        conflicts.push({ kind: 'DASHBOARD_NOT_FOUND', tile: spec.key, dashboard_id: binding.dashboard_id, blocking: true });
      } else if (Number(board.owner_space_id) !== Number(spaceId)) {
        conflicts.push({ kind: 'DASHBOARD_NOT_IN_SPACE', tile: spec.key, dashboard_id: binding.dashboard_id, blocking: true });
      }
    }
    if (!found && binding?.action === 'skip') dashboardId = null;
    tiles.push({
      key: spec.key,
      kind: 'tile',
      dashboard_key: spec.dashboard_key,
      preset_name: spec.preset_name,
      title: spec.title || spec.key,
      dashboard_id: dashboardId,
      widget_id: found?.id ?? null,
      action: found ? 'existing' : binding?.action === 'skip' ? 'skip' : 'create',
      binds: binds(spec),
    });
  }

  const sidebar = [];
  for (const pin of blueprint.sidebar || []) {
    const widget = installed.get(pin.widget) || adopted.get(pin.widget);
    const pinned = widget ? await dbGet('SELECT id FROM modules WHERE widget_id = ?', [widget.id]) : null;
    const skipped = bindings.sidebar?.[pin.widget] === false;
    sidebar.push({
      widget: pin.widget,
      module_id: pinned?.id ?? null,
      action: pinned ? 'existing' : skipped ? 'skip' : 'create',
    });
  }

  const widgets = [...apps, ...tiles];
  return { widgets, apps, tiles, dashboards, sidebar, dashboard: null };
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
async function loadModuleWidgets(all, spaceId, moduleKey, includeStandalone = false) {
  const rows = includeStandalone
    ? await all(
      `SELECT w.id, w.dashboard_id, w.preset_name, w.title, w.config
         FROM widgets w
         LEFT JOIN dashboards d ON d.id = w.dashboard_id
         LEFT JOIN projects p ON p.id = d.project_id
        WHERE d.space_id = ? OR p.space_id = ?
           OR (w.owner_kind = 'space' AND w.owner_id = ?)`,
      [spaceId, spaceId, spaceId],
    )
    : await all(
      `SELECT w.id, w.dashboard_id, w.preset_name, w.title, w.config
         FROM widgets w
         JOIN dashboards d ON d.id = w.dashboard_id
         LEFT JOIN projects p ON p.id = d.project_id
        WHERE d.space_id = ? OR p.space_id = ?`,
      [spaceId, spaceId],
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
 * @param {object} [args.bindings] - optional project/table/surface choices shared by dry-run and apply
 */
export async function installModule({ blueprint: raw, spaceId, projectId, userId = null, dryRun = false, existingWidgets = {}, bindings = null }) {
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

  const journal = existing && blueprint.schema === 2
    ? await getModuleInstall(blueprint.key, spaceId)
    : null;
  const effectiveBindings = blueprint.schema === 2
    ? mergeBindings(journal?.bindings ?? { projects: { main: { action: 'use', project_id: projectId } } }, bindings)
    : bindings;
  const plan = await planModuleInstall(projectId, blueprint, { spaceId, existingWidgets, bindings: effectiveBindings });
  const mainProject = plan.projects?.find((project) => project.key === 'main');
  const resolvedProjectId = mainProject?.project_id ?? projectId;
  if (existing && (mainProject?.action === 'create' || Number(existing.project_id) !== Number(resolvedProjectId))) {
    throw new BlueprintError('An installation cannot be moved to another project', 'INSTALLATION_PROJECT_MISMATCH');
  }
  const schemaConflicts = plan.conflicts.filter((conflict) => !conflict.blocking);
  if (Object.keys(existingWidgets).length && schemaConflicts.length) {
    throw new BlueprintError('Resolve table schema conflicts before adopting a widget', 'WIDGET_ADOPTION_CONFLICT', schemaConflicts);
  }

  if (dryRun) {
    return { dry_run: true, status: existing ? 'reinstall' : 'install', plan, installation: existing || null };
  }

  const bindingConflicts = plan.conflicts.filter((conflict) => conflict.blocking);
  if (bindingConflicts.length) {
    throw new BlueprintError('Resolve module binding conflicts before installing', 'INSTALL_BINDINGS_CONFLICT', bindingConflicts);
  }

  // Same blueprint, already installed, nothing left to do — AC#2's no-op. The record is
  // untouched, so `updated_at` keeps meaning "last time something actually changed".
  if (existing && existing.status === 'active' && plan.changes === 0) {
    return { dry_run: false, status: 'unchanged', plan, installation: existing };
  }

  const applied = await applyPlan({ blueprint, projectId, spaceId, userId, sha, existingWidgets, bindings: effectiveBindings, plan });
  apiLogger.info(
    { module: blueprint.key, spaceId, projectId: applied.installation.project_id, version: blueprint.version, changes: plan.changes },
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

  const journal = await getModuleInstall(moduleKey, spaceId);
  const bindings = journal?.bindings ?? (blueprint.schema === 2
    ? { projects: { main: { action: 'use', project_id: existing.project_id } } }
    : null);
  const plan = await planModuleInstall(existing.project_id, blueprint, { spaceId, bindings });
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
    bindings,
    plan,
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
  const journal = blueprint?.schema === 2 ? await getModuleInstall(moduleKey, spaceId) : null;
  const targets = [];
  for (const table of (blueprint?.tables || [])) {
    const boundId = journal?.bindings?.tables?.[table.key]?.table_id;
    const row = boundId
      ? await dbGet('SELECT id, name FROM universal_tables WHERE id = ?', [boundId])
      : await dbGet(
        `SELECT id, name FROM universal_tables WHERE project_id = ? AND name = ?`,
        [existing.project_id, table.name]
      );
    if (row) targets.push({ key: table.key, name: row.name, table_id: row.id });
  }

  // The module's own widgets, found by the stamp it wrote — never by shape. Sidebar entries
  // (`modules`) and the library index come off with them via ON DELETE CASCADE.
  const installedWidgets = await loadModuleWidgets(dbAll, spaceId, moduleKey, blueprint?.schema === 2);
  const widgetTargets = [...installedWidgets.entries()].map(([key, row]) => ({
    widget_key: key, widget_id: row.id, preset_name: row.preset_name,
  }));
  const declaredWidgets = new Set(surfaceSpecs(blueprint || {}).map((widget) => widget.key));
  const orphanWidgets = widgetTargets
    .filter((w) => !declaredWidgets.has(w.widget_key))
    .map((w) => w.widget_key);

  const purged = { tables: 0, rows: 0 };
  let components = { services: [], agents: [], automations: [] };
  await withTransactionAsync(async (trx) => {
    for (const widget of widgetTargets) {
      // `orphan: true`: a document atom may embed this widget, and refusing to uninstall over
      // that would be worse than the documented broken-ref UI (T-127905/906). A bare DELETE
      // would leave the atom pointing at a dead id instead.
      await deleteWidgetInTrx(trx, widget.widget_id, { orphan: true, userId });
    }

    if (blueprint?.schema === 2) {
      components = await uninstallModuleComponents({ blueprint, spaceId, trx });
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
    await deleteModuleInstall(trx, moduleKey, spaceId);
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
    connectors_disabled: components.services,
    agents_removed: components.agents,
    automations_removed: components.automations,
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
async function applyPlan({ blueprint, projectId, spaceId, userId, sha, existingWidgets = {}, bindings = null, plan = null }) {
  const bindingConflicts = (plan?.conflicts || []).filter((conflict) => conflict.blocking);
  if (bindingConflicts.length > 0) {
    throw new BlueprintError('Resolve module binding conflicts before installing', 'INSTALL_BINDINGS_CONFLICT', bindingConflicts);
  }
  const applied = await withTransactionAsync(async (trx) => {
    // One writer per (module_key, space_id) at a time. `universal_tables` has no unique index on
    // (project_id, name) and the installation row is an upsert, so without this two concurrent
    // installs both plan "create" and each provisions its own copy of every table (Neo16 W1
    // concurrency test). Transaction-scoped: released on commit/rollback, nothing to clean up.
    await trx.run('SELECT pg_advisory_xact_lock(hashtext(?))', [`module-install:${blueprint.key}:${spaceId}`]);
    const consumers = bindings
      ? remapBlueprintColumnRefs(blueprint, plan.tables)
      : { blueprint, conflicts: [] };
    if (consumers.conflicts.length > 0) {
      throw new BlueprintError('Resolve module binding conflicts before installing', 'INSTALL_BINDINGS_CONFLICT', consumers.conflicts);
    }
    const projectIds = {};
    if (bindings) {
      for (const project of plan.projects) {
        projectIds[project.key] = await resolveBoundProject({ blueprint, spaceId, userId, project, trx });
      }
    }
    const targetProjectId = projectIds.main ?? projectId;
    const current = await trx.get('SELECT project_id FROM module_installations WHERE module_key = ? AND space_id = ?', [blueprint.key, spaceId]);
    if (current && Number(current.project_id) !== Number(targetProjectId)) {
      throw new BlueprintError('An installation cannot be moved to another project', 'INSTALLATION_PROJECT_MISMATCH');
    }
    const mapping = bindings
      ? await provisionBoundTables({ blueprint, spaceId, projectId: targetProjectId, projectIds, tables: plan.tables, userId, trx })
      : await provisionModuleTables(projectId, blueprint, { userId, trx, reconcile: true });
    await remapInstalledRelationColumns({ blueprint, mapping, trx });
    const seedBlueprint = bindings
      ? await prepareBoundSeedBlueprint({ blueprint, bindings, plan, trx })
      : blueprint;
    const seeded = blueprint.schema === 2 && bindings
      && seedGroupsHaveRelations(seedBlueprint.seed || [], installTableSpecs(blueprint))
      ? await seedModuleRelationGroups({
        blueprint,
        groups: seedBlueprint.seed || [],
        mapping,
        tableSpecs: installTableSpecs(blueprint),
        plannedTables: plan.tables,
        userId,
        trx,
      })
      : await seedModuleRows(mapping, seedBlueprint, { userId, trx });
    const surface = blueprint.schema === 2
      ? await applySurfaceV2({ blueprint: consumers.blueprint, spaceId, userId, mapping, trx, existingWidgets, bindings, plan, projectIds })
      : await applySurface({ blueprint: consumers.blueprint, spaceId, userId, mapping, trx, existingWidgets });
    const components = blueprint.schema === 2
      ? await applyModuleComponents({ blueprint: consumers.blueprint, spaceId, userId, bindings, mapping, plan, trx })
      : { services: [], agents: [], automations: [] };

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
        targetProjectId,
        JSON.stringify(blueprint),
        sha,
        userId,
      ]
    );
    await upsertModuleInstall(trx, {
      moduleKey: blueprint.key,
      version: blueprint.version,
      spaceId,
      userId,
      accessLevel: moduleAccessLevel(blueprint),
      bindings: snapshotBindings({ blueprint, bindings, plan, mapping, projectId: targetProjectId, projectIds, surface }),
    });

    const installation = await trx.get(
      `SELECT id, module_key, version, space_id, project_id, blueprint_sha256, status, installed_at, updated_at
         FROM module_installations WHERE module_key = ? AND space_id = ?`,
      [blueprint.key, spaceId]
    );

    return { installation, mapping, seeded, ...surface, ...components };
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

function moduleAccessLevel(blueprint) {
  const declared = new Set((blueprint.sidebar || []).map((pin) => pin.access_level || 'member'));
  return VALID_ACCESS_LEVELS.find((level) => declared.has(level)) || 'member';
}

function snapshotBindings({ blueprint, bindings, plan, mapping, projectId, projectIds = { main: projectId }, surface = null }) {
  if (!bindings) return null;
  const tables = {};
  const tableSpecs = installTableSpecs(blueprint);
  for (const planned of plan.tables) {
    const seed = bindings.tables?.[planned.key]?.seed !== false;
    if (planned.action === 'skip') {
      tables[planned.key] = { action: 'skip', seed };
      continue;
    }
    const tableId = mapping[planned.key]?.table_id;
    if (!tableId) throw new Error(`module table "${planned.key}" has no resolved id after provisioning`);
    const spec = tableSpecs.find((table) => table.key === planned.key);
    const columns = planned.columns || (spec.columns || []).map((column) => ({
      module_column: column.column_name,
      target: column.column_name,
    }));
    tables[planned.key] = {
      action: 'connect',
      table_id: tableId,
      seed,
      columns: columns.map((column) => ({
        module_column: column.module_column,
        target: column.target === '__new' ? column.module_column : column.target,
      })),
    };
  }
  const projects = Object.fromEntries(plan.projects.map((project) => [
    project.key,
    { action: 'use', project_id: projectIds[project.key] },
  ]));
  if (blueprint.schema !== 2) return { projects, tables };

  const apps = {};
  for (const planned of plan.apps) {
    const widget = surface.widgets.find((candidate) => candidate.key === planned.key);
    if (!widget?.widget_id) throw new Error(`module app "${planned.key}" has no resolved id after install`);
    apps[planned.key] = { action: 'adopt', widget_id: widget.widget_id };
  }
  const tiles = {};
  for (const planned of plan.tiles) {
    if (planned.action === 'skip') {
      tiles[planned.key] = { action: 'skip' };
      continue;
    }
    const widget = surface.widgets.find((candidate) => candidate.key === planned.key);
    if (!widget?.widget_id || !widget.dashboard_id) throw new Error(`module tile "${planned.key}" has no resolved dashboard after install`);
    tiles[planned.key] = { dashboard_id: widget.dashboard_id };
  }
  const dashboards = {};
  for (const planned of plan.dashboards) {
    const dashboard = surface.dashboards.find((candidate) => candidate.key === planned.key);
    if (dashboard?.dashboard_id) dashboards[planned.key] = { dashboard_id: dashboard.dashboard_id };
  }
  const sidebar = Object.fromEntries(plan.sidebar.map((entry) => [entry.widget, entry.action !== 'skip']));
  return { projects, tables, apps, tiles, dashboards, sidebar, ...(bindings.secrets ? { secrets: bindings.secrets } : {}) };
}

async function resolveBoundProject({ blueprint, spaceId, userId, project, trx }) {
  if (project.action === 'use') {
    const row = await trx.get('SELECT id, space_id FROM projects WHERE id = ?', [project.project_id]);
    if (!row || Number(row.space_id) !== Number(spaceId)) {
      throw new BlueprintError('Resolve module binding conflicts before installing', 'INSTALL_BINDINGS_CONFLICT', [
        { kind: row ? 'PROJECT_NOT_IN_SPACE' : 'PROJECT_NOT_FOUND', project: project.key, project_id: project.project_id, blocking: true },
      ]);
    }
    return row.id;
  }

  if (!userId) {
    throw new BlueprintError('creating a bound project requires an installing user', 'BLUEPRINT_INVALID');
  }
  const result = await trx.run(
    `INSERT INTO projects (space_id, name, description, icon, owner_id, type)
     VALUES (?, ?, ?, ?, ?, 'custom')`,
    [spaceId, project.title || blueprint.title || blueprint.key, project.description || null, project.icon || blueprint.icon || '📁', userId]
  );
  return result.lastInsertRowid ?? result.lastID;
}

async function provisionBoundTables({ blueprint, spaceId, projectId, projectIds = { main: projectId }, tables, userId, trx }) {
  const mapping = {};
  const tableSpecs = installTableSpecs(blueprint);
  for (const planned of tables) {
    if (planned.action === 'skip') continue;
    const spec = tableSpecs.find((table) => table.key === planned.key);
    let tableProjectId = projectIds[planned.project] ?? projectId;
    let tableSpec = spec;

    if (planned.action === 'connect') {
      const live = await trx.get(
        `SELECT t.id, t.project_id, t.name, p.space_id
           FROM universal_tables t JOIN projects p ON p.id = t.project_id
          WHERE t.id = ? FOR UPDATE OF t`,
        [planned.table_id]
      );
      if (!live || Number(live.space_id) !== Number(spaceId)) {
        throw new BlueprintError('Resolve module binding conflicts before installing', 'INSTALL_BINDINGS_CONFLICT', [
          { kind: live ? 'TABLE_NOT_IN_SPACE' : 'TABLE_NOT_FOUND', table: planned.key, table_id: planned.table_id, blocking: true },
        ]);
      }
      tableProjectId = live.project_id;
      const newColumns = new Set(
        planned.columns.filter((column) => column.target === '__new').map((column) => column.module_column)
      );
      tableSpec = {
        ...spec,
        name: live.name,
        columns: (spec.columns || []).filter((column) => newColumns.has(column.column_name)),
      };
    } else if (planned.action === 'create') {
      const duplicate = await trx.get(
        'SELECT id FROM universal_tables WHERE project_id = ? AND name = ?',
        [tableProjectId, spec.name]
      );
      if (duplicate) {
        throw new BlueprintError('Resolve module binding conflicts before installing', 'INSTALL_BINDINGS_CONFLICT', [
          { kind: 'TABLE_ALREADY_EXISTS', table: planned.key, table_id: duplicate.id, blocking: true },
        ]);
      }
    }

    const provisioned = await provisionModuleTables(
      tableProjectId,
      { ...blueprint, tables: [tableSpec] },
      { userId, trx, reconcile: true }
    );
    Object.assign(mapping, provisioned);
  }
  return mapping;
}

async function remapInstalledRelationColumns({ blueprint, mapping, trx }) {
  for (const table of installTableSpecs(blueprint)) {
    const provisioned = mapping[table.key];
    if (!provisioned) continue;
    const createdColumns = provisioned.created
      ? new Set((table.columns || []).map((column) => column.column_name))
      : new Set(provisioned.columns_added || []);
    const relations = (table.columns || []).filter((column) =>
      column.type === 'relation' && column.target && createdColumns.has(column.column_name)
    );
    if (relations.length === 0) continue;

    const liveColumns = await trx.all(
      'SELECT id, column_name, config FROM table_columns WHERE table_id = ?',
      [provisioned.table_id]
    );
    for (const column of relations) {
      const targetTableId = mapping[column.target]?.table_id;
      if (!targetTableId) {
        throw new BlueprintError('Resolve module binding conflicts before installing', 'INSTALL_BINDINGS_CONFLICT', [{
          kind: 'relation_target', table: table.key, column: column.column_name,
          expected_table_id: null, actual_table_id: null, blocking: true,
        }]);
      }
      const live = liveColumns.find((candidate) => candidate.column_name === column.column_name);
      if (!live) throw new Error(`relation column "${column.column_name}" was not provisioned in table "${table.key}"`);
      const config = remapRelationConfig(live.config ?? column.config, targetTableId);
      if (JSON.stringify(config) !== JSON.stringify(safeJsonParse(live.config, {}))) {
        await trx.run('UPDATE table_columns SET config = ? WHERE id = ?', [JSON.stringify(config), live.id]);
      }
    }
  }
}

async function prepareBoundSeedBlueprint({ blueprint, bindings, plan, trx }) {
  const connectedColumns = {};
  for (const planned of plan.tables.filter((table) => table.action === 'connect')) {
    const current = await trx.all(
      `SELECT id, column_name, display_name, type, config, order_index
         FROM table_columns WHERE table_id = ? FOR UPDATE`,
      [planned.table_id]
    );
    for (const column of planned.columns) {
      if (!column.options_to_add?.length) continue;
      const live = current.find((candidate) => candidate.column_name === column.target);
      if (!live) continue;
      const config = safeJsonParse(live.config, {}) || {};
      const nextConfig = mergeSelectOptions(config, column.options_to_add);
      if (JSON.stringify(nextConfig) !== JSON.stringify(config)) {
        live.config = JSON.stringify(nextConfig);
        await trx.run('UPDATE table_columns SET config = ? WHERE id = ?', [live.config, live.id]);
      }
    }
    connectedColumns[planned.key] = current;
  }

  const seed = [];
  for (const group of (blueprint.seed || [])) {
    const binding = bindings.tables?.[group.table];
    if (binding?.action === 'skip' || binding?.seed === false) continue;

    const planned = plan.tables.find((table) => table.key === group.table);
    const remapped = remapSeedGroup(group, planned, connectedColumns[group.table] || []);
    if (remapped.group) seed.push(remapped.group);
  }
  return { ...blueprint, seed };
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

async function applySurfaceV2({ blueprint, spaceId, userId, mapping, trx, existingWidgets, bindings, plan, projectIds }) {
  const specs = surfaceSpecs(blueprint);
  const appSpecs = specs.filter((spec) => spec.kind === 'app');
  const tileSpecs = specs.filter((spec) => spec.kind === 'tile');
  const pins = blueprint.sidebar || [];
  if (specs.length === 0 && pins.length === 0 && plan.dashboards.length === 0) {
    return { widgets: [], sidebar: [], dashboards: [] };
  }

  const installed = await loadModuleWidgets((sql, params) => trx.all(sql, params), spaceId, blueprint.key, true);
  const adoptionIds = { ...existingWidgets };
  for (const [key, binding] of Object.entries(bindings.apps || {})) {
    if (binding.action === 'adopt') adoptionIds[key] = binding.widget_id;
  }
  const adopted = await loadWidgetAdoptions((sql, params) => trx.get(sql, params), blueprint, spaceId, adoptionIds, installed, true);
  const dashboards = [];
  for (const planned of plan.dashboards) {
    let dashboardId = planned.dashboard_id;
    let action = 'existing';
    if (!dashboardId && planned.target === 'default') {
      const board = await getSpaceDashboard(spaceId, { trx });
      if (!board) throw new BlueprintError(`space ${spaceId} does not exist`, 'SPACE_NOT_FOUND');
      dashboardId = board.id;
      action = 'created';
    } else if (!dashboardId) {
      const projectId = planned.project ? projectIds[planned.project] : null;
      if (planned.project && !projectId) {
        throw new BlueprintError('Resolve module binding conflicts before installing', 'INSTALL_BINDINGS_CONFLICT', [
          { kind: 'PROJECT_NOT_FOUND', project: planned.project, blocking: true },
        ]);
      }
      const result = await trx.run(
        `INSERT INTO dashboards (space_id, project_id, name, description, icon, is_default, order_index)
         VALUES (?, ?, ?, ?, ?, 0, 0)`,
        [projectId ? null : spaceId, projectId, planned.title, planned.description || null, planned.icon || '📊'],
      );
      dashboardId = result.lastInsertRowid ?? result.lastID;
      action = 'created';
    }
    const board = await trx.get(
      `SELECT d.id, COALESCE(d.space_id, p.space_id) AS owner_space_id
         FROM dashboards d LEFT JOIN projects p ON p.id = d.project_id WHERE d.id = ?`,
      [dashboardId],
    );
    if (!board || Number(board.owner_space_id) !== Number(spaceId)) {
      throw new BlueprintError('Resolve module binding conflicts before installing', 'INSTALL_BINDINGS_CONFLICT', [
        { kind: board ? 'DASHBOARD_NOT_IN_SPACE' : 'DASHBOARD_NOT_FOUND', dashboard: planned.key, dashboard_id: dashboardId, blocking: true },
      ]);
    }
    dashboards.push({ key: planned.key, dashboard_id: dashboardId, action });
  }
  const dashboardIds = Object.fromEntries(dashboards.map((dashboard) => [dashboard.key, dashboard.dashboard_id]));
  const resolveTable = (ref) => mapping[ref]?.table_id;
  const widgets = [];
  const widgetIds = {};

  for (const spec of appSpecs) {
    const found = installed.get(spec.key);
    if (found) {
      widgetIds[spec.key] = found.id;
      widgets.push({ key: spec.key, kind: 'app', widget_id: found.id, dashboard_id: null, action: 'existing' });
      continue;
    }
    const config = {
      ...remapConfigTableRefs(spec.config || {}, resolveTable),
      [WIDGET_TAG_KEY]: { key: blueprint.key, widget_key: spec.key },
    };
    const target = adopted.get(spec.key);
    if (target) {
      await trx.run('UPDATE widgets SET config = ?, updated_at = NOW() WHERE id = ?', [
        JSON.stringify({ ...safeJsonParse(target.config, {}), ...config }), target.id,
      ]);
      widgetIds[spec.key] = target.id;
      widgets.push({ key: spec.key, kind: 'app', widget_id: target.id, dashboard_id: null, action: 'adopted' });
      continue;
    }
    const result = await trx.run(
      `INSERT INTO widgets
         (dashboard_id, owner_kind, owner_id, widget_type, preset_name, title, description, icon, config, position, order_index, created_by)
       VALUES (NULL, 'space', ?, 'preset', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        spaceId,
        spec.preset_name,
        spec.title || spec.key,
        spec.description ?? null,
        spec.icon || '🧩',
        JSON.stringify(config),
        JSON.stringify(spec.position || { x: 0, y: 0, w: 6, h: 4 }),
        spec.order_index ?? 0,
        userId,
      ],
    );
    const widgetId = result.lastInsertRowid ?? result.lastID;
    widgetIds[spec.key] = widgetId;
    widgets.push({ key: spec.key, kind: 'app', widget_id: widgetId, dashboard_id: null, action: 'created' });
  }

  for (const spec of tileSpecs) {
    const found = installed.get(spec.key);
    if (found) {
      widgetIds[spec.key] = found.id;
      widgets.push({ key: spec.key, kind: 'tile', widget_id: found.id, dashboard_id: found.dashboard_id, action: 'existing' });
      continue;
    }
    const planned = plan.tiles.find((tile) => tile.key === spec.key);
    if (planned.action === 'skip') continue;
    const dashboardId = planned.dashboard_id || dashboardIds[spec.dashboard_key];
    const board = await trx.get(
      `SELECT d.id, COALESCE(d.space_id, p.space_id) AS owner_space_id
         FROM dashboards d LEFT JOIN projects p ON p.id = d.project_id WHERE d.id = ?`,
      [dashboardId],
    );
    if (!board || Number(board.owner_space_id) !== Number(spaceId)) {
      throw new BlueprintError('Resolve module binding conflicts before installing', 'INSTALL_BINDINGS_CONFLICT', [
        { kind: board ? 'DASHBOARD_NOT_IN_SPACE' : 'DASHBOARD_NOT_FOUND', tile: spec.key, dashboard_id: dashboardId, blocking: true },
      ]);
    }
    const config = {
      ...remapConfigAppRefs(
        remapConfigTableRefs(spec.config || {}, resolveTable),
        (ref) => widgetIds[ref],
      ),
      [WIDGET_TAG_KEY]: { key: blueprint.key, widget_key: spec.key },
    };
    const widget = await createWidget({
      dashboard_id: dashboardId,
      widget_type: 'preset',
      preset_name: spec.preset_name,
      title: spec.title || spec.key,
      description: spec.description ?? null,
      icon: spec.icon || '🧩',
      config,
      position: spec.position || undefined,
      order_index: spec.order_index ?? 0,
      created_by: userId,
    }, { trx });
    widgetIds[spec.key] = widget.id;
    widgets.push({ key: spec.key, kind: 'tile', widget_id: widget.id, dashboard_id: dashboardId, action: 'created' });
  }

  const sidebar = [];
  for (const pin of pins) {
    const planned = plan.sidebar.find((entry) => entry.widget === pin.widget);
    const widgetId = widgetIds[pin.widget];
    const already = await trx.get('SELECT id FROM modules WHERE widget_id = ?', [widgetId]);
    if (already) {
      sidebar.push({ widget: pin.widget, widget_id: widgetId, module_id: already.id, action: 'existing' });
      continue;
    }
    if (planned.action === 'skip') continue;
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

  return { widgets, sidebar, dashboards };
}

/** Explicit opt-in only; never guess a legacy widget by title/preset. Recheck under row lock. */
async function loadWidgetAdoptions(get, blueprint, spaceId, raw, installed, lock = false) {
  const parsed = z.record(machineKey, z.number().int().positive()).safeParse(raw);
  if (!parsed.success) throw new BlueprintError('existingWidgets must map widget keys to positive integer IDs');
  const adopted = new Map();
  const ids = new Set();
  for (const [key, id] of Object.entries(parsed.data)) {
    const spec = surfaceSpecs(blueprint).find((widget) => widget.key === key);
    const row = blueprint.schema === 2
      ? await get(
        `SELECT w.id, w.dashboard_id, w.preset_name, w.widget_type, w.config,
                COALESCE(d.space_id, p.space_id, CASE WHEN w.owner_kind = 'space' THEN w.owner_id END) AS space_id
           FROM widgets w LEFT JOIN dashboards d ON d.id = w.dashboard_id
           LEFT JOIN projects p ON p.id = d.project_id WHERE w.id = ?${lock ? ' FOR UPDATE OF w' : ''}`,
        [id],
      )
      : await get(
        `SELECT w.id, w.dashboard_id, w.preset_name, w.widget_type, w.config,
                COALESCE(d.space_id, p.space_id) AS space_id
           FROM widgets w JOIN dashboards d ON d.id = w.dashboard_id
           LEFT JOIN projects p ON p.id = d.project_id WHERE w.id = ?${lock ? ' FOR UPDATE OF w' : ''}`,
        [id],
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
