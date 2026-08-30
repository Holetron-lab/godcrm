/**
 * ADR-158 §P5 — row-attach read-through for the Mail system-table mirror.
 *
 * `mail_messages` is a PHYSICAL table (BIGSERIAL id). Its rows are projected
 * into the `sync_target='mail_messages'` universal_tables mirror on the fly by
 * SystemTableService.getMailMessagesData and NEVER materialize in `table_rows`.
 * So the generic chip resolver (send_widget_message) and the inline `[[row:T/R]]`
 * resolver — both of which read row bodies from `table_rows` — cannot title a
 * mail row: the row lookup misses and the chip is dropped.
 *
 * These helpers let both resolvers pull the chip title straight from
 * `mail_messages` when the target table is that mirror. No data is duplicated
 * into `table_rows`; we read the physical table by message id (= the chip's
 * row_id). The contract "attach mail = send_widget_message({ table_id: mirror,
 * row_id: message_id })" thus becomes true end-to-end.
 *
 * Authz note: the title snapshot is safe (the poster already sees the message
 * in their own Mail UI). Real read authorization is enforced on open, by the
 * space-scoped reader GET — not here.
 */
import { dbAll, isPostgres } from '../../database/connection.js';

export const MAIL_MIRROR_SYNC_TARGET = 'mail_messages';

/** True when a universal_tables row is the read-only Mail mirror. */
export function isMailMirror(table) {
  return !!table && table.sync_target === MAIL_MIRROR_SYNC_TARGET;
}

/**
 * Batch-resolve mail message headers by id.
 * @param {Array<number|string>} messageIds
 * @returns {Promise<Map<number, {id:number, subject:string, from_address:string, from_name:string}>>}
 */
export async function fetchMailChipHeaders(messageIds) {
  const ids = [...new Set((messageIds || []).map(Number).filter(Number.isFinite))];
  if (!ids.length) return new Map();

  let rows;
  if (isPostgres()) {
    rows = await dbAll(
      `SELECT id, subject, from_address, from_name FROM mail_messages WHERE id = ANY($1::bigint[])`,
      [ids]
    );
  } else {
    rows = await dbAll(
      `SELECT id, subject, from_address, from_name FROM mail_messages WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
  }

  const map = new Map();
  for (const r of rows) map.set(Number(r.id), r);
  return map;
}

/**
 * Build a chip title from a mail header row: "Subject — Sender".
 * Falls back to whichever half is present, or null when both are empty.
 */
export function mailChipTitle(header) {
  if (!header) return null;
  const subject = (header.subject || '').trim();
  const sender = (header.from_name || header.from_address || '').trim();
  if (subject && sender) return `${subject} — ${sender}`;
  return subject || sender || null;
}
