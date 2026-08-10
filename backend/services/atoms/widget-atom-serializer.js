// ADR-0003 Phase 2 · T-127902
//
// Canonical markdown representation of a widget-embed atom. Used by
// document export/snapshot pipelines and by the round-trip contract
// (parse → resolve → serialize must reproduce identical bytes).
//
// Format (3-line fenced block):
//
//     ```widget:<id> preset=<name>
//     {canonical JSON settings}
//     ```
//
// Rules:
//  - Info string: `widget:<id> preset=<name>` (lowercase, single space).
//  - Body: JSON object with keys sorted lexicographically, no spaces,
//    one line. Empty settings → `{}`.
//  - Block ends with a newline-free closing fence so concatenation
//    into a larger document is deterministic.

const FENCE = '```';
const FENCE_INFO_RE = /^widget:(\d+)\s+preset=([A-Za-z0-9_.-]+)\s*$/;

function stableStringify(obj) {
  if (obj == null) return '{}';
  if (typeof obj !== 'object' || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const keys = Object.keys(obj).sort();
  const parts = keys.map(k => `${JSON.stringify(k)}:${stableValue(obj[k])}`);
  return `{${parts.join(',')}}`;
}

function stableValue(v) {
  if (v == null) return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableValue).join(',')}]`;
  if (typeof v === 'object') return stableStringify(v);
  return JSON.stringify(v);
}

/**
 * Serialize a resolved widget atom to canonical markdown.
 * @param {object} input
 * @param {number} input.widget_ref  - widget id (required)
 * @param {string} input.preset      - preset name (required)
 * @param {object} [input.settings]  - settings map to embed (canonical keys)
 * @returns {string}
 */
export function serializeWidgetAtom({ widget_ref, preset, settings = {} } = {}) {
  const id = Number(widget_ref);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('serializeWidgetAtom: widget_ref must be a positive number');
  }
  if (!preset || !FENCE_INFO_RE.test(`widget:${id} preset=${preset}`)) {
    throw new Error(`serializeWidgetAtom: invalid preset name "${preset}"`);
  }
  const body = stableStringify(settings || {});
  return `${FENCE}widget:${id} preset=${preset}\n${body}\n${FENCE}`;
}

/**
 * Parse a canonical widget-atom fenced block back into an atom-shaped
 * object. Pair of `serializeWidgetAtom` — the round trip is:
 *   serialize(parse(md)) === md  (bytes identical)
 *
 * For the full ticket contract the caller then runs `resolveWidgetAtom`
 * on the parsed atom to rebuild {widget, preset, resolved_settings}.
 *
 * @param {string} md
 * @returns {{ widget_ref:number, preset:string, settings_override:object }}
 * @throws {Error} on malformed input
 */
export function parseWidgetAtom(md) {
  if (typeof md !== 'string') {
    throw new Error('parseWidgetAtom: input must be a string');
  }
  const lines = md.split('\n');
  if (lines.length < 3) {
    throw new Error('parseWidgetAtom: expected 3-line fenced block');
  }
  const open = lines[0];
  const close = lines[lines.length - 1];
  if (!open.startsWith(FENCE) || close !== FENCE) {
    throw new Error('parseWidgetAtom: missing opening/closing fence');
  }
  const info = open.slice(FENCE.length);
  const m = FENCE_INFO_RE.exec(info);
  if (!m) {
    throw new Error(`parseWidgetAtom: invalid info string "${info}"`);
  }
  const widget_ref = Number(m[1]);
  const preset = m[2];

  const bodyStr = lines.slice(1, -1).join('\n');
  let settings_override;
  try {
    settings_override = bodyStr.trim() === '' ? {} : JSON.parse(bodyStr);
  } catch (err) {
    throw new Error(`parseWidgetAtom: body is not valid JSON: ${err.message}`);
  }
  if (settings_override == null || typeof settings_override !== 'object' || Array.isArray(settings_override)) {
    throw new Error('parseWidgetAtom: body must be a JSON object');
  }
  return { widget_ref, preset, settings_override };
}

// Exported for tests — lets the round-trip test verify key-order
// determinism without depending on a fence.
export const _stableStringify = stableStringify;
