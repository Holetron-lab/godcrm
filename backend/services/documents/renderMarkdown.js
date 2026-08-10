// ADR-0003 Phase 4.4 · P-3 (ticket 126810)
// ADR-0005 §C-10 · Phase 8b — widget-atom self-contained snapshots
//
// Standalone atom → markdown renderer, extracted from
// backend/services/agent-tools/document-tools.js::get_document_content.
//
// Callable without HTTP — imported directly by the FS snapshot layer
// (C-11/C-12/C-14) and by get_document_content itself.
//
// Widget atoms (level === 'widget', carrying a `widget_ref`) emit a
// canonical fenced-code block via `serializeWidgetAtom` so the snapshot
// is self-contained — an automation can rebuild the embed from the
// markdown alone. When the referenced widget no longer exists, a minimal
// placeholder block (` ```widget:<id> missing\n``` `) is emitted so we
// don't lose the reference entirely.

import { dbGet, dbAll, isPostgres } from '../../database/connection.js';
import { parseRowData } from '../agent-tools/data-tools.js';
import { serializeWidgetAtom } from '../atoms/widget-atom-serializer.js';
import { buildOrderClause } from '../orderClause.js';

const FENCE = '```';

/**
 * Render a single widget atom to its canonical markdown block.
 *
 * @param {object} atom         — { widget_ref, settings_override?, preset?, ... }
 * @param {object|null} widget  — widget row (preset_name, config) or null/missing
 * @returns {string}
 */
function widgetAtomToMarkdown(atom, widget) {
  const widgetRef = Number(atom?.widget_ref);
  if (!Number.isFinite(widgetRef) || widgetRef <= 0) {
    // No usable ref at all — treat as missing with id=0 placeholder.
    return `${FENCE}widget:0 missing\n${FENCE}`;
  }

  // Missing widget → minimal placeholder per ADR-0005 §C-10 / Phase 8b.
  // (Distinct from the canonical block: no preset and no body — the
  // round-trip parser will reject this on purpose; the marker is for
  // human/archive consumption only.)
  if (!widget) {
    return `${FENCE}widget:${widgetRef} missing\n${FENCE}`;
  }

  // Pick preset: atom override → widget.preset_name → 'default'.
  const widgetCfg = (() => {
    const raw = widget.config;
    if (raw == null) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return {}; }
  })();
  const preset = atom?.preset
    || widget.preset_name
    || widgetCfg.preset_name
    || 'default';

  const settings = (atom?.settings_override && typeof atom.settings_override === 'object'
    && !Array.isArray(atom.settings_override))
    ? atom.settings_override
    : {};

  try {
    return serializeWidgetAtom({ widget_ref: widgetRef, preset, settings });
  } catch (err) {
    // Should not happen with the validations above, but be safe — fall
    // through to the missing marker so the snapshot still records the id.
    return `${FENCE}widget:${widgetRef} missing\n${FENCE}`;
  }
}

/**
 * Convert an ordered array of document atoms to a markdown string.
 * Atom shape: { level: 'h1'|'h2'|'h3'|'divider'|'text'|'widget', content: string,
 *               widget_ref?: number, settings_override?: object, preset?: string }
 *
 * Pure: no I/O. Safe to call from anywhere (automation handlers, tests,
 * snapshot writer). Widget atoms require an optional `widgetMap` (id →
 * widget row) for full self-contained serialization; without it, atoms
 * with widget_ref still serialize using their own preset/settings_override
 * (treated as definitive — the source-of-truth is the atom row), and
 * atoms with no widget_ref emit a `missing` marker.
 *
 * @param {Array} atoms
 * @param {object|null} [widgetMap]  — { [widget_id:number]: widget|null }
 *   When provided, widget atoms whose widget_ref is absent from the map
 *   (or maps to null) emit the `missing` placeholder. Pass `null` to skip
 *   missing-detection (atom is treated as authoritative).
 */
export function atomsToMarkdown(atoms, widgetMap = null) {
  if (!Array.isArray(atoms)) return '';
  return atoms.map((a) => {
    if (!a) return '';
    if (a.level === 'h1') return `# ${a.content || ''}`;
    if (a.level === 'h2') return `## ${a.content || ''}`;
    if (a.level === 'h3') return `### ${a.content || ''}`;
    if (a.level === 'divider') return '---';
    if (a.level === 'widget') {
      const widgetRef = Number(a.widget_ref);
      let widget = null;
      if (widgetMap && Number.isFinite(widgetRef) && widgetRef > 0) {
        // `in` check — explicit `null` means we KNOW the widget is gone.
        widget = Object.prototype.hasOwnProperty.call(widgetMap, widgetRef)
          ? widgetMap[widgetRef]
          : undefined;
      } else if (!widgetMap) {
        // No map provided — trust the atom (synthesize a widget-like
        // shape from atom.preset, so serializeWidgetAtom emits a full
        // canonical block).
        widget = a.preset ? { preset_name: a.preset, config: {} } : { preset_name: 'default', config: {} };
      }
      if (widget === undefined) {
        // widgetMap was provided but key absent → treat as missing.
        widget = null;
      }
      return widgetAtomToMarkdown(a, widget);
    }
    return a.content || '';
  }).join('\n\n');
}

/**
 * Load atoms from a document's per-doc table and normalize them to the
 * shape atomsToMarkdown expects.
 *
 * Returns an array of { id, level, content, type, order, is_collapsed,
 * widget_ref, settings_override, preset } — extra fields are present
 * only on widget atoms (level === 'widget') but they're harmless on
 * other atom types and the renderer ignores them.
 */
export async function loadDocumentAtoms(tableId) {
  if (!tableId) return [];
  const orderBy = buildOrderClause('order', {
    dialect: isPostgres() ? 'pg' : 'sqlite', mode: 'coalesce', tieBreak: 'id',
  });
  const rows = await dbAll(
    `SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY ${orderBy}`,
    [tableId]
  );
  return rows.map((r) => {
    const data = parseRowData(r.data);
    return {
      id: r.id,
      level: data.level,
      content: data.content_en || data.content || '',
      type: data.type,
      order: data.order,
      is_collapsed: data.is_collapsed,
      // Widget-embed fields (atoms_v2). Carried verbatim so snapshot/
      // serializer can produce a self-contained canonical block. Other
      // levels simply ignore these.
      widget_ref: data.widget_ref ?? null,
      settings_override: (data.settings_override && typeof data.settings_override === 'object'
        && !Array.isArray(data.settings_override))
        ? data.settings_override
        : {},
      preset: data.preset || data.preset_name || null,
    };
  });
}

/**
 * Resolve the set of widgets referenced by the given atoms array.
 * Returns a `{ [widgetId]: widget|null }` map suitable for passing to
 * `atomsToMarkdown`. Widgets that don't exist resolve to `null` so the
 * caller can emit a `missing` placeholder.
 *
 * @param {Array} atoms
 * @param {object} [opts]
 * @param {(id:number) => Promise<object|null>} [opts.loadWidget]
 *   Injectable widget loader (DI for tests). Defaults to a direct DB
 *   lookup against `widgets`.
 */
export async function loadWidgetsForAtoms(atoms, { loadWidget } = {}) {
  const map = {};
  if (!Array.isArray(atoms) || atoms.length === 0) return map;

  const ids = new Set();
  for (const a of atoms) {
    if (!a || a.level !== 'widget') continue;
    const id = Number(a.widget_ref);
    if (Number.isFinite(id) && id > 0) ids.add(id);
  }
  if (ids.size === 0) return map;

  const loader = loadWidget || (async (id) => dbGet(
    'SELECT id, preset_name, widget_type, config, title FROM widgets WHERE id = ?',
    [id]
  ));

  await Promise.all([...ids].map(async (id) => {
    try {
      map[id] = (await loader(id)) || null;
    } catch (_) {
      map[id] = null;
    }
  }));
  return map;
}

/**
 * Full pipeline: widget_id + document_id → { markdown, atoms, table_id,
 * document }. Mirrors what get_document_content returns, minus atom_count.
 *
 * Returns null if the document or its binding is not found. Returns an
 * object with `markdown: ''` and `atoms: []` for legacy registry rows that
 * have no companion content table — matches get_document_content behaviour.
 */
export async function renderDocumentMarkdown(widgetId, documentId) {
  if (!widgetId || !documentId) return null;

  const w = await dbGet('SELECT id, config FROM widgets WHERE id = ?', [widgetId]);
  if (!w) return null;
  const cfg = typeof w.config === 'string' ? JSON.parse(w.config || '{}') : (w.config || {});
  const registryTableId = Number(cfg.registry_table_id || cfg.documents_table_id || 0);
  if (!registryTableId) return null;

  const doc = await dbGet(
    'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
    [documentId, registryTableId]
  );
  if (!doc) return null;

  const docData = parseRowData(doc.data);
  const tableId = docData.table_id;

  if (!tableId) {
    return {
      document: { id: doc.id, ...docData },
      atoms: [],
      markdown: '',
      table_id: null,
      legacy: true,
    };
  }

  const atoms = await loadDocumentAtoms(tableId);
  // Resolve embedded widgets so the snapshot block is self-contained AND
  // missing-widget detection works (ADR-0005 §C-10 / Phase 8b).
  const widgetMap = await loadWidgetsForAtoms(atoms);
  return {
    document: { id: doc.id, ...docData },
    atoms,
    markdown: atomsToMarkdown(atoms, widgetMap),
    table_id: tableId,
  };
}
