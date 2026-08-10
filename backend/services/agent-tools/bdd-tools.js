/**
 * BDD Tool Handlers (ADR-0003 §C-1)
 *
 * MCP-side view onto the same logical tables (`bdd_specs`, `bdd_criteria`)
 * that back GET /api/v3/bdd/specs. Lets agents read acceptance criteria for
 * a document without hitting the HTTP layer.
 */

import { dbGet, dbAll } from '../../database/connection.js';

const BDD_SPACE_ID = 11;
const bddTableIds = new Map();

async function bddTableId(name) {
  if (bddTableIds.has(name)) return bddTableIds.get(name);
  const row = await dbGet(
    `SELECT ut.id FROM universal_tables ut
     JOIN projects p ON p.id = ut.project_id
     WHERE p.space_id = ? AND ut.name = ? LIMIT 1`,
    [BDD_SPACE_ID, name]
  );
  if (row?.id) bddTableIds.set(name, row.id);
  return row?.id || null;
}

function parse(v) {
  if (v == null) return {};
  return typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return {}; } })() : v;
}

export const bddToolHandlers = {
  async list_bdd_specs({ source_doc_id }) {
    const docId = parseInt(source_doc_id, 10);
    if (!Number.isFinite(docId)) {
      return { error: 'source_doc_id (integer) is required' };
    }

    const specsTableId = await bddTableId('bdd_specs');
    const critTableId  = await bddTableId('bdd_criteria');
    if (!specsTableId || !critTableId) {
      return { error: 'BDD_TABLES_NOT_BOOTSTRAPPED: bdd_specs/bdd_criteria missing in space 11' };
    }

    const specRows = await dbAll(
      `SELECT id, data FROM table_rows
       WHERE table_id = ? AND data->>'source_doc_id' = ?
       ORDER BY id ASC`,
      [specsTableId, String(docId)]
    );

    const specs = [];
    for (const s of specRows) {
      const sd = parse(s.data);
      const crit = await dbAll(
        `SELECT id, data FROM table_rows
         WHERE table_id = ? AND data->>'spec_id' = ?
         ORDER BY COALESCE((data->>'order_index')::int, id) ASC`,
        [critTableId, String(s.id)]
      );
      specs.push({
        id: s.id,
        code: sd.code || sd.title || `spec-${s.id}`,
        owner_user_id: sd.owner_user_id ?? null,
        criteria: crit.map(c => {
          const d = parse(c.data);
          // ADR-0002 §8 Phase 2 — canonical given/when_clause/then with
          // legacy `description` fallback when all three are empty.
          const gwtPresent = !!(d.given || d.when_clause || d.when || d.then);
          return {
            id: c.id,
            code: d.code || null,
            title: d.title || null,
            given: d.given || (gwtPresent ? '' : (d.description || '')),
            when: d.when_clause || d.when || '',
            then: d.then || (gwtPresent ? '' : (d.title || '')),
            description: d.description || null,
            priority: d.priority || null,
            status: d.status || 'pending',
            owner_user_id: d.owner_user_id ?? null,
          };
        }),
      });
    }

    return { source_doc_id: docId, specs, spec_count: specs.length };
  },
};
