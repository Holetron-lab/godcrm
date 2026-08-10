// ADR-0060 §Fat-P5 / AC11 + AC14 — Public widget scrubber.
//
// Two responsibilities, kept in this single module so the test fixtures cover
// both as a unit:
//   1. Preset whitelist for `/api/v3/public/s/:slug/widgets/...` — anything not
//      in PUBLIC_PRESET_WHITELIST is unreachable on the public surface (route
//      returns 404). New widget types are default-deny: an explicit allowlist
//      addition is required before they show up publicly.
//   2. scrubWidgetConfig(widget) — pure sync projection that drops every
//      sensitive key (deep) and exposes only the public-safe fields the
//      preset renderers need.
//
// FK-gating (refuse to expose a widget whose primary table_id is not public)
// is handled by the route — it is async and requires DB lookups, so it lives
// next to the other publicSpaceAccess checks in `routes/v3/public.js`. The
// scrubber stays pure & test-friendly.

/**
 * Presets allowed on the public read-only surface.
 *
 * These are the actual `widgets.preset_name` values used by the codebase.
 * Adding a new value here is a security review item — every preset's data
 * pull and render path must be audited for PII / FK leak before inclusion.
 */
export const PUBLIC_PRESET_WHITELIST = Object.freeze(new Set([
  'kanban_board',
  'table_view',
  'task_list',
  // ADR-0060 P6/B — documents preset (read-only mirror via dedicated
  // /widgets/:id/documents[/...] endpoints in routes/v3/public.js).
  'documents',
]));

/**
 * Keys to drop anywhere they appear inside widget.config (deep walk).
 *
 * `created_by` / `email_to` / `webhook_secret` are explicit in AC14; the
 * remainder are the same blacklist applied across the public surface —
 * surfacing them would defeat the purpose of having a public read API
 * separate from the auth-gated one.
 */
const BLACKLIST_KEYS = Object.freeze(new Set([
  'created_by',
  'updated_by',
  'owner_id',
  'email_to',
  'email_from',
  'webhook_secret',
  'webhook_url',
  'webhook_token',
  'api_key',
  'apiKey',
  'api_token',
  'secret',
  'password',
  'auth',
  'token',
  'access_token',
  'refresh_token',
  'bearer',
  'private_key',
  'privateKey',
]));

/**
 * Predicate: is this preset reachable on the public surface?
 *
 * Default-deny: unknown / null / typo'd presets all return false.
 */
export function isPresetAllowed(presetName) {
  return typeof presetName === 'string' && PUBLIC_PRESET_WHITELIST.has(presetName);
}

function safeParseConfig(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {};
  }
}

function deepScrub(node) {
  if (Array.isArray(node)) {
    return node.map(deepScrub);
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (BLACKLIST_KEYS.has(k)) continue;
      out[k] = deepScrub(v);
    }
    return out;
  }
  return node;
}

/**
 * Documents preset: find the registry table id inside a documents widget
 * config. The DocumentsWidget config carries the registry under one of two
 * historical keys (`registry_table_id` or `documents_table_id`); both are
 * used in production today. Returns the first finite positive integer.
 */
export function extractDocumentsRegistryTableId(cfgRaw) {
  const cfg = safeParseConfig(cfgRaw);
  const candidates = [
    cfg.registry_table_id,
    cfg.documents_table_id,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Documents preset: registry-row allow-list. Only these keys ever reach the
 * public reader. Authoring-only metadata (created_by, agent_*, plan_verification,
 * status_id raw FK, etc.) is dropped here.
 *
 * NOTE: `table_id` is the per-document atoms table reference — the F-track
 * adapter needs it to fetch atoms via /atoms. It is NOT sensitive (just an
 * internal id) and the route layer gates its reachability anyway.
 */
const REGISTRY_ROW_PUBLIC_KEYS = Object.freeze([
  'name',
  'description',
  'slug',
  'icon',
  'category',
  'status',
  'order_index',
  'cover_url',
  'pinned',
  'parent_id',
  'tags',
  'lang',
  'table_id',
]);

/**
 * Project a registry row's `data` blob through the allow-list.
 * Input  : raw parsed `data` object from table_rows.
 * Output : new object containing only public-safe keys (other keys silently
 *          dropped). Missing keys are NOT defaulted — caller decides.
 */
export function scrubRegistryRowData(dataRaw) {
  if (!dataRaw || typeof dataRaw !== 'object' || Array.isArray(dataRaw)) return {};
  const out = {};
  for (const key of REGISTRY_ROW_PUBLIC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(dataRaw, key)) {
      out[key] = dataRaw[key];
    }
  }
  return out;
}

/**
 * Documents preset: atom-row deny-list. Atoms hold rendered content
 * (type/level/order/content_en/content_ru/atom_ref/widget_ref/etc.) — almost
 * everything is safe to read publicly. We strip authoring metadata only.
 */
const ATOM_ROW_DENY_KEYS = Object.freeze(new Set([
  'created_by',
  'updated_by',
  'last_edited_at',
  'last_edited_by',
  'agent_id',
  'agent_run_id',
]));

/**
 * Project an atom row's `data` blob through the deny-list (drop authoring
 * metadata, keep everything else).
 */
export function scrubAtomRowData(dataRaw) {
  if (!dataRaw || typeof dataRaw !== 'object' || Array.isArray(dataRaw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(dataRaw)) {
    if (ATOM_ROW_DENY_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Find the table-id reference inside a widget config.
 *
 * Different presets store it under different keys (`table_id`,
 * `tasks_table_id`, `data_table_id`, sometimes nested `kanban.tableId`).
 * Return the first finite number we find, else null.
 */
export function extractWidgetTableRef(cfgRaw) {
  const cfg = safeParseConfig(cfgRaw);
  const candidates = [
    cfg.table_id,
    cfg.tasks_table_id,
    cfg.data_table_id,
    cfg.kanban?.tableId,
    cfg.tableId,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Project a widget row to its public-safe shape.
 *
 * Input  : a row from the `widgets` table (or any object with the same shape
 *          — `id`, `preset_name`, `title`, `config` (json string or object)).
 * Output : `{ id, type, name, table_id, view_config, filter, sort }`
 *          OR `null` when the preset is not whitelisted (callers must 404).
 *
 * The function does NOT verify that `table_id` points at a public table —
 * that gate lives in the route (async DB lookup). Here we only strip the
 * deterministic blacklist and the un-whitelisted presets.
 */
export function scrubWidgetConfig(widget) {
  if (!widget || typeof widget !== 'object') return null;

  const preset = widget.preset_name ?? widget.preset ?? widget.type ?? null;
  if (!isPresetAllowed(preset)) return null;

  const cfg = safeParseConfig(widget.config);
  const scrubbed = deepScrub(cfg);
  const tableRef = extractWidgetTableRef(cfg);

  return {
    id: widget.id ?? null,
    type: preset,
    name: widget.title ?? widget.name ?? '',
    table_id: tableRef,
    view_config: scrubbed,
    filter: scrubbed.filter ?? null,
    sort: scrubbed.sort ?? null,
  };
}
