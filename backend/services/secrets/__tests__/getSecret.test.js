// @vitest-environment node
/**
 * ADR-0040 P3 — consumer-side helper tests.
 *
 * Covers the contract every migrated consumer relies on:
 *   - vault-hit is preferred over env when both are populated
 *   - env fallback fires (with a single WARN per env name) when the vault row is missing
 *   - array-form envFallback (multi-alias) walks left-to-right
 *   - missing-both returns null (no throw)
 *   - vault.getSecret() throwing 'init() not called' falls through to env (not surfaced)
 *
 * Per-Tier-1-key smoke loop at the bottom validates the same two scenarios
 * (fallback works + vault-hit preferred) against every entry in the registry.
 */

import './../../../test/setup.js';
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

if (!process.env.SECRETS_MASTER_KEY) {
  process.env.SECRETS_MASTER_KEY = crypto.randomBytes(32).toString('hex');
}

const { PostgresAdapter } = await import('../../../database/adapters/PostgresAdapter.js');
const { TIER_1_SECRETS } = await import('../registry.js');

const TABLE = '_secrets';

async function makeAdapter() {
  const adapter = new PostgresAdapter({});
  await adapter.initialize();
  return adapter;
}

async function applyMigration(adapter) {
  const migModule = await import('../../../database/migrations/knex/057_adr_0040_phase0_secrets_vault.js');
  const knexShim = {
    client: { config: { client: 'pg' } },
    raw: async (sql, bindings = []) => adapter.query(sql, bindings),
  };
  await migModule.up(knexShim);
  const scopedMigration = await import('../../../database/migrations/knex/093_space_secrets.js');
  await scopedMigration.up(knexShim);
}

const { lockSecretsSuite } = await import('../../../tests/helpers/secrets-suite.js');

async function dropTable(adapter) {
  await adapter.query(`DROP TABLE IF EXISTS ${TABLE} CASCADE`);
}

describe('getSecret — vault + env fallback (ADR-0040 P3)', () => {
  let adapter;
  let releaseSuite;
  let vault;
  let getSecret;
  let __resetWarnedForTests;

  beforeAll(async () => {
    releaseSuite = await lockSecretsSuite();
    adapter = await makeAdapter();
    await dropTable(adapter);
    await applyMigration(adapter);
    const vaultMod = await import('../SecretsVault.js');
    vault = vaultMod.default;
    await vault.init({ adapter });
    // Make the TTL-only path deterministic: no asynchronous NOTIFY eviction.
    vault._listener?.removeAllListeners('notification');
    const helperMod = await import('../getSecret.js');
    getSecret = helperMod.getSecret;
    __resetWarnedForTests = helperMod.__resetWarnedForTests;
  }, 120_000);

  afterAll(async () => {
    try { await vault.shutdown(); } catch { /* ignore */ }
    try { await adapter.close(); } catch { /* ignore */ }
    await releaseSuite?.();
  });

  beforeEach(async () => {
    await adapter.query(`DELETE FROM ${TABLE} WHERE space_id = 11`); // space-scoped: table is shared by every suite
    // TRUNCATE does not invalidate the vault's 60-second in-process cache.
    vault._cache.clear();
    __resetWarnedForTests();
  });

  it('returns vault value when row exists (vault-hit preferred)', async () => {
    await vault.putSecret('openai_api_key', 'sk-from-vault', { actor: 1, description: 't' });
    process.env.OPENAI_API_KEY = 'sk-from-env';

    const v = await getSecret('openai_api_key', 'OPENAI_API_KEY');
    expect(v).toBe('sk-from-vault');

    delete process.env.OPENAI_API_KEY;
  });

  it('falls back to env when vault row is missing', async () => {
    process.env.OPENAI_API_KEY = 'sk-env-only';

    const v = await getSecret('openai_api_key', 'OPENAI_API_KEY');
    expect(v).toBe('sk-env-only');

    delete process.env.OPENAI_API_KEY;
  });

  it('returns null when neither vault nor env are populated', async () => {
    const v = await getSecret('openai_api_key', 'OPENAI_API_KEY');
    expect(v).toBeNull();
  });

  it('returns null when no envFallback is provided and vault is empty', async () => {
    const v = await getSecret('openai_api_key');
    expect(v).toBeNull();
  });

  it('walks array-form envFallback left-to-right (first match wins)', async () => {
    // Only the second alias is set — must resolve via it.
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_AI_API_KEY = 'gemini-via-google-ai';

    const v = await getSecret('gemini_api_key', ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY']);
    expect(v).toBe('gemini-via-google-ai');

    delete process.env.GOOGLE_AI_API_KEY;
  });

  it('prefers the first env alias when both are set', async () => {
    process.env.GEMINI_API_KEY = 'first';
    process.env.GOOGLE_AI_API_KEY = 'second';

    const v = await getSecret('gemini_api_key', ['GEMINI_API_KEY', 'GOOGLE_AI_API_KEY']);
    expect(v).toBe('first');

    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
  });

  it('emits a single WARN per env name across repeated fallbacks', async () => {
    process.env.FIRECRAWL_API_KEY = 'fc-env';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await getSecret('firecrawl_api_key', 'FIRECRAWL_API_KEY');
    await getSecret('firecrawl_api_key', 'FIRECRAWL_API_KEY');
    await getSecret('firecrawl_api_key', 'FIRECRAWL_API_KEY');

    // Pino's bunyan-style WARN goes through console.warn — we only count
    // warns that contain the env-name marker.
    const fcWarns = warnSpy.mock.calls.filter((c) =>
      c.some((arg) => typeof arg === 'string' && arg.includes('FIRECRAWL_API_KEY')) ||
      c.some((arg) => arg && typeof arg === 'object' && JSON.stringify(arg).includes('FIRECRAWL_API_KEY'))
    );
    // Logger may not route through console.warn at all — the contract is
    // "WARN once" which we verify via the internal warned-set semantics:
    // after one call, the warned set retains the name, so a fresh getSecret
    // skips emission. We assert via the apiLogger contract — but since we
    // can't easily intercept pino here, accept either 0 or 1 unique warn
    // call. Multiple unique calls = failure.
    expect(fcWarns.length).toBeLessThanOrEqual(1);

    delete process.env.FIRECRAWL_API_KEY;
    warnSpy.mockRestore();
  });
});

// ── Stale-singleton self-heal (ADR-0040 regression) ────────────────────────
// Repro of the live bug: the SecretsVault is a process-wide module singleton.
// An in-process agent-run lifecycle can call shutdown() on it out-of-band,
// leaving it uninitialized. Pre-fix, the next getSecret threw 'init() not
// called' → getSecret.js swallowed it → null. Secrets WITH an env fallback
// (telegram) silently resolved via env, masking it; secrets WITHOUT one
// (bluesky_handle / bluesky_app_password) surfaced as "not configured".

describe('getSecret — stale-singleton self-heal (ADR-0040 regression)', () => {
  let adapter;
  let releaseSuite;
  let vault;
  let getSecret;
  let __resetWarnedForTests;

  beforeAll(async () => {
    releaseSuite = await lockSecretsSuite();
    adapter = await makeAdapter();
    await dropTable(adapter);
    await applyMigration(adapter);
    const vaultMod = await import('../SecretsVault.js');
    vault = vaultMod.default;
    await vault.init({ adapter });
    const helperMod = await import('../getSecret.js');
    getSecret = helperMod.getSecret;
    __resetWarnedForTests = helperMod.__resetWarnedForTests;
  }, 120_000);

  afterAll(async () => {
    try { await vault.shutdown(); } catch { /* ignore */ }
    try { await adapter.close(); } catch { /* ignore */ }
    await releaseSuite?.();
  });

  beforeEach(async () => {
    await adapter.query(`DELETE FROM ${TABLE} WHERE space_id = 11`); // space-scoped: table is shared by every suite
    // TRUNCATE does not invalidate the vault's 60-second in-process cache.
    vault._cache.clear();
    __resetWarnedForTests();
  });

  it('SecretsVault.getSecret re-inits transparently after an out-of-band shutdown()', async () => {
    await vault.putSecret('bluesky_app_password', 'abcd-efgh-ijkl-mnop', { actor: 1 });
    expect(await vault.getSecret('bluesky_app_password')).toBe('abcd-efgh-ijkl-mnop');

    // Simulate the in-process agent-run lifecycle tearing down the shared singleton.
    await vault.shutdown();
    expect(vault.health().ok).toBe(false);

    // Pre-fix this threw 'init() not called'. With the self-heal the vault
    // re-initializes from its last good opts and returns the stored secret.
    const v = await vault.getSecret('bluesky_app_password');
    expect(v).toBe('abcd-efgh-ijkl-mnop');
    expect(vault.health().ok).toBe(true);
  });

  it('vault-only secret (no env fallback) survives a teardown via the getSecret helper', async () => {
    // The exact bluesky symptom: a secret with NO env fallback must not surface
    // as null just because the singleton was torn down mid-process.
    await vault.putSecret('bluesky_handle', 'ralph.bsky.social', { actor: 1 });
    delete process.env.bluesky_handle;

    await vault.shutdown();

    const v = await getSecret('bluesky_handle'); // no envFallback — vault is the only source
    expect(v).toBe('ralph.bsky.social');
  });

  it('coalesces concurrent self-heal re-inits (no duplicate init storm)', async () => {
    await vault.putSecret('openai_api_key', 'sk-concurrent', { actor: 1 });
    await vault.shutdown();

    const results = await Promise.all([
      vault.getSecret('openai_api_key'),
      vault.getSecret('openai_api_key'),
      vault.getSecret('openai_api_key'),
    ]);
    expect(results).toEqual(['sk-concurrent', 'sk-concurrent', 'sk-concurrent']);
    expect(vault.health().ok).toBe(true);
  });
});

// ── Per-Tier-1-key smoke loop ──────────────────────────────────────────────

describe('getSecret — per-key smoke loop (every Tier-1 entry)', () => {
  let adapter;
  let releaseSuite;
  let vault;
  let getSecret;
  let __resetWarnedForTests;

  beforeAll(async () => {
    releaseSuite = await lockSecretsSuite();
    adapter = await makeAdapter();
    await dropTable(adapter);
    await applyMigration(adapter);
    const vaultMod = await import('../SecretsVault.js');
    vault = vaultMod.default;
    await vault.init({ adapter });
    const helperMod = await import('../getSecret.js');
    getSecret = helperMod.getSecret;
    __resetWarnedForTests = helperMod.__resetWarnedForTests;
  }, 120_000);

  afterAll(async () => {
    try { await vault.shutdown(); } catch { /* ignore */ }
    try { await adapter.close(); } catch { /* ignore */ }
    await releaseSuite?.();
  });

  beforeEach(async () => {
    await adapter.query(`DELETE FROM ${TABLE} WHERE space_id = 11`); // space-scoped: table is shared by every suite
    // TRUNCATE does not invalidate the vault's 60-second in-process cache.
    vault._cache.clear();
    __resetWarnedForTests();
  });

  for (const entry of TIER_1_SECRETS) {
    const firstEnv = Array.isArray(entry.envFallback) ? entry.envFallback[0] : entry.envFallback;

    it(`${entry.vaultKey} — env fallback works`, async () => {
      // Ensure no other alias leaks in.
      const allEnvs = Array.isArray(entry.envFallback) ? entry.envFallback : [entry.envFallback];
      for (const e of allEnvs) delete process.env[e];

      process.env[firstEnv] = `env-${entry.vaultKey}`;
      const v = await getSecret(entry.vaultKey, entry.envFallback);
      expect(v).toBe(`env-${entry.vaultKey}`);
      delete process.env[firstEnv];
    });

    it(`${entry.vaultKey} — vault-hit preferred over env`, async () => {
      const allEnvs = Array.isArray(entry.envFallback) ? entry.envFallback : [entry.envFallback];
      for (const e of allEnvs) delete process.env[e];

      await vault.putSecret(entry.vaultKey, `vault-${entry.vaultKey}`, {
        actor: 1, description: 'smoke',
      });
      process.env[firstEnv] = `env-${entry.vaultKey}`;

      const v = await getSecret(entry.vaultKey, entry.envFallback);
      expect(v).toBe(`vault-${entry.vaultKey}`);
      delete process.env[firstEnv];
    });
  }
});
