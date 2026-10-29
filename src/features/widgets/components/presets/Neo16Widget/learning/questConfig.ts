/**
 * Neo16 W2-S6 — which quest a widget opens, read from the widget's `config`.
 *
 * The widget row created by the ModuleInstaller (blueprint `widgets[].config`) carries
 * only the `{ $table }` ids and the `__module` tag; the quest is NOT part of the
 * blueprint. An owner sets it per widget by editing the row's `config`
 * (`PATCH /api/v3/widgets/:id` or the `update_widget` MCP tool):
 *
 *   { "quest_key": "arrange_meeting", "content_version": 1 }
 *
 * Rules:
 *  - a field that is ABSENT (`undefined`/`null`) yields `undefined`, so the session hook
 *    falls back to `DEFAULT_QUEST` and an already-placed widget keeps working;
 *  - a field that is PRESENT is passed through as-is (strings are not trimmed, numbers
 *    are not clamped, numeric strings are coerced). No client-side validation: a bad
 *    value must reach the server and come back as its own error
 *    (`VALIDATION_ERROR` 400 / `QUEST_NOT_FOUND` 404), never be silently replaced by
 *    the default.
 */

export interface QuestConfig {
  questKey?: string;
  contentVersion?: number;
}

export const QUEST_KEY_FIELD = 'quest_key';
export const CONTENT_VERSION_FIELD = 'content_version';

const isAbsent = (v: unknown): v is undefined | null => v === undefined || v === null;

/** Pass-through coercion for `content_version`; non-numeric input becomes NaN on purpose. */
function toVersion(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return Number(v);
  return Number.NaN;
}

export function readQuestConfig(config: unknown): QuestConfig {
  if (!config || typeof config !== 'object') return {};
  const c = config as Record<string, unknown>;
  const out: QuestConfig = {};
  if (!isAbsent(c[QUEST_KEY_FIELD])) out.questKey = String(c[QUEST_KEY_FIELD]);
  if (!isAbsent(c[CONTENT_VERSION_FIELD])) out.contentVersion = toVersion(c[CONTENT_VERSION_FIELD]);
  return out;
}
