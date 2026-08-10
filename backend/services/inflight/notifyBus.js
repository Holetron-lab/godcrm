// ADR-0057-A WP-B — `chat_inflight` LISTEN bus.
//
// Mirrors the pattern from resolveChatPrefs.js (ADR-0064 WP-A): a single
// long-lived `pg.Client` per Node process holds a `LISTEN chat_inflight`,
// fans payloads out to in-process subscribers via an EventEmitter. The
// chat SSE stream (streamController.js) subscribes per-connection and
// filters by `conversation_id`.
//
// Writers (markPaused.js today, ADR-0042 FSM tomorrow) emit notifications
// from within the same SQL statement as the row mutation — see markPaused.js.
// Payload shape (JSON.parse-able string):
//   { inflight_id, conversation_id, ticket_id?, agent_slug, status,
//     reason?, resume_at?, started_at?, paused_at?, metadata?, source }
//
// Failure mode: best-effort. If LISTEN init fails, SSE clients still get
// the snapshot via the per-poll `active_agents` array; only the live push
// is lost. Reconnect on client error.

import pg from 'pg';
import { EventEmitter } from 'node:events';
import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'chat_inflight_bus' });

const CHANNEL = 'chat_inflight';

/** @type {pg.Client|null} */
let _listenClient = null;
/** @type {NodeJS.Timeout|null} */
let _reconnectTimer = null;

// EventEmitter sits in module scope so handlers registered before the
// listener is up still receive events once it connects. Subscribers may
// register MANY listeners (one per open SSE stream); the cap covers the
// expected concurrent-chat ceiling for alpha (Path C ~150 testers).
const _bus = new EventEmitter();
_bus.setMaxListeners(500);

function buildConnectionConfig() {
  if (process.env.POSTGRES_URL) return { connectionString: process.env.POSTGRES_URL };
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'godcrm',
    user: process.env.POSTGRES_USER || 'godcrm',
    password: process.env.POSTGRES_PASSWORD,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
}

async function connectListener() {
  if (_listenClient) return _listenClient;
  const client = new pg.Client(buildConnectionConfig());
  await client.connect();

  client.on('notification', (msg) => {
    if (msg.channel !== CHANNEL) return;
    let payload = null;
    try {
      payload = msg.payload ? JSON.parse(msg.payload) : {};
    } catch (err) {
      log.warn({ err: err.message, raw: msg.payload }, 'chat_inflight: malformed payload, dropping');
      return;
    }
    _bus.emit('inflight', payload);
  });

  client.on('error', (err) => {
    log.error({ err: err.message }, 'chat_inflight LISTEN client error — scheduling reconnect');
    _listenClient = null;
    scheduleReconnect();
  });
  client.on('end', () => {
    log.warn({}, 'chat_inflight LISTEN client ended — scheduling reconnect');
    _listenClient = null;
    scheduleReconnect();
  });

  await client.query(`LISTEN ${CHANNEL}`);
  _listenClient = client;
  log.info({ channel: CHANNEL }, 'chat_inflight LISTEN bus started');
  return client;
}

function scheduleReconnect() {
  if (_reconnectTimer) return;
  _reconnectTimer = setTimeout(async () => {
    _reconnectTimer = null;
    try {
      await connectListener();
    } catch (err) {
      log.warn({ err: err.message }, 'chat_inflight reconnect failed — will retry');
      scheduleReconnect();
    }
  }, 2000);
}

/**
 * Best-effort start. Idempotent. Caller swallows promise rejections — bus
 * stays a no-op if connect fails.
 */
export async function startInflightBus() {
  try {
    await connectListener();
  } catch (err) {
    log.warn({ err: err.message }, 'chat_inflight LISTEN bus failed to start — push-deltas disabled');
    scheduleReconnect();
  }
}

/** Stop the bus. Safe to call multiple times. Test-only. */
export async function stopInflightBus() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (!_listenClient) return;
  try { await _listenClient.end(); } catch { /* ignore */ }
  _listenClient = null;
}

/**
 * Subscribe to inflight deltas. Returns an unsubscribe fn — callers MUST
 * call it on disconnect to avoid leaks (EventEmitter cap = 500).
 *
 * @param {(payload: object) => void} handler
 * @returns {() => void}
 */
export function subscribeInflight(handler) {
  _bus.on('inflight', handler);
  return () => _bus.off('inflight', handler);
}

/** Test hook — emit a fake delta without touching Postgres. */
export function _emitForTest(payload) {
  _bus.emit('inflight', payload);
}
