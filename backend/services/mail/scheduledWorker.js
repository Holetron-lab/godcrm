/**
 * MailScheduledWorker (ADR-158 §P6)
 * Polls mail_outbox every 60s and delivers due `pending` scheduled emails via
 * the shared deliverMail() path — analogous to WP-17's ScheduledMessageWorker
 * for the AI-chat panel.
 *
 * Double-send safety: rows are claimed atomically with FOR UPDATE SKIP LOCKED
 * and flipped to `sending` before any SMTP call, so an overlapping tick or a
 * second process can never grab the same row. A crash mid-send leaves the row
 * `sending` (deliberately NOT auto-retried — a resend risks a duplicate email;
 * surfaced in the panel as stuck for manual inspection).
 *
 * Gating: OFF on the NL box until Phase C via MAIL_SCHEDULED_WORKER_SOAKOFF
 * (see server.js) so it can't send from Ring 1 while KZ is still live.
 */

import { dbRun, dbAll, dbGet } from '../../database/connection.js';
import { apiLogger as log } from '../../utils/logger.js';
import { loadImapConnector } from './connector.js';
import { deliverMail } from './deliver.js';
import { normalizeRecipients } from './recipients.js';
import { normalizeAttachments } from './attachments.js';

let _interval = null;
const POLL_INTERVAL_MS = 60_000; // once a minute
const CLAIM_BATCH = 25;

export function startMailScheduledWorker() {
  if (_interval) return; // already running
  _interval = setInterval(tick, POLL_INTERVAL_MS);
  log.info('ADR-158 §P6: MailScheduledWorker started (every 60s)');
}

export function stopMailScheduledWorker() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    log.info('ADR-158 §P6: MailScheduledWorker stopped');
  }
}

async function tick() {
  try {
    // Atomically claim due rows: flip pending→sending in one statement so no
    // other tick/process can also pick them up (SKIP LOCKED = no blocking).
    const due = await dbAll(
      `UPDATE mail_outbox o
          SET status = 'sending', updated_at = now()
        WHERE o.id IN (
          SELECT id FROM mail_outbox
           WHERE status = 'pending' AND scheduled_at <= now()
           ORDER BY scheduled_at ASC
           LIMIT ${CLAIM_BATCH}
           FOR UPDATE SKIP LOCKED
        )
        RETURNING o.*`
    );
    if (!due.length) return;

    log.info({ count: due.length }, 'ADR-158 §P6: delivering due scheduled mail');
    for (const row of due) {
      await deliverOne(row);
    }
  } catch (err) {
    log.error({ err }, 'ADR-158 §P6: MailScheduledWorker tick error');
  }
}

async function deliverOne(row) {
  try {
    const conn = await loadImapConnector(row.space_id, row.connector_id);
    if (!conn) throw new Error('imap connector no longer available');

    // Re-validate the stored payload through the same normalizers the route
    // uses (the row was validated at schedule time, but creds/limits may have
    // changed; and normalizeAttachments turns stored base64 back into Buffers).
    const to = normalizeRecipients(jsonb(row.to_addresses), { field: 'to', required: true });
    const cc = normalizeRecipients(jsonb(row.cc_addresses), { field: 'cc' });
    const bcc = normalizeRecipients(jsonb(row.bcc_addresses), { field: 'bcc' });
    const attachments = normalizeAttachments(jsonb(row.attachments));

    const { sentRow } = await deliverMail({
      spaceId: row.space_id,
      conn,
      to,
      cc,
      bcc,
      subject: row.subject || '',
      body: row.body || '',
      html: !!row.is_html,
      attachments,
      linkedTableId: row.linked_table_id ?? null,
      linkedRowId: row.linked_row_id ?? null,
    });

    await dbRun(
      `UPDATE mail_outbox SET status = 'sent', sent_message_id = ?, error_message = NULL, updated_at = now()
        WHERE id = ?`,
      [sentRow?.id ?? null, row.id]
    );
    log.info({ outboxId: row.id, sentMessageId: sentRow?.id }, 'ADR-158 §P6: scheduled mail sent');
  } catch (err) {
    log.error({ err, outboxId: row.id }, 'ADR-158 §P6: scheduled mail send failed');
    await dbRun(
      `UPDATE mail_outbox SET status = 'failed', error_message = ?, updated_at = now() WHERE id = ?`,
      [String(err?.message || 'send failed').slice(0, 500), row.id]
    );
  }
}

// jsonb columns come back parsed from pg, but a stringified value is possible
// through some adapters — tolerate both.
function jsonb(v) {
  if (v == null) return [];
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return [];
    }
  }
  return v;
}

export default { startMailScheduledWorker, stopMailScheduledWorker };
