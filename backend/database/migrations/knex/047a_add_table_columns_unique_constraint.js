// backend/database/migrations/knex/047a_add_table_columns_unique_constraint.js
//
// ADR-187 §Finding #1 — from-scratch migration break (Track 1 finding #1,
// same drift class as ADR-183 Block B).
//
// Migration 006 creates `table_columns` WITHOUT a `unique_constraint` column,
// but migration 048 (adr_0002_phase1_bdd_relations) inserts rows carrying
// `unique_constraint: 0`. On master A the column exists via hand-applied DDL
// drift, so 048 succeeds there — but every fresh box, CI run, and from-scratch
// rebuild dies at 048 ("column unique_constraint does not exist") because no
// migration ever created it.
//
// This migration creates the missing column so `run-migrations.mjs` reaches
// 048+ cleanly on an empty DB. Ordered `047a` to sort AFTER
// `047_widgets_is_template` and BEFORE `048_adr_0002_phase1_bdd_relations`
// (knex sorts migrations lexically by filename: `047_` < `047a` < `048`).
//
// Shape matches master A exactly (information_schema: integer, DEFAULT 0,
// nullable). `IF NOT EXISTS` keeps it idempotent — a no-op on any DB that
// already carries the column via drift (master A, godcrm_test) so knex can
// safely record it there without faulting.
export async function up(knex) {
  await knex.raw(
    'ALTER TABLE table_columns ADD COLUMN IF NOT EXISTS unique_constraint integer DEFAULT 0'
  );
}

export async function down(knex) {
  await knex.raw('ALTER TABLE table_columns DROP COLUMN IF EXISTS unique_constraint');
}
