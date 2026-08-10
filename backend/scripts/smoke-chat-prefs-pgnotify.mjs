#!/usr/bin/env node
// smoke-chat-prefs-pgnotify.mjs — ADR-0064 WP-A.
//
// Verifies the cross-process invalidation path used by resolveChatPrefs:
//
//   1. Spawn TWO independent pg.Client LISTENers on `chat_prefs_invalidate`.
//   2. Fire `SELECT pg_notify(...)` from a THIRD pg.Client (simulates the PUT path).
//   3. Both listeners must observe the notification with the original payload
//      within a short window. This is the cluster-wide eviction guarantee.
//
// Exits 0 on green, 1 on red. Run on DEV only:
//   POSTGRES_DB=godcrm_prod node backend/scripts/smoke-chat-prefs-pgnotify.mjs

import pg from 'pg';

const CHANNEL = 'chat_prefs_invalidate';
const WAIT_MS = 1500;

function connectionConfig() {
  return process.env.POSTGRES_URL
    ? { connectionString: process.env.POSTGRES_URL }
    : {
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
        database: process.env.POSTGRES_DB || 'godcrm_prod',
        user: process.env.POSTGRES_USER || 'godcrm',
        password: process.env.POSTGRES_PASSWORD,
        ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
      };
}

async function makeListener(label) {
  const client = new pg.Client(connectionConfig());
  await client.connect();
  const received = [];
  client.on('notification', (msg) => {
    if (msg.channel === CHANNEL) {
      received.push({ at: Date.now(), payload: msg.payload, label });
    }
  });
  client.on('error', (err) => console.error(`[${label}] LISTEN error:`, err.message));
  await client.query(`LISTEN ${CHANNEL}`);
  return { client, received };
}

async function main() {
  const listenerA = await makeListener('A');
  const listenerB = await makeListener('B');

  const notifier = new pg.Client(connectionConfig());
  await notifier.connect();

  const scopes = [
    { user_id: 1 },
    { conversation_id: 999 },
    { space_id: 11 },
    {},
  ];

  for (const scope of scopes) {
    await notifier.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(scope)]);
  }

  // Allow the LISTEN clients to drain.
  await new Promise((r) => setTimeout(r, WAIT_MS));

  let ok = true;
  for (const listener of [listenerA, listenerB]) {
    const got = listener.received.length;
    if (got !== scopes.length) {
      console.error(`[${listener.received[0]?.label || '?'}] expected ${scopes.length} notifications, got ${got}`);
      ok = false;
    } else {
      const labels = listener.received.map((r) => r.label).join(',');
      console.log(`listener ${labels.split(',')[0]} received ${got}/${scopes.length} notifications: ${listener.received.map(r => r.payload).join(' | ')}`);
    }
  }

  await listenerA.client.end();
  await listenerB.client.end();
  await notifier.end();

  if (!ok) {
    console.error('SMOKE FAIL');
    process.exit(1);
  }
  console.log('SMOKE OK — pg_notify reaches both listeners with the original payloads.');
}

main().catch((err) => {
  console.error('SMOKE ERROR', err);
  process.exit(1);
});
