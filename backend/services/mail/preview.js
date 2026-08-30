/**
 * ADR-158 — list-snippet builder for locally-composed mail.
 *
 * Inbound (IMAP) messages get a clean preview from mailparser's decoded text
 * (imapFetch.toPreview). But messages we compose and store ourselves — sent,
 * drafts, scheduled sends — carry the raw HTML body. Stuffing that straight
 * into `preview` leaks `<p>…</p>` and `&nbsp;` into the list snippet
 * (screenshot bug, 2026-07-15). This is the ONE place that turns a composed
 * body into a plain-text snippet.
 *
 * Ponytail: no new dep (no cheerio/he). Strip tags, decode the handful of
 * entities a rich-text editor actually emits, collapse whitespace, truncate.
 */

const PREVIEW_MAX = 140;

// Named entities a contenteditable/HTML mail body realistically produces. The
// long tail (e.g. &mdash;) is rare enough that leaving it is acceptable; add
// here if a real message surfaces one.
const ENTITIES = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  '#160': ' ',
};

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    const key = code.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(ENTITIES, key)) return ENTITIES[key];
    // Numeric entity not in the map above: &#NN; (decimal) or &#xNN; (hex).
    if (code[0] === '#') {
      const cp = code[1] === 'x' || code[1] === 'X'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      if (Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff) {
        try {
          return String.fromCodePoint(cp);
        } catch {
          return ' ';
        }
      }
    }
    return m; // unknown named entity — leave verbatim
  });
}

/**
 * Build a plain-text list snippet from a composed message body.
 * @param {string} body   the stored body (HTML when isHtml, else plain text)
 * @param {boolean} [isHtml] true if `body` is HTML markup
 * @returns {string} whitespace-collapsed, entity-decoded, ≤140-char snippet
 */
export function bodyToPreview(body, isHtml = false) {
  let s = String(body || '');
  if (isHtml) {
    s = decodeEntities(s.replace(/<[^>]+>/g, ' '));
  }
  return s.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX);
}
