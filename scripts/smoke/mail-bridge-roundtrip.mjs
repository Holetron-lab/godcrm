// ADR-160 end-to-end bridge proof against the REAL sysadmin@godcrm.ai mailbox.
// Replicates the /sync and /send handler logic (same imapFetch, same
// mail_messages upsert, same SMTPService transport). Run as a standalone
// process because the live godcrm predates these routes (stale, can't restart
// from inside it). This exercises the actual code paths, not mocks.
import 'dotenv/config';
import { dbGet, dbAll, dbRun } from '../../backend/database/connection.js';
import credentialVault from '../../backend/services/connectors/CredentialVault.js';
import { imapFetch } from '../../backend/services/mail/imapFetch.js';
import SMTPService from '../../backend/services/SMTPService.js';

const SPACE_ID = 11;
const row = await dbGet(`SELECT id, encrypted_payload FROM space_connectors WHERE space_id=? AND type_slug='imap' AND status='active' ORDER BY id DESC LIMIT 1`, [SPACE_ID]);
if (!row) { console.error('no imap connector'); process.exit(1); }
const creds = credentialVault.decrypt(typeof row.encrypted_payload === 'string' ? JSON.parse(row.encrypted_payload) : row.encrypted_payload);
console.log('connector id=%d user=%s', row.id, creds.username);

// ── SYNC (inbox) ──────────────────────────────────────────────
const fetched = await imapFetch({ creds, folder: 'inbox', limit: 50 });
console.log('IMAP fetched %d message(s) from inbox', fetched.length);
let synced = 0;
for (const m of fetched) {
  await dbRun(
    `INSERT INTO mail_messages (space_id, connector_id, folder, imap_uid, message_id, from_name, from_address, to_addresses, subject, preview, body_text, body_html, date, is_read)
     VALUES (?, ?, 'inbox', ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (connector_id, folder, imap_uid) DO UPDATE SET subject=EXCLUDED.subject, preview=EXCLUDED.preview, updated_at=now()`,
    [SPACE_ID, row.id, m.imap_uid ?? null, m.message_id, m.from_name, m.from_address, JSON.stringify(m.to_addresses||[]), m.subject, m.preview, m.body_text, m.body_html, m.date, m.is_read]
  );
  synced++;
}
console.log('synced %d row(s) into mail_messages', synced);

// ── MESSAGES (read back as the UI would) ──────────────────────
const back = await dbAll(`SELECT id, folder, from_address, subject, preview, is_read, date FROM mail_messages WHERE space_id=? AND connector_id=? AND folder='inbox' ORDER BY date DESC NULLS LAST LIMIT 10`, [SPACE_ID, row.id]);
console.log('--- inbox rows ---');
for (const r of back) console.log(`  [${r.is_read?'read':'NEW '}] ${r.from_address} | ${r.subject} | ${r.preview?.slice(0,50)||''}`);

// ── SEND (real SMTP submission) ───────────────────────────────
const transport = SMTPService.createTransport({ host: creds.smtp_host, port: Number(creds.smtp_port)||587, user: creds.username, password: creds.password });
const info = await transport.sendMail({ from: creds.username, to: creds.username, subject: 'ADR-160 round-trip send '+process.env.STAMP, text: 'sent via SMTPService.createTransport through the connector creds — bridge send path verified.' });
console.log('SENT ok messageId=%s', info.messageId);
await dbRun(`INSERT INTO mail_messages (space_id, connector_id, folder, message_id, from_name, from_address, to_addresses, subject, preview, body_text, body_html, date, is_read) VALUES (?, ?, 'sent', ?, ?, ?, ?::jsonb, ?, ?, ?, NULL, now(), true)`,
  [SPACE_ID, row.id, info.messageId, creds.username, creds.username, JSON.stringify([creds.username]), 'ADR-160 round-trip send', 'bridge send path verified', 'bridge send path verified']);
console.log('Sent copy persisted. DONE.');
process.exit(0);
