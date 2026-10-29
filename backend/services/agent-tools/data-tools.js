/**
 * Data / Table Tool Handlers
 *
 * Handles: get_workspace_info, query_table_data, get_table_schema,
 *          create_table, get_table_row, add_table_row, list_tables,
 *          analyze_table_data
 */

import { dbGet, dbRun, dbAll, isPostgres, sqlNow, toBool, withTransactionAsync } from '../../database/connection.js';
import { z } from 'zod';
import { tableKeySchema } from '../../utils/tableKeySchema.js';
import { VALID_COLUMN_TYPES, persistColumnType } from '../ColumnService.js';
import { generateBaseId } from '../../utils/baseId.js';
import { resolveSelectValues, validateAllColumns } from '../SelectValueResolver.js';
import { guardRowKeys, unknownKeysMessage } from '../row-schema-guard.js';
import { mergeRowData } from '../mergeRowData.js';
import { normalizeTypedCells } from '../cellNormalizers.js';
import { applyAtomVersioning, isAtomsV2Table } from '../atoms-archive.js';
import { coerceDataObject } from './coerceDataInput.js';
import { fireRowCreateTriggers, fireRowUpdateTriggers } from '../AutomationTriggerService.js';
import { notifyRowChange } from '../realtime/rowEvents.js';

/** ADR-0035-A: typed-cell normalizer over the table's columns (create path has no column list yet). */
async function normalizeTypedCellsForTable(tableId, data) {
  const columns = await dbAll('SELECT id, column_name, type FROM table_columns WHERE table_id = ?', [tableId]);
  return normalizeTypedCells(columns, data);
}

/** Tool-result shape for a failed typed-cell normalization — mirrors `validateAllColumns` rejections. */
function typedCellsResult(check) {
  return {
    error: check.message,
    rejected_fields: [{ column: check.meta.column, code: check.code }],
    hint: 'geo_point expects "lat, lng"; address expects a string or { formatted, … }',
  };
}

/**
 * Safe parse data - handles both PostgreSQL (object) and SQLite (string)
 */
export function parseRowData(data) {
  if (data === null || data === undefined) return {};
  if (typeof data === 'object') return data; // PostgreSQL JSONB
  try {
    return JSON.parse(data); // SQLite string
  } catch {
    return {};
  }
}

// ADR-182 — lean write-responses (minimal-by-default echo + upsert_section).
const DIGEST_PREVIEW_CHARS = 120;

/** Stringify a stored field value the way the caller would see it persisted. */
function fieldToString(v) {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** Markdown heading level of a line (1–6), or 0 if the line is not a heading. */
function headingLevel(line) {
  const m = /^(#{1,6})(?:\s|$)/.exec(line.trim());
  return m ? m[1].length : 0;
}

/**
 * ADR-182 Tier 1 — build the minimal-by-default write digest instead of echoing
 * the whole (possibly multi-KB) row. Per changed field: resulting byte length +
 * a ~120-char tail (head on opt-in). The tail is the default because the dominant
 * mutation is append/upsert-into-tail. Mirrors RFC 7240 `return=minimal`.
 */
export function buildWriteDigest(changedFields, mergedData, { includeHead = false } = {}) {
  const bytes = {};
  const tail = {};
  const head = includeHead ? {} : undefined;
  for (const f of changedFields) {
    const s = fieldToString(mergedData[f]);
    bytes[f] = Buffer.byteLength(s, 'utf8');
    tail[f] = s.length > DIGEST_PREVIEW_CHARS ? '…' + s.slice(-DIGEST_PREVIEW_CHARS) : s;
    if (head) head[f] = s.length > DIGEST_PREVIEW_CHARS ? s.slice(0, DIGEST_PREVIEW_CHARS) + '…' : s;
  }
  const digest = { changed: changedFields, bytes, tail };
  if (head) digest.head = head;
  return digest;
}

/**
 * ADR-182 Tier 2 — idempotent, line-anchored replace-or-append of a marker-anchored
 * section in a text field.
 * - Match: a line that starts with `marker` (line-anchored, `^marker`).
 * - Replace boundary: the next heading of the same-or-higher level (fewer/equal `#`),
 *   else EOF. If `marker` is not a markdown heading, the section runs to EOF (footer).
 * - Absent → append to the tail with a single normalizing blank-line separator.
 * Re-running with identical `content` yields byte-identical output — the marker is the
 * idempotency key, enforced server-side (replaces the client-side SHA-256 dance).
 */
export function upsertMarkedSection(current, marker, content) {
  const original = current == null ? '' : String(current);
  const lines = original.split('\n');
  const markerIdx = lines.findIndex((l) => l.startsWith(marker));

  if (markerIdx === -1) {
    // Append. Trim trailing whitespace so a later replace-path run reproduces the same bytes.
    const base = original.replace(/\s+$/, '');
    return base.length ? `${base}\n\n${content}` : content;
  }

  // Replace from the marker line to the section boundary.
  const level = headingLevel(marker);
  let end = lines.length; // default: run to EOF
  if (level > 0) {
    for (let i = markerIdx + 1; i < lines.length; i++) {
      const lvl = headingLevel(lines[i]);
      if (lvl > 0 && lvl <= level) { end = i; break; }
    }
  }
  // The blank-line separator(s) before the next section belong to that section —
  // keep them so replace preserves spacing and stays byte-idempotent.
  while (end > markerIdx + 1 && lines[end - 1].trim() === '') end--;
  return [...lines.slice(0, markerIdx), ...content.split('\n'), ...lines.slice(end)].join('\n');
}

/**
 * ADR-182 Tier 3 — read-side field projection. Given a pure data object and an
 * opt-in allow-list, return only the requested user columns. Lenient: unknown
 * field names are ignored (never throw) and reported back in `unknown`, so an
 * agent learns of a typo without a failed call. Structural keys (id, timestamps,
 * table_id, …) live outside the data object the caller passes in, so they are
 * never subject to the allow-list and are always kept by the handler.
 */
export function pickFields(data, fields) {
  const src = data && typeof data === 'object' ? data : {};
  const picked = {};
  const unknown = [];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(src, f)) picked[f] = src[f];
    else unknown.push(f);
  }
  return { picked, unknown };
}

/**
 * Data tool handlers
 */
/** QA-20816-01 — same shape as the select/type rejections above. */
function unknownKeysResult(unknown) {
  return {
    error: unknownKeysMessage(unknown),
    rejected_fields: unknown.map(column => ({ column, reason: 'unknown_column' })),
    hint: 'Call get_table_schema and use only declared column keys (name or id)'
  };
}

export const dataToolHandlers = {
  // === CONSULTING ===
  async get_workspace_info({ space_id }) {
    const space = await dbGet('SELECT * FROM spaces WHERE id = ?', [space_id]);
    if (!space) {
      return { error: 'Space not found' };
    }

    const projects = await dbAll(`
      SELECT id, name, icon, description
      FROM projects
      WHERE space_id = ?
    `, [space_id]);

    const tables = await dbAll(`
      SELECT ut.id, ut.name, ut.icon, ut.description, p.name as project_name
      FROM universal_tables ut
      JOIN projects p ON ut.project_id = p.id
      WHERE p.space_id = ?
    `, [space_id]);

    return {
      space: { id: space.id, name: space.name, type: space.type, icon: space.icon },
      projects: projects,
      tables: tables,
      summary: {
        project_count: projects.length,
        table_count: tables.length
      }
    };
  },

  async query_table_data({ table_id, limit = 100, search, fields }) {
    const table = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [table_id]);
    if (!table) {
      return { error: 'Table not found' };
    }

    const pg = isPostgres();
    let paramIdx = 1;
    let query = pg
      ? `SELECT id, data, created_at FROM table_rows WHERE table_id = $${paramIdx++}`
      : 'SELECT id, data, created_at FROM table_rows WHERE table_id = ?';
    const params = [table_id];

    if (search) {
      query += pg
        ? ` AND data::text ILIKE $${paramIdx++}`
        : ' AND data LIKE ?';
      params.push(`%${search}%`);
    }

    query += pg
      ? ` ORDER BY created_at DESC LIMIT $${paramIdx++}`
      : ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const rows = await dbAll(query, params);

    // ADR-182 Tier 3 — opt-in field projection. Omitted `fields` ⇒ full row, byte-identical.
    // Here the data columns spread flat next to the structural keys id/created_at, so we
    // project the parsed data object and re-attach the structural keys unconditionally.
    const project = Array.isArray(fields) && fields.length > 0;
    const unknownSet = new Set();
    const mapped = rows.map(r => {
      const data = parseRowData(r.data) || {};
      if (!project) return { id: r.id, ...data, created_at: r.created_at };
      const { picked, unknown } = pickFields(data, fields);
      unknown.forEach(u => unknownSet.add(u));
      return { id: r.id, ...picked, created_at: r.created_at };
    });

    return {
      table: { id: table.id, name: table.name },
      rows: mapped,
      total: mapped.length,
      ...(project ? { unknown_fields: [...unknownSet] } : {})
    };
  },

  async get_table_schema({ table_id }) {
    const table = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [table_id]);
    if (!table) {
      return { error: 'Table not found' };
    }

    const columns = await dbAll(`
      SELECT id, column_name, display_name, type, config, is_required, order_index
      FROM table_columns
      WHERE table_id = ?
      ORDER BY order_index, id
    `, [table_id]);

    return {
      table: { id: table.id, name: table.name, icon: table.icon },
      columns: columns.map(c => {
        const config = parseRowData(c.config);
        return {
          key: c.column_name,
          name: c.display_name || c.column_name,
          type: c.type,
          icon: config?.icon || null,
          required: c.is_required === 1,
          settings: config || {}
        };
      })
    };
  },

  // === TABLE MANAGEMENT ===
  async create_table({ project_id, name, display_name, icon = '📊', columns, show_in_nav = true }, userId) {
    tableKeySchema.parse(name);
    z.number().int().positive().parse(project_id);
    z.boolean().parse(show_in_nav);
    z.string().optional().parse(display_name);
    z.array(z.object({ name: z.string().min(1), type: z.enum(VALID_COLUMN_TYPES).optional() }).passthrough()).parse(columns);

    return withTransactionAsync(async (trx) => {
      // Lock before inserting the table: its project FK also acquires a row lock.
      if (show_in_nav) {
        const project = await trx.get(`SELECT id FROM projects WHERE id = ?${isPostgres() ? ' FOR UPDATE' : ''}`, [project_id]);
        if (!project) throw new Error('Project not found');
      }
      const tableResult = await trx.run(`
        INSERT INTO universal_tables (project_id, name, display_name, icon, description, show_in_nav, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, '', ?, ?, ${sqlNow()}, ${sqlNow()})
      `, [project_id, name, display_name || name, icon, toBool(show_in_nav), userId ?? null]);
      const tableId = tableResult.lastInsertRowid || tableResult.lastID;

      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        await trx.run(`
          INSERT INTO table_columns (table_id, column_name, display_name, type, config, width, is_required, order_index, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
        `, [tableId, col.name.toLowerCase().replace(/\s+/g, '_'), col.name, persistColumnType(col.type === undefined ? 'text' : col.type),
          JSON.stringify({ icon: col.icon || '📝', ...(col.settings || {}) }),
          col.width || 150, toBool(col.required), i + 1]);
      }

      let widgetId = null;
      if (show_in_nav) {
        let dashboard = await trx.get('SELECT id FROM dashboards WHERE project_id = ? AND is_default = ? LIMIT 1', [project_id, toBool(true)]);
        if (!dashboard) {
          const result = await trx.run(`
            INSERT INTO dashboards (project_id, name, is_default, created_at, updated_at)
            VALUES (?, 'Main Dashboard', ?, ${sqlNow()}, ${sqlNow()})
          `, [project_id, toBool(true)]);
          dashboard = { id: result.lastInsertRowid || result.lastID };
        }
        const { createWidget } = await import('../WidgetService.js');
        const widget = await createWidget({
          dashboard_id: dashboard.id, widget_type: 'preset', preset_name: 'table_view',
          title: display_name || name, icon, config: { table_id: tableId },
          position: { x: 0, y: 0, w: 12, h: 6 }, created_by: userId ?? null,
        }, { trx });
        widgetId = widget.id;
      }
      return {
        success: true, table_id: tableId, widget_id: widgetId,
        message: `Table "${display_name || name}" created with ${columns.length} columns`
      };
    });
  },

  async get_table_row({ table_id, row_id, fields }) {
    const table = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [table_id]);
    if (!table) {
      return { success: false, error: `Table ${table_id} not found` };
    }

    const row = await dbGet(
      'SELECT * FROM table_rows WHERE id = ? AND table_id = ?',
      [row_id, table_id]
    );
    if (!row) {
      return { success: false, error: `Row ${row_id} not found in table ${table_id}` };
    }

    const columns = await dbAll(
      'SELECT id, column_name, display_name, type FROM table_columns WHERE table_id = ? ORDER BY order_index',
      [table_id]
    );

    const parsedData = parseRowData(row.data) || {};

    // ADR-182 Tier 3 — opt-in field projection. Here the data lives nested under
    // row.data; the structural siblings (id/base_id/table_id/created_by/timestamps)
    // are outside it and always kept. Omitted `fields` ⇒ full row.data, byte-identical.
    const project = Array.isArray(fields) && fields.length > 0;
    const { picked, unknown } = project ? pickFields(parsedData, fields) : { picked: null, unknown: [] };

    return {
      success: true,
      row: {
        id: row.id,
        base_id: row.base_id,
        table_id: row.table_id,
        data: project ? picked : parsedData,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at
      },
      columns: columns.map(c => ({
        id: c.id,
        key: c.column_name,
        name: c.display_name || c.column_name,
        type: c.type
      })),
      ...(project ? { unknown_fields: unknown } : {})
    };
  },

  async add_table_row({ table_id, data }, userId) {
    try { data = coerceDataObject(data, 'data'); }
    catch (e) { return { error: e.message }; }
    if (!data) return { error: 'data is required' };

    // QA-20816-01 — keys the schema does not declare are rejected, not stored.
    const keyGuard = await guardRowKeys(table_id, data);
    if (keyGuard.unknown.length > 0) return unknownKeysResult(keyGuard.unknown);
    data = keyGuard.data;

    const { resolvedData, errors, rejections } = await resolveSelectValues(table_id, data);
    if (errors.length > 0) {
      return {
        error: 'Invalid select values — see rejected_fields for details',
        rejected_fields: rejections,
        hint: 'Use one of the valid_options listed for each rejected field'
      };
    }

    // Validate non-select column types (number, email, url, phone, date, datetime, checkbox)
    const colValidation = await validateAllColumns(table_id, resolvedData);
    if (colValidation.errors.length > 0) {
      return {
        error: 'Invalid column values — see rejected_fields for details',
        rejected_fields: colValidation.rejections,
        hint: 'Fix the values to match the expected type/format for each rejected field'
      };
    }

    // ADR-0035 / ADR-0035-A: geo_point + address cells — same normalizer as the REST path.
    const typed = await normalizeTypedCellsForTable(table_id, resolvedData);
    if (!typed.ok) return typedCellsResult(typed);
    const insertData = typed.data;

    const base_id = generateBaseId();
    const result = await dbRun(`
      INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
    `, [table_id, base_id, JSON.stringify(insertData), userId || 1]);

    const newRowId = result.lastInsertRowid;
    void notifyRowChange({ tableId: table_id, rowId: newRowId, action: 'created', source: 'agent' });

    // Fire row_create automations — parity with the v3 HTTP route. Non-blocking.
    fireRowCreateTriggers(parseInt(table_id), newRowId, insertData).catch(err => {
      console.warn('[AutomationTrigger] add_table_row row_create trigger failed:', err.message);
    });

    return {
      success: true,
      row_id: newRowId,
      message: 'Row added successfully'
    };
  },

  async list_tables({ project_id, space_id }) {
    let tables;

    if (project_id) {
      // Filter by project
      tables = await dbAll(`
        SELECT id, name, icon, description,
          (SELECT COUNT(*) FROM table_rows WHERE table_id = ut.id) as row_count
        FROM universal_tables ut
        WHERE project_id = ?
      `, [project_id]);
    } else if (space_id) {
      // Get all tables in space (grouped by project)
      tables = await dbAll(`
        SELECT ut.id, ut.name, ut.icon, ut.description, p.name as project_name, p.id as project_id,
          (SELECT COUNT(*) FROM table_rows WHERE table_id = ut.id) as row_count
        FROM universal_tables ut
        JOIN projects p ON ut.project_id = p.id
        WHERE p.space_id = ?
        ORDER BY p.name, ut.name
      `, [space_id]);
    } else {
      return { error: 'Either project_id or space_id is required', tables: [] };
    }

    return { tables };
  },

  // === UPDATE / DELETE (ADR-144 P0) ===
  async update_table_row({ table_id, row_id, data, response, include_head }, userId) {
    try { data = coerceDataObject(data, 'data'); }
    catch (e) { return { error: e.message }; }
    if (!data) return { error: 'data is required' };

    const row = await dbGet('SELECT * FROM table_rows WHERE id = ? AND table_id = ?', [row_id, table_id]);
    if (!row) return { error: `Row ${row_id} not found in table ${table_id}` };
    const existing = parseRowData(row.data);

    // QA-20816-01 — a key the schema does not declare is rejected unless the
    // row already carries it.
    const keyGuard = await guardRowKeys(table_id, data, existing);
    if (keyGuard.unknown.length > 0) return unknownKeysResult(keyGuard.unknown);

    const { resolvedData, errors, rejections } = await resolveSelectValues(table_id, keyGuard.data);
    if (errors.length > 0) {
      return {
        error: 'Invalid select values — see rejected_fields for details',
        rejected_fields: rejections,
        hint: 'Use one of the valid_options listed for each rejected field'
      };
    }

    // Validate non-select column types
    const colValidation = await validateAllColumns(table_id, resolvedData);
    if (colValidation.errors.length > 0) {
      return {
        error: 'Invalid column values — see rejected_fields for details',
        rejected_fields: colValidation.rejections,
        hint: 'Fix the values to match the expected type/format for each rejected field'
      };
    }

    const columns = await dbAll('SELECT id, column_name, type FROM table_columns WHERE table_id = ?', [table_id]);
    // ADR-0035 / ADR-0035-A: geo_point + address cells — same normalizer as the REST path.
    const typed = normalizeTypedCells(columns, resolvedData);
    if (!typed.ok) return typedCellsResult(typed);
    let merged = mergeRowData(columns, existing, typed.data);

    // ADR-0001 Wave 1: atoms_v2 versioning hook
    if (isAtomsV2Table(table_id)) {
      try {
        merged = await applyAtomVersioning({
          table_id,
          row_id,
          newData: merged,
          oldRow: { id: row_id, data: existing },
          changedByUser: userId || null,
          changeReason: data?.change_reason || null,
        });
      } catch (hookErr) {
        console.warn('[atoms_v2 hook] update_table_row failed:', hookErr.message);
      }
    }

    await dbRun(
      `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ? AND table_id = ?`,
      [JSON.stringify(merged), row_id, table_id]
    );

    // Fire row_update automations (e.g. Status→published → public mirror, 3720/177443).
    // Parity with the v3 HTTP route — MCP mutations must trigger the same automations.
    // Watch-field gating in fireRowUpdateTriggers prevents action loops. Non-blocking.
    void notifyRowChange({ tableId: table_id, rowId: row_id, action: 'updated', source: 'agent' });
    fireRowUpdateTriggers(parseInt(table_id), row_id, merged, existing).catch(err => {
      console.warn('[AutomationTrigger] update_table_row row_update trigger failed:', err.message);
    });

    // ADR-182 Tier 1: minimal-by-default digest; full row only on opt-in.
    if (response === 'full') {
      return { success: true, table_id, row_id, message: 'Row updated', data: merged };
    }
    const digest = buildWriteDigest(Object.keys(resolvedData), merged, { includeHead: include_head === true });
    return { success: true, table_id, row_id, ...digest };
  },

  // ADR-182 Tier 2: idempotent, server-side upsert of a marker-anchored section
  // in a text field. Replaces the client-side pull→splice→push→SHA-verify loop.
  async upsert_section({ table_id, row_id, field, marker, content, response, include_head }, userId) {
    if (!field || typeof field !== 'string') return { error: 'field is required (string)' };
    if (!marker || typeof marker !== 'string') return { error: 'marker is required (string)' };
    if (typeof content !== 'string') return { error: 'content is required (string)' };

    // Idempotency guard: the marker IS the key, so content must carry it. Without
    // this a re-run finds no marker and appends again — unbounded duplication.
    const firstNonEmpty = content.split('\n').find((l) => l.trim() !== '') || '';
    if (!firstNonEmpty.startsWith(marker)) {
      return { error: `content must begin with the marker line ("${marker}") so the upsert stays idempotent` };
    }

    const row = await dbGet('SELECT * FROM table_rows WHERE id = ? AND table_id = ?', [row_id, table_id]);
    if (!row) return { error: `Row ${row_id} not found in table ${table_id}` };

    const existing = parseRowData(row.data);
    // Refuse structured fields: upsertMarkedSection would String() them into
    // "[object Object]" and silently destroy the value.
    if (existing[field] != null && typeof existing[field] !== 'string') {
      return { error: `field "${field}" holds a non-text value; upsert_section only operates on text fields` };
    }
    const newValue = upsertMarkedSection(existing[field], marker, content);
    const keyGuard = await guardRowKeys(table_id, { [field]: newValue }, existing);
    if (keyGuard.unknown.length > 0 || !Object.hasOwn(keyGuard.data, field)) {
      return unknownKeysResult([field]);
    }
    let merged = { ...existing, ...keyGuard.data };

    // ADR-0001 Wave 1: atoms_v2 versioning hook — parity with update_table_row.
    if (isAtomsV2Table(table_id)) {
      try {
        merged = await applyAtomVersioning({
          table_id,
          row_id,
          newData: merged,
          oldRow: { id: row_id, data: existing },
          changedByUser: userId || null,
          changeReason: null,
        });
      } catch (hookErr) {
        console.warn('[atoms_v2 hook] upsert_section failed:', hookErr.message);
      }
    }

    await dbRun(
      `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ? AND table_id = ?`,
      [JSON.stringify(merged), row_id, table_id]
    );

    // Fire row_update automations — parity with the v3 HTTP route. Non-blocking.
    void notifyRowChange({ tableId: table_id, rowId: row_id, action: 'updated', source: 'agent' });
    fireRowUpdateTriggers(parseInt(table_id), row_id, merged, existing).catch(err => {
      console.warn('[AutomationTrigger] upsert_section row_update trigger failed:', err.message);
    });

    // ADR-182: return the lean digest, never the whole field. Full row only on opt-in.
    if (response === 'full') {
      return { success: true, table_id, row_id, message: 'Section upserted', data: merged };
    }
    const digest = buildWriteDigest([field], merged, { includeHead: include_head === true });
    return { success: true, table_id, row_id, ...digest };
  },

  async delete_table_row({ table_id, row_id }) {
    const row = await dbGet('SELECT id FROM table_rows WHERE id = ? AND table_id = ?', [row_id, table_id]);
    if (!row) return { error: `Row ${row_id} not found in table ${table_id}` };

    await dbRun('DELETE FROM table_rows WHERE id = ? AND table_id = ?', [row_id, table_id]);
    return { success: true, message: `Row ${row_id} deleted` };
  },

  async batch_update_rows({ table_id, updates, response }, userId) {
    if (!updates || updates.length === 0) return { error: 'No updates provided' };
    if (updates.length > 100) return { error: 'Max 100 rows per batch' };

    const table = await dbGet('SELECT id FROM universal_tables WHERE id = ?', [table_id]);
    if (!table) return { error: `Table ${table_id} not found` };

    const wantFull = response === 'full'; // ADR-182 Tier 1b — opt-in full rows; default stays lean
    const columns = await dbAll('SELECT id, column_name, type FROM table_columns WHERE table_id = ?', [table_id]);
    const results = { success: [], failed: [] };
    for (const upd of updates) {
      const { row_id } = upd;
      let { data } = upd;
      try {
        try { data = coerceDataObject(data, `updates[].data (row_id=${row_id})`); }
        catch (e) { results.failed.push({ row_id, error: e.message }); continue; }
        if (!data) { results.failed.push({ row_id, error: 'data is required' }); continue; }

        const row = await dbGet('SELECT data FROM table_rows WHERE id = ? AND table_id = ?', [row_id, table_id]);
        if (!row) { results.failed.push({ row_id, error: 'Not found' }); continue; }
        const oldData = parseRowData(row.data);
        const keyGuard = await guardRowKeys(table_id, data, oldData);
        if (keyGuard.unknown.length > 0) {
          results.failed.push({ row_id, ...unknownKeysResult(keyGuard.unknown) });
          continue;
        }
        const { resolvedData, errors, rejections } = await resolveSelectValues(table_id, keyGuard.data);
        if (errors.length > 0) {
          results.failed.push({ row_id, error: 'Invalid select values', rejected_fields: rejections });
          continue;
        }
        // Validate non-select column types
        const colValidation = await validateAllColumns(table_id, resolvedData);
        if (colValidation.errors.length > 0) {
          results.failed.push({ row_id, error: 'Invalid column values', rejected_fields: colValidation.rejections });
          continue;
        }
        // ADR-0035 / ADR-0035-A: geo_point + address cells — a bad value fails this row only.
        const typed = normalizeTypedCells(columns, resolvedData);
        if (!typed.ok) { results.failed.push({ row_id, ...typedCellsResult(typed) }); continue; }
        let merged = mergeRowData(columns, oldData, typed.data);
        // ADR-0001 Wave 1: atoms_v2 versioning hook (per-row in batch)
        if (isAtomsV2Table(table_id)) {
          try {
            merged = await applyAtomVersioning({
              table_id,
              row_id,
              newData: merged,
              oldRow: { id: row_id, data: oldData },
              changedByUser: userId || null,
              changeReason: data?.change_reason || null,
            });
          } catch (hookErr) {
            console.warn('[atoms_v2 hook] batch_update_rows failed:', hookErr.message);
          }
        }
        await dbRun(
          `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ? AND table_id = ?`,
          [JSON.stringify(merged), row_id, table_id]
        );
        // Fire row_update automations — parity with the v3 batch route. Non-blocking.
        void notifyRowChange({ tableId: table_id, rowId: row_id, action: 'updated', source: 'agent' });
        fireRowUpdateTriggers(parseInt(table_id), row_id, merged, oldData).catch(err => {
          console.warn('[AutomationTrigger] batch_update_rows row_update trigger failed:', err.message);
        });
        results.success.push(wantFull ? { row_id, data: merged } : row_id);
      } catch (err) {
        results.failed.push({ row_id, error: err.message });
      }
    }
    return { ...results, message: `${results.success.length} updated, ${results.failed.length} failed` };
  },

  async batch_delete_rows({ table_id, row_ids }) {
    if (!row_ids || row_ids.length === 0) return { error: 'No row_ids provided' };
    if (row_ids.length > 100) return { error: 'Max 100 rows per batch' };

    const table = await dbGet('SELECT id FROM universal_tables WHERE id = ?', [table_id]);
    if (!table) return { error: `Table ${table_id} not found` };

    const results = { success: [], failed: [] };
    for (const row_id of row_ids) {
      try {
        const row = await dbGet('SELECT id FROM table_rows WHERE id = ? AND table_id = ?', [row_id, table_id]);
        if (!row) { results.failed.push({ row_id, error: 'Not found' }); continue; }
        await dbRun('DELETE FROM table_rows WHERE id = ? AND table_id = ?', [row_id, table_id]);
        results.success.push(row_id);
      } catch (err) {
        results.failed.push({ row_id, error: err.message });
      }
    }
    return { ...results, message: `${results.success.length} deleted, ${results.failed.length} failed` };
  },

  async delete_table({ table_id }) {
    const table = await dbGet('SELECT id, name FROM universal_tables WHERE id = ?', [table_id]);
    if (!table) return { error: `Table ${table_id} not found` };

    await dbRun('DELETE FROM table_rows WHERE table_id = ?', [table_id]);
    await dbRun('DELETE FROM table_columns WHERE table_id = ?', [table_id]);
    await dbRun('DELETE FROM universal_tables WHERE id = ?', [table_id]);
    return { success: true, message: `Table "${table.name}" (${table_id}) deleted with all rows and columns` };
  },

  // === ANALYSIS ===
  async analyze_table_data({ table_id, analysis_type, columns = [] }) {
    const { rows } = await dataToolHandlers.query_table_data({ table_id, limit: 1000 });

    if (rows.length === 0) {
      return { error: 'No data to analyze' };
    }

    const result = {
      table_id,
      analysis_type,
      row_count: rows.length,
      analysis: {}
    };

    switch (analysis_type) {
      case 'summary': {
        // Basic stats for each column
        const allColumns = columns.length > 0 ? columns : Object.keys(rows[0]).filter(k => k !== 'id' && k !== 'created_at');
        result.analysis.columns = {};

        for (const col of allColumns) {
          const values = rows.map(r => r[col]).filter(v => v !== null && v !== undefined);
          const numericValues = values.filter(v => !isNaN(Number(v))).map(Number);

          result.analysis.columns[col] = {
            total_values: values.length,
            unique_values: [...new Set(values)].length,
            empty_count: rows.length - values.length
          };

          if (numericValues.length > 0) {
            const sum = numericValues.reduce((a, b) => a + b, 0);
            result.analysis.columns[col].numeric_stats = {
              min: Math.min(...numericValues),
              max: Math.max(...numericValues),
              avg: sum / numericValues.length,
              sum
            };
          }
        }
        break;
      }

      case 'distribution': {
        // Value distribution for categorical columns
        const distColumns = columns.length > 0 ? columns : Object.keys(rows[0]).slice(0, 5);
        result.analysis.distributions = {};

        for (const col of distColumns) {
          const counts = {};
          rows.forEach(r => {
            const val = String(r[col] || 'Empty');
            counts[val] = (counts[val] || 0) + 1;
          });
          result.analysis.distributions[col] = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([value, count]) => ({ value, count, percentage: ((count / rows.length) * 100).toFixed(1) + '%' }));
        }
        break;
      }

      default:
        result.analysis.message = `Analysis type "${analysis_type}" provides basic statistics`;
    }

    return result;
  }
};
