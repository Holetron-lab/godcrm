/**
 * Blueprint config references — ADR-200 W3.
 *
 * A blueprint must not carry `table_id`s: the whole point of a module being DATA is that the
 * same blueprint installs into any space, where the ids differ. So a widget's config names a
 * table by its BLUEPRINT KEY and the installer substitutes the real id at apply time:
 *
 *     config: { table_id: { $table: "schemes" } }   →   config: { table_id: 103027 }
 *
 * Why an explicit `{ $table }` sentinel rather than "the key `table` means a table":
 * a preset is free to have a config key called `table` that means something else, and a
 * convention cannot be verified. The sentinel makes the substitution total (any depth, inside
 * arrays, in any preset's config shape) and makes an unknown reference a REFUSAL at dry-run
 * instead of a widget quietly bound to nothing.
 *
 * ADR-200 §W3 correction: this is written here FIRST. The claim that ADR-192 §W4 already had
 * a widget-config remapper was wrong (`WidgetService:602-605` is `getWidgetData`, a read, and
 * `copy-tools.js` does not copy widgets at all). §W4 reuses `remapConfigTableRefs` with its own
 * resolver — the two domains differ only in what `resolve` maps:
 *
 *     install:  resolve = (key)   => mapping[key].table_id      // blueprint key → new id
 *     copy:     resolve = (oldId) => tableMap[oldId]            // old id       → new id
 */

export const TABLE_REF_KEY = '$table';
export const APP_REF_KEY = '$app';

/** A reference is the single-key object `{ $table: "<name>" }` — nothing else. */
export function isTableRef(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value[TABLE_REF_KEY] === 'string'
    && Object.keys(value).length === 1;
}

/**
 * Every table reference a config mentions, at any depth. Used by the blueprint validator to
 * refuse a widget that points at a table the blueprint never declares — before anything is
 * planned, let alone written.
 * @returns {Set<string>}
 */
export function collectTableRefs(value, found = new Set()) {
  if (isTableRef(value)) {
    found.add(value[TABLE_REF_KEY]);
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTableRefs(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectTableRefs(item, found);
  }
  return found;
}

/**
 * Return a copy of `config` with every `{ $table: k }` replaced by `resolve(k)`. The input is
 * never mutated — the blueprint is stored verbatim in `module_installations` and must survive
 * an install unchanged, so that `uninstall` can still read what was actually declared.
 *
 * @param {*} value - config (or any nested fragment)
 * @param {(ref: string) => *} resolve - blueprint key → concrete value (usually a table id)
 * @throws {Error} when `resolve` yields null/undefined — callers validate refs first, so this
 *   firing means the mapping and the blueprint disagree, which must never be papered over.
 */
export function remapConfigTableRefs(value, resolve) {
  if (isTableRef(value)) {
    const ref = value[TABLE_REF_KEY];
    const resolved = resolve(ref);
    if (resolved === undefined || resolved === null) {
      throw new Error(`unresolved table reference "${ref}" — no id for this blueprint key`);
    }
    return resolved;
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapConfigTableRefs(item, resolve));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = remapConfigTableRefs(item, resolve);
    }
    return out;
  }
  return value;
}

function restoreConfigRefs(value, sentinel, resolve) {
  const ref = resolve(value);
  if (ref !== undefined && ref !== null) return { [sentinel]: ref };
  if (Array.isArray(value)) return value.map((item) => restoreConfigRefs(item, sentinel, resolve));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(
      ([key, item]) => [key, restoreConfigRefs(item, sentinel, resolve)],
    ));
  }
  return value;
}

export function restoreConfigTableRefs(value, resolve) {
  return restoreConfigRefs(value, TABLE_REF_KEY, resolve);
}

export function restoreConfigAppRefs(value, resolve) {
  return restoreConfigRefs(value, APP_REF_KEY, resolve);
}

const COMMON_COLUMN_REF_PATHS = [
  'column', 'filter.column', 'filters[].column', 'group_by', 'group_by_column',
  'sort', 'sort.column', 'sort_by', 'visible_columns[]', 'hidden_columns[]', 'editable_columns[]',
];

export const COLUMN_REF_PATHS = Object.freeze({
  number_widget: COMMON_COLUMN_REF_PATHS,
  chart_widget: [...COMMON_COLUMN_REF_PATHS, 'x_column', 'y_column'],
  kanban_board: [
    ...COMMON_COLUMN_REF_PATHS,
    'statusColumn', 'titleColumn', 'descriptionColumn', 'card_title_column', 'card_subtitle_column',
    'card_columns[]', 'emojiColumn', 'assigneeColumn',
    'kanban.statusColumn', 'kanban.titleColumn', 'kanban.descriptionColumn', 'kanban.colorColumn',
    'kanban.assigneeColumn', 'kanban.scheduledDateColumn', 'kanban.dueDateColumn', 'kanban.emojiColumn',
    'kanban.cardColumns[]', 'kanban.visibleColumns[]',
  ],
  quick_links: [],
  table_view: COMMON_COLUMN_REF_PATHS,
});

function remapConfigPath(config, declaration, resolve) {
  const parts = declaration.split('.');
  function walk(node, index, path) {
    if (!node || typeof node !== 'object') return;
    const array = parts[index].endsWith('[]');
    const key = array ? parts[index].slice(0, -2) : parts[index];
    const value = node[key];
    const nextPath = path ? `${path}.${key}` : key;
    if (array) {
      if (!Array.isArray(value)) return;
      value.forEach((item, itemIndex) => {
        const itemPath = `${nextPath}[${itemIndex}]`;
        if (index === parts.length - 1) {
          if (typeof item === 'string') value[itemIndex] = resolve(item, itemPath);
        } else {
          walk(item, index + 1, itemPath);
        }
      });
      return;
    }
    if (index === parts.length - 1) {
      if (typeof value === 'string') node[key] = resolve(value, nextPath);
      return;
    }
    walk(value, index + 1, nextPath);
  }
  walk(config, 0, '');
}

export function mapConfigPaths(config, paths, resolve) {
  const mapped = structuredClone(config || {});
  for (const path of paths || []) remapConfigPath(mapped, path, resolve);
  return mapped;
}

function componentTable(component) {
  if (component.table) return component.table;
  return [...collectTableRefs(component.config || {})][0] || null;
}

/**
 * Apply planned table-column bindings to every declarative config consumer. The input blueprint
 * remains verbatim for persistence; only the returned copy is used for planning and installation.
 */
export function remapBlueprintColumnRefs(blueprint, tables) {
  const conflicts = [];
  const plannedByKey = new Map(tables.map((table) => [table.key, table]));

  function remapComponent(component, section) {
    const defaultTable = componentTable(component);
    if (!defaultTable) return component;
    const defaultPlan = plannedByKey.get(defaultTable);
    const preset = component.preset || component.preset_name;
    const declaredPaths = component.columnRefPaths ?? (preset ? COLUMN_REF_PATHS[preset] : []);
    const referenceRoot = `${section}.${component.key}`;

    if (defaultPlan?.action === 'connect' && preset && declaredPaths === undefined) {
      conflicts.push({
        kind: 'PRESET_COLUMN_MAPPING_UNSUPPORTED', table: defaultTable, preset,
        referenced_by: [referenceRoot], blocking: true,
      });
      return component;
    }

    const config = structuredClone(component.config || {});
    for (const path of declaredPaths || []) {
      const table = [...plannedByKey.keys()]
        .filter((key) => path.startsWith(`${key}_`))
        .sort((left, right) => right.length - left.length)[0] || defaultTable;
      const planned = plannedByKey.get(table);
      remapConfigPath(config, path, (source, referencedPath) => {
        const referencedBy = [`${referenceRoot}.config.${referencedPath}`];
        if (!planned) {
          conflicts.push({ kind: 'COLUMN_REF_TABLE_UNRESOLVED', table, column: source, referenced_by: referencedBy, blocking: true });
          return source;
        }
        if (planned.action !== 'connect') return source;
        const mapping = (planned.columns || []).find((column) => column.module_column === source);
        if (!mapping) {
          conflicts.push({ kind: 'COLUMN_REF_UNKNOWN', table, column: source, referenced_by: referencedBy, blocking: true });
          return source;
        }
        if (mapping.target === null) {
          conflicts.push({ kind: 'COLUMN_REF_UNMAPPED', table, column: source, referenced_by: referencedBy, blocking: true });
          return source;
        }
        return mapping.target === '__new' ? source : mapping.target;
      });
    }
    return { ...component, config };
  }

  const remapSection = (components, section) => (components || []).map((component) => remapComponent(component, section));
  const remapped = {
    ...blueprint,
    widgets: remapSection(blueprint.widgets, 'widgets'),
    apps: remapSection(blueprint.apps, 'apps'),
    agents: remapSection(blueprint.agents, 'agents'),
    automations: remapSection(blueprint.automations, 'automations'),
  };
  if (blueprint.dashboards) {
    remapped.dashboards = blueprint.dashboards.map((dashboard) => ({
      ...dashboard,
      tiles: remapSection(dashboard.tiles, 'tiles'),
    }));
  }
  return { blueprint: remapped, conflicts };
}
