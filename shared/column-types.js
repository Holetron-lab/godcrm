/**
 * ADR-0041R Phase 2 — the column-type manifest.
 *
 * Single source of truth for `table_columns.type`, shared by both trees.
 * Nothing else may declare a column-type list. Before this file there were
 * three (`ColumnService.VALID_COLUMN_TYPES`, `validation/schemas.columnTypeEnum`,
 * `src/shared/types/index.ts:ColumnType`) and no two of them agreed.
 *
 * Consumers:
 *   - backend  `backend/services/ColumnService.js` re-exports these and owns
 *              `persistColumnType()` — the only value allowed to reach INSERT.
 *   - frontend `src/shared/types/index.ts` DERIVES `ColumnType` from
 *              `COLUMN_TYPES`. It does not re-declare it, and needs no parity
 *              test to stay honest, because there is nothing left to disagree
 *              with. (ADR-0041R Phase 2 proposed a hand-maintained union + CI
 *              parity test; a real derivation turned out to be available for
 *              one tsconfig line, so the test it would have needed is gone.)
 *   - DB       migration 088 generates the Phase 1 ratchet CHECK from
 *              `ALL_PERSISTABLE_COLUMN_TYPES` rather than inlining a list.
 *
 * ── Two constraints on edits to this file ───────────────────────────────────
 *
 * 1. ZERO IMPORTS. This module is pulled into the Vite bundle. One `import` of
 *    anything server-side and the frontend build either breaks or ships backend
 *    dependencies to the browser. It is plain data plus one pure function, and
 *    must stay that way.
 *
 * 2. THE `@type {const}` CASTS ARE LOAD-BEARING. Without them TypeScript infers
 *    `string[]`, `ColumnType` silently widens to `string`, and every one of the
 *    34 files importing it keeps compiling while losing all type safety. The
 *    failure is silent: the build passes, the types are worthless. Verified
 *    against the repo's own tsc 5.9.3 — `Object.freeze()` wrapping the cast
 *    preserves the literal tuple, so runtime immutability costs nothing here.
 *    A `shared/*.json` manifest (the repo's existing cross-tree pattern, cf.
 *    `widget-presets.json`) CANNOT do this: `resolveJsonModule` widens to
 *    `string[]` with no way to opt out. It was tried and rejected.
 *
 * Plain `.js`, not `.ts`: the backend is ESM JS (`"type": "module"`) and cannot
 * import `.ts` without a build step. Requires `allowJs: true` in tsconfig —
 * `src/` contains zero `.js` files, so that flag pulls in nothing but this file.
 */

/**
 * Canonical types. This set — and only this set — is what new columns should
 * be written as, and what the frontend `ColumnType` union must mirror.
 */
export const COLUMN_TYPES = Object.freeze(/** @type {const} */ ([
  // Basic
  'text', 'long_text', 'number', 'email', 'url', 'phone',
  'date', 'datetime', 'time', 'checkbox',
  // Selection
  'select', 'multi-select',
  // Relation & advanced
  'relation', 'user', 'file', 'image', 'audio',
  'password', 'formula', 'table', 'rollup', 'button',
  // ADR-0017 / ADR-028 — present in production and in the frontend union, but
  // absent from the old VALID_COLUMN_TYPES, so POST /tables/:id/columns
  // returned 400 for them until this ADR. 379 such columns exist.
  'json', 'color',
  // AI
  'vector',
  // ADR-0011
  'verification',
  // ADR-151 — typed sort position + provenance
  'order', 'actor',
  // ADR-204 Stage 2 — unified media (`content`: gallery | audio mode) and
  // unified contact (`contact`: external | linked). New canonical keys only:
  // image/audio and email/phone/user are deliberately NOT aliases of them —
  // switching a column needs a value adapter (backend/services/column-adapters/),
  // not a spelling rewrite. The DB CHECK admits them from migration 104.
  'content', 'contact',
  // ADR-0035 Slice 1 — a point on the map: `{lat, lng, …}` JSONB inside
  // `table_rows.data` (S1.1), parsed/formatted by shared/geo-point.js only.
  // The DB CHECK admits it from migration 105.
  'geo_point',
  // ADR-0035-A — postal address WITHOUT coordinates: `{formatted, name?, …}`
  // JSONB inside `table_rows.data`, optionally linked to a `geo_point` column
  // of the same table via `config.address.geo_column_id`. Normalized by
  // backend/services/geo/address.js. The DB CHECK admits it from migration 106.
  'address',
]));

/** ADR-204: `content` item kinds and column modes; `contact` linked sources. */
export const CONTENT_KINDS = Object.freeze(/** @type {const} */ (['image', 'video', 'audio']));
export const CONTENT_MODES = Object.freeze(/** @type {const} */ (['gallery', 'audio']));
export const CONTACT_SOURCES = Object.freeze(/** @type {const} */ (['system', 'table']));

/**
 * Alias → canonical. Aliases stay permanently admissible (ADR-0041 P0 intent:
 * defence-in-depth for external consumers — mobile, desktop, integrations) but
 * are never what we persist.
 *
 * Two entries are corrections made by ADR-0041R, not carried over from ADR-0041:
 *
 *   textarea → long_text  (was `text`). `textarea` is multi-line; collapsing
 *       1 751 columns across 1 485 tables into single-line `text` is a
 *       rendering downgrade. `markdown` follows for the same reason.
 *
 *   person → user  (direction reversed). `person` was the declared canon and
 *       has 0 rows on master A; `user` has 296 and is what ~12 writers emit
 *       (SystemTablesCreator, feature-tables, …). Reality wins over an enum
 *       nobody enforced.
 */
export const COLUMN_TYPE_ALIASES = Object.freeze(/** @type {const} */ ({
  boolean: 'checkbox',
  multi_select: 'multi-select',
  multiselect: 'multi-select',
  longtext: 'long_text',
  richText: 'long_text',
  rich_text: 'long_text',
  textarea: 'long_text',
  markdown: 'long_text',
  person: 'user',
}));

/**
 * ADR-0041R Tier D — the orphans. Types with live rows and live writers that
 * belong to no canon:
 *
 *   apiKey (239 rows) · array (20) · id (5) · link (3, written by
 *   `routes/v3/api-keys.js:124`)
 *
 * They are ADMITTED, not canon: `persistColumnType()` lets them through so
 * Phase 3 does not 500 the writers that emit them, but they are deliberately
 * kept out of COLUMN_TYPES so they do not leak into the frontend union or get
 * blessed by Phase 5's narrow CHECK.
 *
 * Disposition is Open Question 1 in ADR-0041R and needs owner sign-off —
 * notably `apiKey → password`, which would mask 239 columns currently rendered
 * in the clear. Until then the Phase 1 ratchet freezes them at their current
 * size. This array is expected to become empty (or fold into aliases) at
 * Phase 4; it should never grow.
 */
export const PROVISIONAL_COLUMN_TYPES = Object.freeze(/** @type {const} */ ([
  'apiKey', 'array', 'id', 'link',
]));

/**
 * Everything the DB is allowed to hold today: canon ∪ aliases ∪ Tier D.
 * Derived, never re-typed — this is what the zod enum, `persistColumnType()`
 * and the Phase 1/5 CHECK constraints are all generated from.
 */
export const ALL_PERSISTABLE_COLUMN_TYPES = Object.freeze([
  ...COLUMN_TYPES,
  ...Object.keys(COLUMN_TYPE_ALIASES),
  ...PROVISIONAL_COLUMN_TYPES,
]);

/**
 * ADR-0041: normalize a legacy spelling to its canonical variant.
 *
 * Lives here rather than in `ColumnService` so the frontend can call this same
 * implementation when Phase 6 retires its ~24 partial alias lists — those lists
 * are the bug, and replacing them with a second copy of the logic in TS would
 * only move it. `ColumnService` re-exports the name; its contract is unchanged.
 *
 * Unknown types pass through untouched (Tier D relies on this). Rejecting is
 * `persistColumnType()`'s job, not this function's.
 *
 * @param {string} type
 * @returns {string}
 */
export function canonicalizeColumnType(type) {
  // hasOwn rather than `ALIASES[type] ?? type` — `type` arrives here straight
  // from an LLM (manage_columns), so 'constructor'/'toString' must not resolve.
  return Object.hasOwn(COLUMN_TYPE_ALIASES, type)
    ? COLUMN_TYPE_ALIASES[/** @type {keyof typeof COLUMN_TYPE_ALIASES} */ (type)]
    : type;
}
