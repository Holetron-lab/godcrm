/**
 * Copy Tool Handlers — copy_table / copy_project / copy_space
 *
 * Marketplace staging-space curation primitives. All three support modes
 * schema_only / full / template, run-wide relation-awareness (rewriting
 * intra-scope relation column targets + cell values via row_map), and
 * cascade rollback on mid-op failure.
 */

import { dbGet, dbRun, dbAll, sqlNow } from '../../database/connection.js';
import { generateBaseId } from '../../utils/baseId.js';
import { parseRowData } from './data-tools.js';
import { aiLogger } from '../../utils/logger.js';

// Tables we refuse to copy even when explicitly inside a project/space scope.
// _secrets / _secrets_audit are owner-bound and meaningless outside the
// origin space. (Document widget tables _atoms / _registry / _doc_statuses
// ARE in scope — they hold real user content.)
const SKIP_TABLE_NAMES = new Set(['_secrets', '_secrets_audit']);

// Per-row fields scrubbed automatically in 'template' mode in addition to
// user-supplied strip_columns. Keeps copied artifacts ownerless/timestampless.
const TEMPLATE_DEFAULT_STRIP = new Set([
  'owner_id', 'created_by', 'created_at', 'updated_at',
  'assigned_to', 'assigned_by', 'sealed_by', 'sealed_at',
]);

function safeJson(s) {
  if (s === null || s === undefined) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}

// Both relation config shapes seen in DB:
//   short: { relation_table: <id|null> }
//   full:  { relation: { enabled: true, tableId: "<id>", ... } }
function parseRelationTarget(rawConfig) {
  const config = safeJson(rawConfig);
  if (!config) return null;
  if (Object.prototype.hasOwnProperty.call(config, 'relation_table')) {
    const v = config.relation_table;
    if (v === null || v === undefined || v === '') return null;
    return Number(v);
  }
  if (config.relation && config.relation.enabled) {
    const v = config.relation.tableId;
    if (v === null || v === undefined || v === '') return null;
    return Number(v);
  }
  return null;
}

function patchRelationTargetInConfig(rawConfig, newTargetId) {
  const cfg = safeJson(rawConfig) || {};
  if (Object.prototype.hasOwnProperty.call(cfg, 'relation_table')) {
    cfg.relation_table = newTargetId;
  }
  if (cfg.relation && cfg.relation.enabled) {
    cfg.relation.tableId = String(newTargetId);
  }
  return cfg;
}

function remapRelationValue(rawValue, subRowMap) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return rawValue;
  }
  if (Array.isArray(rawValue)) {
    return rawValue
      .map(v => subRowMap[String(v)] ?? null)
      .filter(v => v !== null);
  }
  return subRowMap[String(rawValue)] ?? null;
}

async function insertColumn(newTableId, col, idx) {
  const cfgStr = typeof col.config === 'string' ? col.config : JSON.stringify(col.config ?? {});
  const result = await dbRun(
    `INSERT INTO table_columns
       (table_id, column_name, display_name, type, config, width, is_required, order_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
    [newTableId, col.column_name, col.display_name, col.type, cfgStr,
     col.width ?? 150, col.is_required ?? 0, col.order_index ?? idx]
  );
  return result.lastInsertRowid || result.lastID;
}

async function insertRow(tableId, data, userId) {
  const baseId = generateBaseId();
  const result = await dbRun(
    `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
    [tableId, baseId, JSON.stringify(data), userId || 1]
  );
  return result.lastInsertRowid || result.lastID;
}

// =========================================================================
// copyTableCore — single-table worker shared by all three public handlers.
// Mutates `tableMap`, `rowMap`, `tracking` so callers can chain calls and
// perform a second-pass relation rewrite once every table exists.
// =========================================================================
async function copyTableCore(opts, userId) {
  const {
    src_table_id, dst_project_id, name, icon, description,
    mode, row_filter, strip_columns,
    keep_external_relations,
    ctxTableIds, tableMap, rowMap, tracking,
  } = opts;

  const src = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [src_table_id]);
  if (!src) return { error: `src table ${src_table_id} not found` };

  const dstProj = await dbGet('SELECT id FROM projects WHERE id = ?', [dst_project_id]);
  if (!dstProj) return { error: `dst project ${dst_project_id} not found` };

  const srcColumns = await dbAll(
    `SELECT id, column_name, display_name, type, config, width, is_required, order_index
     FROM table_columns WHERE table_id = ? ORDER BY order_index, id`,
    [src_table_id]
  );

  const stripColSet = new Set(strip_columns || []);
  const droppedRelations = [];
  const colsToCopy = [];

  for (const c of srcColumns) {
    if (stripColSet.has(c.column_name)) continue;
    if (c.type === 'relation' || c.type === 'link') {
      const targetTableId = parseRelationTarget(c.config);
      if (targetTableId === null) {
        colsToCopy.push({ src: c, willRewriteTarget: false });
        continue;
      }
      if (ctxTableIds.has(Number(targetTableId))) {
        colsToCopy.push({ src: c, willRewriteTarget: true, oldTargetTableId: Number(targetTableId) });
        continue;
      }
      if (keep_external_relations) {
        colsToCopy.push({ src: c, willRewriteTarget: false });
        continue;
      }
      droppedRelations.push({
        table_id: src_table_id,
        table_name: src.name,
        column: c.column_name,
        reason: 'external relation target not in copy scope',
        original_target: targetTableId,
      });
      continue;
    }
    colsToCopy.push({ src: c, willRewriteTarget: false });
  }

  // ADR-164 Phase 3a: inherit ONLY the agent marker onto the copy, so a copied
  // AI Agents table stays marker-identifiable. Other table_types (documents_*, etc.)
  // are deliberately NOT carried — keeping copy semantics byte-identical outside the
  // agent case (in-scope discipline; a general table_type carry-over is a separate call).
  const copyTableType = src.table_type === 'ai_agents' ? 'ai_agents' : null;
  const tableInsert = await dbRun(
    // ADR-0066-B: the copy gets the copier as creator, not the source table's.
    `INSERT INTO universal_tables (project_id, name, icon, description, table_type, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
    [dst_project_id,
     name || `${src.name} (copy)`,
     icon || src.icon || '📊',
     description ?? src.description ?? '',
     copyTableType,
     userId ?? null]
  );
  const newTableId = tableInsert.lastInsertRowid || tableInsert.lastID;
  tracking.tables.push(newTableId);
  tableMap[String(src_table_id)] = newTableId;

  const colMap = {};
  for (let i = 0; i < colsToCopy.length; i++) {
    const { src: c, willRewriteTarget, oldTargetTableId } = colsToCopy[i];
    const newColId = await insertColumn(newTableId, {
      column_name: c.column_name,
      display_name: c.display_name,
      type: c.type,
      config: safeJson(c.config) || {},
      width: c.width,
      is_required: c.is_required,
      order_index: c.order_index ?? (i + 1),
    }, i);
    colMap[c.column_name] = { new_id: newColId, type: c.type, willRewriteTarget, oldTargetTableId };
  }

  let copiedRows = 0;
  if (mode !== 'schema_only') {
    const limit = (row_filter && Number.isInteger(row_filter.limit)) ? row_filter.limit : null;
    const baseQ = 'SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY id ASC';
    const rows = limit ? await dbAll(`${baseQ} LIMIT ?`, [src_table_id, limit])
                       : await dbAll(baseQ, [src_table_id]);

    for (const r of rows) {
      const orig = parseRowData(r.data) || {};
      const copy = {};
      for (const [k, v] of Object.entries(orig)) {
        if (stripColSet.has(k)) continue;
        if (mode === 'template' && TEMPLATE_DEFAULT_STRIP.has(k)) continue;
        if (!colMap[k]) continue; // column was stripped → drop the cell too
        copy[k] = v;
      }
      const newRowId = await insertRow(newTableId, copy, userId);
      rowMap[`${src_table_id}:${r.id}`] = newRowId;
      copiedRows++;
    }
  }

  return {
    success: true,
    new_table_id: newTableId,
    src_table_id,
    copied_rows: copiedRows,
    dropped_relations: droppedRelations,
    _colMap: colMap,
  };
}

// Second pass: every relation column that was in-scope (target table also
// copied) needs (1) its column config rewritten to the new target id and
// (2) every cell value remapped through row_map.
async function rewriteInScopeRelations(perTableMeta, tableMap, rowMap) {
  for (const meta of perTableMeta) {
    for (const [colName, colInfo] of Object.entries(meta._colMap)) {
      if (!colInfo.willRewriteTarget) continue;
      const oldTargetId = colInfo.oldTargetTableId;
      const newTargetId = tableMap[String(oldTargetId)];
      if (!newTargetId) continue;

      const colRow = await dbGet('SELECT config FROM table_columns WHERE id = ?', [colInfo.new_id]);
      const patched = patchRelationTargetInConfig(colRow?.config, newTargetId);
      await dbRun(
        `UPDATE table_columns SET config = ?, updated_at = ${sqlNow()} WHERE id = ?`,
        [JSON.stringify(patched), colInfo.new_id]
      );

      const subMap = {};
      for (const [k, v] of Object.entries(rowMap)) {
        const [src_t, src_r] = k.split(':');
        if (Number(src_t) === oldTargetId) subMap[src_r] = v;
      }
      if (Object.keys(subMap).length === 0) continue;

      const rows = await dbAll('SELECT id, data FROM table_rows WHERE table_id = ?', [meta.new_table_id]);
      for (const r of rows) {
        const data = parseRowData(r.data) || {};
        if (!(colName in data)) continue;
        data[colName] = remapRelationValue(data[colName], subMap);
        await dbRun(
          `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
          [JSON.stringify(data), r.id]
        );
      }
    }
  }
}

async function rollback(tracking) {
  try {
    for (const tid of tracking.tables) {
      try { await dbRun('DELETE FROM table_rows WHERE table_id = ?', [tid]); } catch {}
      try { await dbRun('DELETE FROM table_columns WHERE table_id = ?', [tid]); } catch {}
      try { await dbRun('DELETE FROM universal_tables WHERE id = ?', [tid]); } catch {}
    }
    for (const pid of tracking.projects) {
      try { await dbRun('DELETE FROM projects WHERE id = ?', [pid]); } catch {}
    }
    for (const sid of tracking.spaces) {
      try { await dbRun('DELETE FROM spaces WHERE id = ?', [sid]); } catch {}
    }
  } catch (e) {
    aiLogger.error({ err: e.message }, 'copy-tools rollback failed');
  }
}

function validateMode(mode) {
  return ['schema_only', 'full', 'template'].includes(mode);
}

// =========================================================================
// Public handlers
// =========================================================================
export const copyToolHandlers = {

  async copy_table(args, userId) {
    const {
      src_table_id, dst_project_id, name, icon, description,
      mode = 'full', row_filter,
      strip_columns = [],
      keep_external_relations = false,
    } = args || {};

    if (typeof src_table_id !== 'number') return { error: 'src_table_id is required (number)' };
    if (typeof dst_project_id !== 'number') return { error: 'dst_project_id is required (number)' };
    if (!validateMode(mode)) return { error: `mode must be one of schema_only|full|template, got ${mode}` };

    const tracking = { spaces: [], projects: [], tables: [] };
    try {
      const ctxTableIds = new Set([Number(src_table_id)]);
      const tableMap = {};
      const rowMap = {};
      const r = await copyTableCore({
        src_table_id, dst_project_id, name, icon, description,
        mode, row_filter, strip_columns, keep_external_relations,
        ctxTableIds, tableMap, rowMap, tracking,
      }, userId);
      if (r.error) { await rollback(tracking); return { error: r.error }; }

      // Single-table self-relations get rewritten too (rare but supported).
      await rewriteInScopeRelations([r], tableMap, rowMap);

      return {
        success: true,
        new_table_id: r.new_table_id,
        copied_rows: r.copied_rows,
        dropped_relations: r.dropped_relations,
        message: `Copied table ${src_table_id} → ${r.new_table_id} (${r.copied_rows} rows, ${r.dropped_relations.length} relations stripped)`,
      };
    } catch (e) {
      await rollback(tracking);
      aiLogger.error({ err: e.message, src_table_id }, 'copy_table failed');
      return { error: e.message };
    }
  },

  async copy_project(args, userId) {
    const {
      src_project_id, dst_space_id, name, icon, description,
      mode = 'full', strip_columns = [],
      keep_external_relations = false,
    } = args || {};

    if (typeof src_project_id !== 'number') return { error: 'src_project_id is required (number)' };
    if (typeof dst_space_id !== 'number') return { error: 'dst_space_id is required (number)' };
    if (!validateMode(mode)) return { error: `mode must be one of schema_only|full|template, got ${mode}` };

    const srcProj = await dbGet('SELECT * FROM projects WHERE id = ?', [src_project_id]);
    if (!srcProj) return { error: `src project ${src_project_id} not found` };
    const dstSpace = await dbGet('SELECT id FROM spaces WHERE id = ?', [dst_space_id]);
    if (!dstSpace) return { error: `dst space ${dst_space_id} not found` };

    const tracking = { spaces: [], projects: [], tables: [] };
    try {
      const projRes = await dbRun(
        `INSERT INTO projects (space_id, name, icon, description, owner_id, type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
        [dst_space_id,
         name || `${srcProj.name} (copy)`,
         icon || srcProj.icon || '📁',
         description ?? srcProj.description ?? '',
         Number(userId || 1),
         srcProj.type || 'project']
      );
      const newProjectId = projRes.lastInsertRowid || projRes.lastID;
      tracking.projects.push(newProjectId);

      const srcTables = await dbAll(
        'SELECT id, name FROM universal_tables WHERE project_id = ? ORDER BY id ASC',
        [src_project_id]
      );
      const skippedTables = [];
      const tablesInScope = [];
      for (const t of srcTables) {
        if (SKIP_TABLE_NAMES.has(t.name)) {
          skippedTables.push({ id: t.id, name: t.name, reason: 'system table' });
        } else {
          tablesInScope.push(t);
        }
      }
      const ctxTableIds = new Set(tablesInScope.map(t => Number(t.id)));
      const tableMap = {};
      const rowMap = {};
      const perTableMeta = [];
      let totalRows = 0;
      const droppedRelations = [];

      for (const t of tablesInScope) {
        const r = await copyTableCore({
          src_table_id: Number(t.id),
          dst_project_id: newProjectId,
          mode, strip_columns, keep_external_relations,
          ctxTableIds, tableMap, rowMap, tracking,
        }, userId);
        if (r.error) throw new Error(`copy of table ${t.id} failed: ${r.error}`);
        perTableMeta.push(r);
        totalRows += r.copied_rows;
        droppedRelations.push(...r.dropped_relations);
      }

      await rewriteInScopeRelations(perTableMeta, tableMap, rowMap);

      return {
        success: true,
        new_project_id: newProjectId,
        copied_tables: tablesInScope.length,
        copied_rows: totalRows,
        table_map: tableMap,
        skipped_tables: skippedTables,
        dropped_relations: droppedRelations,
        message: `Copied project ${src_project_id} → ${newProjectId} (${tablesInScope.length} tables, ${totalRows} rows, ${skippedTables.length} skipped, ${droppedRelations.length} relations stripped)`,
      };
    } catch (e) {
      await rollback(tracking);
      aiLogger.error({ err: e.message, src_project_id }, 'copy_project failed');
      return { error: e.message };
    }
  },

  async copy_space(args, userId) {
    const {
      src_space_id, dst_owner_id, name, icon, description,
      mode = 'full', strip_columns = [],
      keep_external_relations = false,
    } = args || {};

    if (typeof src_space_id !== 'number') return { error: 'src_space_id is required (number)' };
    if (!validateMode(mode)) return { error: `mode must be one of schema_only|full|template, got ${mode}` };

    const srcSpace = await dbGet('SELECT * FROM spaces WHERE id = ?', [src_space_id]);
    if (!srcSpace) return { error: `src space ${src_space_id} not found` };

    const tracking = { spaces: [], projects: [], tables: [] };
    try {
      const ownerId = Number(dst_owner_id || userId || srcSpace.owner_id || 1);
      const spaceRes = await dbRun(
        `INSERT INTO spaces (owner_id, name, description, icon, type, visibility, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
        [ownerId,
         name || `${srcSpace.name} (copy)`,
         description ?? srcSpace.description ?? null,
         icon || srcSpace.icon || '📁',
         srcSpace.type || 'workspace',
         srcSpace.visibility || 'internal']
      );
      const newSpaceId = spaceRes.lastInsertRowid || spaceRes.lastID;
      tracking.spaces.push(newSpaceId);

      const allTables = await dbAll(`
        SELECT ut.id, ut.name, ut.project_id
        FROM universal_tables ut
        JOIN projects p ON ut.project_id = p.id
        WHERE p.space_id = ? ORDER BY ut.id ASC`, [src_space_id]);
      const tablesInScope = allTables.filter(t => !SKIP_TABLE_NAMES.has(t.name));
      const skippedTables = allTables
        .filter(t => SKIP_TABLE_NAMES.has(t.name))
        .map(t => ({ id: t.id, name: t.name, reason: 'system table' }));
      const ctxTableIds = new Set(tablesInScope.map(t => Number(t.id)));

      const srcProjects = await dbAll(
        'SELECT * FROM projects WHERE space_id = ? ORDER BY id ASC',
        [src_space_id]
      );
      const projectMap = {};
      const tableMap = {};
      const rowMap = {};
      const perTableMeta = [];
      let totalTables = 0;
      let totalRows = 0;
      const droppedRelations = [];

      for (const sp of srcProjects) {
        const projRes = await dbRun(
          `INSERT INTO projects (space_id, name, icon, description, owner_id, type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
          [newSpaceId, sp.name, sp.icon || '📁', sp.description || '',
           ownerId, sp.type || 'project']
        );
        const newProjId = projRes.lastInsertRowid || projRes.lastID;
        tracking.projects.push(newProjId);
        projectMap[String(sp.id)] = newProjId;

        const projTables = tablesInScope.filter(t => Number(t.project_id) === Number(sp.id));
        for (const t of projTables) {
          const r = await copyTableCore({
            src_table_id: Number(t.id),
            dst_project_id: newProjId,
            mode, strip_columns, keep_external_relations,
            ctxTableIds, tableMap, rowMap, tracking,
          }, userId);
          if (r.error) throw new Error(`copy of table ${t.id} failed: ${r.error}`);
          perTableMeta.push(r);
          totalRows += r.copied_rows;
          totalTables++;
          droppedRelations.push(...r.dropped_relations);
        }
      }

      await rewriteInScopeRelations(perTableMeta, tableMap, rowMap);

      return {
        success: true,
        new_space_id: newSpaceId,
        project_map: projectMap,
        table_map: tableMap,
        totals: {
          projects: srcProjects.length,
          tables: totalTables,
          rows: totalRows,
        },
        skipped_tables: skippedTables,
        dropped_relations: droppedRelations,
        message: `Copied space ${src_space_id} → ${newSpaceId} (${srcProjects.length} projects, ${totalTables} tables, ${totalRows} rows)`,
      };
    } catch (e) {
      await rollback(tracking);
      aiLogger.error({ err: e.message, src_space_id }, 'copy_space failed');
      return { error: e.message };
    }
  },
};
