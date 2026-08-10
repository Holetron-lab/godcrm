// backend/database/migrations/knex/001_create_users.js
// Core table: Users with encryption support
export async function up(knex) {
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('email', 255).notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table.string('name', 255).notNullable();
    table.string('avatar', 500);
    table.string('role', 50).defaultTo('user');
    
    // Encryption keys
    table.text('encryption_key_encrypted').notNullable();
    
    // 2FA
    table.string('totp_secret', 255);
    table.boolean('totp_enabled').defaultTo(false);
    table.string('email_verification_code', 255);
    table.boolean('email_verified').defaultTo(false);
    
    // Timestamps
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    // Indexes
    table.index('email');
    table.index('role');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('users');
}
