/**
 * ADR-185 — chat message language detection (backend, authoritative).
 *
 * Ported verbatim from the document editor's client-side heuristic
 * (`src/features/widgets/components/presets/documents/DocumentsModals.tsx:36-47`):
 * a Cyrillic-word-ratio classifier. If >10% of the 3+ char words are Cyrillic,
 * the text is treated as Russian, otherwise English.
 *
 * ADR-185 open question #1 resolution: BE twin, not a cross-build isomorphic
 * module. Detection runs server-side at message insert (authoritative, cannot
 * be spoofed, also covers agent messages). The frontend keeps its own inline
 * copy for optimistic UI — sharing a single module across the TS/JS + Vite
 * build boundary is not worth it for a ~10-line regex (Ponytail).
 *
 * MVP scope is ru/en (that is all the borrowed regex distinguishes). Upgrade
 * path when >2 source languages become real: swap this util for OSS `tinyld`
 * (pure-JS, MIT, 0 deps). No schema change needed for that upgrade — the
 * detected code just lands in `messages.detected_lang`.
 *
 * @param {string} text
 * @returns {'en'|'ru'}
 */
export function detectLanguage(text) {
  // Extract words (at least 3 chars), Latin or Cyrillic.
  const words = (text || '').match(/[a-zA-Zа-яА-ЯёЁ]{3,}/g) || [];
  if (words.length === 0) return 'en';

  // Count Cyrillic-bearing words.
  const cyrillicWords = words.filter((w) => /[а-яА-ЯёЁ]/.test(w)).length;
  const ratio = cyrillicWords / words.length;

  // 10% threshold — even a little Cyrillic ⇒ likely Russian.
  return ratio > 0.1 ? 'ru' : 'en';
}

/** Languages the current detector can distinguish (ADR-185 MVP). */
export const SUPPORTED_DETECT_LANGS = ['en', 'ru'];
