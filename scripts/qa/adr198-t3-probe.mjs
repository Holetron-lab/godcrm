#!/usr/bin/env node
/**
 * ADR-198 T3 acceptance probe — godcrm_test only. Not part of the deliverable branch's
 * runtime; kept out of backend/ so it never ships as an importable module.
 *
 * Proves, against a scratch vmail root:
 *   1. kill-switch OFF  → provisionMailbox() is a no-op          (D6 / AC-7)
 *   2. kill-switch ON   → human registration provisions a box     (AC-3)
 *   3. second call      → SKIP, nothing duplicated                (AC-5)
 *   4. connector wiped  → REPAIR rotates the password             (D2 recovery)
 *   5. agent passport   → <handle>@agents.godcrm.ai               (D4)
 *   6. taken local-part → numeric suffix                          (D4 / Risks)
 *   7. reserved part    → numeric suffix (postmaster is an alias) (D4)
 *   8. no substrate     → registration still succeeds             (D9 / AC-7)
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'node:fs/promises';
import path from 'node:path';
import { dbGet, dbAll, dbRun, destroyAdapter } from '../../backend/database/connection.js';

if (process.env.POSTGRES_DB !== 'godcrm_test') {
  console.error(`REFUSING: POSTGRES_DB=${process.env.POSTGRES_DB} — this probe writes, godcrm_test only.`);
  process.exit(2);
}

const VMAIL = process.env.MAILBOX_VMAIL_ROOT;
if (!VMAIL || !VMAIL.startsWith('/tmp/')) {
  console.error('REFUSING: set MAILBOX_VMAIL_ROOT to a /tmp scratch dir before running.');
  process.exit(2);
}

const FLAG = 'mailbox_provisioning_enabled';
const TAG = 'manual-qa-adr198';
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

const setFlag = (v) =>
  dbRun(
    `INSERT INTO _app_settings (key, value, created_at, updated_at)
     VALUES (?, ?::jsonb, NOW(), NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [FLAG, String(v)]
  );

async function maildirOk(maildir) {
  for (const d of ['cur', 'new', 'tmp']) {
    const st = await fs.stat(path.join(maildir, d)).catch(() => null);
    if (!st?.isDirectory()) return false;
  }
  return true;
}

async function main() {
  await fs.mkdir(path.join(VMAIL, 'godcrm.ai'), { recursive: true });
  await fs.mkdir(path.join(VMAIL, 'agents.godcrm.ai'), { recursive: true });

  const { provisionMailbox, planMailbox } = await import('../../backend/services/mail/provisionMailbox.js');
  const { registerUser } = await import('../../backend/services/AuthService.js');
  const credentialVault = (await import('../../backend/services/connectors/CredentialVault.js')).default;

  const flagBefore = await dbGet('SELECT value FROM _app_settings WHERE key = ?', [FLAG]);
  const stamp = Date.now().toString(36);
  const created = { users: [], boxes: [] };

  // ---- 1. kill-switch OFF → no-op, registration still succeeds (AC-7)
  await setFlag(false);
  const offUser = await registerUser({
    email: `${TAG}-off-${stamp}@example.test`, password: 'Adr198Probe!x', name: `${TAG} off ${stamp}`,
  });
  created.users.push(offUser.id);
  const offBox = await dbGet('SELECT id FROM mail_boxes WHERE user_id = ?', [offUser.id]);
  check(!offBox, 'kill-switch OFF: registration succeeds and provisions nothing', `user ${offUser.id}`);

  // ---- 2. kill-switch ON → registration provisions the full triple (AC-3)
  await setFlag(true);
  const humanName = `${TAG} human ${stamp}`;
  const human = await registerUser({
    email: `${TAG}-h-${stamp}@example.test`, password: 'Adr198Probe!x', name: humanName,
  });
  created.users.push(human.id);
  const box = await dbGet('SELECT * FROM mail_boxes WHERE user_id = ?', [human.id]);
  if (box) created.boxes.push(box.id);
  check(!!box, 'registration → mail_boxes row', box && `${box.address}`);
  check(!!box && box.domain === 'godcrm.ai', 'human lands on godcrm.ai', box?.domain);
  check(!!box && box.password_hash?.startsWith('{BLF-CRYPT}$2'), 'password_hash is a dovecot BLF-CRYPT hash');
  check(!!box && box.maildir.startsWith(VMAIL) && box.maildir.endsWith('/'), 'maildir is absolute + trailing slash', box?.maildir);
  check(!!box && (await maildirOk(box.maildir)), 'Maildir cur/new/tmp pre-created on disk');

  const space = await dbGet(`SELECT id FROM spaces WHERE owner_id = ? AND type = 'personal'`, [human.id]);
  const conn = space && (await dbGet(
    `SELECT * FROM space_connectors WHERE space_id = ? AND type_slug = 'imap' AND account_sub = ?`,
    [space.id, box.address]
  ));
  check(!!conn, 'imap connector created in the PERSONAL space', conn && `connector ${conn.id} / space ${space.id}`);
  let creds = null;
  try {
    const p = typeof conn.encrypted_payload === 'string' ? JSON.parse(conn.encrypted_payload) : conn.encrypted_payload;
    creds = credentialVault.decrypt(p);
  } catch { /* reported below */ }
  check(creds?.username === box.address && !!creds?.password, 'payload decrypts to this mailbox creds');
  check(creds?.imap_port === 993 && creds?.smtp_port === 587, 'ports 993/587 per D6', `${creds?.imap_port}/${creds?.smtp_port}`);

  // ---- 3. idempotency (AC-5)
  const again = await provisionMailbox({ userId: human.id, reason: 'probe' });
  const boxCount = (await dbAll('SELECT id FROM mail_boxes WHERE user_id = ?', [human.id])).length;
  check(again.status === 'skipped' && boxCount === 1, 'second run → SKIP, no duplicate box', again.status);

  // ---- 4. connector wiped → REPAIR rotates the password (D2)
  const hashBefore = box.password_hash;
  await dbRun('DELETE FROM space_connectors WHERE id = ?', [conn.id]);
  const repaired = await provisionMailbox({ userId: human.id, reason: 'probe' });
  const boxAfter = await dbGet('SELECT * FROM mail_boxes WHERE id = ?', [box.id]);
  const connAfter = await dbGet('SELECT * FROM space_connectors WHERE id = ?', [repaired.connectorId]);
  let creds2 = null;
  try {
    const p = typeof connAfter.encrypted_payload === 'string' ? JSON.parse(connAfter.encrypted_payload) : connAfter.encrypted_payload;
    creds2 = credentialVault.decrypt(p);
  } catch { /* reported below */ }
  check(
    repaired.status === 'repaired' && boxAfter.password_hash !== hashBefore && !!creds2?.password,
    'missing connector → REPAIR with a rotated password'
  );

  // ---- 5. agent passport → agents.godcrm.ai (D4)
  const agent = await dbGet(
    `SELECT u.id, u.handle FROM users u
      WHERE u.user_type = 'agent' AND u.handle IS NOT NULL
        AND COALESCE(u.status,'') <> 'deleted'
        AND NOT EXISTS (SELECT 1 FROM mail_boxes b WHERE b.user_id = u.id)
      ORDER BY u.id LIMIT 1`
  );
  if (agent) {
    const res = await provisionMailbox({ userId: agent.id, reason: 'probe' });
    if (res.mailboxId) created.boxes.push(res.mailboxId);
    check(res.address === `${agent.handle.toLowerCase()}@agents.godcrm.ai`, 'agent → <handle>@agents.godcrm.ai', res.address);
  } else {
    check(false, 'agent → <handle>@agents.godcrm.ai', 'no eligible agent passport in godcrm_test');
  }

  // ---- 6. taken local-part → numeric suffix
  const twinName = humanName; // same name ⇒ same base slug as the human above
  const twin = await registerUser({
    email: `${TAG}-t-${stamp}@example.test`, password: 'Adr198Probe!x', name: twinName,
  });
  created.users.push(twin.id);
  const twinBox = await dbGet('SELECT * FROM mail_boxes WHERE user_id = ?', [twin.id]);
  if (twinBox) created.boxes.push(twinBox.id);
  check(
    !!twinBox && twinBox.local_part === `${box.local_part}-2`,
    'same-named principal gets a -2 suffix',
    twinBox?.address
  );

  // ---- 7. reserved local-part → suffix (plan only, writes nothing)
  await dbRun('UPDATE users SET name = ? WHERE id = ?', ['Postmaster', offUser.id]);
  const reservedPlan = await planMailbox({ userId: offUser.id });
  await dbRun('UPDATE users SET name = ? WHERE id = ?', [`${TAG} off ${stamp}`, offUser.id]);
  check(reservedPlan.address === 'postmaster-2@godcrm.ai', 'reserved local-part is skipped', reservedPlan.address);

  // ---- 8. no substrate → registration still succeeds (D9 / AC-7)
  process.env.MAILBOX_VMAIL_ROOT = '/nonexistent-adr198';
  const { provisionMailbox: freshProvision } = await import(
    `../../backend/services/mail/provisionMailbox.js?nosubstrate=${stamp}`
  );
  const noSub = await freshProvision({ userId: offUser.id, reason: 'probe' });
  const noSubBox = await dbGet('SELECT id FROM mail_boxes WHERE user_id = ?', [offUser.id]);
  check(noSub.status === 'unsupported' && !noSubBox, 'no local substrate → unsupported no-op', noSub.reason);
  process.env.MAILBOX_VMAIL_ROOT = VMAIL;

  // ---- cleanup: probe artefacts out, flag restored
  for (const id of created.boxes) await dbRun('DELETE FROM mail_boxes WHERE id = ?', [id]);
  for (const id of created.users) {
    await dbRun(`DELETE FROM space_connectors WHERE created_by = ?`, [id]);
    await dbRun('DELETE FROM mail_boxes WHERE user_id = ?', [id]);
  }
  await setFlag(flagBefore ? (flagBefore.value === true || flagBefore.value === 'true') : false);
  console.log(`[cleanup] mail_boxes/connectors of probe users removed; ${FLAG} restored to ${flagBefore?.value ?? 'false'}`);
  console.log(`[cleanup] probe users left in godcrm_test (tagged ${TAG}): ${created.users.join(', ')}`);

  console.log(`\n[adr198-t3-probe] PASS=${pass} FAIL=${fail}`);
  await destroyAdapter();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[adr198-t3-probe] fatal:', err);
  await destroyAdapter().catch(() => {});
  process.exit(1);
});
