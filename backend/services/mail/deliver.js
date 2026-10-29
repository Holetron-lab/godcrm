/**
 * deliverMail — the single outbound-send path shared by the immediate
 * `POST /mail/send` route and the scheduled-send worker (ADR-158 §P6).
 *
 * It does exactly what the /send route used to do inline: mint a reply token
 * when composing against a CRM row, embed it in the subject, send over the
 * connector's SMTP creds, then persist a Sent copy in mail_messages (metadata
 * and file references for attachments; bytes are in project/space files). Pulling
 * it into one function means the worker can replay a send with byte-identical
 * behavior instead of a copy-pasted second implementation.
 */

import { dbGet, withTransactionAsync } from '../../database/connection.js';
import { randomUUID } from 'node:crypto';
import { storeMailAttachments } from './attachmentStorage.js';
import SMTPService from '../SMTPService.js';
import { generateReplyToken, embedReplyToken } from './replyToken.js';

// Thrown for a caller-fixable precondition (missing SMTP creds). SMTP transport
// failures propagate as the raw nodemailer error so callers can log the cause.
export class MailSendError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MailSendError';
  }
}

/**
 * Send one message and persist its Sent copy.
 *
 * @param {object} args
 * @param {number} args.spaceId
 * @param {{ id:number, creds:object }} args.conn  resolved imap/smtp connector
 * @param {string[]} args.to
 * @param {string[]} [args.cc]
 * @param {string[]} [args.bcc]
 * @param {string} args.subject
 * @param {string} [args.body]
 * @param {boolean} [args.html]  body is HTML when true, else plain text
 * @param {Array<{filename,content:Buffer,contentType}>} [args.attachments]
 * @param {number|null} [args.linkedTableId]
 * @param {number|null} [args.linkedRowId]
 * @returns {Promise<{ info:object, sentRow:object, replyToken:string|null, linked:boolean }>}
 */
export async function deliverMail({
  spaceId,
  conn,
  to,
  cc = [],
  bcc = [],
  subject,
  body = '',
  html = false,
  attachments = [],
  linkedTableId = null,
  linkedRowId = null,
  inReplyToId = null,
  projectId = null,
  userId = null,
  messageId = `<${randomUUID()}@godcrm.ai>`,
}) {
  const { smtp_host, smtp_port, username, password } = conn.creds;
  if (!smtp_host || !username || !password) {
    throw new MailSendError('connector is missing SMTP host/username/password');
  }

  const original = inReplyToId == null ? null : await dbGet(
    'SELECT id, message_id FROM mail_messages WHERE id = ? AND space_id = ? AND connector_id = ?',
    [inReplyToId, spaceId, conn.id]
  );
  if (inReplyToId != null && !original) throw new MailSendError('Reply message is not in this mailbox');

  const linked = Number.isFinite(linkedTableId) && Number.isFinite(linkedRowId);
  const replyToken = linked ? generateReplyToken() : null;
  const outSubject = linked ? embedReplyToken(subject, replyToken) : subject;

  // Save bytes before SMTP: a storage failure must never be reported as a failed
  // send after the remote server has already accepted the message.
  const attachmentMeta = await storeMailAttachments({ spaceId, connectorId: conn.id,
    messageId, attachments, projectId, userId });

  const transport = SMTPService.createTransport({
    host: smtp_host,
    port: Number(smtp_port) || 587,
    user: username,
    password,
  });
  const info = await transport.sendMail({
    messageId,
    from: username,
    to,
    cc: cc.length ? cc : undefined,
    bcc: bcc.length ? bcc : undefined,
    subject: outSubject,
    inReplyTo: original?.message_id || undefined,
    references: original?.message_id || undefined,
    text: html ? undefined : body || '',
    html: html ? body || '' : undefined,
    attachments: attachments.length ? attachments : undefined,
  });

  // Persist a Sent copy so the UI reflects it immediately (imap_uid NULL → never
  // collides with a synced row; an IMAP-side APPEND is a later enhancement).
  const sentRow = await withTransactionAsync(async (tx) => {
    const row = await tx.get(
      `INSERT INTO mail_messages
         (space_id, connector_id, folder, message_id, from_name, from_address,
          to_addresses, subject, preview, body_text, body_html, date, is_read,
          attachments, reply_token, linked_table_id, linked_row_id)
       VALUES (?, ?, 'sent', ?, ?, ?, ?::jsonb, ?, ?, ?, ?, now(), true, ?::jsonb, ?, ?, ?)
       RETURNING *`,
      [
        spaceId,
        conn.id,
        info?.messageId || messageId,
        username,
        username,
        JSON.stringify(to),
        outSubject,
        String(body || '').replace(/\s+/g, ' ').slice(0, 140),
        html ? null : body || '',
        html ? body || '' : null,
        JSON.stringify(attachmentMeta),
        replyToken,
        linked ? linkedTableId : null,
        linked ? linkedRowId : null,
      ]
    );

    if (original) await tx.run(
      'UPDATE mail_messages SET replied_at = now(), updated_at = now() WHERE id = ? AND space_id = ? AND connector_id = ?',
      [inReplyToId, spaceId, conn.id]
    );
    return row;
  });

  return { info, sentRow, replyToken, linked };
}

export default { deliverMail, MailSendError };
