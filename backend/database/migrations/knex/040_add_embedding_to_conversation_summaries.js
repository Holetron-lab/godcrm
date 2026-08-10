/**
 * Migration 040: Add embedding columns to conversation_summaries
 * ADR-110 AC9: Vector embedding for semantic search of summaries
 *
 * Adds:
 * - embedding: JSONB array of floats (embedding vector)
 * - embedding_model: VARCHAR(100) - which model generated the embedding
 */

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  if (isPostgres) {
    // Check if columns already exist
    const hasEmbedding = await knex.schema.hasColumn('conversation_summaries', 'embedding');
    if (!hasEmbedding) {
      await knex.schema.alterTable('conversation_summaries', (table) => {
        table.jsonb('embedding').nullable();
        table.string('embedding_model', 100).nullable();
      });
    }
  } else {
    // SQLite
    const hasEmbedding = await knex.schema.hasColumn('conversation_summaries', 'embedding');
    if (!hasEmbedding) {
      await knex.schema.alterTable('conversation_summaries', (table) => {
        table.text('embedding').nullable();
        table.string('embedding_model', 100).nullable();
      });
    }
  }
}

export async function down(knex) {
  const hasEmbedding = await knex.schema.hasColumn('conversation_summaries', 'embedding');
  if (hasEmbedding) {
    await knex.schema.alterTable('conversation_summaries', (table) => {
      table.dropColumn('embedding');
      table.dropColumn('embedding_model');
    });
  }
}
