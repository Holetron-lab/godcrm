/**
 * ADR-158 §P1 — recipient normalization for the mail send path.
 *
 * The mail module started single-recipient (`to` was a lone string). Reply-All /
 * CC / BCC need a list, and UI fields hand us either an array or a
 * comma/semicolon-separated string. This is the one place that turns any of
 * those into a clean, validated, de-duplicated `string[]` before it reaches
 * nodemailer or the DB — a trust boundary, so validation is non-negotiable
 * (Ponytail: lazy ≠ negligent).
 */

// Same pragmatic shape check the send route already used for a single address.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Distinguishable so the route maps it to 400, not 500. */
export class RecipientError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecipientError';
    this.status = 400;
  }
}

/**
 * @param {string|string[]|null|undefined} value
 * @param {{ field?: string, required?: boolean }} [opts]
 * @returns {string[]} validated, trimmed, de-duplicated addresses
 * @throws {RecipientError} on an invalid address, or empty when `required`
 */
export function normalizeRecipients(value, { field = 'to', required = false } = {}) {
  const raw = Array.isArray(value) ? value : value == null ? [] : [value];
  const list = raw
    .flatMap((v) => String(v).split(/[,;]/))
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set();
  const out = [];
  for (const addr of list) {
    if (!EMAIL_RE.test(addr)) {
      throw new RecipientError(`Invalid ${field} address: ${addr}`);
    }
    const key = addr.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(addr);
    }
  }

  if (required && out.length === 0) {
    throw new RecipientError(`At least one valid ${field} address is required`);
  }
  return out;
}
