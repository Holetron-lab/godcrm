/**
 * ADR-179 — OIDC fleet client registry unit tests.
 *
 * Pure unit test: dbGet and getSecret are mocked, so this runs without a live
 * database (the DB-backed provider flow is covered in routes/oauth/__tests__).
 * safeJsonParse is kept REAL (partial mock of connection.js) so JSON column
 * normalisation is exercised as it runs in production.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// Partial-mock connection.js: real safeJsonParse, fake dbGet.
vi.mock('../../../database/connection.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, dbGet: vi.fn() };
});
vi.mock('../../secrets/getSecret.js', () => ({ getSecret: vi.fn() }));

import { dbGet } from '../../../database/connection.js';
import { getSecret } from '../../secrets/getSecret.js';
import {
  getClient,
  isRedirectUriAllowed,
  resolveClientSecret,
  verifyClientSecret,
} from '../clientRegistry.js';

const baseRow = {
  client_id: 'workadventure',
  client_secret: 'wa-secret-123',
  name: 'WorkAdventure',
  redirect_uris: JSON.stringify(['https://wa.example/cb']),
  allowed_scopes: JSON.stringify(['openid', 'profile']),
  allowed_origins: JSON.stringify(['https://wa.example']),
  is_active: 1,
  token_endpoint_auth_method: 'client_secret_post',
  secret_ref: null,
  login_tier: 'oidc',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getClient', () => {
  test('returns null for unknown client', async () => {
    dbGet.mockResolvedValue(undefined);
    expect(await getClient('nope')).toBeNull();
  });

  test('returns null for empty client_id without hitting the DB', async () => {
    expect(await getClient('')).toBeNull();
    expect(dbGet).not.toHaveBeenCalled();
  });

  test('inactive client (is_active=0) resolves to null', async () => {
    dbGet.mockResolvedValue({ ...baseRow, is_active: 0 });
    expect(await getClient('workadventure')).toBeNull();
  });

  test('normalises JSON columns and defaults', async () => {
    dbGet.mockResolvedValue({ ...baseRow });
    const c = await getClient('workadventure');
    expect(c.redirect_uris).toEqual(['https://wa.example/cb']);
    expect(c.allowed_origins).toEqual(['https://wa.example']);
    expect(c.allowed_scopes).toEqual(['openid', 'profile']);
    expect(c.login_tier).toBe('oidc');
  });

  test('scopes default when column is absent/invalid', async () => {
    dbGet.mockResolvedValue({ ...baseRow, allowed_scopes: null });
    const c = await getClient('workadventure');
    expect(c.allowed_scopes).toEqual(['openid', 'profile', 'email']);
  });

  describe('is_public derivation', () => {
    test('confidential when a client_secret is set', async () => {
      dbGet.mockResolvedValue({ ...baseRow });
      expect((await getClient('x')).is_public).toBe(false);
    });
    test('public when token_endpoint_auth_method=none even if a secret lingers', async () => {
      dbGet.mockResolvedValue({ ...baseRow, token_endpoint_auth_method: 'none' });
      expect((await getClient('x')).is_public).toBe(true);
    });
    test('public when neither secret nor secret_ref configured', async () => {
      dbGet.mockResolvedValue({ ...baseRow, client_secret: null, secret_ref: null });
      expect((await getClient('x')).is_public).toBe(true);
    });
  });
});

describe('isRedirectUriAllowed', () => {
  const client = { redirect_uris: ['https://a/cb', 'https://b/cb'] };
  test('exact match allowed', () => {
    expect(isRedirectUriAllowed(client, 'https://a/cb')).toBe(true);
  });
  test('non-registered rejected', () => {
    expect(isRedirectUriAllowed(client, 'https://evil/cb')).toBe(false);
  });
  test('null-safe', () => {
    expect(isRedirectUriAllowed(null, 'https://a/cb')).toBe(false);
    expect(isRedirectUriAllowed(client, '')).toBe(false);
  });
});

describe('resolveClientSecret (D3 vault-first)', () => {
  test('secret_ref resolves from the vault', async () => {
    getSecret.mockResolvedValue('vaulted-secret');
    const s = await resolveClientSecret({ client_id: 'x', secret_ref: 'oidc_client_x', client_secret: 'legacy' });
    expect(s).toBe('vaulted-secret');
    expect(getSecret).toHaveBeenCalledWith('oidc_client_x');
  });

  test('falls back to legacy client_secret when vault returns null', async () => {
    getSecret.mockResolvedValue(null);
    const s = await resolveClientSecret({ client_id: 'x', secret_ref: 'missing', client_secret: 'legacy' });
    expect(s).toBe('legacy');
  });

  test('uses legacy column when no secret_ref', async () => {
    const s = await resolveClientSecret({ client_id: 'x', secret_ref: null, client_secret: 'legacy' });
    expect(s).toBe('legacy');
    expect(getSecret).not.toHaveBeenCalled();
  });

  test('public client (nothing configured) resolves to null', async () => {
    expect(await resolveClientSecret({ client_id: 'x', secret_ref: null, client_secret: null })).toBeNull();
  });
});

describe('verifyClientSecret (constant-time, no bypass)', () => {
  test('matching secret authenticates', async () => {
    expect(await verifyClientSecret({ client_secret: 'wa-secret-123' }, 'wa-secret-123')).toBe(true);
  });
  test('wrong secret rejected', async () => {
    expect(await verifyClientSecret({ client_secret: 'wa-secret-123' }, 'nope')).toBe(false);
  });
  test('omitted secret on a confidential client rejected (closes the bypass)', async () => {
    expect(await verifyClientSecret({ client_secret: 'wa-secret-123' }, undefined)).toBe(false);
    expect(await verifyClientSecret({ client_secret: 'wa-secret-123' }, '')).toBe(false);
  });
  test('length-mismatch secret rejected without throwing', async () => {
    expect(await verifyClientSecret({ client_secret: 'short' }, 'a-much-longer-value')).toBe(false);
  });
  test('client with no configured secret cannot be authed by any input', async () => {
    getSecret.mockResolvedValue(null);
    expect(await verifyClientSecret({ client_secret: null, secret_ref: null }, 'anything')).toBe(false);
  });
});
