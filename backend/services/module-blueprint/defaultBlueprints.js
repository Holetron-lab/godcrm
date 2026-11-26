import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAMED_PACK_BLUEPRINTS } from './namedPackBlueprints.js';

const presetsPath = join(dirname(fileURLToPath(import.meta.url)), '../../../shared/widget-presets.json');
const CORE_PRESETS = JSON.parse(readFileSync(presetsPath, 'utf8'));

const RELATION_TARGETS = {
  'wellness.sets.workout_id': 'workouts',
  'documents.documents.parent_id': 'documents',
  'documents.atoms.document_id': 'documents',
  'kanban_board.ticket_events.ticket_id': 'data',
};

const COLUMN_ALIASES = {
  start_date: ['started_at', 'start_date', 'date'],
  end_date: ['ended_at', 'end_date'],
  date: ['recorded_at', 'date', 'created_at'],
  title: ['title', 'name', 'what'],
  name: ['name', 'title'],
  status: ['status', 'state'],
  parent: ['parent_id'],
  document: ['document_id'],
  workout: ['workout_id'],
  table_id: ['table_id'],
  type: ['vital_type', 'type'],
  muscle: ['primary_muscle'],
  completed: ['completed', 'is_completed'],
  image: ['image', 'cover_image'],
  group_by: ['group_by', 'category'],
};

function snakeCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function selectConfig(column) {
  const config = { ...(column.config || {}) };
  if (column.icon) config.icon = column.icon;
  if (column.options) {
    config.options = column.options.map((option) => (
      typeof option === 'object' ? option : { value: option, label: option }
    ));
  }
  return Object.keys(config).length ? config : null;
}

function matchDefaultColumn(required, columns) {
  const base = snakeCase(required.key.replace(/Column$/, ''));
  const candidates = [base, ...(COLUMN_ALIASES[base] || [])];
  for (const candidate of candidates) {
    const exact = columns.find((column) => column.name === candidate);
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const partial = columns.find((column) => column.name.includes(candidate));
    if (partial) return partial;
  }
  return null;
}

function derivedColumn(required, order) {
  return {
    column_name: snakeCase(required.name),
    display_name: required.name,
    type: required.types[0] || 'text',
    required: required.required === true,
    config: null,
    order_index: order,
  };
}

function convertTable(preset, table) {
  const defaults = table.defaultColumns || [];
  const columns = defaults.map((column, index) => ({
    column_name: column.name,
    display_name: column.displayName || column.name,
    type: column.type,
    required: column.required === true,
    ...(RELATION_TARGETS[`${preset.id}.${table.key}.${column.name}`]
      ? { target: RELATION_TARGETS[`${preset.id}.${table.key}.${column.name}`] }
      : {}),
    config: selectConfig(column),
    order_index: index,
  }));
  const mapping = {};

  for (const required of table.requiredColumns || []) {
    const matched = matchDefaultColumn(required, defaults);
    if (matched) {
      mapping[required.key] = matched.name;
      continue;
    }
    const existing = columns.find((column) => column.column_name === snakeCase(required.name));
    const column = existing || derivedColumn(required, columns.length);
    if (!existing) columns.push(column);
    mapping[required.key] = column.column_name;
  }

  for (const row of table.seedRows || []) {
    for (const [key, value] of Object.entries(row)) {
      const column = columns.find((entry) => entry.column_name === key && entry.type === 'select');
      if (!column || value === null || value === undefined) continue;
      const options = [...(column.config?.options || [])];
      if (!options.some((option) => option.value === value || option.label === value)) {
        options.push({ value, label: String(value) });
      }
      column.config = { ...column.config, options };
    }
  }

  const name = table.tableType || snakeCase(table.defaultTableName || `${preset.id}_${table.key}`);
  return {
    blueprint: {
      key: table.key,
      project: 'main',
      name,
      display_name: table.defaultTableName || table.name,
      icon: table.icon || preset.emoji,
      table_type: table.tableType || null,
      columns,
    },
    mapping,
    seed: table.seedRows?.length ? {
      table: table.key,
      key: [table.seedRows.every((row) => row.name !== undefined) ? 'name' : columns[0].column_name],
      rows: table.seedRows,
    } : null,
  };
}

function addAlias(config, paths, key, value) {
  if (value === undefined) return;
  config[key] = value;
  paths.push(key);
}

function convertApp(preset, tables, converted) {
  if (!tables.length) return {
    key: 'app',
    preset: preset.id,
    title: preset.name,
    description: preset.description,
    icon: preset.emoji,
    config: {},
    columnRefPaths: [],
    position: { x: 0, y: 0, ...preset.defaultSize },
  };
  const primary = tables[0];
  const single = tables.length === 1;
  const config = Object.fromEntries(tables.map((table) => [`${table.key}_table_id`, { $table: table.key }]));
  const columnRefPaths = [];
  const value = (tableKey, requiredKey) => converted[tableKey]?.mapping[requiredKey];

  for (const table of tables) {
    for (const required of table.requiredColumns || []) {
      config[`${table.key}_${required.key}`] = value(table.key, required.key);
      columnRefPaths.push(`${table.key}_${required.key}`);
      if (single) {
        config[required.key] = value(table.key, required.key);
        columnRefPaths.push(required.key);
      }
    }
  }

  if (preset.id === 'kanban_board') {
    addAlias(config, columnRefPaths, 'statusColumn', value('data', 'statusColumn'));
    addAlias(config, columnRefPaths, 'titleColumn', value('data', 'titleColumn'));
    addAlias(config, columnRefPaths, 'descriptionColumn', value('data', 'descriptionColumn'));
    addAlias(config, columnRefPaths, 'assigneeColumn', value('data', 'assigneeColumn'));
    addAlias(config, columnRefPaths, 'card_title_column', value('data', 'titleColumn'));
    addAlias(config, columnRefPaths, 'group_by', value('data', 'statusColumn'));
    addAlias(config, columnRefPaths, 'group_by_column', value('data', 'statusColumn'));
    config.kanban = {
      tableId: { $table: 'data' },
      eventsTableId: { $table: 'ticket_events' },
      statusColumn: value('data', 'statusColumn'),
      titleColumn: value('data', 'titleColumn'),
      descriptionColumn: value('data', 'descriptionColumn'),
      assigneeColumn: value('data', 'assigneeColumn'),
      lanes: [],
    };
    columnRefPaths.push('kanban.statusColumn', 'kanban.titleColumn', 'kanban.descriptionColumn', 'kanban.assigneeColumn');
  }
  if (preset.id === 'calendar_widget') {
    addAlias(config, columnRefPaths, 'x_column', value('events', 'dateColumn'));
    addAlias(config, columnRefPaths, 'card_title_column', value('events', 'titleColumn'));
    config.calendar = {
      tableId: { $table: 'events' },
      dateColumn: value('events', 'dateColumn'),
      endDateColumn: value('events', 'endDateColumn'),
      titleColumn: value('events', 'titleColumn'),
    };
    columnRefPaths.push('calendar.dateColumn', 'calendar.endDateColumn', 'calendar.titleColumn');
  }
  if (preset.id === 'timeline_widget') {
    config.timeline = {
      tableId: { $table: 'events' },
      startDateColumn: value('events', 'startDateColumn'),
      endDateColumn: value('events', 'endDateColumn'),
      titleColumn: value('events', 'titleColumn'),
      groupByColumn: value('events', 'groupByColumn'),
    };
    columnRefPaths.push('timeline.startDateColumn', 'timeline.endDateColumn', 'timeline.titleColumn', 'timeline.groupByColumn');
  }
  if (preset.id === 'number_widget') {
    config.aggregate = 'sum';
    addAlias(config, columnRefPaths, 'column', value('data', 'valueColumn'));
  }
  if (preset.id === 'chart_widget') {
    addAlias(config, columnRefPaths, 'x_column', value('data', 'xColumn'));
    addAlias(config, columnRefPaths, 'y_column', value('data', 'yColumn'));
  }
  if (preset.id === 'gallery_widget') {
    addAlias(config, columnRefPaths, 'coverColumn', value('images', 'imageColumn'));
  }
  if (preset.id === 'task_list') {
    addAlias(config, columnRefPaths, 'card_title_column', value('tasks', 'titleColumn'));
    addAlias(config, columnRefPaths, 'completed_column', value('tasks', 'completedColumn'));
  }
  if (preset.id === 'documents') {
    config.registry_table_id = { $table: 'documents' };
    config.atoms_table_id = { $table: 'atoms' };
  }
  if (preset.id === 'labs') config.labs_table_id = { $table: 'labs' };

  return {
    key: 'app',
    preset: preset.id,
    title: preset.name,
    description: preset.description,
    icon: preset.emoji,
    table: primary.key,
    config,
    columnRefPaths: [...new Set(columnRefPaths)],
    position: { x: 0, y: 0, ...preset.defaultSize },
  };
}

export function presetToBlueprintV2(preset) {
  const included = (preset.tables || []).filter((table) => table.required || table.canCreate);
  const converted = Object.fromEntries(included.map((table) => [table.key, convertTable(preset, table)]));
  const owned = included.filter((table) => table.canCreate);
  const required = included.filter((table) => !table.canCreate);
  const app = convertApp(preset, included, converted);

  return {
    key: `preset_${preset.id}`,
    version: '2.0.0',
    schema: 2,
    title: preset.name,
    icon: preset.emoji,
    description: preset.description,
    projects: [{ key: 'main', title: preset.name }],
    requires: { tables: required.map((table) => ({
      key: table.key,
      hint: table.description,
      columns: converted[table.key].blueprint.columns,
    })) },
    tables: owned.map((table) => converted[table.key].blueprint),
    seed: owned.map((table) => converted[table.key].seed).filter(Boolean),
    apps: [app],
    dashboards: [],
    sidebar: [{ widget: 'app', icon: preset.emoji, is_pinned: true }],
    services: [],
    agents: [],
    automations: [],
  };
}

export function getDefaultModuleBlueprints() {
  return structuredClone([
    ...Object.values(CORE_PRESETS).map((preset) => presetToBlueprintV2(preset)),
    ...NAMED_PACK_BLUEPRINTS,
  ]);
}
