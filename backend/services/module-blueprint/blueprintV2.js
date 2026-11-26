import { z } from 'zod';
import { VALID_COLUMN_TYPES } from '../ColumnService.js';
import { isValidPreset } from '../../widgets/presets.js';
import { collectTableRefs, isTableRef } from './configRefs.js';
import { isRemoteMcp } from '../connectors/catalogue/remote_mcp.js';
import { remoteMcpSchema } from '../connectors/remoteMcp.js';

const LIMITS = Object.freeze({
  projects: 25,
  tables: 25,
  columnsPerTable: 60,
  seedGroups: 25,
  seedRows: 500,
  widgets: 25,
  dashboards: 25,
  sidebar: 25,
  services: 25,
  agents: 25,
  automations: 25,
  media: 20,
});

const moduleKey = z.string().regex(/^[a-z][a-z0-9_-]*$/);
const machineKey = z.string().regex(/^[a-z][a-z0-9_]*$/);
const secretName = z.string().regex(/^[A-Z][A-Z0-9_]*$/);

const positionSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
}).strict();

const columnSchema = z.object({
  column_name: machineKey,
  display_name: z.string().max(255).optional(),
  type: z.enum(VALID_COLUMN_TYPES).optional(),
  target: machineKey.optional(),
  config: z.record(z.any()).nullable().optional(),
  order_index: z.number().int().min(0).optional(),
  required: z.boolean().optional(),
}).strict();

const projectSchema = z.object({
  key: machineKey,
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  icon: z.string().max(64).optional(),
}).strict();

const tableSchema = z.object({
  key: machineKey,
  project: machineKey.default('main'),
  name: machineKey,
  display_name: z.string().max(255).optional(),
  icon: z.string().max(64).nullable().optional(),
  table_type: z.string().max(64).nullable().optional(),
  columns: z.array(columnSchema).max(LIMITS.columnsPerTable).default([]),
}).strict();

const requiredTableSchema = z.object({
  key: machineKey,
  hint: z.string().max(2000).optional(),
  columns: z.array(columnSchema).max(LIMITS.columnsPerTable).default([]),
}).strict();

const seedGroupSchema = z.object({
  table: machineKey,
  key: z.array(machineKey).min(1),
  rows: z.array(z.record(z.any())).default([]),
}).strict();

const widgetFields = {
  key: machineKey,
  preset: z.string().min(1).max(64),
  title: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  icon: z.string().max(64).optional(),
  columnRefPaths: z.array(z.string().min(1).max(255)).max(100).optional(),
  config: z.record(z.any()).default({}),
  position: positionSchema.optional(),
  order_index: z.number().int().min(0).optional(),
};

const appSchema = z.object({
  ...widgetFields,
  table: machineKey.optional(),
}).strict();

const tileSchema = z.object({
  ...widgetFields,
  table: machineKey.optional(),
  app: machineKey.optional(),
}).strict().refine((tile) => Number(Boolean(tile.table)) + Number(Boolean(tile.app)) === 1, {
  message: 'tile must reference exactly one of table or app',
});

const dashboardSchema = z.object({
  key: machineKey,
  target: z.enum(['default', 'new']).default('default'),
  project: machineKey.optional(),
  title: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  icon: z.string().max(64).optional(),
  tiles: z.array(tileSchema).max(LIMITS.widgets).default([]),
}).strict();

const sidebarSchema = z.object({
  widget: machineKey,
  icon: z.string().max(64).optional(),
  order: z.number().int().min(0).optional(),
  access_level: z.enum(['owner', 'admin', 'member', 'viewer']).optional(),
  is_pinned: z.boolean().optional(),
}).strict();

const serviceSchema = z.object({
  key: machineKey,
  type_slug: z.string().min(1).max(64).refine((slug) => slug === 'remote_mcp' || isRemoteMcp(slug)),
  url: remoteMcpSchema.shape.url,
  allowed_tools: z.array(z.string().min(1).max(128)).max(100).default([]),
  secrets: z.array(secretName).max(1, 'remote MCP services support one bearer-token secret').default([]),
}).strict();

const configConsumerSchema = z.object({
  key: machineKey,
  table: machineKey.optional(),
  columnRefPaths: z.array(z.string().min(1).max(255)).max(100).optional(),
  config: z.record(z.any()).default({}),
}).passthrough();

const mediaItemSchema = z.object({
  type: z.enum(['image', 'video']),
  url: z.string().min(1).max(2000),
  title: z.string().max(255).optional(),
  thumbnail_url: z.string().min(1).max(2000).optional(),
  captions_url: z.string().min(1).max(2000).optional(),
}).strict();

const blueprintSchema = z.object({
  key: moduleKey,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  schema: z.literal(2),
  title: z.string().max(255).optional(),
  icon: z.string().max(64).optional(),
  description: z.string().max(2000).optional(),
  readme: z.string().max(100000).optional(),
  media: z.array(mediaItemSchema).max(LIMITS.media).optional(),
  projects: z.array(projectSchema).min(1).max(LIMITS.projects),
  requires: z.object({ tables: z.array(requiredTableSchema).max(LIMITS.tables).default([]) }).strict().default({ tables: [] }),
  tables: z.array(tableSchema).max(LIMITS.tables).default([]),
  seed: z.array(seedGroupSchema).max(LIMITS.seedGroups).default([]),
  apps: z.array(appSchema).max(LIMITS.widgets).default([]),
  dashboards: z.array(dashboardSchema).max(LIMITS.dashboards).default([]),
  sidebar: z.array(sidebarSchema).max(LIMITS.sidebar).default([]),
  services: z.array(serviceSchema).max(LIMITS.services).default([]),
  agents: z.array(configConsumerSchema).max(LIMITS.agents).default([]),
  automations: z.array(configConsumerSchema).max(LIMITS.automations).default([]),
}).strict();

function fail(message, code = 'BLUEPRINT_INVALID', details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function duplicate(values, kind) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(`duplicate ${kind} "${value}"`);
    seen.add(value);
  }
}

function validateColumns(table, tableKeys) {
  duplicate((table.columns || []).map((column) => column.column_name), `column in table "${table.key}"`);
  for (const column of table.columns || []) {
    if (column.target && (column.type || 'text') !== 'relation') {
      fail(`column "${column.column_name}" in table "${table.key}" declares a target but is not a relation`);
    }
    if (column.target && !tableKeys.has(column.target)) {
      fail(
        `relation column "${column.column_name}" in table "${table.key}" references table "${column.target}", which the blueprint does not declare`,
        'BLUEPRINT_UNKNOWN_TABLE_REF',
      );
    }
  }
}

function validateWidget(widget, tableKeys) {
  if (!isValidPreset(widget.preset)) {
    fail(`widget "${widget.key}" uses preset "${widget.preset}", which does not exist in this installation`, 'PRESET_NOT_FOUND');
  }
  if ('__module' in widget.config) {
    fail(`widget "${widget.key}" sets the reserved config key "__module"`, 'BLUEPRINT_RESERVED_KEY');
  }
  for (const ref of collectTableRefs(widget.config)) {
    if (!tableKeys.has(ref)) {
      fail(`widget "${widget.key}" references table "${ref}", which the blueprint does not declare`, 'BLUEPRINT_UNKNOWN_TABLE_REF');
    }
  }
  if (typeof widget.config.table === 'string' && tableKeys.has(widget.config.table)) {
    fail(`widget "${widget.key}" binds a table with the shorthand table; use table_id: { $table: "${widget.config.table}" }`, 'BLUEPRINT_RAW_TABLE_BINDING');
  }
  if (widget.config.table_id != null && !isTableRef(widget.config.table_id)) {
    fail(`widget "${widget.key}" hard-codes table_id; use table_id: { $table: "<table key>" }`, 'BLUEPRINT_RAW_TABLE_BINDING');
  }
}

export function parseBlueprintV2(raw) {
  const parsed = blueprintSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    fail(`blueprint is invalid: ${issues[0]}`, 'BLUEPRINT_INVALID', issues);
  }
  const blueprint = parsed.data;

  duplicate(blueprint.projects.map((project) => project.key), 'project key');
  if (!blueprint.projects.some((project) => project.key === 'main')) {
    fail('blueprint must declare project "main"');
  }
  const projectKeys = new Set(blueprint.projects.map((project) => project.key));
  const ownedKeys = blueprint.tables.map((table) => table.key);
  const requiredKeys = blueprint.requires.tables.map((table) => table.key);
  duplicate([...ownedKeys, ...requiredKeys], 'table key');
  duplicate(blueprint.tables.map((table) => table.name), 'table name');
  const tableKeys = new Set([...ownedKeys, ...requiredKeys]);

  for (const table of [...blueprint.tables, ...blueprint.requires.tables]) {
    validateColumns(table, tableKeys);
  }
  for (const table of blueprint.tables) {
    if (!projectKeys.has(table.project)) {
      fail(`table "${table.key}" references project "${table.project}", which the blueprint does not declare`);
    }
  }

  let seedRows = 0;
  for (const group of blueprint.seed) {
    if (!tableKeys.has(group.table)) {
      fail(`seed group targets table "${group.table}", which the blueprint does not declare`);
    }
    for (const row of group.rows) {
      for (const key of group.key) {
        if (!(key in row)) fail(`a seed row for "${group.table}" is missing natural-key column "${key}"`);
      }
    }
    seedRows += group.rows.length;
  }
  if (seedRows > LIMITS.seedRows) fail(`blueprint seeds ${seedRows} rows, over the limit of ${LIMITS.seedRows}`, 'BLUEPRINT_TOO_LARGE');

  const tiles = blueprint.dashboards.flatMap((dashboard) => dashboard.tiles);
  if (blueprint.apps.length + tiles.length > LIMITS.widgets) {
    fail(`blueprint declares ${blueprint.apps.length + tiles.length} widgets, over the limit of ${LIMITS.widgets}`, 'BLUEPRINT_TOO_LARGE');
  }
  duplicate(blueprint.apps.map((app) => app.key), 'app key');
  duplicate([...blueprint.apps, ...tiles].map((widget) => widget.key), 'widget key');
  duplicate(blueprint.dashboards.map((dashboard) => dashboard.key), 'dashboard key');
  const appKeys = new Set(blueprint.apps.map((app) => app.key));

  for (const app of blueprint.apps) {
    if (app.table && !tableKeys.has(app.table)) fail(`app "${app.key}" references table "${app.table}", which the blueprint does not declare`, 'BLUEPRINT_UNKNOWN_TABLE_REF');
    validateWidget(app, tableKeys);
  }
  for (const dashboard of blueprint.dashboards) {
    if (dashboard.project && !projectKeys.has(dashboard.project)) {
      fail(`dashboard "${dashboard.key}" references project "${dashboard.project}", which the blueprint does not declare`);
    }
    if (dashboard.target === 'default' && dashboard.project) {
      fail(`dashboard "${dashboard.key}" cannot target both default and project "${dashboard.project}"`);
    }
    for (const tile of dashboard.tiles) {
      if (tile.table && !tableKeys.has(tile.table)) fail(`tile "${tile.key}" references table "${tile.table}", which the blueprint does not declare`, 'BLUEPRINT_UNKNOWN_TABLE_REF');
      if (tile.app && !appKeys.has(tile.app)) fail(`tile "${tile.key}" references app "${tile.app}", which the blueprint does not declare`);
      validateWidget(tile, tableKeys);
    }
  }

  const pinned = new Set();
  for (const entry of blueprint.sidebar) {
    if (!appKeys.has(entry.widget)) fail(`sidebar entry points at app "${entry.widget}", which the blueprint does not declare`);
    if (pinned.has(entry.widget)) fail(`app "${entry.widget}" is pinned to the sidebar twice`);
    pinned.add(entry.widget);
  }
  duplicate(blueprint.services.map((service) => service.key), 'service key');
  for (const [section, consumers] of [['agent', blueprint.agents], ['automation', blueprint.automations]]) {
    duplicate(consumers.map((consumer) => consumer.key), `${section} key`);
    for (const consumer of consumers) {
      if (consumer.table && !tableKeys.has(consumer.table)) {
        fail(`${section} "${consumer.key}" references table "${consumer.table}", which the blueprint does not declare`, 'BLUEPRINT_UNKNOWN_TABLE_REF');
      }
    }
  }

  return blueprint;
}

function tableRef(config) {
  return [...collectTableRefs(config || {})][0] ?? null;
}

function normalizeWidget(widget) {
  return {
    key: widget.key,
    preset: widget.preset_name,
    table: tableRef(widget.config),
    title: widget.title,
    description: widget.description,
    icon: widget.icon,
    config: widget.config || {},
    position: widget.position,
    order_index: widget.order_index,
  };
}

export function normalizeBlueprint(blueprint) {
  if (blueprint.schema === 2) return blueprint;
  const widgets = blueprint.widgets || [];
  const tiles = widgets.filter((widget) => widget.dashboard === 'main').map(normalizeWidget);
  return {
    key: blueprint.key,
    version: blueprint.version,
    schema: 2,
    title: blueprint.title,
    icon: blueprint.icon,
    description: blueprint.description,
    readme: blueprint.readme,
    projects: [{ key: 'main', title: blueprint.title || blueprint.key }],
    requires: { tables: [] },
    tables: (blueprint.tables || []).map((table) => ({ ...table, project: 'main' })),
    seed: blueprint.seed || [],
    apps: widgets.filter((widget) => widget.dashboard !== 'main').map(normalizeWidget),
    dashboards: tiles.length ? [{ key: 'default', target: 'default', tiles }] : [],
    sidebar: blueprint.sidebar || [],
    services: [],
  };
}
