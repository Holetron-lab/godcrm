// backend/database/migrations/knex/009_create_chat_system.js
// Chat System: Threads, Participants, Messages
export async function up(knex) {
  // Chat Threads
  await knex.schema.createTable('chat_threads', (table) => {
    table.increments('id').primary();
    table.string('thread_id', 255).unique().notNullable();
    table.string('type', 50).defaultTo('direct');
    table.string('name', 255);
    table.text('encrypted_with_keys').notNullable();
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.index('thread_id');
    table.index('type');
  });

  // Chat Participants
  await knex.schema.createTable('chat_participants', (table) => {
    table.increments('id').primary();
    table.integer('thread_id').unsigned().notNullable()
      .references('id').inTable('chat_threads').onDelete('CASCADE');
    table.integer('user_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.timestamp('joined_at').defaultTo(knex.fn.now());
    
    table.unique(['thread_id', 'user_id']);
    table.index('thread_id');
    table.index('user_id');
  });

  // Chat Messages
  await knex.schema.createTable('chat_messages', (table) => {
    table.increments('id').primary();
    table.integer('thread_id').unsigned().notNullable()
      .references('id').inTable('chat_threads').onDelete('CASCADE');
    table.integer('sender_id').unsigned().notNullable()
      .references('id').inTable('users').onDelete('CASCADE');
    table.text('content_encrypted').notNullable();
    table.string('encryption_method', 50).defaultTo('user_key');
    
    table.timestamp('created_at').defaultTo(knex.fn.now());
    
    table.index('thread_id');
    table.index('sender_id');
    table.index('created_at');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('chat_messages');
  await knex.schema.dropTableIfExists('chat_participants');
  await knex.schema.dropTableIfExists('chat_threads');
}
