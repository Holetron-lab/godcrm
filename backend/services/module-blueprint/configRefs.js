/**
 * Blueprint config references — ADR-200 W3.
 *
 * A blueprint must not carry `table_id`s: the whole point of a module being DATA is that the
 * same blueprint installs into any space, where the ids differ. So a widget's config names a
 * table by its BLUEPRINT KEY and the installer substitutes the real id at apply time:
 *
 *     config: { table_id: { $table: "schemes" } }   →   config: { table_id: 103027 }
 *
 * Why an explicit `{ $table }` sentinel rather than "the key `table` means a table":
 * a preset is free to have a config key called `table` that means something else, and a
 * convention cannot be verified. The sentinel makes the substitution total (any depth, inside
 * arrays, in any preset's config shape) and makes an unknown reference a REFUSAL at dry-run
 * instead of a widget quietly bound to nothing.
 *
 * ADR-200 §W3 correction: this is written here FIRST. The claim that ADR-192 §W4 already had
 * a widget-config remapper was wrong (`WidgetService:602-605` is `getWidgetData`, a read, and
 * `copy-tools.js` does not copy widgets at all). §W4 reuses `remapConfigTableRefs` with its own
 * resolver — the two domains differ only in what `resolve` maps:
 *
 *     install:  resolve = (key)   => mapping[key].table_id      // blueprint key → new id
 *     copy:     resolve = (oldId) => tableMap[oldId]            // old id       → new id
 */

export const TABLE_REF_KEY = '$table';

/** A reference is the single-key object `{ $table: "<name>" }` — nothing else. */
export function isTableRef(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value[TABLE_REF_KEY] === 'string'
    && Object.keys(value).length === 1;
}

/**
 * Every table reference a config mentions, at any depth. Used by the blueprint validator to
 * refuse a widget that points at a table the blueprint never declares — before anything is
 * planned, let alone written.
 * @returns {Set<string>}
 */
export function collectTableRefs(value, found = new Set()) {
  if (isTableRef(value)) {
    found.add(value[TABLE_REF_KEY]);
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTableRefs(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectTableRefs(item, found);
  }
  return found;
}

/**
 * Return a copy of `config` with every `{ $table: k }` replaced by `resolve(k)`. The input is
 * never mutated — the blueprint is stored verbatim in `module_installations` and must survive
 * an install unchanged, so that `uninstall` can still read what was actually declared.
 *
 * @param {*} value - config (or any nested fragment)
 * @param {(ref: string) => *} resolve - blueprint key → concrete value (usually a table id)
 * @throws {Error} when `resolve` yields null/undefined — callers validate refs first, so this
 *   firing means the mapping and the blueprint disagree, which must never be papered over.
 */
export function remapConfigTableRefs(value, resolve) {
  if (isTableRef(value)) {
    const ref = value[TABLE_REF_KEY];
    const resolved = resolve(ref);
    if (resolved === undefined || resolved === null) {
      throw new Error(`unresolved table reference "${ref}" — no id for this blueprint key`);
    }
    return resolved;
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapConfigTableRefs(item, resolve));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = remapConfigTableRefs(item, resolve);
    }
    return out;
  }
  return value;
}
