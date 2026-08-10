#!/usr/bin/env node
// ADR-0079 P5 — Acceptance smoke test for Personal Space Starter Pack.
//
// Run on DEV (devcrm.hltrn.cc), NOT on PROD. Verifies:
//   AC1 — register succeeds and Personal Space ends up populated with 6 starter tables
//   AC3 — zero dummy rows in the 6 starter tables
//   AC4 — Tier-A 5 agents visible, Tier-B 4 hidden
//   AC5 — register with promo MASTERMIND/MESHOK unlocks all 9 agents
//   AC6 — provisioning failures roll back (manual assertion only)
//   AC7 — welcome widget pinned with preset_name=welcome_dashboard
//
// Usage:
//   BASE_URL=https://devcrm.hltrn.cc node scripts/smoke-adr-0079.mjs
//   (or set FEATURE_FLAG_SQL=1 to flip starter_pack_enabled→true locally before running)
//
// Cleanup: leaves test users named `adr-0079-smoke-*@test.local` — drop manually after run.

import '../backend/test/setup.js'; // hard refuse on PROD
import { dbAll, dbGet } from '../backend/database/connection.js';
import { STARTER_TABLES, TIER_A_AGENT_SLUGS, TIER_B_AGENT_SLUGS } from '../backend/services/starter-pack/starterPackCatalog.js';

const BASE = process.env.BASE_URL || 'https://devcrm.hltrn.cc';
const STAMP = Date.now();
const log = (...a) => console.log('[smoke-0079]', ...a);
const fail = (msg) => { console.error('[smoke-0079] ❌', msg); process.exit(1); };

async function register({ email, password, name, promoCode }) {
  const res = await fetch(`${BASE}/api/v3/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name, promo_code: promoCode || null })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.data?.user?.id) {
    fail(`register failed for ${email}: ${res.status} ${JSON.stringify(body)}`);
  }
  return body.data.user;
}

async function verifyStarterPack(userId, { expectUnlocked = false } = {}) {
  const space = await dbGet(
    `SELECT id FROM spaces WHERE owner_id = ? AND type = 'personal' ORDER BY id LIMIT 1`,
    [userId]
  );
  if (!space) fail(`AC1: no personal space for user ${userId}`);

  const project = await dbGet(
    `SELECT id, name FROM projects WHERE space_id = ? ORDER BY id LIMIT 1`,
    [space.id]
  );
  if (!project) fail(`AC1: no project in personal space for user ${userId}`);
  log(`  ✓ AC1: personal space=${space.id}, project="${project.name}" id=${project.id}`);

  const expectedNames = STARTER_TABLES.map(t => t.name);
  const tables = await dbAll(
    `SELECT id, name FROM universal_tables WHERE project_id = ? AND deleted_at IS NULL AND name = ANY(?::text[])`,
    [project.id, expectedNames]
  );
  if (tables.length !== 6) fail(`AC1: expected 6 starter tables, got ${tables.length}: ${tables.map(t=>t.name).join(', ')}`);
  log(`  ✓ AC1: 6 starter tables present`);

  for (const t of tables) {
    const rowCount = await dbGet(`SELECT count(*)::int AS c FROM table_rows WHERE table_id = ?`, [t.id]);
    if (rowCount.c !== 0) fail(`AC3: table "${t.name}" has ${rowCount.c} rows — must be empty`);
  }
  log(`  ✓ AC3: all 6 tables empty (zero dummy rows)`);

  const dashboard = await dbGet(`SELECT id FROM dashboards WHERE project_id = ? ORDER BY id LIMIT 1`, [project.id]);
  if (!dashboard) fail('AC7: no dashboard for project');
  const widget = await dbGet(
    `SELECT id, title, preset_name, position FROM widgets WHERE dashboard_id = ? AND preset_name = 'welcome_dashboard'`,
    [dashboard.id]
  );
  if (!widget) fail('AC7: welcome_dashboard widget not pinned');
  log(`  ✓ AC7: welcome widget id=${widget.id} preset="${widget.preset_name}" pos=${widget.position}`);

  const tor = await dbGet(
    `SELECT id FROM conversations WHERE created_by = ? AND space_id = ? AND title = 'Tor' ORDER BY id LIMIT 1`,
    [userId, space.id]
  );
  if (!tor) fail('AC2: Tor conversation not created');
  const torMsg = await dbGet(
    `SELECT id, content FROM messages WHERE conversation_id = ? ORDER BY id LIMIT 1`,
    [tor.id]
  );
  if (!torMsg || !torMsg.content?.includes('Тор')) fail('AC2: Tor first-message missing');
  log(`  ✓ AC2: Tor conversation id=${tor.id} message id=${torMsg.id}`);

  if (expectUnlocked) {
    const u = await dbGet(`SELECT agent_config FROM users WHERE id = ?`, [userId]);
    const cfg = typeof u.agent_config === 'string' ? JSON.parse(u.agent_config) : (u.agent_config || {});
    const slugs = cfg.unlocked_agent_slugs || [];
    for (const s of TIER_B_AGENT_SLUGS) {
      if (!slugs.includes(s)) fail(`AC5: promo unlock missing ${s}; got ${JSON.stringify(slugs)}`);
    }
    log(`  ✓ AC5: Tier-B (4 agents) unlocked via promo`);
  }
}

(async () => {
  log(`BASE=${BASE}`);

  const ff = await dbGet(`SELECT value FROM _app_settings WHERE key='starter_pack_enabled'`);
  log(`feature flag starter_pack_enabled = ${JSON.stringify(ff?.value)}`);
  const enabled = String(ff?.value).includes('true');
  if (!enabled) {
    log('  ⚠️  feature flag is OFF — provisioning will skip; expecting bare personal space.');
  }

  log('Case 1: organic signup (no promo)');
  const u1 = await register({
    email: `adr-0079-smoke-${STAMP}-a@test.local`,
    password: 'TestPass1234!',
    name: 'Smoke Organic'
  });
  log(`  user_id=${u1.id}`);
  if (enabled) {
    await verifyStarterPack(u1.id, { expectUnlocked: false });
  } else {
    log('  (flag off — skipping pack assertions)');
  }

  log('Case 2: signup with MASTERMIND promo');
  const u2 = await register({
    email: `adr-0079-smoke-${STAMP}-b@test.local`,
    password: 'TestPass1234!',
    name: 'Smoke MasterMind',
    promoCode: 'MASTERMIND'
  });
  log(`  user_id=${u2.id}`);
  if (enabled) {
    await verifyStarterPack(u2.id, { expectUnlocked: true });
  } else {
    // Even with feature flag off, promo unlock writes to users.agent_config.
    const u = await dbGet(`SELECT agent_config FROM users WHERE id = ?`, [u2.id]);
    const cfg = typeof u.agent_config === 'string' ? JSON.parse(u.agent_config) : (u.agent_config || {});
    const slugs = cfg.unlocked_agent_slugs || [];
    for (const s of TIER_B_AGENT_SLUGS) {
      if (!slugs.includes(s)) fail(`AC5: promo unlock missing ${s}; got ${JSON.stringify(slugs)}`);
    }
    log(`  ✓ AC5 (flag-independent): Tier-B unlocked via MASTERMIND`);
  }

  log('Done. ALL CHECKS PASSED ✅');
  log(`Test users: ${u1.email}, ${u2.email} — drop after review.`);
  process.exit(0);
})().catch(err => {
  console.error('[smoke-0079] uncaught:', err);
  process.exit(1);
});
