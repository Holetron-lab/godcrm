/**
 * Widget tickets resolution controller.
 *
 * POST /api/v3/widgets/:widgetId/resolve-tickets
 *
 * Contract: a single signal — `widget.config.filter` — decides what to return.
 *   - filter ACTIVE  (column set + (non-empty value OR use_owner_id))
 *       → column-filter mode: rows where data[columnId] = resolvedValue
 *   - filter INACTIVE / missing
 *       → all rows from the tickets table (cross-space guarded, paginated)
 *
 * `widget.config.filter` shape:
 *   {
 *     column:        'adr_ref', // REQUIRED — column NAME on tickets table
 *     value?:        '129897',  // literal value (string)
 *     ids?:          [132066,132067], // ADR-0012 §4.8: only valid when
 *                               // column === 'id'. Returns rows in array
 *                               // order (top-to-bottom = left-to-right of
 *                               // the array). Wins over `value` if both set.
 *     use_owner_id?: true       // resolve value from widget.owner_id
 *                               // (requires owner_kind === 'document')
 *   }
 *
 * Response envelope:
 *   {
 *     tickets: TicketRow[],
 *     total: number,
 *     filter_mode: 'column-filter' | 'manual-ids' | 'all',
 *     applied_filter: { space_id, column?, value?, ids? }
 *   }
 *
 * Tickets table id comes from `widget.config.tickets_table_id`
 * (or `widget.config.ticket_binding.table_id`).
 */
import express from 'express';
import { getWidgetById } from '../../../services/WidgetService.js';
import { dbAll as realDbAll, dbGet as realDbGet } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, badRequest, notFound } from '../../../utils/response.js';

// Default tickets table id — the `Tickets` universal table in project 138.
// Can be overridden by `widget.config.tickets_table_id` or
// `widget.config.ticket_binding.table_id`.
const DEFAULT_TICKETS_TABLE_ID = 1708;

function parseTicketRow(row, idToNameMap) {
  const parsedData = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
  const transformed = { id: row.id };
  if (idToNameMap && Object.keys(idToNameMap).length > 0) {
    for (const [key, value] of Object.entries(parsedData)) {
      const colName = idToNameMap[key] || key;
      transformed[colName] = value;
    }
  } else {
    Object.assign(transformed, parsedData);
  }
  return {
    id: row.id,
    base_id: row.base_id,
    table_id: row.table_id,
    data: transformed,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function resolveTicketsTableId(config = {}) {
  const direct = config.tickets_table_id;
  if (direct != null) return Number(direct);
  const binding = config.ticket_binding || {};
  if (binding.table_id != null) return Number(binding.table_id);
  if (binding.tickets_table_id != null) return Number(binding.tickets_table_id);
  return DEFAULT_TICKETS_TABLE_ID;
}

function widgetSupportsTicketResolution(widget) {
  if (!widget) return false;
  if (widget.preset_name === 'tickets_list') return true;
  if (widget.preset_name === 'documents' || widget.preset_name === 'documents_legacy') return true;
  const cfg = widget.config || {};
  if (cfg.registry_table_id != null) return true;
  return false;
}

async function buildIdToNameMap(tableId, dbAll) {
  const cols = await dbAll(
    'SELECT id, column_name FROM table_columns WHERE table_id = ?',
    [tableId]
  );
  const map = {};
  for (const c of cols) map[String(c.id)] = c.column_name;
  return map;
}

async function fetchAllTicketsFromTable(ticketsTableId, spaceId, limit, offset, dbGet, dbAll) {
  const tbl = await dbGet(
    `SELECT ut.id, p.space_id
       FROM universal_tables ut
       LEFT JOIN projects p ON p.id = ut.project_id
      WHERE ut.id = ?`,
    [ticketsTableId]
  );
  if (!tbl) return { rows: [], total: 0 };
  // Cross-space guard: silently exclude when the table's project sits in a
  // different space than the widget.
  if (spaceId != null && tbl.space_id != null && Number(tbl.space_id) !== Number(spaceId)) {
    return { rows: [], total: 0 };
  }
  const totalRow = await dbGet(
    'SELECT COUNT(*)::int AS c FROM table_rows WHERE table_id = ?',
    [ticketsTableId]
  );
  const total = totalRow ? Number(totalRow.c) : 0;
  const rows = await dbAll(
    `SELECT id, base_id, table_id, data, created_at, updated_at
       FROM table_rows
      WHERE table_id = ?
      ORDER BY id DESC
      LIMIT ? OFFSET ?`,
    [ticketsTableId, limit, offset]
  );
  return { rows, total };
}

async function fetchTicketsByColumnValue(ticketsTableId, columnName, value, dbAll) {
  // Tickets `data` JSON is keyed by column NAME (e.g. `"priority": 24272`),
  // not by column id — see tableRowListController.js:316 for the same pattern.
  // The 2 legacy id-keyed rows in prod (out of 466) are intentionally not matched.
  const rows = await dbAll(
    `SELECT id, base_id, table_id, data, created_at, updated_at
       FROM table_rows
      WHERE table_id = ?
        AND data::jsonb ->> ? = ?
      ORDER BY id DESC`,
    [ticketsTableId, String(columnName), String(value)]
  );
  return rows;
}

async function fetchTicketByRowId(ticketsTableId, rowId, dbAll) {
  // Special-case: `id` filter compares against table_rows.id directly (not
  // a JSON path). Empty/non-numeric values return no rows.
  const numericId = Number(rowId);
  if (!Number.isFinite(numericId)) return [];
  const rows = await dbAll(
    `SELECT id, base_id, table_id, data, created_at, updated_at
       FROM table_rows
      WHERE table_id = ?
        AND id = ?
      ORDER BY id DESC`,
    [ticketsTableId, numericId]
  );
  return rows;
}

// Sanitises arbitrary input into a clean array of unique numeric ids.
// Accepts arrays of numbers/strings; tolerates loose CSV strings (the
// frontend normalises these but the backend is the source of truth).
function normaliseIdList(input) {
  if (input == null) return [];
  const raw = Array.isArray(input)
    ? input
    : (typeof input === 'string' ? input.split(/[\s,]+/) : []);
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const n = Number(item);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

async function fetchTicketsByRowIds(ticketsTableId, ids, dbAll) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  // Preserve client-specified order via array_position(); rows missing from
  // table_rows (deleted/wrong table) are silently dropped.
  const rows = await dbAll(
    `SELECT id, base_id, table_id, data, created_at, updated_at
       FROM table_rows
      WHERE table_id = ?
        AND id = ANY(?::int[])
      ORDER BY array_position(?::int[], id)`,
    [ticketsTableId, ids, ids]
  );
  return rows;
}

/**
 * Build the route. Accepts injected dbGet/dbAll/loadWidget for testability.
 * Tests can call `buildResolveTicketsRouter` directly with mocks; production
 * uses the default export which wires real dependencies.
 */
export function buildResolveTicketsRouter({
  dbGet: dbGetImpl = realDbGet,
  dbAll: dbAllImpl = realDbAll,
  loadWidget = getWidgetById,
} = {}) {
  const r = express.Router();

  r.post('/widgets/:widgetId/resolve-tickets', async (req, res) => {
    try {
      const widgetId = parseInt(req.params.widgetId, 10);
      if (!Number.isFinite(widgetId)) {
        return badRequest(res, 'Invalid widget id');
      }

      const widget = await loadWidget(widgetId);
      if (!widget) {
        return notFound(res, 'Widget');
      }

      if (!widgetSupportsTicketResolution(widget)) {
        return res.status(400).json({
          error: `Widget ${widgetId} does not support ticket resolution`,
        });
      }

      const cfg = widget.config || {};
      const ticketsTableId = resolveTicketsTableId(cfg);
      const idToNameMap = await buildIdToNameMap(ticketsTableId, dbAllImpl);

      const filter = cfg.filter;
      // `ids` is only honoured when column === 'id' — see ADR-0012 §4.8.
      const filterIds = (filter && typeof filter === 'object' && filter.column === 'id')
        ? normaliseIdList(filter.ids)
        : [];
      const filterActive = filter
        && typeof filter === 'object'
        && typeof filter.column === 'string'
        && filter.column.length > 0
        && (filter.use_owner_id === true
            || (typeof filter.value === 'string' && filter.value.length > 0)
            || (typeof filter.value === 'number')
            || filterIds.length > 0);

      const applied = { space_id: null };
      let rawRows = [];
      let totalOverride = null;
      let filterMode;

      if (!filterActive) {
        filterMode = 'all';
        const spaceId = widget.space_id != null ? Number(widget.space_id) : null;
        applied.space_id = spaceId;
        const rawLimit = Number(req.body?.limit ?? req.query?.limit ?? 100);
        const rawOffset = Number(req.body?.offset ?? req.query?.offset ?? 0);
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;
        const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
        const result = await fetchAllTicketsFromTable(
          ticketsTableId, spaceId, limit, offset, dbGetImpl, dbAllImpl,
        );
        rawRows = result.rows;
        totalOverride = result.total;
      } else {
        const columnName = String(filter.column);
        // Reject anything outside the standard column-name charset before
        // interpolating into SQL (defence in depth — query uses ? binding).
        if (!/^[a-zA-Z0-9_]+$/.test(columnName)) {
          return res.status(400).json({ error: 'invalid_filter_column', column: columnName });
        }

        // Multi-id branch wins when present: column must be 'id' (validated
        // when building filterIds above) and ids array is non-empty.
        if (filterIds.length > 0) {
          filterMode = 'manual-ids';
          applied.column = 'id';
          applied.ids = filterIds;
          rawRows = await fetchTicketsByRowIds(ticketsTableId, filterIds, dbAllImpl);
          const tickets = rawRows.map(r => parseTicketRow(r, idToNameMap));
          return success(res, {
            tickets,
            total: tickets.length,
            filter_mode: filterMode,
            applied_filter: applied,
          });
        }

        filterMode = 'column-filter';
        let resolvedValue;
        if (filter.use_owner_id === true) {
          if (widget.owner_kind !== 'document' || widget.owner_id == null) {
            return res.status(400).json({ error: 'use_owner_id_requires_document_owner' });
          }
          resolvedValue = String(widget.owner_id);
        } else {
          resolvedValue = String(filter.value);
        }

        applied.column = columnName;
        applied.value = resolvedValue;

        if (columnName === 'id') {
          // `id` is the table_rows row id, not a JSON column — skip the
          // table_columns existence check and query by primary key.
          rawRows = await fetchTicketByRowId(ticketsTableId, resolvedValue, dbAllImpl);
        } else {
          const colRow = await dbGetImpl(
            'SELECT id FROM table_columns WHERE table_id = ? AND column_name = ?',
            [ticketsTableId, columnName],
          );
          if (!colRow) {
            return res.status(400).json({ error: 'unknown_filter_column', column: columnName });
          }
          rawRows = await fetchTicketsByColumnValue(
            ticketsTableId, columnName, resolvedValue, dbAllImpl,
          );
        }
      }

      const tickets = rawRows.map(r => parseTicketRow(r, idToNameMap));

      return success(res, {
        tickets,
        total: totalOverride != null ? totalOverride : tickets.length,
        filter_mode: filterMode,
        applied_filter: applied,
      });
    } catch (err) {
      apiLogger.error({ err }, 'POST /widgets/:widgetId/resolve-tickets error');
      return error(res, 'RESOLVE_TICKETS_FAILED', err.message || 'Failed to resolve tickets', 500);
    }
  });

  return r;
}

const router = express.Router();
router.use(buildResolveTicketsRouter());

export default router;
