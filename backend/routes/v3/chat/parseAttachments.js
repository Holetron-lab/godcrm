/**
 * parseAttachments — the one place a stored `messages.attachments` value is
 * turned into the array the chat clients render.
 *
 * Contract (src/features/ai-chat/types.ts ChatAttachment): every entry is an
 * object with a string `type` and a string `name`. Rows written by older
 * clients carry the legacy `{ url, mime_type, original_name }` shape and no
 * `type` at all — the SPA dereferences `att.type.startsWith(...)` while
 * rendering and the whole conversation crashes into the router error boundary.
 * Normalising here fixes those rows without touching the data.
 *
 * @param {unknown} raw  jsonb value, JSON string, or already-parsed array
 * @returns {Array<object>}
 */
export function parseAttachments(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const att of list) {
    if (!att || typeof att !== 'object' || Array.isArray(att)) continue;
    const type = str(att.type) || str(att.mime_type) || 'file';
    const name = str(att.name) || str(att.original_name) || 'file';
    out.push({ ...att, type, name });
  }
  return out;
}

function str(v) {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
