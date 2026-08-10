// Migration: Add access_control to table_columns
// Adds column permissions and user access control

export async function up(db) {
  console.log('📦 Migration 003: Adding access_control to table_columns...');

  // Add access_control column to table_columns
  await db.run(`
    ALTER TABLE table_columns 
    ADD COLUMN access_control TEXT DEFAULT NULL
  `);

  console.log('✅ Added access_control column to table_columns');
  
  // The access_control column will store JSON:
  // {
  //   "users_table_id": 123,  // ID of the users table in the space
  //   "read_users": [1, 2, 3], // Row IDs from users table who can read
  //   "write_users": [1, 2]    // Row IDs from users table who can write
  // }
  
  console.log('✅ Migration 003 completed');
}

export async function down(db) {
  console.log('⏮️ Rollback: Removing access_control from table_columns...');
  
  // SQLite doesn't support DROP COLUMN directly
  // Would need to recreate table without the column
  console.log('⚠️ Rollback not implemented for SQLite ALTER TABLE DROP COLUMN');
}
