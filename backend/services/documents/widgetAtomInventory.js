// ADR-0005 §C-13 — per-document widget-atom inventory.
//
// Given the atoms loaded from a document's per-doc content table (via
// `loadDocumentAtoms`), build a flat inventory describing every embedded
// widget-atom: target widget id+title, optional target doc id+title,
// locked-fields paths derived from settings_override, recursion depth
// and the atom's id+created_at.
//
// Lossless: when the target widget or target doc is missing (deleted),
// the entry still appears with `missing: true` and whatever fields are
// resolvable. Callers (e.g. document GET) MUST NOT 404 on dangling refs.

import { dbGet, dbAll, isPostgres } from '../../database/connection.js';
import { parseRowData } from '../agent-tools/data-tools.js';

/**
 * Compute dot-paths of every leaf field touched by a settings_override
 * map. Mirrors the frontend `getLockedPaths` in
 * `src/features/widgets/utils/mergeWidgetConfig.ts`. Kept inline here so
 * the API response can compute locked_fields without pulling client code.
 */
export function getLockedPaths(override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return [];
  const out = [];
  const walk = (node, prefix) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      if (prefix) out.push(prefix);
      return;
    }
    const entries = Object.entries(node);
    if (entries.length === 0 && prefix) {
      out.push(prefix);
      return;
    }
    for (const [k, v] of entries) {
      const next = prefix ? `${prefix}.${k}` : k;
      walk(v, next);
    }
  };
  walk(override, '');
  return out;
}

function parseConfig(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

/**
 * Pick target_doc_id from a widget-atom's settings_override. We accept
 * a few legacy keys so callers don't have to settle on one yet — the
 * documents-widget settings rail uses `document_id`; older code paths
 * sometimes used `doc_id` or `target_document_id`. First non-zero wins.
 */
function pickTargetDocId(settingsOverride) {
  if (!settingsOverride || typeof settingsOverride !== 'object') return null;
  const candidates = [
    settingsOverride.document_id,
    settingsOverride.doc_id,
    settingsOverride.target_document_id,
    settingsOverride.target_doc_id,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/**
 * Look up a documents-registry row's title given (registry_table_id,
 * doc_id). Tolerant of the configured title column name (`name` vs
 * `title`) — falls back to whichever is non-empty. Returns null if the
 * row is missing or the registry can't be located.
 */
async function loadTargetDocTitle({ widget, targetDocId, loadDoc }) {
  if (!widget || !targetDocId) return null;
  const cfg = parseConfig(widget.config);
  const registryTableId = Number(
    cfg.registry_table_id ?? cfg.documents_table_id ?? cfg.table_id ?? 0
  );
  if (!registryTableId) return null;
  const row = await loadDoc({ registryTableId, docId: targetDocId });
  if (!row) return null;
  const data = parseRowData(row.data);
  return data.name || data.title || null;
}

/**
 * Build the per-document widget-atom inventory.
 *
 * @param {Array} atoms — atoms from `loadDocumentAtoms`. Non-widget
 *   levels are ignored.
 * @param {object} [opts]
 * @param {(id:number) => Promise<object|null>} [opts.loadWidget]
 *   Injectable widget loader (DI for tests).
 * @param {(args:{registryTableId:number, docId:number}) => Promise<object|null>} [opts.loadDoc]
 *   Injectable target-doc loader.
 * @param {(atomId:number|string) => Promise<object|null>} [opts.loadAtomMeta]
 *   Injectable per-atom row loader (returns { created_at }).
 * @param {number} [opts.level=1] — recursion depth marker; per ADR-0005
 *   §C-12 only direct embeds (depth 1) are surfaced here.
 *
 * @returns {Promise<Array<{
 *   atom_id:number|string,
 *   target_widget_id:number,
 *   target_widget_title?:string,
 *   target_doc_id?:number,
 *   target_doc_title?:string,
 *   level:number,
 *   locked_fields:string[],
 *   created_at?:string,
 *   missing?:true,
 * }>>}
 */
export async function collectWidgetAtomInventory(atoms, opts = {}) {
  const out = [];
  if (!Array.isArray(atoms) || atoms.length === 0) return out;

  const loadWidget = opts.loadWidget || (async (id) => dbGet(
    'SELECT id, title, preset_name, widget_type, config FROM widgets WHERE id = ?',
    [id]
  ));
  const loadDoc = opts.loadDoc || (async ({ registryTableId, docId }) => dbGet(
    'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
    [docId, registryTableId]
  ));
  const loadAtomMeta = opts.loadAtomMeta || (async (atomId) => {
    if (atomId == null) return null;
    return dbGet('SELECT created_at FROM table_rows WHERE id = ?', [atomId]);
  });
  const level = Number.isFinite(opts.level) ? Number(opts.level) : 1;

  // Filter to widget-atoms only. Match what renderMarkdown checks:
  // `level === 'widget'` (the atom-level marker, distinct from heading levels).
  const widgetAtoms = atoms.filter(a => a && a.level === 'widget');
  if (widgetAtoms.length === 0) return out;

  // De-duped widget id set so we batch loadWidget calls.
  const widgetIds = new Set();
  for (const a of widgetAtoms) {
    const id = Number(a.widget_ref);
    if (Number.isFinite(id) && id > 0) widgetIds.add(id);
  }
  const widgetMap = {};
  await Promise.all([...widgetIds].map(async (id) => {
    try { widgetMap[id] = (await loadWidget(id)) || null; }
    catch (_) { widgetMap[id] = null; }
  }));

  for (const atom of widgetAtoms) {
    const widgetRef = Number(atom.widget_ref);
    const settingsOverride = (atom.settings_override && typeof atom.settings_override === 'object'
      && !Array.isArray(atom.settings_override))
      ? atom.settings_override
      : {};
    const lockedFields = getLockedPaths(settingsOverride);

    // No usable widget_ref → still emit a stub so the inventory is lossless.
    if (!Number.isFinite(widgetRef) || widgetRef <= 0) {
      let createdAt = null;
      try {
        const meta = await loadAtomMeta(atom.id);
        createdAt = meta?.created_at || null;
      } catch (_) { createdAt = null; }
      out.push({
        atom_id: atom.id,
        target_widget_id: widgetRef > 0 ? widgetRef : 0,
        level,
        locked_fields: lockedFields,
        created_at: createdAt,
        missing: true,
      });
      continue;
    }

    const widget = widgetMap[widgetRef] || null;
    const targetDocId = pickTargetDocId(settingsOverride);

    let createdAt = null;
    try {
      const meta = await loadAtomMeta(atom.id);
      createdAt = meta?.created_at || null;
    } catch (_) { createdAt = null; }

    if (!widget) {
      // Widget gone → stub with id only + missing flag.
      const stub = {
        atom_id: atom.id,
        target_widget_id: widgetRef,
        level,
        locked_fields: lockedFields,
        created_at: createdAt,
        missing: true,
      };
      if (targetDocId) stub.target_doc_id = targetDocId;
      out.push(stub);
      continue;
    }

    const entry = {
      atom_id: atom.id,
      target_widget_id: widgetRef,
      target_widget_title: widget.title || null,
      level,
      locked_fields: lockedFields,
      created_at: createdAt,
    };
    if (targetDocId) {
      entry.target_doc_id = targetDocId;
      try {
        const title = await loadTargetDocTitle({ widget, targetDocId, loadDoc });
        if (title) {
          entry.target_doc_title = title;
        } else {
          // Target doc gone — keep the atom in the inventory with missing=true,
          // but only on the doc dimension (widget exists). Per the lossless
          // contract we never drop the entry.
          entry.missing = true;
        }
      } catch (_) {
        entry.missing = true;
      }
    }
    out.push(entry);
  }

  return out;
}

// Test seam — exposed for unit tests and future cross-doc graph helpers.
export const _internals = { pickTargetDocId, parseConfig };
