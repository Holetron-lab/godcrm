/**
 * Mail module routes — ADR-160 (the bridge slice).
 *
 * Connects the `imap` connector (catalogue/imap.js) + `mail_messages` store
 * (mig 075) to the Mail UI. The frontend hooks read these over `/api/v3/mail/*`,
 * replacing MOCK_MESSAGES.
 *
 *   GET  /spaces/:spaceId/mail/folders            → folder list + unread counts
 *   GET  /spaces/:spaceId/mail/messages           → list a folder (newest first)
 *   GET  /spaces/:spaceId/mail/messages/:msgId    → one message (marks it read)
 *   POST /spaces/:spaceId/mail/sync               → pull newest N from IMAP, upsert
 *   POST /spaces/:spaceId/mail/send               → send via the connector's SMTP creds
 *
 * `spaceId` is a path param (sibling of /spaces/:spaceId/connectors); the mailbox
 * is chosen with `connector_id` (account switcher) and access is checked per
 * request. Credentials never leave the server — they are vault-decrypted here,
 * used for the IMAP/SMTP call, and dropped. Mounted via:
 *   app.use('/api/v3', authenticate, mailRoutesV3);
 */

import express from 'express';

import { dbGet, dbAll, dbRun } from '../../database/connection.js';
import { checkUserSpaceAccess } from '../../services/space/access.js';
import credentialVault from '../../services/connectors/CredentialVault.js';
import { imapFetch } from '../../services/mail/imapFetch.js';
import SMTPService from '../../services/SMTPService.js';
import { apiLogger as log } from '../../utils/logger.js';
import { success, error, badRequest, notFound, forbidden } from '../../utils/response.js';

const router = express.Router();

// Canonical folder list mirrored from src/features/mail/types.ts (MailFolderId).
const FOLDERS = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'sent', label: 'Sent' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'archive', label: 'Archive' },
  { id: 'trash', label: 'Trash' },
];
const FOLDER_IDS = new Set(FOLDERS.map((f) => f.id));

// ─── helpers ────────────────────────────────────────────────────────

async function ensureSpaceAccess(req, res, spaceId) {
  if (!Number.isFinite(spaceId)) {
    badRequest(res, 'Invalid spaceId');
    return null;
  }
  const space = await dbGet('SELECT * FROM spaces WHERE id = ?', [spaceId]);
  if (!space) {
    notFound(res, 'Space');
    return null;
  }
  let accessControl = null;
  try {
    accessControl =
      typeof space.access_control === 'string'
        ? JSON.parse(space.access_control)
        : space.access_control;
  } catch {
    accessControl = null;
  }
  const allowed = await checkUserSpaceAccess(req.user.id, req.user.role, space, accessControl);
  if (!allowed) {
    forbidden(res, 'No access to space');
    return null;
  }
  return space;
}

/**
 * Resolve an `imap` connector for the space and return its decrypted creds.
 * `connectorId` picks a specific mailbox (account switcher); otherwise the most
 * recent active imap connector is used. Returns null if none / decrypt fails.
 * @returns {Promise<null | { id:number, creds:object }>}
 */
async function loadImapConnector(spaceId, connectorId) {
  const row = connectorId
    ? await dbGet(
        `SELECT id, encrypted_payload FROM space_connectors
          WHERE id = ? AND space_id = ? AND type_slug = 'imap' AND status <> 'revoked'`,
        [connectorId, spaceId]
      )
    : await dbGet(
        `SELECT id, encrypted_payload FROM space_connectors
          WHERE space_id = ? AND type_slug = 'imap' AND status = 'active'
          ORDER BY id DESC LIMIT 1`,
        [spaceId]
      );
  if (!row) return null;
  try {
    const payload =
      typeof row.encrypted_payload === 'string'
        ? JSON.parse(row.encrypted_payload)
        : row.encrypted_payload;
    const creds = credentialVault.decrypt(payload);
    return { id: row.id, creds };
  } catch (err) {
    log.error({ err, connectorId: row.id }, 'mail: imap connector decrypt failed');
    return null;
  }
}

// DB row → frontend MailMessage shape (src/features/mail/types.ts).
function toMailMessage(r) {
  return {
    id: String(r.id),
    folder: r.folder,
    fromName: r.from_name || r.from_address || '',
    fromAddress: r.from_address || '',
    subject: r.subject || '',
    preview: r.preview || '',
    body: r.body_html || r.body_text || '',
    date: r.date ? new Date(r.date).toISOString() : null,
    read: !!r.is_read,
    ticketId: r.ticket_id ?? null,
  };
}

// ─── GET /spaces/:spaceId/mail/folders ──────────────────────────────

router.get('/spaces/:spaceId/mail/folders', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const conn = await loadImapConnector(spaceId, Number(req.query.connector_id) || null);
  // No mailbox connected yet → return the static folder list with zero counts so
  // the UI renders the nav before a connector exists.
  const unread = {};
  if (conn) {
    const counts = await dbAll(
      `SELECT folder, COUNT(*) FILTER (WHERE NOT is_read) AS unread
         FROM mail_messages
        WHERE space_id = ? AND connector_id = ?
        GROUP BY folder`,
      [spaceId, conn.id]
    );
    for (const c of counts) unread[c.folder] = Number(c.unread) || 0;
  }

  return success(res, {
    folders: FOLDERS.map((f) => ({ ...f, unread: unread[f.id] || 0 })),
  });
});

// ─── GET /spaces/:spaceId/mail/messages ─────────────────────────────

router.get('/spaces/:spaceId/mail/messages', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const folder = String(req.query.folder || 'inbox');
  if (!FOLDER_IDS.has(folder)) return badRequest(res, `Unknown folder: ${folder}`);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const conn = await loadImapConnector(spaceId, Number(req.query.connector_id) || null);
  if (!conn) return success(res, { messages: [] });

  const rows = await dbAll(
    `SELECT * FROM mail_messages
      WHERE space_id = ? AND connector_id = ? AND folder = ?
      ORDER BY date DESC NULLS LAST, id DESC
      LIMIT ? OFFSET ?`,
    [spaceId, conn.id, folder, limit, offset]
  );
  return success(res, { messages: rows.map(toMailMessage) });
});

// ─── GET /spaces/:spaceId/mail/messages/:msgId ──────────────────────

router.get('/spaces/:spaceId/mail/messages/:msgId', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const id = Number(req.params.msgId);
  if (!Number.isFinite(id)) return badRequest(res, 'Invalid message id');

  // Opening a message marks it read (matches the UI `read` flag).
  const row = await dbGet(
    `UPDATE mail_messages SET is_read = true, updated_at = now()
      WHERE id = ? AND space_id = ?
      RETURNING *`,
    [id, spaceId]
  );
  if (!row) return notFound(res, 'Message');
  return success(res, { message: toMailMessage(row) });
});

// ─── POST /spaces/:spaceId/mail/sync ────────────────────────────────

router.post('/spaces/:spaceId/mail/sync', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const folder = String(req.body?.folder || 'inbox');
  if (!FOLDER_IDS.has(folder)) return badRequest(res, `Unknown folder: ${folder}`);
  const limit = Math.min(Math.max(Number(req.body?.limit) || 50, 1), 200);

  const conn = await loadImapConnector(spaceId, Number(req.body?.connector_id) || null);
  if (!conn) return badRequest(res, 'No imap connector for this space');

  let fetched;
  try {
    fetched = await imapFetch({ creds: conn.creds, folder, limit });
  } catch (err) {
    log.error({ err, spaceId, connectorId: conn.id, folder }, 'mail sync: imap fetch failed');
    return error(res, 'IMAP_FETCH_FAILED', err?.message || 'IMAP fetch failed', 502);
  }

  let synced = 0;
  for (const m of fetched) {
    await dbRun(
      `INSERT INTO mail_messages
         (space_id, connector_id, folder, imap_uid, message_id, from_name, from_address,
          to_addresses, subject, preview, body_text, body_html, date, is_read)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (connector_id, folder, imap_uid) DO UPDATE SET
            message_id = EXCLUDED.message_id,
            from_name = EXCLUDED.from_name,
            from_address = EXCLUDED.from_address,
            to_addresses = EXCLUDED.to_addresses,
            subject = EXCLUDED.subject,
            preview = EXCLUDED.preview,
            body_text = EXCLUDED.body_text,
            body_html = EXCLUDED.body_html,
            date = EXCLUDED.date,
            is_read = EXCLUDED.is_read,
            updated_at = now()`,
      [
        spaceId,
        conn.id,
        folder,
        m.imap_uid ?? null,
        m.message_id,
        m.from_name,
        m.from_address,
        JSON.stringify(m.to_addresses || []),
        m.subject,
        m.preview,
        m.body_text,
        m.body_html,
        m.date,
        m.is_read,
      ]
    );
    synced += 1;
  }

  return success(res, { synced, folder });
});

// ─── POST /spaces/:spaceId/mail/send ────────────────────────────────

router.post('/spaces/:spaceId/mail/send', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const { to, subject, body, html } = req.body || {};
  if (!to || typeof to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return badRequest(res, 'Valid `to` address is required');
  }
  if (!subject || typeof subject !== 'string') {
    return badRequest(res, '`subject` is required');
  }

  const conn = await loadImapConnector(spaceId, Number(req.body?.connector_id) || null);
  if (!conn) return badRequest(res, 'No imap connector for this space');

  const { smtp_host, smtp_port, username, password } = conn.creds;
  if (!smtp_host || !username || !password) {
    return badRequest(res, 'connector is missing SMTP host/username/password');
  }

  let info;
  try {
    const transport = SMTPService.createTransport({
      host: smtp_host,
      port: Number(smtp_port) || 587,
      user: username,
      password,
    });
    info = await transport.sendMail({
      from: username,
      to,
      subject,
      text: html ? undefined : body || '',
      html: html ? body || '' : undefined,
    });
  } catch (err) {
    log.error({ err, spaceId, connectorId: conn.id }, 'mail send: SMTP failed');
    return error(res, 'SMTP_SEND_FAILED', err?.message || 'SMTP send failed', 502);
  }

  // Persist a Sent copy so the UI reflects it immediately (imap_uid NULL → never
  // collides with a synced row; an IMAP-side APPEND is a later enhancement).
  await dbRun(
    `INSERT INTO mail_messages
       (space_id, connector_id, folder, message_id, from_name, from_address,
        to_addresses, subject, preview, body_text, body_html, date, is_read)
     VALUES (?, ?, 'sent', ?, ?, ?, ?::jsonb, ?, ?, ?, ?, now(), true)`,
    [
      spaceId,
      conn.id,
      info?.messageId || null,
      username,
      username,
      JSON.stringify([to]),
      subject,
      String(body || '').replace(/\s+/g, ' ').slice(0, 140),
      html ? null : body || '',
      html ? body || '' : null,
    ]
  );

  return success(res, { messageId: info?.messageId || null });
});

export default router;
