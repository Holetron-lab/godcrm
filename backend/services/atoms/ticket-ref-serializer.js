// ADR-0012 §Phase 5 (M3 backend) — ticket_ref atom serializer + write-path
// validation.
//
// A `ticket_ref` atom embeds a single Tickets-table row inline inside a
// document. Three render modes:
//   - `live`     → frontend always re-fetches the ticket; snapshot is unused
//   - `snapshot` → frontend uses the frozen `props.snapshot`, no fetch
//   - `hybrid`   → instant snapshot, background refresh
//
// Atom shape (table_rows in atoms_v2 / table 3574):
//   {
//     type:        'ticket_ref',
//     widget_ref:  <int>            // parent documents-widget id
//     props: {
//       ticket_id:    <int>         // row id in tickets_table_id of parent widget
//       mode:         'live'|'snapshot'|'hybrid'
//       display_mode: 'card'|'inline'|'status-only'
//       snapshot?:    <SnapshotShape>   // populated by backend on upsert when
//                                       //   mode != 'live' and client did not
//                                       //   supply one (or to refresh a stale one)
//     }
//   }
//
// Snapshot shape (slim projection — see also resolveTicketRefController.js):
//   {
//     title:           <string>     // ticket.what (preferred) or ticket.title
//     status:          <string|number>  // ticket.state (the select id), or the
//                                       //   `status` field if present
//     assigned_to?:    <string|number>  // ticket.assigned_to (option value),
//                                       //   or display label if known
//     updated_at:      <ISO string>     // ticket row updated_at
//     snapshotted_at:  <ISO string>     // server clock at snapshot time
//   }
//
// This module is pure / DI-friendly — no DB connection imported. The
// validator accepts injected `loadWidget` / `loadTicket` so unit tests can
// run in isolation. The default loaders live next to the route handler.

const VALID_MODES = ['live', 'snapshot', 'hybrid'];
const VALID_DISPLAY_MODES = ['card', 'inline', 'status-only'];
const TICKET_REF_TYPE = 'ticket_ref';

// Default tickets table id — kept in sync with resolveTicketsController.js.
// When a widget's config doesn't carry `tickets_table_id` we fall back to the
// canonical Tickets table (1708).
export const DEFAULT_TICKETS_TABLE_ID = 1708;

/**
 * Pull `tickets_table_id` out of a parsed widget config. Mirrors the rules in
 * resolveTicketsController.resolveTicketsTableId so atoms and resolves stay
 * aligned.
 *
 * Returns `null` if the widget config does not declare a tickets binding at
 * all — callers can use that to reject `ticket_ref` atoms attached to a
 * widget that isn't tickets-linked.
 */
export function readTicketsTableId(config) {
  const cfg = config && typeof config === 'object' ? config : {};
  if (cfg.tickets_table_id != null) return Number(cfg.tickets_table_id);
  const binding = cfg.ticket_binding || {};
  if (binding.table_id != null) return Number(binding.table_id);
  if (binding.tickets_table_id != null) return Number(binding.tickets_table_id);
  return null;
}

/**
 * Build a snapshot from a full ticket row.
 *
 * Accepts either the raw `table_rows` row ({ id, data, updated_at, ... }) OR
 * an already-flattened ticket object whose top-level keys ARE the column
 * names (the shape returned by GET /tables/:id/rows/:rowId — see
 * tableRowGetController). Both shapes occur in callers, so we normalise.
 *
 * `now` is injectable for deterministic tests.
 *
 * @param {object} ticketRow
 * @param {object} [opts]
 * @param {() => Date} [opts.now] - clock injection (defaults to `new Date`)
 * @returns {{
 *   title: string|null,
 *   status: string|number|null,
 *   assigned_to: string|number|null,
 *   updated_at: string|null,
 *   snapshotted_at: string,
 * }}
 */
export function serializeTicketSnapshot(ticketRow, { now = () => new Date() } = {}) {
  const row = ticketRow && typeof ticketRow === 'object' ? ticketRow : {};
  // Accept both raw rows (data is the JSON map) and flattened rows (column
  // names live at top level).
  let data;
  if (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) {
    data = row.data;
  } else if (typeof row.data === 'string') {
    try { data = JSON.parse(row.data); } catch { data = {}; }
  } else {
    data = row;
  }

  const title = data.what != null
    ? String(data.what)
    : (data.title != null ? String(data.title) : null);

  const status = data.state != null
    ? data.state
    : (data.status != null ? data.status : null);

  const assigned_to = data.assigned_to != null ? data.assigned_to : null;

  // Prefer the row's stored updated_at if it sits at the row level; fall back
  // to data.updated_at for flattened shapes.
  let updated_at = null;
  if (row.updated_at) {
    updated_at = row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : String(row.updated_at);
  } else if (data.updated_at) {
    updated_at = data.updated_at instanceof Date
      ? data.updated_at.toISOString()
      : String(data.updated_at);
  }

  return {
    title,
    status,
    assigned_to,
    updated_at,
    snapshotted_at: now().toISOString(),
  };
}

/**
 * Returns true if `data` looks like a ticket_ref atom payload.
 */
export function isTicketRefAtom(data) {
  return !!(data && typeof data === 'object' && data.type === TICKET_REF_TYPE);
}

/**
 * Validate (and possibly hydrate) a ticket_ref atom on the write path.
 *
 * Returns an object with shape:
 *   { ok: true, data: <maybe-mutated atom data> }
 *   { ok: false, status: number, error: string, code?: string, field?: string }
 *
 * Short-circuits to ok:true when:
 *   - tableId != atomsV2TableId
 *   - data isn't a ticket_ref atom
 *
 * Validation rules:
 *   - props is required (object)
 *   - props.ticket_id   — required positive integer; must exist in the
 *                         parent widget's tickets table
 *   - props.mode        — must be one of VALID_MODES
 *   - props.display_mode — must be one of VALID_DISPLAY_MODES
 *   - widget_ref        — required positive integer, must resolve to a
 *                         documents-widget that has a tickets binding (or
 *                         falls through to DEFAULT_TICKETS_TABLE_ID)
 *
 * Hydration rule:
 *   - if mode != 'live' AND props.snapshot is missing/null, build one from
 *     the live ticket row (using the same projection as the resolve endpoint).
 *
 * The mutated atom data is returned; callers should use it as the value to
 * persist (a no-op for live mode or pre-populated snapshots).
 *
 * @param {object} args
 * @param {number|string} args.tableId
 * @param {object} args.data
 * @param {number} args.atomsV2TableId
 * @param {(widgetId:number) => Promise<object|null>} args.loadWidget
 * @param {(ticketsTableId:number, ticketId:number) => Promise<object|null>} args.loadTicket
 * @param {() => Date} [args.now]
 */
export async function validateTicketRefAtom({
  tableId,
  data,
  atomsV2TableId,
  loadWidget,
  loadTicket,
  now = () => new Date(),
}) {
  if (Number(tableId) !== Number(atomsV2TableId)) return { ok: true, data };
  if (!isTicketRefAtom(data)) return { ok: true, data };

  const props = data.props;
  if (!props || typeof props !== 'object' || Array.isArray(props)) {
    return {
      ok: false,
      status: 400,
      code: 'TICKET_REF_INVALID_PROPS',
      field: 'props',
      error: 'ticket_ref atom requires an object `props`',
    };
  }

  const ticketId = Number(props.ticket_id);
  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return {
      ok: false,
      status: 400,
      code: 'TICKET_REF_INVALID_TICKET_ID',
      field: 'props.ticket_id',
      error: 'ticket_ref atom requires positive integer `props.ticket_id`',
    };
  }

  const mode = props.mode;
  if (!VALID_MODES.includes(mode)) {
    return {
      ok: false,
      status: 400,
      code: 'TICKET_REF_INVALID_MODE',
      field: 'props.mode',
      error: `props.mode must be one of: ${VALID_MODES.join(', ')}`,
    };
  }

  const displayMode = props.display_mode;
  if (!VALID_DISPLAY_MODES.includes(displayMode)) {
    return {
      ok: false,
      status: 400,
      code: 'TICKET_REF_INVALID_DISPLAY_MODE',
      field: 'props.display_mode',
      error: `props.display_mode must be one of: ${VALID_DISPLAY_MODES.join(', ')}`,
    };
  }

  const widgetRef = Number(data.widget_ref);
  if (!Number.isInteger(widgetRef) || widgetRef <= 0) {
    return {
      ok: false,
      status: 400,
      code: 'TICKET_REF_INVALID_WIDGET_REF',
      field: 'widget_ref',
      error: 'ticket_ref atom requires positive integer `widget_ref`',
    };
  }

  // Resolve parent widget → tickets_table_id. We accept widgets that don't
  // explicitly declare a `tickets_table_id` (falling back to
  // DEFAULT_TICKETS_TABLE_ID) so legacy documents-widgets keep working.
  const widget = await loadWidget(widgetRef);
  if (!widget) {
    return {
      ok: false,
      status: 400,
      code: 'TICKET_REF_WIDGET_NOT_FOUND',
      field: 'widget_ref',
      error: `widget ${widgetRef} not found`,
    };
  }
  const ticketsTableId = readTicketsTableId(widget.config) ?? DEFAULT_TICKETS_TABLE_ID;

  const ticket = await loadTicket(ticketsTableId, ticketId);
  if (!ticket) {
    return {
      ok: false,
      status: 400,
      code: 'TICKET_REF_TICKET_NOT_FOUND',
      field: 'props.ticket_id',
      error: `ticket ${ticketId} not found in tickets table ${ticketsTableId}`,
    };
  }

  // Hydrate snapshot if needed.
  let nextProps = props;
  const needsSnapshot = mode !== 'live' && (
    props.snapshot == null ||
    typeof props.snapshot !== 'object'
  );
  if (needsSnapshot) {
    const snapshot = serializeTicketSnapshot(ticket, { now });
    nextProps = { ...props, snapshot };
  }

  return { ok: true, data: { ...data, props: nextProps } };
}

// Test introspection helpers — not part of the public contract.
export const _internals = {
  VALID_MODES,
  VALID_DISPLAY_MODES,
  TICKET_REF_TYPE,
};
