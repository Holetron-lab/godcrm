/**
 * SecretsVault — ADR-0040 Phase 0.
 *
 * AES-256-GCM at-rest encryption for owner-managed secrets stored in the
 * `_secrets` registry. Drop-in replacement for ad-hoc `process.env.<KEY>`
 * reads across the codebase (consumers migrate in P3, ticket T-140013).
 *
 * Module Lifecycle (ADR-0025): exports init / shutdown / health.
 *
 * Key sourcing:
 *   - `SECRETS_MASTER_KEY` env (32-byte hex/64 chars OR 32-byte base64/44 chars).
 *   - Generate with: `openssl rand -hex 32`.
 *
 * Fail-fast (AC4):
 *   - `NODE_ENV === 'production'` && key missing/invalid → init throws
 *     `SECRETS_MASTER_KEY_MISSING` and (when called from server boot) the
 *     process exits non-zero before any request is served.
 *
 * .env fallback (AC6, transitional):
 *   - `NODE_ENV !== 'production'` + key absent + `allowEnvFallback: true`
 *     → getSecret(key) returns `process.env[key]`. Logs one WARN per
 *     process boot to make the regression loud. Removed at D14 cutover.
 *
 * Cache:
 *   - In-memory Map, 60s TTL per entry.
 *   - PG NOTIFY 'secrets_changed' (payload=key) evicts the matching entry.
 *     Listener uses a dedicated long-lived client (LISTEN is connection-scoped).
 *
 * Payload shape (v=1):
 *   { v: 1, iv: <base64 12B>, tag: <base64 16B>, ct: <base64 ciphertext> }
 */

import crypto from 'crypto';
import pg from 'pg';
import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'secrets_vault' });

const KEY_VERSION = 1;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ENV_KEY_NAME = 'SECRETS_MASTER_KEY';
const CACHE_TTL_MS = 60_000;
const NOTIFY_CHANNEL = 'secrets_changed';
const TABLE = '_secrets';

function decodeMasterKey(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  // 64 hex chars → 32 bytes.
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  // base64 32 bytes (≈44 chars incl. padding).
  if (/^[A-Za-z0-9+/]+=*$/.test(trimmed)) {
    try {
      const buf = Buffer.from(trimmed, 'base64');
      if (buf.length === KEY_BYTES) return buf;
    } catch { /* fall through */ }
  }
  return null;
}

class SecretsVault {
  constructor() {
    /** @type {Buffer|null} */
    this._key = null;
    this._initialized = false;
    /** @type {Map<string, { value: string, expiresAt: number }>} */
    this._cache = new Map();
    this._adapter = null;
    /** @type {pg.Client|null} dedicated client for LISTEN */
    this._listener = null;
    this._envFallbackWarned = false;
    this._allowEnvFallback = true; // transitional default; turn off post-D14
    // Stale-singleton self-heal (ADR-0040): snapshot the last init opts (esp. the
    // DB adapter) so a getSecret() against a torn-down / never-Express-booted
    // singleton can transparently re-init instead of throwing → null.
    this._lastInitOpts = null;
    /** @type {Promise<any>|null} coalesces concurrent self-heal re-inits */
    this._reinitPromise = null;
  }

  /**
   * Initialize the vault.
   *
   * @param {object} [opts]
   * @param {object} [opts.adapter] - DB adapter (must expose `.query(sql, params)`). If null, only env-fallback works.
   * @param {boolean} [opts.allowEnvFallback=true] - When false, vault never reads from process.env.
   */
  async init(opts = {}) {
    if (this._initialized) return this.health();

    this._adapter = opts.adapter ?? null;
    if (opts.allowEnvFallback === false) this._allowEnvFallback = false;

    // Snapshot the effective opts so the self-heal path can re-init faithfully
    // (shutdown() preserves _adapter/_allowEnvFallback, but being explicit keeps
    // re-init independent of any future shutdown() change).
    this._lastInitOpts = { adapter: this._adapter, allowEnvFallback: this._allowEnvFallback };

    const raw = process.env[ENV_KEY_NAME];
    const decoded = decodeMasterKey(raw);

    if (!decoded) {
      if (process.env.NODE_ENV === 'production') {
        // AC4: hard fail — never serve traffic without a vault key in prod.
        const msg =
          `${ENV_KEY_NAME} is missing or malformed in NODE_ENV=production. ` +
          'Generate one with `openssl rand -hex 32` and set it in the PM2 env ' +
          'on PROD (.205) and DEV (.72), then restart. Refusing to start.';
        // Log first so even a hard-exit produces a visible stderr line.
        log.fatal({ envName: ENV_KEY_NAME }, msg);
        // Throw so test harnesses observe a deterministic failure, then exit
        // so a real server boot terminates the process group.
        const err = new Error(msg);
        err.code = 'SECRETS_MASTER_KEY_MISSING';
        // process.exit on next tick — gives the logger time to flush.
        setImmediate(() => {
          try { process.exit(1); } catch { /* ignore */ }
        });
        throw err;
      }
      log.warn(
        { envName: ENV_KEY_NAME },
        `${ENV_KEY_NAME} not configured — vault disabled. ` +
          'Generate one with `openssl rand -hex 32`. Until then, getSecret() ' +
          'falls back to process.env (NODE_ENV != production).'
      );
      this._initialized = true;
      return this.health();
    }

    this._key = decoded;

    // Spin up a dedicated LISTEN client when we have an adapter — best-effort.
    if (this._adapter) {
      try {
        await this._startListener();
      } catch (err) {
        log.error({ err }, 'SecretsVault: LISTEN client failed to start — cache eviction degraded to TTL-only');
      }
    }

    this._initialized = true;
    log.info({ keyVersion: KEY_VERSION, listening: !!this._listener }, 'SecretsVault initialized');
    return this.health();
  }

  async _startListener() {
    // Reuse adapter connection params. PostgresAdapter exposes options;
    // fall back to env if the adapter wasn't constructed with explicit opts.
    const opts = this._adapter?.options || {};
    const connectionConfig = opts.connectionString || opts.url || process.env.POSTGRES_URL
      ? { connectionString: opts.connectionString || opts.url || process.env.POSTGRES_URL }
      : {
          host: opts.host || process.env.POSTGRES_HOST || 'localhost',
          port: parseInt(opts.port || process.env.POSTGRES_PORT || '5432', 10),
          database: opts.database || process.env.POSTGRES_DB || 'godcrm',
          user: opts.user || process.env.POSTGRES_USER || 'godcrm',
          password: opts.password || process.env.POSTGRES_PASSWORD,
          ssl: opts.ssl !== false ? { rejectUnauthorized: false } : false,
        };

    const client = new pg.Client(connectionConfig);
    await client.connect();
    client.on('notification', (msg) => {
      if (msg.channel !== NOTIFY_CHANNEL) return;
      const key = msg.payload;
      if (key && this._cache.delete(key)) {
        log.debug({ key }, 'SecretsVault: cache evicted via NOTIFY');
      }
    });
    client.on('error', (err) => {
      log.error({ err }, 'SecretsVault: LISTEN client error — cache eviction degraded');
    });
    await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
    this._listener = client;
  }

  /** Module Lifecycle: shutdown. Closes LISTEN client + zeros key. */
  async shutdown() {
    if (this._listener) {
      try { await this._listener.end(); } catch { /* ignore */ }
      this._listener = null;
    }
    if (this._key) {
      try { this._key.fill(0); } catch { /* ignore */ }
      this._key = null;
    }
    this._cache.clear();
    this._initialized = false;
  }

  /** Module Lifecycle: health. */
  health() {
    return {
      ok: this._initialized,
      hasKey: this._key !== null,
      keyVersion: KEY_VERSION,
      listening: this._listener !== null,
      cacheSize: this._cache.size,
    };
  }

  // ── Encryption primitives ────────────────────────────────────────────────

  _encrypt(plaintext) {
    if (!this._key) {
      const err = new Error(`SecretsVault: ${ENV_KEY_NAME} not configured`);
      err.code = 'VAULT_NOT_CONFIGURED';
      throw err;
    }
    if (typeof plaintext !== 'string') {
      throw new Error('SecretsVault._encrypt: plaintext must be a string');
    }
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      v: KEY_VERSION,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ct: ct.toString('base64'),
    };
  }

  _decrypt(blob) {
    if (!this._key) {
      const err = new Error(`SecretsVault: ${ENV_KEY_NAME} not configured`);
      err.code = 'VAULT_NOT_CONFIGURED';
      throw err;
    }
    const obj = typeof blob === 'string' ? JSON.parse(blob) : blob;
    if (!obj || obj.v !== KEY_VERSION) {
      throw new Error(`SecretsVault._decrypt: unsupported payload version ${obj?.v}`);
    }
    const iv = Buffer.from(obj.iv, 'base64');
    const tag = Buffer.from(obj.tag, 'base64');
    const ct = Buffer.from(obj.ct, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this._key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plain.toString('utf8');
  }

  // ── Cache helpers ────────────────────────────────────────────────────────

  _cacheGet(key) {
    const entry = this._cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this._cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  _cachePut(key, value) {
    this._cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Store (or replace) a secret. Encrypts plaintext at rest.
   * @param {string} key
   * @param {string} plaintext
   * @param {{ actor?: number, description?: string }} [meta]
   */
  async putSecret(key, plaintext, meta = {}) {
    if (!this._adapter) throw new Error('SecretsVault.putSecret: adapter not configured');
    const blob = this._encrypt(plaintext);
    const actor = meta.actor ?? null;
    const description = meta.description ?? null;
    await this._adapter.query(
      `INSERT INTO ${TABLE} (key, encrypted_payload, description, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (key) DO UPDATE
         SET encrypted_payload = EXCLUDED.encrypted_payload,
             description       = COALESCE(EXCLUDED.description, ${TABLE}.description),
             updated_at        = NOW()`,
      [key, JSON.stringify(blob), description, actor]
    );
    // Trigger fires NOTIFY → our listener evicts. Local put-through for
    // single-process latency wins.
    this._cachePut(key, plaintext);
  }

  /**
   * Read a secret. Uses 60s in-memory cache; falls back to .env in dev when
   * master key is absent (AC6).
   * @param {string} key
   * @returns {Promise<string|null>}
   */
  async getSecret(key) {
    if (!this._initialized) {
      // Stale-singleton self-heal (ADR-0040). The vault is a process-wide module
      // singleton; it can become uninitialized out-of-band — an in-process
      // agent-run lifecycle calling shutdown(), or a process that loaded the
      // singleton without running the Express-boot init(). Throwing here makes
      // callers (getSecret.js) swallow the error into a null — which masks for
      // secrets WITH an env fallback but surfaces as "not configured" for ones
      // WITHOUT (e.g. bluesky_handle). When a usable master key is present,
      // transparently (re-)init from the last good opts (preserving the DB
      // adapter) instead of throwing. With no master key we keep the legacy
      // throw so a genuinely unconfigured vault behaves exactly as before
      // (→ getSecret.js env fallback). Concurrent callers coalesce on a single
      // in-flight re-init so we never open duplicate LISTEN clients.
      if (decodeMasterKey(process.env[ENV_KEY_NAME])) {
        if (!this._reinitPromise) {
          log.warn('SecretsVault.getSecret: vault uninitialized but master key present — self-healing (stale-singleton re-init)');
          this._reinitPromise = this.init(this._lastInitOpts || {})
            .catch((err) => { log.error({ err }, 'SecretsVault: self-heal re-init failed'); })
            .finally(() => { this._reinitPromise = null; });
        }
        await this._reinitPromise;
      }
      if (!this._initialized) {
        throw new Error('SecretsVault.getSecret: init() not called');
      }
    }

    // Env-fallback path: NODE_ENV != production AND no master key.
    if (!this._key) {
      if (this._allowEnvFallback && process.env.NODE_ENV !== 'production') {
        if (!this._envFallbackWarned) {
          // eslint-disable-next-line no-console
          console.warn(
            `[SecretsVault] ${ENV_KEY_NAME} unset — falling back to process.env. ` +
              'This path is removed at D14 cutover (ADR-0040).'
          );
          this._envFallbackWarned = true;
        }
        return process.env[key] ?? null;
      }
      return null;
    }

    const cached = this._cacheGet(key);
    if (cached !== undefined) return cached;

    if (!this._adapter) return null;

    const result = await this._adapter.query(
      `SELECT encrypted_payload FROM ${TABLE} WHERE key = $1 LIMIT 1`,
      [key]
    );
    if (result.rowCount === 0) return null;
    const plain = this._decrypt(result.rows[0].encrypted_payload);
    this._cachePut(key, plain);
    return plain;
  }

  /**
   * Read a secret and write an audit trail row (for the P1 "👁 reveal" UI).
   * Bypasses cache TTL semantics for the actual fetch — always touches DB to
   * timestamp the reveal.
   */
  async revealSecret(key, meta = {}) {
    if (!this._adapter) throw new Error('SecretsVault.revealSecret: adapter not configured');
    const actor = meta.actor ?? null;
    const result = await this._adapter.query(
      `UPDATE ${TABLE}
          SET last_revealed_at = NOW(),
              last_revealed_by = $2
        WHERE key = $1
        RETURNING encrypted_payload`,
      [key, actor]
    );
    if (result.rowCount === 0) return null;
    const plain = this._decrypt(result.rows[0].encrypted_payload);
    this._cachePut(key, plain);
    log.info({ key, actor }, 'SecretsVault: secret revealed');
    return plain;
  }

  /** Delete a secret. NOTIFY trigger evicts cache cluster-wide. */
  async deleteSecret(key, meta = {}) {
    if (!this._adapter) throw new Error('SecretsVault.deleteSecret: adapter not configured');
    const actor = meta.actor ?? null;
    await this._adapter.query(`DELETE FROM ${TABLE} WHERE key = $1`, [key]);
    this._cache.delete(key);
    log.info({ key, actor }, 'SecretsVault: secret deleted');
  }
}

const vaultSingleton = new SecretsVault();

export async function init(opts) { return vaultSingleton.init(opts); }
export async function shutdown() { return vaultSingleton.shutdown(); }
export function health() { return vaultSingleton.health(); }
export default vaultSingleton;
