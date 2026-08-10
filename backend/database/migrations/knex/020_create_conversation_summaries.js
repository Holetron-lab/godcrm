/**
 * Migration 020: Create conversation_summaries (ADR-024 Phase 2)
 * 
 * This table stores AI-generated summaries of conversation chunks
 * for efficient context loading in infinite chat.
 * 
 * Instead of loading all messages, the AI can:
 * 1. Load summaries of old chunks
 * 2. Load only recent messages in full
 * 
 * This dramatically reduces token usage for long conversations.
 */

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  // ========================================
  // CONVERSATION_SUMMARIES TABLE
  // ========================================
  await knex.schema.createTable('conversation_summaries', (table) => {
    table.increments('id').primary();
    
    // Parent conversation (cascade delete)
    table.integer('conversation_id').unsigned().notNullable()
      .references('id').inTable('conversations').onDelete('CASCADE');
    
    // Chunk identification
    table.integer('chunk_number').notNullable();  // 1, 2, 3... (порядок chunks)
    
    // Message range this summary covers
    table.integer('messages_start_id').notNullable();  // первое сообщение в chunk
    table.integer('messages_end_id').notNullable();    // последнее сообщение в chunk
    table.integer('messages_count').notNullable();     // сколько сообщений суммаризовано
    
    // AI-generated summary
    table.text('summary').notNullable();             // "User обсуждал баг в логине..."
    table.string('summary_model', 100);              // gpt-4o, claude-3, etc.
    
    // Metadata
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    // Unique constraint: one summary per (conversation, chunk_number)
    table.unique(['conversation_id', 'chunk_number']);
  });

  // Index for fast lookup by conversation
  await knex.schema.alterTable('conversation_summaries', (table) => {
    table.index('conversation_id', 'idx_summaries_conversation');
  });
  
  console.log('✅ Migration 020: Created conversation_summaries table');
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('conversation_summaries');
  console.log('🗑️ Migration 020: Dropped conversation_summaries table');
}
