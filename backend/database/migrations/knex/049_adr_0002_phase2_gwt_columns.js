// backend/database/migrations/knex/049_adr_0002_phase2_gwt_columns.js
// ADR-0002 §8 Phase 2 (G7.1 — soft deprecate description).
//
// Acceptance:
//   A2.1 (Must) — bdd_criteria gains 3 nullable text columns: given,
//                 when_clause, then. (`when` is a Postgres reserved word —
//                 column is named `when_clause` deliberately; UI label = "When".)
//   A2.2 (Must) — _columns rows have cellFormat.mode='markdown' and indicator
//                 emoji 📍 / ⚡ / ✅.
//   A2.3 (Must) — bdd-tests-panel renders G/W/T block when any of given|
//                 when_clause|then is non-empty; falls back to legacy
//                 `description` otherwise. (Frontend change.)
//   A2.4 (Must) — new-criterion form shows 4 fields (title + G/W/T); legacy
//                 `description` is hidden via is_visible=0.
//   A2.5 (Must) — TOTP-locked verified rows: writes to G/W/T trigger
//                 guard-violation auto-invalidation (C-4) — given/when_clause/
//                 then added to criterion_verification.guards.
//
// Storage: dynamic tables live in `table_rows.data` (JSONB). No DDL on
// `_data_7256` is needed — adding columns means inserting `_columns` rows.
// `_data_<id>` and `_columns` referenced in the ADR map to:
//   `_data_7256`  -> SELECT FROM table_rows WHERE table_id=7256
//   `_columns`    -> table_columns

const TBL_BDD_CRITERIA = 7256;

const GWT_COLUMNS = [
  {
    column_name: 'given',
    display_name: 'Given',
    indicator_emoji: '📍',
  },
  {
    column_name: 'when_clause',
    display_name: 'When',
    indicator_emoji: '⚡',
  },
  {
    column_name: 'then',
    display_name: 'Then',
    indicator_emoji: '✅',
  },
];

function gwtConfig(emoji) {
  return {
    appearance: { align: 'left', indicator: { type: 'emoji', value: emoji } },
    cellFormat: { mode: 'markdown' },
  };
}

async function shiftOrderIndexFromDescription(knex) {
  // Place G/W/T immediately after `description`. Existing layout:
  //   5 description, 6 status, 7 claimed_at, 8 claimed_by_agent, ...
  // We shift everything with order_index >= 6 by +3 to free slots 6,7,8.
  const description = await knex('table_columns')
    .where({ table_id: TBL_BDD_CRITERIA, column_name: 'description' })
    .first();
  if (!description) return null; // unusual, but don't crash; G/W/T will append
  const baseOrder = description.order_index ?? 5;
  await knex('table_columns')
    .where({ table_id: TBL_BDD_CRITERIA })
    .andWhere('order_index', '>', baseOrder)
    .increment('order_index', 3);
  return baseOrder;
}

async function ensureGwtColumns(knex, baseOrderAfterDescription) {
  for (let i = 0; i < GWT_COLUMNS.length; i += 1) {
    const spec = GWT_COLUMNS[i];
    const existing = await knex('table_columns')
      .where({ table_id: TBL_BDD_CRITERIA, column_name: spec.column_name })
      .first();
    const targetOrder = (baseOrderAfterDescription ?? 99) + 1 + i;
    if (existing) {
      // Refresh metadata to canonical Phase 2 shape.
      await knex('table_columns')
        .where({ id: existing.id })
        .update({
          display_name: spec.display_name,
          type: 'text',
          config: JSON.stringify(gwtConfig(spec.indicator_emoji)),
          order_index: targetOrder,
          is_visible: 1,
          updated_at: knex.fn.now(),
        });
      continue;
    }
    await knex('table_columns').insert({
      table_id: TBL_BDD_CRITERIA,
      column_name: spec.column_name,
      display_name: spec.display_name,
      type: 'text',
      config: JSON.stringify(gwtConfig(spec.indicator_emoji)),
      order_index: targetOrder,
      is_visible: 1,
      is_required: 0,
      is_system: 0,
      required: 0,
      unique_constraint: 0,
    });
  }
}

async function hideLegacyDescription(knex) {
  // A2.4 — legacy `description` hidden from EditRowModal (is_visible filter).
  // Existing rows with non-empty description still render in the panel via
  // the frontend fallback; only the editor field is hidden.
  await knex('table_columns')
    .where({ table_id: TBL_BDD_CRITERIA, column_name: 'description' })
    .update({ is_visible: 0, updated_at: knex.fn.now() });
}

async function addGwtToVerificationGuards(knex) {
  // A2.5 — extend criterion_verification.guards with the three G/W/T column
  // names. enforceVerificationGuards (services/verification/guards.js) uses
  // this list for C-4 auto-invalidation on update of a verified row.
  const verCol = await knex('table_columns')
    .where({ table_id: TBL_BDD_CRITERIA, column_name: 'criterion_verification' })
    .first();
  if (!verCol) return;
  let cfg = {};
  try { cfg = JSON.parse(verCol.config || '{}'); } catch { cfg = {}; }
  const guards = Array.isArray(cfg.guards) ? cfg.guards : [];
  const next = new Set(guards);
  for (const g of ['given', 'when_clause', 'then']) next.add(g);
  cfg.guards = Array.from(next);
  await knex('table_columns')
    .where({ id: verCol.id })
    .update({ config: JSON.stringify(cfg), updated_at: knex.fn.now() });
}

export async function up(knex) {
  const baseOrder = await shiftOrderIndexFromDescription(knex);
  await ensureGwtColumns(knex, baseOrder);
  await hideLegacyDescription(knex);
  await addGwtToVerificationGuards(knex);
  // eslint-disable-next-line no-console
  console.log('[049] ADR-0002 Phase 2 — G/W/T columns added on bdd_criteria (7256)');
}

export async function down(knex) {
  // Drop G/W/T column metadata.
  await knex('table_columns')
    .where({ table_id: TBL_BDD_CRITERIA })
    .whereIn('column_name', ['given', 'when_clause', 'then'])
    .del();

  // Strip G/W/T keys from row data so JSONB stays clean.
  await knex.raw(`
    UPDATE table_rows
       SET data = (data - 'given' - 'when_clause' - 'then')
     WHERE table_id = ?
       AND (data \\? 'given' OR data \\? 'when_clause' OR data \\? 'then')
  `, [TBL_BDD_CRITERIA]);

  // Restore legacy description visibility.
  await knex('table_columns')
    .where({ table_id: TBL_BDD_CRITERIA, column_name: 'description' })
    .update({ is_visible: 1, updated_at: knex.fn.now() });

  // Shift order_index back: collapse the freed +3 gap above description.
  const description = await knex('table_columns')
    .where({ table_id: TBL_BDD_CRITERIA, column_name: 'description' })
    .first();
  if (description) {
    await knex('table_columns')
      .where({ table_id: TBL_BDD_CRITERIA })
      .andWhere('order_index', '>', description.order_index ?? 5)
      .decrement('order_index', 3);
  }

  // Strip G/W/T from criterion_verification.guards.
  const verCol = await knex('table_columns')
    .where({ table_id: TBL_BDD_CRITERIA, column_name: 'criterion_verification' })
    .first();
  if (verCol) {
    let cfg = {};
    try { cfg = JSON.parse(verCol.config || '{}'); } catch { cfg = {}; }
    if (Array.isArray(cfg.guards)) {
      cfg.guards = cfg.guards.filter(g => !['given', 'when_clause', 'then'].includes(g));
    }
    await knex('table_columns')
      .where({ id: verCol.id })
      .update({ config: JSON.stringify(cfg), updated_at: knex.fn.now() });
  }
}
