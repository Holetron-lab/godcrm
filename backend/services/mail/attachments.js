/**
 * ADR-158 §P4 — outgoing attachment normalization for the mail send path.
 *
 * The compose/reply UI carries attachments base64-encoded inline in the JSON
 * send body (no separate upload endpoint yet). This is the one place that turns
 * that untrusted array into the clean `{ filename, content(Buffer), contentType }`
 * shape nodemailer expects — a trust boundary, so validation and the size guard
 * are non-negotiable (Ponytail: lazy ≠ negligent).
 *
 * Total decoded size is capped: inlining bytes in a JSON body (and re-buffering
 * them for SMTP) is fine for the small everyday case but must not become an
 * unbounded memory/SMTP hazard. Large files are a future upload-then-reference
 * enhancement.
 */

// 15 MB decoded across all attachments — comfortably above the everyday
// screenshot/PDF case, well under anything that would strain the SMTP send.
export const MAX_ATTACHMENTS_BYTES = 15 * 1024 * 1024;
export const MAX_ATTACHMENTS_COUNT = 20;

/** Distinguishable so the route maps it to 400, not 500. */
export class AttachmentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AttachmentError';
    this.status = 400;
  }
}

/**
 * @param {unknown} value  the raw `attachments` field from the request body
 * @returns {Array<{ filename: string, content: Buffer, contentType: string }>}
 * @throws {AttachmentError} on a malformed entry or when the total exceeds the cap
 */
export function normalizeAttachments(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new AttachmentError('`attachments` must be an array');
  }
  if (value.length > MAX_ATTACHMENTS_COUNT) {
    throw new AttachmentError(`Too many attachments (max ${MAX_ATTACHMENTS_COUNT})`);
  }

  const out = [];
  let total = 0;
  for (const [i, att] of value.entries()) {
    if (!att || typeof att !== 'object') {
      throw new AttachmentError(`attachment[${i}] must be an object`);
    }
    const filename = String(att.filename || '').trim();
    if (!filename) throw new AttachmentError(`attachment[${i}] is missing a filename`);
    if (typeof att.content !== 'string' || !att.content) {
      throw new AttachmentError(`attachment[${i}] (${filename}) is missing base64 content`);
    }

    let content;
    try {
      // Tolerate a stray `data:...;base64,` prefix from a FileReader data-URL.
      const b64 = att.content.includes(',') ? att.content.slice(att.content.indexOf(',') + 1) : att.content;
      content = Buffer.from(b64, 'base64');
    } catch {
      throw new AttachmentError(`attachment[${i}] (${filename}) is not valid base64`);
    }
    if (content.length === 0) {
      throw new AttachmentError(`attachment[${i}] (${filename}) decoded to empty content`);
    }

    total += content.length;
    if (total > MAX_ATTACHMENTS_BYTES) {
      throw new AttachmentError(
        `Attachments exceed the ${Math.round(MAX_ATTACHMENTS_BYTES / (1024 * 1024))} MB limit`
      );
    }

    out.push({
      filename,
      content,
      contentType: String(att.contentType || 'application/octet-stream'),
    });
  }
  return out;
}
