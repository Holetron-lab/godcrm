import knex from 'knex';
import path from 'path';
import { fileURLToPath } from 'url';
import { moduleMigrationDirs } from './backend/modules/loader.js'; // MODULE-CONTRACT v1: pick up module-owned migrations
import { z } from 'zod';
import { logger } from './backend/utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const selfhost = z.array(z.literal('--selfhost')).max(1).parse(process.argv.slice(2)).length === 1;
if (selfhost) {
  // Explicit target required: self-host must never inherit the legacy prod defaults.
  z.object({ POSTGRES_HOST: z.string().min(1), POSTGRES_DB: z.string().min(1),
    POSTGRES_USER: z.string().min(1), POSTGRES_PASSWORD: z.string().min(1) }).parse(process.env);
}

const db = knex({
  client: 'pg',
  connection: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    database: process.env.POSTGRES_DB || 'godcrm_prod',
    user: process.env.POSTGRES_USER || 'godcrm',
    password: process.env.POSTGRES_PASSWORD || 'CHANGE_ME_LOCAL_DB_PASSWORD'
  },
  migrations: {
    directory: [path.join(__dirname, 'backend/database/migrations/knex'), ...moduleMigrationDirs()]
  }
});

try {
  const snapshot = selfhost || await db.schema.hasTable('selfhost_migrations');
  const hasLedger = await db.schema.hasTable('knex_migrations');
  const hasHistory = hasLedger && Boolean(await db('knex_migrations').first('id'));
  if (snapshot && hasHistory) {
    throw new Error('Self-host snapshot upgrade refuses a non-empty core migration ledger; reconcile this database explicitly.');
  }
  if (!snapshot && !hasHistory && await db.schema.hasTable('users')) {
    throw new Error('Existing schema has no core migration history. For a self-host schema.sql installation run with --selfhost; do not fabricate ledger rows.');
  }
  const [batch, migrations] = await db.migrate.latest(snapshot ? {
    directory: path.join(__dirname, 'deploy/selfhost/migrations'),
    tableName: 'selfhost_migrations',
  } : undefined);
  logger.info({ batch, migrations, selfhost: snapshot }, 'Migrations complete');
} catch (err) {
  logger.error({ err }, 'Migration failed');
  process.exitCode = 1;
} finally {
  await db.destroy();
}
