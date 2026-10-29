// Shared guard for suites that touch `_secrets` on godcrm_test (ADR-0009).
//
// Two of them (SecretsVault, getSecret) DROP and recreate the table in
// beforeAll, and every one wipes rows in beforeEach. vitest runs files in
// parallel, so without coordination a sibling suite sees "relation _secrets
// does not exist", a half-applied migration or its own rows gone. A session
// advisory lock held on a dedicated connection serialises exactly these suites
// and nothing else.
import { PostgresAdapter } from '../../database/adapters/PostgresAdapter.js';

const LOCK_NAME = 'godcrm-test:_secrets-suite';

/**
 * Block until this process owns the `_secrets` suite lock.
 * @returns {Promise<() => Promise<void>>} release — call it in afterAll.
 */
export async function lockSecretsSuite() {
  const adapter = new PostgresAdapter({});
  await adapter.initialize();
  const client = await adapter.pool.connect();
  await client.query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_NAME]);
  return async () => {
    try { await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_NAME]); }
    finally {
      client.release();
      try { await adapter.close?.(); } catch { /* ignore */ }
    }
  };
}

/** Apply the vault migrations (057 + 093) when a previous suite left no `_secrets` behind. */
export async function ensureSecretsTable(adapter) {
  const rel = await adapter.query(`SELECT to_regclass('public._secrets') AS r`);
  const knexShim = {
    client: { config: { client: 'pg' } },
    raw: async (sql, bindings = []) => adapter.query(sql, bindings),
  };
  if (rel.rows[0]?.r == null) {
    const base = await import('../../database/migrations/knex/057_adr_0040_phase0_secrets_vault.js');
    await base.up(knexShim);
  }
  const scoped = await import('../../database/migrations/knex/093_space_secrets.js');
  await scoped.up(knexShim);
}
