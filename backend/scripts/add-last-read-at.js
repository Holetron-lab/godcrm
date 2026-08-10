/**
 * Migration: Add last_read_at column to conversation_participants
 * For tracking unread messages
 */
import { dbRun } from '../database/connection.js';
import { isPostgres } from '../database/connection.js';

async function migrate() {
  console.log('Adding last_read_at column to conversation_participants...');
  
  try {
    if (isPostgres()) {
      await dbRun(`
        ALTER TABLE conversation_participants 
        ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMP
      `);
    } else {
      // SQLite: check if column exists first
      try {
        await dbRun(`ALTER TABLE conversation_participants ADD COLUMN last_read_at TEXT`);
      } catch (e) {
        if (!e.message.includes('duplicate column')) {
          throw e;
        }
        console.log('Column already exists');
      }
    }
    console.log('✅ Migration complete');
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

migrate();
