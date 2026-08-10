/**
 * Widget ticket-ref resolution controller — ADR-0012 §Phase 5 (M3 backend).
 *
 *   GET /api/v3/widgets/:widgetId/tickets/:ticketId/resolve
 *
 * Returns the live ticket row plus a slim snapshot projection so a
 * `ticket_ref` atom rendered in any of {live, snapshot, hybrid} modes can
 * always feed off the same endpoint.
 *
 * Response shape (success):
 *   {
 *     ticket: { id, base_id, table_id, data, created_at, updated_at },
 *     snapshot: {
 *       title:          string|null,
 *       status:         string|number|null,
 *       assigned_to:    string|number|null,
 *       updated_at:     ISO-string|null,
 *       snapshotted_at: ISO-string,
 *     }
 *   }
 *
 * Auth — relies on the route being mounted behind `authenticate`
 * (server.js → `app.use('/api/v3', authenticate, widgetRoutesV3)`), same as
 * resolveTicketsController.
 *
 * Error shapes:
 *   - widgetId / ticketId not numeric              → 400 generic
 *   - widget not found                             → 404 (Widget)
 *   - widget not tickets-linked (no tickets_table_id and no fallback)
 *                                                  → 400 with body
 *      { error: 'WIDGET_NOT_TICKETS_LINKED', code: 'WIDGET_NOT_TICKETS_LINKED' }
 *      (matches the contract requested by the frontend agent)
 *   - ticket not found in resolved tickets_table_id
 *                                                  → 404 (Ticket)
 *
 * The "widget is tickets-linked" gate covers two cases:
 *   - `tickets_list` preset                        → always linked
 *   - documents-widget with `tickets_table_id` (or `ticket_binding.table_id`)
 *
 * For documents-widgets without an explicit binding we fall back to the
 * canonical Tickets table 1708 — same default as resolveTicketsController.
 */
import express from 'express';
import { getWidgetById } from '../../../services/WidgetService.js';
import { dbAll as realDbAll, dbGet as realDbGet } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, error, notFound } from '../../../utils/response.js';
import {
  serializeTicketSnapshot,
  readTicketsTableId,
  DEFAULT_TICKETS_TABLE_ID,
} from '../../../services/atoms/ticket-ref-serializer.js';

const NOT_TICKETS_LINKED = {
  status: 400,
  body: { error: 'WIDGET_NOT_TICKETS_LINKED', code: 'WIDGET_NOT_TICKETS_LINKED' },
};

/**
 * Build the column-id → column-name map for a tickets table so we can return
 * rows in the same shape as GET /tables/:tableId/rows.
 *
 * Mirrors `buildIdToNameMap` in resolveTicketsController.js but lives here to
 * avoid cross-controller imports during early development.
 */
async function buildIdToNameMap(tableId, dbAll) {
  const cols = await dbAll(
    'SELECT id, column_name FROM table_columns WHERE table_id = ?',
    [tableId]
  );
  const map = {};
  for (const c of cols) map[String(c.id)] = c.column_name;
  return map;
}

/**
 * Re-shape a raw `table_rows` row to the shape the rest of the API uses.
 * Same projection as parseTicketRow in resolveTicketsController.js.
 */
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

/**
 * Decide whether a widget exposes a tickets binding (and therefore can host
 * ticket_ref atoms / answer this endpoint).
 *
 * A widget is "tickets-linked" when:
 *   - preset_name === 'tickets_list', OR
 *   - widget.config has any tickets_table_id-style key, OR
 *   - it's a documents preset (preset_name in {'documents','documents_legacy'}
 *     OR config.registry_table_id is set) — these fall back to
 *     DEFAULT_TICKETS_TABLE_ID for ticket_ref atoms.
 */
function isWidgetTicketsLinked(widget) {
  if (!widget) return false;
  if (widget.preset_name === 'tickets_list') return true;
  const cfg = widget.config || {};
  if (readTicketsTableId(cfg) != null) return true;
  if (widget.preset_name === 'documents' || widget.preset_name === 'documents_legacy') return true;
  if (cfg.registry_table_id != null) return true;
  return false;
}

/**
 * Resolve the tickets table id a widget points at. For tickets-linked widgets
 * without an explicit binding we fall back to DEFAULT_TICKETS_TABLE_ID.
 */
function resolveTicketsTableIdForWidget(widget) {
  const cfg = widget.config || {};
  const explicit = readTicketsTableId(cfg);
  if (explicit != null) return explicit;
  return DEFAULT_TICKETS_TABLE_ID;
}

/**
 * Build the route. Accepts injected dbGet/dbAll/loadWidget for testability.
 *
 * Production callers use the `router` default export which wires up the real
 * dependencies. Tests can call `buildResolveRouter` directly with mocks.
 */
export function buildResolveRouter({
  dbGet: dbGetImpl,
  dbAll: dbAllImpl,
  loadWidget = getWidgetById,
  now = () => new Date(),
} = {}) {
  const r = express.Router();

  r.get('/widgets/:widgetId/tickets/:ticketId/resolve', async (req, res) => {
    try {
      const widgetId = parseInt(req.params.widgetId, 10);
      const ticketId = parseInt(req.params.ticketId, 10);
      if (!Number.isFinite(widgetId) || !Number.isFinite(ticketId)) {
        return error(res, 'BAD_REQUEST', 'widgetId and ticketId must be integers', 400);
      }

      const widget = await loadWidget(widgetId);
      if (!widget) {
        return notFound(res, 'Widget');
      }

      if (!isWidgetTicketsLinked(widget)) {
        return res.status(NOT_TICKETS_LINKED.status).json(NOT_TICKETS_LINKED.body);
      }

      const ticketsTableId = resolveTicketsTableIdForWidget(widget);

      const row = await dbGetImpl(
        `SELECT id, base_id, table_id, data, created_at, updated_at
           FROM table_rows
          WHERE id = ? AND table_id = ?`,
        [ticketId, ticketsTableId]
      );
      if (!row) {
        return notFound(res, 'Ticket');
      }

      const idToNameMap = await buildIdToNameMap(ticketsTableId, dbAllImpl);
      const ticket = parseTicketRow(row, idToNameMap);
      const snapshot = serializeTicketSnapshot(ticket, { now });

      return success(res, { ticket, snapshot });
    } catch (err) {
      apiLogger.error({ err }, 'GET /widgets/:widgetId/tickets/:ticketId/resolve error');
      return error(res, 'TICKET_REF_RESOLVE_FAILED', err.message || 'Failed to resolve ticket', 500);
    }
  });

  return r;
}

// Default production router — uses real DB connection.
const router = express.Router();
router.use(buildResolveRouter({
  dbGet: realDbGet,
  dbAll: realDbAll,
}));

export default router;
