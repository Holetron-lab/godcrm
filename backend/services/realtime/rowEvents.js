/**
 * Row-change fan-out: every write to `table_rows` (HTTP, agent tools, automations)
 * calls `notifyRowChange()`, which publishes a tiny envelope on one Postgres
 * NOTIFY channel. The SSE controller (`tableRowEventsController.js`) LISTENs on
 * that channel and pushes the envelope to every browser that has the table open.
 *
 * Postgres is the bus on purpose: writers live in several processes (godcrm,
 * mcp-server, bdd-runner), an in-memory emitter would only reach the local one.
 * The envelope carries ids only — the client refetches the row, so the payload
 * never nears the 8000-byte NOTIFY limit and never leaks data past access checks.
 */
import { dbRun } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';

export const ROW_EVENTS_CHANNEL = 'table_rows_changed';
export const ROW_ACTIONS = new Set(['created', 'updated', 'deleted']);

/** @returns {{table_id:number,row_id:string,action:string,source:string,ts:string}|null} */
export function buildRowChangePayload({ tableId, rowId, action = 'updated', source = 'api' }) {
  const table_id = Number(tableId);
  if (!Number.isInteger(table_id) || table_id <= 0) return null;
  if (rowId === undefined || rowId === null || rowId === '') return null;
  if (!ROW_ACTIONS.has(action)) return null;
  return { table_id, row_id: String(rowId), action, source: String(source), ts: new Date().toISOString() };
}

/** Parse a NOTIFY payload; null when malformed (never throws). */
export function parseRowChangePayload(raw) {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    return buildRowChangePayload({
      tableId: parsed.table_id,
      rowId: parsed.row_id,
      action: parsed.action,
      source: parsed.source,
    });
  } catch {
    return null;
  }
}

/**
 * Best-effort, fire-and-forget: a failed NOTIFY must never fail the write.
 * @returns {Promise<boolean>} true when the notification was sent
 */
export async function notifyRowChange(change) {
  const payload = buildRowChangePayload(change);
  if (!payload) return false;
  try {
    await dbRun('SELECT pg_notify($1, $2)', [ROW_EVENTS_CHANNEL, JSON.stringify(payload)]);
    return true;
  } catch (err) {
    apiLogger.warn({ err: err.message, ...payload }, 'notifyRowChange failed (non-blocking)');
    return false;
  }
}

/** Same as notifyRowChange, for N rows of one table (batch routes). */
export function notifyRowChanges(tableId, rowIds, action, source) {
  for (const rowId of rowIds || []) {
    void notifyRowChange({ tableId, rowId, action, source });
  }
}
