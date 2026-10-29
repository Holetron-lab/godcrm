/**
 * row-schema-guard — reject row `data` keys the table schema does not declare.
 *
 * QA-20816-01 (ADR-203 S2): POST /tables/:id/rows persisted `{title, qa_unknown}`
 * into a table whose only column is `title`; the stray key was stored, echoed
 * by GET, and invisible in the grid. Agents hit the same hole through MCP
 * (display-name keys like "Reported By" landing next to `reported_by`).
 *
 * Shared by the v3 HTTP create/update controllers and the MCP add/update tools.
 *
 * A key is KNOWN when it is a column name, a column id, a row-envelope field
 * (see ROW_ENVELOPE_KEYS — never user data, always dropped), or — on update —
 * already present on the stored row. The last rule keeps round-trip editors
 * working: the documents editor spreads the fetched item into its PUT, which
 * carries backend-written fields such as `task_ref`/`ticket_ref` that were
 * never declared as columns. Rejecting the echo would break every edit of a
 * linked document item; accepting it adds nothing new to the row.
 *
 * Tables deliberately NOT guarded (preset-managed stores, see guardRowKeys):
 *   - a table with no declared columns has no schema to validate against
 *     (spreadsheet imports land here before columns are inferred);
 *   - atoms_v2 is a typed-atom store whose per-type contracts (`props` of a
 *     ticket_ref atom, ADR-0012 §5) are enforced by their own validators, not
 *     by table_columns;
 *   - documents registries and per-document content tables
 *     (`universal_tables.table_type` = documents_registry | document_content,
 *     ADR-154): the documents preset's item model is the contract there —
 *     `atom_title`, `is_hidden`, `image_url`, widget-config custom fields and
 *     per-language `content_<lang>` are written without declared columns.
 */

import { dbAll, dbGet } from '../database/connection.js';
import { ATOMS_V2_TABLE_ID } from './atoms-archive.js';

/**
 * Fields a row carries OUTSIDE `data`. Clients that round-trip a fetched row
 * echo them inside `data`; they are stripped, never stored, never "unknown".
 * `change_reason` is the atoms_v2 versioning note the MCP update tool reads
 * off `data` before persisting.
 */
export const ROW_ENVELOPE_KEYS = new Set([
  'id', 'base_id', 'table_id', 'created_by', 'created_at', 'updated_at', 'change_reason',
]);

/**
 * Keys the platform itself reads from `data` by contract without declaring a
 * column, written by clients on regular tables. Always accepted and stored.
 *   - parent_document_id — stamped on a ticket created from a document
 *     (ConvertToTicketModal, ADR-154); read by tickets/dispatch.js.
 */
export const PLATFORM_DATA_KEYS = new Set(['parent_document_id']);

// `document_registry` (singular) exists on one legacy registry on master A.
const PRESET_MANAGED_TABLE_TYPES = new Set(['documents_registry', 'document_registry', 'document_content']);

/**
 * Pure split of `data` into the part the schema accepts and the unknown keys.
 *
 * @param {Array<{id:number|string, column_name:string}>} columns  table_columns rows
 * @param {object} data            incoming row data (column names or ids as keys)
 * @param {object} [existingData]  stored row data on update; its keys stay known
 * @returns {{ data: object, unknown: string[] }}
 */
export function splitUnknownRowKeys(columns, data, existingData = {}) {
  const known = new Set(PLATFORM_DATA_KEYS);
  for (const col of columns) {
    known.add(col.column_name);
    known.add(String(col.id));
  }
  for (const key of Object.keys(existingData || {})) known.add(key);

  const accepted = {};
  const unknown = [];
  for (const [key, value] of Object.entries(data || {})) {
    if (known.has(key)) accepted[key] = value;
    else if (!ROW_ENVELOPE_KEYS.has(key)) unknown.push(key);
  }
  return { data: accepted, unknown };
}

/**
 * Load the table's columns and split `data`. Schema-less tables, atoms_v2 and
 * documents preset tables are passed through untouched (see module comment).
 *
 * @param {number|string} tableId
 * @param {object} data
 * @param {object} [existingData]
 * @returns {Promise<{ data: object, unknown: string[] }>}
 */
export async function guardRowKeys(tableId, data, existingData = {}) {
  if (Number(tableId) === ATOMS_V2_TABLE_ID) return { data, unknown: [] };
  const table = await dbGet('SELECT table_type FROM universal_tables WHERE id = ?', [tableId]);
  if (PRESET_MANAGED_TABLE_TYPES.has(table?.table_type)) return { data, unknown: [] };
  const columns = await dbAll(
    'SELECT id, column_name FROM table_columns WHERE table_id = ?',
    [tableId]
  );
  if (columns.length === 0) return { data, unknown: [] };
  return splitUnknownRowKeys(columns, data, existingData);
}

/** One-line message for 400 / MCP error bodies. */
export function unknownKeysMessage(unknown) {
  return `Unknown column${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. ` +
    'Only declared table columns can be written — add the column first or drop the key.';
}
