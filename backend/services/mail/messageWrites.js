/**
 * ADR-175 P1 §write-dispatch — the single authority for field-level writes to a
 * `mail_messages` row.
 *
 * The B2 facade exposes mail as a logical (system) table, but the generic grid
 * mutate path was hard read-only for it (403). This helper is what the universal
 * PUT dispatches to, so a grid inline-edit (mark-read / star / move-folder /
 * link) applies the SAME validated write the Mail module's bespoke PATCH/link
 * routes do — without pouring anything into `table_rows` (facade invariant).
 *
 * Scope safety: every write is `WHERE id = ? AND space_id = ?`, so a caller can
 * only touch a message in a space it was already authorized for; a foreign id
 * simply updates zero rows → null → 404. PES is intentionally NOT fired here
 * (deferred — ADR-175 Open Question #4 firehose-vs-scoped is unresolved).
 */
import { dbGet } from '../../database/connection.js';
import { getMailColumns } from './schema.js';

// Canonical mail folders — mirror of routes/v3/mail.js FOLDERS and
// src/features/mail/types.ts (MailFolderId). Kept here so the folder whitelist
// on the write path can't drift from the value validation.
export const MAIL_FOLDER_IDS = new Set(['inbox', 'sent', 'drafts', 'archive', 'trash']);

// Columns writable through a field patch. Anything else in the payload is
// ignored (not an error — the grid legitimately sends read-only cells too).
export const MAIL_WRITABLE_FIELDS = new Set([
  'is_read', 'starred', 'folder', 'linked_table_id', 'linked_row_id',
]);

export class MailWriteError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MailWriteError';
  }
}

/**
 * Validate + apply a subset of writable fields to one mail message.
 * @param {{spaceId:number|string, id:number|string, patch:object}} args
 * @returns {Promise<object|null>} the updated row (RETURNING *), or null when
 *          no such message exists in the space.
 * @throws {MailWriteError} on a bad field value or an empty patch (→ 400).
 */
export async function applyMailMessageWrites({ spaceId, id, patch }) {
  const msgId = Number(id);
  const space = Number(spaceId);
  if (!Number.isFinite(msgId)) throw new MailWriteError('Invalid message id');
  if (!Number.isFinite(space)) throw new MailWriteError('Invalid spaceId');

  const p = patch && typeof patch === 'object' ? patch : {};
  const sets = [];
  const params = [];

  // Drift-guard (ADR-175 P1): `starred`/`linked_*` only exist after migs 080/079.
  // On a copied DB missing them, writing the column would 500 at the DB layer;
  // instead reject with a clear MailWriteError → 400. Probe is lazy — only when the
  // patch actually touches an optional field — and runs AFTER value validation so a
  // bad value still fails purely (no DB hit).
  const touchesOptional = 'starred' in p || 'linked_table_id' in p || 'linked_row_id' in p;
  const cols = touchesOptional ? await getMailColumns() : null;
  const requireCol = (col) => {
    if (cols && !cols.has(col)) {
      throw new MailWriteError(`\`${col}\` is unavailable on this database (mail migration not applied)`);
    }
  };

  if ('is_read' in p) {
    if (typeof p.is_read !== 'boolean') throw new MailWriteError('`is_read` must be a boolean');
    sets.push('is_read = ?');
    params.push(p.is_read);
  }
  if ('starred' in p) {
    if (typeof p.starred !== 'boolean') throw new MailWriteError('`starred` must be a boolean');
    requireCol('starred');
    sets.push('starred = ?');
    params.push(p.starred);
  }
  if ('folder' in p) {
    const folder = String(p.folder);
    if (!MAIL_FOLDER_IDS.has(folder)) throw new MailWriteError(`Unknown folder: ${folder}`);
    sets.push('folder = ?');
    params.push(folder);
  }
  // Linkage travels as a pair (mirrors PUT …/messages/:id/link): both numbers to
  // link, or both null to unlink. A lone linked_* key is a malformed patch.
  if ('linked_table_id' in p || 'linked_row_id' in p) {
    const rawTable = p.linked_table_id;
    const rawRow = p.linked_row_id;
    const clearing = rawTable == null && rawRow == null;
    const linkTable = Number(rawTable);
    const linkRow = Number(rawRow);
    if (!clearing && !(Number.isFinite(linkTable) && Number.isFinite(linkRow))) {
      throw new MailWriteError('linked_table_id and linked_row_id must both be numbers, or both null to unlink');
    }
    requireCol('linked_table_id');
    requireCol('linked_row_id');
    sets.push('linked_table_id = ?', 'linked_row_id = ?');
    params.push(clearing ? null : linkTable, clearing ? null : linkRow);
  }

  if (sets.length === 0) {
    throw new MailWriteError('Provide at least one writable field: is_read, starred, folder, linked_table_id, linked_row_id');
  }

  const row = await dbGet(
    `UPDATE mail_messages SET ${sets.join(', ')}, updated_at = now()
      WHERE id = ? AND space_id = ?
      RETURNING *`,
    [...params, msgId, space]
  );
  return row || null;
}

/**
 * Extract the numeric mail_messages id from a facade row identifier. The read
 * facade emits `id: "mail-<n>"` and `base_id: "MAIL000000<n>"` (SystemTableService
 * mapMailRow); the grid may PUT either, or a bare numeric id.
 * @returns {number} NaN when the id is not a recognizable mail row id.
 */
export function extractMailRowId(rowId) {
  const s = String(rowId);
  let m = s.match(/^mail-(\d+)$/i);
  if (m) return Number(m[1]);
  m = s.match(/^MAIL0*(\d+)$/i);
  if (m) return Number(m[1]);
  if (/^\d+$/.test(s)) return Number(s);
  return NaN;
}
