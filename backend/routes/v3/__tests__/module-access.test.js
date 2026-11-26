import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { dbGet, dbRun, resetAdapter, destroyAdapter } from '../../../database/connection.js';
import { createEphemeralWorkspace, fixtureToken } from '../../../tests/helpers/workspace-fixture.js';
import { createModule, getModulesBySpace } from '../../../services/ModuleService.js';
import widgetRoutes from '../widgets.js';
import installRoutes from '../module-install.js';

const ROLE_GRANTS = { admin: 'admin', member: 'editor', viewer: 'viewer' };
const EXPECTED_MODULES = {
  owner: ['admin', 'member', 'owner', 'viewer'],
  admin: ['admin', 'member', 'viewer'],
  member: ['member', 'viewer'],
  viewer: ['viewer'],
};

let ws;
let currentUserId;
let extraUserIds;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: currentUserId };
  next();
});
app.use('/api/v3', widgetRoutes);
app.use('/modules', installRoutes);

async function createUser(role) {
  const token = fixtureToken();
  const result = await dbRun(
    `INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified)
     VALUES (?, ?, ?, ?, ?)`,
    [`test-module-access-${token}@test.godcrm.local`, 'hash', `Module ${role} ${token}`, 'key', 1],
  );
  const userId = result.lastInsertRowid;
  extraUserIds.push(userId);
  if (role !== 'owner') {
    await dbRun(
      'INSERT INTO user_access_permissions (user_id, space_id, access_level, granted_by) VALUES (?, ?, ?, ?)',
      [userId, ws.spaceId, ROLE_GRANTS[role], ws.userId],
    );
  }
  return userId;
}

async function createStandaloneModule(accessLevel) {
  const result = await dbRun(
    `INSERT INTO widgets (dashboard_id, owner_kind, owner_id, widget_type, preset_name, title, config, position, created_by)
     VALUES (NULL, 'space', ?, 'preset', 'table_view', ?, ?, ?, ?)`,
    [ws.spaceId, `${accessLevel} application`, JSON.stringify({ secret: `do-not-leak-${accessLevel}` }), '{}', ws.userId],
  );
  await createModule({ widget_id: result.lastInsertRowid, space_id: ws.spaceId, access_level: accessLevel });
  return result.lastInsertRowid;
}

function installAs(userId, blueprint, dryRun = true) {
  currentUserId = userId;
  return request(app).post('/modules/install').send({
    space_id: ws.spaceId,
    project_id: ws.projectId,
    blueprint,
    dry_run: dryRun,
  });
}

function dataBlueprint(key = 'member-data') {
  return {
    key,
    version: '1.0.0',
    tables: [{ key: 'items', name: `${key.replaceAll('-', '_')}_items`, columns: [{ column_name: 'name', type: 'text' }] }],
  };
}

beforeAll(async () => {
  await resetAdapter();
  const actual = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
});

beforeEach(async () => {
  ws = await createEphemeralWorkspace({ label: 'module-access', table: false });
  currentUserId = ws.userId;
  extraUserIds = [];
});

afterEach(async () => {
  await dbRun('DELETE FROM module_installations WHERE space_id = ?', [ws.spaceId]);
  await dbRun('DELETE FROM user_access_permissions WHERE space_id = ?', [ws.spaceId]);
  await dbRun("DELETE FROM widgets WHERE owner_kind = 'space' AND owner_id = ?", [ws.spaceId]);
  await ws.cleanup();
  for (const userId of extraUserIds) {
    await dbRun('DELETE FROM users WHERE id = ?', [userId]);
  }
  await destroyAdapter();
});

afterAll(destroyAdapter);

describe('ADR-207 W1.4 module visibility', () => {
  it.each(['owner', 'admin', 'member', 'viewer'])('filters getModulesBySpace for %s', async (role) => {
    for (const accessLevel of ['owner', 'admin', 'member', 'viewer']) {
      await createStandaloneModule(accessLevel);
    }
    const userId = role === 'owner' ? ws.userId : await createUser(role);

    const modules = await getModulesBySpace(ws.spaceId, userId);

    expect(modules.map((module) => module.access_level).sort()).toEqual(EXPECTED_MODULES[role]);
  });

  it('treats legacy null access_level as member', async () => {
    const widgetId = await createStandaloneModule('member');
    await dbRun('UPDATE modules SET access_level = NULL WHERE widget_id = ?', [widgetId]);
    const memberId = await createUser('member');
    const viewerId = await createUser('viewer');

    expect(await getModulesBySpace(ws.spaceId, memberId)).toHaveLength(1);
    expect(await getModulesBySpace(ws.spaceId, viewerId)).toEqual([]);
  });

  it.each(['owner', 'admin', 'member', 'viewer'])('enforces standalone GET /widgets/:id for %s without leaking config', async (role) => {
    const userId = role === 'owner' ? ws.userId : await createUser(role);
    for (const accessLevel of ['owner', 'admin', 'member', 'viewer']) {
      const widgetId = await createStandaloneModule(accessLevel);
      currentUserId = userId;

      const response = await request(app).get(`/api/v3/widgets/${widgetId}`);
      const allowed = EXPECTED_MODULES[role].includes(accessLevel);

      expect(response.status).toBe(allowed ? 200 : 403);
      if (allowed) {
        expect(response.body.data.config.secret).toBe(`do-not-leak-${accessLevel}`);
      } else {
        expect(response.body.data).toBeUndefined();
        expect(JSON.stringify(response.body)).not.toContain(`do-not-leak-${accessLevel}`);
      }
    }
  });
});

describe('ADR-207 standalone application navigation', () => {
  it('lists an installed app in its target project and not in a sibling project', async () => {
    const blueprint = {
      key: 'standalone-app', version: '2.0.0', schema: 2,
      projects: [{ key: 'main', title: 'Main' }],
      tables: [{ key: 'items', name: 'standalone_items', columns: [{ column_name: 'name', type: 'text' }] }],
      apps: [{ key: 'app', preset: 'table_view', table: 'items', config: { table_id: { $table: 'items' } } }],
      sidebar: [{ widget: 'app' }],
    };
    const installed = await installAs(ws.userId, blueprint, false);
    expect(installed.status).toBe(200);
    const widgetId = installed.body.data.widgets[0].widget_id;

    const target = await request(app).get(`/api/v3/projects/${ws.projectId}/widgets`);
    expect(target.status).toBe(200);
    expect(target.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: widgetId, title: 'app', is_module: true }),
    ]));

    const sibling = await dbRun(
      'INSERT INTO projects (space_id, owner_id, name, type) VALUES (?, ?, ?, ?)',
      [ws.spaceId, ws.userId, 'Sibling', 'business'],
    );
    const other = await request(app).get(`/api/v3/projects/${sibling.lastInsertRowid}/widgets`);
    expect(other.status).toBe(200);
    expect(other.body.data).toEqual([]);
  });
});

describe('ADR-207 W1.4 install permissions', () => {
  it('lets a member install a data-only module and rejects a viewer without writes', async () => {
    const memberId = await createUser('member');
    const viewerId = await createUser('viewer');

    const denied = await installAs(viewerId, dataBlueprint('viewer-data'), false);
    expect(denied.status).toBe(403);
    expect(await dbGet('SELECT id FROM module_installations WHERE space_id = ?', [ws.spaceId])).toBeNull();

    const installed = await installAs(memberId, dataBlueprint(), false);
    expect(installed.status).toBe(200);
    expect(installed.body.data.status).toBe('installed');
  });

  it.each(['agents', 'automations', 'services'])('requires admin for %s and lets an admin reach blueprint validation', async (section) => {
    const memberId = await createUser('member');
    const adminId = await createUser('admin');
    const blueprint = {
      ...dataBlueprint(`admin-${section}`),
      widgets: [{ key: 'board', preset_name: 'table_view', config: { table_id: { $table: 'items' } } }],
      [section]: [{ key: 'privileged_component' }],
    };

    const denied = await installAs(memberId, blueprint);
    expect(denied.status).toBe(403);

    const allowedRole = await installAs(adminId, blueprint);
    expect(allowedRole.status).toBe(422);
    expect(allowedRole.body.error.code).toBe('BLUEPRINT_INVALID');
  });
});
