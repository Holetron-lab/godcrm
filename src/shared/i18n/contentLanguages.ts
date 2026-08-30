/**
 * ADR-185 — content-language catalog for chat message translation.
 *
 * Mirrors the backend `LANGUAGE_NAMES` map (backend/routes/v3/documents/_helpers.js:155-159)
 * — the canonical 15 translation targets. This is a *content* language list
 * (translation targets), deliberately distinct from `availableLanguages` in
 * LanguageContext, which is the UI-locale list (ru/en only). Kept as a small
 * static display constant on the frontend because the backend helper is not part
 * of the client bundle; the two lists must stay in sync if a language is added.
 */

export const CONTENT_LANGUAGE_NAMES = {
  en: 'English', ru: 'Русский', de: 'Deutsch', fr: 'Français', es: 'Español',
  it: 'Italiano', pt: 'Português', zh: '中文', ja: '日本語', ko: '한국어',
  ar: 'العربية', he: 'עברית', uk: 'Українська', pl: 'Polski', nl: 'Nederlands',
} as const;

export type ContentLanguageCode = keyof typeof CONTENT_LANGUAGE_NAMES;

export const CONTENT_LANGUAGES: ReadonlyArray<{ code: ContentLanguageCode; label: string }> =
  (Object.entries(CONTENT_LANGUAGE_NAMES) as [ContentLanguageCode, string][])
    .map(([code, label]) => ({ code, label }));

/** Human-readable label for a content-language code (falls back to upper-cased code). */
export const contentLanguageLabel = (code: string): string =>
  (CONTENT_LANGUAGE_NAMES as Record<string, string>)[code] ?? code.toUpperCase();
