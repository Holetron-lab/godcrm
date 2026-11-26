// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  remote: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../../services/EffectiveRoleService.js', async (original) => ({
  ...await original(),
  hasPermission: mocks.hasPermission,
}));
vi.mock('../../../services/connectors/remoteMcp.js', async (original) => ({
  ...await original(),
  runRemoteMcp: mocks.remote,
}));
vi.mock('../../../utils/logger.js', () => {
  const apiLogger = {
    debug: vi.fn(), info: mocks.logInfo, warn: mocks.logWarn, error: mocks.logError,
    fatal: vi.fn(), child: () => apiLogger,
  };
  return { apiLogger, aiLogger: apiLogger, logger: apiLogger };
});

import { dbAll, dbGet, dbRun, destroyAdapter, getAdapter, resetAdapter, safeJsonParse } from '../../../database/connection.js';
import { createEphemeralWorkspace } from '../../../tests/helpers/workspace-fixture.js';
import { installModule } from '../../../services/ModuleInstaller.js';
import { resolveAllowedTools } from '../../../services/agent-loop/tools.js';
import { getAllowedTools } from '../ai-agents/sharedTools.js';
import { executeTool } from '../../../services/agent-tools/executor.js';
import secretsVault from '../../../services/secrets/SecretsVault.js';
import moduleRouter from '../module-install.js';
import remoteConnectorRouter from '../remote-connectors.js';

const SECRET_VALUE = 'w61-safe-test-fixture-value';
let ws;
let permissionRole;
const app = express();
app.use(express.json());
app.use((req, _res, next) => { req.user = { id: ws?.userId }; next(); });
app.use('/modules', moduleRouter);
app.use(remoteConnectorRouter);

function blueprint(key = 'service-pack') {
  return {
    key,
    version: '2.0.0',
    schema: 2,
    title: 'Service pack',
    projects: [{ key: 'main', title: 'Main' }],
    services: [
      { key: 'reader', type_slug: 'custom_mcp', url: 'https://example.com/mcp', allowed_tools: ['read'], secrets: ['BEARER_TOKEN'] },
      { key: 'writer', type_slug: 'custom_mcp', url: 'https://example.org/mcp', allowed_tools: ['write'], secrets: ['BEARER_TOKEN'] },
    ],
    agents: [{
      key: 'helper',
      tools: ['read', 'write'],
      config: { name: 'Module helper', system_prompt: 'Use only the declared module tools.' },
    }],
    automations: [{
      key: 'on_create',
      table: 'items',
      config: {
        name: 'On item create', trigger_type: 'row_create', trigger_config: {},
        action_type: 'notification', action_config: {}, is_active: true,
      },
    }],
    tables: [{ key: 'items', name: `w61_items_${ws.token.replaceAll('-', '_')}`, columns: [{ column_name: 'name', type: 'text' }] }],
  };
}

function bindings() {
  return {
    projects: { main: { action: 'use', project_id: ws.projectId } },
    secrets: { BEARER_TOKEN: 'vault:BEARER_TOKEN' },
  };
}

function install(body, dryRun = false) {
  return request(app).post('/modules/install').send({
    space_id: ws.spaceId,
    project_id: ws.projectId,
    blueprint: body,
    bindings: bindings(),
    dry_run: dryRun,
  });
}

async function createAgentRegistry() {
  const result = await dbRun(
    "INSERT INTO universal_tables (project_id, name, display_name, table_type) VALUES (?, 'AI Agents', 'AI Agents', 'ai_agents')",
    [ws.projectId],
  );
  return result.lastInsertRowid;
}

async function componentRows() {
  return dbAll(
    `SELECT tr.id, tr.table_id, tr.data FROM table_rows tr
     JOIN universal_tables ut ON ut.id = tr.table_id
     JOIN projects p ON p.id = ut.project_id WHERE p.space_id = ?`,
    [ws.spaceId],
  );
}

beforeAll(async () => {
  await resetAdapter();
  const actual = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
});

beforeEach(async () => {
  ws = await createEphemeralWorkspace({ label: 'module-w61', table: false });
  permissionRole = 'owner';
  mocks.hasPermission.mockImplementation((_userId, required) => (
    permissionRole === 'owner' || (permissionRole === 'member' && required !== 'admin')
  ));
  mocks.remote.mockReset();
  mocks.remote.mockResolvedValue({ content: [{ type: 'text', text: 'safe-ok' }] });
  mocks.logInfo.mockClear();
  mocks.logWarn.mockClear();
  mocks.logError.mockClear();
  vi.stubEnv('SECRETS_MASTER_KEY', 'b'.repeat(64));
  await secretsVault.init({ adapter: await getAdapter(), allowEnvFallback: false });
  await secretsVault.putSecret('BEARER_TOKEN', SECRET_VALUE, { actor: ws.userId, spaceId: ws.spaceId });
});

afterEach(async () => {
  if (ws) {
    await dbRun(`DELETE FROM audit_log WHERE entity_type = 'space_connector' AND entity_id IN (
      SELECT id::text FROM space_connectors WHERE space_id = ?
    )`, [ws.spaceId]);
    await dbRun('DELETE FROM space_connectors WHERE space_id = ?', [ws.spaceId]);
    await dbRun('DELETE FROM _secrets WHERE space_id = ?', [ws.spaceId]);
    await dbRun('DELETE FROM module_installs WHERE space_id = ?', [ws.spaceId]);
    await dbRun('DELETE FROM module_installations WHERE space_id = ?', [ws.spaceId]);
    await dbRun('DELETE FROM modules WHERE space_id = ?', [ws.spaceId]);
    await dbRun(`DELETE FROM widgets WHERE owner_kind = 'space' AND owner_id = ?`, [ws.spaceId]);
    await dbRun('DELETE FROM table_rows WHERE table_id IN (SELECT t.id FROM universal_tables t JOIN projects p ON p.id = t.project_id WHERE p.space_id = ?)', [ws.spaceId]);
    await dbRun('DELETE FROM table_columns WHERE table_id IN (SELECT t.id FROM universal_tables t JOIN projects p ON p.id = t.project_id WHERE p.space_id = ?)', [ws.spaceId]);
    await dbRun('DELETE FROM universal_tables WHERE project_id IN (SELECT id FROM projects WHERE space_id = ?)', [ws.spaceId]);
    await dbRun('DELETE FROM dashboards WHERE space_id = ? OR project_id IN (SELECT id FROM projects WHERE space_id = ?)', [ws.spaceId, ws.spaceId]);
    await dbRun('DELETE FROM projects WHERE space_id = ? AND id <> ?', [ws.spaceId, ws.projectId]);
    await ws.cleanup();
  }
  await secretsVault.shutdown();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await secretsVault.shutdown();
  await destroyAdapter();
});

describe('ADR-207 W6.1 services, agents and vault bindings', () => {
  it('keeps dry-run and member denial free of connector, agent, automation and journal writes', async () => {
    const agentTableId = await createAgentRegistry();
    const body = blueprint();

    const dry = await install(body, true);
    expect(dry.status).toBe(200);
    expect(dry.body.data.plan.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'reader', action: 'create' }),
      expect.objectContaining({ key: 'writer', action: 'create' }),
    ]));
    expect(dry.body.data.plan.agents[0]).toMatchObject({ key: 'helper', action: 'create' });
    expect(dry.body.data.plan.automations[0]).toMatchObject({ key: 'on_create', action: 'create' });
    expect(dry.body.data.plan.conflicts).toEqual([]);
    expect(JSON.stringify(dry.body)).not.toContain(SECRET_VALUE);
    expect(await dbAll('SELECT id FROM space_connectors WHERE space_id = ?', [ws.spaceId])).toEqual([]);
    expect((await componentRows()).filter((row) => row.table_id === agentTableId)).toEqual([]);
    expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toEqual([]);

    permissionRole = 'member';
    const denied = await install(body);
    expect(denied.status).toBe(403);
    expect(await dbAll('SELECT id FROM space_connectors WHERE space_id = ?', [ws.spaceId])).toEqual([]);
    expect((await componentRows()).filter((row) => row.table_id === agentTableId)).toEqual([]);
    expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toEqual([]);
  });

  it('rejects raw and undeclared secret bindings before any side effect', async () => {
    await createAgentRegistry();
    for (const secretBinding of ['raw-secret-value', 'vault:OTHER_SECRET']) {
      const response = await request(app).post('/modules/install').send({
        space_id: ws.spaceId,
        project_id: ws.projectId,
        blueprint: blueprint(),
        bindings: { ...bindings(), secrets: { BEARER_TOKEN: secretBinding } },
      });
      expect(response.status).toBe(422);
      expect(JSON.stringify(response.body)).not.toContain(SECRET_VALUE);
      expect(await dbAll('SELECT id FROM space_connectors WHERE space_id = ?', [ws.spaceId])).toEqual([]);
      expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toEqual([]);
    }
  });

  it('installs two connectors and a shared agent, enforces both allowlists, and uninstalls without deleting vault values', async () => {
    const agentTableId = await createAgentRegistry();
    const applied = await install(blueprint());
    expect(applied.status).toBe(200);
    expect(JSON.stringify(applied.body)).not.toContain(SECRET_VALUE);

    const connectors = await dbAll('SELECT * FROM space_connectors WHERE space_id = ? ORDER BY id', [ws.spaceId]);
    expect(connectors).toHaveLength(2);
    expect(connectors.map((row) => safeJsonParse(row.custom_definition).allowed_tools)).toEqual([['read'], ['write']]);
    for (const connector of connectors) {
      expect(connector.encrypted_payload).toEqual({});
      expect(JSON.stringify(connector)).not.toContain(SECRET_VALUE);
      expect(safeJsonParse(connector.custom_definition).secret_refs).toEqual({ BEARER_TOKEN: 'vault:BEARER_TOKEN' });
    }

    const agentRow = await dbGet('SELECT id, data FROM table_rows WHERE table_id = ?', [agentTableId]);
    const agent = safeJsonParse(agentRow.data);
    expect(agent).toMatchObject({ name: 'Module helper', tools: ['read', 'write'] });
    expect(JSON.stringify(agent)).not.toContain(SECRET_VALUE);
    const automationRows = (await componentRows()).filter((row) => safeJsonParse(row.data).__module?.kind === 'automation');
    expect(automationRows).toHaveLength(1);
    expect(safeJsonParse(automationRows[0].data).table_id).toBe(applied.body.data.mapping.items.table_id);

    const journal = await dbGet('SELECT bindings FROM module_installs WHERE module_key = ? AND space_id = ?', ['service-pack', ws.spaceId]);
    expect(safeJsonParse(journal.bindings).secrets).toEqual({ BEARER_TOKEN: 'vault:BEARER_TOKEN' });
    expect(JSON.stringify(journal)).not.toContain(SECRET_VALUE);
    const storedInstallation = await dbGet('SELECT blueprint FROM module_installations WHERE module_key = ? AND space_id = ?', ['service-pack', ws.spaceId]);
    expect(JSON.stringify(storedInstallation)).not.toContain(SECRET_VALUE);

    const repeated = await install(blueprint());
    expect(repeated.status).toBe(200);
    expect(repeated.body.data.status).toBe('unchanged');
    expect(await dbAll('SELECT id FROM space_connectors WHERE space_id = ?', [ws.spaceId])).toHaveLength(2);

    const next = blueprint();
    next.version = '2.1.0';
    next.services[1].allowed_tools = ['write', 'delete'];
    const upgraded = await request(app).post('/modules/service-pack/upgrade').send({ space_id: ws.spaceId, blueprint: next });
    expect(upgraded.status).toBe(200);
    const upgradedWriter = await dbGet('SELECT custom_definition FROM space_connectors WHERE id = ?', [connectors[1].id]);
    expect(safeJsonParse(upgradedWriter.custom_definition).allowed_tools).toEqual(['write', 'delete']);

    const human = await request(app)
      .post(`/spaces/${ws.spaceId}/connectors/${connectors[0].id}/tools/call`)
      .send({ name: 'read', arguments: {} });
    expect(human.status).toBe(200);
    expect(mocks.remote).toHaveBeenLastCalledWith(
      { url: 'https://example.com/mcp', bearer_token: SECRET_VALUE },
      { name: 'read', args: {} },
    );

    const allowedTools = await resolveAllowedTools(agent, ws.spaceId);
    expect(allowedTools.map((tool) => tool.function.name)).toEqual(expect.arrayContaining(['read', 'write']));
    expect((await getAllowedTools(agent, ws.spaceId)).map((tool) => tool.function.name)).toEqual(expect.arrayContaining(['read', 'write']));
    const agentResult = await executeTool('write', {}, ws.userId, {
      allowedTools, agentId: agentRow.id, agentName: agent.name, spaceId: ws.spaceId,
    });
    expect(agentResult).toEqual({ content: [{ type: 'text', text: 'safe-ok' }] });
    expect(mocks.remote).toHaveBeenLastCalledWith(
      { url: 'https://example.org/mcp', bearer_token: SECRET_VALUE },
      { name: 'write', args: {} },
    );

    const callsBeforeDenied = mocks.remote.mock.calls.length;
    const outsideAgent = await executeTool('read', {}, ws.userId, {
      allowedTools: [{ type: 'function', function: { name: 'write' } }],
      agentId: agentRow.id, spaceId: ws.spaceId,
    });
    expect(outsideAgent.error).toBeTruthy();
    const outsideConnector = await executeTool('delete', {}, ws.userId, {
      allowedTools: [{ type: 'function', function: { name: 'delete' }, x_connector_id: connectors[0].id, x_space_id: ws.spaceId }],
      agentId: agentRow.id, spaceId: ws.spaceId,
    });
    expect(outsideConnector.error).toBeTruthy();
    const foreignSpace = await executeTool('read', {}, ws.userId, {
      allowedTools, agentId: agentRow.id, spaceId: ws.spaceId + 1,
    });
    expect(foreignSpace.error).toBe('tool_not_permitted');
    expect(mocks.remote).toHaveBeenCalledTimes(callsBeforeDenied);

    const removed = await request(app).post('/modules/service-pack/uninstall').send({ space_id: ws.spaceId });
    expect(removed.status).toBe(200);
    expect(JSON.stringify(removed.body)).not.toContain(SECRET_VALUE);
    expect((await dbAll('SELECT status FROM space_connectors WHERE space_id = ?', [ws.spaceId])).map((row) => row.status)).toEqual(['disabled', 'disabled']);
    expect(await dbGet('SELECT id FROM table_rows WHERE id = ?', [agentRow.id])).toBeNull();
    expect((await componentRows()).filter((row) => safeJsonParse(row.data).__module?.kind === 'automation')).toEqual([]);
    expect(await secretsVault.getSecret('BEARER_TOKEN', { spaceId: ws.spaceId })).toBe(SECRET_VALUE);
    expect(JSON.stringify([
      ...mocks.logInfo.mock.calls, ...mocks.logWarn.mock.calls, ...mocks.logError.mock.calls,
    ])).not.toContain(SECRET_VALUE);
  });

  it('applies the service tool invariant to config.tools before any side effect', async () => {
    const body = blueprint();
    body.agents = [{ key: 'helper', config: { name: 'Module helper', tools: ['read', 'delete'] } }];
    const response = await install(body);

    expect(response.status).toBe(409);
    expect(response.body.error.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'AGENT_TOOLS_NOT_ALLOWED', tools: ['delete'] }),
    ]));
    expect(await dbAll('SELECT id FROM space_connectors WHERE space_id = ?', [ws.spaceId])).toEqual([]);
    expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toEqual([]);
  });

  it('resolves a declared vault key as the bearer token and rejects unsupported secret lists', async () => {
    await secretsVault.putSecret('MAIL_API_KEY', SECRET_VALUE, { actor: ws.userId, spaceId: ws.spaceId });
    const body = blueprint();
    body.services = [{ ...body.services[0], secrets: ['MAIL_API_KEY'] }];
    body.agents = [];
    body.automations = [];
    const applied = await request(app).post('/modules/install').send({
      space_id: ws.spaceId,
      project_id: ws.projectId,
      blueprint: body,
      bindings: { ...bindings(), secrets: { MAIL_API_KEY: 'vault:MAIL_API_KEY' } },
    });
    expect(applied.status).toBe(200);
    const connector = await dbGet('SELECT * FROM space_connectors WHERE space_id = ?', [ws.spaceId]);
    expect(safeJsonParse(connector.custom_definition).secret_refs).toEqual({ MAIL_API_KEY: 'vault:MAIL_API_KEY' });

    const called = await request(app)
      .post(`/spaces/${ws.spaceId}/connectors/${connector.id}/tools/call`)
      .send({ name: 'read', arguments: {} });
    expect(called.status).toBe(200);
    expect(mocks.remote).toHaveBeenLastCalledWith(
      { url: 'https://example.com/mcp', bearer_token: SECRET_VALUE },
      { name: 'read', args: {} },
    );

    await secretsVault.deleteSecret('MAIL_API_KEY', { actor: ws.userId, spaceId: ws.spaceId });
    const callsBeforeMissingSecret = mocks.remote.mock.calls.length;
    const missingSecret = await request(app)
      .post(`/spaces/${ws.spaceId}/connectors/${connector.id}/tools/call`)
      .send({ name: 'read', arguments: {} });
    expect(missingSecret.status).toBe(502);
    expect(mocks.remote).toHaveBeenCalledTimes(callsBeforeMissingSecret);

    body.services[0].secrets = ['MAIL_API_KEY', 'BEARER_TOKEN'];
    const rejected = await request(app).post('/modules/install').send({
      space_id: ws.spaceId,
      project_id: ws.projectId,
      blueprint: body,
      bindings: { ...bindings(), secrets: { MAIL_API_KEY: 'vault:MAIL_API_KEY', BEARER_TOKEN: 'vault:BEARER_TOKEN' } },
    });
    expect(rejected.status).toBe(422);
  });

  it('rolls back connectors, agents, automations and journals when the final install write fails', async () => {
    const agentTableId = await createAgentRegistry();
    await expect(installModule({
      blueprint: blueprint('rollback-pack'),
      spaceId: ws.spaceId,
      projectId: ws.projectId,
      userId: 2147483647,
      bindings: bindings(),
    })).rejects.toThrow();

    expect(await dbAll('SELECT id FROM space_connectors WHERE space_id = ?', [ws.spaceId])).toEqual([]);
    expect(await dbAll('SELECT id FROM table_rows WHERE table_id = ?', [agentTableId])).toEqual([]);
    expect((await componentRows()).filter((row) => safeJsonParse(row.data).__module?.kind === 'automation')).toEqual([]);
    expect(await dbAll('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toEqual([]);
    expect(await dbAll('SELECT id FROM module_installs WHERE space_id = ?', [ws.spaceId])).toEqual([]);
  });
});
