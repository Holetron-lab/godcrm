// Per-user accent colour picked next to the avatar in Settings → Profile.
// Human users store it here; agent users keep their colour on the agent row
// (table_rows.data->>'color') so the space's Agents table stays the source of
// truth, and readers COALESCE(row colour, users.color).
export async function up(knex) {
  await knex.raw('ALTER TABLE users ADD COLUMN IF NOT EXISTS color TEXT');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE users DROP COLUMN IF EXISTS color');
}
