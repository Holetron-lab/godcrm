// One-off: create the sysadmin@godcrm.ai imap connector, mirroring
// POST /spaces/:id/connectors (api_key path) exactly — same validate + vault
// encrypt + identity derive + insert. Needed because the live process predates
// imap.js in the catalogue; the DB-driven mail routes work off the row this writes.
import 'dotenv/config';
import { dbGet, dbRun } from '../../backend/database/connection.js';
import credentialVault from '../../backend/services/connectors/CredentialVault.js';
import { getConnectorType, validateConnectorTypeBody } from '../../backend/services/connectors/catalogue/index.js';

const SPACE_ID = 11;
const fields = {
  imap_host: 'mail.godcrm.ai',
  imap_port: '993',
  smtp_host: 'mail.godcrm.ai',
  smtp_port: '587',
  username: 'sysadmin@godcrm.ai',
  password: process.env.SYSADMIN_MAIL_PW,
  use_tls: 'true',
};
const identity = { sub: 'sysadmin@godcrm.ai', email: 'sysadmin@godcrm.ai', name: 'SysAdmin Mailbox' };

const type = getConnectorType('imap');
if (!type) { console.error('FAIL: imap not in catalogue'); process.exit(1); }

const v = validateConnectorTypeBody('imap', { fields });
if (v && v.ok === false) { console.error('FAIL validate:', v.error || v); process.exit(1); }

const payload = { ...fields };
const encrypted = credentialVault.encrypt(payload);

// deriveIdentity equivalent (connectors.js): promote sub/email/name
const account_sub = String(identity.sub).toLowerCase();

const existing = await dbGet(
  `SELECT id FROM space_connectors WHERE space_id=? AND type_slug='imap' AND account_sub=?`,
  [SPACE_ID, account_sub]
);

let id;
if (existing) {
  await dbRun(
    `UPDATE space_connectors SET status='active', email=?, account_name=?, encrypted_payload=?::jsonb, last_error=NULL, updated_at=now() WHERE id=?`,
    [identity.email, identity.name, JSON.stringify(encrypted), existing.id]
  );
  id = existing.id;
  console.log('UPDATED connector id', id);
} else {
  const r = await dbRun(
    `INSERT INTO space_connectors
       (space_id, type_slug, kind, display_name, status, scopes_requested, scopes_granted,
        account_sub, email, account_name, avatar_url, profile, encrypted_payload, custom_definition, created_by)
     VALUES (?, 'imap', 'api_key', 'sysadmin@godcrm.ai (test)', 'active', ?, ?, ?, ?, ?, NULL, NULL, ?::jsonb, NULL, 1)
     RETURNING id`,
    [SPACE_ID, [], [], account_sub, identity.email, identity.name, JSON.stringify(encrypted)]
  );
  id = r.lastInsertRowid;
  console.log('INSERTED connector id', id);
}

// round-trip decrypt to prove the live mail route can read it
const back = await dbGet(`SELECT encrypted_payload FROM space_connectors WHERE id=?`, [id]);
const dec = credentialVault.decrypt(typeof back.encrypted_payload === 'string' ? JSON.parse(back.encrypted_payload) : back.encrypted_payload);
console.log('DECRYPT OK — username=%s host=%s', dec.username, dec.imap_host);
process.exit(0);
