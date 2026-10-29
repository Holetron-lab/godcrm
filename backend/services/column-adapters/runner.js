/**
 * ADR-204 Stage 2 — DB side of the adapters: preflight a column, back it up,
 * switch it atomically, undo from the artifact.
 *
 * Boundaries (ticket 254364 AC5/AC9):
 *   - preflight reads only. It is what the dry-run script prints.
 *   - applyColumn refuses unless EVERY value and the default passed preflight
 *     (no partially converted column is ever published), writes the backup
 *     artifact through ExportService BEFORE the first UPDATE, and runs the
 *     definition + value switch in one transaction with an optimistic check
 *     on each row (`data -> col` must still equal what preflight saw).
 *   - undoColumn restores from the artifact only where the current value is
 *     still the forward value (post-migration check); anything edited since
 *     blocks the undo of that column instead of being overwritten.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dbAll, dbGet, safeJsonParse, withTransactionAsync } from '../../database/connection.js';
import { ExportService } from '../ExportService.js';
import { persistColumnType } from '../ColumnService.js';
import { forward, undo, getAdapter, CONVERTIBLE, EMPTY, ALREADY, AMBIGUOUS, UNSUPPORTED } from './adapters.js';
import { resolveMediaKind } from './media-kind.js';

const STATUSES = [CONVERTIBLE, EMPTY, ALREADY, AMBIGUOUS, UNSUPPORTED];

export async function loadColumn(columnId) {
  const column = await dbGet(
    `SELECT id, table_id, column_name, display_name, type, config, default_value,
            is_readonly, is_required, is_visible, is_locked, formula, mapping
       FROM table_columns WHERE id = ?`,
    [columnId]
  );
  if (!column) throw new Error(`Column ${columnId} not found`);
  return column;
}

/**
 * Read-only preflight of one column: every row value + the default.
 * Counts only; no payload leaves this function except per-row plans, which
 * the dry-run script never prints.
 */
export async function preflightColumn(columnId, { kindOf = resolveMediaKind } = {}) {
  const column = await loadColumn(columnId);
  const adapter = getAdapter(column.type);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const reasons = {};
  const summary = { column: { id: column.id, table_id: column.table_id, type: column.type, target: adapter?.target ?? null }, rows: 0, counts, reasons, ok: false };
  if (!adapter) return { ...summary, reasons: { [`no adapter for ${column.type}`]: 1 } };

  const rows = await dbAll(
    'SELECT id, jsonb_exists(data, ?::text) AS present, data -> ?::text AS value FROM table_rows WHERE table_id = ? ORDER BY id',
    [column.column_name, column.column_name, column.table_id]
  );
  const plans = [];
  for (const row of rows) {
    const out = await forward(column.type, Boolean(row.present), row.value, { kindOf });
    counts[out.status]++;
    if (out.reason) reasons[out.reason] = (reasons[out.reason] ?? 0) + 1;
    plans.push({ rowId: row.id, ...out });
  }
  // default_value is text; a stored default travels through the same adapter.
  const hasDefault = column.default_value !== null && column.default_value !== undefined;
  const defaultPlan = hasDefault
    ? await forward(column.type, true, safeJsonParse(column.default_value, column.default_value), { kindOf })
    : { status: EMPTY, artifact: { present: false }, value: null };
  if (defaultPlan.reason) reasons[`default: ${defaultPlan.reason}`] = 1;
  if (adapter.unsupported) reasons[adapter.unsupported] ??= 0;

  const blocked = Boolean(adapter.unsupported) || counts[AMBIGUOUS] + counts[UNSUPPORTED] > 0 ||
    [AMBIGUOUS, UNSUPPORTED].includes(defaultPlan.status);
  return { ...summary, rows: rows.length, ok: !blocked, plans, defaultPlan, nextConfig: adapter.forwardConfig(safeJsonParse(column.config) ?? {}) };
}

/**
 * AC5: original definition + every value (address table/row/column + presence)
 * through the existing export mechanism. Written 0600; never logged or echoed.
 * @returns {string} artifact path
 */
export async function writeBackupArtifact(preflight, outDir) {
  const column = await loadColumn(preflight.column.id);
  const exported = await ExportService.exportTable(column.table_id, { mode: 'full' });
  const artifact = {
    adr: 'ADR-204', stage: '2a', written_at: new Date().toISOString(),
    column: { ...column, config: safeJsonParse(column.config, column.config) },
    export: exported,
    values: preflight.plans.map((p) => ({ table_id: column.table_id, row_id: p.rowId, column_name: column.column_name, artifact: p.artifact, forward: p.value ?? null, status: p.status })),
    default: { original: column.default_value, artifact: preflight.defaultPlan.artifact },
    nextConfig: preflight.nextConfig,
  };
  fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const file = path.join(outDir, `adr204-column-${column.id}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(artifact), { mode: 0o600 });
  return file;
}

/**
 * Switch one column to its target type. Throws (nothing written) unless the
 * preflight is clean. Returns the artifact path.
 */
export async function applyColumn(columnId, { backupDir, kindOf = resolveMediaKind } = {}) {
  if (!backupDir) throw new Error('applyColumn requires backupDir for the AC5 artifact');
  const pre = await preflightColumn(columnId, { kindOf });
  if (!pre.ok) throw new Error(`Column ${columnId} is not fully convertible: ${JSON.stringify(pre.reasons)}`);
  const artifactPath = await writeBackupArtifact(pre, backupDir);
  const column = await loadColumn(columnId);
  const target = persistColumnType(pre.column.target);

  await withTransactionAsync(async (tx) => {
    const def = await tx.run(
      'UPDATE table_columns SET type = ?, config = ?, default_value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND type = ?',
      [target, JSON.stringify(pre.nextConfig), pre.defaultPlan.status === EMPTY ? null : JSON.stringify(pre.defaultPlan.value), columnId, column.type]
    );
    if (def.changes !== 1) throw new Error(`Column ${columnId} changed concurrently; aborted`);
    for (const plan of pre.plans) {
      if (plan.status === ALREADY) continue;
      if (!plan.artifact.present) continue; // absent key stays absent
      const expected = JSON.stringify(plan.artifact.value);
      const res = await tx.run(
        'UPDATE table_rows SET data = jsonb_set(data, ARRAY[?::text], ?::jsonb), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND data -> ?::text = ?::jsonb',
        [column.column_name, JSON.stringify(plan.value ?? null), plan.rowId, column.column_name, expected]
      );
      if (res.changes !== 1) throw new Error(`Row ${plan.rowId} changed concurrently; aborted`);
    }
  });
  return artifactPath;
}

/**
 * Exact inverse from the artifact. Every row must still hold the forward
 * value; the column must still be the target type.
 */
export async function undoColumn(artifactPath) {
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const { column } = artifact;
  await withTransactionAsync(async (tx) => {
    const def = await tx.run(
      'UPDATE table_columns SET type = ?, config = ?, default_value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND type = ?',
      [column.type, column.config === null || column.config === undefined ? null : JSON.stringify(column.config), artifact.default.original, column.id, getAdapter(column.type).target]
    );
    if (def.changes !== 1) throw new Error(`Column ${column.id} is no longer ${getAdapter(column.type).target}; undo blocked`);
    for (const v of artifact.values) {
      if (v.status === ALREADY) continue;
      const restored = undo(v.artifact);
      if (!restored.present) continue;
      const res = await tx.run(
        'UPDATE table_rows SET data = jsonb_set(data, ARRAY[?::text], ?::jsonb), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND data -> ?::text = ?::jsonb',
        [v.column_name, JSON.stringify(restored.value), v.row_id, v.column_name, JSON.stringify(v.forward)]
      );
      if (res.changes !== 1) throw new Error(`Row ${v.row_id} was edited after migration; undo blocked`);
    }
  });
}
