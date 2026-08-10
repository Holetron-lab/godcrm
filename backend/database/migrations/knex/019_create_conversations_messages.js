/**
 * Migration 019: Create Conversations & Messages (ADR-024)
 * 
 * Messenger-style architecture for AI chat:
 * - conversations: chat sessions with task binding support
 * - messages: individual messages with threading, mentions, FTS
 * - conversation_participants: who is in the chat
 * - message_reactions: emoji reactions
 */

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';

  // ========================================
  // CONVERSATIONS TABLE
  // ========================================
  await knex.schema.createTable('conversations', (table) => {
    table.increments('id').primary();
    
    // Ticket #41154 / ADR-091: Unified type enum [chat, task, row]
    table.string('type', 20).notNullable().defaultTo('chat');
    
    // Basic info
    table.string('title', 255);
    table.text('description');
    
    // Owner (создатель чата)
    table.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
    
    // Space context (опционально)
    table.integer('space_id').unsigned().references('id').inTable('projects').onDelete('CASCADE');
    
    // AI Agent context (для AI чатов)
    table.integer('agent_id');  // ссылка на table_rows где агент
    table.integer('agent_table_id');  // какая таблица
    
    // Task binding (если чат привязан к задаче)
    table.integer('bound_table_id');
    table.integer('bound_row_id');
    
    // Denormalized for performance
    table.integer('last_message_id');
    table.timestamp('last_message_at');
    table.string('last_message_preview', 200);
    table.integer('messages_count').defaultTo(0);
    
    // Settings (JSON/JSONB)
    if (isPostgres) {
      table.jsonb('settings').defaultTo('{}');
    } else {
      table.text('settings').defaultTo('{}');
    }
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Indexes for conversations
  await knex.schema.alterTable('conversations', (table) => {
    table.index('space_id', 'idx_conversations_space');
    table.index('created_by', 'idx_conversations_created_by');
    table.index(['bound_table_id', 'bound_row_id'], 'idx_conversations_bound');
    table.index('type', 'idx_conversations_type');
    table.index('last_message_at', 'idx_conversations_last_message');
  });

  // ========================================
  // MESSAGES TABLE
  // ========================================
  await knex.schema.createTable('messages', (table) => {
    table.increments('id').primary();
    
    // Parent conversation
    table.integer('conversation_id').unsigned().notNullable()
      .references('id').inTable('conversations').onDelete('CASCADE');
    
    // Sender (user or agent)
    table.integer('sender_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    table.string('sender_type', 20).defaultTo('human');  // 'human', 'agent', 'system'
    
    // Content
    table.string('role', 20).notNullable();  // 'user', 'assistant', 'system', 'tool'
    table.text('content').notNullable();
    table.string('content_type', 50).defaultTo('text');  // 'text', 'markdown', 'code', 'image'
    
    // For AI responses
    table.integer('agent_id');
    table.string('model_used', 100);
    table.integer('tokens_in');
    table.integer('tokens_out');
    table.integer('latency_ms');
    
    // Threading (reply to specific message)
    table.integer('parent_id').unsigned().references('id').inTable('messages').onDelete('SET NULL');
    table.integer('reply_count').defaultTo(0);
    
    // Task binding (отдельное сообщение может быть про задачу)
    table.integer('bound_table_id');
    table.integer('bound_row_id');
    
    // Mentions (JSON/JSONB)
    if (isPostgres) {
      table.jsonb('mentions').defaultTo('[]');
    } else {
      table.text('mentions').defaultTo('[]');
    }
    
    // Tool results for agent mode (JSON/JSONB)
    if (isPostgres) {
      table.jsonb('tool_results');
    } else {
      table.text('tool_results');
    }
    
    // Attachments (JSON/JSONB)
    if (isPostgres) {
      table.jsonb('attachments').defaultTo('[]');
    } else {
      table.text('attachments').defaultTo('[]');
    }
    
    // Status
    table.boolean('is_edited').defaultTo(false);
    table.boolean('is_deleted').defaultTo(false);
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });

  // Indexes for messages
  await knex.schema.alterTable('messages', (table) => {
    table.index(['conversation_id', 'created_at'], 'idx_messages_conversation');
    table.index('sender_id', 'idx_messages_sender');
    table.index('parent_id', 'idx_messages_parent');
    table.index(['bound_table_id', 'bound_row_id'], 'idx_messages_bound');
  });

  // PostgreSQL-specific: GIN index for JSONB mentions and full-text search
  if (isPostgres) {
    await knex.raw(`
      CREATE INDEX idx_messages_mentions ON messages USING GIN(mentions);
    `);
    
    await knex.raw(`
      CREATE INDEX idx_messages_content_fts ON messages 
      USING GIN(to_tsvector('russian', content));
    `);
  }

  // ========================================
  // CONVERSATION PARTICIPANTS TABLE
  // ========================================
  await knex.schema.createTable('conversation_participants', (table) => {
    table.increments('id').primary();
    
    table.integer('conversation_id').unsigned().notNullable()
      .references('id').inTable('conversations').onDelete('CASCADE');
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    
    // Role in conversation
    table.string('role', 20).defaultTo('member');  // 'owner', 'admin', 'member', 'viewer'
    
    // User type (для различия agent-users)
    table.string('user_type', 20).defaultTo('human');  // 'human', 'agent', 'bot'
    
    // Read status
    table.integer('last_read_message_id');
    table.integer('unread_count').defaultTo(0);
    
    // Notifications
    table.boolean('is_muted').defaultTo(false);
    
    table.timestamp('joined_at').defaultTo(knex.fn.now());
    
    table.unique(['conversation_id', 'user_id']);
  });

  await knex.schema.alterTable('conversation_participants', (table) => {
    table.index('user_id', 'idx_participants_user');
    table.index('conversation_id', 'idx_participants_conversation');
  });

  // ========================================
  // MESSAGE REACTIONS TABLE
  // ========================================
  await knex.schema.createTable('message_reactions', (table) => {
    table.increments('id').primary();
    
    table.integer('message_id').unsigned().notNullable()
      .references('id').inTable('messages').onDelete('CASCADE');
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    
    table.string('emoji', 10).notNullable();  // '👍', '❤️', '🎉', etc.
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.unique(['message_id', 'user_id', 'emoji']);
  });

  await knex.schema.alterTable('message_reactions', (table) => {
    table.index('message_id', 'idx_reactions_message');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('message_reactions');
  await knex.schema.dropTableIfExists('conversation_participants');
  await knex.schema.dropTableIfExists('messages');
  await knex.schema.dropTableIfExists('conversations');
}
