/**
 * Public form submission — the server-side half of the "custom form" link
 * (`/forms/:tableId`, chat 3660).
 *
 * The form config (`system_form_configs.config`, form_type = 'custom') is the
 * contract: the client may only set what the config exposes. Everything else
 * — hidden fields, read-only fields, columns outside the form — is filled from
 * the field's `defaultValue` on the server, never from the request body.
 *
 * Access (`config.settings.access`) uses the same three levels as space
 * visibility (ADR-105, SpaceVisibilityService), fail-closed:
 *   - 'internal' (default): signed-in caller with at least viewer access to
 *     the table ("only those with access to the table").
 *   - 'open': any signed-in GOD CRM user.
 *   - 'external': anyone with the link.
 *
 * URL prefill (`field.urlParam`): a hidden field is normally server-filled;
 * with `urlParam: true` the owner explicitly allows the link to carry its
 * value (`?<column_name>=…`), so the submitted value is accepted for it too.
 */

import { randomUUID } from 'crypto';
import { dbAll, dbGet, dbRun, sqlNow } from '../../database/connection.js';
import { generateBaseId } from '../../utils/baseId.js';
import { apiLogger } from '../../utils/logger.js';
import { normalizeTypedCells, NORMALIZED_CELL_TYPES } from '../cellNormalizers.js';
import { guardRowKeys } from '../row-schema-guard.js';
import { resolveSelectValues } from '../SelectValueResolver.js';
import { fireRowCreateTriggers } from '../AutomationTriggerService.js';
import { resolveUserRoleForTable } from '../../routes/v3/tables/helpers.js';
import { canAccessSpace, canAccessProject, canAccessTable } from '../SpaceService.js';
import { getEffectiveRole, ACCESS_LEVEL_VALUES } from '../EffectiveRoleService.js';

export const FORM_ACCESS_VALUES = ['internal', 'open', 'external'];

/** Unknown or missing values fall back to the most restrictive level. */
export function resolveFormAccess(config) {
  const v = config?.settings?.access;
  return FORM_ACCESS_VALUES.includes(v) ? v : 'internal';
}

export function isFormField(item) {
  return !!item && (item.type === undefined || item.type === 'field');
}

/**
 * Fields the client is allowed to submit a value for: visible, not read-only,
 * or hidden-but-allowed-from-URL.
 */
export function isClientWritable(field) {
  if (field.readonly) return false;
  if (field.hidden) return field.urlParam === true;
  return true;
}

function isEmpty(v) {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

/**
 * Resolve a field default on the server. Supported placeholders mirror the
 * column default picker: {{now}}, {{uuid}}, {{user}}; `{{<column_name>}}`
 * copies another submitted value. Unknown placeholders resolve to undefined
 * (the key is simply not written).
 */
export function resolveDefault(defaultValue, { now, userId, byName }) {
  if (typeof defaultValue !== 'string') return defaultValue;
  const m = /^\{\{(\w+)\}\}$/.exec(defaultValue.trim());
  if (!m) return defaultValue;
  switch (m[1]) {
    case 'now': return now.toISOString();
    case 'uuid': return randomUUID();
    case 'user': return userId ?? null;
    default: return byName[m[1]];
  }
}

/**
 * Pure: build the row `data` (keyed by column id, as the grid writes it) from
 * the form config + the untrusted client input.
 *
 * @returns {{ data: object, missing: string[] }} missing = names of required
 *   fields the client left empty (400 upstream).
 */
export function buildSubmissionData({ config, columns, input, userId, now = new Date() }) {
  const byId = new Map(columns.map((c) => [String(c.id), c]));
  const byName = new Map(columns.map((c) => [c.column_name, c]));
  const body = input && typeof input === 'object' ? input : {};

  // Client values keyed by column id; accept either id or column name as key.
  const clientByName = {};
  const clientById = {};
  for (const [key, value] of Object.entries(body)) {
    const col = byId.get(String(key)) || byName.get(key);
    if (!col) continue;
    clientById[String(col.id)] = value;
    clientByName[col.column_name] = value;
  }

  const data = {};
  const missing = [];
  const ctx = { now, userId, byName: clientByName };

  for (const field of (config?.fields || []).filter(isFormField)) {
    const col = byId.get(String(field.columnId));
    if (!col) continue;
    const id = String(col.id);

    let value;
    if (isClientWritable(field) && clientById[id] !== undefined) {
      value = clientById[id];
    } else {
      value = resolveDefault(field.defaultValue, ctx);
    }

    if (field.required && isClientWritable(field) && isEmpty(value)) {
      missing.push(col.column_name);
    }
    if (value !== undefined) data[id] = value;
  }

  return { data, missing };
}

/** All columns of the table (submission needs the hidden ones for defaults). */
export async function loadTableColumns(tableId) {
  return dbAll(
    `SELECT id, table_id, column_name, display_name, type, config, options, order_index, is_required, is_readonly
       FROM table_columns WHERE table_id = ? ORDER BY order_index, id`,
    [tableId]
  );
}

/** Pure: columns the client renders — form fields that are visible or URL-allowed. */
export function clientFacingColumns(columns, config) {
  const wanted = new Map(
    (config?.fields || []).filter(isFormField).map((f) => [String(f.columnId), f])
  );
  return columns.filter((c) => {
    const f = wanted.get(String(c.id));
    return f && (!f.hidden || f.urlParam === true);
  });
}

/** Public projection of a column — enough for FieldRenderer, no secrets. */
export function projectFormColumn(col) {
  let cfg = col.config;
  if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg || '{}'); } catch { cfg = {}; } }
  cfg = cfg || {};
  const config = {};
  if (Array.isArray(cfg.options)) config.options = cfg.options;
  else if (col.options) { try { const o = JSON.parse(col.options); if (Array.isArray(o)) config.options = o; } catch { /* ignore */ } }
  if (cfg.relation?.enabled) config.relation = cfg.relation;
  if (cfg.cellFormat !== undefined) config.cellFormat = cfg.cellFormat;
  return {
    id: col.id,
    table_id: col.table_id,
    column_name: col.column_name,
    display_name: col.display_name || col.column_name,
    type: col.type,
    config,
    order_index: col.order_index ?? 0,
    is_required: !!col.is_required,
    is_readonly: !!col.is_readonly,
  };
}

/** Strip owner-only bits before the config leaves the server. */
export function projectFormConfig(config) {
  const s = config?.settings || {};
  return {
    version: config?.version ?? 1,
    layout: config?.layout || 'grid',
    columns: config?.columns ?? 2,
    pages: config?.pages ?? 1,
    fields: (config?.fields || []).filter(isFormField).map((f) => {
      const { defaultValue, ...rest } = f;
      // A hidden field's default is server business; a visible one is the
      // initial value the user sees.
      return f.hidden ? rest : { ...rest, defaultValue };
    }),
    elements: config?.elements || [],
    settings: {
      showLabels: s.showLabels !== false,
      viewMode: s.viewMode || 'standard',
      labelPosition: s.labelPosition || 'top',
      spacing: s.spacing || 'normal',
      submitButtonText: s.submitButtonText,
      access: resolveFormAccess(config),
    },
  };
}

/** The published ('custom') form of a table, or null. */
export async function loadPublishedForm(tableId) {
  const row = await dbGet(
    `SELECT id, table_id, config FROM system_form_configs
      WHERE table_id = ? AND form_type = 'custom' ORDER BY is_default DESC, id DESC LIMIT 1`,
    [tableId]
  );
  if (!row) return null;
  let config;
  try { config = JSON.parse(row.config || '{}'); } catch { config = {}; }
  return { id: row.id, tableId: row.table_id, config };
}

/**
 * Viewer-or-above check for an 'internal' form. Mirrors the read gate of
 * tableSummaryController (space access_control + user_access_permissions;
 * an 'open' space already grants viewer to any signed-in user there).
 */
export async function userCanReadTable(user, table) {
  if (!user?.id) return false;
  if (user.role === 'admin' || user.role === 'owner') return true;
  let { userRole, userAccessData } = await resolveUserRoleForTable(user.id, table);
  if (userAccessData && (!canAccessSpace(userAccessData, table.space_id)
    || !canAccessProject(userAccessData, table.project_id) || !canAccessTable(userAccessData, table.id))) {
    return false;
  }
  const effective = await getEffectiveRole(user.id, { tableId: table.id });
  if (effective.effectiveRole === 'denied' && effective.source !== 'none') return false;
  if (!userRole) userRole = effective.effectiveRole;
  return (ACCESS_LEVEL_VALUES[userRole] ?? 0) >= ACCESS_LEVEL_VALUES.viewer;
}

/** Insert the built row the same way POST /tables/:id/rows does for local tables. */
export async function insertFormRow(tableId, data, userId) {
  const guard = await guardRowKeys(tableId, data);
  const { resolvedData: selectResolved, errors } = await resolveSelectValues(tableId, guard.data);
  if (errors.length > 0) {
    const err = new Error(`Invalid select values: ${errors.join('; ')}`);
    err.status = 400;
    throw err;
  }
  // ADR-0035 / ADR-0035-A: geo_point + address cells — same normalizer as POST /rows.
  const typedColumns = await dbAll(
    `SELECT id, column_name, type FROM table_columns WHERE table_id = ? AND type IN (${NORMALIZED_CELL_TYPES.map(() => '?').join(', ')})`,
    [tableId, ...NORMALIZED_CELL_TYPES]
  );
  const typed = normalizeTypedCells(typedColumns, selectResolved);
  if (!typed.ok) throw Object.assign(new Error(typed.message), { status: 400, code: typed.code });
  const resolvedData = typed.data;
  const base_id = generateBaseId();
  const result = await dbRun(
    `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
    [tableId, base_id, JSON.stringify(resolvedData), userId ?? null]
  );
  const rowId = result.lastInsertRowid;
  fireRowCreateTriggers(Number(tableId), rowId, resolvedData).catch((err) => {
    apiLogger.warn({ err, tableId, rowId }, 'Public form: row create trigger failed (non-blocking)');
  });
  return { id: rowId, base_id };
}
