/**
 * GET /api/v3/tables/:tableId/events — Server-Sent Events stream of row changes
 * for one table. Bridges the `table_rows_changed` NOTIFY channel (see
 * services/realtime/rowEvents.js) to the browser so an open grid picks up
 * edits made by other users, agents and automations without a reload.
 *
 * Events: `row.created` / `row.updated` / `row.deleted`, data = the envelope
 * `{ table_id, row_id, action, source, ts }`. Same LISTEN-client pattern as
 * routes/v3/bdd/events.js.
 */
import express from 'express';
import pg from 'pg';
import { apiLogger } from '../../../utils/logger.js';
import { error, forbidden } from '../../../utils/response.js';
import { checkTableAccess } from './helpers.js';
import { ROW_EVENTS_CHANNEL, parseRowChangePayload } from '../../../services/realtime/rowEvents.js';

const router = express.Router();

/** tableId → Set<write(line)> */
const subscribersByTable = new Map();
let listenerClient = null;

export function subscribeTable(tableId, write) {
  const key = Number(tableId);
  if (!subscribersByTable.has(key)) subscribersByTable.set(key, new Set());
  subscribersByTable.get(key).add(write);
  return () => {
    const set = subscribersByTable.get(key);
    if (!set) return;
    set.delete(write);
    if (set.size === 0) subscribersByTable.delete(key);
  };
}

/** Fan one NOTIFY payload out to the table's subscribers. Exported for tests. */
export function dispatchRowChange(raw) {
  const payload = parseRowChangePayload(raw);
  if (!payload) return 0;
  const set = subscribersByTable.get(payload.table_id);
  if (!set || set.size === 0) return 0;
  const line = `event: row.${payload.action}\ndata: ${JSON.stringify(payload)}\n\n`;
  let delivered = 0;
  for (const write of set) {
    try { write(line); delivered++; } catch { /* dead subscriber — removed on close */ }
  }
  return delivered;
}

async function ensureListener() {
  if (listenerClient) return;
  const client = new pg.Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'godcrm_prod',
    user: process.env.POSTGRES_USER || 'godcrm',
    password: process.env.POSTGRES_PASSWORD,
  });
  await client.connect();
  await client.query(`LISTEN "${ROW_EVENTS_CHANNEL}"`);
  client.on('notification', (msg) => { dispatchRowChange(msg.payload); });
  client.on('error', (err) => {
    apiLogger.warn({ err: err.message }, 'row-events LISTEN client error; will lazily reconnect');
    try { client.end().catch(() => {}); } catch { /* noop */ }
    listenerClient = null;
  });
  listenerClient = client;
  apiLogger.info({ channel: ROW_EVENTS_CHANNEL }, 'row-events LISTEN client connected');
}

/** Drop the LISTEN connection (tests, graceful shutdown). Safe to call when none is open. */
export async function closeRowEventsListener() {
  const client = listenerClient;
  listenerClient = null;
  if (client) await client.end().catch(() => {});
}

router.get('/tables/:tableId(\\d+)/events', async (req, res) => {
  const { tableId } = req.params;
  try {
    const access = await checkTableAccess(tableId, req.user);
    if (!access.allowed) return forbidden(res, access.error);
    await ensureListener();
  } catch (err) {
    apiLogger.error({ err: err.message, tableId }, 'row-events SSE setup failed');
    return error(res, 'SSE_SETUP_FAILED', err.message, 500);
  }

  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`event: hello\ndata: {"ok":true,"table_id":${Number(tableId)}}\n\n`);

  const unsubscribe = subscribeTable(tableId, (line) => res.write(line));
  const keepalive = setInterval(() => {
    try { res.write(`: keepalive ${Date.now()}\n\n`); } catch { /* dead */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepalive);
    unsubscribe();
  });
});

export default router;
