/**
 * ADR-158 — defensive list-snippet cleaner (frontend mirror of
 * backend `services/mail/preview.js`).
 *
 * New sends store a clean preview, but messages composed *before* the backend
 * fix (2026-07-15) still hold raw `<p>…</p>` / `&nbsp;` in their `preview`
 * column. Stripping at render fixes those existing rows with no data migration.
 * On an already-clean snippet this is a cheap no-op (no tags, no entities).
 */

/** Strip HTML tags + decode the common entities a mail body emits. */
export function cleanPreview(raw: string): string {
  if (!raw) return '';
  // Fast path: nothing that looks like markup or an entity → return as-is.
  if (!/[<&]/.test(raw)) return raw;
  const withoutTags = raw.replace(/<[^>]+>/g, ' ');
  const el = document.createElement('textarea');
  el.innerHTML = withoutTags; // decodes &nbsp; &amp; &#39; … via the browser
  return el.value.replace(/\s+/g, ' ').trim();
}
