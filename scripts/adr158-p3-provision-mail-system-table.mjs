#!/usr/bin/env node
// ADR-158 §P3 Slice 1 — backfill the read-only Mail system table into every
// space that already owns a mailbox.
//
// Going forward, `POST /spaces/:id/connectors` auto-provisions the table when a
// space's first `imap` connector is created (connectors.js hook). This script
// covers the spaces whose mailbox PREDATES that hook — it just calls the same
// idempotent `ensureMailSystemTableForSpace()`, so re-running is a no-op.
//
// Scoping is enforced inside the service: only spaces with an `imap` connector
// get the table, and getMailMessagesData filters `WHERE space_id = ?` (no
// cross-space leak).
//
// Usage:
//   Agent zone (godcrm_test):        node scripts/adr158-p3-provision-mail-system-table.mjs
//   Combat (gated executor only):    node scripts/adr158-p3-provision-mail-system-table.mjs --allow-prod

import '../backend/config.js'; // side-effect: dotenv.config({override}) — must run before the DB adapter reads POSTGRES_* env
import { dbAll } from '../backend/database/connection.js';
import { ensureMailSystemTableForSpace } from '../backend/services/SystemTablesCreator.js';

const ALLOW_PROD = process.argv.includes('--allow-prod');

function guardDbTarget() {
  const db = process.env.POSTGRES_DB || '';
  const host = process.env.POSTGRES_HOST || '';
  const isProd = db === 'godcrm_prod' || process.env.BUSINESS_CRM_IS_PROD === '1';
  if (isProd && !ALLOW_PROD) {
    // ADR-0009: never let the agent-zone run touch a combat master.
    console.error(
      `\n⛔ REFUSING: POSTGRES_DB=${db || '(unset)'} host=${host || '(unset)'} looks like a combat master.\n` +
      `   Run against godcrm_test. The gated executor adds --allow-prod for the combat apply.\n`
    );
    process.exit(2);
  }
  return { db, host };
}

async function main() {
  const { db, host } = guardDbTarget();
  console.log(`[ADR-158 §P3] provisioning Mail system table — db=${db || '(unset)'} host=${host || 'localhost'}`);

  const spaces = await dbAll(
    `SELECT DISTINCT space_id FROM space_connectors WHERE type_slug = 'imap' ORDER BY space_id`
  );
  if (spaces.length === 0) {
    console.log('[ADR-158 §P3] no spaces with an imap connector — nothing to do.');
    return;
  }

  let created = 0;
  let existed = 0;
  for (const { space_id } of spaces) {
    const before = await dbAll(
      `SELECT ut.id FROM universal_tables ut
         JOIN projects p ON ut.project_id = p.id
        WHERE p.space_id = ? AND ut.sync_target = 'mail_messages'`,
      [space_id]
    );
    const tableId = await ensureMailSystemTableForSpace(space_id);
    if (tableId == null) {
      console.log(`  space ${space_id}: SKIP (no mail connector resolved)`);
      continue;
    }
    if (before.length > 0) {
      existed++;
      console.log(`  space ${space_id}: EXISTS  (Mail table id=${tableId})`);
    } else {
      created++;
      console.log(`  space ${space_id}: CREATED (Mail table id=${tableId})`);
    }
  }

  console.log(`\n[ADR-158 §P3] done — ${created} created, ${existed} already present, over ${spaces.length} mail-enabled space(s).`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('[ADR-158 §P3] FAILED:', err);
  process.exit(1);
});
