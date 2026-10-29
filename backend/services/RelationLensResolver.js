/**
 * RelationLensResolver — ADR-205 D3: server-side lookup map for relation ("lens") columns.
 *
 * A column with `config.relation.enabled` stores a KEY; the lens swaps it for a field of the
 * related row (`labelColumn`, plus `colorColumn` / `descriptionColumn` when set). This module
 * builds that map for one page of rows, for every lens column of the table regardless of its
 * type (SelectValueResolver only knows select/multi_select and only runs on write).
 *
 * Related-table storages (chosen by the related `universal_tables` row):
 *   - local `table_rows`            → `id IN (...)` or JSON field match on `data`
 *   - data source (internal, MySQL) → `queryRowsByKeys` (parameterized IN, chunked)
 *   - system / mail tables          → unsupported in this ADR, column skipped
 *
 * Keys come from the current page only, deduplicated per column, capped at
 * MAX_KEYS_PER_COLUMN (`truncated: true` above the cap). No cache (ADR-205 D3).
 */
import { dbAll, dbGet, safeJsonParse } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';
import { queryRowsByKeys } from './data-source/queries.js';

export const MAX_KEYS_PER_COLUMN = 1000;

const splitTrim = (s, sep) => s.split(sep).map((v) => v.trim()).filter(Boolean);

/**
 * Backend mirror of the frontend `parseValues` (cells/MultiSelectCell.tsx, cells/RelationCell.tsx).
 * Keep the two in sync: a JSON array always wins, then `storageFormat`, then auto-detect.
 * @param {unknown} value
 * @param {'json'|'comma'|'semicolon'|'newline'|'single'|undefined} storageFormat
 * @returns {string[]}
 */
export function splitRelationValue(value, storageFormat) {
  if (value === null || value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  const str = String(value);
  if (str.startsWith('[')) {
    const parsed = safeJsonParse(str);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v)).filter(Boolean);
  }
  switch (storageFormat) {
    case 'comma': return splitTrim(str, ',');
    case 'semicolon': return splitTrim(str, ';');
    case 'newline': return splitTrim(str, '\n');
    case 'single': return [str];
    default:
      if (str.includes(',')) return splitTrim(str, ',');
      if (str.includes(';')) return splitTrim(str, ';');
      if (str.includes('\n')) return splitTrim(str, '\n');
      return [str];
  }
}

/** Distinct keys of one column across the page, in first-seen order, capped. */
function collectKeys(rows, column) {
  const keys = new Set();
  let truncated = false;
  for (const row of rows) {
    const data = row?.data && typeof row.data === 'object' ? row.data : row;
    const raw = data?.[column.column_name] ?? data?.[String(column.id)];
    for (const key of splitRelationValue(raw, column.relation.storageFormat)) {
      if (keys.has(key)) continue;
      if (keys.size >= MAX_KEYS_PER_COLUMN) { truncated = true; break; }
      keys.add(key);
    }
    if (truncated) break;
  }
  return { keys: [...keys], truncated };
}

/**
 * A relation config field may name the related column (`name`) or carry its numeric id
 * (older configs / data-source tables). Resolve both forms so reads work on rows keyed
 * either way.
 */
function fieldRef(field, relatedColumns, fallback = 'id') {
  const name = field || fallback;
  const byName = relatedColumns.find((c) => c.column_name === name);
  if (byName) return { name, id: String(byName.id) };
  const byId = relatedColumns.find((c) => String(c.id) === name);
  if (byId) return { name: byId.column_name, id: name };
  return { name, id: null };
}

const pick = (data, ref) => data?.[ref.name] ?? (ref.id ? data?.[ref.id] : undefined);

/** Fetch related rows for `keys` → [{ key, data }] where `data` is the related row's fields. */
async function loadRelatedRows(table, relation, keys, refs) {
  if (table.data_source_id && table.source_table_name) {
    const keyColumn = refs.value.name === 'id' ? (table.source_id_column || 'id') : refs.value.name;
    const rows = await queryRowsByKeys(table.data_source_id, table.source_table_name, keyColumn, keys);
    return rows.map((row) => ({ key: String(row[keyColumn]), data: row }));
  }

  if (refs.value.name === 'id') {
    const ids = keys.map(Number).filter(Number.isInteger);
    if (!ids.length) return [];
    const rows = await dbAll(
      `SELECT id, data FROM table_rows WHERE table_id = ? AND id IN (${ids.map(() => '?').join(', ')})`,
      [table.id, ...ids]
    );
    return rows.map((row) => ({ key: String(row.id), data: safeJsonParse(row.data, {}) || {} }));
  }

  // Current rows key `data` by column name, older rows by column id — same COALESCE the
  // list controller uses for sorting.
  const rows = await dbAll(
    `SELECT id, data FROM table_rows WHERE table_id = ? AND COALESCE(data::jsonb->>?, data::jsonb->>?) IN (${keys.map(() => '?').join(', ')})`,
    [table.id, refs.value.name, refs.value.id ?? refs.value.name, ...keys]
  );
  return rows.map((row) => {
    const data = safeJsonParse(row.data, {}) || {};
    return { key: String(pick(data, refs.value)), data };
  });
}

/**
 * Build the lens map for one page of rows.
 *
 * @param {object} params
 * @param {number|string} params.tableId  parent table (the one whose rows are being served)
 * @param {Array<object>} params.rows     the page as the controller is about to send it
 * @param {object} [params.user]          req.user — a project-restricted API key cannot
 *                                        read a related table outside its project (`denied`)
 * @returns {Promise<{relations: object, relations_meta: object}>}
 *   relations[column_name][key] → { value, label, color?, description? }
 *   relations_meta[column_name] → { resolved, missing, truncated, unsupported?, denied?, error? }
 */
export async function attachRelationLens({ tableId, rows, user }) {
  const relations = {};
  const relations_meta = {};

  const columns = await dbAll('SELECT id, column_name, config FROM table_columns WHERE table_id = ?', [tableId]);
  const lensColumns = columns
    .map((col) => ({ ...col, relation: (safeJsonParse(col.config, {}) || {}).relation }))
    .filter((col) => col.relation?.enabled && (col.relation.tableId || col.relation.table_id));

  for (const column of lensColumns) {
    const name = column.column_name;
    const { keys, truncated } = collectKeys(rows, column);
    const map = {};
    const meta = { resolved: 0, missing: 0, truncated };
    relations[name] = map;
    relations_meta[name] = meta;
    if (!keys.length) continue;

    try {
      const relatedTableId = column.relation.tableId || column.relation.table_id;
      const table = await dbGet(
        'SELECT id, project_id, data_source_id, source_table_name, source_id_column, is_system, sync_target FROM universal_tables WHERE id = ?',
        [relatedTableId]
      );
      if (!table || (table.is_system && table.sync_target)) { meta.unsupported = true; continue; }
      // Same gate checkTableAccess applies to the parent: project-restricted keys stay in their project.
      if (user?.projectId && String(table.project_id) !== String(user.projectId)) { meta.denied = true; continue; }

      const relatedColumns = await dbAll('SELECT id, column_name FROM table_columns WHERE table_id = ?', [table.id]);
      const refs = {
        value: fieldRef(column.relation.valueColumn, relatedColumns, 'id'),
        label: fieldRef(column.relation.labelColumn, relatedColumns, 'name'),
        color: column.relation.colorColumn ? fieldRef(column.relation.colorColumn, relatedColumns) : null,
        description: column.relation.descriptionColumn ? fieldRef(column.relation.descriptionColumn, relatedColumns) : null,
      };

      for (const { key, data } of await loadRelatedRows(table, column.relation, keys, refs)) {
        const value = pick(data, refs.label);
        if (value === undefined || value === null) continue;
        const entry = { value, label: value };
        const color = refs.color ? pick(data, refs.color) : data?.color;
        if (color !== undefined && color !== null && color !== '') entry.color = color;
        const description = refs.description ? pick(data, refs.description) : undefined;
        if (description !== undefined && description !== null && description !== '') entry.description = description;
        map[key] = entry;
      }
      meta.resolved = keys.filter((k) => map[k]).length;
      meta.missing = keys.length - meta.resolved;
    } catch (err) {
      apiLogger.warn({ err, tableId, column: name }, 'Relation lens: related rows lookup failed');
      meta.error = true;
    }
  }

  return { relations, relations_meta };
}
