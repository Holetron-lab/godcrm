/**
 * WidgetService - v0.003.001
 * Service for managing dashboard widgets (preset & custom)
 * Based on ADR-002: Widget System Architecture
 */

import { dbRun, dbGet, dbAll, withTransactionAsync } from '../database/connection.js';
import mergeWith from 'lodash/mergeWith.js';
import { writeAudit } from './audit/writeAudit.js';

const OWNER_KINDS = ['dashboard', 'document', 'atom'];

// ADR-0003 Phase 2 (T-127903): atoms-as-widget-refs live in the single
// `atoms_v2` universal table (id=3574). Rows are in `table_rows.data` jsonb
// under key `widget_ref`; the partial index `idx_atoms_v2_widget_ref` covers
// `table_id=3574 AND data ? 'widget_ref'`.
// `doc_id` below is the atom's owning-document id, stored on the atom row
// itself under `data.doc_id` (set by document-content writers in ADR-0003).
const ATOMS_V2_TABLE_ID = 3574;
const ATOMS_WITH_WIDGET_REF_CTE = `
  SELECT tr.id AS atom_id,
         NULLIF(tr.data->>'doc_id','')::int AS doc_id
  FROM table_rows tr
  WHERE tr.table_id = ${ATOMS_V2_TABLE_ID}
    AND (tr.data->>'widget_ref') = ?
`;

/**
 * Resolve owner fields on widget create/update.
 * ADR-0003 widget-embed Phase 1 — widgets carry (owner_kind, owner_id).
 * For backwards compatibility a legacy caller passing only `dashboard_id`
 * is treated as {owner_kind:'dashboard', owner_id:dashboard_id}.
 * `dashboard_id` on the row is kept in sync when owner_kind='dashboard' so
 * the legacy read path (getWidgetsByDashboard, existing JOINs) keeps working.
 */
function resolveOwner({ owner_kind, owner_id, dashboard_id }) {
  let ok = owner_kind || null;
  let oid = owner_id != null ? Number(owner_id) : null;

  if (!ok && dashboard_id != null) {
    ok = 'dashboard';
    oid = Number(dashboard_id);
  }

  if (!ok || oid == null) {
    throw new Error('owner_kind + owner_id (or legacy dashboard_id) is required');
  }
  if (!OWNER_KINDS.includes(ok)) {
    throw new Error(`owner_kind must be one of: ${OWNER_KINDS.join(', ')}`);
  }

  // Keep dashboard_id in sync for legacy read-path compatibility.
  const dashId = ok === 'dashboard' ? oid : null;
  return { owner_kind: ok, owner_id: oid, dashboard_id: dashId };
}

/**
 * Create a new widget
 * @param {object} widgetData - Widget data
 * @returns {Promise<object>} Created widget
 */
export async function createWidget(widgetData) {
  const {
    dashboard_id,
    owner_kind,
    owner_id,
    source_widget_id = null,
    widget_type,
    preset_name = null,
    code = null,
    title,
    description = null,
    icon = '🧩',
    config = {},
    position = { x: 0, y: 0, w: 6, h: 4 },
    order_index = 0,
    created_by = null,
    is_module = false
  } = widgetData;

  // Validation: check widget_type
  if (!['preset', 'custom'].includes(widget_type)) {
    throw new Error('widget_type must be "preset" or "custom"');
  }

  // Validation: preset widget must have preset_name and no code
  if (widget_type === 'preset') {
    if (!preset_name) {
      throw new Error('preset_name is required for preset widgets');
    }
    if (code) {
      throw new Error('preset widgets cannot have code');
    }
  }

  // Validation: custom widget must have code and no preset_name
  if (widget_type === 'custom') {
    if (!code) {
      throw new Error('code is required for custom widgets');
    }
    if (preset_name) {
      throw new Error('custom widgets cannot have preset_name');
    }
  }

  const owner = resolveOwner({ owner_kind, owner_id, dashboard_id });

  // Validation: owner must exist.
  if (owner.owner_kind === 'dashboard') {
    const dashboard = await dbGet('SELECT id FROM dashboards WHERE id = ?', [owner.owner_id]);
    if (!dashboard) throw new Error('Dashboard not found');
  } else if (owner.owner_kind === 'document') {
    const row = await dbGet('SELECT id FROM table_rows WHERE id = ?', [owner.owner_id]);
    if (!row) throw new Error('Owner document row not found');
  }
  // 'atom' — ownership target is a row in the atoms table; caller is
  // responsible for target validity (table varies per widget).

  // Insert widget
  const result = await dbRun(`
    INSERT INTO widgets (
      dashboard_id,
      owner_kind,
      owner_id,
      source_widget_id,
      widget_type,
      preset_name,
      code,
      title,
      description,
      icon,
      config,
      position,
      is_visible,
      order_index,
      created_by,
      is_module
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    owner.dashboard_id,
    owner.owner_kind,
    owner.owner_id,
    source_widget_id,
    widget_type,
    preset_name,
    code,
    title,
    description,
    icon,
    JSON.stringify(config),
    JSON.stringify(position),
    1,
    order_index,
    created_by,
    is_module ? 1 : 0
  ]);

  return await getWidgetById(result.lastInsertRowid);
}

// ADR-0012 Phase 8 (T-135214): atom-aware effective config resolver.
// Atoms live in `table_rows.data` (JSONB) under key `settings_override`.
// Merge semantics: Helm-style — objects merge deep, arrays replace wholesale.
// Returns null when atomId is missing/invalid so callers can skip the merge.
async function getAtomSettingsOverride(atomId) {
  if (atomId == null) return null;
  const id = Number(atomId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = await dbGet(
    "SELECT data->'settings_override' AS so FROM table_rows WHERE id = ?",
    [id]
  );
  if (!row || row.so == null) return null;
  if (typeof row.so === 'string') {
    try { return JSON.parse(row.so); } catch { return null; }
  }
  return row.so;
}

function mergeArraysReplace(_dst, src) {
  if (Array.isArray(src)) return src;
  return undefined;
}

/**
 * ADR-0012 Phase 8: deep-merge widget.config with an atom's settings_override.
 * @param {object} widget - widget row (with parsed `config`)
 * @param {object|null} override - atom.settings_override (object or null)
 * @returns {object} effective config
 */
export function mergeWidgetConfig(widget, override) {
  if (!override || typeof override !== 'object') return widget.config || {};
  const base = widget.config && typeof widget.config === 'object' ? widget.config : {};
  return mergeWith({}, base, override, mergeArraysReplace);
}

/**
 * ADR-0012 Phase 8 (T-135214): resolve effective widget config for a given
 * (widget, atom) pair. Used by GET /api/v3/widgets/:id?atom_id=N to ship the
 * post-template-virtualization config without changing the response shape.
 * @param {number} widgetId
 * @param {number|null} atomId - row id in `table_rows` of the embedding atom
 * @returns {Promise<object|null>} widget with merged `config`, or null if not found
 */
export async function getEffectiveWidgetConfig(widgetId, atomId) {
  const widget = await getWidgetById(widgetId);
  if (!widget) return null;
  const override = await getAtomSettingsOverride(atomId);
  if (override) {
    widget.config = mergeWidgetConfig(widget, override);
    widget._resolved = true;
  }
  return widget;
}

/**
 * Get widget by ID
 * @param {number} widgetId - Widget ID
 * @returns {Promise<object|null>} Widget or null
 */
export async function getWidgetById(widgetId) {
  // Join with dashboard and project to get project_id and space_id
  const widget = await dbGet(`
    SELECT w.*, d.project_id, p.space_id,
      CASE WHEN m.id IS NOT NULL THEN true ELSE false END as is_module,
      m.id as module_id,
      m.sidebar_order,
      m.sidebar_icon,
      m.access_level,
      m.is_pinned
    FROM widgets w
    LEFT JOIN dashboards d ON w.dashboard_id = d.id
    LEFT JOIN projects p ON d.project_id = p.id
    LEFT JOIN modules m ON m.widget_id = w.id
    WHERE w.id = ?
  `, [widgetId]);
  
  if (!widget) {
    return null;
  }

  // Parse JSON fields
  widget.config = JSON.parse(widget.config);
  widget.position = JSON.parse(widget.position);

  return widget;
}

/**
 * Get all widgets for a dashboard
 * @param {number} dashboardId - Dashboard ID
 * @param {object} [options] - Filter options
 * @param {boolean} [options.is_module] - Filter by is_module flag (true/false/undefined=all)
 * @returns {Promise<array>} Array of widgets
 */
export async function getWidgetsByDashboard(dashboardId, options = {}) {
  let query = `SELECT w.*, CASE WHEN m.id IS NOT NULL THEN true ELSE false END as is_module, m.id as module_id, m.sidebar_order, m.sidebar_icon, m.access_level, m.is_pinned FROM widgets w LEFT JOIN modules m ON m.widget_id = w.id WHERE w.dashboard_id = ?`;
  const params = [dashboardId];

  if (options.is_module !== undefined) {
    if (options.is_module) {
      query += ' AND m.id IS NOT NULL';
    } else {
      query += ' AND m.id IS NULL';
    }
  }

  query += ' ORDER BY w.order_index ASC, w.id ASC';

  const widgets = await dbAll(query, params);

  // Parse JSON fields for each widget
  return widgets.map(widget => ({
    ...widget,
    config: JSON.parse(widget.config),
    position: JSON.parse(widget.position)
  }));
}

/**
 * Get all widgets for a given polymorphic owner (ADR-0003 widget-embed Phase 1).
 * @param {string} ownerKind - 'dashboard' | 'document' | 'atom'
 * @param {number} ownerId
 * @param {object} [options]
 * @param {boolean} [options.is_module]
 * @returns {Promise<array>}
 */
export async function getWidgetsByOwner(ownerKind, ownerId, options = {}) {
  if (!OWNER_KINDS.includes(ownerKind)) {
    throw new Error(`owner_kind must be one of: ${OWNER_KINDS.join(', ')}`);
  }
  let query = `SELECT w.*, CASE WHEN m.id IS NOT NULL THEN true ELSE false END as is_module, m.id as module_id, m.sidebar_order, m.sidebar_icon, m.access_level, m.is_pinned FROM widgets w LEFT JOIN modules m ON m.widget_id = w.id WHERE w.owner_kind = ? AND w.owner_id = ?`;
  const params = [ownerKind, Number(ownerId)];

  if (options.is_module !== undefined) {
    query += options.is_module ? ' AND m.id IS NOT NULL' : ' AND m.id IS NULL';
  }

  query += ' ORDER BY w.order_index ASC, w.id ASC';

  const widgets = await dbAll(query, params);
  return widgets.map(widget => ({
    ...widget,
    config: JSON.parse(widget.config),
    position: JSON.parse(widget.position)
  }));
}

/**
 * Update widget
 * @param {number} widgetId - Widget ID
 * @param {object} updates - Fields to update
 * @param {object} [req] - Express request (optional). When provided and `config`
 *   is among the updated fields, a `widget.config_updated` row is appended to
 *   `audit_log` via `writeAudit()` (ADR-0066 P0). This is the sole regression
 *   detector for ADR-0067 P3 soak — see drift queries in the ADR §Open Q2.
 * @returns {Promise<object>} Updated widget
 */
export async function updateWidget(widgetId, updates, req = null) {
  // Check widget exists
  const widget = await getWidgetById(widgetId);
  if (!widget) {
    throw new Error('Widget not found');
  }

  const allowedFields = ['title', 'description', 'icon', 'config', 'position', 'is_visible', 'order_index', 'is_public'];
  const updateFields = [];
  const updateValues = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      updateFields.push(`${key} = ?`);
      // Stringify JSON fields
      if (key === 'config' || key === 'position') {
        updateValues.push(JSON.stringify(value));
      } else {
        updateValues.push(value);
      }
    }
  }

  if (updateFields.length === 0) {
    return widget;
  }

  updateFields.push('updated_at = CURRENT_TIMESTAMP');
  updateValues.push(widgetId);

  await dbRun(
    `UPDATE widgets SET ${updateFields.join(', ')} WHERE id = ?`,
    updateValues
  );

  // ADR-0067 Q2 — emit audit row for config mutations only (narrow detector;
  // position / is_visible / order_index intentionally NOT audited). Fire-and-
  // forget; writeAudit() never throws.
  if (Object.prototype.hasOwnProperty.call(updates, 'config')) {
    await writeAudit(req, {
      action: 'widget.config_updated',
      entity_type: 'widget',
      entity_id: widgetId,
      details: {
        preset_name: widget.preset_name ?? null,
        before: widget.config ?? null,
        after: updates.config ?? null,
      },
    });
  }

  return await getWidgetById(widgetId);
}

/**
 * Update custom widget code
 * @param {number} widgetId - Widget ID
 * @param {string} newCode - New code
 * @returns {Promise<object>} Updated widget
 */
export async function updateWidgetCode(widgetId, newCode) {
  const widget = await getWidgetById(widgetId);
  
  if (!widget) {
    throw new Error('Widget not found');
  }

  if (widget.widget_type !== 'custom') {
    throw new Error('Can only update code for custom widgets');
  }

  if (!newCode || newCode.trim() === '') {
    throw new Error('Code cannot be empty');
  }

  await dbRun(`
    UPDATE widgets 
    SET code = ?, code_version = code_version + 1, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `, [newCode, widgetId]);

  return await getWidgetById(widgetId);
}

/**
 * Count atom rows across all document_content tables that reference `widgetId`
 * via their `widget_ref` jsonb field (ADR-0003 Phase 2 / T-127903).
 * @param {number} widgetId
 * @returns {Promise<number>}
 */
export async function countAtomRefs(widgetId) {
  const row = await dbGet(
    `SELECT COUNT(*)::int AS n FROM (${ATOMS_WITH_WIDGET_REF_CTE}) t`,
    [String(widgetId)]
  );
  return row ? Number(row.n) : 0;
}

/**
 * Sample atom references to a widget: up to `limit` rows of {doc_id, atom_id}.
 * `doc_id` is the owning `universal_tables.id` of the document_content table,
 * `atom_id` is the `table_rows.id` of the atom itself.
 * @param {number} widgetId
 * @param {number} [limit=5]
 * @returns {Promise<Array<{doc_id:number, atom_id:number}>>}
 */
export async function sampleAtomRefs(widgetId, limit = 5) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5, 50));
  const rows = await dbAll(
    `${ATOMS_WITH_WIDGET_REF_CTE} ORDER BY atom_id ASC LIMIT ${safeLimit}`,
    [String(widgetId)]
  );
  return rows.map(r => ({ doc_id: Number(r.doc_id), atom_id: Number(r.atom_id) }));
}

/**
 * Reassign every atom whose `widget_ref` = oldWidgetId to `newWidgetId`,
 * scoped to document_content tables only. Runs inside the caller's trx.
 * @param {object} trx
 * @param {number} oldWidgetId
 * @param {number} newWidgetId
 * @returns {Promise<number>} number of atoms updated
 */
async function reassignWidgetRefsInTrx(trx, oldWidgetId, newWidgetId) {
  const result = await trx.run(
    `UPDATE table_rows
        SET data = jsonb_set(data, '{widget_ref}', to_jsonb(?::text)),
            updated_at = NOW()
      WHERE table_id = ${ATOMS_V2_TABLE_ID}
        AND (data->>'widget_ref') = ?`,
    [String(newWidgetId), String(oldWidgetId)]
  );
  return result?.changes ?? result?.rowCount ?? 0;
}

/**
 * Null-out `widget_ref` on every atom pointing at `oldWidgetId` (renderer
 * falls back to broken-ref UI — see T-127905/906). Runs inside caller's trx.
 * @param {object} trx
 * @param {number} oldWidgetId
 * @returns {Promise<number>} number of atoms orphaned
 */
async function orphanWidgetRefsInTrx(trx, oldWidgetId) {
  const result = await trx.run(
    `UPDATE table_rows
        SET data = jsonb_set(data, '{widget_ref}', 'null'::jsonb),
            updated_at = NOW()
      WHERE table_id = ${ATOMS_V2_TABLE_ID}
        AND (data->>'widget_ref') = ?`,
    [String(oldWidgetId)]
  );
  return result?.changes ?? result?.rowCount ?? 0;
}

async function writeAuditInTrx(trx, { userId, action, entityId, details }) {
  await trx.run(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, 'widget', ?, ?)`,
    [userId ?? null, action, String(entityId), JSON.stringify(details || {})]
  );
}

/**
 * Delete widget.
 *
 * ADR-0003 Phase 2 / T-127903: extended to guard against deletion while atoms
 * still reference the widget and to support reassign / orphan flows.
 *
 * Signature accepts either legacy `(widgetId, forceBool)` or the new options
 * form `(widgetId, { force, reassignTo, orphan, userId })`.
 *
 * @param {number} widgetId
 * @param {boolean|object} [options] - legacy boolean `force` or options object
 * @returns {Promise<{action:'detached'|'deleted'|'reassigned'|'orphaned', reassigned?:number, orphaned?:number}>}
 * @throws {Error} with code 'WIDGET_IN_USE' (and `.sample`/`.atom_refs_count`)
 *   when atoms still reference the widget and no force/orphan flow is chosen.
 */
export async function deleteWidget(widgetId, options = false) {
  // Backwards-compat: legacy callers pass a bare boolean `force`.
  const opts = typeof options === 'object' && options !== null
    ? options
    : { force: Boolean(options) };
  const { force = false, reassignTo = null, orphan = false, userId = null } = opts;

  // Pre-check atom refs.
  const atomRefsCount = await countAtomRefs(widgetId);

  if (atomRefsCount > 0) {
    // Must pick a flow.
    if (!orphan && (!force || reassignTo == null)) {
      const sample = await sampleAtomRefs(widgetId, 5);
      const err = new Error('widget_in_use');
      err.code = 'WIDGET_IN_USE';
      err.atom_refs_count = atomRefsCount;
      err.sample = sample;
      throw err;
    }
    if (orphan && force && reassignTo != null) {
      throw new Error('orphan and reassign_to are mutually exclusive');
    }
    if (force && reassignTo != null) {
      const target = await dbGet('SELECT id FROM widgets WHERE id = ?', [Number(reassignTo)]);
      if (!target) throw new Error('reassign_to widget not found');
      if (Number(reassignTo) === Number(widgetId)) {
        throw new Error('reassign_to cannot equal the widget being deleted');
      }
    }
  }

  // Module detach path (existing behaviour, only when no atom refs).
  if (atomRefsCount === 0) {
    const moduleRecord = await dbGet('SELECT id FROM modules WHERE widget_id = ?', [widgetId]);
    if (moduleRecord && !force) {
      await dbRun(
        'UPDATE widgets SET dashboard_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [widgetId]
      );
      return { action: 'detached' };
    }
  }

  return await withTransactionAsync(async (trx) => {
    let reassigned = 0;
    let orphaned = 0;

    if (atomRefsCount > 0) {
      if (force && reassignTo != null) {
        reassigned = await reassignWidgetRefsInTrx(trx, widgetId, Number(reassignTo));
        await writeAuditInTrx(trx, {
          userId,
          action: 'widget.refs_reassigned',
          entityId: widgetId,
          details: { from: Number(widgetId), to: Number(reassignTo), count: reassigned },
        });
      } else if (orphan) {
        orphaned = await orphanWidgetRefsInTrx(trx, widgetId);
        await writeAuditInTrx(trx, {
          userId,
          action: 'widget.refs_orphaned',
          entityId: widgetId,
          details: { widget_id: Number(widgetId), count: orphaned },
        });
      }
    }

    await trx.run('DELETE FROM widgets WHERE source_widget_id = ?', [widgetId]);
    await trx.run('DELETE FROM widgets WHERE id = ?', [widgetId]);

    await writeAuditInTrx(trx, {
      userId,
      action: 'widget.deleted',
      entityId: widgetId,
      details: {
        widget_id: Number(widgetId),
        atom_refs_count: atomRefsCount,
        reassigned_to: force && reassignTo != null ? Number(reassignTo) : null,
        orphaned: orphan ? orphaned : 0,
      },
    });

    if (reassigned > 0) return { action: 'reassigned', reassigned };
    if (orphaned > 0) return { action: 'orphaned', orphaned };
    return { action: 'deleted' };
  });
}

/**
 * Get widget data (for widgets with table_id in config)
 * @param {number} widgetId - Widget ID
 * @returns {Promise<array>} Array of rows
 */
export async function getWidgetData(widgetId, atomId = null) {
  // ADR-0012 Phase 8: resolve template+override before reading config keys.
  const widget = atomId != null
    ? await getEffectiveWidgetConfig(widgetId, atomId)
    : await getWidgetById(widgetId);

  if (!widget) {
    throw new Error('Widget not found');
  }

  const config = widget.config;

  // If widget has table_id, fetch table data
  if (config.table_id) {
    let query = 'SELECT * FROM table_rows WHERE table_id = ?';
    const params = [config.table_id];

    const rows = await dbAll(query, params);

    // Parse JSON data for each row
    let parsedRows = rows.map(row => ({
      ...row,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data
    }));

    // Apply filters if present
    if (config.filters && config.filters.length > 0) {
      parsedRows = parsedRows.filter(row => {
        return config.filters.every(filter => {
          return row.data[filter.column] === filter.value;
        });
      });
    }

    return parsedRows;
  }

  return [];
}
