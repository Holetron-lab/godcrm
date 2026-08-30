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
import { imapFetch } from '../../services/mail/imapFetch.js';
import { extractReplyToken } from '../../services/mail/replyToken.js';
import { normalizeRecipients, RecipientError } from '../../services/mail/recipients.js';
import { normalizeAttachments, AttachmentError } from '../../services/mail/attachments.js';
import {
  matchingLabelIds,
  matchesRules,
  normalizeRules,
  collectTableRefs,
  resolveTableRefs,
  resolveLabels,
  RuleError,
} from '../../services/mail/labelRules.js';
import { loadImapConnector } from '../../services/mail/connector.js';
import { bodyToPreview } from '../../services/mail/preview.js';
import { deliverMail, MailSendError } from '../../services/mail/deliver.js';
import { apiLogger as log } from '../../utils/logger.js';
import { success, created, error, badRequest, notFound, forbidden } from '../../utils/response.js';

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

// loadImapConnector moved to services/mail/connector.js so the scheduled-send
// worker resolves + decrypts creds through the same path (imported above).

// DB row → frontend MailMessage shape (src/features/mail/types.ts).
// `labels` is passed in by the caller (batched to avoid an N+1 per row); a row
// with no labels renders no chips. Shape per label: {id, name, icon, color}.
function toMailMessage(r, labels = []) {
  return {
    id: String(r.id),
    // ADR-173 §B.4 — label chips (icon+color) rendered inline on rows/headers.
    labels,
    folder: r.folder,
    fromName: r.from_name || r.from_address || '',
    fromAddress: r.from_address || '',
    to: Array.isArray(r.to_addresses)
      ? r.to_addresses
      : r.to_addresses
        ? JSON.parse(r.to_addresses)
        : [],
    subject: r.subject || '',
    preview: r.preview || '',
    body: r.body_html || r.body_text || '',
    date: r.date ? new Date(r.date).toISOString() : null,
    read: !!r.is_read,
    starred: !!r.starred,
    // ADR-158 §P5 — attachment metadata (filename/contentType/size); [] when none.
    attachments: Array.isArray(r.attachments)
      ? r.attachments
      : r.attachments
        ? JSON.parse(r.attachments)
        : [],
    ticketId: r.ticket_id ?? null,
    // ADR-158 §P2 — generic CRM linkage (deal/lead/ticket/…) + reply token.
    linkedTableId: r.linked_table_id ?? null,
    linkedRowId: r.linked_row_id ?? null,
    replyToken: r.reply_token ?? null,
  };
}

// ADR-158 §P7 — compact "chip-resolve" shape for embedding a mail message as a
// reference chip inside a chat conversation (mirrors the ticket-chip idiom:
// send_widget_message → row_reference attachment). Unlike toMailMessage this is
// display-only metadata (no body/labels) — everything a MailMessageChip needs to
// render collapsed (sender · subject · date · attachment count) and to open the
// message in the reader by `messageId`. Consumed by:
//   - GET …/messages/:msgId/ref  → build the attachment / re-resolve on render
//   - the `mail_message_ref` chat attachment payload (baked at attach time)
function toMailRef(r) {
  const attachments = Array.isArray(r.attachments)
    ? r.attachments
    : r.attachments
      ? JSON.parse(r.attachments)
      : [];
  return {
    messageId: String(r.id),
    spaceId: r.space_id,
    connectorId: r.connector_id ?? null,
    folder: r.folder,
    subject: r.subject || '',
    fromName: r.from_name || r.from_address || '',
    fromAddress: r.from_address || '',
    to: Array.isArray(r.to_addresses)
      ? r.to_addresses
      : r.to_addresses
        ? JSON.parse(r.to_addresses)
        : [],
    date: r.date ? new Date(r.date).toISOString() : null,
    read: !!r.is_read,
    attachmentCount: Array.isArray(attachments) ? attachments.length : 0,
    preview: r.preview || '',
  };
}

// Parse a jsonb column that may arrive already-parsed (pg) or as a string.
function parseJsonb(v, fallback = []) {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

// mail_outbox row → frontend shape for the scheduled-send panel (ADR-158 §P6).
// Bytes are never shipped back — only an attachment count for the list.
function toScheduled(r) {
  const attachments = parseJsonb(r.attachments, []);
  return {
    id: Number(r.id),
    connectorId: r.connector_id ?? null,
    to: parseJsonb(r.to_addresses, []),
    cc: parseJsonb(r.cc_addresses, []),
    bcc: parseJsonb(r.bcc_addresses, []),
    subject: r.subject || '',
    preview: bodyToPreview(r.body, r.is_html),
    // Full composed body (HTML/text as stored) so the "Отложенные" editor can
    // reopen a queued send fully pre-filled and editable (ADR-158 §P6). The list
    // is short (a handful of queued sends), so shipping the body here is cheap.
    body: r.body || '',
    isHtml: !!r.is_html,
    attachmentCount: Array.isArray(attachments) ? attachments.length : 0,
    linkedTableId: r.linked_table_id ?? null,
    linkedRowId: r.linked_row_id ?? null,
    scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null,
    status: r.status,
    errorMessage: r.error_message ?? null,
    sentMessageId: r.sent_message_id != null ? Number(r.sent_message_id) : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
  };
}

// ─── label helpers (ADR-173) ────────────────────────────────────────

// A user-defined label as the API returns it (rail/settings/chips).
function toLabel(r) {
  return {
    id: Number(r.id),
    name: r.name,
    icon: r.icon ?? null,
    color: r.color ?? null,
    showInToolbar: !!r.show_in_toolbar,
    rules: typeof r.rules === 'string' ? JSON.parse(r.rules) : r.rules || {},
    orderIndex: Number(r.order_index) || 0,
    enabled: !!r.enabled,
    ...(r.message_count != null ? { messageCount: Number(r.message_count) } : {}),
  };
}

/**
 * Batch-load the labels attached to a set of messages, keyed by message id.
 * One indexed join for the whole page — never per-row (ADR-173 §Risks: N+1).
 * @returns {Promise<Map<string, Array<{id,name,icon,color}>>>}
 */
async function fetchLabelsMap(messageIds, spaceId) {
  const map = new Map();
  if (!messageIds.length) return map;
  const rows = await dbAll(
    `SELECT mml.message_id, l.id, l.name, l.icon, l.color
       FROM mail_message_labels mml
       JOIN mail_labels l ON l.id = mml.label_id
      WHERE l.space_id = ? AND mml.message_id = ANY(?::bigint[])
      ORDER BY l.order_index, l.id`,
    [spaceId, messageIds]
  );
  for (const r of rows) {
    const key = String(r.message_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ id: Number(r.id), name: r.name, icon: r.icon ?? null, color: r.color ?? null });
  }
  return map;
}

// Confirm a label belongs to this space (guards tag/untag/apply cross-space).
async function loadSpaceLabel(spaceId, labelId) {
  if (!Number.isFinite(labelId)) return null;
  return dbGet('SELECT * FROM mail_labels WHERE id = ? AND space_id = ?', [labelId, spaceId]);
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

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const conn = await loadImapConnector(spaceId, Number(req.query.connector_id) || null);
  if (!conn) return success(res, { messages: [] });

  // ADR-173 §B.4 — `?label=<id>` is a *virtual folder*: filter by label across
  // ALL real folders (message stays put). Takes precedence over `folder`.
  let rows;
  if (req.query.label != null && req.query.label !== '') {
    const labelId = Number(req.query.label);
    if (!Number.isFinite(labelId)) return badRequest(res, 'Invalid label id');
    rows = await dbAll(
      `SELECT m.* FROM mail_messages m
         JOIN mail_message_labels mml ON mml.message_id = m.id
        WHERE m.space_id = ? AND m.connector_id = ? AND mml.label_id = ?
        ORDER BY m.date DESC NULLS LAST, m.id DESC
        LIMIT ? OFFSET ?`,
      [spaceId, conn.id, labelId, limit, offset]
    );
  } else {
    const folder = String(req.query.folder || 'inbox');
    if (!FOLDER_IDS.has(folder)) return badRequest(res, `Unknown folder: ${folder}`);
    rows = await dbAll(
      `SELECT * FROM mail_messages
        WHERE space_id = ? AND connector_id = ? AND folder = ?
        ORDER BY date DESC NULLS LAST, id DESC
        LIMIT ? OFFSET ?`,
      [spaceId, conn.id, folder, limit, offset]
    );
  }

  const labelsMap = await fetchLabelsMap(rows.map((r) => r.id), spaceId);
  return success(res, { messages: rows.map((r) => toMailMessage(r, labelsMap.get(String(r.id)) || [])) });
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
  const labelsMap = await fetchLabelsMap([row.id], spaceId);
  return success(res, { message: toMailMessage(row, labelsMap.get(String(row.id)) || []) });
});

// ─── GET /spaces/:spaceId/mail/messages/:msgId/ref ──────────────────
// ADR-158 §P7 — resolve a mail message to its compact chip shape (sender ·
// subject · date · attachment count) for embedding as a reference chip in a
// chat conversation. Space-scoped + authorized (ensureSpaceAccess), so a chip
// can only be built/re-resolved for a message the caller may actually read.
// Unlike GET …/:msgId this is a pure read — it does NOT mark the message read
// (building/rendering a chip must not silently flip the unread flag). 404 →
// the frontend renders a tombstone chip ("письмо удалено").
router.get('/spaces/:spaceId/mail/messages/:msgId/ref', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const id = Number(req.params.msgId);
  if (!Number.isFinite(id)) return badRequest(res, 'Invalid message id');

  const row = await dbGet(
    `SELECT * FROM mail_messages WHERE id = ? AND space_id = ?`,
    [id, spaceId]
  );
  if (!row) return notFound(res, 'Message');
  return success(res, { ref: toMailRef(row) });
});

// ─── PATCH /spaces/:spaceId/mail/messages/:msgId ────────────────────
// ADR-158 §P1 — mutate a message's flags/placement in one call:
//   { is_read?, starred?, folder? }
// Mark (un)read, star/unstar, and move folders — archive = folder:'archive',
// delete = folder:'trash' (a local move; an IMAP-side move/expunge is a later
// enhancement, same class as the Sent APPEND deferral). All fields optional;
// only the provided ones are written, so the UI can drive each button
// independently against one endpoint.

router.patch('/spaces/:spaceId/mail/messages/:msgId', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const id = Number(req.params.msgId);
  if (!Number.isFinite(id)) return badRequest(res, 'Invalid message id');

  const body = req.body || {};
  const sets = [];
  const params = [];

  if ('is_read' in body) {
    if (typeof body.is_read !== 'boolean') return badRequest(res, '`is_read` must be a boolean');
    sets.push('is_read = ?');
    params.push(body.is_read);
  }
  if ('starred' in body) {
    if (typeof body.starred !== 'boolean') return badRequest(res, '`starred` must be a boolean');
    sets.push('starred = ?');
    params.push(body.starred);
  }
  if ('folder' in body) {
    const folder = String(body.folder);
    if (!FOLDER_IDS.has(folder)) return badRequest(res, `Unknown folder: ${folder}`);
    sets.push('folder = ?');
    params.push(folder);
  }
  if (sets.length === 0) {
    return badRequest(res, 'Provide at least one of: is_read, starred, folder');
  }

  const row = await dbGet(
    `UPDATE mail_messages SET ${sets.join(', ')}, updated_at = now()
      WHERE id = ? AND space_id = ?
      RETURNING *`,
    [...params, id, spaceId]
  );
  if (!row) return notFound(res, 'Message');
  return success(res, { message: toMailMessage(row) });
});

// ADR-158 §P4 — resolve `in_table` rule conditions to concrete value lists so
// the PURE evaluator (labelRules.js) can treat them as `in_list`. This is the
// ONLY side-effecting half of the rule engine.
//
// Security: the DISTINCT query is space-scoped via universal_tables→projects, so
// a label can only pull values from tables in its OWN space (`source.tableId` is
// validated as a positive int at save time but NOT trusted for cross-space
// reach — a foreign id simply resolves to zero rows). The column key travels as
// a BIND param (`data->>?`), never string-concatenated (SQLi-safe, mirrors
// AutomationTriggerService's `data->>? = ?`).
//
// Cost: one query per UNIQUE (table,column,filter) ref, run ONCE before the
// message loop — a sync stays O(messages)+O(refs), not O(messages × refs).
// Fail-closed: any error → empty list → the condition never matches, never 500s.
const IN_TABLE_MAX_VALUES = 5000; // ceiling on the value list one ref can pull

async function resolveTableRefValues(spaceId, refs) {
  const valuesByKey = new Map();
  for (const { key, source } of refs) {
    try {
      const params = [source.column, source.tableId, spaceId];
      let filterSql = '';
      if (source.filter) {
        const like = source.filter.op === 'contains';
        filterSql = like ? ' AND tr.data->>? ILIKE ?' : ' AND tr.data->>? = ?';
        params.push(source.filter.column, like ? `%${source.filter.value}%` : source.filter.value);
      }
      const rows = await dbAll(
        `SELECT DISTINCT tr.data->>? AS val
           FROM table_rows tr
           JOIN universal_tables ut ON tr.table_id = ut.id
           JOIN projects p ON ut.project_id = p.id
          WHERE tr.table_id = ? AND p.space_id = ?${filterSql}
          LIMIT ${IN_TABLE_MAX_VALUES}`,
        params
      );
      valuesByKey.set(
        key,
        rows
          .map((r) => r.val)
          .filter((v) => v != null && String(v).trim() !== '')
          .map(String)
      );
    } catch (err) {
      log.warn({ err, spaceId, ref: key }, 'mail in_table resolve failed; condition yields no match');
      valuesByKey.set(key, []); // fail closed
    }
  }
  return valuesByKey;
}

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

  const inbound = folder !== 'sent' && folder !== 'drafts';

  // ADR-173 §B.3.1 — auto-labeling runs only on inbound folders and only against
  // enabled labels that actually carry a rule. Loaded ONCE before the loop (not
  // per message) so a sync is O(messages), not O(messages × labels).
  let ruleLabels = inbound
    ? await dbAll(
        `SELECT id, rules FROM mail_labels WHERE space_id = ? AND enabled = true`,
        [spaceId]
      )
    : [];

  // ADR-158 §P4 — pre-resolve any `in_table` conditions to live value lists
  // ONCE, before the per-message loop (below). No in_table refs ⇒ zero extra
  // queries and byte-identical behavior to the pre-P4 path.
  if (ruleLabels.length) {
    const refs = collectTableRefs(ruleLabels);
    if (refs.length) {
      const valuesByKey = await resolveTableRefValues(spaceId, refs);
      ruleLabels = resolveLabels(ruleLabels, valuesByKey);
    }
  }

  let synced = 0;
  let linked = 0;
  let labeled = 0;
  for (const m of fetched) {
    // RETURNING (xmax = 0) tells insert from ON CONFLICT update: a fresh tuple
    // has xmax 0, an updated one carries the locking xid. We use it to fire
    // rule-labeling ONLY on a genuine new message — a re-sync must not re-tag
    // (which would resurrect a label the user manually removed). Verified on PG.
    const up = await dbGet(
      `INSERT INTO mail_messages
         (space_id, connector_id, folder, imap_uid, message_id, from_name, from_address,
          to_addresses, subject, preview, body_text, body_html, date, is_read, attachments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?::jsonb)
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
            -- Sticky read: a sync must never un-read a message. We mark read only
            -- in our DB (we don't push \Seen back to IMAP), so EXCLUDED.is_read is
            -- almost always false on re-sync. OR-merge keeps a local read read, and
            -- still honors a server-side read made from another client. (ADR-158)
            is_read = mail_messages.is_read OR EXCLUDED.is_read,
            attachments = EXCLUDED.attachments,
            updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
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
        JSON.stringify(m.attachments || []),
      ]
    );
    synced += 1;

    // ADR-158 §P2 — auto-link an inbound reply back to its CRM row via the
    // `[crm:<token>]` marker the outbound minted. Only for inbound folders, and
    // only when the token resolves to an outbound row in *this* space that is
    // itself linked. Idempotent: skips rows already linked.
    if (inbound && up) {
      const token = extractReplyToken(m.subject);
      if (token) {
        const origin = await dbGet(
          `SELECT linked_table_id, linked_row_id FROM mail_messages
            WHERE space_id = ? AND reply_token = ?
              AND linked_table_id IS NOT NULL AND linked_row_id IS NOT NULL`,
          [spaceId, token]
        );
        if (origin) {
          // Copy ONLY the linkage onto the inbound reply. Do NOT copy reply_token:
          // it is the outbound's join key and is guarded by the (space_id,
          // reply_token) partial-unique index — writing the origin's token here
          // would collide with the origin row and throw on the first real reply.
          await dbRun(
            `UPDATE mail_messages
                SET linked_table_id = ?, linked_row_id = ?, updated_at = now()
              WHERE id = ? AND linked_table_id IS NULL`,
            [origin.linked_table_id, origin.linked_row_id, up.id]
          );
          linked += 1;
        }
      }

      // ADR-173 §B.3.1 — rule-based auto-labeling, only on a genuinely new row.
      // ON CONFLICT DO NOTHING keeps it idempotent and never disturbs a `manual`
      // tag on the same message (that link, if any, is source='manual').
      if (up.inserted && ruleLabels.length) {
        for (const labelId of matchingLabelIds(ruleLabels, m)) {
          await dbRun(
            // RETURNING is explicit so PostgresAdapter.run() does NOT auto-append
            // `RETURNING id` — this join table has a composite PK and no `id`
            // column, so that append throws "column id does not exist".
            `INSERT INTO mail_message_labels (message_id, label_id, source)
             VALUES (?, ?, 'rule')
             ON CONFLICT (message_id, label_id) DO NOTHING
             RETURNING message_id`,
            [up.id, labelId]
          );
          labeled += 1;
        }
      }
    }
  }

  return success(res, { synced, folder, linked, labeled });
});

// ─── POST /spaces/:spaceId/mail/send ────────────────────────────────

router.post('/spaces/:spaceId/mail/send', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const { subject, body, html } = req.body || {};
  // `to` accepts a single string (back-compat) or a string[]; `cc`/`bcc` are
  // optional lists → Reply-All / CC / BCC. Validation lives in one helper.
  let toList, ccList, bccList;
  try {
    toList = normalizeRecipients(req.body?.to, { field: 'to', required: true });
    ccList = normalizeRecipients(req.body?.cc, { field: 'cc' });
    bccList = normalizeRecipients(req.body?.bcc, { field: 'bcc' });
  } catch (err) {
    if (err instanceof RecipientError) return badRequest(res, err.message);
    throw err;
  }
  if (!subject || typeof subject !== 'string') {
    return badRequest(res, '`subject` is required');
  }

  // Inline attachments carried base64 in the JSON body. Kept small on purpose —
  // this path avoids a separate upload endpoint; large files are a future
  // upload-then-reference enhancement. Guard the decoded total so a big paste
  // can't blow up the SMTP send or the request body.
  let attachments;
  try {
    attachments = normalizeAttachments(req.body?.attachments);
  } catch (err) {
    if (err instanceof AttachmentError) return badRequest(res, err.message);
    throw err;
  }

  // ADR-158 §P2 — CRM-row linkage. Both ids must be present to link; a plain
  // compose stays token-free. The reply token itself is minted at actual send
  // time inside deliverMail() so a scheduled send embeds it in the *real*
  // outgoing subject, so here we only carry the ids.
  const linkedTableId = Number(req.body?.linked_table_id);
  const linkedRowId = Number(req.body?.linked_row_id);
  const linked = Number.isFinite(linkedTableId) && Number.isFinite(linkedRowId);

  const conn = await loadImapConnector(spaceId, Number(req.body?.connector_id) || null);
  if (!conn) return badRequest(res, 'No imap connector for this space');

  // ADR-158 §P6 — optional deferred send. A future `scheduledAt` (ISO) queues
  // the fully-composed message in mail_outbox instead of sending now; the
  // minute-poll worker delivers it via the same deliverMail() path when due.
  const rawSchedule = req.body?.scheduledAt ?? req.body?.scheduled_at;
  if (rawSchedule != null && rawSchedule !== '') {
    const when = new Date(rawSchedule);
    if (Number.isNaN(when.getTime())) {
      return badRequest(res, '`scheduledAt` must be a valid ISO timestamp');
    }
    if (when.getTime() <= Date.now()) {
      return badRequest(res, '`scheduledAt` must be in the future');
    }
    // Store attachment bytes as canonical base64 (re-decoded by the worker).
    const storedAttachments = attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: a.content.toString('base64'),
    }));
    const row = await dbGet(
      `INSERT INTO mail_outbox
         (space_id, connector_id, to_addresses, cc_addresses, bcc_addresses,
          subject, body, is_html, attachments, linked_table_id, linked_row_id,
          scheduled_at, status, created_by)
       VALUES (?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?, ?, ?::jsonb, ?, ?, ?, 'pending', ?)
       RETURNING *`,
      [
        spaceId,
        conn.id,
        JSON.stringify(toList),
        JSON.stringify(ccList),
        JSON.stringify(bccList),
        subject,
        body || '',
        !!html,
        JSON.stringify(storedAttachments),
        linked ? linkedTableId : null,
        linked ? linkedRowId : null,
        when.toISOString(),
        req.user?.id ?? null,
      ]
    );
    return created(res, { scheduled: toScheduled(row) });
  }

  // Immediate send via the shared path (SMTP + Sent copy + token minting).
  let result;
  try {
    result = await deliverMail({
      spaceId,
      conn,
      to: toList,
      cc: ccList,
      bcc: bccList,
      subject,
      body,
      html: !!html,
      attachments,
      linkedTableId: linked ? linkedTableId : null,
      linkedRowId: linked ? linkedRowId : null,
    });
  } catch (err) {
    if (err instanceof MailSendError) return badRequest(res, err.message);
    log.error({ err, spaceId, connectorId: conn.id }, 'mail send: SMTP failed');
    return error(res, 'SMTP_SEND_FAILED', err?.message || 'SMTP send failed', 502);
  }

  return success(res, {
    messageId: result.info?.messageId || null,
    replyToken: result.replyToken,
    linkedTableId: linked ? linkedTableId : null,
    linkedRowId: linked ? linkedRowId : null,
  });
});

// ─── POST /spaces/:spaceId/mail/drafts ──────────────────────────────
// ADR-158 §P6 — save the composer contents as a Drafts message without sending.
// Persists a local mail_messages row (folder='drafts'); an optional `id` in the
// body re-saves that existing draft in place (Gmail keeps one draft, not a new
// row per keystroke-save) instead of spawning duplicates. Attachment metadata
// only, same as the Sent copy — an IMAP-side APPEND to \Drafts and byte-perfect
// draft-resend are deferred enhancements (same class as the Sent APPEND).
router.post('/spaces/:spaceId/mail/drafts', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const { subject, body, html } = req.body || {};
  // A draft can be half-finished, so recipients are NOT required here (unlike
  // /send) — you save a draft precisely because it isn't ready to go out.
  let toList, ccList, bccList;
  try {
    toList = normalizeRecipients(req.body?.to, { field: 'to' });
    ccList = normalizeRecipients(req.body?.cc, { field: 'cc' });
    bccList = normalizeRecipients(req.body?.bcc, { field: 'bcc' });
  } catch (err) {
    if (err instanceof RecipientError) return badRequest(res, err.message);
    throw err;
  }

  let attachments;
  try {
    attachments = normalizeAttachments(req.body?.attachments);
  } catch (err) {
    if (err instanceof AttachmentError) return badRequest(res, err.message);
    throw err;
  }
  const attachmentMeta = attachments.map((a) => ({
    filename: a.filename,
    contentType: a.contentType,
    size: a.content.length,
  }));

  const conn = await loadImapConnector(spaceId, Number(req.body?.connector_id) || null);
  if (!conn) return badRequest(res, 'No imap connector for this space');

  const linkedTableId = Number(req.body?.linked_table_id);
  const linkedRowId = Number(req.body?.linked_row_id);
  const linked = Number.isFinite(linkedTableId) && Number.isFinite(linkedRowId);
  const preview = bodyToPreview(body, html);
  const bodyText = html ? null : body || '';
  const bodyHtml = html ? body || '' : null;

  const draftId = Number(req.body?.id);
  let row;
  if (Number.isFinite(draftId)) {
    // Re-save an existing draft in place (only if it's still a draft in this space).
    row = await dbGet(
      `UPDATE mail_messages
          SET to_addresses = ?::jsonb, subject = ?, preview = ?, body_text = ?, body_html = ?,
              attachments = ?::jsonb, linked_table_id = ?, linked_row_id = ?, date = now(), updated_at = now()
        WHERE id = ? AND space_id = ? AND folder = 'drafts'
        RETURNING *`,
      [
        JSON.stringify(toList),
        subject || '',
        preview,
        bodyText,
        bodyHtml,
        JSON.stringify(attachmentMeta),
        linked ? linkedTableId : null,
        linked ? linkedRowId : null,
        draftId,
        spaceId,
      ]
    );
    if (!row) return notFound(res, 'Draft');
  } else {
    row = await dbGet(
      `INSERT INTO mail_messages
         (space_id, connector_id, folder, from_name, from_address,
          to_addresses, subject, preview, body_text, body_html, date, is_read,
          attachments, linked_table_id, linked_row_id)
       VALUES (?, ?, 'drafts', ?, ?, ?::jsonb, ?, ?, ?, ?, now(), true, ?::jsonb, ?, ?)
       RETURNING *`,
      [
        spaceId,
        conn.id,
        conn.creds?.username || '',
        conn.creds?.username || '',
        JSON.stringify(toList),
        subject || '',
        preview,
        bodyText,
        bodyHtml,
        JSON.stringify(attachmentMeta),
        linked ? linkedTableId : null,
        linked ? linkedRowId : null,
      ]
    );
  }

  return created(res, { message: toMailMessage(row) });
});

// ─── GET /spaces/:spaceId/mail/scheduled ────────────────────────────
// ADR-158 §P6 — the scheduled-send queue for the composer panel (analog of the
// AI-chat scheduled-messages table). Lists this space's outbox, soonest-first.
// `?status=` optionally narrows (default: everything not yet terminally sent —
// i.e. pending/sending/failed — since those are what the panel acts on).
router.get('/spaces/:spaceId/mail/scheduled', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  let rows;
  if (status) {
    rows = await dbAll(
      `SELECT * FROM mail_outbox WHERE space_id = ? AND status = ?
        ORDER BY scheduled_at ASC LIMIT ?`,
      [spaceId, status, limit]
    );
  } else {
    rows = await dbAll(
      `SELECT * FROM mail_outbox
        WHERE space_id = ? AND status IN ('pending', 'sending', 'failed')
        ORDER BY scheduled_at ASC LIMIT ?`,
      [spaceId, limit]
    );
  }
  return success(res, { scheduled: rows.map(toScheduled) });
});

// ─── DELETE /spaces/:spaceId/mail/scheduled/:id ─────────────────────
// Cancel a scheduled send before it fires. Only a still-`pending` row can be
// canceled — once the worker has claimed it (`sending`) or it has been `sent`,
// cancellation is a no-op 409 so we never claim to have stopped an email that
// already went out.
router.delete('/spaces/:spaceId/mail/scheduled/:id', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return badRequest(res, 'Invalid scheduled id');

  const row = await dbGet(
    `UPDATE mail_outbox SET status = 'canceled', updated_at = now()
      WHERE id = ? AND space_id = ? AND status = 'pending'
      RETURNING id`,
    [id, spaceId]
  );
  if (!row) {
    // Distinguish "not here" from "too late to cancel".
    const existing = await dbGet('SELECT status FROM mail_outbox WHERE id = ? AND space_id = ?', [id, spaceId]);
    if (!existing) return notFound(res, 'Scheduled message');
    return error(res, 'NOT_CANCELABLE', `Cannot cancel a message that is ${existing.status}`, 409);
  }
  return success(res, { canceled: true, id });
});

// ─── PATCH /spaces/:spaceId/mail/scheduled/:id ──────────────────────
// ADR-158 §P6 — edit a still-`pending` queued send in place: recipients, subject,
// body and/or the fire time. Editing in place (vs. cancel-then-recreate) keeps the
// row id AND its stored attachment bytes — the composer never has the bytes to
// re-upload, so a recreate would silently drop them. Only `pending` is editable:
// once the worker has claimed it (`sending`/`sent`) we refuse (409), same honesty
// contract as cancel.
router.patch('/spaces/:spaceId/mail/scheduled/:id', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return badRequest(res, 'Invalid scheduled id');

  const { subject, body, html } = req.body || {};
  let toList, ccList, bccList;
  try {
    toList = normalizeRecipients(req.body?.to, { field: 'to', required: true });
    ccList = normalizeRecipients(req.body?.cc, { field: 'cc' });
    bccList = normalizeRecipients(req.body?.bcc, { field: 'bcc' });
  } catch (err) {
    if (err instanceof RecipientError) return badRequest(res, err.message);
    throw err;
  }
  if (!subject || typeof subject !== 'string') {
    return badRequest(res, '`subject` is required');
  }

  const rawSchedule = req.body?.scheduledAt ?? req.body?.scheduled_at;
  if (rawSchedule == null || rawSchedule === '') {
    return badRequest(res, '`scheduledAt` is required');
  }
  const when = new Date(rawSchedule);
  if (Number.isNaN(when.getTime())) {
    return badRequest(res, '`scheduledAt` must be a valid ISO timestamp');
  }
  if (when.getTime() <= Date.now()) {
    return badRequest(res, '`scheduledAt` must be in the future');
  }

  // New attachments (if any) are APPENDED to the stored bytes — the composer only
  // ever holds files the user just picked, not the originals, so a replace would
  // drop what's already queued. Empty → the stored `attachments` jsonb is untouched.
  let newAttachments;
  try {
    newAttachments = normalizeAttachments(req.body?.attachments);
  } catch (err) {
    if (err instanceof AttachmentError) return badRequest(res, err.message);
    throw err;
  }
  const appended = newAttachments.map((a) => ({
    filename: a.filename,
    contentType: a.contentType,
    content: a.content.toString('base64'),
  }));

  const row = await dbGet(
    `UPDATE mail_outbox
        SET to_addresses = ?::jsonb, cc_addresses = ?::jsonb, bcc_addresses = ?::jsonb,
            subject = ?, body = ?, is_html = ?, scheduled_at = ?,
            attachments = COALESCE(attachments, '[]'::jsonb) || ?::jsonb, updated_at = now()
      WHERE id = ? AND space_id = ? AND status = 'pending'
      RETURNING *`,
    [
      JSON.stringify(toList),
      JSON.stringify(ccList),
      JSON.stringify(bccList),
      subject,
      body || '',
      !!html,
      when.toISOString(),
      JSON.stringify(appended),
      id,
      spaceId,
    ]
  );
  if (!row) {
    // Distinguish "not here" from "too late to edit" — mirror the cancel contract.
    const existing = await dbGet('SELECT status FROM mail_outbox WHERE id = ? AND space_id = ?', [id, spaceId]);
    if (!existing) return notFound(res, 'Scheduled message');
    return error(res, 'NOT_EDITABLE', `Cannot edit a message that is ${existing.status}`, 409);
  }
  return success(res, { scheduled: toScheduled(row) });
});

// ─── PUT /spaces/:spaceId/mail/messages/:msgId/link ─────────────────
// ADR-158 §P2 — attach-to-row: link any message to a CRM row (deal/lead/ticket/…)
// or clear the link (both ids null). Manual counterpart to the reply-token
// auto-link; lets an operator file an arbitrary email onto a record.

router.put('/spaces/:spaceId/mail/messages/:msgId/link', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const id = Number(req.params.msgId);
  if (!Number.isFinite(id)) return badRequest(res, 'Invalid message id');

  const rawTable = req.body?.linked_table_id;
  const rawRow = req.body?.linked_row_id;
  const clearing = rawTable == null && rawRow == null;
  const tableId = Number(rawTable);
  const rowId = Number(rawRow);
  if (!clearing && !(Number.isFinite(tableId) && Number.isFinite(rowId))) {
    return badRequest(res, 'linked_table_id and linked_row_id must both be numbers, or both null to unlink');
  }

  const row = await dbGet(
    `UPDATE mail_messages SET linked_table_id = ?, linked_row_id = ?, updated_at = now()
      WHERE id = ? AND space_id = ?
      RETURNING *`,
    [clearing ? null : tableId, clearing ? null : rowId, id, spaceId]
  );
  if (!row) return notFound(res, 'Message');
  return success(res, { message: toMailMessage(row) });
});

// ════════════════════════════════════════════════════════════════════
// ADR-158 §P4 (ex-ADR-173) — Mail Labels & Rules API (B.4)
// A label is a tag, not a folder move. Space-scoped + RBAC via
// ensureSpaceAccess like every route above. `rules` is validated at this
// boundary by normalizeRules (400 on bad shape) so a label can't be saved
// with a rule that would silently never fire.
// ════════════════════════════════════════════════════════════════════

// Hard cap for the opt-in backfill so a huge mailbox can't turn one click into
// an unbounded scan. Surfaced to the caller as `capped` when hit.
const LABEL_BACKFILL_MAX = 5000;

// ─── GET /spaces/:spaceId/mail/labels ───────────────────────────────
// List a space's labels with per-label message counts (rail badges). One
// grouped LEFT JOIN — no N+1 over labels.
router.get('/spaces/:spaceId/mail/labels', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const rows = await dbAll(
    `SELECT l.*, COUNT(mml.message_id) AS message_count
       FROM mail_labels l
       LEFT JOIN mail_message_labels mml ON mml.label_id = l.id
      WHERE l.space_id = ?
      GROUP BY l.id
      ORDER BY l.order_index, l.id`,
    [spaceId]
  );
  return success(res, { labels: rows.map(toLabel) });
});

// ─── POST /spaces/:spaceId/mail/labels ──────────────────────────────
// Create a label. `{ name (req), icon?, color?, show_in_toolbar?, rules?,
// order_index?, enabled? }`. Empty/absent `rules` ⇒ manual-only label.
router.post('/spaces/:spaceId/mail/labels', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const b = req.body || {};
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) return badRequest(res, '`name` is required');

  let rules;
  try {
    rules = normalizeRules(b.rules);
  } catch (err) {
    if (err instanceof RuleError) return badRequest(res, err.message);
    throw err;
  }

  const row = await dbGet(
    `INSERT INTO mail_labels
       (space_id, name, icon, color, show_in_toolbar, rules, order_index, enabled)
     VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?)
     RETURNING *`,
    [
      spaceId,
      name,
      b.icon ?? null,
      b.color ?? null,
      !!b.show_in_toolbar,
      JSON.stringify(rules),
      Number.isFinite(Number(b.order_index)) ? Number(b.order_index) : 0,
      b.enabled === undefined ? true : !!b.enabled,
    ]
  );
  return created(res, { label: toLabel(row) });
});

// ─── PATCH /spaces/:spaceId/mail/labels/:labelId ────────────────────
// Update any subset of fields. `rules` re-validated when present.
router.patch('/spaces/:spaceId/mail/labels/:labelId', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const labelId = Number(req.params.labelId);
  const existing = await loadSpaceLabel(spaceId, labelId);
  if (!existing) return notFound(res, 'Label');

  const b = req.body || {};
  const sets = [];
  const params = [];

  if ('name' in b) {
    const n = typeof b.name === 'string' ? b.name.trim() : '';
    if (!n) return badRequest(res, '`name` cannot be empty');
    sets.push('name = ?');
    params.push(n);
  }
  if ('icon' in b) {
    sets.push('icon = ?');
    params.push(b.icon ?? null);
  }
  if ('color' in b) {
    sets.push('color = ?');
    params.push(b.color ?? null);
  }
  if ('show_in_toolbar' in b) {
    if (typeof b.show_in_toolbar !== 'boolean') return badRequest(res, '`show_in_toolbar` must be a boolean');
    sets.push('show_in_toolbar = ?');
    params.push(b.show_in_toolbar);
  }
  if ('enabled' in b) {
    if (typeof b.enabled !== 'boolean') return badRequest(res, '`enabled` must be a boolean');
    sets.push('enabled = ?');
    params.push(b.enabled);
  }
  if ('order_index' in b) {
    const oi = Number(b.order_index);
    if (!Number.isFinite(oi)) return badRequest(res, '`order_index` must be a number');
    sets.push('order_index = ?');
    params.push(oi);
  }
  if ('rules' in b) {
    let rules;
    try {
      rules = normalizeRules(b.rules);
    } catch (err) {
      if (err instanceof RuleError) return badRequest(res, err.message);
      throw err;
    }
    sets.push('rules = ?::jsonb');
    params.push(JSON.stringify(rules));
  }
  if (sets.length === 0) return badRequest(res, 'No updatable fields provided');

  const row = await dbGet(
    `UPDATE mail_labels SET ${sets.join(', ')}, updated_at = now()
      WHERE id = ? AND space_id = ?
      RETURNING *`,
    [...params, labelId, spaceId]
  );
  return success(res, { label: toLabel(row) });
});

// ─── DELETE /spaces/:spaceId/mail/labels/:labelId ───────────────────
// Delete a label; its join rows go with it (FK ON DELETE CASCADE).
router.delete('/spaces/:spaceId/mail/labels/:labelId', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const labelId = Number(req.params.labelId);
  const existing = await loadSpaceLabel(spaceId, labelId);
  if (!existing) return notFound(res, 'Label');

  await dbRun('DELETE FROM mail_labels WHERE id = ? AND space_id = ?', [labelId, spaceId]);
  return success(res, { deleted: true, id: labelId });
});

// ─── POST /spaces/:spaceId/mail/labels/:labelId/apply ───────────────
// Backfill (ADR-158 §P4 B.3.2): re-evaluate this label's rules over existing
// space messages and sync ONLY its `rule`-sourced links — add new matches,
// drop stale ones — never touching a human's `manual` tag. Bounded by
// LABEL_BACKFILL_MAX; `capped:true` signals the scan hit the ceiling.
router.post('/spaces/:spaceId/mail/labels/:labelId/apply', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const labelId = Number(req.params.labelId);
  const label = await loadSpaceLabel(spaceId, labelId);
  if (!label) return notFound(res, 'Label');

  const rawRules = typeof label.rules === 'string' ? JSON.parse(label.rules) : label.rules;

  // ADR-158 §P4 — resolve in_table refs ONCE, then match every message against
  // the concrete value list. No refs ⇒ rules pass through untouched.
  const refs = collectTableRefs([{ rules: rawRules }]);
  const rules = refs.length
    ? resolveTableRefs(rawRules, await resolveTableRefValues(spaceId, refs))
    : rawRules;

  const rows = await dbAll(
    `SELECT id, from_name, from_address, to_addresses, subject, body_text, body_html, preview
       FROM mail_messages
      WHERE space_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    [spaceId, LABEL_BACKFILL_MAX]
  );

  const matchIds = [];
  for (const r of rows) {
    if (matchesRules(rules, r)) matchIds.push(r.id);
  }

  // Drop stale rule-links (matched before, not now); manual links untouched.
  if (matchIds.length) {
    await dbRun(
      `DELETE FROM mail_message_labels
        WHERE label_id = ? AND source = 'rule' AND message_id <> ALL(?::bigint[])`,
      [labelId, matchIds]
    );
    for (const mid of matchIds) {
      await dbRun(
        // Explicit RETURNING — see the sync-hook note: this composite-PK join
        // table has no `id`, so the adapter's auto `RETURNING id` would throw.
        `INSERT INTO mail_message_labels (message_id, label_id, source)
         VALUES (?, ?, 'rule')
         ON CONFLICT (message_id, label_id) DO NOTHING
         RETURNING message_id`,
        [mid, labelId]
      );
    }
  } else {
    await dbRun(
      `DELETE FROM mail_message_labels WHERE label_id = ? AND source = 'rule'`,
      [labelId]
    );
  }

  return success(res, {
    applied: matchIds.length,
    scanned: rows.length,
    capped: rows.length >= LABEL_BACKFILL_MAX,
  });
});

// ─── POST /spaces/:spaceId/mail/messages/:msgId/labels ──────────────
// Manual tag. Body `{ label_id }`. Idempotent upsert; if a `rule` link already
// exists it is promoted to `manual` so a later rule run can't drop what the
// user explicitly set.
router.post('/spaces/:spaceId/mail/messages/:msgId/labels', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const msgId = Number(req.params.msgId);
  if (!Number.isFinite(msgId)) return badRequest(res, 'Invalid message id');

  const labelId = Number(req.body?.label_id);
  const label = await loadSpaceLabel(spaceId, labelId);
  if (!label) return notFound(res, 'Label');

  const msg = await dbGet('SELECT id FROM mail_messages WHERE id = ? AND space_id = ?', [msgId, spaceId]);
  if (!msg) return notFound(res, 'Message');

  await dbRun(
    // Explicit RETURNING — this composite-PK join table has no `id`, so
    // PostgresAdapter.run()'s auto `RETURNING id` would throw (see sync hook).
    `INSERT INTO mail_message_labels (message_id, label_id, source)
     VALUES (?, ?, 'manual')
     ON CONFLICT (message_id, label_id) DO UPDATE SET source = 'manual'
     RETURNING message_id`,
    [msgId, labelId]
  );
  return success(res, { tagged: true, messageId: String(msgId), labelId });
});

// ─── DELETE /spaces/:spaceId/mail/messages/:msgId/labels/:labelId ───
// Manual untag. The USING join scopes the delete to this space, so a caller
// can't strip a label off another space's message by id-guessing.
router.delete('/spaces/:spaceId/mail/messages/:msgId/labels/:labelId', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const msgId = Number(req.params.msgId);
  const labelId = Number(req.params.labelId);
  if (!Number.isFinite(msgId) || !Number.isFinite(labelId)) return badRequest(res, 'Invalid id');

  await dbRun(
    `DELETE FROM mail_message_labels mml
       USING mail_messages m
      WHERE mml.message_id = m.id AND m.space_id = ?
        AND mml.message_id = ? AND mml.label_id = ?`,
    [spaceId, msgId, labelId]
  );
  return success(res, { untagged: true, messageId: String(msgId), labelId });
});

export default router;
