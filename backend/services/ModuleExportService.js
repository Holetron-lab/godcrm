import { dbAll, dbGet, safeJsonParse } from '../database/connection.js';
import { ExportService } from './ExportService.js';
import { validateBlueprint } from './ModuleInstaller.js';
import { isRemoteMcp } from './connectors/catalogue/remote_mcp.js';
import { relationTargetId } from './module-blueprint/columnMapping.js';
import {
  COLUMN_REF_PATHS,
  mapConfigPaths,
  restoreConfigAppRefs,
  restoreConfigTableRefs,
} from './module-blueprint/configRefs.js';

const SECRET_KEY = /password|api.?key|secret|token|credential|private.?key|^__module$/i;

function slug(value, fallback) {
  const key = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return key || fallback;
}

function unique(value, used) {
  let candidate = value;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${value}_${suffix++}`;
  used.add(candidate);
  return candidate;
}

function cleanConfig(value) {
  if (Array.isArray(value)) return value.map(cleanConfig);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SECRET_KEY.test(key))
      .map(([key, item]) => [key, cleanConfig(item)]));
  }
  return value;
}

function cleanColumnConfig(column, tableById) {
  const config = safeJsonParse(column.config, {});
  if (column.type !== 'relation') return { target: null, config: Object.keys(config).length ? config : null };
  const target = tableById.get(Number(relationTargetId(config)));
  const relation = { ...(config.relation || {}) };
  delete relation.tableId;
  delete relation.table_id;
  delete relation.relatedTableId;
  delete config.relatedTableId;
  config.relation = relation;
  return { target: target?.key, config: Object.keys(config).length ? config : null };
}

function findTableKey(value, tableById) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTableKey(item, tableById);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const found = findTableKey(item, tableById);
      if (found) return found;
    }
    return null;
  }
  if ((typeof value === 'number' || typeof value === 'string') && value !== '') {
    return tableById.get(Number(value))?.key || null;
  }
  return null;
}

function findAppKey(value, appByWidgetId) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAppKey(item, appByWidgetId);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'app_widget_id' && appByWidgetId.has(Number(item))) return appByWidgetId.get(Number(item));
      const found = findAppKey(item, appByWidgetId);
      if (found) return found;
    }
  }
  return null;
}

function position(value) {
  const parsed = safeJsonParse(value, null);
  if (!parsed || !['x', 'y', 'w', 'h'].every((key) => Number.isInteger(parsed[key]))) return undefined;
  if (parsed.x < 0 || parsed.y < 0 || parsed.w < 1 || parsed.h < 1) return undefined;
  return (({ x, y, w, h }) => ({ x, y, w, h }))(parsed);
}

function sourceSpecs(installations) {
  const specs = new Map();
  for (const installation of installations) {
    const blueprint = safeJsonParse(installation.blueprint, {});
    const components = [
      ...(blueprint.apps || []),
      ...(blueprint.dashboards || []).flatMap((dashboard) => dashboard.tiles || []),
    ];
    for (const component of components) specs.set(`${blueprint.key}:${component.key}`, component);
  }
  return specs;
}

function naturalKey(table, rows, sensitive) {
  const candidates = table.sourceColumns.filter((column) => !sensitive.has(column.column_name));
  const preferred = ['slug', 'name', 'key', 'title'];
  const column = preferred.map((name) => candidates.find((candidate) => candidate.column_name === name)).find(Boolean)
    || candidates.find((candidate) => rows.every((row) => row.data[candidate.column_name] !== undefined && row.data[candidate.column_name] !== null));
  if (!column) return null;
  if (!rows.every((row) => row.data[column.column_name] !== undefined && row.data[column.column_name] !== null)) return null;
  return { source: column.column_name, target: column.blueprint_name };
}

async function buildSeed(tableById, seedIds) {
  const rowsByTable = new Map();
  const keys = new Map();
  const sensitiveByTable = new Map();
  for (const id of seedIds) {
    const table = tableById.get(id);
    const [rows, sensitive] = await Promise.all([
      dbAll('SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY id', [id]),
      ExportService.detectSensitiveColumns(id),
    ]);
    const parsedRows = rows.map((row) => ({ id: row.id, data: safeJsonParse(row.data, {}) }));
    const sensitiveNames = new Set(sensitive.columns.map((column) => column.name));
    rowsByTable.set(id, parsedRows);
    sensitiveByTable.set(id, sensitiveNames);
    keys.set(id, naturalKey(table, parsedRows, sensitiveNames));
  }

  const groups = [];
  for (const id of seedIds) {
    const table = tableById.get(id);
    const key = keys.get(id);
    if (!key) continue;
    const sensitive = sensitiveByTable.get(id);
    const rows = rowsByTable.get(id).map((sourceRow) => {
      const row = {};
      for (const column of table.sourceColumns) {
        if (sensitive.has(column.column_name)) continue;
        let value = sourceRow.data[column.column_name];
        if (column.type === 'relation' && value !== null && value !== undefined) {
          const targetId = Number(relationTargetId(safeJsonParse(column.config, {})));
          const targetKey = keys.get(targetId);
          const targetRow = rowsByTable.get(targetId)?.find((candidate) => Number(candidate.id) === Number(value));
          value = targetKey && targetRow ? targetRow.data[targetKey.source] : undefined;
        }
        if (value !== undefined) row[column.blueprint_name] = value;
      }
      return row;
    });
    groups.push({ table: table.key, key: [key.target], rows });
  }
  return groups;
}

function exportWidget(widget, kind, context) {
  const { tableById, appByWidgetId, specs, usedWidgetKeys } = context;
  const original = safeJsonParse(widget.config, {});
  const tag = original.__module;
  const declared = tag ? specs.get(`${tag.key}:${tag.widget_key}`) : null;
  const paths = declared?.columnRefPaths ?? COLUMN_REF_PATHS[widget.preset_name];
  const table = findTableKey(original, tableById);
  const tableInfo = table ? [...tableById.values()].find((candidate) => candidate.key === table) : null;
  const columnNames = new Map((tableInfo?.sourceColumns || []).map((column) => [column.column_name, column.blueprint_name]));
  let config = mapConfigPaths(original, paths, (source) => columnNames.get(source) || source);
  config = restoreConfigAppRefs(config, (value) => {
    if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null;
    return appByWidgetId.get(Number(value)) || null;
  });
  config = restoreConfigTableRefs(config, (value) => {
    if ((typeof value !== 'number' && typeof value !== 'string') || value === '') return null;
    return tableById.get(Number(value))?.key || null;
  });
  config = cleanConfig(config);

  const key = unique(slug(widget.title, `${widget.preset_name}_${widget.id}`), usedWidgetKeys);
  const app = findAppKey(original, appByWidgetId);
  const result = {
    key,
    preset: widget.preset_name,
    title: String(widget.title || key).slice(0, 255),
    description: widget.description || undefined,
    icon: widget.icon || undefined,
    config,
    position: position(widget.position),
    order_index: widget.order_index ?? 0,
  };
  if (declared?.columnRefPaths || paths) result.columnRefPaths = paths;
  if (kind === 'tile' && app) result.app = app;
  else if (table) result.table = table;
  if (kind === 'tile' && !result.app && !result.table) {
    throw Object.assign(new Error(`Tile "${widget.title}" has no exportable table or app reference`), { code: 'MODULE_EXPORT_UNSUPPORTED' });
  }
  return result;
}

async function exportFingerprint(spaceId, projects, options, wholeSpace = false) {
  const requiredIds = new Set((options.requiredTableIds || []).map(Number));
  const seedIds = (options.seedTableIds || []).map(Number);
  const [allTables, installations, widgets, modules, dashboards, connectors] = await Promise.all([
    dbAll(`SELECT t.*, p.space_id FROM universal_tables t JOIN projects p ON p.id = t.project_id
      WHERE p.space_id = ? ORDER BY p.created_at, p.id, t.created_at, t.id`, [spaceId]),
    dbAll('SELECT blueprint FROM module_installations WHERE space_id = ?', [spaceId]),
    dbAll(`SELECT w.*, d.space_id AS dashboard_space_id, p.space_id AS project_space_id
      FROM widgets w LEFT JOIN dashboards d ON d.id = w.dashboard_id
      LEFT JOIN projects p ON p.id = d.project_id
      WHERE (w.owner_kind = 'space' AND w.owner_id = ?) OR d.space_id = ? OR p.space_id = ?
      ORDER BY w.id`, [spaceId, spaceId, spaceId]),
    dbAll('SELECT * FROM modules WHERE space_id = ? ORDER BY is_pinned DESC, sidebar_order, id', [spaceId]),
    dbAll(`SELECT d.*, p.space_id AS project_space_id FROM dashboards d
      LEFT JOIN projects p ON p.id = d.project_id
      WHERE d.space_id = ? OR p.space_id = ? ORDER BY d.created_at, d.id`, [spaceId, spaceId]),
    dbAll(`SELECT id, type_slug, display_name, custom_definition FROM space_connectors
      WHERE space_id = ? AND status <> 'revoked' ORDER BY id`, [spaceId]),
  ]);
  const scopeProjectIds = new Set(projects.map((project) => Number(project.id)));
  const scopedTables = allTables.filter((table) => scopeProjectIds.has(Number(table.project_id)) || requiredIds.has(Number(table.id)));
  const tableIds = new Set(scopedTables.map((table) => Number(table.id)));
  for (const id of [...requiredIds, ...seedIds]) {
    if (!tableIds.has(id)) throw Object.assign(new Error('Export table selection is outside the source scope'), { code: 'MODULE_EXPORT_TABLE_SELECTION' });
  }

  const usedProjectKeys = new Set(['main']);
  const projectById = new Map(projects.map((project, index) => [Number(project.id), {
    key: index === 0 ? 'main' : unique(slug(project.name, `project_${index + 1}`), usedProjectKeys),
    title: project.name,
    description: project.description || undefined,
    icon: project.icon || undefined,
  }]));

  const usedTableKeys = new Set();
  const usedTableNames = new Set();
  const tableById = new Map();
  for (const table of scopedTables) {
    const key = unique(slug(table.display_name || table.name, `table_${table.id}`), usedTableKeys);
    tableById.set(Number(table.id), {
      key,
      name: unique(slug(table.name, key), usedTableNames),
      source: table,
      sourceColumns: [],
    });
  }

  for (const table of tableById.values()) {
    const columns = await dbAll('SELECT * FROM table_columns WHERE table_id = ? ORDER BY order_index, id', [table.source.id]);
    const usedColumns = new Set();
    table.sourceColumns = columns.map((column, index) => ({
      ...column,
      blueprint_name: unique(slug(column.column_name, `column_${index + 1}`), usedColumns),
    }));
    table.columns = table.sourceColumns.map((column, index) => {
      const relation = cleanColumnConfig(column, tableById);
      return {
        column_name: column.blueprint_name,
        display_name: column.display_name || column.column_name,
        type: column.type || 'text',
        ...(column.type === 'relation' && relation.target ? { target: relation.target } : {}),
        config: relation.config,
        order_index: column.order_index ?? index + 1,
        required: Boolean(column.is_required),
      };
    });
  }

  const specs = sourceSpecs(installations);
  const usedWidgetKeys = new Set();
  const appByWidgetId = new Map();
  const apps = [];
  const allTableById = new Map(allTables.map((table) => [Number(table.id), { key: 'source' }]));
  const scopedDashboards = dashboards.filter((dashboard) => wholeSpace || scopeProjectIds.has(Number(dashboard.project_id)));
  const scopedDashboardIds = new Set(scopedDashboards.map((dashboard) => Number(dashboard.id)));
  const scopedWidgets = widgets.filter((widget) => {
    if (scopedDashboardIds.has(Number(widget.dashboard_id))) return true;
    if (widget.dashboard_id !== null || Number(widget.owner_id) !== Number(spaceId)) return false;
    const config = safeJsonParse(widget.config, {});
    return wholeSpace || !findTableKey(config, allTableById) || Boolean(findTableKey(config, tableById));
  });
  const widgetsById = new Map(scopedWidgets.map((widget) => [Number(widget.id), widget]));
  for (const widget of scopedWidgets.filter((candidate) => candidate.dashboard_id === null)) {
    if (widget.widget_type !== 'preset') throw Object.assign(new Error('Custom widgets cannot be exported as blueprint presets'), { code: 'MODULE_EXPORT_UNSUPPORTED' });
    const app = exportWidget(widget, 'app', { tableById, appByWidgetId, specs, usedWidgetKeys });
    apps.push(app);
    appByWidgetId.set(Number(widget.id), app.key);
  }
  for (const module of modules) {
    if (appByWidgetId.has(Number(module.widget_id))) continue;
    const widget = widgetsById.get(Number(module.widget_id));
    if (!widget) continue;
    const app = exportWidget(widget, 'app', { tableById, appByWidgetId, specs, usedWidgetKeys });
    apps.push(app);
    appByWidgetId.set(Number(widget.id), app.key);
  }

  const usedDashboardKeys = new Set();
  const dashboardExports = scopedDashboards.map((dashboard) => {
    const isSpaceDefault = dashboard.space_id !== null && Boolean(dashboard.is_default);
    const key = unique(isSpaceDefault ? 'default' : slug(dashboard.name, 'main'), usedDashboardKeys);
    const tiles = widgets.filter((widget) => Number(widget.dashboard_id) === Number(dashboard.id)).map((widget) => {
      if (widget.widget_type !== 'preset') throw Object.assign(new Error('Custom widgets cannot be exported as blueprint presets'), { code: 'MODULE_EXPORT_UNSUPPORTED' });
      return exportWidget(widget, 'tile', { tableById, appByWidgetId, specs, usedWidgetKeys });
    });
    return {
      key,
      target: isSpaceDefault ? 'default' : 'new',
      ...(!isSpaceDefault && dashboard.project_id ? { project: projectById.get(Number(dashboard.project_id))?.key } : {}),
      title: dashboard.name,
      description: dashboard.description || undefined,
      icon: dashboard.icon || undefined,
      tiles,
    };
  });

  const sidebar = modules.map((module) => ({
    widget: appByWidgetId.get(Number(module.widget_id)),
    icon: module.sidebar_icon || undefined,
    order: module.sidebar_order ?? 0,
    access_level: module.access_level || 'member',
    is_pinned: Boolean(module.is_pinned),
  })).filter((entry) => entry.widget);
  const usedServiceKeys = new Set();
  const services = connectors.filter((connector) => isRemoteMcp(connector.type_slug)).map((connector, index) => {
    const definition = safeJsonParse(connector.custom_definition, {});
    const url = new URL(definition.url);
    if (url.username || url.password) throw Object.assign(new Error('Connector URLs must not contain credentials'), { code: 'MODULE_EXPORT_UNSAFE_URL' });
    for (const key of [...url.searchParams.keys()]) if (SECRET_KEY.test(key)) url.searchParams.delete(key);
    return {
      key: unique(slug(connector.display_name, `service_${index + 1}`), usedServiceKeys),
      type_slug: connector.type_slug,
      url: url.toString(),
      allowed_tools: definition.allowed_tools || [],
      secrets: ['BEARER_TOKEN'],
    };
  });

  const mainProject = projects[0];
  return validateBlueprint({
    key: options.key || `${slug(mainProject.name, 'module')}_export`,
    version: options.version || '1.0.0',
    schema: 2,
    title: options.title || mainProject.name,
    description: options.description || mainProject.description || undefined,
    icon: options.icon || mainProject.icon || undefined,
    projects: [...projectById.values()],
    requires: { tables: scopedTables.filter((table) => requiredIds.has(Number(table.id))).map((table) => {
      const exported = tableById.get(Number(table.id));
      return { key: exported.key, hint: table.description || table.display_name || table.name, columns: exported.columns };
    }) },
    tables: scopedTables.filter((table) => !requiredIds.has(Number(table.id))).map((table) => {
      const exported = tableById.get(Number(table.id));
      return {
        key: exported.key,
        project: projectById.get(Number(table.project_id))?.key || 'main',
        name: exported.name,
        display_name: table.display_name || table.name,
        icon: table.icon || null,
        table_type: table.table_type || null,
        columns: exported.columns,
      };
    }),
    seed: await buildSeed(tableById, seedIds),
    apps,
    dashboards: dashboardExports,
    sidebar,
    services,
    agents: [],
    automations: [],
  });
}

export async function exportProjectBlueprint(projectId, options = {}) {
  const project = await dbGet('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) throw Object.assign(new Error('Project not found'), { code: 'PROJECT_NOT_FOUND' });
  return exportFingerprint(Number(project.space_id), [project], options);
}

export async function exportSpaceBlueprint(spaceId, options = {}) {
  const space = await dbGet('SELECT id FROM spaces WHERE id = ?', [spaceId]);
  if (!space) throw Object.assign(new Error('Space not found'), { code: 'SPACE_NOT_FOUND' });
  const projects = await dbAll('SELECT * FROM projects WHERE space_id = ? ORDER BY created_at, id', [spaceId]);
  if (!projects.length) throw Object.assign(new Error('Space has no projects to export'), { code: 'MODULE_EXPORT_EMPTY' });
  return exportFingerprint(Number(spaceId), projects, options, true);
}
