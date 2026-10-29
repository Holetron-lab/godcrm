// @vitest-environment node
/**
 * Blender MCP connector — catalogue type, stdio probe, runtime gate, routes.
 *
 * Space 7809 / agent 174642 on crm.hltrn.cc is the production target; here the
 * allowed space is the ephemeral fixture space and the allowed agent is a
 * throwaway id, both pinned through the same env the server reads.
 *
 * Boot guard first (ADR-0009): direct `vitest run <file>` must still abort on a
 * non-test database.
 */
import './../../test/setup.js';
import crypto from 'crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_MCP = path.join(__dirname, 'fixtures', 'fake-mcp-server.mjs');
const ALLOWED_AGENT_ID = 900174642;
const OTHER_AGENT_ID = 900000001;

if (!process.env.CRM_CREDENTIAL_KEY) {
  process.env.CRM_CREDENTIAL_KEY = crypto.randomBytes(32).toString('hex');
}
process.env.BLENDER_MCP_COMMAND = FAKE_MCP;
process.env.BLENDER_MCP_AGENT_ID = String(ALLOWED_AGENT_ID);
// BLENDER_MCP_SPACE_ID is set per-suite once the fixture space exists.

const { dbRun, dbGet } = await import('../../database/connection.js');
const { createEphemeralWorkspace } = await import('../../tests/helpers/workspace-fixture.js');
const { up: migrate097 } = await import(
  '../../database/migrations/knex/097_space_connectors_mcp_kind.js'
);
const { default: vault } = await import('../../services/connectors/CredentialVault.js');
const { getConnectorType, listConnectorTypes } = await import(
  '../../services/connectors/catalogue/index.js'
);
const { probeStdioMcp } = await import('../../services/connectors/mcpProbe.js');
const { evaluateMcpAccess, buildMcpGateEnv, verifyMcpGateToken, GATE_TOKEN_ENV } = await import(
  '../../services/connectors/mcpGate.js'
);
const { default: authedRouter, connectorsCallbackRouter } = await import(
  '../../routes/v3/connectors.js'
);

let ws;
const createdConnectorIds = [];

function appFor(userId) {
  const app = express();
  app.use(express.json());
  app.use('/api/v3/connectors', connectorsCallbackRouter);
  app.use(
    '/api/v3',
    (req, _res, next) => {
      req.user = { id: userId, role: 'user' };
      next();
    },
    authedRouter
  );
  return app;
}

async function createMcpConnector(app, spaceId, body = {}) {
  const res = await request(app)
    .post(`/api/v3/spaces/${spaceId}/connectors`)
    .send({ type_slug: 'blender_mcp', display_name: 'Blender (home)', ...body });
  if (res.body?.data?.connector?.id) createdConnectorIds.push(res.body.data.connector.id);
  return res;
}

beforeAll(async () => {
  await vault.init();
  // godcrm_test is a copy of master A; the migration is idempotent, so apply
  // it here through a knex-shaped shim. Also proves the migration runs.
  await migrate097({ raw: (sql) => dbRun(sql) });
});

afterAll(async () => {
  await vault.shutdown();
});

beforeEach(async () => {
  ws = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'blender-mcp' });
  process.env.BLENDER_MCP_SPACE_ID = String(ws.spaceId);
});

afterEach(async () => {
  while (createdConnectorIds.length) {
    await dbRun('DELETE FROM space_connectors WHERE id = ?', [createdConnectorIds.pop()]);
  }
  await dbRun('DELETE FROM space_connectors WHERE space_id = ?', [ws.spaceId]);
  await ws.cleanup();
});

describe('catalogue: blender_mcp', () => {
  it('is registered as an mcp kind with no credential fields', () => {
    const t = getConnectorType('blender_mcp');
    expect(t).not.toBeNull();
    expect(t.auth_kind).toBe('mcp');
    expect(t.fields).toEqual([]);
    expect(t.refresh_supported).toBe(false);
    const listed = listConnectorTypes().find((x) => x.slug === 'blender_mcp');
    expect(listed.auth_kind).toBe('mcp');
    expect(listed.mcp).toEqual({
      configured: true,
      allowed_agent_id: ALLOWED_AGENT_ID,
      allowed_space_id: ws.spaceId,
      safe_mode: true,
    });
  });

  it('reports not configured when the server env is missing', () => {
    const saved = process.env.BLENDER_MCP_AGENT_ID;
    delete process.env.BLENDER_MCP_AGENT_ID;
    try {
      expect(getConnectorType('blender_mcp').config().configured).toBe(false);
    } finally {
      process.env.BLENDER_MCP_AGENT_ID = saved;
    }
  });
});

describe('probeStdioMcp', () => {
  it('completes the handshake and counts tools, passing the scope env down', async () => {
    const r = await probeStdioMcp({
      command: FAKE_MCP,
      env: { AGENT_ID: '1', SPACE_ID: '2' },
      timeoutMs: 5000,
    });
    expect(r.ok).toBe(true);
    expect(r.tool_count).toBe(2);
    expect(r.server_name).toBe('fake-mcp');
    expect(r.server_info.agent_id).toBe('1');
    expect(r.server_info.space_id).toBe('2');
    expect(r.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('reports a timeout when the server never answers', async () => {
    const r = await probeStdioMcp({
      command: FAKE_MCP,
      env: { FAKE_MCP_MODE: 'hang' },
      timeoutMs: 400,
    });
    expect(r.ok).toBe(false);
    expect(r.error_code).toBe('timeout');
    expect(r.error).toMatch(/400/);
  });

  it('reports an exit with stderr when the server dies before answering', async () => {
    const r = await probeStdioMcp({
      command: FAKE_MCP,
      env: { FAKE_MCP_MODE: 'exit' },
      timeoutMs: 5000,
    });
    expect(r.ok).toBe(false);
    expect(r.error_code).toBe('exit');
    expect(r.error).toMatch(/refusing to start/);
  });

  it('reports a spawn failure for a missing command', async () => {
    const r = await probeStdioMcp({ command: '/nonexistent/mcp', timeoutMs: 2000 });
    expect(r.ok).toBe(false);
    expect(r.error_code).toBe('spawn');
  });
});

describe('mcp gate', () => {
  it('evaluateMcpAccess allows only the pinned agent in the pinned space while active', async () => {
    const app = appFor(ws.userId);
    const created = await createMcpConnector(app, ws.spaceId);
    expect(created.status).toBe(201);
    const row = await dbGet('SELECT * FROM space_connectors WHERE id = ?', [
      created.body.data.connector.id,
    ]);

    expect(evaluateMcpAccess({ row, agentId: ALLOWED_AGENT_ID, spaceId: ws.spaceId })).toEqual({
      allowed: true,
      reason: 'ok',
    });
    expect(evaluateMcpAccess({ row, agentId: OTHER_AGENT_ID, spaceId: ws.spaceId }).reason).toBe(
      'agent_not_allowed'
    );
    expect(evaluateMcpAccess({ row, agentId: ALLOWED_AGENT_ID, spaceId: ws.spaceId + 1 }).reason).toBe(
      'space_not_allowed'
    );
    expect(evaluateMcpAccess({ row: null, agentId: ALLOWED_AGENT_ID, spaceId: ws.spaceId }).reason).toBe(
      'no_connector'
    );
    expect(
      evaluateMcpAccess({ row: { ...row, status: 'disabled' }, agentId: ALLOWED_AGENT_ID, spaceId: ws.spaceId })
        .reason
    ).toBe('disabled');
  });

  it('buildMcpGateEnv mints a gate token only for the allowed agent/space', async () => {
    const app = appFor(ws.userId);
    await createMcpConnector(app, ws.spaceId);

    const env = await buildMcpGateEnv({ agentId: ALLOWED_AGENT_ID, spaceId: ws.spaceId });
    expect(env.GODCRM_MCP_GATE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/v3\/connectors\/mcp-gate$/);
    const token = env[GATE_TOKEN_ENV('blender_mcp')];
    expect(typeof token).toBe('string');
    const claims = verifyMcpGateToken(token);
    expect(claims.agent_id).toBe(ALLOWED_AGENT_ID);
    expect(claims.space_id).toBe(ws.spaceId);

    expect(await buildMcpGateEnv({ agentId: OTHER_AGENT_ID, spaceId: ws.spaceId })).toEqual({});
    expect(await buildMcpGateEnv({ agentId: ALLOWED_AGENT_ID, spaceId: ws.spaceId + 1 })).toEqual({});
  });

  it('verifyMcpGateToken rejects ordinary user JWTs', () => {
    const userJwt = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET);
    expect(() => verifyMcpGateToken(userJwt)).toThrow();
  });
});

describe('routes', () => {
  it('POST creates an mcp connector in the allowed space and GET lists it with the mcp block', async () => {
    const app = appFor(ws.userId);
    const res = await createMcpConnector(app, ws.spaceId);
    expect(res.status).toBe(201);
    const c = res.body.data.connector;
    expect(c.kind).toBe('mcp');
    expect(c.status).toBe('active');
    expect(c.enabled).toBe(true);
    expect(c.has_payload).toBe(false);
    expect(c.encrypted_payload).toBeUndefined();
    expect(c.mcp).toEqual({
      configured: true,
      allowed_agent_id: ALLOWED_AGENT_ID,
      allowed_space_id: ws.spaceId,
      safe_mode: true,
    });
    expect(c.last_checked_at).toBeNull();

    const list = await request(app).get(`/api/v3/spaces/${ws.spaceId}/connectors`);
    expect(list.status).toBe(200);
    const listed = list.body.data.connectors.find((x) => x.id === c.id);
    expect(listed.mcp.allowed_agent_id).toBe(ALLOWED_AGENT_ID);
    expect(listed.enabled).toBe(true);
  });

  it('POST refuses a second live mcp connector of the same type in a space', async () => {
    const app = appFor(ws.userId);
    expect((await createMcpConnector(app, ws.spaceId)).status).toBe(201);
    const dup = await createMcpConnector(app, ws.spaceId);
    expect(dup.status).toBe(409);
  });

  it('POST refuses the mcp connector in any other space (server-side pin)', async () => {
    const other = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'other' });
    try {
      const app = appFor(other.userId);
      const res = await createMcpConnector(app, other.spaceId);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('MCP_SPACE_NOT_ALLOWED');
    } finally {
      await dbRun('DELETE FROM space_connectors WHERE space_id = ?', [other.spaceId]);
      await other.cleanup();
    }
  });

  it('POST returns 503 when the server has no Blender MCP configuration', async () => {
    const saved = process.env.BLENDER_MCP_AGENT_ID;
    delete process.env.BLENDER_MCP_AGENT_ID;
    try {
      const res = await createMcpConnector(appFor(ws.userId), ws.spaceId);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('CONNECTOR_NOT_CONFIGURED');
    } finally {
      process.env.BLENDER_MCP_AGENT_ID = saved;
    }
  });

  it('POST /test runs a real handshake and persists the outcome', async () => {
    const app = appFor(ws.userId);
    const { id } = (await createMcpConnector(app, ws.spaceId)).body.data.connector;

    const ok = await request(app).post(`/api/v3/spaces/${ws.spaceId}/connectors/${id}/test`).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.data.check.ok).toBe(true);
    expect(ok.body.data.check.tool_count).toBe(2);
    // The probe runs under the pinned scope, exactly like a real agent turn.
    expect(ok.body.data.check.server_info.agent_id).toBe(String(ALLOWED_AGENT_ID));
    expect(ok.body.data.check.server_info.space_id).toBe(String(ws.spaceId));
    expect(ok.body.data.connector.last_error).toBeNull();
    expect(ok.body.data.connector.last_checked_at).not.toBeNull();

    process.env.BLENDER_MCP_COMMAND = '/nonexistent/blender-mcp';
    try {
      const bad = await request(app).post(`/api/v3/spaces/${ws.spaceId}/connectors/${id}/test`).send({});
      expect(bad.status).toBe(200);
      expect(bad.body.data.check.ok).toBe(false);
      expect(bad.body.data.check.error_code).toBe('spawn');
      expect(bad.body.data.connector.last_error).toMatch(/spawn/);
      expect(bad.body.data.connector.status).toBe('active'); // a failed check never disables
    } finally {
      process.env.BLENDER_MCP_COMMAND = FAKE_MCP;
    }
  });

  it('POST /test on a disabled connector does not launch the MCP', async () => {
    const app = appFor(ws.userId);
    const { id } = (await createMcpConnector(app, ws.spaceId)).body.data.connector;
    await request(app).patch(`/api/v3/spaces/${ws.spaceId}/connectors/${id}`).send({ enabled: false });

    process.env.BLENDER_MCP_COMMAND = '/nonexistent/blender-mcp'; // would fail if spawned
    try {
      const res = await request(app).post(`/api/v3/spaces/${ws.spaceId}/connectors/${id}/test`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.check).toMatchObject({ ok: false, error_code: 'disabled' });
    } finally {
      process.env.BLENDER_MCP_COMMAND = FAKE_MCP;
    }
  });

  it('PATCH toggles enabled and the gate follows it live (open sessions included)', async () => {
    const app = appFor(ws.userId);
    const { id } = (await createMcpConnector(app, ws.spaceId)).body.data.connector;

    // A session minted while the connector was active keeps its token…
    const env = await buildMcpGateEnv({ agentId: ALLOWED_AGENT_ID, spaceId: ws.spaceId });
    const token = env[GATE_TOKEN_ENV('blender_mcp')];
    const gate = () =>
      request(app).get('/api/v3/connectors/mcp-gate').set('Authorization', `Bearer ${token}`);

    expect((await gate()).body.data).toMatchObject({ allowed: true, reason: 'ok', connector_id: id });

    const off = await request(app).patch(`/api/v3/spaces/${ws.spaceId}/connectors/${id}`).send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.data.connector.status).toBe('disabled');
    expect(off.body.data.connector.enabled).toBe(false);
    // …but every call is re-checked against the row, so it is cut off now.
    expect((await gate()).body.data).toMatchObject({ allowed: false, reason: 'disabled' });
    // And no new session gets a token at all.
    expect(await buildMcpGateEnv({ agentId: ALLOWED_AGENT_ID, spaceId: ws.spaceId })).toEqual({});

    const on = await request(app).patch(`/api/v3/spaces/${ws.spaceId}/connectors/${id}`).send({ enabled: true });
    expect(on.body.data.connector.status).toBe('active');
    expect((await gate()).body.data).toMatchObject({ allowed: true });

    const bad = await request(app).patch(`/api/v3/spaces/${ws.spaceId}/connectors/${id}`).send({ enabled: 'yes' });
    expect(bad.status).toBe(400);

    const audit = await dbGet(
      `SELECT action FROM audit_log WHERE entity_type = 'space_connector' AND entity_id = ? ORDER BY id DESC LIMIT 1`,
      [String(id)]
    );
    expect(audit.action).toBe('connector.enable');
  });

  it('gate rejects bad tokens, tokens for a revoked row, and a forged scope', async () => {
    const app = appFor(ws.userId);
    const { id } = (await createMcpConnector(app, ws.spaceId)).body.data.connector;
    const env = await buildMcpGateEnv({ agentId: ALLOWED_AGENT_ID, spaceId: ws.spaceId });
    const token = env[GATE_TOKEN_ENV('blender_mcp')];

    expect((await request(app).get('/api/v3/connectors/mcp-gate')).status).toBe(401);
    expect(
      (await request(app).get('/api/v3/connectors/mcp-gate').set('Authorization', 'Bearer nope')).status
    ).toBe(401);

    // A token whose claims name another agent must be denied even if signed.
    const forged = jwt.sign(
      { typ: 'mcp_gate', connector_id: id, agent_id: OTHER_AGENT_ID, space_id: ws.spaceId },
      process.env.JWT_SECRET
    );
    const f = await request(app).get('/api/v3/connectors/mcp-gate').set('Authorization', `Bearer ${forged}`);
    expect(f.body.data).toMatchObject({ allowed: false, reason: 'agent_not_allowed' });

    await request(app).delete(`/api/v3/spaces/${ws.spaceId}/connectors/${id}`);
    const r = await request(app).get('/api/v3/connectors/mcp-gate').set('Authorization', `Bearer ${token}`);
    expect(r.body.data).toMatchObject({ allowed: false, reason: 'revoked' });
  });

  it('PATCH on a revoked row is refused', async () => {
    const app = appFor(ws.userId);
    const { id } = (await createMcpConnector(app, ws.spaceId)).body.data.connector;
    await request(app).delete(`/api/v3/spaces/${ws.spaceId}/connectors/${id}`);
    const res = await request(app).patch(`/api/v3/spaces/${ws.spaceId}/connectors/${id}`).send({ enabled: true });
    expect(res.status).toBe(409);
  });

  it('api_key connectors still create, test and toggle (regression)', async () => {
    const app = appFor(ws.userId);
    const res = await request(app)
      .post(`/api/v3/spaces/${ws.spaceId}/connectors`)
      .send({ type_slug: 'custom_api_key', display_name: 'Key', fields: { api_key: 'k-1' } });
    expect(res.status).toBe(201);
    const c = res.body.data.connector;
    createdConnectorIds.push(c.id);
    expect(c.kind).toBe('api_key');
    expect(c.has_payload).toBe(true);
    expect(c.enabled).toBe(true);
    expect(c.mcp).toBeUndefined();

    const t = await request(app).post(`/api/v3/spaces/${ws.spaceId}/connectors/${c.id}/test`).send({});
    expect(t.status).toBe(200);
    expect(t.body.data.check.ok).toBe(true);

    const off = await request(app).patch(`/api/v3/spaces/${ws.spaceId}/connectors/${c.id}`).send({ enabled: false });
    expect(off.body.data.connector.status).toBe('disabled');
  });
});
