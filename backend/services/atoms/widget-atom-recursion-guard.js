// ADR-0005 §C-12 · widget-atom recursion guard
//
// When a `documents` preset widget is embedded as an atom (atoms_v2 row,
// data.widget_ref → widget.id, data.document_id → row id of the document
// hosting the atom), there is a risk that the embedded widget's
// `config.registry_table_id` (a.k.a. legacy `documents_table_id` / `table_id`)
// points back at the same registry the host document belongs to. The
// embedded list then renders the same document → infinite recursion.
//
// This guard validates the *one-level* case on the write path. Deeper
// cycles (A → B → A) are not currently covered; see ADR-0005 §C-12 note.
// One-level coverage matches the documented minimum acceptable bar.
//
// Returns { ok: true, data } when:
//  - tableId != atomsV2TableId
//  - atom is not a widget-atom (no widget_ref or no document_id)
//  - widget is not a documents preset
//  - widget's registry_table_id does NOT match the host document's registry
//
// Returns { ok: false, status: 400, code: 'RECURSIVE_DOCUMENT_EMBEDDING',
//          error, widget_id, document_id } when recursion is detected.

const DOCUMENTS_PRESET_NAMES = new Set(['documents', 'documents_legacy']);

function readWidgetRegistryId(config) {
  if (!config || typeof config !== 'object') return null;
  // Canonical: `registry_table_id`. Legacy fallbacks kept in lockstep with
  // backend/routes/v3/documents/{content,crud,research}.js.
  const raw = config.registry_table_id ?? config.documents_table_id ?? config.table_id;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseConfig(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

/**
 * Validate that creating/updating a widget-atom does not introduce
 * one-level document recursion.
 *
 * @param {object} args
 * @param {number|string} args.tableId      — the table the row is being written to
 * @param {object}        args.data         — row data (must contain widget_ref + document_id to be checked)
 * @param {number}        args.atomsV2TableId
 * @param {(widgetId:number) => Promise<object|null>} args.loadWidget
 * @param {(documentId:number) => Promise<number|null>} args.loadDocumentRegistryId
 *        — returns the universal_tables.id (registry table) that contains a
 *        documents-registry row whose row id == documentId. null if unknown.
 *
 * @returns {Promise<{ ok:true, data:object } | { ok:false, status:number, code:string, error:string, widget_id:number, document_id:number }>}
 */
export async function validateWidgetAtomRecursion({
  tableId,
  data,
  atomsV2TableId,
  loadWidget,
  loadDocumentRegistryId,
}) {
  if (Number(tableId) !== Number(atomsV2TableId)) return { ok: true, data };
  if (!data || typeof data !== 'object') return { ok: true, data };

  const widgetRef = Number(data.widget_ref);
  if (!Number.isInteger(widgetRef) || widgetRef <= 0) return { ok: true, data };

  // host document id (atoms_v2 stores it as `document_id`; tolerate `doc_id`
  // for older callers that match WidgetService.ATOMS_WITH_WIDGET_REF_CTE).
  const documentId = Number(data.document_id ?? data.doc_id);
  if (!Number.isInteger(documentId) || documentId <= 0) return { ok: true, data };

  const widget = await loadWidget(widgetRef);
  if (!widget) return { ok: true, data };

  const presetName = widget.preset_name || '';
  if (!DOCUMENTS_PRESET_NAMES.has(presetName)) return { ok: true, data };

  const widgetConfig = parseConfig(widget.config);
  const widgetRegistryId = readWidgetRegistryId(widgetConfig);
  if (widgetRegistryId == null) return { ok: true, data };

  const hostRegistryId = await loadDocumentRegistryId(documentId);
  if (hostRegistryId == null) return { ok: true, data };

  if (Number(widgetRegistryId) === Number(hostRegistryId)) {
    return {
      ok: false,
      status: 400,
      code: 'RECURSIVE_DOCUMENT_EMBEDDING',
      error: `recursive_document_embedding: widget ${widgetRef} renders registry ${widgetRegistryId} which also contains host document ${documentId}`,
      widget_id: widgetRef,
      document_id: documentId,
    };
  }

  return { ok: true, data };
}

// Test introspection — not part of the public contract.
export const _internals = {
  DOCUMENTS_PRESET_NAMES,
  readWidgetRegistryId,
};
