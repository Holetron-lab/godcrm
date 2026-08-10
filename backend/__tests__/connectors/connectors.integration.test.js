// @vitest-environment node
/**
 * ADR-0028 Phase 1 — Space Connectors integration tests.
 *
 * Boot guard MUST run before any DB connection (ADR-0009). vitest.config
 * already lists backend/test/setup.js first; we re-import here so a direct
 * `vitest run <this-file>` still aborts on PROD DB.
 */

import './../../test/setup.js';
import crypto from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// Provide a vault key for the test run. Real env (.env) takes precedence if set.
if (!process.env.CRM_CREDENTIAL_KEY) {
  process.env.CRM_CREDENTIAL_KEY = crypto.randomBytes(32).toString('hex');
}
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret-' + crypto.randomBytes(8).toString('hex');
}

// Import after env is set up.
const { default: vault, getSpaceConnector } = await import(
  '../../services/connectors/CredentialVault.js'
);
const {
  getConnectorType,
  listConnectorTypes,
  validateConnectorTypeBody,
} = await import('../../services/connectors/catalogue/index.js');

describe('CredentialVault', () => {
  beforeAll(async () => {
    await vault.init();
  });
  afterAll(async () => {
    await vault.shutdown();
  });

  it('encrypt/decrypt round-trip preserves payload', () => {
    const plain = {
      access_token: 'tok-xyz',
      refresh_token: 'rfr-abc',
      raw: { account: 'me@example.com', expires_in: 3600 },
    };
    const enc = vault.encrypt(plain);
    expect(enc.v).toBe(1);
    expect(typeof enc.iv).toBe('string');
    expect(typeof enc.tag).toBe('string');
    expect(typeof enc.ct).toBe('string');
    const dec = vault.decrypt(enc);
    expect(dec).toEqual(plain);
  });

  it('decrypt rejects tampered ciphertext', () => {
    const enc = vault.encrypt({ x: 1 });
    enc.ct = Buffer.from('tampered').toString('base64');
    expect(() => vault.decrypt(enc)).toThrow();
  });

  it('decrypt rejects unknown version', () => {
    const enc = vault.encrypt({ x: 1 });
    enc.v = 99;
    expect(() => vault.decrypt(enc)).toThrow(/version/);
  });

  it('health reports configured key', () => {
    const h = vault.health();
    expect(h.ok).toBe(true);
    expect(h.hasKey).toBe(true);
    expect(h.keyVersion).toBe(1);
  });
});

describe('Connector catalogue', () => {
  it('lists 4 types in Phase 1', () => {
    const slugs = listConnectorTypes().map((t) => t.slug).sort();
    expect(slugs).toEqual(['custom_api_key', 'custom_oauth2', 'figma', 'notion']);
  });

  it('figma is oauth2 with correct URLs', () => {
    const f = getConnectorType('figma');
    expect(f.auth_kind).toBe('oauth2');
    expect(f.authorize_url).toBe('https://www.figma.com/oauth');
    expect(f.token_url).toBe('https://api.figma.com/v1/oauth/token');
    expect(f.refresh_supported).toBe(true);
  });

  it('notion exposes buildAuthorizeUrl override with owner=user', () => {
    const n = getConnectorType('notion');
    expect(typeof n.buildAuthorizeUrl).toBe('function');
    const url = n.buildAuthorizeUrl({
      state: 'state123',
      redirect_uri: 'https://devcrm.hltrn.cc/api/v3/connectors/oauth/callback',
      client_id: 'cid',
    });
    const u = new URL(url);
    expect(u.searchParams.get('owner')).toBe('user');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('state')).toBe('state123');
  });

  it('custom_oauth2 validates required custom_definition', () => {
    expect(validateConnectorTypeBody('custom_oauth2', {}).ok).toBe(false);
    expect(
      validateConnectorTypeBody('custom_oauth2', {
        custom_definition: { client_id: 'x', authorize_url: 'https://a.com', token_url: 'https://b.com' },
        fields: { client_secret: 's' },
      }).ok
    ).toBe(true);
  });

  it('custom_api_key requires fields.api_key', () => {
    expect(validateConnectorTypeBody('custom_api_key', {}).ok).toBe(false);
    expect(
      validateConnectorTypeBody('custom_api_key', { fields: { api_key: 'k1' } }).ok
    ).toBe(true);
  });

  it('rejects unknown type', () => {
    expect(validateConnectorTypeBody('whatever', {}).ok).toBe(false);
  });
});

describe('getSpaceConnector helper', () => {
  it('returns null when no row exists for (space, type)', async () => {
    // Use a deliberately non-existent space. Skips if migration 054 hasn't run
    // against the local test DB yet (`make sync-db && npx knex migrate:latest`).
    try {
      const result = await getSpaceConnector(-9999, 'figma');
      expect(result).toBeNull();
    } catch (err) {
      if (/relation "space_connectors" does not exist/i.test(err?.message || '')) {
        // eslint-disable-next-line no-console
        console.warn(
          '[connectors test] Skipping getSpaceConnector check — migration 054 not applied to test DB yet.'
        );
        return;
      }
      throw err;
    }
  });
});
