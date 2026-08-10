// backend/database/migrations/knex/048_adr_0002_phase1_bdd_relations.js
// ADR-0002 §8 Phase 1 — DB foundation (G1+G2+G5 + backfill).
//
// Acceptance:
//   A1.1 (Must) — bdd_criteria.ticket_id (relation→1708, nullable) + backfill
//   A1.2 (Must) — Tickets.bdd_spec_id: add relation→7255 metadata
//   A1.3 (Must) — bdd_criteria.failed_test_id: add relation→7258 metadata
//   A1.4 (Must) — CHECK on table_rows for table_id=7256:
//                 (data->>'spec_id' IS NOT NULL) OR (data->>'ticket_id' IS NOT NULL)
//   A1.5 (Should)— backfill report at docs/.snapshots/migration-reports/...
//
// Storage architecture: dynamic tables live in `table_rows.data` (JSONB).
// `_data_<id>` and `_columns` referenced in the ADR map to:
//   `_data_7256`  -> SELECT FROM table_rows WHERE table_id=7256
//   `_columns`    -> table_columns
// Relation columns use type='select' with config.relation = {
//   enabled: true, tableId: '<id>', valueColumn: 'id', labelColumn: '<col>'
// } — precedent: Tickets.adr_ref (col 18830, table_id=1708, target=2197).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// migrations live at backend/database/migrations/knex/ — project root is 4 levels up
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const TBL_TICKETS = 1708;
const TBL_BDD_SPECS = 7255;
const TBL_BDD_CRITERIA = 7256;
const TBL_BDD_TESTS = 7258;

const RELATION_INDICATOR = { type: 'emoji', value: '🔣' };

function ticketIdConfig() {
  return {
    appearance: { align: 'left', indicator: RELATION_INDICATOR },
    relation: {
      enabled: true,
      tableId: String(TBL_TICKETS),
      valueColumn: 'id',
      labelColumn: 'title',
    },
  };
}

function mergeRelation(existingConfigText, relationCfg) {
  let parsed = {};
  if (existingConfigText) {
    try {
      parsed = JSON.parse(existingConfigText);
    } catch (_) {
      parsed = {};
    }
  }
  parsed.relation = {
    enabled: true,
    tableId: String(relationCfg.tableId),
    valueColumn: relationCfg.valueColumn || 'id',
    labelColumn: relationCfg.labelColumn || 'title',
  };
  if (!parsed.appearance) {
    parsed.appearance = { align: 'left', indicator: RELATION_INDICATOR };
  } else if (!parsed.appearance.indicator) {
    parsed.appearance.indicator = RELATION_INDICATOR;
  }
  return JSON.stringify(parsed);
}

async function ensureTicketIdColumn(knex) {
  const existing = await knex('table_columns')
    .where({ table_id: TBL_BDD_CRITERIA, column_name: 'ticket_id' })
    .first();
  if (existing) return existing;

  const maxOrder = await knex('table_columns')
    .where({ table_id: TBL_BDD_CRITERIA })
    .max({ m: 'order_index' })
    .first();
  const nextOrder = (maxOrder?.m ?? 0) + 1;

  const [row] = await knex('table_columns')
    .insert({
      table_id: TBL_BDD_CRITERIA,
      column_name: 'ticket_id',
      display_name: 'Ticket',
      type: 'select',
      config: JSON.stringify(ticketIdConfig()),
      order_index: nextOrder,
      is_visible: 1,
      is_required: 0,
      is_system: 0,
      unique_constraint: 0,
    })
    .returning('*');
  return row;
}

async function upgradeBddSpecIdColumn(knex) {
  const existing = await knex('table_columns')
    .where({ table_id: TBL_TICKETS, column_name: 'bdd_spec_id' })
    .first();
  if (!existing) {
    // bdd_spec_id should already exist; if not, create as relation.
    await knex('table_columns').insert({
      table_id: TBL_TICKETS,
      column_name: 'bdd_spec_id',
      display_name: 'BDD Spec',
      type: 'select',
      config: JSON.stringify({
        appearance: { align: 'left', indicator: RELATION_INDICATOR },
        relation: {
          enabled: true,
          tableId: String(TBL_BDD_SPECS),
          valueColumn: 'id',
          labelColumn: 'title',
        },
      }),
      is_visible: 1,
      is_required: 0,
      is_system: 0,
      unique_constraint: 0,
    });
    return;
  }
  const merged = mergeRelation(existing.config, {
    tableId: TBL_BDD_SPECS,
    labelColumn: 'title',
  });
  await knex('table_columns')
    .where({ id: existing.id })
    .update({ type: 'select', config: merged, updated_at: knex.fn.now() });
}

async function upgradeFailedTestIdColumn(knex) {
  const existing = await knex('table_columns')
    .where({ table_id: TBL_BDD_CRITERIA, column_name: 'failed_test_id' })
    .first();
  if (!existing) return;
  const merged = mergeRelation(existing.config, {
    tableId: TBL_BDD_TESTS,
    labelColumn: 'title',
  });
  await knex('table_columns')
    .where({ id: existing.id })
    .update({ type: 'select', config: merged, updated_at: knex.fn.now() });
}

async function backfillTicketIds(knex) {
  const stats = {
    total: 0,
    updated: 0,
    skipped_no_match: 0,
    skipped_already_set: 0,
    ambiguous: [],
  };
  const criteria = await knex('table_rows')
    .where({ table_id: TBL_BDD_CRITERIA })
    .select('id', 'data');
  stats.total = criteria.length;

  // For each criterion, find ticket(s) where data->>'bdd_spec_id' equals criterion's spec_id.
  for (const row of criteria) {
    const data = row.data || {};
    const specId = data.spec_id;
    if (data.ticket_id != null && data.ticket_id !== '') {
      stats.skipped_already_set += 1;
      continue;
    }
    if (specId == null || specId === '') continue;

    const specIdStr = String(specId);
    const tickets = await knex('table_rows')
      .where({ table_id: TBL_TICKETS })
      .whereRaw("data->>'bdd_spec_id' = ?", [specIdStr])
      .select('id');

    if (tickets.length === 1) {
      const ticketId = tickets[0].id;
      const updatedData = { ...data, ticket_id: ticketId };
      await knex('table_rows')
        .where({ id: row.id })
        .update({ data: updatedData, updated_at: knex.fn.now() });
      stats.updated += 1;
    } else if (tickets.length === 0) {
      stats.skipped_no_match += 1;
    } else {
      stats.ambiguous.push({
        criterion_id: row.id,
        spec_id: specId,
        ticket_ids: tickets.map((t) => t.id),
      });
    }
  }
  return stats;
}

function writeReport(stats) {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/T/, '-')
    .slice(0, 19);
  const dir = path.join(
    PROJECT_ROOT,
    'docs',
    '.snapshots',
    'migration-reports',
  );
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `adr-0002-phase1-backfill-${ts}.md`);
  const lines = [
    '# ADR-0002 §8 Phase 1 — bdd_criteria.ticket_id backfill report',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Total bdd_criteria rows: **${stats.total}**`,
    `- Rows updated (unambiguous match): **${stats.updated}**`,
    `- Rows skipped (already had ticket_id): **${stats.skipped_already_set}**`,
    `- Rows skipped (no ticket with matching bdd_spec_id): **${stats.skipped_no_match}**`,
    `- Rows ambiguous (multiple matching tickets): **${stats.ambiguous.length}**`,
    '',
  ];
  if (stats.ambiguous.length) {
    lines.push('## Ambiguous (manual triage required)');
    lines.push('');
    lines.push('| criterion_id | spec_id | matching_ticket_ids |');
    lines.push('|---|---|---|');
    for (const a of stats.ambiguous) {
      lines.push(`| ${a.criterion_id} | ${a.spec_id} | ${a.ticket_ids.join(', ')} |`);
    }
    lines.push('');
  }
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

export async function up(knex) {
  // 1. A1.1 — add ticket_id metadata column
  await ensureTicketIdColumn(knex);

  // 2. A1.2 — Tickets.bdd_spec_id metadata upgrade (relation→7255)
  await upgradeBddSpecIdColumn(knex);

  // 3. A1.3 — bdd_criteria.failed_test_id metadata upgrade (relation→7258)
  await upgradeFailedTestIdColumn(knex);

  // 4. A1.1 — backfill data->>'ticket_id' from spec_id chain
  const stats = await backfillTicketIds(knex);

  // 5. A1.5 — write report
  let reportPath = null;
  try {
    reportPath = writeReport(stats);
  } catch (err) {
    // Report failure should not break migration — log only.
    // eslint-disable-next-line no-console
    console.error('[048] backfill report write failed:', err.message);
  }
  // eslint-disable-next-line no-console
  console.log(
    `[048] backfill complete: total=${stats.total} updated=${stats.updated} ` +
      `skipped_no_match=${stats.skipped_no_match} ambiguous=${stats.ambiguous.length} ` +
      `report=${reportPath || '(not written)'}`,
  );

  // 6. A1.4 — CHECK constraint scoped to table_id=7256.
  //
  // Postgres CHECK can't be partial; instead we encode the table scope inside
  // the predicate so other tables are not affected.
  //
  // Note: on PROD `table_rows` is owned by the `postgres` role, so this ALTER
  // must be run with privileges that allow ALTER TABLE. If the constraint
  // already exists (e.g., it was pre-applied via psql), we skip the ALTER.
  const existingCheck = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = 'bdd_criteria_container_chk' LIMIT 1`,
  );
  if (!existingCheck.rows || existingCheck.rows.length === 0) {
    await knex.raw(`
      ALTER TABLE table_rows
        ADD CONSTRAINT bdd_criteria_container_chk
        CHECK (
          table_id <> ${TBL_BDD_CRITERIA}
          OR (data->>'spec_id') IS NOT NULL
          OR (data->>'ticket_id') IS NOT NULL
        )
    `);
  } else {
    // eslint-disable-next-line no-console
    console.log('[048] CHECK constraint already exists — skipping ALTER');
  }
}

export async function down(knex) {
  // CHECK constraint drop may require table-owner privileges; tolerate failure
  // so the rest of the rollback proceeds (the constraint can be dropped manually
  // as the postgres superuser if needed).
  try {
    await knex.raw(`
      ALTER TABLE table_rows
        DROP CONSTRAINT IF EXISTS bdd_criteria_container_chk
    `);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      '[048] could not drop CHECK constraint (likely insufficient privileges):',
      err.message,
    );
  }

  // Revert bdd_spec_id metadata upgrade (best-effort: strip relation key).
  const tickets = await knex('table_columns')
    .where({ table_id: TBL_TICKETS, column_name: 'bdd_spec_id' })
    .first();
  if (tickets) {
    let cfg = {};
    try {
      cfg = JSON.parse(tickets.config || '{}');
    } catch (_) {
      cfg = {};
    }
    delete cfg.relation;
    await knex('table_columns')
      .where({ id: tickets.id })
      .update({ type: 'number', config: JSON.stringify(cfg) });
  }

  const failed = await knex('table_columns')
    .where({ table_id: TBL_BDD_CRITERIA, column_name: 'failed_test_id' })
    .first();
  if (failed) {
    let cfg = {};
    try {
      cfg = JSON.parse(failed.config || '{}');
    } catch (_) {
      cfg = {};
    }
    delete cfg.relation;
    await knex('table_columns')
      .where({ id: failed.id })
      .update({ type: 'number', config: JSON.stringify(cfg) });
  }

  // Drop ticket_id column metadata + JSONB key.
  await knex('table_columns')
    .where({ table_id: TBL_BDD_CRITERIA, column_name: 'ticket_id' })
    .del();
  // Note: '\\?' escapes the jsonb has-key operator from knex's bind-placeholder parser.
  await knex.raw(`
    UPDATE table_rows
    SET data = data - 'ticket_id'
    WHERE table_id = ${TBL_BDD_CRITERIA}
      AND data \\? 'ticket_id'
  `);
}
