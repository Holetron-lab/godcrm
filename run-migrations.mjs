import knex from 'knex';
import path from 'path';
import { fileURLToPath } from 'url';
import { moduleMigrationDirs } from './backend/modules/loader.js'; // MODULE-CONTRACT v1: pick up module-owned migrations

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const db = knex({
  client: 'pg',
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'godcrm_prod',
    user: process.env.POSTGRES_USER || 'godcrm',
    password: process.env.POSTGRES_PASSWORD || 'godcrm_dev_2026'
  },
  migrations: {
    directory: [path.join(__dirname, 'backend/database/migrations/knex'), ...moduleMigrationDirs()]
  }
});

console.log('Running migrations for database:', process.env.POSTGRES_DB || 'godcrm_prod');

try {
  const [batch, migrations] = await db.migrate.latest();
  console.log('Batch:', batch);
  console.log('Migrations applied:', migrations.length ? migrations : 'None (already up to date)');
} catch (err) {
  console.error('Migration error:', err.message);
  process.exit(1);
} finally {
  await db.destroy();
}
