#!/usr/bin/env node
/**
 * ADR-198 D6 — backfill a mailbox for every principal that predates auto-provisioning.
 *
 * Same provisioner the registration and passport hooks call
 * (`backend/services/mail/provisionMailbox.js`) — this script only iterates and reports,
 * so a backfilled mailbox and a freshly-registered one are byte-identical by construction.
 *
 * Coverage: every `users` row that is not `status='deleted'` — humans get
 * `<slug>@godcrm.ai`, agent passports get `<handle>@agents.godcrm.ai` (D4). An agent with
 * no handle is a [FAIL], not a guess: minting handles is
 * `backend/scripts/mint-agent-handles.js`, and running it first is the documented order.
 *
 * Idempotent: a principal that already has a mailbox AND a live connector reports [SKIP],
 * so a second run is all-SKIP (AC-5). A principal whose connector went missing reports
 * [REPAIR] — the plaintext password lived only in that connector's vault payload (D2), so
 * it is unrecoverable and gets rotated.
 *
 *   $ node backend/scripts/backfill-mailboxes.js              # plan only, writes nothing
 *   $ node backend/scripts/backfill-mailboxes.js --dry-run    # same, explicit
 *   $ node backend/scripts/backfill-mailboxes.js --apply      # write
 *   $ node backend/scripts/backfill-mailboxes.js --apply --user=42
 *   $ node backend/scripts/backfill-mailboxes.js --apply --limit=5
 *
 * Exit codes: 0 — ok (or dry-run) · 1 — at least one [FAIL] · 2 — refused to start
 */

import dotenv from 'dotenv';
dotenv.config();

import { dbAll, destroyAdapter } from '../database/connection.js';
import {
  provisionMailbox,
  planMailbox,
  isMailboxProvisioningEnabled,
  MAILBOX_FLAG_KEY,
} from '../services/mail/provisionMailbox.js';

const APPLY = process.argv.includes('--apply');
const onlyUser = Number((process.argv.find((a) => a.startsWith('--user=')) || '').split('=')[1]) || null;
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || null;

async function main() {
  console.log(
    `[backfill-mailboxes] db=${process.env.POSTGRES_DB} host=${process.env.POSTGRES_HOST} ` +
    `mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`
  );

  const enabled = await isMailboxProvisioningEnabled();
  console.log(`[backfill-mailboxes] ${MAILBOX_FLAG_KEY}=${enabled}`);
  if (APPLY && !enabled) {
    // The provisioner is fail-closed, so every row would come back `disabled` and the run
    // would look like a silent no-op. Refuse loudly instead.
    console.error(
      `[backfill-mailboxes] REFUSED: ${MAILBOX_FLAG_KEY} is false — flip it in _app_settings ` +
      `after AC-2 is green, then re-run. (Dry-run works regardless.)`
    );
    await destroyAdapter();
    process.exit(2);
  }

  const principals = await dbAll(
    `SELECT id, name, user_type
       FROM users
      WHERE COALESCE(status, '') <> 'deleted'
        ${onlyUser ? 'AND id = ' + onlyUser : ''}
      ORDER BY id
      ${limit ? 'LIMIT ' + limit : ''}`
  );

  const report = { NEW: 0, REPAIR: 0, SKIP: 0, FAIL: 0 };
  // A plan writes nothing, so it has to remember its own claims: two principals with the
  // same name must show as `bob@` and `bob-2@`, exactly as --apply would land them.
  const planned = new Set();
  for (const p of principals) {
    const who = `user ${p.id} "${p.name}" (${p.user_type || 'human'})`;
    try {
      const res = APPLY
        ? await provisionMailbox({ userId: p.id, reason: 'backfill' })
        : await planMailbox({ userId: p.id, taken: planned });
      if (res.address) planned.add(res.address);
      switch (res.status) {
        case 'created':
          console.log(`[NEW]    ${who} → ${res.address}`);
          report.NEW++;
          break;
        case 'repaired':
          console.log(`[REPAIR] ${who} → ${res.address}${res.reason ? ` — ${res.reason}` : ''}`);
          report.REPAIR++;
          break;
        case 'skipped':
          console.log(`[SKIP]   ${who} — mailbox already provisioned: ${res.address}`);
          report.SKIP++;
          break;
        default:
          // disabled / unsupported / ineligible — nothing to do and nothing wrong.
          console.log(`[SKIP]   ${who} — ${res.status}${res.reason ? `: ${res.reason}` : ''}`);
          report.SKIP++;
      }
    } catch (err) {
      console.log(`[FAIL]   ${who} — ${err.reason ? `${err.reason}: ` : ''}${err.message}`);
      report.FAIL++;
    }
  }

  console.log(
    `[backfill-mailboxes] ${APPLY ? 'applied' : 'would provision'}: NEW=${report.NEW} ` +
    `REPAIR=${report.REPAIR} SKIP=${report.SKIP} FAIL=${report.FAIL} (principals=${principals.length})`
  );
  if (!APPLY) console.log('[backfill-mailboxes] DRY-RUN — nothing written. Re-run with --apply to commit.');
  await destroyAdapter();
  process.exit(report.FAIL > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[backfill-mailboxes] fatal:', err);
  await destroyAdapter().catch(() => {});
  process.exit(1);
});
