// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import knex from 'knex';
import request from 'supertest';
import { dbGet, dbRun, destroyAdapter, resetAdapter } from '../../../database/connection.js';
import knexConfig from '../../../database/knexfile.js';
import { up as up078 } from '../../../database/migrations/knex/078_adr_0179_fleet_registry.js';
import { down as down116, up as up116 } from '../../../database/migrations/knex/116_adr_0210_embed_tickets.js';
import { createEphemeralWorkspace, fixtureToken } from '../../../tests/helpers/workspace-fixture.js';
import { authenticate } from '../../../middleware/auth.js';

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }));
vi.mock('../../../services/audit/writeAudit.js', () => ({ default: auditMock, writeAudit: auditMock }));

import embedRoutes from '../embed.js';

const CLIENT_SECRET = 'test-level-client-secret';
const PARENT_ORIGIN = 'https://admin.sixtynine.ru';
const CALLBACK = 'https://sixtynine.ru/auth/social/godcrm/callback';
const basic = (secret = CLIENT_SECRET, clientId = 'level') =>
  `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.requestId = `test-${fixtureToken()}`;
  next();
});
app.use('/api/v3/embed', embedRoutes);

let migrationDb;
let ws;
let extraUserIds;

async function configureClient({ active = 1, spaceId = ws.spaceId } = {}) {
  await dbRun('DELETE FROM oidc_clients WHERE client_id = ?', ['level']);
  await dbRun(
    `INSERT INTO oidc_clients (
      client_id, client_secret, secret_ref, name, redirect_uris, allowed_scopes,
      allowed_origins, is_active, token_endpoint_auth_method, login_tier, space_id
    ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'client_secret_basic', 'oidc', ?)`,
    [
      'level', CLIENT_SECRET, 'Level Admin', JSON.stringify([CALLBACK]),
      JSON.stringify(['openid', 'profile', 'email']), JSON.stringify([PARENT_ORIGIN]),
      active, spaceId,
    ],
  );
}

async function createUser({ member = false, status = 'active' } = {}) {
  const token = fixtureToken();
  const result = await dbRun(
    `INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [`test-embed-${token}@test.godcrm.local`, 'hash', `Embed ${token}`, 'key', 1, status],
  );
  const userId = result.lastInsertRowid;
  extraUserIds.push(userId);
  if (member) {
    await dbRun(
      `INSERT INTO user_access_permissions (user_id, space_id, access_level, granted_by)
       VALUES (?, ?, 'editor', ?)`,
      [userId, ws.spaceId, ws.userId],
    );
  }
  return userId;
}

function issue({ sub = ws.userId, origin = PARENT_ORIGIN, secret = CLIENT_SECRET } = {}) {
  return request(app)
    .post('/api/v3/embed/tickets')
    .set('Authorization', basic(secret))
    .send({ sub: String(sub), parent_origin: origin });
}

function redeem(ticket, { clientId = 'level', origin = PARENT_ORIGIN } = {}) {
  return request(app)
    .post('/api/v3/embed/session')
    .send({ client_id: clientId, ticket, parent_origin: origin });
}

beforeAll(async () => {
  await resetAdapter();
  const actual = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
  migrationDb = knex(knexConfig.getConfig('test'));
  await up078(migrationDb);
  await up116(migrationDb);
});

beforeEach(async () => {
  vi.stubEnv('EMBED_TICKET_AUTH_ENABLED', 'true');
  auditMock.mockClear();
  ws = await createEphemeralWorkspace({ label: 'embed-ticket', table: false, dashboard: false });
  extraUserIds = [];
  await configureClient();
});

afterEach(async () => {
  await dbRun('DELETE FROM embed_tickets WHERE client_id = ?', ['level']);
  await dbRun('DELETE FROM oidc_clients WHERE client_id = ?', ['level']);
  await dbRun('DELETE FROM user_access_permissions WHERE space_id = ?', [ws.spaceId]);
  for (const userId of extraUserIds) await dbRun('DELETE FROM users WHERE id = ?', [userId]);
  await ws.cleanup();
  await destroyAdapter();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await down116(migrationDb);
  await migrationDb.destroy();
  await destroyAdapter();
});

describe('ADR-210 client configuration and feature gate', () => {
  it('registers an inactive confidential Level client without a plaintext secret', async () => {
    await dbRun('DELETE FROM oidc_clients WHERE client_id = ?', ['level']);
    await up116(migrationDb);
    const client = await dbGet('SELECT * FROM oidc_clients WHERE client_id = ?', ['level']);
    expect(client).toMatchObject({
      client_id: 'level', client_secret: null, secret_ref: 'oidc_level_client_secret',
      is_active: 0, token_endpoint_auth_method: 'client_secret_basic', login_tier: 'oidc', space_id: 35,
    });
    expect(JSON.parse(client.redirect_uris)).toEqual([CALLBACK]);
    expect(client.allowed_origins).toEqual([PARENT_ORIGIN]);
  });

  it('fails closed when ticket auth is disabled', async () => {
    vi.stubEnv('EMBED_TICKET_AUTH_ENABLED', 'false');
    const response = await issue();
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ENDPOINT_NOT_FOUND');
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe('ADR-210 ticket issue', () => {
  it('issues a 60-second ticket and stores only its SHA-256 hash', async () => {
    const response = await issue();
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toEqual({
      ticket: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), expires_in: 60, space_id: ws.spaceId,
    });

    const row = await dbGet('SELECT * FROM embed_tickets WHERE client_id = ?', ['level']);
    const expectedHash = crypto.createHash('sha256').update(response.body.data.ticket).digest('hex');
    expect(row.ticket_hash).toBe(expectedHash);
    expect(row.ticket_hash).not.toContain(response.body.data.ticket);
    expect(row).toMatchObject({ user_id: ws.userId, space_id: ws.spaceId, parent_origin: PARENT_ORIGIN });
    expect(row.consumed_at).toBeNull();
    expect(JSON.stringify(row)).not.toContain(response.body.data.ticket);
    expect(JSON.stringify(auditMock.mock.calls.map((call) => call[1]))).not.toContain(response.body.data.ticket);
    expect(JSON.stringify(auditMock.mock.calls.map((call) => call[1]))).not.toContain(CLIENT_SECRET);
  });

  it('allows an explicitly authorised space member', async () => {
    const userId = await createUser({ member: true });
    const response = await issue({ sub: userId });
    expect(response.status).toBe(201);
    expect(response.body.data.space_id).toBe(ws.spaceId);
  });

  it('rejects bad secrets and inactive clients', async () => {
    expect((await issue({ secret: 'wrong' })).status).toBe(401);
    await configureClient({ active: 0 });
    const response = await issue();
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_CLIENT');
  });

  it('rejects unknown, inactive and non-member users without revealing which rule failed', async () => {
    const inactiveId = await createUser({ status: 'deleted' });
    const strangerId = await createUser();
    const unknownId = Math.max(ws.userId, inactiveId, strangerId) + 100000;
    for (const sub of [unknownId, inactiveId, strangerId]) {
      const response = await issue({ sub });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('EMBED_USER_FORBIDDEN');
    }
  });

  it('rejects unlisted and non-canonical parent origins', async () => {
    for (const origin of ['https://evil.example', `${PARENT_ORIGIN}/`, `${PARENT_ORIGIN}/path`]) {
      const response = await issue({ origin });
      expect([400, 403]).toContain(response.status);
    }
    expect(await dbGet('SELECT COUNT(*)::int AS count FROM embed_tickets WHERE client_id = ?', ['level']))
      .toMatchObject({ count: 0 });
  });
});

describe('ADR-210 ticket redemption', () => {
  it('atomically redeems into a 15-minute Bearer token without cookies', async () => {
    const issued = await issue();
    const ticket = issued.body.data.ticket;
    const response = await redeem(ticket);
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.body.data.expiresIn).toBe(900);
    expect(response.body.data.space_id).toBe(ws.spaceId);
    expect(response.body.data.user).toMatchObject({ id: String(ws.userId), email: ws.email });

    const decoded = jwt.verify(response.body.data.accessToken, process.env.JWT_SECRET);
    expect(decoded).toMatchObject({
      id: ws.userId, sub: String(ws.userId), embed: true,
      client_id: 'level', space_id: ws.spaceId, parent_origin: PARENT_ORIGIN,
    });
    expect(decoded.exp - decoded.iat).toBe(900);

    const protectedApp = express();
    protectedApp.get('/protected', authenticate, (req, res) => res.json({ user: req.user }));
    const protectedResponse = await request(protectedApp)
      .get('/protected')
      .set('Authorization', `Bearer ${response.body.data.accessToken}`)
      .expect(200);
    expect(protectedResponse.body.user).toMatchObject({
      id: ws.userId, embed: true, client_id: 'level', space_id: ws.spaceId,
    });
    expect(JSON.stringify(auditMock.mock.calls.map((call) => call[1]))).not.toContain(ticket);
    expect(JSON.stringify(auditMock.mock.calls.map((call) => call[1]))).not.toContain(response.body.data.accessToken);
  });

  it('returns the same generic error for malformed, expired, wrong-client and wrong-origin tickets', async () => {
    const malformed = await redeem('not-a-ticket');
    expect(malformed.status).toBe(401);

    const expiredIssue = await issue();
    await dbRun('UPDATE embed_tickets SET expires_at = NOW() - INTERVAL \'1 second\' WHERE client_id = ?', ['level']);
    const expired = await redeem(expiredIssue.body.data.ticket);

    const wrongClientIssue = await issue();
    const wrongClient = await redeem(wrongClientIssue.body.data.ticket, { clientId: 'other' });
    const wrongOrigin = await redeem(wrongClientIssue.body.data.ticket, { origin: 'https://evil.example' });

    for (const response of [malformed, expired, wrongClient, wrongOrigin]) {
      expect(response.status).toBe(401);
      expect(response.body.error).toEqual(malformed.body.error);
      expect(response.body.error.code).toBe('INVALID_EMBED_TICKET');
    }
  });

  it('denies replay after a successful redemption', async () => {
    const issued = await issue();
    const ticket = issued.body.data.ticket;
    expect((await redeem(ticket)).status).toBe(200);
    const replay = await redeem(ticket);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('INVALID_EMBED_TICKET');
  });

  it('has exactly one winner under concurrent replay', async () => {
    const issued = await issue();
    const ticket = issued.body.data.ticket;
    const responses = await Promise.all(Array.from({ length: 8 }, () => redeem(ticket)));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 401)).toHaveLength(7);
    const row = await dbGet('SELECT consumed_at FROM embed_tickets WHERE client_id = ?', ['level']);
    expect(row.consumed_at).not.toBeNull();
  });

  it('rechecks membership at redemption and denies a revoked member', async () => {
    const userId = await createUser({ member: true });
    const issued = await issue({ sub: userId });
    await dbRun('DELETE FROM user_access_permissions WHERE user_id = ? AND space_id = ?', [userId, ws.spaceId]);
    const response = await redeem(issued.body.data.ticket);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_EMBED_TICKET');
  });

  it('rechecks client activation and binding at redemption', async () => {
    const issued = await issue();
    await configureClient({ active: 0 });
    const response = await redeem(issued.body.data.ticket);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_EMBED_TICKET');
  });
});
