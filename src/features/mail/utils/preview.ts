/**
 * ADR-158 — defensive list-snippet cleaner (frontend mirror of
 * backend `services/mail/preview.js`).
 *
 * New sends store a clean preview, but messages composed *before* the backend
 * fix (2026-07-15) still hold raw `<p>…</p>` / `&nbsp;` in their `preview`
 * column. Stripping at render fixes those existing rows with no data migration.
 * On an already-clean snippet this is a cheap no-op (no tags, no entities).
 */

/**
 * Characters kept for the list row's body snippet. The row clamps to three
 * lines (`line-clamp-3`), so this only has to comfortably exceed what three
 * lines hold at the widest list; the stored `preview` column is 140 chars and
 * fills one line at best.
 */
export const SNIPPET_MAX = 600;

/**
 * Snippet from a full body (list rows carry `body_html || body_text`): drops
 * the non-content blocks a marketing mail opens with (`<style>`, `<script>`,
 * `<head>`, comments) so CSS never leaks into the row, then strips tags,
 * decodes entities, collapses whitespace and caps the length.
 */
export function bodySnippet(body: string): string {
  if (!body) return '';
  const withoutBlocks = body
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  return cleanPreview(withoutBlocks).replace(/\s+/g, ' ').trim().slice(0, SNIPPET_MAX);
}

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
