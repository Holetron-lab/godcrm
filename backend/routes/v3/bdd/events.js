/**
 * GET /api/v3/bdd/events — Server-Sent Events stream that bridges PostgreSQL
 * LISTEN/NOTIFY into the browser. Used by the BDD panel to update criterion
 * states in near-real-time.
 */

import pg from 'pg';
import { apiLogger } from '../../../utils/logger.js';
import { error } from '../../../utils/response.js';

const SSE_CHANNELS = [
  'bdd.criterion.claimed',
  'bdd.criterion.verified',
  'bdd.criterion.confirmed', // legacy alias — finalizeCriterion now emits .verified
  'bdd.criterion.waived',
  'bdd.criterion.failed',
  'bdd.criterion.regressed', // ADR-0003 §C-3
  'bdd.criterion.escalated', // ADR-0003 Phase 2 (T-127904)
  'bdd.criterion.resolved',  // ADR-0003 Phase 2 (T-127904)
];

let sseListenerClient = null;
const sseSubscribers = new Set();

async function ensureSseListener() {
  if (sseListenerClient) return;
  const client = new pg.Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'godcrm_prod',
    user: process.env.POSTGRES_USER || 'godcrm',
    password: process.env.POSTGRES_PASSWORD,
  });
  await client.connect();
  for (const ch of SSE_CHANNELS) {
    // PG channel names with dots need quoting
    await client.query(`LISTEN "${ch}"`);
  }
  client.on('notification', (msg) => {
    const line = `event: ${msg.channel}\ndata: ${msg.payload || '{}'}\n\n`;
    for (const write of sseSubscribers) {
      try { write(line); } catch (_) { /* ignore dead subs */ }
    }
  });
  client.on('error', (err) => {
    apiLogger.warn({ err: err.message }, 'BDD SSE LISTEN client error; will lazily reconnect');
    try { client.end().catch(() => {}); } catch (_) { /* noop */ }
    sseListenerClient = null;
  });
  sseListenerClient = client;
  apiLogger.info({ channels: SSE_CHANNELS }, 'BDD SSE LISTEN client connected');
}

export default function registerEventRoutes(router) {
  router.get('/events', async (req, res) => {
    try {
      await ensureSseListener();
    } catch (err) {
      apiLogger.error({ err: err.message }, 'BDD SSE LISTEN setup failed');
      return error(res, 'SSE_SETUP_FAILED', err.message, 500);
    }

    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    res.write(`event: hello\ndata: {"ok":true,"channels":${JSON.stringify(SSE_CHANNELS)}}\n\n`);

    const write = (s) => res.write(s);
    sseSubscribers.add(write);

    const keepalive = setInterval(() => {
      try { res.write(`: keepalive ${Date.now()}\n\n`); } catch (_) { /* dead */ }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepalive);
      sseSubscribers.delete(write);
    });
  });
}
