import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import knex from 'knex';
import { dbGet, dbRun, resetAdapter, destroyAdapter } from '../../../database/connection.js';
import knexConfig from '../../../database/knexfile.js';
import { up } from '../../../database/migrations/knex/109_adr_0207_w41_module_registry.js';
import { createEphemeralWorkspace, fixtureToken } from '../../../tests/helpers/workspace-fixture.js';
import registryRoutes from '../module-registry.js';

const ROLE_GRANTS = { admin: 'admin', member: 'editor', viewer: 'viewer' };

let ws;
let migrationDb;
let currentUserId;
let extraUserIds;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: currentUserId };
  next();
});
app.use('/registry', registryRoutes);

function blueprint(key, version = '1.0.0', privileged = false) {
  return {
    key,
    version,
    schema: 2,
    title: `Catalog ${key}`,
    description: `Searchable description ${key}`,
    projects: [{ key: 'main', title: 'Main' }],
    requires: { tables: [] },
    tables: [{
      key: 'items', project: 'main', name: `${key.replaceAll('-', '_')}_items`,
      columns: [{ column_name: 'name', type: 'text' }],
    }],
    seed: [],
    apps: [{ key: 'app', preset: 'table_view', table: 'items', config: {} }],
    dashboards: [{ key: 'main', target: 'default', tiles: [
      { key: 'count', preset: 'number_widget', table: 'items', config: { aggregate: 'count' } },
    ] }],
    sidebar: [],
    services: privileged ? [{ key: 'mail', type_slug: 'remote_mcp', url: 'https://example.com/mcp', allowed_tools: [], secrets: [] }] : [],
    agents: [],
    automations: [],
  };
}

async function createUser(role, spaceId = ws.spaceId) {
  const token = fixtureToken();
  const result = await dbRun(
    `INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified)
     VALUES (?, ?, ?, ?, ?)`,
    [`test-module-registry-${token}@test.godcrm.local`, 'hash', `Registry ${role} ${token}`, 'key', 1],
  );
  const userId = result.lastInsertRowid;
  extraUserIds.push(userId);
  await dbRun(
    'INSERT INTO user_access_permissions (user_id, space_id, access_level, granted_by) VALUES (?, ?, ?, ?)',
    [userId, spaceId, ROLE_GRANTS[role], ws.userId],
  );
  return userId;
}

function call(method, path, userId, body) {
  currentUserId = userId;
  const pending = request(app)[method](path);
  return body === undefined ? pending : pending.send(body);
}

async function createDraft(key, version = '1.0.0', privileged = false, category = 'operations') {
  const response = await call('post', '/registry', ws.userId, {
    space_id: ws.spaceId,
    blueprint: blueprint(key, version, privileged),
    category,
  });
  expect(response.status).toBe(201);
  return response.body.data.item;
}

async function publish(key, version = '1.0.0', userId = ws.userId) {
  const response = await call('post', `/registry/${key}/publish`, userId, { space_id: ws.spaceId, version });
  expect(response.status).toBe(200);
  return response.body.data.item;
}

beforeAll(async () => {
  await resetAdapter();
  const actual = await dbGet('SELECT current_database() AS db, host(inet_server_addr()) AS host');
  expect(actual.db).toBe('godcrm_test');
  expect([null, '127.0.0.1', '::1']).toContain(actual.host);
  migrationDb = knex(knexConfig.getConfig('test'));
  await up(migrationDb);
});

beforeEach(async () => {
  ws = await createEphemeralWorkspace({ label: 'module-registry', table: false });
  currentUserId = ws.userId;
  extraUserIds = [];
});

afterEach(async () => {
  await dbRun('DELETE FROM module_registry WHERE publisher_space_id = ?', [ws.spaceId]);
  await dbRun('DELETE FROM module_installs WHERE space_id = ?', [ws.spaceId]);
  await dbRun('DELETE FROM user_access_permissions WHERE space_id = ?', [ws.spaceId]);
  await ws.cleanup();
  for (const userId of extraUserIds) {
    await dbRun('DELETE FROM users WHERE id = ?', [userId]);
  }
  await destroyAdapter();
});

afterAll(async () => {
  await migrationDb.destroy();
  await destroyAdapter();
});

describe('ADR-207 W4.1 registry origin lifecycle', () => {
  it('seeds the default catalog and refuses direct external creation', async () => {
    const catalog = await call('get', `/registry?space_id=${ws.spaceId}&origin=default`, ws.userId);
    expect(catalog.status).toBe(200);
    expect(catalog.body.data.items).toHaveLength(28);
    expect(catalog.body.data.items.every((item) => item.status === 'published')).toBe(true);

    const denied = await call('post', '/registry', ws.userId, {
      space_id: ws.spaceId,
      origin: 'external',
      blueprint: blueprint('direct-external'),
    });
    expect(denied.status).toBe(400);
    expect(denied.body.error.code).toBe('REGISTRY_ORIGIN_INVALID');
  });

  it.each(['admin', 'member', 'viewer'])('forbids %s to create, publish or moderate', async (role) => {
    const userId = await createUser(role);
    const created = await call('post', '/registry', userId, {
      space_id: ws.spaceId,
      blueprint: blueprint(`forbidden-${role}`),
    });
    expect(created.status).toBe(403);

    const key = `owner-only-${role}`;
    await createDraft(key);
    for (const [path, body] of [
      [`/registry/${key}/publish`, { space_id: ws.spaceId, version: '1.0.0' }],
      [`/registry/${key}/submit`, { space_id: ws.spaceId, version: '1.0.0' }],
      [`/registry/${key}/moderate`, { space_id: ws.spaceId, version: '1.0.0', decision: 'audited' }],
    ]) {
      const response = await call('post', path, userId, body);
      expect(response.status).toBe(403);
    }
  });

  it('copies default to internal, then moves only submitted internal to external', async () => {
    const defaults = await call('get', `/registry?space_id=${ws.spaceId}&origin=default`, ws.userId);
    const source = defaults.body.data.items[0];
    const install = await dbRun(
      `INSERT INTO module_installs (module_key, version, space_id, installed_by, access_level, bindings)
       VALUES (?, ?, ?, ?, 'member', ?::jsonb)`,
      [source.key, source.version, ws.spaceId, ws.userId, JSON.stringify({ tables: { keep: { action: 'connect', table_id: 1708 } } })],
    );
    const before = await dbGet('SELECT * FROM module_installs WHERE id = ?', [install.lastInsertRowid]);

    const published = await publish(source.key, source.version);
    expect(published.origin).toBe('internal');
    expect(published.status).toBe('published');
    expect(published.publisher_space_id).toBe(ws.spaceId);
    expect(published.checksum).toBe(source.checksum);

    const earlyAudit = await call('post', `/registry/${source.key}/moderate`, ws.userId, {
      space_id: ws.spaceId, version: source.version, decision: 'audited',
    });
    expect(earlyAudit.status).toBe(409);

    const submitted = await call('post', `/registry/${source.key}/submit`, ws.userId, {
      space_id: ws.spaceId, version: source.version,
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.item).toMatchObject({ origin: 'internal', status: 'submitted' });

    const audited = await call('post', `/registry/${source.key}/moderate`, ws.userId, {
      space_id: ws.spaceId, version: source.version, decision: 'audited',
    });
    expect(audited.status).toBe(200);
    expect(audited.body.data.item).toMatchObject({
      origin: 'external', status: 'audited', edge_source: 'godcrm.ai', edge_version: source.version,
    });

    const after = await dbGet('SELECT * FROM module_installs WHERE id = ?', [install.lastInsertRowid]);
    expect(after).toEqual(before);
    const defaultSource = await call('get', `/registry/${source.key}?space_id=${ws.spaceId}&origin=default&version=${source.version}`, ws.userId);
    expect(defaultSource.status).toBe(200);
  });

  it('supports rejected submissions without changing origin', async () => {
    await createDraft('rejected-module');
    await publish('rejected-module');
    await call('post', '/registry/rejected-module/submit', ws.userId, { space_id: ws.spaceId, version: '1.0.0' });
    const rejected = await call('post', '/registry/rejected-module/moderate', ws.userId, {
      space_id: ws.spaceId, version: '1.0.0', decision: 'rejected',
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.item).toMatchObject({ origin: 'internal', status: 'rejected', edge_source: 'instance' });
  });

  it('does not expose another space draft', async () => {
    await createDraft('private-draft');
    const other = await createEphemeralWorkspace({ label: 'module-registry-other', table: false });
    try {
      const list = await call('get', `/registry?space_id=${other.spaceId}&origin=internal`, other.userId);
      expect(list.status).toBe(200);
      expect(list.body.data.items.some((item) => item.key === 'private-draft')).toBe(false);
      const direct = await call('get', `/registry/private-draft?space_id=${other.spaceId}&origin=internal`, other.userId);
      expect(direct.status).toBe(404);
      expect(JSON.stringify(direct.body)).not.toContain('Searchable description private-draft');
    } finally {
      await other.cleanup();
    }
  });
});

describe('ADR-207 owner catalog metadata editing', () => {
  beforeEach(async () => {
    await createDraft('owner-meta');
    await createDraft('metadata-validation');
    await createDraft('metadata-concurrent');
  });

  it('merges description and readme independently, preserves install data and refreshes checksum', async () => {
    const original = await publish('owner-meta');
    const description = await call('patch', '/registry/owner-meta', ws.userId, {
      space_id: ws.spaceId,
      version: '1.0.0',
      blueprint: { description: 'Owner edited summary' },
    });
    expect(description.status).toBe(200);
    expect(description.body.data.item).toMatchObject({
      origin: 'internal', status: 'published', category: 'operations',
      checksum: expect.not.stringMatching(original.checksum),
    });
    expect(description.body.data.item.blueprint.description).toBe('Owner edited summary');
    expect(description.body.data.item.blueprint.tables).toEqual(original.blueprint.tables);

    const readme = await call('patch', '/registry/owner-meta', ws.userId, {
      space_id: ws.spaceId,
      version: '1.0.0',
      blueprint: { readme: '# Owner guide\n\nInstall **safely**.' },
    });
    expect(readme.status).toBe(200);
    expect(readme.body.data.item.blueprint).toMatchObject({
      description: 'Owner edited summary', readme: '# Owner guide\n\nInstall **safely**.',
    });
    expect(readme.body.data.item.checksum).not.toBe(description.body.data.item.checksum);
    expect(Date.parse(readme.body.data.item.updated_at)).toBeGreaterThanOrEqual(Date.parse(original.updated_at));

    const stored = await dbGet('SELECT blueprint, checksum FROM module_registry WHERE id = ?', [original.id]);
    expect(stored.blueprint).toMatchObject({
      description: 'Owner edited summary', readme: '# Owner guide\n\nInstall **safely**.',
    });
    expect(stored.checksum).toBe(readme.body.data.item.checksum);

    const cleared = await call('patch', '/registry/owner-meta', ws.userId, {
      space_id: ws.spaceId, version: '1.0.0', blueprint: { description: '' },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.item.blueprint.description).toBe('');
    expect(cleared.body.data.item.blueprint.readme).toBe('# Owner guide\n\nInstall **safely**.');
  });

  it('stores gallery media in order and clears it with an empty list', async () => {
    const original = await publish('owner-meta');
    const media = [
      {
        type: 'image', url: '/uploads/spaces/11/board.png', title: 'Board',
        thumbnail_url: '/uploads/spaces/11/board-thumb.png',
      },
      {
        type: 'video', url: '/uploads/spaces/11/tour.mp4', title: 'Tour',
        thumbnail_url: '/uploads/spaces/11/tour.jpg', captions_url: '/uploads/spaces/11/tour.vtt',
      },
    ];
    const saved = await call('patch', '/registry/owner-meta', ws.userId, {
      space_id: ws.spaceId, version: '1.0.0', blueprint: { media },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.data.item.blueprint.media).toEqual(media);
    expect(saved.body.data.item.blueprint.tables).toEqual(original.blueprint.tables);
    expect(saved.body.data.item.checksum).not.toBe(original.checksum);

    const reordered = [media[1], media[0]];
    const reorderedResponse = await call('patch', '/registry/owner-meta', ws.userId, {
      space_id: ws.spaceId, version: '1.0.0', blueprint: { media: reordered },
    });
    expect(reorderedResponse.status).toBe(200);
    expect(reorderedResponse.body.data.item.blueprint.media).toEqual(reordered);
    const stored = await dbGet('SELECT blueprint FROM module_registry WHERE id = ?', [original.id]);
    expect(stored.blueprint.media).toEqual(reordered);

    const cleared = await call('patch', '/registry/owner-meta', ws.userId, {
      space_id: ws.spaceId, version: '1.0.0', blueprint: { media: [] },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.item.blueprint.media).toEqual([]);
    expect(cleared.body.data.item.blueprint.description).toBe(original.blueprint.description);
  });

  it('rejects malformed media items without writes', async () => {
    const original = await publish('metadata-validation');
    const patches = [
      [{ type: 'document', url: '/uploads/spaces/11/file.pdf' }],
      [{ type: 'image' }],
      [{ type: 'image', url: '/uploads/spaces/11/board.png', unexpected: true }],
      Array.from({ length: 21 }, (_, index) => ({ type: 'image', url: `/uploads/spaces/11/${index}.png` })),
    ];
    for (const media of patches) {
      const response = await call('patch', '/registry/metadata-validation', ws.userId, {
        space_id: ws.spaceId, version: '1.0.0', blueprint: { media },
      });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('REGISTRY_REQUEST_INVALID');
    }
    const stored = await call('get', `/registry/metadata-validation?space_id=${ws.spaceId}&version=1.0.0`, ws.userId);
    expect(stored.body.data.item.checksum).toBe(original.checksum);
    expect(stored.body.data.item.blueprint).toEqual(original.blueprint);
  });

  it('accepts gallery media in schema 1 blueprints', async () => {
    const media = [{ type: 'image', url: '/uploads/spaces/11/legacy.png', title: 'Legacy' }];
    const created = await call('post', '/registry', ws.userId, {
      space_id: ws.spaceId,
      blueprint: {
        key: 'owner-meta-v1', version: '1.0.0', title: 'Legacy gallery', media,
        tables: [{ key: 'items', name: 'owner_meta_v1_items', columns: [{ column_name: 'name', type: 'text' }] }],
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.data.item.blueprint.media).toEqual(media);

    const updated = [{ type: 'video', url: '/uploads/spaces/11/legacy.mp4' }];
    const response = await call('patch', '/registry/owner-meta-v1', ws.userId, {
      space_id: ws.spaceId, version: '1.0.0', blueprint: { media: updated },
    });
    expect(response.status).toBe(200);
    expect(response.body.data.item.blueprint.media).toEqual(updated);
  });

  it('allows only a platform owner to edit a default module from any space', async () => {
    const original = blueprint('platform-meta');
    await dbRun(`
      INSERT INTO module_registry
        (key, origin, version, blueprint, publisher_space_id, status, checksum, category)
      VALUES (?, 'default', ?, ?::jsonb, NULL, 'published', ?, 'general')
    `, [original.key, original.version, JSON.stringify(original), '0'.repeat(64)]);
    try {
      const body = {
        space_id: ws.spaceId, version: original.version,
        blueprint: { description: 'Platform owner summary' },
      };
      const denied = await call('patch', '/registry/platform-meta', ws.userId, body);
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('REGISTRY_OWNER_REQUIRED');

      const platformUserId = await createUser('viewer');
      await dbRun("UPDATE users SET role = 'admin' WHERE id = ?", [platformUserId]);
      const saved = await call('patch', '/registry/platform-meta', platformUserId, body);
      expect(saved.status).toBe(200);
      expect(saved.body.data.item).toMatchObject({
        origin: 'default', publisher_space_id: null,
        blueprint: { description: 'Platform owner summary' },
      });
      expect(saved.body.data.item.checksum).not.toBe('0'.repeat(64));
    } finally {
      await dbRun("DELETE FROM module_registry WHERE key = 'platform-meta' AND origin = 'default'");
    }
  });

  it.each(['admin', 'member', 'viewer'])('allows only the publisher space owner, not %s, to edit', async (role) => {
    const userId = await createUser(role);
    await createDraft(`metadata-${role}`);
    const response = await call('patch', `/registry/metadata-${role}`, userId, {
      space_id: ws.spaceId, version: '1.0.0', blueprint: { description: 'Not allowed' },
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('REGISTRY_OWNER_REQUIRED');
    const stored = await call('get', `/registry/metadata-${role}?space_id=${ws.spaceId}&version=1.0.0`, ws.userId);
    expect(stored.body.data.item.blueprint.description).toBe(`Searchable description metadata-${role}`);
  });

  it('rejects empty, unknown and install-affecting patches without writes', async () => {
    const original = await publish('metadata-validation');
    for (const patch of [{}, { tables: [] }, { title: 'Changed title' }, { description: 'x'.repeat(2001) }]) {
      const response = await call('patch', '/registry/metadata-validation', ws.userId, {
        space_id: ws.spaceId, version: '1.0.0', blueprint: patch,
      });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('REGISTRY_REQUEST_INVALID');
    }
    const stored = await call('get', `/registry/metadata-validation?space_id=${ws.spaceId}&version=1.0.0`, ws.userId);
    expect(stored.body.data.item.checksum).toBe(original.checksum);
    expect(stored.body.data.item.blueprint).toEqual(original.blueprint);
  });

  it('refuses to edit an entry after it leaves internal origin', async () => {
    await createDraft('metadata-external');
    await publish('metadata-external');
    await call('post', '/registry/metadata-external/submit', ws.userId, { space_id: ws.spaceId, version: '1.0.0' });
    await call('post', '/registry/metadata-external/moderate', ws.userId, {
      space_id: ws.spaceId, version: '1.0.0', decision: 'audited',
    });
    const response = await call('patch', '/registry/metadata-external', ws.userId, {
      space_id: ws.spaceId, version: '1.0.0', blueprint: { description: 'Too late' },
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('REGISTRY_ORIGIN_INVALID');
  });

  it('does not lose one field when description and readme are saved concurrently', async () => {
    await publish('metadata-concurrent');
    const [description, readme] = await Promise.all([
      call('patch', '/registry/metadata-concurrent', ws.userId, {
        space_id: ws.spaceId, version: '1.0.0', blueprint: { description: 'Concurrent summary' },
      }),
      call('patch', '/registry/metadata-concurrent', ws.userId, {
        space_id: ws.spaceId, version: '1.0.0', blueprint: { readme: 'Concurrent guide' },
      }),
    ]);
    expect(description.status).toBe(200);
    expect(readme.status).toBe(200);
    const stored = await call('get', `/registry/metadata-concurrent?space_id=${ws.spaceId}&version=1.0.0`, ws.userId);
    expect(stored.body.data.item.blueprint).toMatchObject({
      description: 'Concurrent summary', readme: 'Concurrent guide',
    });
  });
});

describe('ADR-207 W4.1 catalog filters and install gate', () => {
  it('filters origin, all requested components, category, search, version and can_install', async () => {
    const memberId = await createUser('member');
    const adminId = await createUser('admin');
    const viewerId = await createUser('viewer');
    await createDraft('member-module', '1.0.0', false, 'operations');
    await publish('member-module');
    await createDraft('admin-module', '2.0.0', true, 'automation');
    await publish('admin-module', '2.0.0');

    const filtered = await call('get', `/registry?space_id=${ws.spaceId}&origin=internal&components=table,app,tile&category=operations&search=member-module&version=1.0.0&can_install=true`, memberId);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.items.map((item) => item.key)).toEqual(['member-module']);
    expect(filtered.body.data.items[0]).toMatchObject({
      version: '1.0.0', category: 'operations', can_install: true,
      required_role: 'member', edge_source: 'instance', edge_version: '1.0.0',
    });
    expect(filtered.body.data.items[0].components).toEqual(expect.arrayContaining(['table', 'app', 'tile']));

    const adminOnly = await call('get', `/registry?space_id=${ws.spaceId}&origin=internal&can_install=true`, memberId);
    expect(adminOnly.body.data.items.map((item) => item.key)).toEqual(['member-module']);
    const adminCatalog = await call('get', `/registry?space_id=${ws.spaceId}&origin=internal&can_install=true`, adminId);
    expect(adminCatalog.body.data.items.map((item) => item.key).sort()).toEqual(['admin-module', 'member-module']);
    const viewerCatalog = await call('get', `/registry?space_id=${ws.spaceId}&origin=internal&can_install=true`, viewerId);
    expect(viewerCatalog.body.data.items).toEqual([]);

    const wrongCategory = await call('get', `/registry?space_id=${ws.spaceId}&origin=internal&category=missing`, adminId);
    expect(wrongCategory.body.data.items).toEqual([]);
    const wrongVersion = await call('get', `/registry?space_id=${ws.spaceId}&origin=internal&version=9.9.9`, adminId);
    expect(wrongVersion.body.data.items).toEqual([]);
  });
});
