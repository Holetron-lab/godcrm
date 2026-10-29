// @vitest-environment node
/**
 * POST /spaces/:spaceId/connectors/:id/test through the REAL launcher:
 *
 *   route → blender_mcp.test() → scripts/blender-mcp/scoped-mcp.py
 *         → (gate token?) GET /api/v3/connectors/mcp-gate  [this very app, listening]
 *         → fake upstream MCP (fixtures/fake-mcp-server.mjs)
 *
 * Staging acceptance 20450 found the check reporting `ok:true, 0 tools,
 * blender-scope-inactive` because no gate env reached the wrapper. These
 * tests pin the whole path: a successful check means the upstream answered,
 * and every way the gate can say no is a failed check — never a green one.
 */
import './../../test/setup.js';
import crypto from 'crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WRAPPER = path.resolve(__dirname, '../../../scripts/blender-mcp/scoped-mcp.py');
const FAKE_MCP = path.join(__dirname, 'fixtures', 'fake-mcp-server.mjs');
const ALLOWED_AGENT_ID = 900174643;

if (!process.env.CRM_CREDENTIAL_KEY) {
  process.env.CRM_CREDENTIAL_KEY = crypto.randomBytes(32).toString('hex');
}
process.env.BLENDER_MCP_COMMAND = WRAPPER;
process.env.BLENDER_MCP_UPSTREAM_JSON = JSON.stringify([process.execPath, FAKE_MCP]);
process.env.BLENDER_MCP_AGENT_ID = String(ALLOWED_AGENT_ID);

const { dbRun, dbGet } = await import('../../database/connection.js');
const { createEphemeralWorkspace } = await import('../../tests/helpers/workspace-fixture.js');
const { up: migrate097 } = await import('../../database/migrations/knex/097_space_connectors_mcp_kind.js');
const { default: vault } = await import('../../services/connectors/CredentialVault.js');
const { default: authedRouter, connectorsCallbackRouter } = await import('../../routes/v3/connectors.js');

let ws;
let gateServer;
const savedPort = process.env.PORT;

function appFor(userId) {
  const app = express();
  app.use(express.json());
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

async function createAndTest(app, spaceId, { before } = {}) {
  const created = await request(app)
    .post(`/api/v3/spaces/${spaceId}/connectors`)
    .send({ type_slug: 'blender_mcp', display_name: 'Blender (home)' });
  expect(created.status).toBe(201);
  const { id } = created.body.data.connector;
  if (before) await before(id);
  const res = await request(app).post(`/api/v3/spaces/${spaceId}/connectors/${id}/test`).send({});
  expect(res.status).toBe(200);
  return { id, check: res.body.data.check, connector: res.body.data.connector };
}

beforeAll(async () => {
  await vault.init();
  await migrate097({ raw: (sql) => dbRun(sql) });
  // The wrapper asks the gate over HTTP, so the real route has to listen.
  gateServer = express().use('/api/v3/connectors', connectorsCallbackRouter).listen(0, '127.0.0.1');
  await new Promise((r) => gateServer.once('listening', r));
  process.env.PORT = String(gateServer.address().port);
});

afterAll(async () => {
  if (savedPort === undefined) delete process.env.PORT;
  else process.env.PORT = savedPort;
  await new Promise((r) => gateServer.close(r));
  await vault.shutdown();
});

beforeEach(async () => {
  ws = await createEphemeralWorkspace({ dashboard: false, table: false, label: 'blender-mcp-gate' });
  process.env.BLENDER_MCP_SPACE_ID = String(ws.spaceId);
});

afterEach(async () => {
  await dbRun('DELETE FROM space_connectors WHERE space_id = ?', [ws.spaceId]);
  await ws.cleanup();
});

describe('POST /test through scoped-mcp.py and the live gate', () => {
  it('mints the gate env for the row: the wrapper opens the upstream and the tools are counted', async () => {
    const { check, connector } = await createAndTest(appFor(ws.userId), ws.spaceId);
    expect(check.ok).toBe(true);
    expect(check.tool_count).toBe(2);
    expect(check.server_name).toBe('fake-mcp');
    expect(check.error_code).toBeUndefined();
    // Scope env travels wrapper → upstream unchanged.
    expect(check.server_info.agent_id).toBe(String(ALLOWED_AGENT_ID));
    expect(check.server_info.space_id).toBe(String(ws.spaceId));
    expect(connector.last_error).toBeNull();
    expect(connector.last_checked_at).not.toBeNull();
  });

  it('never reports success when the wrapper had no gate token (staging 20450 repro)', async () => {
    // Without JWT_SECRET no token can be minted — the exact env the wrapper
    // saw on staging: it answers as blender-scope-inactive with zero tools.
    const secret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      const { check, connector } = await createAndTest(appFor(ws.userId), ws.spaceId);
      expect(check.ok).toBe(false);
      expect(check.error_code).toBe('gate');
      expect(check.error).toMatch(/no_gate_token/);
      expect(connector.last_error).toMatch(/^gate: /);
    } finally {
      process.env.JWT_SECRET = secret;
    }
  });

  it('fails as gate when the wrapper cannot reach the gate route', async () => {
    const port = process.env.PORT;
    process.env.PORT = '1'; // nothing listens there
    try {
      const { check } = await createAndTest(appFor(ws.userId), ws.spaceId);
      expect(check.ok).toBe(false);
      expect(check.error_code).toBe('gate');
      expect(check.error).toMatch(/gate_unreachable/);
    } finally {
      process.env.PORT = port;
    }
  });

  it('fails as gate when the server pin no longer covers the row (scope mismatch), without launching', async () => {
    const { check, connector } = await createAndTest(appFor(ws.userId), ws.spaceId, {
      before: () => {
        process.env.BLENDER_MCP_SPACE_ID = String(ws.spaceId + 1);
        process.env.BLENDER_MCP_COMMAND = '/nonexistent/blender-mcp'; // would surface as 'spawn' if launched
      },
    });
    process.env.BLENDER_MCP_COMMAND = WRAPPER;
    expect(check.ok).toBe(false);
    expect(check.error_code).toBe('gate');
    expect(check.error).toMatch(/space_not_allowed/);
    expect(connector.last_error).toMatch(/space_not_allowed/);
    expect(connector.status).toBe('active'); // a failed check never flips the switch
  });

  it('a disabled row is not launched and stays disabled', async () => {
    const app = appFor(ws.userId);
    const { id, check } = await createAndTest(app, ws.spaceId, {
      before: async (cid) => {
        await request(app).patch(`/api/v3/spaces/${ws.spaceId}/connectors/${cid}`).send({ enabled: false });
      },
    });
    expect(check).toMatchObject({ ok: false, error_code: 'disabled' });
    const row = await dbGet('SELECT status, last_checked_at FROM space_connectors WHERE id = ?', [id]);
    expect(row.status).toBe('disabled');
    expect(row.last_checked_at).toBeNull();
  });

  it('a revoked row is not launched', async () => {
    const app = appFor(ws.userId);
    const { check } = await createAndTest(app, ws.spaceId, {
      before: async (cid) => {
        await request(app).delete(`/api/v3/spaces/${ws.spaceId}/connectors/${cid}`);
      },
    });
    expect(check.ok).toBe(false);
    expect(check.error_code).toBe('disabled');
    expect(check.error).toMatch(/revoked/);
  });
});
