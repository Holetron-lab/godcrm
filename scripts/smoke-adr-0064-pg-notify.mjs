#!/usr/bin/env node
// ADR-0064 WP-A smoke — verifies cluster-wide cache eviction via pg_notify.
//
// Opens two independent `pg.Client` connections, both LISTEN on
// `chat_prefs_invalidate`. Then a third client fires `pg_notify` and we
// assert both listeners receive the payload. Mirrors how two PM2 workers
// (or PROD + DEV behind the same DB) coordinate cache invalidation.
//
// Run on DEV against godcrm_test:
//   POSTGRES_DB=godcrm_test BUSINESS_CRM_IS_PROD=0 node scripts/smoke-adr-0064-pg-notify.mjs
//
// Aborts (exit 2) on a PROD host via the boot guard.

import '../backend/test/setup.js';
import pg from 'pg';

const CHANNEL = 'chat_prefs_invalidate';

function makeClient() {
  return new pg.Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER || 'godcrm',
    password: process.env.POSTGRES_PASSWORD || 'godcrm_dev_2026',
  });
}

async function main() {
  const listenerA = makeClient();
  const listenerB = makeClient();
  const sender = makeClient();

  await Promise.all([listenerA.connect(), listenerB.connect(), sender.connect()]);

  const received = { A: [], B: [] };
  listenerA.on('notification', (msg) => { if (msg.channel === CHANNEL) received.A.push(msg.payload); });
  listenerB.on('notification', (msg) => { if (msg.channel === CHANNEL) received.B.push(msg.payload); });

  await listenerA.query(`LISTEN ${CHANNEL}`);
  await listenerB.query(`LISTEN ${CHANNEL}`);

  // Three sample payloads matching the resolver's three invalidation shapes.
  const payloads = [
    { user_id: 1, conversation_id: 100 },
    { space_id: 11 },
    { scope: 'global', key: 'chat_notifications_global' },
  ];

  for (const p of payloads) {
    await sender.query(`SELECT pg_notify($1, $2)`, [CHANNEL, JSON.stringify(p)]);
  }

  // PG notifications are dispatched on next message-pump tick after commit.
  // Allow up to 1s for the round-trip.
  await new Promise((r) => setTimeout(r, 500));

  await Promise.all([listenerA.end(), listenerB.end(), sender.end()]);

  const ok = received.A.length === payloads.length && received.B.length === payloads.length;
  if (!ok) {
    console.error('SMOKE FAILED — payload counts:', received);
    process.exit(1);
  }

  // Verify payload integrity end-to-end on one listener.
  for (let i = 0; i < payloads.length; i += 1) {
    const sent = payloads[i];
    const got = JSON.parse(received.A[i]);
    if (JSON.stringify(sent) !== JSON.stringify(got)) {
      console.error(`SMOKE FAILED — payload ${i} mismatch:`, { sent, got });
      process.exit(1);
    }
  }

  console.log(`[smoke-adr-0064] OK — ${payloads.length} payloads × 2 listeners delivered`);
  process.exit(0);
}

main().catch((err) => {
  console.error('SMOKE ERROR:', err);
  process.exit(1);
});
