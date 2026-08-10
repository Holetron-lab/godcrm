// @vitest-environment node
/**
 * ADR-0040 Phase 0 — SecretsVault tests.
 *
 * HARD GATE per ticket T-140011: tests precede implementation, never run on
 * PROD DB (ADR-0009). Boot guard at backend/test/setup.js — re-imported here
 * for direct `vitest run <file>` safety.
 *
 * Coverage maps 1:1 to ticket acceptance criteria:
 *   AC1 — migration creates _secrets with all columns + unique key index
 *   AC2 — putSecret stores AES-GCM v:1 blob, never plaintext
 *   AC3 — getSecret round-trips; cache hit avoids DB on repeat
 *   AC5 — cache eviction via pg_notify('secrets_changed', ...)
 *   AC6 — .env fallback in dev when master key absent (WARN once)
 *   AC4 — fail-fast in prod when master key absent (subprocess assertion)
 */

import './../../../test/setup.js';
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Vault key for the test run. Real env (.env.test or CLI override) takes precedence.
if (!process.env.SECRETS_MASTER_KEY) {
  process.env.SECRETS_MASTER_KEY = crypto.randomBytes(32).toString('hex');
}

// Lazy import after env is primed.
const { PostgresAdapter } = await import('../../../database/adapters/PostgresAdapter.js');

const TABLE = '_secrets';

/**
 * Spin up a dedicated adapter so we control the lifecycle from the test.
 * Reuses POSTGRES_* from process.env — boot guard already verified DB ≠ prod.
 */
async function makeAdapter() {
  const adapter = new PostgresAdapter({});
  await adapter.initialize();
  return adapter;
}

/** Apply ADR-0040 migration manually so the test is self-contained. */
async function applyMigration(adapter) {
  const migModule = await import('../../../database/migrations/knex/057_adr_0040_phase0_secrets_vault.js');
  // Shim a minimal knex-like surface: { raw, client.config.client }
  const knexShim = {
    client: { config: { client: 'pg' } },
    raw: async (sql, bindings = []) => {
      const result = await adapter.query(sql, bindings);
      return result;
    },
  };
  await migModule.up(knexShim);
}

async function dropTable(adapter) {
  await adapter.query(`DROP TABLE IF EXISTS ${TABLE} CASCADE`);
}

describe('SecretsVault — AC2/AC3/AC5 (integration against godcrm_test)', () => {
  let adapter;
  let vault;

  beforeAll(async () => {
    adapter = await makeAdapter();
    await dropTable(adapter);
    await applyMigration(adapter);
    const mod = await import('../SecretsVault.js');
    vault = mod.default;
    await vault.init({ adapter });
  });

  afterAll(async () => {
    try { await vault.shutdown(); } catch { /* ignore */ }
    try { await dropTable(adapter); } catch { /* ignore */ }
    try { await adapter.close?.(); } catch { /* ignore */ }
  });

  beforeEach(async () => {
    await adapter.query(`TRUNCATE TABLE ${TABLE} RESTART IDENTITY`);
    vault._cache.clear();
  });

  it('AC1: migration creates _secrets with all columns + unique key index', async () => {
    const cols = await adapter.query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = $1 ORDER BY ordinal_position`,
      [TABLE]
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toEqual(expect.arrayContaining([
      'id', 'key', 'encrypted_payload', 'description',
      'created_by', 'created_at', 'updated_at',
      'last_revealed_at', 'last_revealed_by',
    ]));

    const idx = await adapter.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = $1`,
      [TABLE]
    );
    const hasUniqueKey = idx.rows.some((r) =>
      /UNIQUE/i.test(r.indexdef) && /\(key\)/.test(r.indexdef)
    );
    expect(hasUniqueKey).toBe(true);
  });

  it('AC2: putSecret stores v:1 AES-GCM blob — never plaintext at rest', async () => {
    await vault.putSecret('TEST_TOKEN', 'super-secret-value', { actor: 1 });
    const row = await adapter.query(
      `SELECT encrypted_payload FROM ${TABLE} WHERE key = $1`,
      ['TEST_TOKEN']
    );
    expect(row.rowCount).toBe(1);
    const payload = row.rows[0].encrypted_payload;
    expect(payload.v).toBe(1);
    expect(typeof payload.iv).toBe('string');
    expect(typeof payload.tag).toBe('string');
    expect(typeof payload.ct).toBe('string');
    expect(JSON.stringify(payload)).not.toContain('super-secret-value');
  });

  it('AC3: getSecret round-trips plaintext; second call is a cache hit', async () => {
    await vault.putSecret('CACHED', 'hello-cache', { actor: 1 });

    const first = await vault.getSecret('CACHED');
    expect(first).toBe('hello-cache');

    // Spy on adapter.query to verify the second call does NOT hit DB.
    const spy = vi.spyOn(adapter, 'query');
    const second = await vault.getSecret('CACHED');
    expect(second).toBe('hello-cache');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('AC3: getSecret returns null for unknown key', async () => {
    const val = await vault.getSecret('DOES_NOT_EXIST_KEY_XYZ');
    expect(val).toBeNull();
  });

  it('AC5: pg_notify("secrets_changed", key) evicts the cache entry', async () => {
    await vault.putSecret('NOTIFY_KEY', 'v1-value', { actor: 1 });
    expect(await vault.getSecret('NOTIFY_KEY')).toBe('v1-value');
    expect(vault._cache.has('NOTIFY_KEY')).toBe(true);

    // Simulate out-of-band update by another process, then NOTIFY.
    const newBlob = vault._encrypt('v2-value');
    await adapter.query(
      `UPDATE ${TABLE} SET encrypted_payload = $1, updated_at = NOW() WHERE key = $2`,
      [JSON.stringify(newBlob), 'NOTIFY_KEY']
    );
    await adapter.query(`SELECT pg_notify('secrets_changed', $1)`, ['NOTIFY_KEY']);

    // Wait for LISTEN async dispatch.
    await new Promise((r) => setTimeout(r, 200));
    expect(vault._cache.has('NOTIFY_KEY')).toBe(false);

    const v2 = await vault.getSecret('NOTIFY_KEY');
    expect(v2).toBe('v2-value');
  });

  it('revealSecret writes audit fields + returns plaintext', async () => {
    await vault.putSecret('AUDIT', 'reveal-me', { actor: 1 });
    const before = await adapter.query(
      `SELECT last_revealed_at, last_revealed_by FROM ${TABLE} WHERE key = $1`,
      ['AUDIT']
    );
    expect(before.rows[0].last_revealed_at).toBeNull();

    const plain = await vault.revealSecret('AUDIT', { actor: 42 });
    expect(plain).toBe('reveal-me');

    const after = await adapter.query(
      `SELECT last_revealed_at, last_revealed_by FROM ${TABLE} WHERE key = $1`,
      ['AUDIT']
    );
    expect(after.rows[0].last_revealed_at).not.toBeNull();
    expect(Number(after.rows[0].last_revealed_by)).toBe(42);
  });

  it('deleteSecret removes the row + evicts cache', async () => {
    await vault.putSecret('TO_DELETE', 'gone-soon', { actor: 1 });
    await vault.getSecret('TO_DELETE'); // warm cache
    expect(vault._cache.has('TO_DELETE')).toBe(true);

    await vault.deleteSecret('TO_DELETE', { actor: 1 });
    expect(vault._cache.has('TO_DELETE')).toBe(false);

    const row = await adapter.query(`SELECT 1 FROM ${TABLE} WHERE key = $1`, ['TO_DELETE']);
    expect(row.rowCount).toBe(0);
  });

  // Regression for the stale-singleton bug (ADR-0040): the vault is a
  // process-wide module singleton. An out-of-band shutdown() (graceful-shutdown
  // path, or an in-process lifecycle that tears it down) leaves _initialized
  // false. Pre-fix, getSecret() then threw 'init() not called' → getSecret.js
  // swallowed it to null → secrets WITHOUT an env fallback (bluesky_handle)
  // surfaced as "not configured" until a full process restart. Now, if the
  // vault was ever live, the read transparently re-inits and serves.
  it('self-heals: getSecret re-initializes after an out-of-band shutdown', async () => {
    await vault.putSecret('HEAL_KEY', 'heal-me', { actor: 1 });
    expect(await vault.getSecret('HEAL_KEY')).toBe('heal-me');

    await vault.shutdown();
    expect(vault.health().ok).toBe(false);

    const healed = await vault.getSecret('HEAL_KEY');
    expect(healed).toBe('heal-me');
    expect(vault.health().ok).toBe(true);
  });
});

describe('SecretsVault — AC6 .env fallback (no DB, in-process)', () => {
  it('returns process.env[key] when master key absent + NODE_ENV != production; logs WARN once', async () => {
    // Run in an isolated module subgraph to bypass the singleton already initialized above.
    const savedKey = process.env.SECRETS_MASTER_KEY;
    const savedNodeEnv = process.env.NODE_ENV;
    const savedFallback = process.env.SOME_FALLBACK_TOKEN;
    delete process.env.SECRETS_MASTER_KEY;
    process.env.NODE_ENV = 'development';
    process.env.SOME_FALLBACK_TOKEN = 'env-fallback-value';

    // Fresh module instance via cache-buster query.
    const mod = await import('../SecretsVault.js?fallback');
    const v = mod.default;
    // No adapter — pure env-fallback path.
    await v.init({ adapter: null, allowEnvFallback: true });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const a = await v.getSecret('SOME_FALLBACK_TOKEN');
    const b = await v.getSecret('SOME_FALLBACK_TOKEN');
    expect(a).toBe('env-fallback-value');
    expect(b).toBe('env-fallback-value');

    // WARN logged once (across both reads) — proves the "log WARN once" AC.
    const warnCount = warnSpy.mock.calls.filter((c) =>
      String(c[0] || '').includes('SECRETS_MASTER_KEY')
    ).length;
    expect(warnCount).toBe(1);

    warnSpy.mockRestore();
    await v.shutdown();

    // Restore env.
    if (savedKey) process.env.SECRETS_MASTER_KEY = savedKey;
    process.env.NODE_ENV = savedNodeEnv;
    if (savedFallback !== undefined) {
      process.env.SOME_FALLBACK_TOKEN = savedFallback;
    } else {
      delete process.env.SOME_FALLBACK_TOKEN;
    }
  });
});

describe('SecretsVault — AC4 fail-fast in production (subprocess)', () => {
  it('server boot exits non-zero when NODE_ENV=production and SECRETS_MASTER_KEY missing', () => {
    const script = `
      process.env.NODE_ENV = 'production';
      delete process.env.SECRETS_MASTER_KEY;
      // Stub process.exit so we observe the abort without killing the test child noisily.
      const origExit = process.exit;
      process.exit = (code) => { console.error('VAULT_EXIT:' + code); origExit(code); };
      import('${path.resolve(__dirname, '../SecretsVault.js')}').then(async (m) => {
        try { await m.default.init({ adapter: null }); }
        catch (e) { console.error('VAULT_THROW:' + e.code); process.exit(7); }
      });
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 10000,
    });
    expect(result.status).not.toBe(0);
    // Either explicit exit() or throw — both prove fail-fast wired.
    const combined = (result.stderr || '') + (result.stdout || '');
    expect(combined).toMatch(/VAULT_EXIT:1|VAULT_THROW:SECRETS_MASTER_KEY_MISSING/);
  });
});
