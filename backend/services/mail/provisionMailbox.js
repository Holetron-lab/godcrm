/**
 * ADR-198 D6 — provision one principal's mailbox on the local virtual mail substrate.
 *
 * Three artefacts per principal, in this order:
 *   1. Maildir on disk, owned by the `vmail` uid — created BEFORE the row goes live.
 *      postfix's virtual(8) creates missing parents as `root:root 0755` and only fixes
 *      `cur/new/tmp`, so dovecot cannot write `dovecot-uidlist` and the mailbox reads as
 *      "delivered, INBOX empty" — a silent mail loss. Pre-creating it is the fix (T1
 *      rehearsal finding), not belt-and-braces.
 *   2. `mail_boxes` row — what postfix/dovecot see, through the read-only `mail_auth` view
 *      (`WHERE active`). `password_hash` carries an explicit `{BLF-CRYPT}` prefix because
 *      the passdb's `default_pass_scheme` is CRYPT; dovecot honours the inline scheme.
 *   3. `space_connectors` row in the principal's PERSONAL space — this is what makes the
 *      mailbox "already logged in" for the CRM, and what makes it private (D5: personal
 *      spaces are closed to everyone but the owner, `space/access.js:48-50`). The plaintext
 *      password exists ONLY inside that row's vault-encrypted payload (D2) — one leaked
 *      payload costs one mailbox, not the platform.
 *
 * Idempotent and re-entrant. There is deliberately no transaction: the filesystem cannot
 * join one, and the failure mode it would guard (a `mail_boxes` row with no connector) is
 * repairable — see the `repaired` path, which rotates the password because the old
 * plaintext is unrecoverable by construction. Nothing is lost in the meantime: mail
 * addressed to a box with no connector is still accepted and stored.
 *
 * Ring gate (D9): the vmail root must exist. NL/KZ have no mail host, so provisioning
 * there is a no-op rather than a half-built mailbox nobody can reach.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcrypt';

import { dbGet, dbRun, safeJsonParse } from '../../database/connection.js';
import credentialVault from '../connectors/CredentialVault.js';
import { apiLogger as log } from '../../utils/logger.js';

export const MAILBOX_FLAG_KEY = 'mailbox_provisioning_enabled';

// Ring-0 defaults; overridable so staging (.72, `hltrn.cc` + /var/mail/vhosts) can run the
// same code path against its own substrate.
const VMAIL_ROOT = process.env.MAILBOX_VMAIL_ROOT || '/var/vmail';
const HUMAN_DOMAIN = (process.env.MAILBOX_DOMAIN_HUMAN || 'godcrm.ai').toLowerCase();
const AGENT_DOMAIN = (process.env.MAILBOX_DOMAIN_AGENT || 'agents.godcrm.ai').toLowerCase();
const MAIL_HOST = process.env.MAILBOX_HOST || 'mail.godcrm.ai';
const IMAP_PORT = Number(process.env.MAILBOX_IMAP_PORT) || 993;
const SMTP_PORT = Number(process.env.MAILBOX_SMTP_PORT) || 587;

const MAX_SUFFIX = 50;
const BCRYPT_ROUNDS = 10;

// Addresses postfix resolves elsewhere. `virtual_alias_maps` is consulted BEFORE
// `virtual_mailbox_maps`, so a `mail_boxes` row for one of these would be created, look
// healthy, and never receive a single message.
const ROLE_LOCAL_PARTS = new Set([
  'postmaster', 'abuse', 'root', 'mailer-daemon', 'noreply', 'no-reply', 'bounce',
]);

// Boxes on the human domain that predate `mail_boxes` (static map, consulted first —
// `/etc/postfix/vmailbox-adr198`) plus the usual role-account squatting targets.
const RESERVED_HUMAN_LOCAL_PARTS = new Set([
  'geratron', 'sysadmin', 'admin', 'administrator', 'hostmaster', 'webmaster',
  'security', 'support', 'info', 'billing', 'sales', 'contact', 'help', 'mail',
]);

class MailboxProvisionError extends Error {
  constructor(reason, message) {
    super(message || reason);
    this.name = 'MailboxProvisionError';
    this.reason = reason;
  }
}

/**
 * Kill-switch (D6). FAIL-CLOSED, unlike the starter-pack flag it is modelled on: this
 * provisioner mints credentials and writes to disk, so "no row" must not mean "go ahead"
 * on a database that has not seen migration 089. Migration 089 seeds the row `false`.
 */
export async function isMailboxProvisioningEnabled() {
  try {
    const row = await dbGet('SELECT value FROM _app_settings WHERE key = ?', [MAILBOX_FLAG_KEY]);
    if (!row) return false;
    const v = row.value;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v === 'true' || v === '"true"';
    return safeJsonParse(v, false) === true;
  } catch (err) {
    log.warn({ err }, '[ADR-198] mailbox_provisioning_enabled read failed — treating as disabled');
    return false;
  }
}

/** Ring gate (D9): the local substrate's root, and the uid/gid its Maildirs must carry. */
async function resolveVmailRoot() {
  try {
    const st = await fs.stat(VMAIL_ROOT);
    if (!st.isDirectory()) return null;
    return { root: VMAIL_ROOT, uid: st.uid, gid: st.gid };
  } catch {
    return null;
  }
}

function addressFor(localPart, domain) {
  return `${localPart}@${domain}`.toLowerCase();
}

function maildirFor(domain, localPart) {
  // Absolute and trailing-slashed: postfix's map strips the `/var/vmail/` prefix and
  // requires the trailing `/` for virtual(8) to treat the target as a Maildir, not an
  // mbox file; dovecot's user_query hands the same value back as `home`.
  return `${path.join(VMAIL_ROOT, domain, localPart, 'Maildir')}/`;
}

function reservedFor(domain) {
  return domain === HUMAN_DOMAIN
    ? new Set([...ROLE_LOCAL_PARTS, ...RESERVED_HUMAN_LOCAL_PARTS])
    : ROLE_LOCAL_PARTS;
}

/**
 * Is this local-part free — in the table, in the reserved set, on disk, and against
 * `taken`? `taken` is what a dry-run uses to stay honest: planning writes no row, so
 * without it two same-named principals would both be reported as claiming one address.
 */
async function localPartFree(localPart, domain, taken) {
  if (reservedFor(domain).has(localPart)) return false;
  if (taken?.has(addressFor(localPart, domain))) return false;
  const clash = await dbGet('SELECT id FROM mail_boxes WHERE address = ?', [addressFor(localPart, domain)]);
  if (clash) return false;
  try {
    // Catches any mailbox that exists on the substrate without a row — the two legacy
    // human boxes carried over in T1b, for instance.
    await fs.stat(path.join(VMAIL_ROOT, domain, localPart));
    return false;
  } catch {
    return true;
  }
}

/**
 * D4 address policy. Agents: the handle verbatim — the address IS the `<<@handle>>`
 * identity, so a suffixed variant would be a different principal and is refused instead.
 * Humans: signup's own slugifier plus a numeric suffix on collision, the same shape as
 * referral-code minting.
 */
async function mintLocalPart(user, taken) {
  if (user.user_type === 'agent') {
    const handle = (user.handle || '').trim().toLowerCase();
    if (!handle) {
      throw new MailboxProvisionError('no_handle', 'agent passport has no handle — run backend/scripts/mint-agent-handles.js first');
    }
    if (!(await localPartFree(handle, AGENT_DOMAIN, taken))) {
      throw new MailboxProvisionError('local_part_taken', `'${handle}@${AGENT_DOMAIN}' is reserved or already provisioned`);
    }
    return { localPart: handle, domain: AGENT_DOMAIN };
  }

  // Same composition T2's handle mint uses: `referralPrefix` carries the Cyrillic map and
  // the length cap but leaves `_` in place (slugify's `\w` class), and `normaliseSlug` is
  // what every identity in this repo is compared through. Composing them keeps one
  // namespace shape for both domains — no third slugifier.
  const { referralPrefix } = await import('../AuthService.js');
  const { normaliseSlug } = await import('../agent-users.js');
  const base = normaliseSlug(referralPrefix(user.name)) || 'user';
  for (let n = 1; n <= MAX_SUFFIX; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (await localPartFree(candidate, HUMAN_DOMAIN, taken)) return { localPart: candidate, domain: HUMAN_DOMAIN };
  }
  // The 51st "Иван Иванов" is not an error condition — a common name must not become a
  // principal with no mailbox. Fall back to a random suffix, the same escape referral-code
  // minting takes (`<frozen-prefix>-<random>`), rather than raising the numeric ceiling.
  for (let i = 0; i < 5; i++) {
    const candidate = `${base}-${crypto.randomBytes(3).toString('hex')}`;
    if (await localPartFree(candidate, HUMAN_DOMAIN, taken)) return { localPart: candidate, domain: HUMAN_DOMAIN };
  }
  throw new MailboxProvisionError('local_part_taken', `no free local-part for base '${base}' after ${MAX_SUFFIX} numeric and 5 random tries`);
}

/** Create `<maildir>/{cur,new,tmp}` owned by vmail, 0700. Idempotent. */
async function ensureMaildir(maildir, uid, gid) {
  const boxRoot = path.dirname(maildir.replace(/\/$/, '')); // /var/vmail/<domain>/<local>
  for (const dir of [boxRoot, maildir.replace(/\/$/, ''),
    path.join(maildir, 'cur'), path.join(maildir, 'new'), path.join(maildir, 'tmp')]) {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.chown(dir, uid, gid);
    await fs.chmod(dir, 0o700);
  }
}

/** The principal's personal space, created on demand (D5 — 39 agents have none). */
async function ensurePersonalSpace(user) {
  const find = () => dbGet(
    `SELECT id FROM spaces WHERE owner_id = ? AND type = 'personal' ORDER BY id LIMIT 1`,
    [user.id]
  );
  let space = await find();
  if (!space) {
    const { autoCreateDefaultProjects } = await import('../ProjectService.js');
    await autoCreateDefaultProjects(user.id, user.name);
    space = await find();
  }
  if (!space) throw new MailboxProvisionError('no_personal_space', 'personal space could not be created');
  return space.id;
}

/**
 * Write (or refresh) the connector row that logs the principal into their own mailbox.
 * Field names mirror the imap catalogue entry exactly (`catalogue/imap.js`), because the
 * mail module reads these keys straight out of the decrypted payload — provisioning adds
 * no new credential shape.
 */
async function upsertConnector({ spaceId, userId, address, password }) {
  const encrypted = credentialVault.encrypt({
    imap_host: MAIL_HOST,
    imap_port: IMAP_PORT,
    smtp_host: MAIL_HOST,
    smtp_port: SMTP_PORT,
    username: address,
    password,
    use_tls: true,
  });

  const res = await dbRun(
    `INSERT INTO space_connectors
       (space_id, type_slug, kind, display_name, status, scopes_requested, scopes_granted,
        account_sub, email, account_name, encrypted_payload, created_by)
     VALUES (?, 'imap', 'api_key', ?, 'active', ?, ?, ?, ?, ?, ?::jsonb, ?)
     ON CONFLICT ON CONSTRAINT space_connectors_account_uq DO UPDATE SET
          status            = 'active',
          encrypted_payload = EXCLUDED.encrypted_payload,
          email             = EXCLUDED.email,
          last_error        = NULL,
          updated_at        = now()
     RETURNING id`,
    [spaceId, address, [], [], address, address, address, JSON.stringify(encrypted), userId]
  );
  return res.lastInsertRowid;
}

async function findConnector(spaceId, address) {
  return dbGet(
    `SELECT id FROM space_connectors
      WHERE space_id = ? AND type_slug = 'imap' AND account_sub = ? AND status = 'active'`,
    [spaceId, address]
  );
}

/** The Mail system table for the space — same best-effort call the connect route makes. */
async function ensureMailFacade(spaceId) {
  try {
    const { ensureMailSystemTableForSpace } = await import('../SystemTablesCreator.js');
    await ensureMailSystemTableForSpace(spaceId);
  } catch (err) {
    log.warn({ err, spaceId }, '[ADR-198] mail system-table provision failed (non-fatal)');
  }
}

/**
 * Provision (or repair) the mailbox of one principal.
 *
 * @param {object} args
 * @param {number} args.userId
 * @param {string} [args.reason] - call site, for the log line only
 * @returns {Promise<{status:'created'|'repaired'|'skipped'|'disabled'|'unsupported'|'ineligible', address?:string, mailboxId?:number, connectorId?:number, spaceId?:number, reason?:string}>}
 */
export async function provisionMailbox({ userId, reason = 'manual' } = {}) {
  if (!(await isMailboxProvisioningEnabled())) return { status: 'disabled' };

  const vmail = await resolveVmailRoot();
  if (!vmail) return { status: 'unsupported', reason: `no local mail substrate at ${VMAIL_ROOT}` };

  const user = await dbGet(
    `SELECT id, name, email, handle, user_type, status FROM users WHERE id = ?`,
    [userId]
  );
  if (!user) throw new MailboxProvisionError('user_not_found', `user ${userId} does not exist`);
  if ((user.status || '') === 'deleted') return { status: 'ineligible', reason: 'user is deleted' };

  const existing = await dbGet('SELECT * FROM mail_boxes WHERE user_id = ? ORDER BY id LIMIT 1', [userId]);

  if (existing) {
    // The box is already on the substrate. Make sure the principal can still reach it.
    await ensureMaildir(existing.maildir, vmail.uid, vmail.gid);
    const spaceId = await ensurePersonalSpace(user);
    const connector = await findConnector(spaceId, existing.address);
    if (connector) {
      return { status: 'skipped', address: existing.address, mailboxId: existing.id, connectorId: connector.id, spaceId };
    }
    // No connector ⇒ the plaintext is gone for good (it lived only in that row's vault
    // payload, D2). Rotate rather than leave a mailbox nobody can open.
    const password = crypto.randomBytes(24).toString('base64url');
    const hash = `{BLF-CRYPT}${await bcrypt.hash(password, BCRYPT_ROUNDS)}`;
    await dbRun('UPDATE mail_boxes SET password_hash = ?, active = TRUE WHERE id = ?', [hash, existing.id]);
    const connectorId = await upsertConnector({ spaceId, userId, address: existing.address, password });
    await ensureMailFacade(spaceId);
    log.info({ userId, address: existing.address, reason }, '[ADR-198] mailbox connector repaired (password rotated)');
    return { status: 'repaired', address: existing.address, mailboxId: existing.id, connectorId, spaceId };
  }

  const { localPart, domain } = await mintLocalPart(user);
  const address = addressFor(localPart, domain);
  const maildir = maildirFor(domain, localPart);
  const spaceId = await ensurePersonalSpace(user);

  const password = crypto.randomBytes(24).toString('base64url');
  const hash = `{BLF-CRYPT}${await bcrypt.hash(password, BCRYPT_ROUNDS)}`;

  await ensureMaildir(maildir, vmail.uid, vmail.gid);

  const inserted = await dbRun(
    `INSERT INTO mail_boxes (user_id, address, local_part, domain, password_hash, maildir)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (address) DO NOTHING
     RETURNING id`,
    [userId, address, localPart, domain, hash, maildir]
  );
  // `lastInsertRowid` is 0 (not undefined) when ON CONFLICT swallowed the insert — a
  // concurrent provisioner won the race; adopt its row rather than fail.
  const mailboxId = inserted.lastInsertRowid
    || (await dbGet('SELECT id FROM mail_boxes WHERE address = ?', [address]))?.id;
  if (!mailboxId) throw new MailboxProvisionError('mailbox_insert_failed', `could not create mail_boxes row for ${address}`);

  const connectorId = await upsertConnector({ spaceId, userId, address, password });
  await ensureMailFacade(spaceId);

  log.info({ userId, address, spaceId, connectorId, reason }, '[ADR-198] mailbox provisioned');
  return { status: 'created', address, mailboxId, connectorId, spaceId };
}

/**
 * What `provisionMailbox` WOULD do for this principal, writing nothing. Exists so the
 * backfill's dry-run reports the real address instead of re-implementing D4's minting.
 * Deliberately ignores the kill-switch: a dry-run is a plan, not an act.
 *
 * `taken` — addresses already claimed EARLIER IN THE SAME PLAN. A plan writes nothing, so
 * without it two principals with the same name are both reported as taking one address,
 * and the report lies about what `--apply` would do.
 *
 * @returns {Promise<{status:'created'|'repaired'|'skipped'|'unsupported'|'ineligible', address?:string, reason?:string}>}
 */
export async function planMailbox({ userId, taken } = {}) {
  if (!(await resolveVmailRoot())) {
    return { status: 'unsupported', reason: `no local mail substrate at ${VMAIL_ROOT}` };
  }
  const user = await dbGet(
    `SELECT id, name, email, handle, user_type, status FROM users WHERE id = ?`,
    [userId]
  );
  if (!user) throw new MailboxProvisionError('user_not_found', `user ${userId} does not exist`);
  if ((user.status || '') === 'deleted') return { status: 'ineligible', reason: 'user is deleted' };

  const existing = await dbGet('SELECT * FROM mail_boxes WHERE user_id = ? ORDER BY id LIMIT 1', [userId]);
  if (existing) {
    const space = await dbGet(
      `SELECT id FROM spaces WHERE owner_id = ? AND type = 'personal' ORDER BY id LIMIT 1`,
      [userId]
    );
    const connector = space ? await findConnector(space.id, existing.address) : null;
    return connector
      ? { status: 'skipped', address: existing.address }
      : { status: 'repaired', address: existing.address, reason: 'connector missing — password would be rotated' };
  }

  const { localPart, domain } = await mintLocalPart(user, taken);
  return { status: 'created', address: addressFor(localPart, domain) };
}

export { MailboxProvisionError, HUMAN_DOMAIN, AGENT_DOMAIN };
export default { provisionMailbox, isMailboxProvisioningEnabled, MAILBOX_FLAG_KEY };
