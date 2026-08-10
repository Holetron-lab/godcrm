// backend/database/migrations/knex/050_adr_0002_phase3_completion_gate.js
// ADR-0002 §8 Phase 3 — Completion gate (G4) + computed progress (G6).
//
// Acceptance:
//   A3.1 (Must) — bdd_gate_ticket_trg blocks Tickets.state -> done if any
//                 must-criterion is not 'verified'. Implemented in API layer
//                 (`completionGate.js`) — 409 with the blocker list. No PG
//                 trigger because the trigger surface can't carry the
//                 structured response body.
//   A3.2 (Must) — Tickets.criteria_progress aggregated from bdd_criteria via
//                 ticket_id. Implemented as on-write recompute on the
//                 `bdd_criteria` mutation path (insert/update/delete). This
//                 migration:
//                  (a) ensures `criteria_progress` column metadata is set up
//                      with the badge-friendly settings (icon 📊, width 110,
//                      type=text — already present from the Tickets schema).
//                  (b) backfills `Tickets.data.criteria_progress` for every
//                      existing ticket — A3.6.
//   A3.3 (Should)— UI badge — handled in TicketRowHeader.tsx (frontend, not
//                  this migration).
//
// Storage: `_data_1708` lives in `table_rows.data` (JSONB). `criteria_progress`
// is a string `"<must_verified>/<must_total>"` ('' when no must-criteria).
//
// Coordination with thread B (Phase 4): this migration is `050_*`; agent B
// owns `051_*` for `Tickets.sealed_at` / `sealed_by` and the new
// `ticket_seal_verification` table. No column overlap.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const TBL_TICKETS = 1708;
const TBL_BDD_CRITERIA = 7256;
const STATE_DONE = 24278;

// Build the `{ progress, must_total, must_verified }` triple for one ticket
// from a bulk-loaded criteria map. Empty progress / zero counts when no Must
// criteria are linked.
function progressFor(ticketId, criteriaByTicket) {
  const list = criteriaByTicket.get(Number(ticketId)) || [];
  let must_total = 0;
  let must_verified = 0;
  for (const c of list) {
    must_total += 1;
    if (c.status === 'verified') must_verified += 1;
  }
  return {
    progress: must_total > 0 ? `${must_verified}/${must_total}` : '',
    must_total,
    must_verified,
  };
}

async function ensureCriteriaProgressColumn(knex) {
  // Column exists already (table_id=1708, name='criteria_progress', type=text)
  // — but make sure metadata carries the badge icon and a sane width so the
  // tickets-list / kanban presets render the same indicator.
  const existing = await knex('table_columns')
    .where({ table_id: TBL_TICKETS, column_name: 'criteria_progress' })
    .first();
  if (!existing) {
    // Defensive: create if somehow missing.
    const maxOrder = await knex('table_columns')
      .where({ table_id: TBL_TICKETS })
      .max({ m: 'order_index' })
      .first();
    await knex('table_columns').insert({
      table_id: TBL_TICKETS,
      column_name: 'criteria_progress',
      display_name: 'criteria_progress',
      type: 'text',
      config: JSON.stringify({ icon: '📊', width: 110 }),
      order_index: (maxOrder?.m ?? 0) + 1,
      is_visible: 1,
      is_required: 0,
      is_system: 0,
      required: 0,
      unique_constraint: 0,
    });
    return;
  }
  // Metadata refresh — keep idempotent.
  let cfg = {};
  try {
    cfg = JSON.parse(existing.config || '{}');
  } catch (_) {
    cfg = {};
  }
  cfg.icon = cfg.icon || '📊';
  cfg.width = cfg.width || 110;
  await knex('table_columns')
    .where({ id: existing.id })
    .update({
      type: 'text',
      config: JSON.stringify(cfg),
      updated_at: knex.fn.now(),
    });
}

async function backfillProgress(knex) {
  // Bulk load all criteria → group by ticket_id.
  const criteria = await knex('table_rows')
    .where({ table_id: TBL_BDD_CRITERIA })
    .select('id', 'data');

  const criteriaByTicket = new Map();
  let mustWithoutTicket = 0;
  for (const row of criteria) {
    const data = row.data || {};
    const tid = data.ticket_id;
    if (tid == null || tid === '') {
      if (data.priority === 'must') mustWithoutTicket += 1;
      continue;
    }
    if (data.priority !== 'must') continue;
    const key = Number(tid);
    if (!Number.isFinite(key) || key <= 0) continue;
    if (!criteriaByTicket.has(key)) criteriaByTicket.set(key, []);
    criteriaByTicket.get(key).push({
      id: row.id,
      status: data.status || null,
    });
  }

  const tickets = await knex('table_rows')
    .where({ table_id: TBL_TICKETS })
    .select('id', 'data');

  const stats = {
    tickets_total: tickets.length,
    tickets_updated: 0,
    tickets_unchanged: 0,
    tickets_with_must: criteriaByTicket.size,
    must_criteria_total: criteria.length,
    must_orphan_no_ticket: mustWithoutTicket,
    done_with_unverified: [],
  };

  for (const row of tickets) {
    const data = row.data || {};
    const { progress, must_total, must_verified } = progressFor(row.id, criteriaByTicket);
    const sameProgress = data.criteria_progress === progress;
    const sameTotal = Number(data.must_total ?? 0) === must_total;
    const sameVerified = Number(data.must_verified ?? 0) === must_verified;
    if (sameProgress && sameTotal && sameVerified) {
      stats.tickets_unchanged += 1;
      continue;
    }
    const next = {
      ...data,
      criteria_progress: progress,
      must_total,
      must_verified,
    };
    await knex('table_rows')
      .where({ id: row.id })
      .update({ data: next, updated_at: knex.fn.now() });
    stats.tickets_updated += 1;

    // Surface tickets already in `done` whose Must criteria are NOT all
    // verified — these would have been blocked under Phase 3 rules. We do
    // NOT auto-revert them; they are reported for human triage.
    if (Number(data.state) === STATE_DONE && must_total > 0 && must_verified < must_total) {
      stats.done_with_unverified.push({
        ticket_id: row.id,
        progress,
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
  const dir = path.join(PROJECT_ROOT, 'docs', '.snapshots', 'migration-reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `adr-0002-phase3-progress-backfill-${ts}.md`);
  const lines = [
    '# ADR-0002 §8 Phase 3 — criteria_progress backfill report',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Tickets total: **${stats.tickets_total}**`,
    `- Tickets updated: **${stats.tickets_updated}**`,
    `- Tickets unchanged (already correct): **${stats.tickets_unchanged}**`,
    `- Tickets with at least one Must criterion: **${stats.tickets_with_must}**`,
    `- bdd_criteria rows scanned: **${stats.must_criteria_total}**`,
    `- Must criteria without ticket_id (orphan): **${stats.must_orphan_no_ticket}**`,
    `- Tickets already in 'done' with un-verified Must criteria: **${stats.done_with_unverified.length}**`,
    '',
  ];
  if (stats.done_with_unverified.length) {
    lines.push('## Tickets in `done` with unverified Must criteria (Phase 3 retroactive triage)');
    lines.push('');
    lines.push('| ticket_id | progress |');
    lines.push('|---|---|');
    for (const t of stats.done_with_unverified) {
      lines.push(`| ${t.ticket_id} | ${t.progress} |`);
    }
    lines.push('');
  }
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

export async function up(knex) {
  await ensureCriteriaProgressColumn(knex);
  const stats = await backfillProgress(knex);
  let reportPath = null;
  try {
    reportPath = writeReport(stats);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[050] backfill report write failed:', err.message);
  }
  // eslint-disable-next-line no-console
  console.log(
    `[050] criteria_progress backfill complete: ` +
      `tickets=${stats.tickets_total} updated=${stats.tickets_updated} ` +
      `with_must=${stats.tickets_with_must} ` +
      `done_with_unverified=${stats.done_with_unverified.length} ` +
      `report=${reportPath || '(not written)'}`
  );
}

export async function down(knex) {
  // Strip the derived fields from every ticket row. Safe because the values
  // are computed on every criterion mutation; nothing depends on their
  // presence beyond the badge UI (which falls back to '—' when absent).
  await knex.raw(
    `UPDATE table_rows
        SET data = (data - 'criteria_progress' - 'must_total' - 'must_verified')
      WHERE table_id = ?
        AND (data \\? 'criteria_progress'
             OR data \\? 'must_total'
             OR data \\? 'must_verified')`,
    [TBL_TICKETS]
  );
  // We do NOT drop the table_columns row — it predates this migration.
}
