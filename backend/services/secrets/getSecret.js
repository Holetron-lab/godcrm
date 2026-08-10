/**
 * ADR-0040 P3 — consumer-side helper.
 *
 * Reads a secret from the vault first, then optionally falls back to one or
 * more `process.env` names for environments where seed-secrets-from-env.js
 * has not yet run (or `_secrets` has no row for this key).
 *
 * Transitional contract (D14 cutover at 2026-05-18):
 *   - Before D14: vault > env. Env fallback emits a single WARN per env-name.
 *   - At D14: vault.getSecret() also drops its dev-only env fallback (AC6).
 *   - Post-D14 cleanup: remove `envFallback` arg + the WARN block (P3 §3.7).
 *
 * Usage:
 *   import { getSecret } from '.../services/secrets/getSecret.js';
 *   const key = await getSecret('openai_api_key', 'OPENAI_API_KEY');
 *
 * The second arg accepts a string OR an array (first-match-wins) — useful for
 * keys with historical aliases like GEMINI_API_KEY ‖ GOOGLE_AI_API_KEY.
 */

import vault from './SecretsVault.js';
import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'secrets_helper' });

/** envName → boolean. Ensures WARN-once-per-process per env var. */
const warned = new Set();

/**
 * @param {string} vaultKey - canonical lowercase key in `_secrets`
 * @param {string|string[]} [envFallback] - env var name(s) to try if vault yields null
 * @returns {Promise<string|null>}
 */
export async function getSecret(vaultKey, envFallback = null) {
  // Vault path first. Its own (dev-only) env fallback uses the literal
  // vaultKey (lowercase) which usually misses — we pass the explicit
  // uppercase fallback separately below.
  let value = null;
  try {
    value = await vault.getSecret(vaultKey);
  } catch (err) {
    // If vault not initialized yet (e.g. seed script running before boot),
    // log and fall through to env. Never let secret reads throw.
    if (err && err.message && err.message.includes('init() not called')) {
      log.debug({ vaultKey }, 'vault not initialised — using env fallback');
    } else {
      log.warn({ err, vaultKey }, 'vault.getSecret threw — falling back to env');
    }
  }
  if (value) return value;

  if (!envFallback) return null;

  const names = Array.isArray(envFallback) ? envFallback : [envFallback];
  for (const envName of names) {
    const fromEnv = process.env[envName];
    if (fromEnv) {
      if (!warned.has(envName)) {
        warned.add(envName);
        log.warn(
          { vaultKey, envName },
          `Secret '${vaultKey}' resolved via process.env.${envName} fallback — ` +
            'seed via Settings → Secrets or `node backend/scripts/seed-secrets-from-env.js`. ' +
            'Removed at D14 cutover (ADR-0040 §3.7).'
        );
      }
      return fromEnv;
    }
  }
  return null;
}

/**
 * Test-only helper — resets the per-process WARN dedup set so each test
 * starts with a clean slate.
 * @internal
 */
export function __resetWarnedForTests() {
  warned.clear();
}

export default getSecret;
