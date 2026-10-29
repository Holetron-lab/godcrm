// ADR-0040 §space-secrets — the per-space `Secrets` system table.
//
// Same shape as Users/Mail: a `universal_tables` row (is_system + sync_target
// '_secrets') in the space's System Data project. Reads come from `_secrets`
// filtered by space (SystemTableService), writes from the rows API land in the
// encrypted vault (tableRow*Controller). This module holds what both sides and
// the /api/v3/secrets route share: the column contract, key validation, and the
// owner-only gate. Ciphertext never leaves `_secrets`.
import { dbGet } from '../../database/connection.js';

export const SECRETS_SYNC_TARGET = '_secrets';
export const MASKED_VALUE = '••••••••';

export const SECRETS_COLUMNS = [
  { id: 'id', name: 'id', displayName: 'ID', type: 'number', isRequired: true, isReadonly: true, orderIndex: 0 },
  { id: 'key', name: 'key', displayName: 'Key', type: 'text', isRequired: true, orderIndex: 1 },
  { id: 'value', name: 'value', displayName: 'Value', type: 'password', isRequired: true, orderIndex: 2 },
  { id: 'description', name: 'description', displayName: 'Description', type: 'text', orderIndex: 3 },
  { id: 'created_at', name: 'created_at', displayName: 'Created At', type: 'datetime', isReadonly: true, orderIndex: 4 },
  { id: 'updated_at', name: 'updated_at', displayName: 'Updated At', type: 'datetime', isReadonly: true, orderIndex: 5 },
  { id: 'last_revealed_at', name: 'last_revealed_at', displayName: 'Last Revealed', type: 'datetime', isReadonly: true, orderIndex: 6 },
];

export function validateKey(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'key must be a string' };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, error: 'key cannot be empty' };
  if (trimmed.length > 128) return { ok: false, error: 'key cannot exceed 128 chars' };
  // Conservative charset — letters, digits, underscore, dash, dot. Mirrors
  // typical env-var conventions so seed migration (P3) maps 1:1.
  if (!/^[A-Za-z0-9_\-.]+$/.test(trimmed)) {
    return { ok: false, error: 'key may contain only [A-Za-z0-9_-.]' };
  }
  return { ok: true, value: trimmed };
}

/** Owner-only gate for a Secrets system table: resolves its space, refuses everyone else. */
export async function requireSecretsTableOwner(table, user) {
  const project = await dbGet('SELECT space_id FROM projects WHERE id = ?', [table.project_id]);
  const space = project?.space_id
    ? await dbGet('SELECT id, owner_id FROM spaces WHERE id = ?', [project.space_id])
    : null;
  if (!space) return { error: 'Secrets table is not bound to a space' };
  if (!user?.id || space.owner_id !== user.id) return { error: 'Only the space owner can manage secrets' };
  return { spaceId: space.id };
}

/**
 * The grid addresses system-table columns as `col-<tableId>-<idx>` (see
 * columnCrudController) or by name; keep only known secret columns.
 */
export function normalizeSecretRowData(tableId, data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    const m = /^col-(\d+)-(\d+)$/.exec(key);
    const name = m && m[1] === String(tableId) ? SECRETS_COLUMNS[Number(m[2])]?.name : key;
    if (name && SECRETS_COLUMNS.some((c) => c.name === name)) out[name] = value;
  }
  return out;
}

/** Row ids are `secret-<id>`; the delete controller may have stripped the prefix already. */
export function parseSecretRowId(rowId) {
  const m = /^(?:secret-)?(\d+)$/.exec(String(rowId));
  return m ? Number(m[1]) : null;
}
