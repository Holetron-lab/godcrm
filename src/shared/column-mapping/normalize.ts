/**
 * Loose column-name key: case-insensitive, ignores whitespace, underscores and
 * hyphens, so `Created At`, `created_at` and `created-at` all collide.
 * ADR-207 §2.5 rule 1 ("без учёта регистра и пробелов/подчёркиваний").
 */
export function normalizeColumnName(name: string | null | undefined): string {
  if (!name) return '';
  return name.toLowerCase().replace(/[\s_-]+/g, '');
}
