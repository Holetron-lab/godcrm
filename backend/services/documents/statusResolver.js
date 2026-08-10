// ADR-0001 / ADR-0003 — doc status as relation (_doc_statuses, table id cached by name).
// Registries have both a legacy `status` (text/select) and a canonical `status_id`
// (relation → _doc_statuses). This helper resolves slug ↔ row id so backend
// writers keep both in sync until the legacy column is retired.

import { dbAll, dbGet } from '../../database/connection.js';

const BDD_SPACE_ID = 11;
let statusTableIdCache = null;
const slugToId = new Map();
const idToSlug = new Map();
let loadedAt = 0;
const TTL_MS = 5 * 60_000;

async function ensureStatusTableId() {
  if (statusTableIdCache) return statusTableIdCache;
  const row = await dbGet(`
    SELECT ut.id FROM universal_tables ut
    JOIN projects p ON p.id = ut.project_id
    WHERE p.space_id = ? AND ut.name = '_doc_statuses' LIMIT 1
  `, [BDD_SPACE_ID]);
  statusTableIdCache = row?.id || null;
  return statusTableIdCache;
}

async function refresh(force = false) {
  if (!force && Date.now() - loadedAt < TTL_MS && slugToId.size > 0) return;
  const tid = await ensureStatusTableId();
  if (!tid) return;
  const rows = await dbAll(`SELECT id, data FROM table_rows WHERE table_id = ?`, [tid]);
  slugToId.clear();
  idToSlug.clear();
  for (const r of rows) {
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : (r.data || {});
    if (data.slug) {
      slugToId.set(String(data.slug), r.id);
      idToSlug.set(r.id, String(data.slug));
    }
  }
  loadedAt = Date.now();
}

export async function getStatusesTableId() {
  return ensureStatusTableId();
}

export async function resolveStatusId(slug) {
  if (!slug) return null;
  await refresh();
  return slugToId.get(String(slug)) || null;
}

export async function resolveStatusSlug(id) {
  if (!id) return null;
  await refresh();
  return idToSlug.get(Number(id)) || null;
}

export async function hasStatusIdColumn(registryTableId) {
  const col = await dbGet(
    `SELECT id FROM table_columns WHERE table_id = ? AND column_name = 'status_id' LIMIT 1`,
    [registryTableId]
  );
  return !!col;
}

export function invalidateStatusCache() {
  slugToId.clear();
  idToSlug.clear();
  loadedAt = 0;
}
