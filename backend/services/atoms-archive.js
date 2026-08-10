/**
 * Atoms Archive — versioning hook for atoms_v2 (table 3574) per ADR-0001.
 *
 * On every UPDATE of a row in table 3574, snapshot the OLD row into
 * `atoms_archive` (table 7260) before applying the UPDATE, then bump
 * `version` on the new row.
 *
 * App-level hook (not a DB trigger) so it follows the JS code path and
 * can be skipped/extended per caller.
 *
 * If the archive table doesn't exist yet (parallel rollout), we log a
 * warning and DO NOT block the UPDATE — versioning is best-effort.
 */

import { dbGet, dbRun, sqlNow } from '../database/connection.js';
import { generateBaseId } from '../utils/baseId.js';

export const ATOMS_V2_TABLE_ID = 3574;
export const ATOMS_ARCHIVE_TABLE_ID = 7260;

/**
 * Safe parse — handles both string (SQLite) and object (PG JSONB).
 */
function parseRowData(data) {
  if (data === null || data === undefined) return {};
  if (typeof data === 'object') return data;
  try { return JSON.parse(data); } catch { return {}; }
}

/**
 * Returns true if the given table_id is the atoms_v2 table that needs
 * versioning. Centralised so the constant only lives here.
 */
export function isAtomsV2Table(table_id) {
  return Number(table_id) === ATOMS_V2_TABLE_ID;
}

/**
 * Snapshot the OLD row into atoms_archive and return the new version
 * number (`old.version + 1`, defaulting to 1 -> 2 if absent).
 *
 * @param {object} opts
 * @param {number} opts.atom_id              — id in atoms_v2 (table 3574)
 * @param {object} opts.oldRow               — full row { id, data, ... }
 * @param {string} [opts.changeReason]       — optional comment
 * @param {number|null} [opts.changedByUser] — Users(1782) row id
 * @param {number|null} [opts.changedByAgent]— Agents(1784) row id
 * @returns {Promise<number>} the new version to write on UPDATE
 */
export async function archiveAndBumpVersion({
  atom_id,
  oldRow,
  changeReason = null,
  changedByUser = null,
  changedByAgent = null,
} = {}) {
  const oldData = parseRowData(oldRow?.data);
  const oldVersion = Number(oldData.version) || 1;
  const nextVersion = oldVersion + 1;

  // Best-effort archive write. If the archive table or its columns are not
  // yet provisioned (parallel rollout), do not block the UPDATE.
  try {
    // Verify the archive table is materialised before writing.
    const archiveTable = await dbGet(
      'SELECT id FROM universal_tables WHERE id = ?',
      [ATOMS_ARCHIVE_TABLE_ID]
    );
    if (!archiveTable) {
      console.warn(
        `[atoms-archive] table ${ATOMS_ARCHIVE_TABLE_ID} not found — ` +
        `skipping snapshot for atom_id=${atom_id}. ` +
        `Parallel migration may not have created atoms_archive yet.`
      );
      return nextVersion;
    }

    const snapshotData = {
      atom_id: Number(atom_id),
      document_id: oldData.document_id != null ? Number(oldData.document_id) : null,
      version: oldVersion,
      changed_at: new Date().toISOString(),
      change_reason: changeReason,
      snapshot: oldData,
      ...(changedByAgent != null ? { changed_by_agent: String(changedByAgent) } : {}),
      ...(changedByUser  != null ? { changed_by_user:  String(changedByUser)  } : {}),
    };

    await dbRun(
      `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
      [
        ATOMS_ARCHIVE_TABLE_ID,
        generateBaseId(),
        JSON.stringify(snapshotData),
        changedByUser || 1,
      ]
    );
  } catch (err) {
    console.warn(
      `[atoms-archive] snapshot failed for atom_id=${atom_id}: ${err.message}. ` +
      `UPDATE will still proceed with version bump.`
    );
  }

  return nextVersion;
}

/**
 * Convenience: given table_id + atom_id + about-to-be-merged data, if this
 * is atoms_v2, fetches the old row, archives it, and stamps the new
 * `version` onto the data object. Returns the (possibly mutated) data
 * object — caller should JSON.stringify and UPDATE as usual.
 *
 * Safe no-op if table_id !== ATOMS_V2_TABLE_ID.
 */
export async function applyAtomVersioning({
  table_id,
  row_id,
  newData,
  oldRow = null,
  changedByUser = null,
  changedByAgent = null,
  changeReason = null,
} = {}) {
  if (!isAtomsV2Table(table_id)) return newData;
  if (!row_id) return newData;

  let row = oldRow;
  if (!row) {
    row = await dbGet(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
      [row_id, ATOMS_V2_TABLE_ID]
    );
  }
  if (!row) return newData; // nothing to snapshot

  const nextVersion = await archiveAndBumpVersion({
    atom_id: row.id,
    oldRow: row,
    changeReason,
    changedByUser,
    changedByAgent,
  });

  return { ...newData, version: nextVersion };
}
