// backend/database/migrations/knex/051_adr_0002_phase4_ticket_seal.js
// ADR-0002 §8 Phase 4 — Ticket seal (TOTP-act).
//
// Acceptance:
//   A4.1 (Must) — Tickets (table_id=1708) gains 3 columns:
//                 sealed_at  (datetime, nullable),
//                 sealed_by  (relation → Users 1782, nullable),
//                 seal_proof (text — TOTP hash, nullable).
//                 Storage architecture: dynamic tables live in `table_rows.data`
//                 (JSONB), `table_columns` row holds the metadata. We follow
//                 precedent set by migration 048 for the bdd_spec_id relation.
//   A4.2 (Must) — `ticket_seal_verification` logical table exists in space 11
//                 (project_id=5102, same as bdd_* tables) with columns mirroring
//                 the BDD audit shape:
//                   ticket_id   (relation → Tickets 1708),
//                   user_id     (number  — auth users.id, NOT the dynamic 1782),
//                   totp_proof  (text — sha256 hash of code+salt),
//                   verified_at (datetime),
//                   action      (select: sealed | broken),
//                   reason      (text, nullable — un-seal motivation),
//                   ip          (text, nullable — request IP for audit).
//                 One audit row per seal/un-seal event (append-only).
//
// Phase 4 NOTE: this migration ONLY adds metadata + logical table. The actual
// `Tickets.sealed_*` writes come through POST /api/v3/tickets/:id/seal which
// itself writes the audit row. F1–F8 row-lock enforcement is Phase 5 (separate).

const TBL_TICKETS = 1708;
const TBL_USERS_DYNAMIC = 1782; // relation target for sealed_by (dynamic Users tbl)
const SPACE_BDD_PROJECT_ID = 5102; // bdd_* tables project, space 11

const RELATION_INDICATOR = { type: 'emoji', value: '🔣' };

function sealedByConfig() {
  return {
    appearance: { align: 'left', indicator: RELATION_INDICATOR },
    relation: {
      enabled: true,
      tableId: String(TBL_USERS_DYNAMIC),
      valueColumn: 'id',
      labelColumn: 'name',
    },
  };
}

async function ensureTicketColumn(knex, name, type, config, displayName) {
  const existing = await knex('table_columns')
    .where({ table_id: TBL_TICKETS, column_name: name })
    .first();
  if (existing) return existing;

  const maxOrder = await knex('table_columns')
    .where({ table_id: TBL_TICKETS })
    .max({ m: 'order_index' })
    .first();
  const nextOrder = (maxOrder?.m ?? 0) + 1;

  const [row] = await knex('table_columns')
    .insert({
      table_id: TBL_TICKETS,
      column_name: name,
      display_name: displayName,
      type,
      config: config ? JSON.stringify(config) : null,
      order_index: nextOrder,
      is_visible: 1,
      is_required: 0,
      is_system: 0,
      required: 0,
      unique_constraint: 0,
    })
    .returning('*');
  return row;
}

async function ensureSealVerificationTable(knex) {
  // Idempotent: check by (project_id, name) within space 11's BDD project.
  const existing = await knex('universal_tables')
    .where({ project_id: SPACE_BDD_PROJECT_ID, name: 'ticket_seal_verification' })
    .first();
  if (existing) return existing.id;

  const [tbl] = await knex('universal_tables')
    .insert({
      project_id: SPACE_BDD_PROJECT_ID,
      name: 'ticket_seal_verification',
      description:
        'ADR-0002 §8 Phase 4 — append-only audit of ticket seal/unseal acts ' +
        '(TOTP-signed). Mirrors criterion-level bdd_audit_log.',
      icon: '🔒',
    })
    .returning('*');

  const tableId = tbl.id;

  // Define columns in a stable order. order_index is 1-based.
  const cols = [
    {
      column_name: 'ticket_id',
      display_name: 'Ticket',
      type: 'select',
      config: {
        appearance: { align: 'left', indicator: RELATION_INDICATOR },
        relation: {
          enabled: true,
          tableId: String(TBL_TICKETS),
          valueColumn: 'id',
          labelColumn: 'title',
        },
      },
      is_required: 1,
      required: 1,
    },
    {
      column_name: 'user_id',
      display_name: 'User',
      type: 'number',
      // NB: this references auth `users.id` (not the dynamic Users table 1782) —
      // we want the human who performed the act, which JWT carries as users.id.
      config: { appearance: { align: 'left' } },
      is_required: 1,
      required: 1,
    },
    {
      column_name: 'totp_proof',
      display_name: 'TOTP proof (sha256)',
      type: 'text',
      config: null,
      is_required: 0,
      required: 0,
    },
    {
      column_name: 'verified_at',
      display_name: 'Verified at',
      type: 'datetime',
      config: null,
      is_required: 1,
      required: 1,
    },
    {
      column_name: 'action',
      display_name: 'Action',
      type: 'select',
      config: {
        options: [
          { value: 'sealed', label: 'sealed', color: '#10b981' },
          { value: 'broken', label: 'broken', color: '#ef4444' },
        ],
      },
      is_required: 1,
      required: 1,
    },
    {
      column_name: 'reason',
      display_name: 'Reason',
      type: 'text',
      config: null,
      is_required: 0,
      required: 0,
    },
    {
      column_name: 'ip',
      display_name: 'Client IP',
      type: 'text',
      config: null,
      is_required: 0,
      required: 0,
    },
  ];

  for (let i = 0; i < cols.length; i += 1) {
    const c = cols[i];
    await knex('table_columns').insert({
      table_id: tableId,
      column_name: c.column_name,
      display_name: c.display_name,
      type: c.type,
      config: c.config ? JSON.stringify(c.config) : null,
      order_index: i + 1,
      is_visible: 1,
      is_required: c.is_required,
      is_system: 0,
      required: c.required,
      unique_constraint: 0,
    });
  }

  return tableId;
}

export async function up(knex) {
  // 1. A4.1 — Tickets columns
  await ensureTicketColumn(
    knex,
    'sealed_at',
    'datetime',
    { appearance: { align: 'left' } },
    'Sealed at',
  );
  await ensureTicketColumn(
    knex,
    'sealed_by',
    'select',
    sealedByConfig(),
    'Sealed by',
  );
  await ensureTicketColumn(
    knex,
    'seal_proof',
    'text',
    { appearance: { align: 'left' } },
    'Seal proof',
  );

  // 2. A4.2 — ticket_seal_verification logical table
  const tableId = await ensureSealVerificationTable(knex);
  // eslint-disable-next-line no-console
  console.log(
    `[051] ticket_seal_verification ready: table_id=${tableId} ` +
      `(Tickets sealed_at/sealed_by/seal_proof metadata in place)`,
  );
}

export async function down(knex) {
  // Drop Tickets seal columns (metadata + JSONB keys).
  for (const name of ['sealed_at', 'sealed_by', 'seal_proof']) {
    await knex('table_columns')
      .where({ table_id: TBL_TICKETS, column_name: name })
      .del();
    // jsonb '?' operator must be escaped as '\?' for knex.raw bind parser.
    await knex.raw(
      `UPDATE table_rows SET data = data - ? WHERE table_id = ${TBL_TICKETS} AND data \\? ?`,
      [name, name],
    );
  }

  // Drop ticket_seal_verification table + its rows/columns.
  const tbl = await knex('universal_tables')
    .where({ project_id: SPACE_BDD_PROJECT_ID, name: 'ticket_seal_verification' })
    .first();
  if (tbl) {
    await knex('table_rows').where({ table_id: tbl.id }).del();
    await knex('table_columns').where({ table_id: tbl.id }).del();
    await knex('universal_tables').where({ id: tbl.id }).del();
  }
}
