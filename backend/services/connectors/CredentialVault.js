/**
 * CredentialVault — ADR-0028 §3.3
 *
 * AES-256-GCM at-rest encryption for outbound OAuth/API-key credentials
 * stored in `space_connectors.encrypted_payload`.
 *
 * Module Lifecycle (ADR-0025): exports init/shutdown/health.
 *
 * Key handling:
 *  - Reads `process.env.CRM_CREDENTIAL_KEY` (hex, 32 bytes / 64 hex chars).
 *  - If absent: encrypt/decrypt throws on call. Module init does NOT crash —
 *    Phase 0 (sysadmin provisioning) may not be done yet on a given env.
 *
 * Payload shape (v=1):
 *   { v: 1, iv: <base64 12B>, tag: <base64 16B>, ct: <base64 ciphertext> }
 *
 * To generate a key: `openssl rand -hex 32`
 */

import crypto from 'crypto';
import { dbGet } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';

const log = apiLogger.child({ module: 'credential_vault' });

const KEY_VERSION = 1;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ENV_NAME = 'CRM_CREDENTIAL_KEY';

class CredentialVault {
  constructor() {
    /** @type {Buffer|null} */
    this._key = null;
    this._initialized = false;
  }

  /**
   * Module Lifecycle: init.
   * Reads CRM_CREDENTIAL_KEY from env, validates length. Does not throw on
   * missing key (logs hard-failure warning). Idempotent.
   */
  async init() {
    if (this._initialized) return this.health();

    const raw = process.env[ENV_NAME];
    if (!raw) {
      log.warn(
        { envName: ENV_NAME },
        `${ENV_NAME} is missing — CredentialVault disabled. ` +
          'To enable: run `openssl rand -hex 32` and paste into .env on both ' +
          'PROD (.205) and DEV (.72), then restart PM2. ' +
          'Until then, encrypt() / decrypt() will throw on call.'
      );
      this._initialized = true;
      return this.health();
    }

    const trimmed = raw.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      log.error(
        { envName: ENV_NAME, length: trimmed.length },
        `${ENV_NAME} has wrong format — expected 64 hex chars (32 bytes). ` +
          'Regenerate via `openssl rand -hex 32`. Vault disabled.'
      );
      this._initialized = true;
      return this.health();
    }

    this._key = Buffer.from(trimmed, 'hex');
    if (this._key.length !== KEY_BYTES) {
      log.error({ length: this._key.length }, `${ENV_NAME} decoded to wrong length — vault disabled.`);
      this._key = null;
      this._initialized = true;
      return this.health();
    }

    this._initialized = true;
    log.info({ keyVersion: KEY_VERSION }, 'CredentialVault initialized');
    return this.health();
  }

  /**
   * Module Lifecycle: shutdown. Best-effort key zeroing.
   */
  async shutdown() {
    if (this._key) {
      try {
        this._key.fill(0);
      } catch {
        // ignore
      }
      this._key = null;
    }
    this._initialized = false;
  }

  /**
   * Module Lifecycle: health.
   * @returns {{ ok: boolean, hasKey: boolean, keyVersion: number }}
   */
  health() {
    return {
      ok: this._initialized && this._key !== null,
      hasKey: this._key !== null,
      keyVersion: KEY_VERSION,
    };
  }

  _ensureKey() {
    if (!this._initialized) {
      // Lazy init — pragmatic fallback if caller forgot to await init().
      // Synchronous re-read of env. If missing this still throws below.
      const raw = process.env[ENV_NAME];
      if (raw && /^[0-9a-fA-F]{64}$/.test(raw.trim())) {
        this._key = Buffer.from(raw.trim(), 'hex');
      }
      this._initialized = true;
    }
    if (!this._key) {
      const err = new Error(
        `CredentialVault: ${ENV_NAME} not configured. ` +
          'Run `openssl rand -hex 32` and paste into .env on both PROD and DEV.'
      );
      err.code = 'VAULT_NOT_CONFIGURED';
      throw err;
    }
  }

  /**
   * Encrypt a plain JS object → versioned blob.
   * @param {object} plainObj
   * @returns {{ v: number, iv: string, tag: string, ct: string }}
   */
  encrypt(plainObj) {
    this._ensureKey();
    if (plainObj === null || typeof plainObj !== 'object') {
      throw new Error('CredentialVault.encrypt: input must be a plain object');
    }
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._key, iv);
    const plaintext = Buffer.from(JSON.stringify(plainObj), 'utf8');
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      v: KEY_VERSION,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ct: ct.toString('base64'),
    };
  }

  /**
   * Decrypt a versioned blob → plain JS object.
   * @param {{ v: number, iv: string, tag: string, ct: string }} blob
   * @returns {object}
   */
  decrypt(blob) {
    this._ensureKey();
    if (!blob || typeof blob !== 'object') {
      throw new Error('CredentialVault.decrypt: blob must be an object');
    }
    if (blob.v !== KEY_VERSION) {
      throw new Error(`CredentialVault.decrypt: unsupported payload version ${blob.v}`);
    }
    const iv = Buffer.from(blob.iv, 'base64');
    const tag = Buffer.from(blob.tag, 'base64');
    const ct = Buffer.from(blob.ct, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this._key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  }
}

const vaultSingleton = new CredentialVault();

/**
 * Single source of truth for resolving an active connector by space + type.
 * Returns the most-recent active row's decrypted payload merged with row metadata.
 *
 * Used by MCP tools (ADR-0028 §3.7), agent skills, and automations.
 *
 * @param {number} spaceId
 * @param {string} typeSlug
 * @returns {Promise<null | {
 *   id: number,
 *   type_slug: string,
 *   kind: string,
 *   display_name: string,
 *   status: string,
 *   scopes_granted: string[],
 *   account_label: string|null,
 *   access_token: string|null,
 *   refresh_token: string|null,
 *   custom_fields: object,
 *   expires_at: Date|null
 * }>}
 */
export async function getSpaceConnector(spaceId, typeSlug) {
  const row = await dbGet(
    `SELECT id, type_slug, kind, display_name, status, scopes_granted,
            account_label, encrypted_payload, expires_at
       FROM space_connectors
      WHERE space_id = ? AND type_slug = ? AND status = 'active'
      ORDER BY id DESC
      LIMIT 1`,
    [spaceId, typeSlug]
  );
  if (!row) return null;

  let decrypted = {};
  try {
    const payload = typeof row.encrypted_payload === 'string'
      ? JSON.parse(row.encrypted_payload)
      : row.encrypted_payload;
    if (payload && payload.v === KEY_VERSION) {
      decrypted = vaultSingleton.decrypt(payload);
    }
  } catch (err) {
    log.error({ err, connectorId: row.id }, 'getSpaceConnector: decrypt failed');
    return null;
  }

  // Pull known fields up + keep custom for raw access.
  const { access_token = null, refresh_token = null, ...custom_fields } = decrypted || {};

  return {
    id: row.id,
    type_slug: row.type_slug,
    kind: row.kind,
    display_name: row.display_name,
    status: row.status,
    scopes_granted: row.scopes_granted || [],
    account_label: row.account_label || null,
    access_token,
    refresh_token,
    custom_fields,
    expires_at: row.expires_at || null,
  };
}

export async function init() {
  return vaultSingleton.init();
}
export async function shutdown() {
  return vaultSingleton.shutdown();
}
export function health() {
  return vaultSingleton.health();
}

// Default export is the singleton — primary import surface.
export default vaultSingleton;
